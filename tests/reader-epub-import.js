const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const paths = require('../desktop/storage/library-paths');
const readerStore = require('../desktop/storage/reader-document-store');
const { createReaderLibraryService } = require('../desktop/services/reader-library-service');

async function createFixture() {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
    zip.file('OPS/book.opf', '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">本地 EPUB</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
    zip.file('OPS/chapter.xhtml', '<html><body><h1>第一章</h1><p>EPUB 正文已进入 Reader Document。</p></body></html>');
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-epub-'));
    try {
        const service = createReaderLibraryService({ clock: () => '2026-08-04T09:00:00.000Z' });
        const bytes = await createFixture();
        const draft = await service.previewBytesImport({
            draftId: 'epub-draft',
            originalFileName: 'local-book.epub',
            bytes: bytes.toString('base64')
        });
        assert.strictEqual(draft.format, 'epub');
        assert.strictEqual(draft.encodingPreview.encoding, 'epub');
        assert.strictEqual(draft.title, '本地 EPUB');
        assert.strictEqual(draft.chapters[0].blocks[0].text, '第一章');
        const committed = await service.confirmImportDraft(dataRoot, 'epub-draft', {
            documentId: 'epub-book',
            revisionId: 'epub-book-r1'
        });
        assert.strictEqual(committed.sourceCopied, true);
        assert.match(committed.sourceCopy, /\.epub$/);
        assert.deepStrictEqual(await fs.readFile(committed.sourceCopy), bytes);
        const document = await readerStore.readReaderDocument(dataRoot, 'epub-book');
        assert.strictEqual(document.metadata.format, 'epub');
        assert.strictEqual(document.revision.chapters[0].title, '第一章');
        assert.strictEqual((await readerStore.listReaderDocuments(dataRoot)).documents.length, 1);
        assert.throws(() => service.retryImportDraft('missing-draft', { encoding: 'utf-8' }), /not found/);
        await fs.access(paths.readerDocumentSourceRevisionPath(dataRoot, 'epub-book', 'epub-book-r1', 'epub'));
        console.log('Reader EPUB import tests passed.');
    } finally {
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('Reader EPUB import tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
