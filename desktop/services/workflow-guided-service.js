const crypto = require('crypto');
const runStore = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const inputService = require('./workflow-input-service');
const projectService = require('./project-service');
const Review = require('./workflow-review-service');
const PlanningSchema = require('../../src/core/workflow/workflow-planning-schema');
const { createGuidedRuntime } = require('./workflow-guided-runtime-service');
const generationBridge = require('./generation-bridge-service');

const STAGES = Object.freeze([
  { id: 'source', title: '来源快照', capabilityId: 'writer.snapshot', description: '冻结本次续写使用的原文范围。' },
  { id: 'analysis', title: '原文分析', capabilityId: 'analysis.extract', description: '提取分层摘要、原文大纲和人物候选。' },
  { id: 'direction', title: '续写方向', capabilityId: 'direction.design', description: '生成 2–4 个可选择、可组合的续写方向。' },
  { id: 'plan', title: '场景计划与细纲', capabilityId: 'outline.design', description: '生成可编辑的场景计划和可选细纲。' },
  { id: 'draft', title: '分场正文', capabilityId: 'draft.batch', description: '按场景逐段生成大篇幅正文。' },
  { id: 'review', title: '自动审查', capabilityId: 'review.draft', description: '检查重复、约束和基础大纲符合度。' },
  { id: 'transfer', title: '转到写作与资料库', capabilityId: 'transfer.apply', description: '预览并确认写回，或转到写作区精修。' }
]);

const OUTPUT_TYPES = Object.freeze({ analysis: 'workflow-analysis@1', direction: 'direction-set@1', plan: 'scene-plan@1', draft: 'draft-batch@1', review: 'draft-review@1' });

function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

const guidedRuntime = createGuidedRuntime({
  templateId: 'continuation-guided', stages: STAGES, outputTypes: OUTPUT_TYPES, transferNodeId: 'transfer',
  normalizeOutput(nodeId, output) {
    if (nodeId === 'draft') {
      const text = clean(output);
      if (!text) throw new Error('guided draft output must not be empty');
      return text;
    }
    const content = typeof output === 'string' ? parseJsonOutput(output) : output;
    if (nodeId === 'direction') return PlanningSchema.createDirectionSet(content);
    if (nodeId === 'plan') return PlanningSchema.createScenePlan(content);
    return content;
  }
});

function projectPath(dataRoot, projectId) { return guidedRuntime.projectPath(dataRoot, projectId); }

function normalizeConstraints(options = {}) {
  const values = Array.isArray(options.constraints) ? options.constraints : [];
  return values.map((constraint, index) => ({
    id: clean(constraint.id, `constraint-${index + 1}`),
    kind: ['direction', 'exclusion', 'fact'].includes(constraint.kind) ? constraint.kind : 'direction',
    text: clean(constraint.text),
    enforcement: constraint.enforcement === 'hard' ? 'hard' : 'soft',
    weight: Math.max(0, Math.min(2, Number(constraint.weight) || 1))
  })).filter((constraint) => constraint.text);
}

function definition(options = {}) {
  return {
    id: 'continuation-guided-definition',
    templateId: 'continuation-guided',
    templateVersion: 1,
    title: '续写作品 · 引导模式',
    description: '从写作区快照开始，依次完成人物/大纲分析、方向、场景计划、正文、审查与回流。',
    automationLevel: 'semi_automatic',
    nodes: STAGES.map((stage, index) => ({ ...stage, config: { requiresApproval: !['source', 'review'].includes(stage.id) }, position: { x: index * 240, y: 0 } })),
    edges: STAGES.slice(1).map((stage, index) => ({ id: `stage-edge-${index + 1}`, fromNodeId: STAGES[index].id, fromPortId: 'next', toNodeId: stage.id, toPortId: 'previous' })),
    settings: {
        brief: clean(options.brief),
        fineOutlineEnabled: options.fineOutlineEnabled !== false,
        constraints: normalizeConstraints(options),
        generationPolicy: options.generationPolicy || { providerProfileId: 'inherit' }
    }
  };
}

function nodeStates(activeNodeId = 'analysis') {
  return STAGES.map((stage) => ({
    nodeId: stage.id,
    executionState: stage.id === 'source' ? 'completed' : stage.id === activeNodeId ? 'ready' : 'pending'
  }));
}

async function appendEvent(targetPath, runId, type, nodeId, payload = {}) {
  return guidedRuntime.appendEvent(targetPath, runId, type, nodeId, payload);
}

