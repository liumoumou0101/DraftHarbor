const crypto = require('crypto');
const paths = require('../storage/library-paths');
const runStore = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const eventStore = require('../storage/workflow-event-store-v2');
const Review = require('./workflow-review-service');
const QualityMetrics = require('../../src/core/workflow/workflow-quality-metrics');

const WRITING_INSTRUCTIONS_TYPE = 'workflow-writing-instructions@1';
const LOCK_ACTIONS = new Set(['harden', 'soften', 'disable', 'exempt', 'enable']);

function clean(value, fallback = '') {
  return String(value === undefined || value === null ? fallback : value).trim();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function projectPath(dataRoot, projectId) {
  return paths.projectDir(dataRoot, projectId);
}

function normalizeConstraint(constraint = {}, index = 0) {
  const kind = ['direction', 'exclusion', 'fact'].includes(constraint.kind) ? constraint.kind : 'direction';
  return {
    id: clean(constraint.id, `${kind}-${index + 1}`),
    kind,
    text: clean(constraint.text),
    enforcement: constraint.enforcement === 'hard' ? 'hard' : 'soft',
    weight: Math.max(0, Math.min(5, Number(constraint.weight) || 1)),
    enabled: constraint.enabled !== false,
    category: clean(constraint.category),
    scope: clean(constraint.scope) || 'workflow'
  };
}

function normalizeConstraints(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => normalizeConstraint(item, index))
    .filter((item) => item.text);
}

function findingKey(finding = {}, index = 0) {
  return clean(finding.id)
    || [
      clean(finding.type),
      clean(finding.constraintId),
      clean(finding.metricId),
      clean(finding.sceneId),
      clean(finding.planRef && finding.planRef.field),
      String(index)
    ].filter(Boolean).join('::');
}

function matchFinding(finding, selector = {}, index = 0) {
  if (selector.findingKey && findingKey(finding, index) === clean(selector.findingKey)) return true;
  if (selector.index !== undefined && Number(selector.index) === index) return true;
  if (selector.constraintId && clean(finding.constraintId) === clean(selector.constraintId)) return true;
  if (selector.type && clean(finding.type) === clean(selector.type)) {
    if (selector.sceneId && clean(finding.sceneId) !== clean(selector.sceneId)) return false;
    if (selector.metricId && clean(finding.metricId) !== clean(selector.metricId)) return false;
    return true;
  }
  return false;
}

async function listArtifacts(targetPath, runId) {
  const families = await artifactStore.listArtifactFamilies(targetPath, runId);
  const records = [];
  for (const family of families) {
    const revisionId = family.revisionIds[family.revisionIds.length - 1];
    if (!revisionId) continue;
    const revision = await artifactStore.readArtifactRevision(targetPath, runId, family.id, revisionId);
    if (!revision) continue;
    records.push({
      id: family.id,
      title: family.title,
      nodeId: family.nodeId,
      targetRef: family.targetRef || {},
      artifactType: `${family.artifactType.id}@${family.artifactType.version}`,
      revision,
      content: await artifactStore.readArtifactContent(targetPath, runId, family.id, revision.id)
    });
  }
  return records;
}

function latestByType(artifacts, artifactType) {
  return artifacts.filter((artifact) => artifact.artifactType === artifactType).slice(-1)[0] || null;
}

function latestReview(artifacts) {
  return artifacts.filter((artifact) => artifact.nodeId === 'review'
    || String(artifact.artifactType || '').startsWith('draft-review')).slice(-1)[0] || null;
}

function applyFindingAction(finding, action) {
  const next = { ...finding };
  if (action === 'exempt') {
    next.exempted = true;
    next.fulfillment = next.fulfillment === 'unfulfilled' || next.fulfillment === 'deferred'
      ? 'exempt'
      : next.fulfillment;
    next.severity = 'info';
    next.enforcement = 'soft';
    next.suggestion = [clean(next.suggestion), '用户已豁免本条。'].filter(Boolean).join(' ');
    return next;
  }
  if (action === 'harden') {
    next.exempted = false;
    next.enforcement = 'hard';
    if (['info', 'suggestion', 'warning', 'pass'].includes(clean(next.severity).toLowerCase())) {
      next.severity = 'error';
    }
    return next;
  }
  if (action === 'soften') {
    next.enforcement = 'soft';
    if (['error', 'critical'].includes(clean(next.severity).toLowerCase())) {
      next.severity = 'warning';
    }
    return next;
  }
  if (action === 'disable') {
    next.enabled = false;
    next.enforcement = 'soft';
    next.severity = 'info';
    next.suggestion = [clean(next.suggestion), '对应锁已关闭，本条降为信息。'].filter(Boolean).join(' ');
    return next;
  }
  return next;
}

