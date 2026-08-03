const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const readerStore = require('../desktop/storage/reader-document-store');
const paths = require('../desktop/storage/library-paths');
const { createReaderLibraryService } = require('../desktop/services/reader-library-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-library-'));
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-sources-'));
  try {
    const service = createReaderLibraryService({ clock: () => '2026-07-15T08:00:00.000Z' });
    const markdownBytes = Buffer.from([
      '# 第一章',
      '',
      '第一段。',
      '',
      '第二段。',
      '',
      '<script src="https://invalid.example/x.js">不会执行</script>',
      '',
      '![远程图片](https://invalid.example/image.png)',
      '',
      '## 第二章',
      '',
      '第二章正文。'
    ].join('\r\n'), 'utf8');
    const markdownPath = path.join(sourceRoot, 'novel.md');
    await fs.writeFile(markdownPath, markdownBytes);

    let draft = await service.previewFileImport({
      draftId: 'file-draft',
      filePath: markdownPath,
      createdAt: '2026-07-15T08:00:00.000Z'
    });
    assert.strictEqual(draft.format, 'md');
    assert.strictEqual(draft.encodingPreview.encoding, 'utf-8');
    assert.strictEqual(draft.chapters.length, 2);
    assert.ok(draft.chapters[0].blocks.some((block) => block.text.includes('<script')));
    assert.ok(draft.chapters[0].blocks.every((block) => !Object.hasOwn(block, 'html')));
    assert.strictEqual((await readerStore.listReaderDocuments(dataRoot)).documents.length, 0, 'preview must not enter the formal index');

    const byteDraft = await service.previewBytesImport({
      draftId: 'browser-bytes-draft',
      originalFileName: 'browser-book.txt',
      bytes: Buffer.from('第一章\n\n浏览器导入正文。', 'utf8').toString('base64'),
      createdAt: '2026-07-15T08:30:00.000Z'
    });
    assert.strictEqual(byteDraft.sourceKind, 'local-text');
    assert.strictEqual(byteDraft.chapters[0].blocks[0].text, '浏览器导入正文。');
    const byteCommit = await service.confirmImportDraft(dataRoot, 'browser-bytes-draft', {
      documentId: 'browser-bytes-book',
      revisionId: 'browser-bytes-book-r1',
      createdAt: '2026-07-15T08:31:00.000Z'
    });
    assert.strictEqual(byteCommit.sourceCopied, true);
    assert.deepStrictEqual(await fs.readFile(byteCommit.sourceCopy), Buffer.from('第一章\n\n浏览器导入正文。', 'utf8'));

    draft = service.correctImportDraft('file-draft', { title: '校正后的书名' });
    draft = service.splitImportChapter('file-draft', {
      chapterId: draft.chapters[0].chapterId,
      blockIndex: 1,
      beforeTitle: '第一章上',
      afterTitle: '第一章下'
    });
    assert.strictEqual(draft.chapters.length, 3);
    const splitIds = draft.chapters.slice(0, 2).map((chapter) => chapter.chapterId);
    draft = service.mergeImportChapters('file-draft', { chapterIds: splitIds, title: '第一章（合并）' });
    assert.strictEqual(draft.chapters.length, 2);
    assert.strictEqual(draft.chapters[0].title, '第一章（合并）');
    assert.deepStrictEqual(draft.chapters[0].blocks.map((block) => block.order), [0, 1, 2, 3]);

    const committed = await service.confirmImportDraft(dataRoot, 'file-draft', {
      documentId: 'imported-novel',
      revisionId: 'imported-novel-r1',
      createdAt: '2026-07-15T09:00:00.000Z'
    });
    assert.strictEqual(committed.reimported, false);
    assert.strictEqual(committed.sourceCopied, true);
    assert.strictEqual(service.getImportDraft('file-draft'), null);
    assert.deepStrictEqual(await fs.readFile(committed.sourceCopy), markdownBytes);
    await fs.rm(markdownPath);
    const reopened = await readerStore.readReaderDocument(dataRoot, 'imported-novel');
    assert.strictEqual(reopened.metadata.activeRevisionId, 'imported-novel-r1');
    assert.strictEqual(reopened.revision.chapters[0].title, '第一章（合并）');

    const secondPath = path.join(sourceRoot, 'novel-v2.md');
    await fs.writeFile(secondPath, '# 第一章\n\n重导入后的正文。', 'utf8');
    await service.previewFileImport({ draftId: 'reimport-draft', filePath: secondPath, createdAt: '2026-07-15T10:00:00.000Z' });
    const reimported = await service.confirmImportDraft(dataRoot, 'reimport-draft', {
      reimportDocumentId: 'imported-novel',
      revisionId: 'imported-novel-r2',
      createdAt: '2026-07-15T10:00:00.000Z',
      expectedUpdatedAt: committed.metadata.updatedAt
    });
    assert.strictEqual(reimported.reimported, true);
    assert.strictEqual(reimported.revision.parentRevisionId, 'imported-novel-r1');
    assert.strictEqual(reimported.metadata.activeRevisionId, 'imported-novel-r2');
    assert.strictEqual(reimported.metadata.revisions.length, 2);
    assert.notStrictEqual(reimported.sourceCopy, committed.sourceCopy);

    const failurePath = path.join(sourceRoot, 'novel-failure.md');
    await fs.writeFile(failurePath, '# 第一章\n\n不应激活。', 'utf8');
    const failingStore = {
      ...readerStore,
      appendReaderDocumentRevision: async () => { throw new Error('simulated revision commit failure'); }
    };
    const failingService = createReaderLibraryService({
      store: failingStore,
      clock: () => '2026-07-15T11:00:00.000Z'
    });
    await failingService.previewFileImport({ draftId: 'failed-reimport', filePath: failurePath });
    await assert.rejects(() => failingService.confirmImportDraft(dataRoot, 'failed-reimport', {
      reimportDocumentId: 'imported-novel',
      revisionId: 'imported-novel-r3'
    }), /simulated revision commit failure/);
    const afterFailure = await readerStore.readReaderDocumentMetadata(dataRoot, 'imported-novel');
    assert.strictEqual(afterFailure.activeRevisionId, 'imported-novel-r2');
    assert.ok(failingService.getImportDraft('failed-reimport'), 'failed confirmation must keep its draft retryable');
    await assert.rejects(
      () => fs.access(paths.readerDocumentSourceRevisionPath(dataRoot, 'imported-novel', 'imported-novel-r3', 'md')),
      (error) => error.code === 'ENOENT'
    );

    const gbPath = path.join(sourceRoot, 'legacy.txt');
    await fs.writeFile(gbPath, Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]));
    let gbDraft = await service.previewFileImport({ draftId: 'gb-draft', filePath: gbPath });
    assert.strictEqual(gbDraft.encodingPreview.requiresEncodingConfirmation, true);
    gbDraft = service.retryImportDraft('gb-draft', { encoding: 'gbk' });
    assert.strictEqual(gbDraft.encodingPreview.encoding, 'gb18030');
    assert.strictEqual(gbDraft.chapters[0].blocks[0].text, '中文');

    let pasted = service.previewPastedImport({
      draftId: 'paste-draft',
      title: '临时粘贴',
      format: 'plain',
      text: '# 标题\n\n正文'
    });
    assert.strictEqual((await readerStore.listReaderDocuments(dataRoot)).documents.length, 2, 'temporary pasted text must not be indexed');
    pasted = service.retryImportDraft('paste-draft', { format: 'md' });
    assert.strictEqual(pasted.chapters[0].title, '标题');
    const pastedCommit = await service.confirmImportDraft(dataRoot, 'paste-draft', {
      documentId: 'saved-paste',
      revisionId: 'saved-paste-r1',
      createdAt: '2026-07-15T12:00:00.000Z'
    });
    assert.strictEqual(pastedCommit.sourceCopied, false);
    assert.strictEqual((await readerStore.listReaderDocuments(dataRoot)).documents.length, 3);

    const empty = service.previewPastedImport({ draftId: 'empty-paste', text: '  \r\n  ' });
    assert.ok(empty.warnings.includes('empty-content'));
    await assert.rejects(() => service.confirmImportDraft(dataRoot, 'empty-paste', {
      documentId: 'empty-paste', revisionId: 'empty-paste-r1'
    }), /content must not be empty/);

    const longPath = path.join(sourceRoot, 'long.txt');
    await fs.writeFile(longPath, '长'.repeat(100000), 'utf8');
    const longDraft = await service.previewFileImport({ draftId: 'long-draft', filePath: longPath });
    assert.strictEqual(longDraft.characterCount, 100000);
    await assert.rejects(
      () => createReaderLibraryService({ maxImportBytes: 4 }).previewFileImport({ filePath: longPath }),
      /exceeds 4 bytes/
    );
    const unsupportedPath = path.join(sourceRoot, 'book.pdf');
    await fs.writeFile(unsupportedPath, 'pdf', 'utf8');
    await assert.rejects(() => service.previewFileImport({ filePath: unsupportedPath }), /not supported/);

    console.log('Reader library service tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
    await fs.rm(sourceRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader library service tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
