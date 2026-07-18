const crypto = require('crypto');
const runStore = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const eventStore = require('../storage/workflow-event-store-v2');
const inputService = require('./workflow-input-service');
const { projectDir } = require('../storage/library-paths');

function clean(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function stableId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`; }
const TEMPLATES = Object.freeze({
  'continuation-guided': { intent: 'continue', title: '续写作品 · Reader 来源', service: 'continuation' },
  'rewrite-guided': { intent: 'rewrite', title: '大段重写 · Reader 来源', service: 'rewrite', projectOnly: true }
});

function createReaderWorkflowTransferService(dependencies = {}) {
  const { readerTransferService, projectService, workflowGuidedService, workflowRewriteGuidedService } = dependencies;
  if (!readerTransferService || !projectService || !workflowGuidedService || !workflowRewriteGuidedService) throw new Error('reader workflow transfer dependencies are required');

  async function preview(dataRoot, request = {}) {
    const envelopeId = clean(request.envelopeId); const projectId = clean(request.projectId);
    const templateId = clean(request.templateId, 'continuation-guided'); const template = TEMPLATES[templateId];
    if (!envelopeId || !projectId) throw new Error('reader workflow envelopeId and projectId are required');
    if (!template) throw new Error(`reader workflow template is not supported: ${templateId}`);
    const transfer = await readerTransferService.readTransfer(dataRoot, envelopeId);
    if (!transfer || transfer.envelope.destination !== 'workflow') throw new Error('reader transfer destination must be workflow');
    if (template.projectOnly && transfer.envelope.sourceKind !== 'project') throw new Error('external Reader sources cannot use the rewrite template because they are not project scenes');
    const locatedSceneIds = [...new Set((transfer.envelope.sourceLocators || []).map((locator) => locator.projectRef && locator.projectRef.sceneId).filter(Boolean))];
    if (templateId === 'rewrite-guided' && locatedSceneIds.length !== 1) throw new Error('Reader rewrite requires one explicitly located project scene; chapter or project aggregates remain reference input');
    const project = (await projectService.openProject(dataRoot, projectId)).project;
    const applicationId = clean(request.applicationId) || stableId('reader-workflow-application', `${envelopeId}:${projectId}:${templateId}`);
    const runId = clean(request.runId) || stableId('reader-workflow-run', applicationId);
    const existing = await runStore.readWorkflowV2Run(projectDir(dataRoot, projectId), runId);
    const conflicts = [];
    if (transfer.freshness.status === 'stale') conflicts.push('原项目来源已变化；运行仍将使用 Envelope 创建时的冻结快照');
    if (transfer.freshness.status === 'missing') conflicts.push('原来源已缺失；运行仍将使用 Envelope 中的冻结快照');
    if (transfer.freshness.newerRevisionAvailable) conflicts.push('书库存在较新 Revision；不会静默替换当前快照');
    if (existing) conflicts.push('相同 Envelope、项目和模板已经创建运行；再次确认只会重开现有运行');
    return {
      applicationId, runId, envelope: transfer.envelope, freshness: transfer.freshness,
      sourceTitle: transfer.snapshot.sourceTitle, sourceKind: transfer.envelope.sourceKind,
      sections: transfer.snapshot.sections.map((section) => ({ sectionId: section.sectionId, title: section.title, characterCount: section.characterCount })),
      targetProject: { id: project.id, title: project.title, updatedAt: project.updatedAt },
      templateId, intent: template.intent, templateTitle: template.title, existingRun: !!existing, conflicts,
      artifactType: transfer.envelope.sourceKind === 'project' ? 'writer-source@1' : 'reader-source@1'
    };
  }

  async function ensureExistingSource(dataRoot, prepared, transfer) {
    const targetPath = projectDir(dataRoot, prepared.targetProject.id);
    const artifactId = prepared.templateId === 'rewrite-guided' ? 'rewrite-source' : transfer.envelope.sourceKind === 'project' ? 'writer-source' : 'reader-source';
    const family = await artifactStore.readArtifactFamily(targetPath, prepared.runId, artifactId);
    if (family) {
      if (family.targetRef.envelopeId !== prepared.envelope.envelopeId) throw new Error('reader workflow run source identity conflict');
      return { artifactId: family.id, revisionId: family.revisionIds[family.revisionIds.length - 1] };
    }
    const snapshot = await inputService.createReaderTransferSourceSnapshot({
      projectPath: targetPath, projectId: prepared.targetProject.id, runId: prepared.runId, transfer,
      artifactId, revisionId: stableId('reader-source-revision', prepared.applicationId), intent: prepared.intent, label: prepared.sourceTitle
    });
    await eventStore.appendWorkflowV2Event(targetPath, prepared.runId, {
      id: stableId('reader-workflow-event', `${prepared.applicationId}:source-recovered`), type: 'reader_source_materialized', nodeId: 'source',
      payload: { envelopeId: prepared.envelope.envelopeId, sourceKind: prepared.sourceKind, freshness: prepared.freshness }
    });
    return { artifactId: snapshot.artifact.family.id, revisionId: snapshot.artifact.revision.id };
  }

  async function apply(dataRoot, request = {}) {
    if (request.confirmed !== true) throw new Error('reader workflow application requires explicit confirmation');
    const prepared = await preview(dataRoot, request);
    const transfer = await readerTransferService.readTransfer(dataRoot, prepared.envelope.envelopeId);
    const currentProject = (await projectService.openProject(dataRoot, prepared.targetProject.id)).project;
    if (clean(request.expectedProjectUpdatedAt || prepared.targetProject.updatedAt) !== currentProject.updatedAt) throw new Error('target project changed after Reader workflow preview');
    const targetPath = projectDir(dataRoot, prepared.targetProject.id);
    let run = await runStore.readWorkflowV2Run(targetPath, prepared.runId);
    let snapshot;
    if (!run) {
      const options = {
        dataRoot, projectId: prepared.targetProject.id, runId: prepared.runId, title: clean(request.title, prepared.templateTitle),
        brief: prepared.templateId === 'rewrite-guided' ? { instruction: clean(request.brief) || '基于 Reader 冻结快照进行重写' } : clean(request.brief), scope: prepared.envelope.scope, intent: prepared.intent, readerTransfer: transfer,
        sourceRevisionId: stableId('reader-source-revision', prepared.applicationId), label: prepared.sourceTitle
      };
      snapshot = prepared.templateId === 'rewrite-guided'
        ? await workflowRewriteGuidedService.startGuidedRewrite(options)
        : await workflowGuidedService.startGuidedContinuation(options);
      run = await runStore.readWorkflowV2Run(targetPath, prepared.runId);
    } else {
      if (run.summary.templateId !== prepared.templateId) throw new Error('reader workflow run template identity conflict');
      snapshot = { ok: true, runId: prepared.runId, snapshot: await ensureExistingSource(dataRoot, prepared, transfer) };
    }
    const now = clean(request.appliedAt) || new Date().toISOString();
    await readerTransferService.materializeConsumer(dataRoot, prepared.envelope.envelopeId, {
      consumerId: `workflow-run:${prepared.runId}`, destination: 'workflow', referenceId: `workflow:${prepared.targetProject.id}:${prepared.runId}`,
      createdAt: now, materializedAt: now
    });
    return {
      ok: true, applied: true, idempotent: prepared.existingRun, projectId: prepared.targetProject.id,
      runId: prepared.runId, templateId: prepared.templateId, snapshot: snapshot.snapshot, summary: run.summary
    };
  }

  return { preview, apply, TEMPLATES };
}

module.exports = { createReaderWorkflowTransferService, stableId, TEMPLATES };
