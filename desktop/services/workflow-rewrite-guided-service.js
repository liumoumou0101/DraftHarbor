const crypto = require('crypto');
const runStore = require('../storage/workflow-run-store-v2');
const inputService = require('./workflow-input-service');
const RewriteService = require('./workflow-rewrite-service');
const RewriteSchema = require('../../src/core/workflow/workflow-rewrite-schema');
const { createGuidedRuntime } = require('./workflow-guided-runtime-service');
const generationBridge = require('./generation-bridge-service');

const STAGES = Object.freeze([
  { id: 'source', title: '重写来源快照', capabilityId: 'writer.snapshot', description: '冻结本次重写的选区、场景或章节。' },
  { id: 'plan', title: '可编辑重写计划', capabilityId: 'rewrite.plan', description: '定义保留、删除、压缩、扩写、换序和风格规则。' },
  { id: 'rewrite', title: '分场景大段重写', capabilityId: 'rewrite.batch', description: '按计划逐个语义单元重写。' },
  { id: 'repair', title: '衔接修复与差异', capabilityId: 'rewrite.repair', description: '修复单元间连续性并生成逐场景差异。' },
  { id: 'review', title: '重写审查', capabilityId: 'review.rewrite', description: '检查事实保留、删除要求、连续性和计划遵守情况。' },
  { id: 'transfer', title: '选择场景并回流写作区', capabilityId: 'transfer.update', description: '逐场景预览并确认更新，或转到写作区继续精修。' }
]);

const OUTPUT_TYPES = Object.freeze({ plan: 'rewrite-plan@1', rewrite: 'rewrite-text@1', repair: 'rewrite-text@1', review: 'rewrite-review@1' });
const SOURCE_SNAPSHOT_TYPES = Object.freeze(['writer-source@1', 'reader-source@1']);
function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function latest(artifacts, nodeId) { return artifacts.filter((artifact) => artifact.nodeId === nodeId).slice(-1)[0] || null; }

/** Original snapshot only — never confuse with writing-instructions on the same nodeId. */
function sourceSnapshotArtifact(artifacts = []) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  const byType = list.filter((artifact) => SOURCE_SNAPSHOT_TYPES.includes(clean(artifact && artifact.artifactType)));
  if (byType.length) return byType[byType.length - 1];
  return list.find((artifact) => artifact && artifact.id === 'rewrite-source') || null;
}

function writingInstructionsArtifact(artifacts = []) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  return list.filter((artifact) => clean(artifact && artifact.artifactType) === 'workflow-writing-instructions@1').slice(-1)[0] || null;
}

const runtime = createGuidedRuntime({
  templateId: 'rewrite-guided', stages: STAGES, outputTypes: OUTPUT_TYPES, transferNodeId: 'transfer',
  normalizeOutput(nodeId, output, options) {
    return RewriteService.normalizeRewriteOutput(nodeId, output, options);
  }
});

function normalizeConstraints(options = {}) {
  return (Array.isArray(options.constraints) ? options.constraints : []).map((constraint, index) => ({
    id: clean(constraint.id, `rewrite-constraint-${index + 1}`),
    kind: ['direction', 'exclusion', 'fact'].includes(constraint.kind) ? constraint.kind : 'direction',
    text: clean(constraint.text), enforcement: constraint.enforcement === 'hard' ? 'hard' : 'soft',
    weight: Math.max(0, Math.min(5, Number(constraint.weight) || 1))
  })).filter((constraint) => constraint.text);
}

function definition(options = {}) {
  return {
    id: 'rewrite-guided-definition', templateId: 'rewrite-guided', templateVersion: 1,
    title: '大段重写 · 引导模式', description: '冻结原文，确认重写计划，分场景重写、衔接修复、差异审查并选择回流。',
    automationLevel: 'semi_automatic',
    nodes: STAGES.map((stage, index) => ({ ...stage, config: { requiresApproval: !['source', 'review'].includes(stage.id) }, position: { x: index * 240, y: 0 } })),
    edges: STAGES.slice(1).map((stage, index) => ({ id: `rewrite-edge-${index + 1}`, fromNodeId: STAGES[index].id, fromPortId: 'next', toNodeId: stage.id, toPortId: 'previous' })),
    settings: { brief: options.brief || {}, constraints: normalizeConstraints(options), generationPolicy: options.generationPolicy || { providerProfileId: 'inherit' } }
  };
}

function nodeStates() {
  return STAGES.map((stage) => ({ nodeId: stage.id, executionState: stage.id === 'source' ? 'completed' : stage.id === 'plan' ? 'ready' : 'pending' }));
}