async function startGuidedContinuation(options = {}) {
  if (options.dataRoot) options = await generationBridge.stampLaunchGenerationPolicy(options.dataRoot, options);
  const dataRoot = options.dataRoot;
  const projectId = clean(options.projectId);
  if (!dataRoot || !projectId) throw new Error('guided workflow dataRoot and projectId are required');
  const targetPath = projectPath(dataRoot, projectId);
  const runId = clean(options.runId, id('continuation-run'));
  if (options.readerTransfer) {
    const transferredCharacters = Number(options.readerTransfer.snapshot && options.readerTransfer.snapshot.characterCount)
      || String(options.readerTransfer.text || '').trim().length;
    if (!transferredCharacters) throw new Error('续写来源没有正文内容，请先选择或填写非空正文');
  } else {
    const sourceProject = (await projectService.openProject(dataRoot, projectId)).project;
    const sourcePreview = inputService.createSnapshot(sourceProject, options);
    if (!sourcePreview.characterCount) throw new Error('续写来源没有正文内容，请先选择包含正文的场景、章节或项目');
  }
  const created = await runStore.createWorkflowV2Run(targetPath, {
    id: runId,
    projectId,
    title: clean(options.title, '续写作品 · 引导模式'),
    status: 'in_progress',
    activeNodeId: 'analysis',
    definition: options.definitionOverride || definition(options),
    state: { status: 'in_progress', activeNodeId: 'analysis', nodeStates: nodeStates() }
  });
  const sourceOptions = {
    ...options,
    dataRoot,
    projectPath: targetPath,
    projectId,
    runId,
    nodeId: 'source',
    artifactId: options.readerTransfer && options.readerTransfer.envelope.sourceKind !== 'project' ? 'reader-source' : 'writer-source',
    revisionId: clean(options.sourceRevisionId, id('writer-source-r')),
    scope: clean(options.scope, 'chapter'),
    intent: clean(options.intent, 'continuation'),
    label: clean(options.label, '续写原文快照')
  };
  const snapshot = options.readerTransfer
    ? await inputService.createReaderTransferSourceSnapshot({ ...sourceOptions, transfer: options.readerTransfer })
    : await inputService.createWriterSourceSnapshot(sourceOptions);
  if (options.writingInstructions && typeof options.writingInstructions === 'object') {
    const CreationGuided = require('./workflow-creation-guided-service');
    await guidedRuntime.writeArtifact(targetPath, {
      projectId,
      runId,
      nodeId: 'source',
      artifactId: 'continuation-writing-instructions',
      artifactType: 'workflow-writing-instructions@1',
      revisionId: id('instructions-r'),
      title: '全局写作指令 / 质量锁',
      summary: '续写运行的全局写作与质量锁',
      content: CreationGuided.normalizeWritingInstructions(options.writingInstructions),
      format: 'json',
      reviewState: 'approved',
      approvedAt: new Date().toISOString()
    });
  }
  await appendEvent(targetPath, runId, 'guided_run_created', 'source', { scope: snapshot.snapshot.scope, characterCount: snapshot.snapshot.characterCount, readerEnvelopeId: options.readerTransfer && options.readerTransfer.envelope.envelopeId || '', freshness: options.readerTransfer && options.readerTransfer.freshness || null });
  return { ok: true, runId, summary: created.summary, snapshot: { artifactId: snapshot.artifact.family.id, revisionId: snapshot.artifact.revision.id } };
}

async function getGuidedRun(dataRoot, projectId, runId) {
  return guidedRuntime.getRun(dataRoot, projectId, runId);
}

function jsonPrompt(system, payload) {
  return { messages: [{ role: 'system', content: `${system}\n只返回合法 JSON，不要使用 Markdown 代码块。` }, { role: 'user', content: JSON.stringify(payload) }] };
}

function textPrompt(system, payload) {
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }] };
}

function latestByNode(artifacts, nodeId) {
  return artifacts.filter((artifact) => artifact.nodeId === nodeId).slice(-1)[0] || null;
}

