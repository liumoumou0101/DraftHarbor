const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const ReaderSchema = require('../src/core/document/reader-document-schema');
const readerStore = require('../desktop/storage/reader-document-store');
const transferStore = require('../desktop/storage/reader-transfer-store');
const projectStore = require('../desktop/storage/project-file-store');
const libraryPaths = require('../desktop/storage/library-paths');
const projectService = require('../desktop/services/project-service');
const { createReaderTransferService } = require('../desktop/services/reader-transfer-service');
const { createReaderWriterTransferService } = require('../desktop/services/reader-writer-transfer-service');

function revision() {
  return ReaderSchema.createReaderDocumentRevision({
    revisionId: 'writer-source-r1', createdAt: '2026-07-16T13:00:00.000Z',
    chapters: [
      { chapterId: 'source-c1', title: '来源一', blocks: [{ blockId: 'source-b1', type: 'paragraph', text: '导入正文一。' }] },
      { chapterId: 'source-c2', title: '来源二', blocks: [{ blockId: 'source-b2', type: 'paragraph', text: '导入正文二。' }] }
    ]
  }, { digest: readerStore.sha256 });
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-writer-'));
  try {
    const transferService = createReaderTransferService({ transferStore, readerStore, projectStore });
    const sourceRevision = revision();
    const document = ReaderSchema.createReaderDocument({
      documentId: 'writer-source', sourceKind: 'local-text', format: 'md', title: '导入来源',
      importedAt: '2026-07-16T13:00:00.000Z', updatedAt: '2026-07-16T13:00:00.000Z',
      activeRevisionId: sourceRevision.revisionId, revisions: [sourceRevision]
    }, { digest: readerStore.sha256 });
    await readerStore.createReaderDocument(dataRoot, document);
    const createEnvelope = async (id, scope = 'document') => {
      return transferService.createTransferFromRange(dataRoot, {
        envelopeId: id, destination: 'writer', documentId: document.documentId, revisionId: sourceRevision.revisionId,
        sourceRevisionDigest: sourceRevision.contentDigest, scope,
        chapterId: scope === 'chapter' ? 'source-c1' : undefined,
        createdAt: '2026-07-16T13:01:00.000Z'
      });
    };
    await createEnvelope('writer-append-envelope', 'chapter');
    await createEnvelope('writer-new-scenes-envelope');
    await createEnvelope('writer-new-project-envelope');
    await createEnvelope('writer-conflict-envelope', 'chapter');
    await createEnvelope('writer-failed-new-project-envelope', 'chapter');

    const createdTarget = await projectService.createProject(dataRoot, { id: 'writer-target', title: '写作目标' });
    const targetSceneId = createdTarget.project.scenes[0].id;
    await projectService.saveProject(dataRoot, {
      ...createdTarget.project,
      scenes: createdTarget.project.scenes.map((scene) => scene.id === targetSceneId ? { ...scene, content: '原正文。' } : scene)
    });
    const backups = [];
    const writerService = createReaderWriterTransferService({
      readerTransferService: transferService,
      projectService,
      createBackup: async (_root, projectId) => {
        const current = (await projectService.openProject(dataRoot, projectId)).project;
        backups.push(structuredClone(current));
        return { backup: { backupId: `backup-${backups.length}.json`, path: `backups/${projectId}` } };
      }
    });

    const preview = await writerService.preview(dataRoot, {
      envelopeId: 'writer-append-envelope', applicationId: 'append-application', intent: 'append',
      targetProjectId: 'writer-target', targetSceneId
    });
    assert.strictEqual(preview.items[0].text, '导入正文一。');
    assert.ok(preview.conflicts.some((item) => item.includes('追加')));
    const beforeConfirm = await projectService.openProject(dataRoot, 'writer-target');
    await assert.rejects(() => writerService.apply(dataRoot, {
      envelopeId: 'writer-append-envelope', applicationId: 'append-application', intent: 'append',
      targetProjectId: 'writer-target', targetSceneId, expectedTargetUpdatedAt: preview.targetProject.updatedAt
    }), /explicit confirmation/);
    assert.deepStrictEqual((await projectService.openProject(dataRoot, 'writer-target')).project, beforeConfirm.project, 'preview without confirmation must not change disk');

    const applied = await writerService.apply(dataRoot, {
      envelopeId: 'writer-append-envelope', applicationId: 'append-application', intent: 'append', confirmed: true,
      targetProjectId: 'writer-target', targetSceneId, expectedTargetUpdatedAt: preview.targetProject.updatedAt,
      appliedAt: '2026-07-16T13:10:00.000Z'
    });
    assert.strictEqual(applied.idempotent, false);
    const afterAppend = (await projectService.openProject(dataRoot, 'writer-target')).project;
    assert.strictEqual(afterAppend.scenes.find((scene) => scene.id === targetSceneId).content, '原正文。\n\n导入正文一。');
    assert.strictEqual(afterAppend.scenes.find((scene) => scene.id === targetSceneId).sourceReferences[0].envelopeId, 'writer-append-envelope');
    assert.strictEqual(backups.length, 1, 'formal update must create one backup before writing');
    const retried = await writerService.apply(dataRoot, {
      envelopeId: 'writer-append-envelope', applicationId: 'append-application', intent: 'append', confirmed: true,
      targetProjectId: 'writer-target', targetSceneId, expectedTargetUpdatedAt: afterAppend.updatedAt,
      appliedAt: '2026-07-16T13:11:00.000Z'
    });
    assert.strictEqual(retried.idempotent, true);
    assert.strictEqual((await projectService.openProject(dataRoot, 'writer-target')).project.scenes.find((scene) => scene.id === targetSceneId).content, '原正文。\n\n导入正文一。', 'retry must not append twice');
    assert.strictEqual(backups.length, 1, 'idempotent retry must not create another backup');

    const scenePreview = await writerService.preview(dataRoot, {
      envelopeId: 'writer-new-scenes-envelope', applicationId: 'scene-application', intent: 'new-scenes', targetProjectId: 'writer-target'
    });
    const sceneApplied = await writerService.apply(dataRoot, {
      envelopeId: 'writer-new-scenes-envelope', applicationId: 'scene-application', intent: 'new-scenes', confirmed: true,
      targetProjectId: 'writer-target', targetChapterId: scenePreview.targetChapterId, expectedTargetUpdatedAt: scenePreview.targetProject.updatedAt,
      appliedAt: '2026-07-16T13:20:00.000Z'
    });
    assert.strictEqual(sceneApplied.targetSceneIds.length, 2, 'chapter sections should become two deterministic scenes');
    const afterScenes = (await projectService.openProject(dataRoot, 'writer-target')).project;
    assert.deepStrictEqual(sceneApplied.targetSceneIds.map((id) => afterScenes.scenes.find((scene) => scene.id === id).content), ['导入正文一。', '导入正文二。']);

    const stalePreview = await writerService.preview(dataRoot, {
      envelopeId: 'writer-conflict-envelope', applicationId: 'conflict-application', intent: 'replace', targetProjectId: 'writer-target', targetSceneId
    });
    await projectService.saveProject(dataRoot, { ...afterScenes, description: '并发修改', updatedAt: '2026-07-16T13:30:00.000Z' });
    await assert.rejects(() => writerService.apply(dataRoot, {
      envelopeId: 'writer-conflict-envelope', applicationId: 'conflict-application', intent: 'replace', confirmed: true,
      targetProjectId: 'writer-target', targetSceneId, expectedTargetUpdatedAt: stalePreview.targetProject.updatedAt
    }), /changed after preview/);

    const newProject = await writerService.apply(dataRoot, {
      envelopeId: 'writer-new-project-envelope', applicationId: 'new-project-application', intent: 'new-project', confirmed: true,
      newProjectId: 'reader-imported-project', newProjectTitle: '导入新项目', appliedAt: '2026-07-16T13:40:00.000Z'
    });
    assert.strictEqual(newProject.targetSceneIds.length, 2);
    assert.deepStrictEqual((await projectService.openProject(dataRoot, 'reader-imported-project')).project.scenes.map((scene) => scene.content), ['导入正文一。', '导入正文二。']);
    const newProjectRetry = await writerService.apply(dataRoot, {
      envelopeId: 'writer-new-project-envelope', applicationId: 'new-project-application', intent: 'new-project', confirmed: true,
      newProjectId: 'reader-imported-project', newProjectTitle: '导入新项目', appliedAt: '2026-07-16T13:41:00.000Z'
    });
    assert.strictEqual(newProjectRetry.idempotent, true);

    const failingWriterService = createReaderWriterTransferService({
      readerTransferService: transferService,
      projectService: { ...projectService, createProject: async () => { throw new Error('forced project create failure'); } },
      createBackup: async () => { throw new Error('backup should not run for a new project'); }
    });
    await assert.rejects(() => failingWriterService.apply(dataRoot, {
      envelopeId: 'writer-failed-new-project-envelope', applicationId: 'failed-new-project-application', intent: 'new-project', confirmed: true,
      newProjectId: 'failed-reader-project', newProjectTitle: '失败项目'
    }), /forced project create failure/);
    await assert.rejects(() => projectService.openProject(dataRoot, 'failed-reader-project'), /ENOENT/, 'failed import must not leave a partial project');

    await transferService.createTransferFromRange(dataRoot, {
      envelopeId: 'writer-locate-envelope', destination: 'writer', documentId: 'project:writer-target', projectId: 'writer-target',
      scope: 'scene', sceneId: targetSceneId, createdAt: '2026-07-16T13:45:00.000Z'
    });
    const exactLocation = await writerService.preview(dataRoot, {
      envelopeId: 'writer-locate-envelope', applicationId: 'locate-application', intent: 'locate', targetProjectId: 'writer-target'
    });
    assert.strictEqual(exactLocation.location.accuracy, 'exact');
    const beforeApproximate = (await projectService.openProject(dataRoot, 'writer-target')).project;
    await projectService.saveProject(dataRoot, {
      ...beforeApproximate,
      scenes: beforeApproximate.scenes.filter((scene) => scene.id !== targetSceneId),
      updatedAt: '2026-07-16T13:46:00.000Z'
    });
    const approximateLocation = await writerService.preview(dataRoot, {
      envelopeId: 'writer-locate-envelope', applicationId: 'locate-application', intent: 'locate', targetProjectId: 'writer-target'
    });
    assert.strictEqual(approximateLocation.location.accuracy, 'approximate');
    assert.ok(approximateLocation.conflicts.some((item) => item.includes('近似')));

    await fs.rm(libraryPaths.readerDocumentDir(dataRoot, 'writer-source'), { recursive: true, force: true });
    const deletedSourcePreview = await writerService.preview(dataRoot, {
      envelopeId: 'writer-conflict-envelope', applicationId: 'deleted-source-application', intent: 'new-scenes', targetProjectId: 'writer-target'
    });
    assert.strictEqual(deletedSourcePreview.freshness.status, 'missing');
    assert.strictEqual(deletedSourcePreview.items[0].text, '导入正文一。', 'deleted source must not invalidate the frozen snapshot');

    const transfer = await transferService.readTransfer(dataRoot, 'writer-append-envelope');
    assert.strictEqual(transfer.envelope.lifecycle, 'consumed');
    assert.ok(transfer.envelope.consumerReferences.some((reference) => reference.consumerId === 'writer-application:append-application'));

    console.log('Reader writer transfer service tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader writer transfer service tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