async function startGuidedRewrite(options = {}) {
  if (options.dataRoot) options = await generationBridge.stampLaunchGenerationPolicy(options.dataRoot, options);
  const projectId = clean(options.projectId);
  if (!options.dataRoot || !projectId) throw new Error('rewrite workflow dataRoot and projectId are required');
  const runId = clean(options.runId, id('rewrite-run'));
  const brief = RewriteSchema.createRewriteBrief(options.brief || options);
  const targetPath = runtime.projectPath(options.dataRoot, projectId);
  const created = await runStore.createWorkflowV2Run(targetPath, {
    id: runId, projectId, title: clean(options.title, '大段重写 · 引导模式'), status: 'in_progress', activeNodeId: 'plan',
    definition: options.definitionOverride || definition({ ...options, brief }), state: { status: 'in_progress', activeNodeId: 'plan', nodeStates: nodeStates() }
  });
  const sourceOptions = {
    ...options, projectPath: targetPath, projectId, runId, nodeId: 'source', artifactId: 'rewrite-source', revisionId: clean(options.sourceRevisionId, id('rewrite-source-r')),
    scope: clean(options.scope, 'chapter'), intent: 'rewrite', label: clean(options.label, '大段重写原文快照')
  };
  const snapshot = options.readerTransfer
    ? await inputService.createReaderTransferSourceSnapshot({ ...sourceOptions, transfer: options.readerTransfer })
    : await inputService.createWriterSourceSnapshot(sourceOptions);
  if (options.writingInstructions && typeof options.writingInstructions === 'object') {
    const CreationGuided = require('./workflow-creation-guided-service');
    // Keep on source stage for UI listing, but never use as snapshot: look up by artifactType.
    await runtime.writeArtifact(targetPath, {
      projectId,
      runId,
      nodeId: 'source',
      artifactId: 'rewrite-writing-instructions',
      artifactType: 'workflow-writing-instructions@1',
      revisionId: id('instructions-r'),
      title: '全局写作指令 / 质量锁',
      summary: '重写运行的全局写作与质量锁',
      targetRef: { role: 'writing-instructions', internal: false },
      content: CreationGuided.normalizeWritingInstructions(options.writingInstructions),
      format: 'json',
      reviewState: 'approved',
      approvedAt: new Date().toISOString()
    });
  }
  await runtime.appendEvent(targetPath, runId, 'rewrite_run_created', 'source', { scope: snapshot.snapshot.scope, characterCount: snapshot.snapshot.characterCount, sceneCount: snapshot.snapshot.content.length, readerEnvelopeId: options.readerTransfer && options.readerTransfer.envelope.envelopeId || '', freshness: options.readerTransfer && options.readerTransfer.freshness || null });
  return { ok: true, runId, summary: created.summary, snapshot: { artifactId: snapshot.artifact.family.id, revisionId: snapshot.artifact.revision.id } };
}

async function prepareRewriteNode(options = {}) {
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const nodeId = clean(options.nodeId, details.run.activeNodeId);
  if (nodeId !== details.run.activeNodeId) throw new Error(`guided node is not active: ${nodeId}`);
  const source = sourceSnapshotArtifact(details.run.artifacts);
  if (!source) throw new Error('rewrite source snapshot not found');
  const plan = latest(details.run.artifacts, 'plan');
  const rewriteArtifacts = details.run.artifacts.filter((artifact) => artifact.nodeId === 'rewrite');
  if (nodeId === 'review') {
    const repaired = details.run.artifacts.filter((artifact) => artifact.nodeId === 'repair' && artifact.artifactType === 'rewrite-text@1');
    return { ok: true, nodeId, outputFormat: 'json', prompts: [{
      id: 'rewrite-semantic-review', title: '重写语义审查',
      prompt: { messages: [
        { role: 'system', content: '你是严苛的长篇重写审查编辑。检查重写计划遵守、必须保留事实、必须删除元素、人物状态、时间地点、因果和前后衔接。只返回合法 JSON：{summary,findings:[{type,severity,sceneTitle,evidence,suggestion}]}。' },
        { role: 'user', content: JSON.stringify({ brief: details.run.settings.brief, source: source.content, plan: plan.content, repaired: repaired.map((artifact) => ({ title: artifact.title, text: artifact.content })), constraints: details.run.settings.constraints }) }
      ] }
    }] };
  }
  const prepared = RewriteService.prepareRewriteStage(nodeId, {
    sourceSnapshot: source.content,
    sourceRevisionId: source.revision.id,
    brief: details.run.settings.brief,
    constraints: details.run.settings.constraints,
    plan: plan && plan.content,
    rewrites: rewriteArtifacts.map((artifact) => ({ unitId: artifact.id.replace(/^rewrite-result-/, ''), text: artifact.content }))
  });
  return { ok: true, nodeId, ...prepared };
}