async function prepareGuidedNode(options = {}) {
  const details = await getGuidedRun(options.dataRoot, options.projectId, options.runId);
  const run = details.run;
  const nodeId = clean(options.nodeId, run.activeNodeId);
  if (nodeId !== run.activeNodeId) throw new Error(`guided node is not active: ${nodeId}`);
  const source = latestByNode(run.artifacts, 'source');
  const analysis = latestByNode(run.artifacts, 'analysis');
  const direction = latestByNode(run.artifacts, 'direction');
  const planArtifact = latestByNode(run.artifacts, 'plan');
  const brief = run.settings && run.settings.brief || '';
  const constraints = run.settings && run.settings.constraints || [];
  if (nodeId === 'analysis') {
    return {
      ok: true,
      nodeId,
      outputFormat: 'json',
      prompts: [{
        id: 'analysis',
        prompt: jsonPrompt(
          '只分析小说原文中已经出现的内容，不得续写、预测或引入新人物与新情节。返回 hierarchicalSummary、outline、characterCandidates 三个字段；outline 只能复述原文已有事件顺序，人物候选需包含 title、aliases、summary、characterProfile。',
          { source: source.content }
        )
      }]
    };
  }
  if (nodeId === 'direction') {
    return {
      ok: true,
      nodeId,
      outputFormat: 'json',
      prompts: [{
        id: 'direction',
        prompt: jsonPrompt(
          '基于原文分析生成 2 到 4 个明显不同的续写方向。所有方向都必须遵守 constraints；kind 为 exclusion 且 enforcement 为 hard 的内容不得作为候选、风险或变体出现。返回 {directions:[{id,title,premise,plotFocus,emotionalArc,risks:[]}] }。',
          { brief, analysis: analysis && analysis.content, constraints }
        )
      }]
    };
  }
  if (nodeId === 'plan') {
    const fineOutlineEnabled = run.settings.fineOutlineEnabled !== false;
    const persistedDirectionIds = direction && direction.content && Array.isArray(direction.content.selectedDirectionIds) ? direction.content.selectedDirectionIds : [];
    const selectedDirectionIds = Array.isArray(options.selectedDirectionIds) && options.selectedDirectionIds.length ? options.selectedDirectionIds : persistedDirectionIds;
    return { ok: true, nodeId, outputFormat: 'json', prompts: [{ id: 'plan', prompt: jsonPrompt(`设计续写场景计划。fineOutline 必须是字符串数组，每项是一条可直接执行的情节动作，不得返回对象。返回 {fineOutlineEnabled:${fineOutlineEnabled},scenes:[{id,title,povCharacter,location,goal,conflict,outcome,emotionalBeat,fineOutline:["情节动作"]}] }。`, { brief, source: source.content, directions: direction && direction.content, selectedDirectionIds, fineOutlineEnabled, constraints }) }] };
  }
  if (nodeId === 'draft') {
    const plan = PlanningSchema.createScenePlan(planArtifact && planArtifact.content || {});
    return {
      ok: true,
      nodeId,
      outputFormat: 'text',
      prompts: plan.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        prompt: textPrompt('你是长篇小说作者。只输出当前场景正文，不解释，不输出标题。保持与原文文风、事实和前后场景连续，并严格遵守约束。', { brief, source: source.content, plan, currentScene: scene, constraints })
      }))
    };
  }
  if (nodeId === 'review') {
    const drafts = run.artifacts.filter((artifact) => artifact.nodeId === 'draft');
    const plan = latestByNode(run.artifacts, 'plan');
    return {
      ok: true,
      nodeId,
      outputFormat: 'json',
      prompts: [{
        id: 'semantic-review',
        title: '语义连续性审查',
        prompt: jsonPrompt('你是严苛的长篇连续性编辑，执行语义连续性审查。检查人物动机、事实衔接、时间地点、情节推进、大纲符合度和悬念泄露。返回 {summary,findings:[{type,severity,sceneTitle,evidence,suggestion}]}，没有问题时 findings 为空。', {
          source: source.content,
          plan: plan && plan.content,
          drafts: drafts.map((artifact) => ({ title: artifact.title, text: artifact.content })),
          constraints
        })
      }]
    };
  }
  throw new Error(`guided node cannot be generated: ${nodeId}`);
}

function parseJsonOutput(value) {
  const text = clean(value).replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('guided output must be a JSON object');
  return parsed;
}

function outputType(nodeId) {
  return OUTPUT_TYPES[nodeId];
}

async function setNodeState(targetPath, runId, nodeId, executionState, advance = false) {
  return guidedRuntime.setNodeState(targetPath, runId, nodeId, executionState, advance);
}

