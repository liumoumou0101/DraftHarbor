const crypto = require('crypto');
const runStore = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const CreationSchema = require('../../src/core/workflow/workflow-creation-schema');
const BatchSchema = require('../../src/core/workflow/workflow-generation-batch-schema');
const ChapterAssembly = require('../../src/core/workflow/workflow-chapter-assembly');
const ContextAssembly = require('../../src/core/workflow/workflow-context-assembly');
const QualityMetrics = require('../../src/core/workflow/workflow-quality-metrics');
const CreationService = require('./workflow-creation-service');
const Review = require('./workflow-review-service');
const { createGuidedRuntime } = require('./workflow-guided-runtime-service');

const STAGES = Object.freeze([
  { id: 'brief', title: '创作 Brief', capabilityId: 'creation.brief', description: '确认题材、核心创意、规模和创作边界。' },
  { id: 'direction', title: '创意方向', capabilityId: 'direction.design', description: '生成 2–4 个可选择、可组合的长篇方向。' },
  { id: 'blueprint', title: '故事蓝图与冲突结构', capabilityId: 'creation.blueprint', description: '确认中央冲突、结构阶段、人物弧和结局方向。' },
  { id: 'compendium', title: '人物与世界观资料草稿', capabilityId: 'compendium.draw', description: '生成沿用资料库协议的人物与世界观草稿。' },
  { id: 'plan', title: '节奏与场景计划', capabilityId: 'outline.design', description: '确认场景、情绪、冲突强度、节奏和细纲。' },
  { id: 'draft', title: '分场正文', capabilityId: 'draft.batch', description: '按照已确认计划逐场生成正文。' },
  { id: 'review', title: '自动审查', capabilityId: 'review.draft', description: '执行规则审查与 AI 语义连续性审查。' },
  { id: 'transfer', title: '转到写作与资料库', capabilityId: 'transfer.apply', description: '确认正文和资料草稿回流。' }
]);

const OUTPUT_TYPES = Object.freeze({
  brief: 'creation-brief@1', direction: 'direction-set@1', blueprint: 'story-blueprint@1',
  compendium: 'compendium-draft-bundle@1', plan: 'scene-plan@1', draft: 'draft-batch@1', review: 'draft-review@1'
});
const WRITING_INSTRUCTIONS_TYPE = 'workflow-writing-instructions@1';

