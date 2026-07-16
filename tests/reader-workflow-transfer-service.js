const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const workflowGuidedService = require('../desktop/services/workflow-guided-service');
const workflowRewriteGuidedService = require('../desktop/services/workflow-rewrite-guided-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const eventStore = require('../desktop/storage/workflow-event-store-v2');
const { projectDir } = require('../desktop/storage/library-paths');
const { createReaderWorkflowTransferService } = require('../desktop/services/reader-workflow-transfer-service');

function transfer(id, sourceKind, text, destination = 'workflow') {
  return {
    envelope: {
      envelopeId: id, destination, sourceKind, documentId: sourceKind === 'project' ? 'project:source-project' : 'external-doc',
      revisionId: 'reader-r1', scope: sourceKind === 'project' ? 'scene' : 'document', sourceLocators: sourceKind === 'project' ? [{ chapterId: 'source-chapter', projectRef: { projectId: 'source-project', chapterId: 'source-chapter', sceneId: 'source-scene' } }] : [{ chapterId: 'external-chapter', blockId: 'external-block' }], lifecycle: 'active'
    },
    snapshot: { sourceTitle: `${sourceKind} source`, sections: [{ sectionId: 'source-section', title: '来源片段', chapterId: sourceKind === 'project' ? 'source-chapter' : '', sceneId: sourceKind === 'project' ? 'source-scene' : '', textStart: 0, textEnd: text.length, characterCount: text.length }] },
    text, freshness: { status: 'fresh', newerRevisionAvailable: false }
  };
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-workflow-'));
  try {
    const created = await projectService.createProject(root, { id: 'workflow-target', title: 'Workflow Target' });
    const records = new Map([
      ['project-envelope', transfer('project-envelope', 'project', '项目来源冻结正文。')],
      ['external-envelope', transfer('external-envelope', 'local-text', '外部文档冻结正文。')]
    ]);
    const materialized = [];
    const readerTransferService = {
      readTransfer: async (_, id) => records.get(id) || null,
      materializeConsumer: async (_, id, consumer) => { materialized.push({ id, consumer }); return { lifecycle: 'consumed' }; }
    };
    const service = createReaderWorkflowTransferService({ readerTransferService, projectService, workflowGuidedService, workflowRewriteGuidedService });
    const projectPreview = await service.preview(root, { envelopeId: 'project-envelope', projectId: 'workflow-target', templateId: 'continuation-guided' });
    assert.strictEqual(projectPreview.artifactType, 'writer-source@1');
    await assert.rejects(() => service.apply(root, { envelopeId: 'project-envelope', projectId: 'workflow-target', templateId: 'continuation-guided' }), /explicit confirmation/);
    const appliedProject = await service.apply(root, { envelopeId: 'project-envelope', projectId: 'workflow-target', templateId: 'continuation-guided', confirmed: true, expectedProjectUpdatedAt: projectPreview.targetProject.updatedAt, brief: '基于来源续写' });
    const targetPath = projectDir(root, 'workflow-target');
    const projectFamily = await artifactStore.readArtifactFamily(targetPath, appliedProject.runId, 'writer-source');
    assert.strictEqual(`${projectFamily.artifactType.id}@${projectFamily.artifactType.version}`, 'writer-source@1');
    assert.strictEqual(projectFamily.targetRef.envelopeId, 'project-envelope');
    const projectContent = await artifactStore.readArtifactContent(targetPath, appliedProject.runId, projectFamily.id, projectFamily.revisionIds[0]);
    assert.strictEqual(projectContent.kind, 'writer-source');
    assert.strictEqual(projectContent.content[0].sceneId, 'source-scene');
    assert.strictEqual(projectContent.sourceReferences[0].locator.projectRef.sceneId, 'source-scene');
    assert.ok((await eventStore.listWorkflowV2Events(targetPath, appliedProject.runId)).some((event) => event.payload.readerEnvelopeId === 'project-envelope'));
    const retry = await service.apply(root, { envelopeId: 'project-envelope', projectId: 'workflow-target', templateId: 'continuation-guided', confirmed: true, expectedProjectUpdatedAt: projectPreview.targetProject.updatedAt });
    assert.strictEqual(retry.idempotent, true);
    assert.strictEqual((await runStore.listWorkflowV2Runs(targetPath)).filter((run) => run.id === appliedProject.runId).length, 1);
    assert.strictEqual((await artifactStore.readArtifactFamily(targetPath, appliedProject.runId, 'writer-source')).revisionIds.length, 1);

    const externalPreview = await service.preview(root, { envelopeId: 'external-envelope', projectId: 'workflow-target', templateId: 'continuation-guided' });
    assert.strictEqual(externalPreview.artifactType, 'reader-source@1');
    await assert.rejects(() => service.preview(root, { envelopeId: 'external-envelope', projectId: 'workflow-target', templateId: 'rewrite-guided' }), /cannot use the rewrite template/);
    const appliedExternal = await service.apply(root, { envelopeId: 'external-envelope', projectId: 'workflow-target', templateId: 'continuation-guided', confirmed: true, expectedProjectUpdatedAt: externalPreview.targetProject.updatedAt });
    const externalFamily = await artifactStore.readArtifactFamily(targetPath, appliedExternal.runId, 'reader-source');
    assert.strictEqual(`${externalFamily.artifactType.id}@${externalFamily.artifactType.version}`, 'reader-source@1');
    const externalContent = await artifactStore.readArtifactContent(targetPath, appliedExternal.runId, externalFamily.id, externalFamily.revisionIds[0]);
    assert.strictEqual(externalContent.kind, 'reader-source');
    assert.ok(!Object.prototype.hasOwnProperty.call(externalContent.content[0], 'sceneId'), 'external sources must not pretend to be project scenes');
    assert.strictEqual(externalContent.content[0].content, '外部文档冻结正文。');

    records.delete('external-envelope');
    assert.ok(await runStore.readWorkflowV2Run(targetPath, appliedExternal.runId), 'workflow run must survive Reader source deletion');
    assert.strictEqual((await artifactStore.readArtifactContent(targetPath, appliedExternal.runId, externalFamily.id, externalFamily.revisionIds[0])).content[0].content, '外部文档冻结正文。');
    const opened = (await projectService.openProject(root, created.project.id)).project;
    await projectService.saveProject(root, { ...opened, description: 'unrelated project save' });
    assert.ok(await runStore.readWorkflowV2Run(targetPath, appliedExternal.runId), 'ordinary project save must not overwrite workflow v2 runs');
    assert.strictEqual(materialized.length, 3, 'successful retries may reassert the same immutable consumer without creating another run');
    console.log('reader workflow transfer service tests passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
