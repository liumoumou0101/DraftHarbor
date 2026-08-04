const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const store = require('../desktop/storage/reader-library-view-store');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-library-view-'));
  try {
    assert.strictEqual(await store.readReaderLibraryView(dataRoot), null);
    const first = await store.writeReaderLibraryView(dataRoot, { viewMode: 'list', favoriteDocumentIds: ['book-1'] }, { updatedAt: '2026-08-04T08:00:00.000Z' });
    assert.strictEqual(first.view.viewMode, 'list');
    assert.strictEqual((await store.readReaderLibraryView(dataRoot)).view.favoriteDocumentIds[0], 'book-1');
    await assert.rejects(
      () => store.writeReaderLibraryView(dataRoot, { viewMode: 'grid' }, { expectedUpdatedAt: '2026-08-04T07:00:00.000Z', updatedAt: '2026-08-04T08:01:00.000Z' }),
      (error) => error instanceof store.ReaderLibraryViewConflictError
    );
    console.log('Reader library view store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader library view store tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
