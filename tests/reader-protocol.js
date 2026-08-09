const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createDesktopProtocolHandler } = require('../desktop/local-server');
const projectStore = require('../desktop/storage/project-file-store');

async function jsonRequest(handler, pathname, method = 'GET', body) {
  const response = await handler(new Request(`draftharbor://app${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { response, body: await response.json() };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-protocol-'));
  try {
    const handler = await createDesktopProtocolHandler({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      chooseBackupFolder: null,
      chooseProjectSaveFolder: null,
      openPath: null,
      revealPath: null
    });
    const writerTarget = await projectStore.createProject(dataRoot, { id: 'protocol-writer-target', title: '协议写作目标' });

    const preview = await jsonRequest(handler, '/api/reader/import/paste-preview', 'POST', {
      draftId: 'protocol-reader-draft',
      format: 'md',
      title: '协议书籍',
      text: '# 第一章\n\nPROTOCOL_SECRET_BODY\n\n第二段。',
      createdAt: '2026-07-15T08:00:00.000Z'
    });
    assert.strictEqual(preview.response.status, 200);
    assert.strictEqual(preview.body.draft.chapters[0].title, '第一章');

    const before = await jsonRequest(handler, '/api/reader/documents');
    assert.strictEqual(before.body.documents.length, 1);
    assert.strictEqual(before.body.documents[0].documentId, 'project:protocol-writer-target');

    const confirmed = await jsonRequest(handler, '/api/reader/import/confirm', 'POST', {
      draftId: 'protocol-reader-draft',
      documentId: 'protocol-reader-book',
      revisionId: 'protocol-reader-r1',
      createdAt: '2026-07-15T09:00:00.000Z'
    });
    assert.strictEqual(confirmed.response.status, 200);
    assert.strictEqual(confirmed.body.ok, true);
    assert.ok(!Object.hasOwn(confirmed.body, 'revision'), 'confirm response must not return full revision prose');
    assert.ok(!Object.hasOwn(confirmed.body, 'sourceCopy'), 'confirm response must not expose local source paths');

    const listed = await jsonRequest(handler, '/api/reader/documents');
    assert.strictEqual(listed.body.documents.length, 2);
    assert.ok(!JSON.stringify(listed.body).includes('PROTOCOL_SECRET_BODY'), 'list API must not include prose');
    assert.ok(!JSON.stringify(listed.body).includes(dataRoot), 'list API must not expose storage paths');

    const libraryView = await jsonRequest(handler, '/api/reader/library-view', 'POST', {
      view: { viewMode: 'list', sortBy: 'title', sourceFilter: 'local-text', favoriteDocumentIds: ['protocol-reader-book'] },
      updatedAt: '2026-07-15T07:30:00.000Z'
    });
    assert.strictEqual(libraryView.response.status, 200);
    assert.strictEqual(libraryView.body.record.view.viewMode, 'list');
    const reopenedLibraryView = await jsonRequest(handler, '/api/reader/library-view');
    assert.strictEqual(reopenedLibraryView.body.record.view.favoriteDocumentIds[0], 'protocol-reader-book');

    const metadata = await jsonRequest(handler, '/api/reader/document?documentId=protocol-reader-book');
    assert.strictEqual(metadata.response.status, 200);
    assert.ok(!JSON.stringify(metadata.body).includes('PROTOCOL_SECRET_BODY'), 'metadata API must not include prose');
    assert.ok(!JSON.stringify(metadata.body).includes('blocks'), 'metadata API must not include blocks');

    const contents = await jsonRequest(handler, '/api/reader/contents?documentId=protocol-reader-book');
    assert.strictEqual(contents.response.status, 200);
    assert.strictEqual(contents.body.contents.chapters[0].chapterId, preview.body.draft.chapters[0].chapterId);
    assert.ok(!JSON.stringify(contents.body).includes('PROTOCOL_SECRET_BODY'), 'contents API must not include prose');
    assert.ok(!JSON.stringify(contents.body).includes('blocks'), 'contents API must return chapter summaries only');

    const chapterId = preview.body.draft.chapters[0].chapterId;
    const chapter = await jsonRequest(handler, `/api/reader/chapter?documentId=protocol-reader-book&chapterId=${encodeURIComponent(chapterId)}`);
    assert.strictEqual(chapter.response.status, 200);
    assert.ok(JSON.stringify(chapter.body.chapter).includes('PROTOCOL_SECRET_BODY'));
    assert.strictEqual(chapter.body.revision.revisionId, 'protocol-reader-r1');

    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, 5)]);
    const illustration = await jsonRequest(handler, '/api/reader/illustrations', 'POST', {
      documentId: 'protocol-reader-book', chapterId, blockId: chapter.body.chapter.blocks[0].blockId,
      offset: 0, excerpt: 'PROTOCOL_SECRET_BODY', fileName: 'protocol.png', bytes: png.toString('base64')
    });
    assert.strictEqual(illustration.response.status, 200);
    assert.strictEqual(illustration.body.record.illustrations.length, 1);
    const imageResponse = await handler(new Request(`draftharbor://app/api/reader/illustrations/file?documentId=protocol-reader-book&assetId=${encodeURIComponent(illustration.body.illustration.assetId)}`));
    assert.strictEqual(imageResponse.status, 200);
    assert.strictEqual(imageResponse.headers.get('content-type'), 'image/png');
    assert.deepStrictEqual(Buffer.from(await imageResponse.arrayBuffer()), png);

    const rangeTransferCreated = await jsonRequest(handler, '/api/reader/transfer/range', 'POST', {
      envelopeId: 'protocol-range-envelope',
      createdAt: '2026-07-15T09:20:00.000Z',
      destination: 'writer',
      documentId: 'protocol-reader-book',
      revisionId: 'protocol-reader-r1',
      sourceRevisionDigest: chapter.body.revision.contentDigest,
      scope: 'chapter',
      chapterId,
      text: 'UNTRUSTED_CLIENT_PROSE'
    });
    assert.strictEqual(rangeTransferCreated.response.status, 200);
    assert.strictEqual(rangeTransferCreated.body.envelope.envelopeId, 'protocol-range-envelope');
    assert.ok(!JSON.stringify(rangeTransferCreated.body).includes('PROTOCOL_SECRET_BODY'), 'range creation response must not return snapshot prose');
    assert.ok(!JSON.stringify(rangeTransferCreated.body).includes('UNTRUSTED_CLIENT_PROSE'), 'range creation response must ignore client prose');
    assert.ok(!JSON.stringify(rangeTransferCreated.body).includes(dataRoot), 'range creation response must not expose storage paths');
    const rangeTransferRead = await jsonRequest(handler, '/api/reader/transfer?envelopeId=protocol-range-envelope');
    assert.ok(rangeTransferRead.body.transfer.text.includes('PROTOCOL_SECRET_BODY'), 'range transfer must rebuild prose from the authoritative revision');
    assert.ok(!rangeTransferRead.body.transfer.text.includes('UNTRUSTED_CLIENT_PROSE'), 'range transfer must not trust client prose');
    const rangeMaterialized = await jsonRequest(handler, '/api/reader/transfer/consumer/materialize', 'POST', {
      envelopeId: 'protocol-range-envelope',
      consumer: {
        consumerId: 'writer-input:protocol-range-envelope', destination: 'writer', referenceId: 'writer-beat:protocol-range-envelope',
        createdAt: '2026-07-15T09:21:00.000Z', materializedAt: '2026-07-15T09:21:00.000Z'
      }
    });
    assert.strictEqual(rangeMaterialized.response.status, 200);
    assert.strictEqual(rangeMaterialized.body.envelope.lifecycle, 'consumed');
    assert.ok(!JSON.stringify(rangeMaterialized.body).includes('PROTOCOL_SECRET_BODY'), 'materialization response must remain prose-free');

    const writerPreview = await jsonRequest(handler, '/api/writer/reader-transfer/preview', 'POST', {
      envelopeId: 'protocol-range-envelope', applicationId: 'protocol-writer-application', intent: 'new-scenes',
      targetProjectId: 'protocol-writer-target', targetChapterId: writerTarget.project.chapters[0].id
    });
    assert.strictEqual(writerPreview.response.status, 200);
    assert.strictEqual((await projectStore.openProject(dataRoot, 'protocol-writer-target')).scenes.length, 1, 'writer preview must not change project disk');
    const writerApplied = await jsonRequest(handler, '/api/writer/reader-transfer/apply', 'POST', {
      envelopeId: 'protocol-range-envelope', applicationId: 'protocol-writer-application', intent: 'new-scenes', confirmed: true,
      targetProjectId: 'protocol-writer-target', targetChapterId: writerTarget.project.chapters[0].id,
      expectedTargetUpdatedAt: writerPreview.body.preview.targetProject.updatedAt,
      selectedItemIds: [writerPreview.body.preview.items[0].itemId], appliedAt: '2026-07-15T09:22:00.000Z'
    });
    assert.strictEqual(writerApplied.response.status, 200);
    assert.ok(writerApplied.body.backup && writerApplied.body.backup.backupId, 'writer apply must create a recoverable backup');
    assert.ok(!JSON.stringify(writerApplied.body).includes('PROTOCOL_SECRET_BODY'), 'writer apply response must not return source prose');
    const writerProjectAfter = await projectStore.openProject(dataRoot, 'protocol-writer-target');
    assert.strictEqual(writerProjectAfter.scenes.length, 2);
    assert.ok(writerProjectAfter.scenes.some((scene) => scene.content.includes('PROTOCOL_SECRET_BODY')));
    const writerRetry = await jsonRequest(handler, '/api/writer/reader-transfer/apply', 'POST', {
      envelopeId: 'protocol-range-envelope', applicationId: 'protocol-writer-application', intent: 'new-scenes', confirmed: true,
      targetProjectId: 'protocol-writer-target', targetChapterId: writerTarget.project.chapters[0].id,
      expectedTargetUpdatedAt: writerPreview.body.preview.targetProject.updatedAt,
      selectedItemIds: [writerPreview.body.preview.items[0].itemId], appliedAt: '2026-07-15T09:22:00.000Z'
    });
    assert.strictEqual(writerRetry.body.idempotent, true);
    assert.strictEqual((await projectStore.openProject(dataRoot, 'protocol-writer-target')).scenes.length, 2, 'duplicate HTTP apply must not create another scene');
    const writerRestored = await jsonRequest(handler, '/api/restore-backup', 'POST', {
      projectId: 'protocol-writer-target', backupId: writerApplied.body.backup.backupId, mode: 'replace'
    });
    assert.strictEqual(writerRestored.response.status, 200);
    assert.ok(writerRestored.body.preRestoreBackup && writerRestored.body.preRestoreBackup.backupId);
    assert.strictEqual((await projectStore.openProject(dataRoot, 'protocol-writer-target')).scenes.length, 1, 'writer pre-apply backup must restore the original scene set');

    const transferCreated = await jsonRequest(handler, '/api/reader/transfer', 'POST', {
      envelope: {
        envelopeId: 'protocol-envelope',
        createdAt: '2026-07-15T09:30:00.000Z',
        destination: 'workflow',
        sourceKind: 'pasted-text',
        documentId: 'protocol-reader-book',
        revisionId: 'protocol-reader-r1',
        sourceRevisionDigest: chapter.body.revision.contentDigest,
        format: 'md',
        scope: 'chapter',
        sourceLocators: [{
          documentId: 'protocol-reader-book', revisionId: 'protocol-reader-r1', chapterId,
          blockId: chapter.body.chapter.blocks[0].blockId, offset: 0
        }]
      },
      snapshot: { sourceTitle: '第一章', sections: [{ sectionId: chapterId, chapterId }] },
      text: 'PROTOCOL_TRANSFER_SECRET'
    });
    assert.strictEqual(transferCreated.response.status, 200);
    assert.strictEqual(transferCreated.body.envelope.envelopeId, 'protocol-envelope');
    assert.ok(!JSON.stringify(transferCreated.body).includes('PROTOCOL_TRANSFER_SECRET'), 'transfer creation must return only the lightweight envelope');
    assert.ok(!JSON.stringify(transferCreated.body).includes(dataRoot), 'transfer envelope must not expose storage paths');

    const transferList = await jsonRequest(handler, '/api/reader/transfers');
    assert.strictEqual(transferList.body.transfers.length, 2);
    assert.ok(!JSON.stringify(transferList.body).includes('PROTOCOL_TRANSFER_SECRET'), 'transfer list must not include snapshot prose');
    const transferRead = await jsonRequest(handler, '/api/reader/transfer?envelopeId=protocol-envelope');
    assert.strictEqual(transferRead.body.transfer.text, 'PROTOCOL_TRANSFER_SECRET');
    assert.strictEqual(transferRead.body.transfer.freshness.status, 'fresh');
    assert.ok(!JSON.stringify(transferRead.body).includes(dataRoot), 'transfer read must not expose storage paths');

    const workflowPreview = await jsonRequest(handler, '/api/workflows/reader-transfer/preview', 'POST', {
      envelopeId: 'protocol-envelope', projectId: 'protocol-writer-target', templateId: 'continuation-guided'
    });
    assert.strictEqual(workflowPreview.response.status, 200);
    assert.strictEqual(workflowPreview.body.preview.artifactType, 'reader-source@1');
    assert.ok(!JSON.stringify(workflowPreview.body).includes('PROTOCOL_TRANSFER_SECRET'), 'workflow preview must not return frozen source prose');
    const workflowUnconfirmed = await jsonRequest(handler, '/api/workflows/reader-transfer/apply', 'POST', {
      envelopeId: 'protocol-envelope', projectId: 'protocol-writer-target', templateId: 'continuation-guided', confirmed: false
    });
    assert.strictEqual(workflowUnconfirmed.response.status, 400);
    const workflowApplied = await jsonRequest(handler, '/api/workflows/reader-transfer/apply', 'POST', {
      envelopeId: 'protocol-envelope', projectId: 'protocol-writer-target', templateId: 'continuation-guided', confirmed: true,
      expectedProjectUpdatedAt: workflowPreview.body.preview.targetProject.updatedAt
    });
    assert.strictEqual(workflowApplied.response.status, 200);
    assert.ok(!JSON.stringify(workflowApplied.body).includes('PROTOCOL_TRANSFER_SECRET'), 'workflow apply response must remain prose-free');
    const workflowRetry = await jsonRequest(handler, '/api/workflows/reader-transfer/apply', 'POST', {
      envelopeId: 'protocol-envelope', projectId: 'protocol-writer-target', templateId: 'continuation-guided', confirmed: true,
      expectedProjectUpdatedAt: workflowPreview.body.preview.targetProject.updatedAt
    });
    assert.strictEqual(workflowRetry.body.idempotent, true);
    const workflowRuns = await jsonRequest(handler, '/api/workflows?projectId=protocol-writer-target');
    assert.strictEqual(workflowRuns.body.runs.filter((run) => run.id === workflowApplied.body.runId).length, 1, 'duplicate workflow transfer must not create another run');
    const consumedTransfer = await jsonRequest(handler, '/api/reader/transfer?envelopeId=protocol-envelope');
    assert.strictEqual(consumedTransfer.body.transfer.envelope.lifecycle, 'consumed');

    const projectSource = await projectStore.openProject(dataRoot, 'protocol-writer-target');
    projectSource.scenes[0].content = 'PROTOCOL_PROJECT_WORKFLOW_SOURCE';
    projectSource.scenes[0].updatedAt = '2026-07-15T09:40:00.000Z'; projectSource.updatedAt = '2026-07-15T09:40:00.000Z';
    await projectStore.saveProject(dataRoot, projectSource);
    const projectWorkflowEnvelope = await jsonRequest(handler, '/api/reader/transfer/range', 'POST', {
      envelopeId: 'protocol-project-workflow-envelope', destination: 'workflow', documentId: 'project:protocol-writer-target',
      projectId: 'protocol-writer-target', scope: 'scene', sceneId: projectSource.scenes[0].id
    });
    assert.strictEqual(projectWorkflowEnvelope.response.status, 200);
    const projectWorkflowPreview = await jsonRequest(handler, '/api/workflows/reader-transfer/preview', 'POST', {
      envelopeId: 'protocol-project-workflow-envelope', projectId: 'protocol-writer-target', templateId: 'rewrite-guided'
    });
    assert.strictEqual(projectWorkflowPreview.body.preview.artifactType, 'writer-source@1');
    const projectWorkflowApplied = await jsonRequest(handler, '/api/workflows/reader-transfer/apply', 'POST', {
      envelopeId: 'protocol-project-workflow-envelope', projectId: 'protocol-writer-target', templateId: 'rewrite-guided', confirmed: true,
      expectedProjectUpdatedAt: projectWorkflowPreview.body.preview.targetProject.updatedAt, brief: '保留事实并压缩正文'
    });
    assert.strictEqual(projectWorkflowApplied.response.status, 200);
    assert.ok(!JSON.stringify(projectWorkflowApplied.body).includes('PROTOCOL_PROJECT_WORKFLOW_SOURCE'), 'project workflow apply response must not expose source prose');

    const preferences = await jsonRequest(handler, '/api/reader/preferences', 'POST', {
      preferences: { themeId: 'paper', fontSize: 21 },
      updatedAt: '2026-07-15T10:00:00.000Z'
    });
    assert.strictEqual(preferences.body.record.preferences.themeId, 'paper');
    assert.strictEqual(preferences.body.record.preferences.schemaVersion, 2);

    const appearanceList = await jsonRequest(handler, '/api/reader/appearances');
    assert.strictEqual(appearanceList.response.status, 200);
    assert.deepStrictEqual(appearanceList.body.profiles, [], 'appearance store should start empty');
    const appearanceCreated = await jsonRequest(handler, '/api/reader/appearances', 'POST', {
      profile: {
        profileId: 'user:protocol-appearance',
        name: '协议外观',
        preferences: {
          themeId: 'oled', paperMaterial: 'grain', paperShadow: false, paperVignette: false,
          fontSize: 22, appearanceProfileId: 'custom'
        }
      },
      expectedUpdatedAt: ''
    });
    assert.strictEqual(appearanceCreated.response.status, 200);
    assert.strictEqual(appearanceCreated.body.profile.profileId, 'user:protocol-appearance');
    assert.strictEqual(appearanceCreated.body.profile.preferences.appearanceProfileId, 'user:protocol-appearance');
    assert.strictEqual(appearanceCreated.body.profile.preferences.themeId, 'oled');
    assert.strictEqual(appearanceCreated.body.profile.preferences.paperMaterial, 'grain');
    assert.strictEqual(appearanceCreated.body.profile.preferences.paperShadow, false);
    const appearanceConflict = await jsonRequest(handler, '/api/reader/appearances', 'POST', {
      profile: { profileId: 'user:protocol-appearance', name: '过期修改', preferences: { themeId: 'white' } },
      expectedUpdatedAt: '2026-07-15T00:00:00.000Z'
    });
    assert.strictEqual(appearanceConflict.response.status, 409, 'stale appearance writes must conflict');
    const appearanceUpdated = await jsonRequest(handler, '/api/reader/appearances', 'POST', {
      profile: { profileId: 'user:protocol-appearance', name: '协议外观更新', preferences: { themeId: 'eye' } },
      expectedUpdatedAt: appearanceCreated.body.record.updatedAt
    });
    assert.strictEqual(appearanceUpdated.response.status, 200);
    assert.strictEqual(appearanceUpdated.body.profile.name, '协议外观更新');
    assert.strictEqual(appearanceUpdated.body.profile.preferences.themeId, 'eye');
    const appearanceDeleted = await jsonRequest(
      handler,
      `/api/reader/appearances?profileId=user%3Aprotocol-appearance&expectedUpdatedAt=${encodeURIComponent(appearanceUpdated.body.record.updatedAt)}`,
      'DELETE'
    );
    assert.strictEqual(appearanceDeleted.response.status, 200);
    assert.strictEqual(appearanceDeleted.body.profileId, 'user:protocol-appearance');
    const appearanceAfterDelete = await jsonRequest(handler, '/api/reader/appearances');
    assert.deepStrictEqual(appearanceAfterDelete.body.profiles, [], 'deleted appearance profiles must disappear from the list');
    const invalidAppearance = await jsonRequest(handler, '/api/reader/appearances', 'POST', {
      profile: { profileId: 'not-a-user-profile', name: '非法方案', preferences: {} }
    });
    assert.strictEqual(invalidAppearance.response.status, 400, 'appearance profile ids must be server-validated');

    const state = await jsonRequest(handler, '/api/reader/state', 'POST', {
      state: {
        documentId: 'protocol-reader-book',
        positionLocator: null,
        updatedAt: '2026-07-15T10:00:00.000Z',
        bookmarks: []
      }
    });
    assert.strictEqual(state.body.state.documentId, 'protocol-reader-book');
    const reopenedState = await jsonRequest(handler, '/api/reader/state?documentId=protocol-reader-book');
    assert.strictEqual(reopenedState.body.state.updatedAt, '2026-07-15T10:00:00.000Z');

    const annotation = await jsonRequest(handler, '/api/reader/annotations', 'POST', {
      annotation: {
        annotationId: 'protocol-annotation-1',
        documentId: 'protocol-reader-book',
        revisionId: 'protocol-reader-r1',
        type: 'note',
        range: { start: { chapterId, blockId: chapter.body.chapter.blocks[0].blockId, offset: 0 }, end: { chapterId, blockId: chapter.body.chapter.blocks[0].blockId, offset: 8 } },
        excerpt: '协议摘录',
        note: '协议批注'
      },
      updatedAt: '2026-07-15T10:10:00.000Z'
    });
    assert.strictEqual(annotation.response.status, 200);
    assert.strictEqual(annotation.body.record.annotations[0].note, '协议批注');
    const annotations = await jsonRequest(handler, '/api/reader/annotations?documentId=protocol-reader-book');
    assert.strictEqual(annotations.body.record.annotations.length, 1);

    const history = await jsonRequest(handler, '/api/reader/history', 'POST', {
      entry: {
        documentId: 'protocol-reader-book',
        revisionId: 'protocol-reader-r1',
        locator: { chapterId, blockId: chapter.body.chapter.blocks[0].blockId, offset: 8 },
        visitedAt: '2026-07-15T10:11:00.000Z'
      },
      updatedAt: '2026-07-15T10:11:00.000Z'
    });
    assert.strictEqual(history.body.record.history.items.length, 1);
    const filteredHistory = await jsonRequest(handler, '/api/reader/history?documentId=protocol-reader-book');
    assert.strictEqual(filteredHistory.body.record.history.items[0].locator.offset, 8);

    const deletedAnnotation = await jsonRequest(handler, '/api/reader/annotations/delete', 'POST', {
      documentId: 'protocol-reader-book',
      annotationId: 'protocol-annotation-1',
      expectedUpdatedAt: annotation.body.record.updatedAt,
      updatedAt: '2026-07-15T10:12:00.000Z'
    });
    assert.strictEqual(deletedAnnotation.body.deleted, true);
    assert.strictEqual(deletedAnnotation.body.record.annotations.length, 0);

    const migration = await jsonRequest(handler, '/api/reader/migration', 'POST', { legacyState: null });
    assert.strictEqual(migration.body.migration.canClearLegacyState, true);
    assert.ok(!JSON.stringify(migration.body).includes('PROTOCOL_SECRET_BODY'));

    const missingId = await jsonRequest(handler, '/api/reader/document');
    assert.strictEqual(missingId.response.status, 400);
    const traversal = await jsonRequest(handler, '/api/reader/document?documentId=../../outside');
    assert.strictEqual(traversal.response.status, 404);
    const missingTransfer = await jsonRequest(handler, '/api/reader/transfer?envelopeId=../../outside');
    assert.strictEqual(missingTransfer.response.status, 404);
    const unknown = await jsonRequest(handler, '/api/reader/unknown');
    assert.strictEqual(unknown.response.status, 404);

    console.log('Reader protocol tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader protocol tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
