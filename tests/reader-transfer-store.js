const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const paths = require('../desktop/storage/library-paths');
const store = require('../desktop/storage/reader-transfer-store');

function transferInput(envelopeId = 'transfer-1') {
  const createdAt = '2026-07-16T08:00:00.000Z';
  return {
    envelope: {
      envelopeId,
      createdAt,
      destination: 'compendium',
      sourceKind: 'local-text',
      documentId: 'book-1',
      revisionId: 'revision-1',
      sourceRevisionDigest: 'sha256:revision-one',
      format: 'md',
      scope: 'chapter',
      sourceLocators: [{
        documentId: 'book-1', revisionId: 'revision-1', chapterId: 'chapter-1', blockId: 'block-1', offset: 0
      }]
    },
    snapshot: {
      sourceTitle: '第一章',
      sections: [{ sectionId: 'chapter-1', title: '第一章', chapterId: 'chapter-1', characterCount: 6 }]
    },
    text: '冻结正文。'
  };
}

async function fileDigest(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-transfer-store-'));
  try {
    const transferRoot = path.resolve(paths.readerTransfersDir(dataRoot));
    const traversal = path.resolve(paths.readerTransferDir(dataRoot, '../../outside'));
    assert.ok(traversal.startsWith(`${transferRoot}${path.sep}`), 'transfer ids must not escape the reader transfer root');
    assert.notStrictEqual(paths.readerTransferDir(dataRoot, 'same:name'), paths.readerTransferDir(dataRoot, 'same?name'));

    const created = await store.createReaderTransfer(dataRoot, transferInput());
    assert.strictEqual(created.envelope.lifecycle, 'active');
    assert.strictEqual(created.text, '冻结正文。');
    const firstDigest = await fileDigest(paths.readerTransferSnapshotTextPath(dataRoot, 'transfer-1'));
    const reopened = await store.readReaderTransfer(dataRoot, 'transfer-1');
    assert.strictEqual(reopened.envelope.snapshotDigest, created.envelope.snapshotDigest);
    assert.strictEqual(await fileDigest(paths.readerTransferSnapshotTextPath(dataRoot, 'transfer-1')), firstDigest);

    await assert.rejects(
      () => store.createReaderTransfer(dataRoot, transferInput()),
      (error) => error instanceof store.ReaderTransferConflictError
    );
    assert.strictEqual((await store.listReaderTransfers(dataRoot)).transfers.length, 1);

    const withConsumer = await store.addReaderTransferConsumer(dataRoot, 'transfer-1', {
      consumerId: 'consumer-1',
      destination: 'compendium',
      referenceId: 'candidate-batch-1',
      createdAt: '2026-07-16T08:01:00.000Z'
    }, { expectedUpdatedAt: created.envelope.updatedAt });
    await assert.rejects(
      () => store.transitionReaderTransfer(dataRoot, 'transfer-1', 'consumed', { updatedAt: '2026-07-16T08:02:00.000Z' }),
      /materialized consumer/
    );
    await assert.rejects(
      () => store.deleteArchivedReaderTransfer(dataRoot, 'transfer-1'),
      (error) => error instanceof store.ReaderTransferConflictError
    );
    await assert.rejects(
      () => store.updateReaderTransferConsumer(dataRoot, 'transfer-1', 'consumer-1', {
        materializedAt: '2026-07-16T08:02:00.000Z', updatedAt: '2026-07-16T08:02:00.000Z'
      }, { expectedUpdatedAt: created.envelope.updatedAt }),
      (error) => error instanceof store.ReaderTransferConflictError
    );
    const materialized = await store.updateReaderTransferConsumer(dataRoot, 'transfer-1', 'consumer-1', {
      materializedAt: '2026-07-16T08:02:00.000Z', updatedAt: '2026-07-16T08:02:00.000Z'
    }, { expectedUpdatedAt: withConsumer.updatedAt });
    const consumed = await store.transitionReaderTransfer(dataRoot, 'transfer-1', 'consumed', {
      updatedAt: '2026-07-16T08:03:00.000Z', expectedUpdatedAt: materialized.updatedAt
    });
    const archived = await store.transitionReaderTransfer(dataRoot, 'transfer-1', 'archived', {
      updatedAt: '2026-07-16T08:04:00.000Z', expectedUpdatedAt: consumed.updatedAt
    });
    assert.strictEqual(archived.lifecycle, 'archived');
    assert.strictEqual(await fileDigest(paths.readerTransferSnapshotTextPath(dataRoot, 'transfer-1')), firstDigest, 'lifecycle changes must not rewrite snapshot text');

    await store.createReaderTransfer(dataRoot, transferInput('protected-transfer'));
    await store.addReaderTransferConsumer(dataRoot, 'protected-transfer', {
      consumerId: 'pending-consumer', destination: 'compendium', referenceId: 'pending', createdAt: '2026-07-16T09:01:00.000Z'
    });
    await store.transitionReaderTransfer(dataRoot, 'protected-transfer', 'archived', { updatedAt: '2026-07-16T09:02:00.000Z' });
    const cleanupProtected = await store.cleanupReaderTransferStore(dataRoot, { pruneArchived: true });
    assert.ok(!cleanupProtected.removedArchivedTransferDirs.includes(path.resolve(paths.readerTransferDir(dataRoot, 'protected-transfer'))));
    assert.ok(cleanupProtected.removedArchivedTransferDirs.includes(path.resolve(paths.readerTransferDir(dataRoot, 'transfer-1'))));
    await fs.access(paths.readerTransferSnapshotTextPath(dataRoot, 'protected-transfer'));
    await assert.rejects(() => fs.access(paths.readerTransferDir(dataRoot, 'transfer-1')));

    const incompleteDir = paths.readerTransferDir(dataRoot, 'interrupted-transfer');
    await fs.mkdir(incompleteDir, { recursive: true });
    await fs.writeFile(path.join(incompleteDir, 'snapshot.txt'), 'orphan snapshot', 'utf8');
    const tempFile = path.join(paths.readerTransfersDir(dataRoot), `envelope.json.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(tempFile, 'temp', 'utf8');
    const cleanup = await store.cleanupReaderTransferStore(dataRoot, { pruneArchived: true });
    assert.ok(cleanup.removedIncompleteTransferDirs.includes(path.resolve(incompleteDir)));
    assert.ok(cleanup.removedTempFiles.includes(tempFile));

    const tampered = await store.createReaderTransfer(dataRoot, transferInput('tampered-transfer'));
    await fs.writeFile(paths.readerTransferSnapshotTextPath(dataRoot, 'tampered-transfer'), '篡改正文', 'utf8');
    await assert.rejects(
      () => store.readReaderTransfer(dataRoot, tampered.envelope.envelopeId),
      (error) => error instanceof store.ReaderTransferCorruptionError
    );
    const corruptCleanup = await store.cleanupReaderTransferStore(dataRoot, { pruneArchived: true });
    assert.ok(corruptCleanup.corruptTransferDirs.includes(path.resolve(paths.readerTransferDir(dataRoot, 'tampered-transfer'))));
    await fs.access(paths.readerTransferDir(dataRoot, 'tampered-transfer'));

    console.log('Reader transfer store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader transfer store tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
