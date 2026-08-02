const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const LockService = require('../desktop/services/workflow-lock-service');
const Review = require('../desktop/services/workflow-review-service');
const artifactStore = require('../desktop/storage/workflow-artifact-store');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-locks-'));
  try {
    const created = await projectService.createProject(root, { id: 'lock-project', title: 'Lock Project' });
    const projectId = created.project.id;
    const runId = 'lock-run-1';
    await Creation.startGuidedCreation({
      dataRoot: root,
      projectId,
      runId,
      brief: {
        workingTitle: '锁测试',
        premise: '小红帽与狼的交易',
        genre: '黑童话',
        targetLength: 20000,
        tone: '冷峻',
        pov: '第三人称',
        themes: ['名字'],
        setting: '森林'
      },
      writingInstructions: {
        text: '克制叙述',
        qualityTargets: {
          technicalRegisterMode: 'avoid',
          technicalRegisterLocked: false,
          dialogueRatioEnabled: false
        }
      },
      constraints: [
        { kind: 'exclusion', text: '不得用梦境解释谜团', enforcement: 'soft' },
        { kind: 'direction', text: '小红帽必须取得主动权', enforcement: 'soft' }
      ]
    });

    const details = await Creation.getCreationRun(root, projectId, runId);
    assert.ok(details.run.settings.constraints.some((item) => item.kind === 'exclusion' && item.enforcement === 'soft'));

    // Seed a review artifact with soft tech finding + soft exclusion hit.
    await artifactStore.writeArtifactRevision(created.projectPath, runId, {
      id: 'review-batch-0001',
      projectId,
      runId,
      nodeId: 'review',
      artifactType: 'draft-review@1',
      title: '审查'
    }, {
      id: 'review-r1',
      summary: '测试审查',
      reviewState: 'approved',
      approvedAt: new Date().toISOString(),
      payload: { format: 'json' }
    }, {
      schemaVersion: 1,
      kind: 'draft-review',
      qualityGate: 'passed',
      blockingFindingCount: 0,
      findings: [
        {
          type: 'technical_register_drift',
          severity: 'warning',
          enforcement: 'soft',
          metricId: 'technical_register',
          evidence: '自动生成约束系统检测到',
          suggestion: '减少说明书腔'
        },
        {
          type: 'constraint_violation',
          severity: 'warning',
          enforcement: 'soft',
          constraintId: details.run.settings.constraints.find((item) => item.kind === 'exclusion').id,
          text: '不得用梦境解释谜团',
          evidence: '不得用梦境解释谜团'
        }
      ],
      metrics: { batch: { dialogueRatio: 0.2, technicalHits: 1 }, scenes: [], planFulfillment: [] }
    });

    const hardened = await LockService.updateRunLocks({
      dataRoot: root,
      projectId,
      runId,
      findingActions: [{ action: 'harden', type: 'technical_register_drift', metricId: 'technical_register' }]
    });
    assert.strictEqual(hardened.ok, true);
    assert.strictEqual(hardened.qualityTargets.technicalRegisterLocked, true);
    assert.strictEqual(hardened.qualityGate, 'blocked');
    assert.ok(hardened.blockingFindingCount >= 1);

    const after = await Creation.getCreationRun(root, projectId, runId);
    const review = after.run.artifacts.filter((artifact) => artifact.nodeId === 'review').slice(-1)[0];
    assert.ok(review.content.findings.some((item) => item.type === 'technical_register_drift' && item.enforcement === 'hard'));

    const exempted = await LockService.updateRunLocks({
      dataRoot: root,
      projectId,
      runId,
      findingActions: [{ action: 'exempt', type: 'technical_register_drift' }]
    });
    assert.strictEqual(exempted.qualityGate, 'passed');
    assert.ok((exempted.review.findings || []).some((item) => item.exempted));

    const exclusionHard = await LockService.updateRunLocks({
      dataRoot: root,
      projectId,
      runId,
      findingActions: [{ action: 'harden', type: 'constraint_violation' }]
    });
    assert.ok(exclusionHard.constraints.some((item) => item.kind === 'exclusion' && item.enforcement === 'hard'));

    // Seed soft-only + banned-term findings and verify action availability / persistence.
    await artifactStore.writeArtifactRevision(created.projectPath, runId, {
      id: 'review-batch-0001',
      projectId,
      runId,
      nodeId: 'review',
      artifactType: 'draft-review@1',
      title: '审查'
    }, {
      id: 'review-r-banned',
      summary: 'banned + soft-only',
      reviewState: 'approved',
      approvedAt: new Date().toISOString(),
      payload: { format: 'json' }
    }, {
      schemaVersion: 1,
      kind: 'draft-review',
      qualityGate: 'passed',
      blockingFindingCount: 0,
      findings: [
        {
          type: 'banned_term_hit',
          severity: 'warning',
          enforcement: 'soft',
          metricId: 'banned_terms',
          term: '精神失常',
          text: '精神失常',
          constraintId: 'quality-banned-精神失常',
          evidence: '精神失常'
        },
        {
          type: 'dialogue_ratio_below_target',
          severity: 'warning',
          enforcement: 'soft',
          metricId: 'dialogue_ratio'
        },
        {
          type: 'direction_literal_absent',
          severity: 'info',
          enforcement: 'soft',
          constraintId: details.run.settings.constraints.find((item) => item.kind === 'direction').id,
          text: '小红帽必须取得主动权'
        }
      ],
      metrics: { batch: {}, scenes: [], planFulfillment: [] }
    });

    assert.ok(LockService.isActionAllowedForFinding(
      { type: 'banned_term_hit', enforcement: 'soft' },
      'harden'
    ));
    assert.strictEqual(LockService.isActionAllowedForFinding(
      { type: 'dialogue_ratio_below_target', enforcement: 'soft' },
      'harden'
    ), false);
    assert.strictEqual(LockService.isActionAllowedForFinding(
      { type: 'direction_literal_absent', enforcement: 'soft' },
      'harden'
    ), false);

    const bannedHard = await LockService.updateRunLocks({
      dataRoot: root,
      projectId,
      runId,
      findingActions: [{ action: 'harden', type: 'banned_term_hit', metricId: 'banned_terms' }]
    });
    assert.ok(
      bannedHard.constraints.some((item) => item.text === '精神失常' && item.enforcement === 'hard' && item.enabled !== false),
      'banned_term harden should persist an exclusion hard constraint'
    );

    const dialogueNoHard = await LockService.updateRunLocks({
      dataRoot: root,
      projectId,
      runId,
      findingActions: [{ action: 'harden', type: 'dialogue_ratio_below_target', metricId: 'dialogue_ratio' }]
    });
    const dialogueFinding = (dialogueNoHard.review && dialogueNoHard.review.findings || [])
      .find((item) => item.type === 'dialogue_ratio_below_target');
    assert.ok(!dialogueFinding || dialogueFinding.enforcement === 'soft', 'dialogue ratio must stay soft');
    assert.notStrictEqual(dialogueNoHard.qualityTargets && dialogueNoHard.qualityTargets.dialogueRatioEnabled, true);

    const directionNoHard = await LockService.updateRunLocks({
      dataRoot: root,
      projectId,
      runId,
      findingActions: [{ action: 'harden', type: 'direction_literal_absent' }]
    });
    const directionFinding = (directionNoHard.review && directionNoHard.review.findings || [])
      .find((item) => item.type === 'direction_literal_absent');
    assert.ok(directionFinding && directionFinding.enforcement === 'soft');
    assert.strictEqual(directionFinding.severity, 'info');

    const due = LockService.dueThreadsFromRolling({
      unresolvedThreads: [
        { threadId: 't1', label: '幼狼爪痕', status: 'open', mustClose: true },
        '母亲的证据'
      ]
    });
    assert.strictEqual(due.length, 2);
    const finals = LockService.finalThreadFindings({
      threadLedger: due
    });
    assert.ok(finals.some((item) => item.type === 'thread_must_recover' && Review.isBlockingFinding(item)));
    assert.ok(finals.some((item) => item.type === 'thread_allowed_open'));

    console.log('workflow-lock-service: ok');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