async function completeRewriteNode(options = {}) {
  if (options.generationFailure) return runtime.recordGenerationFailure(options);
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const nodeId = clean(options.nodeId, details.run.activeNodeId);
  const source = sourceSnapshotArtifact(details.run.artifacts);
  if (!source) throw new Error('rewrite source snapshot not found');
  const planArtifact = latest(details.run.artifacts, 'plan');
  if (nodeId === 'review') {
    const parsed = RewriteService.parseJson((options.outputs || [options.output])[0] || '{}');
    const semanticFindings = Array.isArray(parsed.findings)
      ? parsed.findings.filter((item) => item && typeof item === 'object' && clean(item.severity).toLowerCase() !== 'pass')
      : [];
    const comparison = details.run.artifacts.find((artifact) => artifact.nodeId === 'repair' && artifact.artifactType === 'rewrite-comparison@1');
    const repaired = details.run.artifacts.filter((artifact) => artifact.nodeId === 'repair' && artifact.artifactType === 'rewrite-text@1');
    const writing = writingInstructionsArtifact(details.run.artifacts);
    const Review = require('./workflow-review-service');
    const qualityReport = Review.reviewDraft({
      text: repaired.map((artifact) => artifact.content).join('\n\n'),
      scenes: repaired.map((artifact, index) => ({
        sceneId: clean(artifact.targetRef && artifact.targetRef.sceneId, `rewrite-${index + 1}`),
        revisionId: artifact.revision.id,
        title: artifact.title,
        text: artifact.content
      })),
      constraints: details.run.settings.constraints || [],
      writingInstructions: writing && writing.content,
      qualityTargets: writing && writing.content && writing.content.qualityTargets
    });
    const findings = [
      ...(qualityReport.findings || []),
      ...semanticFindings.map((item) => Review.normalizeFinding({ ...item, source: 'ai-semantic-review' }))
    ];
    const blocked = findings.filter((item) => Review.isBlockingFinding(item));
    const report = {
      schemaVersion: 1,
      kind: 'rewrite-review',
      summary: clean(parsed.summary, findings.length ? `发现 ${findings.length} 项问题，其中 ${blocked.length} 项阻断` : '重写审查通过'),
      findings,
      blockingFindingCount: blocked.length,
      qualityGate: blocked.length ? 'blocked' : 'passed',
      metrics: qualityReport.metrics,
      qualityTargetsSnapshot: qualityReport.qualityTargetsSnapshot,
      comparisonSummary: comparison ? comparison.content.comparisons.map((item) => ({ targetSceneId: item.result.targetSceneId, characterDelta: item.diff.characterDelta, counts: item.diff.counts })) : []
    };
    const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
    await runtime.writeArtifact(targetPath, { ...options, nodeId: 'review', artifactId: 'rewrite-review', artifactType: OUTPUT_TYPES.review, title: '重写审查报告', content: report, format: 'json', reviewState: 'approved', approvedAt: new Date().toISOString() });
    await runtime.setNodeState(targetPath, options.runId, 'review', 'completed', true);
    await runtime.appendEvent(targetPath, options.runId, 'rewrite_review_completed', 'review', { findings: findings.length, usage: options.usage || [] });
    return runtime.getRun(options.dataRoot, options.projectId, options.runId);
  }
  const completed = await runtime.completeOutputs({ ...options, nodeId, sourceSnapshot: source.content, sourceRevisionId: source.revision.id });
  if (nodeId !== 'repair') return completed;
  const plan = planArtifact.content;
  const repaired = completed.run.artifacts.filter((artifact) => artifact.nodeId === 'repair' && artifact.artifactType === 'rewrite-text@1');
  const comparison = RewriteService.buildComparison(source.content, plan, repaired.map((artifact) => artifact.content), { sourceSnapshot: source.content, repairApplied: true });
  const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
  await runtime.writeArtifact(targetPath, {
    ...options, nodeId: 'repair', artifactId: 'rewrite-comparison', artifactType: 'rewrite-comparison@1', title: '逐场景重写差异',
    content: comparison, format: 'json', reviewState: 'approved', approvedAt: new Date().toISOString()
  });
  await runtime.appendEvent(targetPath, options.runId, 'rewrite_comparison_created', 'repair', { sceneCount: comparison.comparisons.length });
  return runtime.getRun(options.dataRoot, options.projectId, options.runId);
}

async function completeRewriteTransfer(options = {}) {
  const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
  const summary = await runStore.getWorkflowV2RunSummary(targetPath, options.runId);
  if (!summary || summary.templateId !== 'rewrite-guided') return null;
  return runtime.completeTransfer(options);
}

module.exports = {
  STAGES, OUTPUT_TYPES, SOURCE_SNAPSHOT_TYPES, definition, normalizeConstraints, startGuidedRewrite,
  sourceSnapshotArtifact, writingInstructionsArtifact,
  getRewriteRun: runtime.getRun, prepareRewriteNode, completeRewriteNode,
  reviseRewriteArtifact: runtime.reviseArtifact, getRewriteArtifactHistory: runtime.getArtifactHistory, approveRewriteNode: runtime.approveNode,
  completeRewriteTransfer, cancelRewriteRun: runtime.cancelRun,
  resumeRewriteRun: runtime.resumeRun,
  restartRewriteNode: runtime.restartFromNode
};