function patchConstraintsFromFindingActions(constraints, findings, actions) {
  const next = constraints.map((item) => ({ ...item }));
  for (const action of actions) {
    const matched = findings
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding, index }) => matchFinding(finding, action, index));
    for (const { finding } of matched) {
      if (!finding.constraintId && finding.type !== 'constraint_violation' && finding.type !== 'direction_literal_absent') {
        continue;
      }
      const text = clean(finding.text || finding.evidence);
      const index = next.findIndex((item) => item.id === finding.constraintId
        || (text && item.text === text));
      if (index < 0) continue;
      if (action.action === 'harden') next[index] = { ...next[index], enforcement: 'hard', enabled: true };
      if (action.action === 'soften') next[index] = { ...next[index], enforcement: 'soft', enabled: true };
      if (action.action === 'disable') next[index] = { ...next[index], enabled: false };
      if (action.action === 'enable') next[index] = { ...next[index], enabled: true };
    }
  }
  return next;
}

function patchQualityTargetsFromFindingActions(qualityTargets, findings, actions) {
  const next = { ...(qualityTargets || {}) };
  for (const action of actions) {
    const matched = findings.filter((finding, index) => matchFinding(finding, action, index));
    // Prefer matched findings; if UI only sent type, still apply target-level lock change.
    const types = matched.length
      ? matched.map((finding) => clean(finding.type) || clean(finding.metricId))
      : [clean(action.type), clean(action.metricId)].filter(Boolean);
    for (const type of types) {
      if (type === 'technical_register_drift' || type === 'technical_register') {
        if (action.action === 'harden') {
          next.technicalRegisterMode = 'avoid';
          next.technicalRegisterLocked = true;
        } else if (action.action === 'soften') {
          next.technicalRegisterMode = 'avoid';
          next.technicalRegisterLocked = false;
        } else if (action.action === 'disable') {
          next.technicalRegisterMode = 'off';
          next.technicalRegisterLocked = false;
        } else if (action.action === 'enable') {
          next.technicalRegisterMode = 'avoid';
        }
      }
      if (type === 'dialogue_ratio_below_target' || type === 'dialogue_ratio_above_target'
        || type === 'dialogue_ratio') {
        if (action.action === 'disable') next.dialogueRatioEnabled = false;
        if (action.action === 'enable' || action.action === 'soften') next.dialogueRatioEnabled = true;
      }
      if (type === 'plan_outcome_unfulfilled' || type === 'plan_outcome_deferred'
        || type === 'plan_fulfillment') {
        if (action.action === 'harden') next.planOutcomeLocked = true;
        if (action.action === 'soften' || action.action === 'disable') next.planOutcomeLocked = false;
      }
      if (type === 'repetitive_phrasing' || type === 'repetition') {
        if (action.action === 'harden') next.repetitionLocked = true;
        if (action.action === 'soften' || action.action === 'disable') next.repetitionLocked = false;
      }
    }
  }
  return QualityMetrics.normalizeQualityTargets(next);
}

function recomputeReviewGate(content = {}) {
  const findings = (Array.isArray(content.findings) ? content.findings : [])
    .map((finding) => Review.normalizeFinding(finding));
  const blocked = findings.filter((finding) => Review.isBlockingFinding(finding));
  return {
    ...content,
    findings,
    blockingFindingCount: blocked.length,
    qualityGate: blocked.length ? 'blocked' : 'passed',
    summary: findings.length
      ? `发现 ${findings.length} 项待处理问题，其中 ${blocked.length} 项阻断问题`
      : clean(content.summary, '未发现自动审查问题')
  };
}

