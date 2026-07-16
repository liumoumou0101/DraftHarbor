const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const paths = require('../desktop/storage/library-paths');
const stateStore = require('../desktop/storage/reader-state-store');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-state-'));

  try {
    const externalPath = path.resolve(paths.readerDocumentStatePath(dataRoot, '../../external-book'));
    const readerRoot = path.resolve(paths.readerDocumentsDir(dataRoot));
    assert.ok(externalPath.startsWith(`${readerRoot}${path.sep}`));
    assert.ok(paths.readerDocumentStatePath(dataRoot, 'project:project-1').includes(`${path.sep}project-states${path.sep}`));
    assert.notStrictEqual(
      paths.readerDocumentStatePath(dataRoot, 'same:name'),
      paths.readerDocumentStatePath(dataRoot, 'same?name')
    );

    const firstState = await stateStore.writeReaderDocumentState(dataRoot, {
      documentId: 'external-book',
      updatedAt: '2026-07-15T08:00:00.000Z',
      positionLocator: { documentId: 'external-book', revisionId: 'revision-1', chapterId: 'chapter-1', blockId: 'block-1', offset: 5 },
      preferenceOverrides: { fontFamilyId: 'serif' },
      document: '整本正文不应进入状态文件',
      bookmarks: [{
        bookmarkId: 'bookmark-1',
        title: '开头',
        excerpt: '短摘录',
        locator: { chapterId: 'chapter-1', blockId: 'block-1', offset: 0 },
        createdAt: '2026-07-15T08:00:00.000Z'
      }]
    });
    assert.strictEqual(firstState.bookmarks.length, 1);
    assert.strictEqual((await stateStore.readReaderDocumentState(dataRoot, 'external-book')).positionLocator.offset, 5);

    await assert.rejects(
      () => stateStore.writeReaderDocumentState(dataRoot, {
        ...firstState,
        updatedAt: '2026-07-15T09:00:00.000Z'
      }, { expectedUpdatedAt: '2026-07-15T07:00:00.000Z' }),
      (error) => error instanceof stateStore.ReaderStateConflictError
    );

    const concurrentStates = await Promise.allSettled([
      stateStore.writeReaderDocumentState(dataRoot, {
        ...firstState,
        updatedAt: '2026-07-15T09:00:00.000Z',
        positionLocator: { ...firstState.positionLocator, offset: 8 }
      }, { expectedUpdatedAt: firstState.updatedAt }),
      stateStore.writeReaderDocumentState(dataRoot, {
        ...firstState,
        updatedAt: '2026-07-15T09:30:00.000Z',
        positionLocator: { ...firstState.positionLocator, offset: 9 }
      }, { expectedUpdatedAt: firstState.updatedAt })
    ]);
    assert.strictEqual(concurrentStates.filter((result) => result.status === 'fulfilled').length, 1);
    assert.strictEqual(concurrentStates.filter((result) => result.status === 'rejected').length, 1);
    assert.ok(concurrentStates.find((result) => result.status === 'rejected').reason instanceof stateStore.ReaderStateConflictError);

    const projectState = await stateStore.writeReaderDocumentState(dataRoot, {
      documentId: 'project:project-1',
      updatedAt: '2026-07-15T10:00:00.000Z',
      positionLocator: { chapterId: 'chapter-1', blockId: 'block-1', offset: 0 },
      bookmarks: []
    });
    assert.strictEqual(projectState.documentId, 'project:project-1');
    assert.strictEqual((await stateStore.readReaderDocumentState(dataRoot, 'project:project-1')).documentId, 'project:project-1');

    const preferences = await stateStore.writeReaderGlobalPreferences(dataRoot, {
      layoutMode: 'double-page',
      pageTransition: 'none',
      themeId: 'paper',
      fontFamilyId: 'serif',
      fontSize: 22
    }, { updatedAt: '2026-07-15T08:00:00.000Z' });
    assert.strictEqual(preferences.preferences.layoutMode, 'double-page');
    assert.strictEqual((await stateStore.readReaderGlobalPreferences(dataRoot)).preferences.fontSize, 22);
    await assert.rejects(
      () => stateStore.writeReaderGlobalPreferences(dataRoot, { layoutMode: 'flow' }, {
        expectedUpdatedAt: '2026-07-15T07:00:00.000Z',
        updatedAt: '2026-07-15T09:00:00.000Z'
      }),
      (error) => error instanceof stateStore.ReaderStateConflictError
    );

    const stateText = await fs.readFile(paths.readerDocumentStatePath(dataRoot, 'external-book'), 'utf8');
    assert.ok(!stateText.includes('整本正文不应进入状态文件'));
    assert.ok(stateText.length < 5000, 'reader state should remain metadata-sized');

    console.log('Reader state store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader state store tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
