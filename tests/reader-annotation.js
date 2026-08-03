const assert = require('assert');
const Annotation = require('../src/core/document/reader-annotation');

const createdAt = '2026-08-04T08:00:00.000Z';
const item = Annotation.createReaderAnnotation({
  annotationId: 'a1',
  documentId: 'book-1',
  revisionId: 'r1',
  type: 'note',
  color: 'blue',
  range: { start: { chapterId: 'c1', blockId: 'b1', offset: 0 }, end: { chapterId: 'c1', blockId: 'b1', offset: 4 } },
  excerpt: '正文',
  note: '重要伏笔',
  createdAt
});
assert.strictEqual(item.schemaVersion, 1);
assert.strictEqual(item.note, '重要伏笔');
assert.throws(() => Annotation.createReaderAnnotation({ annotationId: 'bad', documentId: 'book-1', revisionId: 'r1', range: {} }), /updatedAt/);
const history = Annotation.createReaderPositionHistory({ items: [{ documentId: 'book-1', revisionId: 'r1', locator: item.range.start, visitedAt: createdAt }] });
const next = Annotation.appendReaderPositionHistory(history, { documentId: 'book-2', revisionId: 'r2', locator: null, visitedAt: createdAt });
assert.strictEqual(next.items.length, 2);
assert.strictEqual(next.maxItems, 100);
const bounded = Annotation.createReaderPositionHistory({ items: Array.from({ length: 120 }, (_, index) => ({ documentId: `book-${index}`, visitedAt: createdAt })) });
assert.strictEqual(bounded.items.length, 100);

console.log('Reader annotation tests passed.');