function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function latest(artifacts, nodeId) { return artifacts.filter((artifact) => artifact.nodeId === nodeId).slice(-1)[0] || null; }
function latestByType(artifacts, artifactType) {
  return artifacts.filter((artifact) => artifact.artifactType === artifactType).slice(-1)[0] || null;
}
function normalizeWritingInstructions(input = {}) {
  const QualityMetrics = require('../../src/core/workflow/workflow-quality-metrics');
  const source = typeof input === 'string' ? { text: input } : input && typeof input === 'object' ? input : {};
  const list = (value) => (Array.isArray(value) ? value : clean(value).split(/\r?\n|，|,/))
    .map((item) => clean(item)).filter(Boolean);
  const stages = list(source.stages || source.applicableStages);
  const qualityTargets = QualityMetrics.normalizeQualityTargets({
    ...(source.qualityTargets && typeof source.qualityTargets === 'object' ? source.qualityTargets : {}),
    dialogueRatio: source.dialogueRatio,
    dialogueRatioEnabled: source.qualityTargets && source.qualityTargets.dialogueRatioEnabled,
    dialogueRatioMin: source.qualityTargets && source.qualityTargets.dialogueRatioMin,
    dialogueRatioMax: source.qualityTargets && source.qualityTargets.dialogueRatioMax,
    mustAvoid: source.mustAvoid || source.avoid,
    technicalRegisterMode: source.qualityTargets && source.qualityTargets.technicalRegisterMode,
    technicalRegisterLocked: source.qualityTargets && source.qualityTargets.technicalRegisterLocked,
    technicalPatterns: source.qualityTargets && source.qualityTargets.technicalPatterns,
    bannedTerms: source.qualityTargets && source.qualityTargets.bannedTerms,
    cautionTerms: source.qualityTargets && source.qualityTargets.cautionTerms,
    formulaicPatterns: source.qualityTargets && source.qualityTargets.formulaicPatterns,
    repetitionEnabled: source.qualityTargets && source.qualityTargets.repetitionEnabled,
    repetitionLocked: source.qualityTargets && source.qualityTargets.repetitionLocked,
    planOutcomeLocked: source.qualityTargets && source.qualityTargets.planOutcomeLocked,
    foreshadowingThreads: source.qualityTargets && source.qualityTargets.foreshadowingThreads
  });
  return {
    schemaVersion: 1,
    kind: 'workflow-writing-instructions',
    text: clean(source.text || source.instructions),
    styleAndDistance: clean(source.styleAndDistance || source.style),
    dialogueRatio: clean(source.dialogueRatio),
    pacingPreference: clean(source.pacingPreference || source.pacing),
    mustAvoid: list(source.mustAvoid || source.avoid),
    applicableStages: stages.length ? stages : ['direction', 'blueprint', 'compendium', 'plan', 'draft', 'review'],
    qualityTargets
  };
}
function artifactBatchId(artifact) { return clean(artifact && artifact.targetRef && artifact.targetRef.batchId); }
function batchScopedNode(nodeId) { return ['plan', 'draft', 'review'].includes(nodeId); }
function currentBatchArtifact(run, nodeId) {
  const batchId = clean(run && run.activeBatchId);
  return (run && run.artifacts || []).filter((artifact) => artifact.nodeId === nodeId
    && artifact.effectiveFreshness !== 'stale'
    && (!batchId || artifactBatchId(artifact) === batchId)).slice(-1)[0] || null;
}
function currentBatchArtifacts(run, nodeId) {
  const batchId = clean(run && run.activeBatchId);
  return (run && run.artifacts || []).filter((artifact) => artifact.nodeId === nodeId
    && artifact.effectiveFreshness !== 'stale'
    && (!batchId || artifactBatchId(artifact) === batchId));
}
function artifactReference(artifact, options = {}) {
  if (!artifact || !artifact.revision) return {};
  return {
    artifactId: artifact.id,
    revisionId: artifact.revision.id,
    sceneId: clean(options.sceneId || artifact.targetRef && artifact.targetRef.sceneId),
    sequence: Number(options.sequence || artifact.targetRef && artifact.targetRef.sceneSequence) || 0,
    characters: typeof artifact.content === 'string' ? BatchSchema.countTextCharacters(artifact.content) : 0
  };
}
function batchStatusFromRun(run, artifacts) {
  if (run.status === 'completed') return 'completed';
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status === 'failed') return 'failed';
  if (latest(artifacts, 'review')) return 'waiting_decision';
  if (artifacts.some((artifact) => artifact.nodeId === 'draft')) return 'reviewing';
  if (latest(artifacts, 'plan')) return 'drafting';
  return 'planning';
}
function legacyCreationBatch(run) {
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
  const brief = latestByType(artifacts, OUTPUT_TYPES.brief) || latest(artifacts, 'brief');
  const plan = latest(artifacts, 'plan');
  const drafts = artifacts.filter((artifact) => artifact.nodeId === 'draft');
  const review = latest(artifacts, 'review');
  const batchCharacters = drafts.reduce((sum, artifact) => sum + BatchSchema.countTextCharacters(artifact.content), 0);
  const status = batchStatusFromRun(run, artifacts);
  const raw = {
    batchId: BatchSchema.batchIdForSequence(1),
    sequence: 1,
    status,
    targetCharacters: Number(brief && brief.content && brief.content.targetLength) || 0,
    plannedCharacters: plan && plan.content && Array.isArray(plan.content.scenes)
      ? plan.content.scenes.reduce((sum, scene) => sum + (Number(scene.targetWords) || 0), 0) : 0,
    planRef: artifactReference(plan),
    draftRefs: drafts.map((artifact, index) => artifactReference(artifact, { sequence: index + 1 })),
    reviewRef: artifactReference(review),
    batchCharacters,
    cumulativeCharacters: batchCharacters,
    terminationReason: status === 'completed' ? 'user_stopped' : status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : ''
  };
  const validation = BatchSchema.validateGenerationBatch(raw);
  if (!validation.ok) return null;
  return { ...validation.batch, legacy: true };
}
function decorateCreationRun(run, internalArtifacts) {
  const warnings = [];
  const records = (Array.isArray(internalArtifacts) ? internalArtifacts : [])
    .filter((artifact) => artifact.artifactType === 'generation-batch@1');
  const parsed = [];
  for (const artifact of records) {
    const validation = BatchSchema.validateGenerationBatch(artifact.content);
    if (!validation.ok) {
      warnings.push({ artifactId: artifact.id, errors: validation.errors });
      continue;
    }
    parsed.push({ ...validation.batch, artifactId: artifact.id, revisionId: artifact.revision.id, legacy: false });
  }
  let batches = [];
  try {
    batches = BatchSchema.createGenerationBatchSet(parsed).map((batch) => {
      const source = parsed.find((item) => item.batchId === batch.batchId) || {};
      return { ...batch, artifactId: source.artifactId, revisionId: source.revisionId, legacy: false };
    });
  } catch (error) {
    warnings.push({ artifactId: '', errors: [error.message || String(error)] });
  }
  if (!batches.length) {
    const legacy = legacyCreationBatch(run);
    if (legacy) batches = [legacy];
  }
  const active = batches.slice().reverse().find((batch) => !['completed', 'cancelled', 'failed'].includes(batch.status))
    || batches[batches.length - 1] || null;
  // Raw length stays on batch.cumulativeCharacters (legacy). Product progress uses body stats.
  const completedRawCharacters = batches.length ? batches[batches.length - 1].cumulativeCharacters : 0;
  const drafts = (run.artifacts || []).filter((artifact) => artifact.nodeId === 'draft'
    && artifact.revision && artifact.revision.reviewState === 'approved'
    && typeof artifact.content === 'string');
  const derivedBody = drafts.reduce((sum, artifact) => sum + BatchSchema.countBodyStatsCharacters(artifact.content), 0);
  const lastBody = batches.length ? Number(batches[batches.length - 1].cumulativeBodyStatsChars) || 0 : 0;
  const completedBodyStatsChars = lastBody > 0 ? lastBody : derivedBody;
  const brief = latestByType(run.artifacts || [], OUTPUT_TYPES.brief);
  const targetCharacters = batches[0] && batches[0].targetCharacters
    || Number(brief && brief.content && brief.content.targetLength) || 0;
  return {
    batches,
    activeBatchId: active ? active.batchId : '',
    batchWarnings: warnings,
    generationProgress: {
      // Keep completedCharacters as raw for existing callers/tests; UI should prefer body stats labels.
      completedCharacters: completedRawCharacters,
      targetCharacters,
      remainingCharacters: Math.max(0, targetCharacters - completedBodyStatsChars),
      completionRatio: targetCharacters ? Math.min(1, completedBodyStatsChars / targetCharacters) : 0,
      completedBodyStatsChars,
      completedRawCharacters,
      targetBodyStatsChars: targetCharacters,
      remainingBodyStatsChars: Math.max(0, targetCharacters - completedBodyStatsChars)
    }
  };
}
function normalizeConstraints(options = {}) {
  return (Array.isArray(options.constraints) ? options.constraints : []).map((constraint, index) => ({
    id: clean(constraint.id, `constraint-${index + 1}`),
    kind: ['direction', 'exclusion', 'fact'].includes(constraint.kind) ? constraint.kind : 'direction',
    text: clean(constraint.text),
    // Default soft unless user explicitly sets hard (exclusion included).
    enforcement: constraint.enforcement === 'hard' ? 'hard' : 'soft',
    weight: Math.max(0, Math.min(5, Number(constraint.weight) || 1)),
    enabled: constraint.enabled !== false
  })).filter((constraint) => constraint.text);
}

function definition(options = {}) {
  return {
    id: 'creation-guided-definition', templateId: 'creation-guided', templateVersion: 1,
    title: '从零创作 · 引导模式', description: '从结构化 Brief 开始，完成人物、世界观、场景计划、正文、审查与回流。',
    automationLevel: 'semi_automatic',
    nodes: STAGES.map((stage, index) => ({ ...stage, config: { requiresApproval: !['brief', 'review'].includes(stage.id) }, position: { x: index * 240, y: 0 } })),
    edges: STAGES.slice(1).map((stage, index) => ({ id: `creation-edge-${index + 1}`, fromNodeId: STAGES[index].id, fromPortId: 'next', toNodeId: stage.id, toPortId: 'previous' })),
    settings: { fineOutlineEnabled: options.fineOutlineEnabled !== false, constraints: normalizeConstraints(options), generationPolicy: options.generationPolicy || { providerProfileId: 'inherit' } }
  };
}

