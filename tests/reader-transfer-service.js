const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const ReaderSchema = require('../src/core/document/reader-document-schema');
const ReaderDocument = require('../src/core/document/reader-document');
const readerStore = require('../desktop/storage/reader-document-store');
const projectStore = require('../desktop/storage/project-file-store');
const { createReaderTransferService, projectUnitDigest } = require('../desktop/services/reader-transfer-service');

function revision(id, createdAt, text, parentRevisionId = '') {
  return ReaderSchema.createReaderDocumentRevision({
    revisionId: id,
    parentRevisionId,
    createdAt,
    chapters: [{
      chapterId: 'chapter-1', title: '第一章', blocks: [{ blockId: 'block-1', type: 'paragraph', text }]
    }]
  }, { digest: readerStore.sha256 });
}

function externalTransfer(revisionInput) {
  return {
    envelope: {
      envelopeId: 'external-transfer',
      createdAt: '2026-07-16T10:00:00.000Z',
      destination: 'workflow',
      sourceKind: 'local-text',
      documentId: 'external-book',
      revisionId: revisionInput.revisionId,
      sourceRevisionDigest: revisionInput.contentDigest,
      format: 'txt',
      scope: 'chapter',
      sourceLocators: [{ documentId: 'external-book', revisionId: revisionInput.revisionId, chapterId: 'chapter-1', blockId: 'block-1' }]
    },
    snapshot: { sourceTitle: '第一章', sections: [{ sectionId: 'chapter-1', chapterId: 'chapter-1' }] },
    text: revisionInput.chapters[0].blocks[0].text
  };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-transfer-service-'));
  try {
    const service = createReaderTransferService();
    const revisionOne = revision('revision-1', '2026-07-16T08:00:00.000Z', '外部第一版。');
    const document = ReaderSchema.createReaderDocument({
      documentId: 'external-book', sourceKind: 'local-text', format: 'txt', title: '外部书',
      importedAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:00.000Z',
      activeRevisionId: revisionOne.revisionId, revisions: [revisionOne]
    }, { digest: readerStore.sha256 });
    await readerStore.createReaderDocument(dataRoot, document);
    const external = await service.createTransfer(dataRoot, externalTransfer(revisionOne));
    assert.strictEqual((await service.freshness(dataRoot, external.envelope.envelopeId)).status, 'fresh');
    const rangedExternal = await service.createTransferFromRange(dataRoot, {
      envelopeId: 'external-range-transfer',
      createdAt: '2026-07-16T08:30:00.000Z',
      destination: 'writer',
      documentId: 'external-book',
      revisionId: 'revision-1',
      sourceRevisionDigest: revisionOne.contentDigest,
      scope: 'selection',
      range: {
        start: { documentId: 'external-book', revisionId: 'revision-1', chapterId: 'chapter-1', blockId: 'block-1', offset: 0 },
        end: { documentId: 'external-book', revisionId: 'revision-1', chapterId: 'chapter-1', blockId: 'block-1', offset: 2 }
      },
      text: 'UNTRUSTED_CLIENT_TEXT'
    });
    assert.strictEqual(rangedExternal.text, '外部', 'range transfer text must be rebuilt from the authoritative revision');
    assert.ok(!rangedExternal.text.includes('UNTRUSTED_CLIENT_TEXT'));
    const materializedExternal = await service.materializeConsumer(dataRoot, rangedExternal.envelope.envelopeId, {
      consumerId: 'writer-input:external-range-transfer', destination: 'writer', referenceId: 'writer-beat:external-range-transfer',
      createdAt: '2026-07-16T08:31:00.000Z', materializedAt: '2026-07-16T08:31:00.000Z'
    });
    assert.strictEqual(materializedExternal.lifecycle, 'consumed');
    assert.strictEqual(materializedExternal.consumerReferences[0].materializedAt, '2026-07-16T08:31:00.000Z');
    const materializedExternalRetry = await service.materializeConsumer(dataRoot, rangedExternal.envelope.envelopeId, {
      consumerId: 'writer-input:external-range-transfer', destination: 'writer', referenceId: 'writer-beat:external-range-transfer',
      createdAt: '2026-07-16T08:31:00.000Z', materializedAt: '2026-07-16T08:31:00.000Z'
    });
    assert.deepStrictEqual(materializedExternalRetry, materializedExternal, 'materialization retry must be idempotent');
    await assert.rejects(() => service.materializeConsumer(dataRoot, rangedExternal.envelope.envelopeId, {
      consumerId: 'writer-input:external-range-transfer', destination: 'writer', referenceId: 'different-reference',
      materializedAt: '2026-07-16T08:32:00.000Z'
    }), /identity is immutable/);

    const revisionTwo = revision('revision-2', '2026-07-16T09:00:00.000Z', '外部第二版。', revisionOne.revisionId);
    await readerStore.appendReaderDocumentRevision(dataRoot, 'external-book', revisionTwo, { expectedUpdatedAt: '2026-07-16T08:00:00.000Z' });
    const externalFreshness = await service.freshness(dataRoot, external.envelope.envelopeId);
    assert.strictEqual(externalFreshness.status, 'fresh', 'immutable older external revisions remain fresh');
    assert.strictEqual(externalFreshness.newerRevisionAvailable, true);

    await assert.rejects(() => service.createTransfer(dataRoot, {
      ...externalTransfer(revisionOne),
      envelope: { ...externalTransfer(revisionOne).envelope, envelopeId: 'wrong-digest', sourceRevisionDigest: 'sha256:wrong' }
    }), /digest does not match/);

    const createdProject = await projectStore.createProject(dataRoot, { id: 'project-transfer', title: '项目来源' });
    const project = {
      ...createdProject.project,
      scenes: [{
        id: 'scene-1', chapterId: createdProject.project.chapters[0].id, title: '场景一', content: '项目冻结正文。',
        order: 0, createdAt: '2026-07-16T10:00:00.000Z', updatedAt: '2026-07-16T10:00:00.000Z'
      }],
      sceneOrder: ['scene-1'],
      currentSceneId: 'scene-1',
      updatedAt: '2026-07-16T10:00:00.000Z'
    };
    await projectStore.saveProject(dataRoot, project);
    const projection = ReaderDocument.projectToReaderDocumentV2(project, { digest: readerStore.sha256 });
    const projectRevision = projection.revisions[0];
    const projectLocator = {
      documentId: projection.documentId,
      revisionId: projectRevision.revisionId,
      chapterId: projectRevision.chapters[0].chapterId,
      blockId: projectRevision.chapters[0].blocks.find((block) => block.sourceSceneId === 'scene-1').blockId,
      projectRef: { projectId: project.id, chapterId: project.chapters[0].id, sceneId: 'scene-1', sceneOffset: 0 }
    };
    await service.createTransfer(dataRoot, {
      envelope: {
        envelopeId: 'project-transfer-envelope', createdAt: '2026-07-16T10:01:00.000Z', destination: 'writer',
        sourceKind: 'project', documentId: projection.documentId, revisionId: projectRevision.revisionId,
        sourceRevisionDigest: projectRevision.contentDigest, format: 'project', scope: 'scene', sourceLocators: [projectLocator],
        suggestedProjectId: project.id
      },
      snapshot: {
        sourceTitle: '场景一', sections: [{ sectionId: 'scene-1', sceneId: 'scene-1' }],
        sourceUnits: [{ kind: 'scene', sourceId: 'scene-1', sceneId: 'scene-1', digest: projectUnitDigest(project, { kind: 'scene', sourceId: 'scene-1' }), updatedAt: project.updatedAt }]
      },
      text: '项目冻结正文。'
    });
    assert.strictEqual((await service.freshness(dataRoot, 'project-transfer-envelope')).status, 'fresh');
    const rangedProject = await service.createTransferFromRange(dataRoot, {
      envelopeId: 'project-range-envelope',
      createdAt: '2026-07-16T10:02:00.000Z',
      destination: 'compendium',
      documentId: projection.documentId,
      projectId: project.id,
      revisionId: projectRevision.revisionId,
      sourceRevisionDigest: projectRevision.contentDigest,
      scope: 'scene',
      sceneId: 'scene-1'
    });
    assert.ok(rangedProject.text.includes('项目冻结正文。'));
    assert.strictEqual(rangedProject.snapshot.sourceUnits[0].sceneId, 'scene-1');
    await projectStore.saveProject(dataRoot, {
      ...project,
      scenes: [{ ...project.scenes[0], content: '项目正文已经变化。', updatedAt: '2026-07-16T11:00:00.000Z' }],
      updatedAt: '2026-07-16T11:00:00.000Z'
    });
    assert.strictEqual((await service.freshness(dataRoot, 'project-transfer-envelope')).status, 'stale');

    await service.createTransfer(dataRoot, {
      envelope: {
        envelopeId: 'pasted-transfer', createdAt: '2026-07-16T12:00:00.000Z', destination: 'compendium',
        sourceKind: 'pasted-text', documentId: 'pasted-document', revisionId: 'pasted-revision',
        sourceRevisionDigest: 'sha256:pasted', format: 'plain', scope: 'document',
        sourceLocators: [{ documentId: 'pasted-document', revisionId: 'pasted-revision', chapterId: 'chapter-1', blockId: 'block-1' }]
      },
      snapshot: { sourceTitle: '粘贴文本', sections: [{ sectionId: 'chapter-1' }] },
      text: '粘贴快照本身是权威来源。'
    });
    assert.strictEqual((await service.freshness(dataRoot, 'pasted-transfer')).status, 'fresh');

    console.log('Reader transfer service tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader transfer service tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
