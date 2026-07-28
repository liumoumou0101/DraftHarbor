const crypto = require('crypto');
const runStore = require('../storage/workflow-run-store-v2');
const CreationSchema = require('../../src/core/workflow/workflow-creation-schema');
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

function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function latest(artifacts, nodeId) { return artifacts.filter((artifact) => artifact.nodeId === nodeId).slice(-1)[0] || null; }
function normalizeConstraints(options = {}) {
  return (Array.isArray(options.constraints) ? options.constraints : []).map((constraint, index) => ({
    id: clean(constraint.id, `constraint-${index + 1}`),
    kind: ['direction', 'exclusion', 'fact'].includes(constraint.kind) ? constraint.kind : 'direction',
    text: clean(constraint.text), enforcement: constraint.enforcement === 'hard' ? 'hard' : 'soft',
    weight: Math.max(0, Math.min(5, Number(constraint.weight) || 1))
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
  normalizeOutput(nodeId, output, options) {
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
  const context = {
    projectId: options.projectId,
    brief: latest(artifacts, 'brief') && latest(artifacts, 'brief').content,
    directions: directionArtifact && directionArtifact.content,
    selectedDirectionIds,
    blueprint: latest(artifacts, 'blueprint') && latest(artifacts, 'blueprint').content,
    compendium: latest(artifacts, 'compendium') && latest(artifacts, 'compendium').content,
    scenePlan: latest(artifacts, 'plan') && latest(artifacts, 'plan').content,
    constraints: details.run.settings.constraints || [],
    fineOutlineEnabled: details.run.settings.fineOutlineEnabled !== false
  };
  if (nodeId === 'review') {
    const drafts = artifacts.filter((artifact) => artifact.nodeId === 'draft');
    return {
      ok: true, nodeId, outputFormat: 'json', prompts: [{
        id: 'creation-semantic-review', title: '新作语义连续性审查',
        prompt: { messages: [
          { role: 'system', content: '你是严苛的长篇连续性编辑。检查正文对故事蓝图、人物资料、世界规则、场景计划、人物动机和情绪节奏的遵守情况。只返回合法 JSON：{summary,findings:[{type,severity,sceneTitle,evidence,suggestion}]}。' },
          { role: 'user', content: JSON.stringify({ ...context, drafts: drafts.map((artifact) => ({ title: artifact.title, text: artifact.content })) }) }
        ] }
      }]
    };
  }
  const prepared = CreationService.prepareCreationStage(nodeId, context);
  return { ok: true, nodeId, ...prepared };
}

async function completeCreationNode(options = {}) {
  if (options.generationFailure) return runtime.recordGenerationFailure(options);
  const details = await runtime.getRun(options.dataRoot, options.projectId, options.runId);
  const nodeId = clean(options.nodeId, details.run.activeNodeId);
  if (nodeId !== 'review') return runtime.completeOutputs({ ...options, nodeId });
  const outputs = Array.isArray(options.outputs) ? options.outputs : [options.output];
  const semantic = outputs[0] ? runtime.parseJson(outputs[0]) : { findings: [] };
  const drafts = details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft');
  const plan = latest(details.run.artifacts, 'plan');
  const report = Review.reviewDraft({ text: drafts.map((artifact) => artifact.content).join('\n\n'), scenePlan: plan && plan.content, constraints: details.run.settings.constraints || [] });
  const semanticFindings = (Array.isArray(semantic.findings) ? semantic.findings : [])
    .filter((finding) => finding && typeof finding === 'object' && clean(finding.severity).toLowerCase() !== 'pass')
    .map((finding) => ({ ...finding, source: 'ai-semantic-review' }));
  report.findings.push(...semanticFindings);
  report.summary = report.findings.length ? `发现 ${report.findings.length} 项待处理问题（含 ${semanticFindings.length} 项语义审查）` : clean(semantic.summary, report.summary);
  const targetPath = runtime.projectPath(options.dataRoot, options.projectId);
  await runtime.writeArtifact(targetPath, {
    ...options, nodeId: 'review', artifactId: 'review-result', artifactType: OUTPUT_TYPES.review,
    title: '自动审查报告', summary: report.summary, inputRevisionIds: drafts.map((artifact) => artifact.revision.id),
    content: report, format: 'json', reviewState: 'approved', approvedAt: new Date().toISOString()
  });
  await runtime.setNodeState(targetPath, options.runId, 'review', 'completed', true);
  await runtime.appendEvent(targetPath, options.runId, 'guided_review_completed', 'review', { findings: report.findings.length, semanticFindings: semanticFindings.length, usage: options.usage || [] });
  return runtime.getRun(options.dataRoot, options.projectId, options.runId);
}

module.exports = {
  STAGES, OUTPUT_TYPES, definition, normalizeConstraints, startGuidedCreation,
  getCreationRun: runtime.getRun, prepareCreationNode, completeCreationNode,
  reviseCreationArtifact: runtime.reviseArtifact, approveCreationNode: runtime.approveNode,
  completeCreationTransfer: runtime.completeTransfer, cancelCreationRun: runtime.cancelRun,
  resumeCreationRun: runtime.resumeRun,
  restartCreationNode: runtime.restartFromNode
};