const runtime = createGuidedRuntime({
  templateId: 'creation-guided', stages: STAGES, outputTypes: OUTPUT_TYPES, transferNodeId: 'transfer',
  decorateRun: decorateCreationRun,
  outputIdentity({ nodeId, index, details, options }) {
    if (!['plan', 'draft'].includes(nodeId)) return {};
    const batchId = clean(details.run.activeBatchId, BatchSchema.batchIdForSequence(1));
    const batch = (details.run.batches || []).find((item) => item.batchId === batchId);
    const sequence = batch ? batch.sequence : 1;
    const plan = currentBatchArtifact(details.run, 'plan');
    const scene = nodeId === 'draft' && plan && plan.content && Array.isArray(plan.content.scenes)
      ? plan.content.scenes[index] || {} : {};
    return {
      artifactId: nodeId === 'plan'
        ? `plan-${batchId}`
        : `draft-${batchId}-s${String(index + 1).padStart(4, '0')}`,
      targetRef: {
        batchId,
        batchSequence: sequence,
        sceneId: clean(options.outputRefs && options.outputRefs[index] && options.outputRefs[index].sceneId, scene.id),
        sceneSequence: nodeId === 'draft' ? index + 1 : 0
      }
    };
  },
  artifactInActiveScope(artifact, run, nodeId) {
    if (!batchScopedNode(nodeId)) return true;
    const batchId = clean(run.activeBatchId);
    return !batchId || artifactBatchId(artifact) === batchId;
  },
  inputArtifacts(artifacts, run) {
    const batchId = clean(run.activeBatchId);
    return artifacts.filter((artifact) => !batchScopedNode(artifact.nodeId)
      || !artifactBatchId(artifact)
      || artifactBatchId(artifact) === batchId);
  },
  normalizeOutput(nodeId, output, options) {
    if (options.artifactType === WRITING_INSTRUCTIONS_TYPE) return normalizeWritingInstructions(output);
    if (nodeId === 'brief') return CreationSchema.createCreationBrief(output);
    return CreationService.normalizeCreationOutput(nodeId, output, { projectId: options.projectId });
  }
});

function nodeStates() {
  return STAGES.map((stage) => ({ nodeId: stage.id, executionState: stage.id === 'brief' ? 'completed' : stage.id === 'direction' ? 'ready' : 'pending' }));
}

async function startGuidedCreation(options = {}) {
  const projectId = clean(options.projectId);
  if (!options.dataRoot || !projectId) throw new Error('creation workflow dataRoot and projectId are required');
  const brief = CreationSchema.createCreationBrief(options.brief || options);
  const runId = clean(options.runId, id('creation-run'));
  const targetPath = runtime.projectPath(options.dataRoot, projectId);
  const created = await runStore.createWorkflowV2Run(targetPath, {
    id: runId, projectId, title: clean(options.title, `从零创作 · ${brief.workingTitle}`), status: 'in_progress', activeNodeId: 'direction',
    definition: options.definitionOverride || definition(options), state: { status: 'in_progress', activeNodeId: 'direction', nodeStates: nodeStates() }
  });
  const artifact = await runtime.writeArtifact(targetPath, {
    projectId, runId, nodeId: 'brief', artifactId: 'creation-brief', artifactType: OUTPUT_TYPES.brief,
    revisionId: id('brief-r'), title: '创作 Brief', summary: '用户确认的创作起点', content: brief,
    format: 'json', reviewState: 'approved', approvedAt: new Date().toISOString()
  });
  const writingInstructions = await runtime.writeArtifact(targetPath, {
    projectId, runId, nodeId: 'brief', artifactId: 'creation-writing-instructions',
    artifactType: WRITING_INSTRUCTIONS_TYPE, revisionId: id('instructions-r'),
    title: '全局写作指令', summary: '本次长篇创作的全局文风与写作要求',
    content: normalizeWritingInstructions(options.writingInstructions),
    format: 'json', reviewState: 'approved', approvedAt: new Date().toISOString()
  });
  await writeCreationBatch({
    ...options,
    projectId,
    runId,
    batch: {
      batchId: BatchSchema.batchIdForSequence(1),
      sequence: 1,
      status: 'planning',
      targetCharacters: brief.targetLength,
      cumulativeCharacters: 0,
      writingInstructionRef: {
        artifactId: writingInstructions.family.id,
        revisionId: writingInstructions.revision.id
      }
    }
  });
  await runtime.appendEvent(targetPath, runId, 'guided_run_created', 'brief', { workingTitle: brief.workingTitle, targetLength: brief.targetLength });
  return { ok: true, runId, summary: created.summary, brief: { artifactId: artifact.family.id, revisionId: artifact.revision.id } };
}

