const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const { createReaderCompendiumTransferService } = require('../desktop/services/reader-compendium-transfer-service');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-compendium-'));
  try {
    const created = await projectService.createProject(root, { id: 'target-project', title: '目标项目' });
    const existing = (await compendiumService.saveEntry(root, 'target-project', { type: 'character', title: '林岚', aliases: ['小林'], summary: '旧摘要' })).entry;
    const transfer = {
      envelope: { envelopeId: 'compendium-envelope', destination: 'compendium', documentId: 'reader-doc', revisionId: 'r1', sourceLocators: [], lifecycle: 'active' },
      snapshot: { sourceTitle: '长篇来源', sections: [{ sectionId: 'section-1', textStart: 0, textEnd: 16000 }] },
      text: `${'前文'.repeat(3500)}林岚调查钟楼。${'后文'.repeat(3500)}`, freshness: { status: 'fresh' }
    };
    const materialized = [];
    const readerTransferService = {
      readTransfer: async (_, id) => id === transfer.envelope.envelopeId ? transfer : null,
      materializeConsumer: async (_, id, consumer) => { materialized.push({ id, consumer }); return { lifecycle: 'consumed' }; }
    };
    let extractionCalls = 0;
    const extractor = { extractChunk: async (_, input) => {
      extractionCalls += 1;
      if (input.chunk.index === 0) return [{ type: 'character', title: '林岚', summary: '新摘要', aliases: ['小林'], tags: ['调查员'] }];
      return [{ type: 'character', title: '小林', aliases: ['林岚'], body: '她调查钟楼。', tags: ['钟楼'] }, { type: 'location', title: '钟楼', summary: '旧港钟楼' }];
    } };
    const backups = [];
    const createBackup = async () => {
      const snapshot = (await projectService.openProject(root, 'target-project')).project;
      backups.push(snapshot);
      return { backup: { backupId: `backup-${backups.length}` } };
    };
    const service = createReaderCompendiumTransferService({ readerTransferService, compendiumService, projectService, extractor, createBackup });
    const extracted = await service.extract(root, { envelopeId: 'compendium-envelope', projectId: 'target-project', batchId: 'batch-1', createdAt: '2026-07-16T10:00:00.000Z', chunking: { size: 1200, overlap: 100 } });
    assert.ok(extractionCalls > 1, 'multi-chunk extraction should invoke the provider per chunk');
    assert.strictEqual(extracted.batch.candidates.length, 2, 'alias duplicates should merge across chunks');
    const character = extracted.batch.candidates.find((candidate) => candidate.card.type === 'character');
    assert.strictEqual(character.classification, 'update');
    const location = extracted.batch.candidates.find((candidate) => candidate.card.type === 'location');
    await assert.rejects(() => service.apply(root, { projectId: 'target-project', batchId: 'batch-1', confirmed: true }), /explicit decision/);
    assert.strictEqual((await compendiumService.listEntries(root, 'target-project')).entries.length, 1, 'unreviewed apply must not write');
    await service.review(root, { projectId: 'target-project', batchId: 'batch-1', decisions: [
      { candidateId: character.candidateId, decision: 'approved-modified', card: { ...character.card, summary: '审核后的摘要' } },
      { candidateId: location.candidateId, decision: 'approved' }
    ] });
    await assert.rejects(() => service.apply(root, { projectId: 'target-project', batchId: 'batch-1', confirmed: false }), /explicit confirmation/);
    const before = (await compendiumService.listEntries(root, 'target-project')).entries;
    assert.strictEqual(before.length, 1, 'no confirmation must leave disk unchanged');
    const applied = await service.apply(root, { projectId: 'target-project', batchId: 'batch-1', confirmed: true, appliedAt: '2026-07-16T11:00:00.000Z' });
    assert.strictEqual(applied.entries.length, 2);
    assert.strictEqual(backups.length, 1, 'confirmed batch should create one pre-write backup');
    const after = (await compendiumService.listEntries(root, 'target-project')).entries;
    assert.strictEqual(after.length, 2);
    assert.strictEqual(after.find((entry) => entry.id === existing.id).summary, '审核后的摘要');
    assert.ok(after.every((entry) => entry.sourceReferences.some((reference) => reference.batchId === 'batch-1')), 'saved cards should retain Reader evidence');
    assert.strictEqual(materialized.length, 1);
    const retry = await service.apply(root, { projectId: 'target-project', batchId: 'batch-1', confirmed: true });
    assert.strictEqual(retry.idempotent, true);
    assert.strictEqual((await compendiumService.listEntries(root, 'target-project')).entries.length, 2, 'retry must not duplicate cards');
    await projectService.saveProject(root, backups[0]);
    assert.strictEqual((await compendiumService.listEntries(root, 'target-project')).entries.length, 1, 'project backup should restore the original compendium');
    await assert.rejects(() => compendiumService.saveEntriesBatch(root, 'target-project', [{ projectId: 'other-project', type: 'note', title: '越界' }]), /cross projects/);
    assert.strictEqual(created.project.id, 'target-project');
    console.log('reader compendium transfer service tests passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