async function completeGuidedNode(options = {}) {
  if (options.generationFailure) return guidedRuntime.recordGenerationFailure(options);
  const targetPath = projectPath(options.dataRoot, options.projectId);
  const details = await getGuidedRun(options.dataRoot, options.projectId, options.runId);
  const nodeId = clean(options.nodeId, details.run.activeNodeId);
  if (nodeId !== details.run.activeNodeId) throw new Error(`guided node is not active: ${nodeId}`);
  if (nodeId === 'review') {
    const drafts = details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft');
    const plan = latestByNode(details.run.artifacts, 'plan');
    const writing = details.run.artifacts.filter((artifact) => artifact.artifactType === 'workflow-writing-instructions@1').slice(-1)[0];
    const report = Review.reviewDraft({
      text: drafts.map((artifact) => artifact.content).join('\n\n'),
      scenes: drafts.map((artifact, index) => ({
        sceneId: clean(artifact.targetRef && artifact.targetRef.sceneId, `draft-${index + 1}`),
        revisionId: artifact.revision.id,
        title: artifact.title,
        text: artifact.content
      })),
      scenePlan: plan && plan.content,
      constraints: options.constraints || details.run.settings.constraints || [],
      writingInstructions: writing && writing.content,
      qualityTargets: writing && writing.content && writing.content.qualityTargets,
      semanticFulfillment: []
    });
    const semantic = Array.isArray(options.outputs) && clean(options.outputs[0]) ? parseJsonOutput(options.outputs[0]) : null;
    const semanticFindings = semantic && Array.isArray(semantic.findings)
      ? semantic.findings.filter((finding) => finding && typeof finding === 'object' && clean(finding.severity).toLowerCase() !== 'pass').map((finding) => Review.normalizeFinding({ ...finding, source: 'ai-semantic-review' }))
      : [];
    report.findings.push(...semanticFindings);
    report.blockingFindingCount = Review.blockingFindings(report).length;
    report.qualityGate = report.blockingFindingCount ? 'blocked' : 'passed';
    report.summary = report.findings.length
      ? `发现 ${report.findings.length} 项待处理问题，其中 ${report.blockingFindingCount} 项阻断（含 ${semanticFindings.length} 项语义审查）`
      : clean(semantic && semantic.summary, report.summary);
    await artifactStore.writeArtifactRevision(targetPath, options.runId, {
      id: 'review-result', projectId: options.projectId, runId: options.runId, nodeId: 'review', artifactType: outputType('review'), title: '自动审查报告'
    }, {
      id: id('review-r'), inputRevisionIds: drafts.map((artifact) => artifact.revision.id), summary: report.summary,
      reviewState: 'approved', approvedAt: new Date().toISOString(), payload: { format: 'json' }
    }, report);
    await setNodeState(targetPath, options.runId, nodeId, 'completed', true);
    await appendEvent(targetPath, options.runId, 'guided_review_completed', nodeId, { findings: report.findings.length, semanticFindings: semanticFindings.length, usage: options.usage || [] });
    return getGuidedRun(options.dataRoot, options.projectId, options.runId);
  }
  return guidedRuntime.completeOutputs({ ...options, nodeId });
}

async function reviseArtifact(options = {}) {
  return guidedRuntime.reviseArtifact(options);
}

async function getGuidedArtifactHistory(options = {}) {
  return guidedRuntime.getArtifactHistory(options);
}

async function approveGuidedNode(options = {}) {
  return guidedRuntime.approveNode(options);
}

async function completeGuidedTransfer(options = {}) {
  const targetPath = projectPath(options.dataRoot, options.projectId);
  const summary = await runStore.getWorkflowV2RunSummary(targetPath, options.runId);
  if (!summary || summary.templateId !== 'continuation-guided') return null;
  return guidedRuntime.completeTransfer(options);
}

async function cancelGuidedRun(options = {}) {
  return guidedRuntime.cancelRun(options);
}

module.exports = {
  STAGES,
  definition,
  normalizeConstraints,
  startGuidedContinuation,
  getGuidedRun,
  prepareGuidedNode,
  completeGuidedNode,
  reviseArtifact,
  getGuidedArtifactHistory,
  approveGuidedNode,
  completeGuidedTransfer,
  cancelGuidedRun,
  resumeGuidedRun: guidedRuntime.resumeRun,
  restartGuidedNode: guidedRuntime.restartFromNode,
  parseJsonOutput
};