async function prepareCreationNode(options = {}) {
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const nodeId = clean(options.nodeId, details.run.activeNodeId);
  if (nodeId !== details.run.activeNodeId) throw new Error(`guided node is not active: ${nodeId}`);
  const artifacts = details.run.artifacts;
  const directionArtifact = latest(artifacts, 'direction');
  const selectedDirectionIds = Array.isArray(options.selectedDirectionIds) && options.selectedDirectionIds.length
    ? options.selectedDirectionIds
    : directionArtifact && directionArtifact.content && Array.isArray(directionArtifact.content.selectedDirectionIds)
      ? directionArtifact.content.selectedDirectionIds : [];
  const activeBatch = (details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId);
  const previousBatch = activeBatch && (details.run.batches || []).find((batch) => batch.sequence === activeBatch.sequence - 1);
  const previousDrafts = previousBatch
    ? artifacts.filter((artifact) => artifact.nodeId === 'draft' && artifactBatchId(artifact) === previousBatch.batchId)
    : [];
  const previousReview = previousBatch
    ? artifacts.filter((artifact) => artifact.nodeId === 'review' && artifactBatchId(artifact) === previousBatch.batchId).slice(-1)[0]
    : null;
  const previousContinuity = previousBatch && previousBatch.rollingStateRef && previousBatch.rollingStateRef.artifactId
    ? await artifactStore.readArtifactContent(
      runtime.projectPath(options.dataRoot, options.projectId),
      options.runId,
      previousBatch.rollingStateRef.artifactId,
      previousBatch.rollingStateRef.revisionId
    )
    : null;
  const previousEnding = previousDrafts.length && typeof previousDrafts[previousDrafts.length - 1].content === 'string'
    ? previousDrafts[previousDrafts.length - 1].content.slice(-2000)
    : '';
  const currentDrafts = currentBatchArtifacts(details.run, 'draft');
  const latestBatchReview = artifacts.filter((artifact) => artifact.nodeId === 'review'
    && (!activeBatch || artifactBatchId(artifact) === activeBatch.batchId)).slice(-1)[0];
  const currentEnding = currentDrafts.length && typeof currentDrafts[currentDrafts.length - 1].content === 'string'
    ? currentDrafts[currentDrafts.length - 1].content.slice(-4000)
    : '';
  const writingInstructionRef = activeBatch && activeBatch.writingInstructionRef;
  const writingInstructions = writingInstructionRef && writingInstructionRef.artifactId
    ? await artifactStore.readArtifactContent(
      runtime.projectPath(options.dataRoot, options.projectId),
      options.runId,
      writingInstructionRef.artifactId,
      writingInstructionRef.revisionId
    )
    : normalizeWritingInstructions(latestByType(artifacts, WRITING_INSTRUCTIONS_TYPE)?.content);
  const allApprovedDrafts = artifacts
    .filter((artifact) => artifact.nodeId === 'draft'
      && artifact.revision
      && artifact.revision.reviewState === 'approved'
      && typeof artifact.content === 'string'
      && artifact.content.trim())
    .map((artifact) => ({
      sceneId: clean(artifact.targetRef && artifact.targetRef.sceneId, artifact.id),
      id: artifact.id,
      title: artifact.title,
      text: artifact.content
    }));
  const fatContext = {
    projectId: options.projectId,
    brief: latestByType(artifacts, OUTPUT_TYPES.brief) && latestByType(artifacts, OUTPUT_TYPES.brief).content,
    writingInstructions,
    globalContext: {
      globalPrompt: clean(details.run.settings.generationPolicy
        && details.run.settings.generationPolicy.snapshot
        && details.run.settings.generationPolicy.snapshot.globalPrompt),
      writingInstructions
    },
    directions: directionArtifact && directionArtifact.content,
    selectedDirectionIds,
    blueprint: latest(artifacts, 'blueprint') && latest(artifacts, 'blueprint').content,
    compendium: latest(artifacts, 'compendium') && latest(artifacts, 'compendium').content,
    scenePlan: currentBatchArtifact(details.run, 'plan') && currentBatchArtifact(details.run, 'plan').content,
    constraints: details.run.settings.constraints || [],
    fineOutlineEnabled: details.run.settings.fineOutlineEnabled !== false,
    approvedDrafts: allApprovedDrafts,
    batchContext: {
      batchId: activeBatch && activeBatch.batchId,
      sequence: activeBatch && activeBatch.sequence || 1,
      userInstruction: activeBatch && activeBatch.userInstruction || '',
      repairReview: nodeId === 'draft' && latestBatchReview ? {
        summary: clean(latestBatchReview.content && latestBatchReview.content.summary),
        findings: Array.isArray(latestBatchReview.content && latestBatchReview.content.findings)
          ? latestBatchReview.content.findings : []
      } : null,
      blueprintStage: activeBatch && activeBatch.blueprintStage || '',
      suggestedSceneCount: activeBatch && activeBatch.suggestedSceneCount || 0,
      progress: details.run.generationProgress,
      dueThreads: (() => {
        try {
          const LockService = require('./workflow-lock-service');
          return LockService.dueThreadsFromRolling(previousContinuity || {});
        } catch (_error) {
          return [];
        }
      })(),
      mustCloseThreads: (() => {
        try {
          const LockService = require('./workflow-lock-service');
          return LockService.dueThreadsFromRolling(previousContinuity || {}).filter((thread) => thread.mustClose);
        } catch (_error) {
          return [];
        }
      })(),
      previousBatch: previousBatch ? {
        batchId: previousBatch.batchId,
        sequence: previousBatch.sequence,
        batchCharacters: previousBatch.batchCharacters,
        review: previousReview && previousReview.content,
        continuityState: previousContinuity,
        lastSceneEnding: previousEnding
      } : null,
      currentBatch: {
        completedScenes: currentDrafts.map((artifact) => ({
          sceneId: clean(artifact.targetRef && artifact.targetRef.sceneId),
          title: artifact.title,
          text: typeof artifact.content === 'string' ? artifact.content : '',
          ending: typeof artifact.content === 'string' ? artifact.content.slice(-800) : ''
        })),
        lastSceneEnding: currentEnding
      }
    }
  };

  // F-09.6J: assemble lean context for plan/draft/review (direction/blueprint/compendium keep fuller raw).
  const assemblyStage = ['plan', 'draft', 'review'].includes(nodeId) ? nodeId : nodeId;
  let context = fatContext;
  let contextReport = null;
  if (['plan', 'draft', 'review'].includes(nodeId)) {
    const planForScene = currentBatchArtifact(details.run, 'plan');
    const planScenes = planForScene && planForScene.content && Array.isArray(planForScene.content.scenes)
      ? planForScene.content.scenes
      : [];
    const completedSceneIdsForDraft = new Set(currentDrafts.map((artifact) => clean(artifact.targetRef && artifact.targetRef.sceneId)));
    const nextScene = planScenes.find((scene) => !completedSceneIdsForDraft.has(clean(scene.id)));
    if (nodeId === 'draft' && nextScene) fatContext.currentScene = nextScene;
    if (nodeId === 'review') {
      fatContext.drafts = currentBatchArtifacts(details.run, 'draft').map((artifact) => ({
        sceneId: clean(artifact.targetRef && artifact.targetRef.sceneId),
        revisionId: artifact.revision.id,
        title: artifact.title,
        text: artifact.content
      }));
    }
    const assembled = ContextAssembly.assembleContext(assemblyStage, fatContext);
    context = assembled.context;
    contextReport = assembled.report;
    try {
      await runtime.appendEvent(
        runtime.projectPath(options.dataRoot, options.projectId),
        options.runId,
        'prompt_context_assembled',
        nodeId,
        {
          stage: assemblyStage,
          rawChars: contextReport.rawChars,
          assembledChars: contextReport.assembledChars,
          estimatedTokensRough: contextReport.estimatedTokensRough,
          compressionRatio: contextReport.compressionRatio,
          styleExemplar: contextReport.styleExemplar,
          selectedCompendiumCount: (contextReport.selectedCompendiumIds || []).length,
          trimCount: (contextReport.trims || []).length
        }
      );
    } catch (_error) {
      // Event best-effort; never block generation.
    }
  }

  if (nodeId === 'review') {
    const fulfillmentChecklist = QualityMetrics.planFulfillmentChecklist(context.scenePlan || {});
    context.reviewRequirements = { planFulfillmentChecklist: fulfillmentChecklist };
    return {
      ok: true,
      nodeId,
      outputFormat: 'json',
      contextReport,
      usageHint: contextReport && contextReport.usageHint,
      prompts: [{
        id: 'creation-semantic-review',
        title: '新作语义连续性审查',
        prompt: {
          messages: [
            {
              role: 'system',
              content: '你是严苛的长篇连续性编辑。检查正文对故事蓝图、人物资料、世界规则、场景计划、全局写作指令、必须包含项、人物主动性、对话比例、人物动机、情绪节奏、相邻场景边界和创作过程信息泄漏的遵守情况，并整理供下一批使用的连续性状态。相邻场景边界问题必须区分为 scene_boundary_repetition（重复重演）、previous_scene_overreach（前场越界提前写完下一场）或 scene_state_reset（本场未承接前场结果而重置状态）。计划结果兑现必须逐项覆盖 user 内容中 reviewRequirements.planFulfillmentChecklist 的每一个精确 sceneId+field 键，不得漏项；对每项给出 fulfilled、deferred、unfulfilled 或 exempt 并附正文证据，语义已兑现时不得因缺少原句而判 unfulfilled。unresolvedThreads 优先返回对象 {threadId,label,status,mustClose,evidence}；新发现的叙事悬念必须默认 mustClose:false，只有 user 内容的 mustCloseThreads、dueThreads 或作者明确锁定的伏笔要求才能设为 true，不得自行把有趣悬念升级成硬性终局义务。severity 只能使用 pass、info、suggestion、warning、error、critical；只有明确违反硬约束、结构损坏或严重连续性错误才能标为 error/critical，启发式文风建议必须标为 suggestion/warning。只返回合法 JSON：{summary,findings:[{type,severity,enforcement,sceneId,revisionId,relatedSceneId,relatedRevisionId,sceneTitle,evidence,suggestion}],planFulfillment:[{sceneId,field,status,evidence,deferredToSceneId}],continuityState:{summary,characterStates:{},unresolvedThreads:[],knownFacts:[],lastEnding}}。'
            },
            { role: 'user', content: JSON.stringify(context) }
          ]
        }
      }]
    };
  }
  const prepared = CreationService.prepareCreationStage(nodeId, context);
  if (nodeId !== 'draft') {
    return {
      ok: true,
      nodeId,
      ...prepared,
      contextReport,
      usageHint: contextReport && contextReport.usageHint
    };
  }
  const plan = currentBatchArtifact(details.run, 'plan');
  const scenes = plan && plan.content && Array.isArray(plan.content.scenes) ? plan.content.scenes : [];
  const completedSceneIds = new Set(currentDrafts.map((artifact) => clean(artifact.targetRef && artifact.targetRef.sceneId)));
  const outputIndex = scenes.findIndex((scene) => !completedSceneIds.has(clean(scene.id)));
  if (outputIndex < 0) throw new Error('当前批次的场景正文已经全部生成');
  return {
    ok: true,
    nodeId,
    outputFormat: prepared.outputFormat,
    prompts: [{ ...prepared.prompts[outputIndex], outputIndex }],
    sequentialDraft: true,
    batchId: activeBatch && activeBatch.batchId,
    batchSequence: activeBatch && activeBatch.sequence || 1,
    cumulativeCharacters: details.run.generationProgress.completedCharacters,
    completedCount: completedSceneIds.size,
    totalCount: scenes.length,
    remainingCount: scenes.length - completedSceneIds.size,
    contextReport,
    usageHint: contextReport && contextReport.usageHint
  };
}

