const assert = require('assert');
const View = require('../src/core/document/reader-library-view');

const view = View.createReaderLibraryView({
  viewMode: 'list',
  sortBy: 'progress',
  sourceFilter: 'local-text',
  query: '海',
  favoriteDocumentIds: ['book-1', 'book-1'],
  shelves: [{ shelfId: 'shelf:reading', title: '正在读', documentIds: ['book-1'] }]
});
assert.strictEqual(view.favoriteDocumentIds.length, 1);
assert.strictEqual(view.shelves[0].title, '正在读');

const documents = [
  { documentId: 'book-1', title: '海边', sourceKind: 'local-text', reading: { progress: 40, lastReadAt: '2026-08-04T01:00:00.000Z' } },
  { documentId: 'book-2', title: '山中', sourceKind: 'local-text', reading: { progress: 90, lastReadAt: '2026-08-04T03:00:00.000Z' } },
  { documentId: 'project:1', title: '项目', sourceKind: 'project', reading: { progress: 100 } }
];
assert.deepStrictEqual(View.sortReaderLibraryDocuments(documents, { sourceFilter: 'local-text' }).map((item) => item.documentId), ['book-2', 'book-1']);
assert.deepStrictEqual(View.sortReaderLibraryDocuments(documents, { query: '海' }).map((item) => item.documentId), ['book-1']);
assert.deepStrictEqual(View.sortReaderLibraryDocuments(documents, { selectedShelfId: 'shelf:reading', shelves: view.shelves }).map((item) => item.documentId), ['book-1']);
const largeLibrary = Array.from({ length: 500 }, (_, index) => ({ documentId: 'book-' + index, title: '书籍 ' + index, sourceKind: 'local-text', updatedAt: '2026-08-04T00:00:00.000Z' }));
assert.strictEqual(View.sortReaderLibraryDocuments(largeLibrary, {}).length, 500, 'library query should retain the 500-book performance fixture');
assert.throws(() => View.createReaderLibraryShelf({ shelfId: 'bad' }), /shelfId/);
assert.throws(() => View.createReaderLibraryView({ favoriteDocumentIds: 'book-1' }), /must be an array/);

console.log('Reader library view tests passed.');