async function updateRunLocks(options = {}) {
  const dataRoot = options.dataRoot;
  const projectId = clean(options.projectId);
  const runId = clean(options.runId);
  if (!dataRoot || !projectId || !runId) throw new Error('updateRunLocks requires dataRoot, projectId and runId');

  const targetPath = projectPath(dataRoot, projectId);
  const stored = await runStore.readWorkflowV2Run(targetPath, runId);
  if (!stored) throw new Error('workflow run not found');

  const artifacts = await listArtifacts(targetPath, runId);
  const definition = stored.definitionSnapshot && stored.definitionSnapshot.definition
    ? stored.definitionSnapshot.definition
    : {};
  const currentConstraints = normalizeConstraints((definition.settings && definition.settings.constraints) || []);
  let nextConstraints = Array.isArray(options.constraints)
    ? normalizeConstraints(options.constraints)
    : currentConstraints.slice();

  const findingActions = (Array.isArray(options.findingActions) ? options.findingActions : [])
    .map((item) => ({
      ...item,
      action: clean(item.action).toLowerCase()
    }))
    .filter((item) => LOCK_ACTIONS.has(item.action));

  const reviewArtifact = latestReview(artifacts);
  const reviewFindings = reviewArtifact && reviewArtifact.content && Array.isArray(reviewArtifact.content.findings)
    ? reviewArtifact.content.findings
    : [];

  if (findingActions.length) {
    nextConstraints = patchConstraintsFromFindingActions(nextConstraints, reviewFindings, findingActions);
  }

  const constraintsChanged = JSON.stringify(currentConstraints) !== JSON.stringify(nextConstraints);
  if (constraintsChanged || Array.isArray(options.constraints)) {
    await runStore.writeWorkflowV2RunDefinition(targetPath, runId, {
      ...definition,
      settings: {
        ...(definition.settings || {}),
        constraints: nextConstraints
      }
    });
  }

  const writingArtifact = latestByType(artifacts, WRITING_INSTRUCTIONS_TYPE);
  let nextInstructions = writingArtifact && writingArtifact.content
    ? { ...writingArtifact.content }
    : { text: '', qualityTargets: {} };
  if (options.writingInstructions && typeof options.writingInstructions === 'object') {
    nextInstructions = {
      ...nextInstructions,
      ...options.writingInstructions,
      qualityTargets: {
        ...(nextInstructions.qualityTargets || {}),
        ...((options.writingInstructions.qualityTargets) || {})
      }
    };
  }
  if (options.qualityTargets && typeof options.qualityTargets === 'object') {
    nextInstructions = {
      ...nextInstructions,
      qualityTargets: {
        ...(nextInstructions.qualityTargets || {}),
        ...options.qualityTargets
      }
    };
  }
  if (findingActions.length) {
    nextInstructions = {
      ...nextInstructions,
      qualityTargets: patchQualityTargetsFromFindingActions(
        nextInstructions.qualityTargets,
        reviewFindings,
        findingActions
      )
    };
  }
  nextInstructions.qualityTargets = QualityMetrics.normalizeQualityTargets({
    ...(nextInstructions.qualityTargets || {}),
    dialogueRatio: nextInstructions.dialogueRatio,
    mustAvoid: nextInstructions.mustAvoid
  });

  let writingRevision = null;
  const shouldWriteInstructions = !!(writingArtifact || options.writingInstructions || options.qualityTargets
    || findingActions.some((item) => ['harden', 'soften', 'disable', 'enable'].includes(item.action)));
  if (shouldWriteInstructions) {
    writingRevision = await artifactStore.writeArtifactRevision(targetPath, runId, {
      id: writingArtifact ? writingArtifact.id : 'run-writing-instructions',
      projectId,
      runId,
      nodeId: writingArtifact ? writingArtifact.nodeId : 'brief',
      artifactType: WRITING_INSTRUCTIONS_TYPE,
      title: writingArtifact ? writingArtifact.title : '全局写作指令 / 质量锁',
      targetRef: writingArtifact ? writingArtifact.targetRef : { role: 'writing-instructions' }
    }, {
      id: id('instructions-r'),
      parentRevisionId: writingArtifact ? writingArtifact.revision.id : '',
      summary: '用户更新质量锁 / 写作指令',
      reviewState: 'approved',
      approvedAt: new Date().toISOString(),
      payload: { format: 'json' }
    }, nextInstructions);
  }

  let reviewWrite = null;
  let reviewContent = null;
  if (reviewArtifact && (findingActions.length || options.reevaluateReview === true)) {
    let findings = reviewFindings.map((finding, index) => {
      const actions = findingActions.filter((item) => matchFinding(finding, item, index));
      let next = { ...finding };
      for (const item of actions) next = applyFindingAction(next, item.action);
      return Review.normalizeFinding(next);
    });
    reviewContent = recomputeReviewGate({
      ...reviewArtifact.content,
      findings,
      qualityTargetsSnapshot: nextInstructions.qualityTargets
    });
    if (options.reevaluateReview === true) {
      const drafts = artifacts.filter((artifact) => artifact.nodeId === 'draft');
      const plan = artifacts.filter((artifact) => artifact.nodeId === 'plan').slice(-1)[0];
      reviewContent = Review.reviewDraft({
        text: drafts.map((artifact) => artifact.content).join('\n\n'),
        scenes: drafts.map((artifact) => ({
          sceneId: clean(artifact.targetRef && artifact.targetRef.sceneId),
          revisionId: artifact.revision.id,
          title: artifact.title,
          text: artifact.content
        })),
        scenePlan: plan && plan.content,
        constraints: nextConstraints,
        writingInstructions: nextInstructions,
        qualityTargets: nextInstructions.qualityTargets,
        semanticFulfillment: Array.isArray(reviewArtifact.content.metrics
          && reviewArtifact.content.metrics.planFulfillment)
          ? reviewArtifact.content.metrics.planFulfillment.filter((item) => item.source === 'ai-semantic-review')
          : []
      });
      // Re-apply exemptions after full reevaluate.
      if (findingActions.some((item) => item.action === 'exempt')) {
        reviewContent.findings = (reviewContent.findings || []).map((finding, index) => {
          const actions = findingActions.filter((item) => item.action === 'exempt' && matchFinding(finding, item, index));
          let next = finding;
          for (const item of actions) next = applyFindingAction(next, item.action);
          return next;
        });
        reviewContent = recomputeReviewGate(reviewContent);
      }
    }
    reviewWrite = await artifactStore.writeArtifactRevision(targetPath, runId, {
      id: reviewArtifact.id,
      projectId,
      runId,
      nodeId: reviewArtifact.nodeId,
      artifactType: reviewArtifact.artifactType,
      title: reviewArtifact.title,
      targetRef: reviewArtifact.targetRef || {}
    }, {
      id: id('review-r'),
      parentRevisionId: reviewArtifact.revision.id,
      inputRevisionIds: reviewArtifact.revision.inputRevisionIds || [],
      summary: reviewContent.summary,
      reviewState: 'approved',
      approvedAt: new Date().toISOString(),
      payload: { format: 'json' }
    }, reviewContent);
  }

  await eventStore.appendWorkflowV2Event(targetPath, runId, {
    id: id('event'),
    type: 'run_locks_updated',
    nodeId: stored.state && stored.state.activeNodeId,
    payload: {
      constraintsChanged,
      constraintCount: nextConstraints.length,
      findingActionCount: findingActions.length,
      writingRevisionId: writingRevision && writingRevision.revision && writingRevision.revision.id,
      reviewRevisionId: reviewWrite && reviewWrite.revision && reviewWrite.revision.id,
      actions: findingActions.map((item) => item.action)
    }
  });

  return {
    ok: true,
    projectId,
    runId,
    constraints: nextConstraints,
    qualityTargets: nextInstructions.qualityTargets,
    writingRevisionId: writingRevision && writingRevision.revision && writingRevision.revision.id,
    reviewRevisionId: reviewWrite && reviewWrite.revision && reviewWrite.revision.id,
    qualityGate: reviewContent
      ? reviewContent.qualityGate
      : (reviewArtifact && reviewArtifact.content && reviewArtifact.content.qualityGate),
    blockingFindingCount: reviewContent
      ? reviewContent.blockingFindingCount
      : (reviewArtifact && reviewArtifact.content && reviewArtifact.content.blockingFindingCount),
    review: reviewContent || null
  };
}