async function writeCreationBatch(options = {}) {
  const projectId = clean(options.projectId);
  const runId = clean(options.runId);
  if (!options.dataRoot || !projectId || !runId) throw new Error('creation batch dataRoot, projectId and runId are required');
  const targetPath = runtime.projectPath(options.dataRoot, projectId);
  const internal = (await runtime.artifactRecords(targetPath, runId))
    .filter((artifact) => artifact.artifactType === 'generation-batch@1');
  const requested = options.batch && typeof options.batch === 'object' ? options.batch : {};
  const requestedId = clean(requested.batchId) || BatchSchema.batchIdForSequence(requested.sequence);
  const existing = internal.find((artifact) => clean(artifact.content && artifact.content.batchId) === requestedId);
  const input = {
    ...(existing && existing.content || {}),
    ...requested,
    batchId: requestedId,
    createdAt: clean(existing && existing.content && existing.content.createdAt, requested.createdAt || new Date().toISOString())
  };
  const batch = BatchSchema.requireGenerationBatch(input);
  const otherBatches = internal.filter((artifact) => artifact !== existing).map((artifact) => BatchSchema.requireGenerationBatch(artifact.content));
  BatchSchema.createGenerationBatchSet([...otherBatches, batch]);
  if (!existing && batch.sequence > otherBatches.length + 1) throw new Error('generation batch sequence must be contiguous');
  const referenced = [batch.writingInstructionRef, batch.planRef, ...batch.draftRefs, batch.reviewRef, batch.rollingStateRef]
    .filter((reference) => reference.artifactId || reference.revisionId);
  for (const reference of referenced) {
    if (!reference.artifactId || !reference.revisionId) throw new Error('generation batch artifact refs require artifactId and revisionId');
    const [family, revision] = await Promise.all([
      artifactStore.readArtifactFamily(targetPath, runId, reference.artifactId),
      artifactStore.readArtifactRevision(targetPath, runId, reference.artifactId, reference.revisionId)
    ]);
    if (!family || !revision) throw new Error(`generation batch artifact ref not found: ${reference.artifactId}@${reference.revisionId}`);
    const referencedBatchId = clean(family.targetRef && family.targetRef.batchId);
    if (referencedBatchId && referencedBatchId !== batch.batchId) {
      throw new Error(`generation batch artifact ref belongs to another batch: ${reference.artifactId}`);
    }
  }
  const result = await runtime.writeArtifact(targetPath, {
    projectId,
    runId,
    nodeId: 'plan',
    artifactId: `generation-${batch.batchId}`,
    artifactType: 'generation-batch@1',
    revisionId: id('batch-r'),
    parentRevisionId: existing && existing.revision.id,
    title: `第 ${batch.sequence} 批生成清单`,
    summary: `第 ${batch.sequence} 批 · ${batch.status} · 累计 ${batch.cumulativeCharacters} 字符`,
    content: batch,
    format: 'json',
    reviewState: 'approved',
    approvedAt: new Date().toISOString(),
    targetRef: { internal: true, role: 'generation-batch', batchId: batch.batchId, batchSequence: batch.sequence }
  });
  return { ok: true, batch, artifact: result };
}

