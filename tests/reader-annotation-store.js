const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const paths = require('../desktop/storage/library-paths');
const store = require('../desktop/storage/reader-annotation-store');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-annotations-'));
  try {
    const annotationPath = path.resolve(paths.readerDocumentAnnotationsPath(dataRoot, '../../outside'));
    assert.ok(annotationPath.startsWith(`${path.resolve(paths.readerAnnotationsDir(dataRoot))}${path.sep}`));

    const first = await store.upsertReaderAnnotation(dataRoot, {
      annotationId: 'annotation-1',
      documentId: 'reader-book',
      revisionId: 'revision-1',
      type: 'note',
      color: 'blue',
      range: { start: { chapterId: 'chapter-1', blockId: 'block-1', offset: 2 }, end: { chapterId: 'chapter-1', blockId: 'block-1', offset: 8 } },
      excerpt: '一段摘录',
      note: '第一条批注'
    }, { updatedAt: '2026-08-04T08:00:00.000Z' });
    assert.strictEqual(first.annotations.length, 1);
    assert.strictEqual((await store.readReaderAnnotations(dataRoot, 'reader-book')).annotations[0].note, '第一条批注');

    const updated = await store.upsertReaderAnnotation(dataRoot, {
      annotationId: 'annotation-1',
      documentId: 'reader-book',
      revisionId: 'revision-1',
      range: first.annotations[0].range,
      note: '修改后的批注'
    }, { expectedUpdatedAt: first.updatedAt, updatedAt: '2026-08-04T08:01:00.000Z' });
    assert.strictEqual(updated.annotations[0].createdAt, first.annotations[0].createdAt);
    assert.strictEqual(updated.annotations[0].note, '修改后的批注');

    await assert.rejects(
      () => store.upsertReaderAnnotation(dataRoot, { ...updated.annotations[0], note: '冲突写入' }, {
        expectedUpdatedAt: first.updatedAt,
        updatedAt: '2026-08-04T08:02:00.000Z'
      }),
      (error) => error instanceof store.ReaderAnnotationConflictError
    );

    const removed = await store.deleteReaderAnnotation(dataRoot, 'reader-book', 'annotation-1', {
      expectedUpdatedAt: updated.updatedAt,
      updatedAt: '2026-08-04T08:03:00.000Z'
    });
    assert.strictEqual(removed.deleted, true);
    assert.strictEqual(removed.record.annotations.length, 0);

    let historyRecord = null;
    for (let index = 0; index < 105; index += 1) {
      historyRecord = await store.appendReaderPositionHistory(dataRoot, {
        documentId: 'reader-book',
        revisionId: 'revision-1',
        locator: { chapterId: 'chapter-1', blockId: 'block-1', offset: index },
        visitedAt: new Date(Date.UTC(2026, 7, 4, 9, index)).toISOString()
      }, { updatedAt: new Date(Date.UTC(2026, 7, 4, 10, index)).toISOString() });
    }
    assert.strictEqual(historyRecord.history.items.length, 100);
    assert.strictEqual(historyRecord.history.items[0].locator.offset, 5);
    assert.strictEqual((await store.readReaderPositionHistory(dataRoot)).history.items[99].locator.offset, 104);

    console.log('Reader annotation store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader annotation store tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