function dueThreadsFromRolling(rollingContent = {}) {
  const ledger = Array.isArray(rollingContent.threadLedger)
    ? rollingContent.threadLedger
    : (Array.isArray(rollingContent.unresolvedThreads) ? rollingContent.unresolvedThreads : []);
  return ledger
    .map((item) => (typeof item === 'string'
      ? { threadId: `thread-${item.slice(0, 24)}`, label: item, status: 'open', mustClose: false }
      : {
        threadId: clean(item.threadId) || `thread-${clean(item.label).slice(0, 24)}`,
        label: clean(item.label || item.text),
        status: clean(item.status, 'open') || 'open',
        mustClose: !!item.mustClose,
        expectedRecoveryStage: clean(item.expectedRecoveryStage),
        evidence: clean(item.evidence)
      }))
    .filter((item) => item.label && !['closed', 'abandoned'].includes(item.status));
}

function finalThreadFindings(rollingContent = {}, options = {}) {
  const due = dueThreadsFromRolling(rollingContent);
  const findings = [];
  for (const thread of due) {
    if (thread.mustClose || options.requireMustClose) {
      findings.push(Review.normalizeFinding({
        type: 'thread_must_recover',
        severity: thread.mustClose ? 'error' : 'warning',
        enforcement: thread.mustClose ? 'hard' : 'soft',
        source: 'thread-ledger',
        metricId: 'foreshadowing',
        threadId: thread.threadId,
        evidence: thread.evidence || thread.label,
        suggestion: `线索「${thread.label}」仍未回收；终局前请闭合、标为允许开放，或用户豁免。`
      }));
    } else {
      findings.push(Review.normalizeFinding({
        type: 'thread_allowed_open',
        severity: 'info',
        enforcement: 'soft',
        source: 'thread-ledger',
        metricId: 'foreshadowing',
        threadId: thread.threadId,
        evidence: thread.label,
        suggestion: `线索「${thread.label}」仍开放，可在终局明确保留或回收。`
      }));
    }
  }
  return findings;
}

module.exports = {
  WRITING_INSTRUCTIONS_TYPE,
  LOCK_ACTIONS,
  normalizeConstraints,
  findingKey,
  matchFinding,
  applyFindingAction,
  updateRunLocks,
  dueThreadsFromRolling,
  finalThreadFindings,
  recomputeReviewGate
};