async function syncActiveCreationBatch(options = {}, status, terminationReason = '') {
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const active = (details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId)
    || details.run.batches && details.run.batches[details.run.batches.length - 1];
  if (!active || active.legacy) return details;
  const plan = currentBatchArtifact(details.run, 'plan');
  const drafts = currentBatchArtifacts(details.run, 'draft');
  const review = currentBatchArtifact(details.run, 'review');
  const internal = await runtime.artifactRecords(runtime.projectPath(options.dataRoot, options.projectId), options.runId);
  const rolling = internal.filter((artifact) => artifact.artifactType === 'rolling-state@1'
    && clean(artifact.targetRef && artifact.targetRef.batchId) === active.batchId).slice(-1)[0];
  const batchCharacters = drafts.reduce((sum, artifact) => sum + BatchSchema.countTextCharacters(artifact.content), 0);
  const batchBodyStatsChars = drafts.reduce((sum, artifact) => sum + BatchSchema.countBodyStatsCharacters(artifact.content), 0);
  const previousCumulative = (details.run.batches || [])
    .filter((batch) => batch.sequence < active.sequence)
    .reduce((maximum, batch) => Math.max(maximum, batch.cumulativeCharacters), 0);
  const previousBodyCumulative = (details.run.batches || [])
    .filter((batch) => batch.sequence < active.sequence)
    .reduce((maximum, batch) => Math.max(maximum, Number(batch.cumulativeBodyStatsChars) || 0), 0);
  const plannedCharacters = plan && plan.content && Array.isArray(plan.content.scenes)
    ? plan.content.scenes.reduce((sum, scene) => sum + (Number(scene.targetWords) || 0), 0) : active.plannedCharacters;
  await writeCreationBatch({
    ...options,
    batch: {
      ...active,
      status,
      plannedCharacters,
      planRef: artifactReference(plan),
      draftRefs: drafts.map((artifact, index) => artifactReference(artifact, { sequence: index + 1 })),
      reviewRef: artifactReference(review),
      rollingStateRef: artifactReference(rolling),
      batchCharacters,
      cumulativeCharacters: previousCumulative + batchCharacters,
      batchBodyStatsChars,
      cumulativeBodyStatsChars: previousBodyCumulative + batchBodyStatsChars,
      terminationReason,
      completedAt: status === 'completed' ? new Date().toISOString() : ''
    }
  });
  return runtime.getRun(options.dataRoot, options.projectId, options.runId);
}

async function completeCreationNode(options = {}) {
  if (options.generationFailure) return runtime.recordGenerationFailure(options);
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const nodeId = clean(options.nodeId, details.run.activeNodeId);
  if (nodeId !== 'review') {
    const completed = await runtime.completeOutputs({ ...options, nodeId });
    if (nodeId === 'plan') return syncActiveCreationBatch(options, 'planning');
    if (nodeId === 'draft') return syncActiveCreationBatch(options, 'drafting');
    return completed;
  }
  const outputs = Array.isArray(options.outputs) ? options.outputs : [options.output];
  const semantic = outputs[0] ? runtime.parseJson(outputs[0]) : { findings: [] };
  const drafts = currentBatchArtifacts(details.run, 'draft');
  const plan = currentBatchArtifact(details.run, 'plan');
  const writingInstructionsArtifact = latestByType(details.run.artifacts || [], WRITING_INSTRUCTIONS_TYPE);
  const writingInstructions = writingInstructionsArtifact && writingInstructionsArtifact.content
    ? normalizeWritingInstructions(writingInstructionsArtifact.content)
    : normalizeWritingInstructions({});
  const report = Review.reviewDraft({
    text: drafts.map((artifact) => artifact.content).join('\n\n'),
    scenes: drafts.map((artifact) => ({
      sceneId: clean(artifact.targetRef && artifact.targetRef.sceneId),
      revisionId: artifact.revision.id,
      title: artifact.title,
      text: artifact.content
    })),
    scenePlan: plan && plan.content,
    constraints: details.run.settings.constraints || [],
    writingInstructions,
    qualityTargets: writingInstructions.qualityTargets,
    semanticFulfillment: Array.isArray(semantic.planFulfillment) ? semantic.planFulfillment : []
  });
  const semanticFindings = (Array.isArray(semantic.findings) ? semantic.findings : [])
    .filter((finding) => finding && typeof finding === 'object' && clean(finding.severity).toLowerCase() !== 'pass')
    .map((finding) => Review.normalizeFinding({
      ...finding,
      source: 'ai-semantic-review',
      enforcement: finding.enforcement === 'hard' ? 'hard' : (finding.enforcement === 'soft' ? 'soft' : undefined)
    }));
  report.findings.push(...semanticFindings);
  const lastDraft = drafts[drafts.length - 1];
  const QualityMetrics = require('../../src/core/workflow/workflow-quality-metrics');
  const LockService = require('./workflow-lock-service');
  const semanticContinuity = semantic.continuityState && typeof semantic.continuityState === 'object'
    ? semantic.continuityState : {};
  const previousRolling = (details.run.artifacts || []).filter((artifact) => artifact.artifactType === 'rolling-state@1').slice(-1)[0];
  const continuityState = QualityMetrics.normalizeThreadLedger(
    previousRolling && previousRolling.content ? previousRolling.content : {},
    {
      ...semanticContinuity,
      completedSceneIds: drafts.map((artifact) => clean(artifact.targetRef && artifact.targetRef.sceneId)).filter(Boolean),
      summary: clean(semanticContinuity.summary, clean(semantic.summary, report.summary)),
      lastEnding: clean(semanticContinuity.lastEnding, typeof lastDraft?.content === 'string' ? lastDraft.content.slice(-2000) : '')
    },
    writingInstructions
  );
  const progress = details.run.generationProgress || {};
  const targetReached = progress.targetCharacters > 0
    && progress.completedCharacters >= progress.targetCharacters;
  if (targetReached || options.includeFinalThreadChecklist === true) {
    report.findings.push(...LockService.finalThreadFindings(continuityState, {}));
  }
  report.blockingFindingCount = Review.blockingFindings(report).length;
  report.qualityGate = report.blockingFindingCount ? 'blocked' : 'passed';
  report.summary = report.findings.length
    ? `发现 ${report.findings.length} 项待处理问题，其中 ${report.blockingFindingCount} 项阻断问题（含 ${semanticFindings.length} 项语义审查）`
    : clean(semantic.summary, report.summary);
  const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
  await runtime.writeArtifact(targetPath, {
    ...options, nodeId: 'review', artifactId: `review-${details.run.activeBatchId}`, artifactType: OUTPUT_TYPES.review,
    title: '自动审查报告', summary: report.summary, inputRevisionIds: drafts.map((artifact) => artifact.revision.id),
    content: report, format: 'json', reviewState: 'approved', approvedAt: new Date().toISOString(),
    targetRef: {
      batchId: details.run.activeBatchId,
      batchSequence: (details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId)?.sequence || 1
    }
  });
  await runtime.writeArtifact(targetPath, {
    ...options,
    nodeId: 'review',
    artifactId: `rolling-state-${details.run.activeBatchId}`,
    artifactType: 'rolling-state@1',
    title: `第 ${(details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId)?.sequence || 1} 批连续性状态`,
    summary: continuityState.summary,
    content: continuityState,
    format: 'json',
    reviewState: 'approved',
    approvedAt: new Date().toISOString(),
    targetRef: {
      internal: true,
      role: 'batch-continuity-state',
      batchId: details.run.activeBatchId
    }
  });
  await runtime.setNodeState(targetPath, options.runId, 'review', 'completed', true);
  await runtime.appendEvent(targetPath, options.runId, 'guided_review_completed', 'review', { findings: report.findings.length, semanticFindings: semanticFindings.length, usage: options.usage || [] });
  return syncActiveCreationBatch(options, 'waiting_decision');
}

async function approveCreationNode(options = {}) {
  const before = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const nodeId = clean(options.nodeId, before.run.activeNodeId);
  const result = await runtime.approveNode({ ...options, nodeId });
  if (nodeId === 'plan') return syncActiveCreationBatch(options, 'drafting');
  if (nodeId === 'draft') return syncActiveCreationBatch(options, 'reviewing');
  return result;
}

async function completeCreationTransfer(options = {}) {
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const blocking = Review.blockingFindings(currentBatchArtifact(details.run, 'review')?.content);
  if (blocking.length) {
    await runtime.appendEvent(runtime.projectPath(options.dataRoot, options.projectId), options.runId, 'creation_quality_gate_blocked', 'transfer', {
      action: 'complete',
      batchId: details.run.activeBatchId,
      blockingFindingCount: blocking.length,
      findingTypes: [...new Set(blocking.map((finding) => clean(finding.type)).filter(Boolean))]
    });
    throw new Error(`质量门禁未通过：当前批次仍有 ${blocking.length} 项阻断问题，请先修复并重新审查`);
  }
  await runtime.completeTransfer(options);
  return syncActiveCreationBatch(options, 'completed', clean(options.terminationReason, 'user_stopped'));
}

async function previewNextCreationBatch(options = {}) {
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  if (details.run.status === 'completed') throw new Error('已完成的从零创作运行不能继续下一批');
  const active = (details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId);
  if (!active || active.legacy) throw new Error('历史单批次运行不支持直接继续，请保留原运行并新建新版流程');
  if (details.run.activeNodeId === 'plan' && active.status === 'planning' && active.sequence > 1) {
    return { ok: true, alreadyContinued: true, currentBatch: active, nextBatch: active, progress: details.run.generationProgress };
  }
  if (details.run.activeNodeId !== 'transfer' || active.status !== 'waiting_decision') {
    throw new Error('只有完成本批审查并进入末端决策后才能继续下一批');
  }
  const review = currentBatchArtifact(details.run, 'review');
  const averageSceneCharacters = active.draftRefs.length
    ? Math.max(1, Math.round(active.batchCharacters / active.draftRefs.length))
    : 3000;
  const remaining = details.run.generationProgress.remainingBodyStatsChars != null
    ? details.run.generationProgress.remainingBodyStatsChars
    : details.run.generationProgress.remainingCharacters;
  const suggestedSceneCount = Math.max(1, Math.min(6, Math.ceil(Math.min(remaining || averageSceneCharacters * 4, averageSceneCharacters * 4) / averageSceneCharacters)));
  const blocking = Review.blockingFindings(review && review.content);
  const progress = details.run.generationProgress || {};
  const bodyDone = Number(progress.completedBodyStatsChars != null
    ? progress.completedBodyStatsChars
    : progress.completedCharacters) || 0;
  const bodyTarget = Number(progress.targetBodyStatsChars != null
    ? progress.targetBodyStatsChars
    : progress.targetCharacters) || 0;
  return {
    ok: true,
    alreadyContinued: false,
    currentBatch: active,
    nextBatch: {
      batchId: BatchSchema.batchIdForSequence(active.sequence + 1),
      sequence: active.sequence + 1,
      suggestedSceneCount,
      blueprintStage: `承接第 ${active.sequence} 批，推进故事蓝图尚未覆盖的阶段`
    },
    progress,
    // Soft target: body stats authority; never truncates text. Caller may still continue for epilogue.
    targetReached: bodyTarget > 0 && bodyDone >= bodyTarget,
    qualityGateBlocked: blocking.length > 0,
    blockingFindingCount: blocking.length,
    blockingFindings: blocking,
    requiresMajorAcknowledgement: false,
    reviewSummary: clean(review && review.content && review.content.summary)
  };
}

async function continueCreationBatch(options = {}) {
  const preview = await previewNextCreationBatch(options);
  if (preview.alreadyContinued) return runtime.getRun(options.dataRoot, options.projectId, options.runId);
  if (preview.qualityGateBlocked) {
    await runtime.appendEvent(runtime.projectPath(options.dataRoot, options.projectId), options.runId, 'creation_quality_gate_blocked', 'transfer', {
      action: 'continue',
      batchId: preview.currentBatch.batchId,
      blockingFindingCount: preview.blockingFindingCount,
      findingTypes: [...new Set(preview.blockingFindings.map((finding) => clean(finding.type)).filter(Boolean))]
    });
    throw new Error(`质量门禁未通过：当前批次仍有 ${preview.blockingFindingCount} 项阻断问题，请先修复并重新审查`);
  }
  await syncActiveCreationBatch(options, 'completed', 'continued');
  const currentDetails = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const latestInstructions = latestByType(currentDetails.run.artifacts || [], WRITING_INSTRUCTIONS_TYPE);
  await writeCreationBatch({
    ...options,
    batch: {
      ...preview.nextBatch,
      status: 'planning',
      targetCharacters: preview.progress.targetCharacters,
      cumulativeCharacters: preview.progress.completedCharacters,
      userInstruction: clean(options.userInstruction),
      writingInstructionRef: artifactReference(latestInstructions)
    }
  });
  const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
  const current = await runStore.readWorkflowV2RunState(targetPath, options.runId);
  const resetIds = new Set(['plan', 'draft', 'review', 'transfer']);
  const nodeStates = (current.nodeStates || []).map((state) => resetIds.has(state.nodeId)
    ? {
      ...state,
      executionState: state.nodeId === 'plan' ? 'ready' : 'pending',
      activeChunkId: '',
      error: null,
      startedAt: '',
      finishedAt: ''
    }
    : state);
  await runStore.writeWorkflowV2RunState(targetPath, options.runId, {
    status: 'in_progress',
    activeNodeId: 'plan',
    nodeStates,
    finishedAt: ''
  }, { expectedRevision: current.revision });
  await runtime.appendEvent(targetPath, options.runId, 'creation_batch_continued', 'plan', {
    previousBatchId: preview.currentBatch.batchId,
    batchId: preview.nextBatch.batchId,
    sequence: preview.nextBatch.sequence,
    completedCharacters: preview.progress.completedCharacters,
    targetCharacters: preview.progress.targetCharacters,
    userInstruction: clean(options.userInstruction)
  });
  return runtime.getRun(options.dataRoot, options.projectId, options.runId);
}

async function applyWritingInstructionsToCurrentBatch(options = {}) {
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const active = (details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId);
  if (!active || active.legacy) throw new Error('历史单批次运行不支持切换当前批次写作指令');
  const instructions = latestByType(details.run.artifacts || [], WRITING_INSTRUCTIONS_TYPE);
  if (!instructions) throw new Error('当前运行没有可用的全局写作指令');
  if (active.writingInstructionRef
    && active.writingInstructionRef.revisionId === instructions.revision.id) {
    return details;
  }
  const affected = (details.run.artifacts || []).filter((artifact) =>
    ['plan', 'draft', 'review'].includes(artifact.nodeId)
    && artifactBatchId(artifact) === active.batchId
    && artifact.effectiveFreshness !== 'stale'
  );
  if (affected.length && options.acknowledgeInvalidation !== true) {
    throw new Error(`应用到当前批次会使 ${affected.length} 个计划、正文或审查产物过期；请明确确认后重试`);
  }
  await writeCreationBatch({
    ...options,
    batch: {
      ...active,
      writingInstructionRef: artifactReference(instructions)
    }
  });
  const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
  await runtime.appendEvent(targetPath, options.runId, 'creation_writing_instructions_applied', details.run.activeNodeId, {
    batchId: active.batchId,
    instructionRevisionId: instructions.revision.id,
    invalidatedArtifactIds: affected.map((artifact) => artifact.id)
  });
  if (affected.length) {
    return runtime.restartFromNode({
      ...options,
      nodeId: 'plan',
      reason: '用户要求最新全局写作指令作用于当前批次'
    });
  }
  return runtime.getRun(options.dataRoot, options.projectId, options.runId);
}

async function restartCreationNode(options = {}) {
  const sceneIds = [...new Set((Array.isArray(options.sceneIds) ? options.sceneIds : [])
    .map(clean).filter(Boolean))];
  if (clean(options.nodeId) !== 'draft' || !sceneIds.length) {
    return runtime.restartFromNode(options);
  }
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const active = (details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId);
  if (!active || active.legacy) throw new Error('当前运行不支持按场景修复');
  const requested = new Set(sceneIds);
  const drafts = currentBatchArtifacts(details.run, 'draft');
  const requestedDrafts = drafts.filter((artifact) => requested.has(clean(artifact.targetRef && artifact.targetRef.sceneId)));
  if (requestedDrafts.length !== requested.size) throw new Error('一个或多个待修复场景不属于当前批次');
  const firstAffectedSequence = Math.min(...requestedDrafts.map((artifact) =>
    Number(artifact.targetRef && artifact.targetRef.sceneSequence) || Number.MAX_SAFE_INTEGER));
  const affectedDrafts = drafts.filter((artifact) => requested.has(clean(artifact.targetRef && artifact.targetRef.sceneId))
    || (Number(artifact.targetRef && artifact.targetRef.sceneSequence) || 0) > firstAffectedSequence);
  const reviewArtifacts = (details.run.artifacts || []).filter((artifact) =>
    artifact.nodeId === 'review' && artifactBatchId(artifact) === active.batchId);
  const userInstruction = clean(options.userInstruction);
  if (userInstruction) {
    await writeCreationBatch({
      ...options,
      batch: {
        ...active,
        userInstruction: [clean(active.userInstruction), `本批修复要求：${userInstruction}`].filter(Boolean).join('\n')
      }
    });
  }
  const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
  const current = await runStore.readWorkflowV2RunState(targetPath, options.runId);
  const invalidatedAt = new Date().toISOString();
  const draftRevisionIds = affectedDrafts.map((artifact) => artifact.revision.id);
  const reviewRevisionIds = reviewArtifacts.map((artifact) => artifact.revision.id);
  const nodeStates = (current.nodeStates || []).map((state) => {
    if (state.nodeId === 'draft') {
      return {
        ...state,
        executionState: 'ready',
        activeChunkId: '',
        error: null,
        finishedAt: '',
        invalidatedAt,
        invalidatedRevisionIds: [...new Set([...(state.invalidatedRevisionIds || []), ...draftRevisionIds])]
      };
    }
    if (state.nodeId === 'review') {
      return {
        ...state,
        executionState: 'pending',
        activeChunkId: '',
        error: null,
        finishedAt: '',
        invalidatedAt,
        invalidatedRevisionIds: [...new Set([...(state.invalidatedRevisionIds || []), ...reviewRevisionIds])]
      };
    }
    if (state.nodeId === 'transfer') {
      return { ...state, executionState: 'pending', activeChunkId: '', error: null, finishedAt: '' };
    }
    return state;
  });
  await runStore.writeWorkflowV2RunState(targetPath, options.runId, {
    status: 'in_progress',
    activeNodeId: 'draft',
    nodeStates,
    finishedAt: ''
  }, { expectedRevision: current.revision });
  await runtime.appendEvent(targetPath, options.runId, 'creation_scene_repair_started', 'draft', {
    batchId: active.batchId,
    sceneIds,
    dependentSceneIds: affectedDrafts.filter((artifact) => !requestedDrafts.includes(artifact))
      .map((artifact) => clean(artifact.targetRef && artifact.targetRef.sceneId)).filter(Boolean),
    invalidatedRevisionIds: draftRevisionIds,
    preservedSceneIds: drafts.filter((artifact) => !affectedDrafts.includes(artifact))
      .map((artifact) => clean(artifact.targetRef && artifact.targetRef.sceneId)).filter(Boolean),
    userInstruction
  });
  return runtime.getRun(options.dataRoot, options.projectId, options.runId);
}

async function previewChapterAssembly(options = {}) {
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const drafts = (details.run.artifacts || []).filter((artifact) => artifact.nodeId === 'draft'
    && artifact.revision && artifact.revision.reviewState === 'approved');
  const plans = (details.run.artifacts || []).filter((artifact) => artifact.nodeId === 'plan'
    && artifact.revision && artifact.revision.reviewState === 'approved');
  let assembly = ChapterAssembly.buildChapterAssembly({
    runId: options.runId,
    drafts,
    plans
  });
  if (options.assembly && typeof options.assembly === 'object') {
    assembly = ChapterAssembly.reconcileEditedAssembly(assembly, options.assembly);
  }
  const scenes = ChapterAssembly.assemblyToTransferScenes(assembly);
  return {
    ok: true,
    projectId: clean(options.projectId),
    runId: clean(options.runId),
    assembly,
    scenes,
    progress: details.run.generationProgress || {}
  };
}

module.exports = {
  STAGES, OUTPUT_TYPES, WRITING_INSTRUCTIONS_TYPE, definition, normalizeConstraints, normalizeWritingInstructions, startGuidedCreation,
  getCreationRun: runtime.getRun, prepareCreationNode, completeCreationNode,
  reviseCreationArtifact: runtime.reviseArtifact, approveCreationNode,
  getCreationArtifactHistory: runtime.getArtifactHistory,
  completeCreationTransfer, cancelCreationRun: runtime.cancelRun,
  resumeCreationRun: runtime.resumeRun,
  restartCreationNode,
  writeCreationBatch,
  decorateCreationRun,
  previewNextCreationBatch,
  continueCreationBatch,
  applyWritingInstructionsToCurrentBatch,
  previewChapterAssembly
};
