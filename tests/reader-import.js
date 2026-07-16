const assert = require('assert');
const crypto = require('crypto');

const ReaderImport = require('../src/core/document/reader-import');

function digest(value) {
    return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function utf16beWithBom(text) {
    const littleEndian = Buffer.from(text, 'utf16le');
    const bigEndian = Buffer.alloc(littleEndian.length + 2);
    bigEndian[0] = 0xFE;
    bigEndian[1] = 0xFF;
    for (let index = 0; index < littleEndian.length; index += 2) {
        bigEndian[index + 2] = littleEndian[index + 1];
        bigEndian[index + 3] = littleEndian[index];
    }
    return bigEndian;
}

const utf8 = ReaderImport.decodeReaderBytes(Buffer.from('\uFEFF第一章\r\n正文', 'utf8'));
assert.strictEqual(utf8.encoding, 'utf-8');
assert.strictEqual(utf8.text, '第一章\n正文');
assert.strictEqual(utf8.requiresEncodingConfirmation, false);

const utf16leBytes = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('第一章\r\n正文', 'utf16le')]);
const utf16le = ReaderImport.decodeReaderBytes(utf16leBytes);
assert.strictEqual(utf16le.encoding, 'utf-16le');
assert.strictEqual(utf16le.text, '第一章\n正文');

const utf16be = ReaderImport.decodeReaderBytes(utf16beWithBom('第一章\r\n正文'));
assert.strictEqual(utf16be.encoding, 'utf-16be');
assert.strictEqual(utf16be.text, '第一章\n正文');

const gb18030 = ReaderImport.decodeReaderBytes(Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]), 'gbk');
assert.strictEqual(gb18030.encoding, 'gb18030');
assert.strictEqual(gb18030.text, '中文');
assert.strictEqual(gb18030.detectionReason, 'manual-selection');

const undecided = ReaderImport.decodeReaderBytes(Buffer.from([0xFF, 0x81, 0x80]));
assert.strictEqual(undecided.encoding, '');
assert.strictEqual(undecided.requiresEncodingConfirmation, true);
assert.ok(undecided.supportedEncodings.includes('gb18030'));

const markdown = [
    '# 第一章',
    '',
    '第一段。',
    '',
    '<script>alert("不会执行")</script>',
    '',
    '```js',
    'const safe = true;',
    '```',
    '',
    '## 第二章',
    '',
    '第二段。'
].join('\r\n');
const parsed = ReaderImport.parseReaderText(markdown, { format: 'md', fileName: 'novel.md' });
assert.strictEqual(parsed.title, 'novel');
assert.strictEqual(parsed.chapters.length, 2);
assert.strictEqual(parsed.chapters[0].title, '第一章');
assert.ok(parsed.chapters[0].blocks.some((block) => block.text.includes('<script>')), 'raw HTML should remain inert text data');
assert.ok(parsed.chapters[0].blocks.every((block) => !Object.hasOwn(block, 'html')), 'import blocks must not expose executable HTML');
assert.strictEqual(parsed.chapters[0].blocks.find((block) => block.type === 'code').text, 'const safe = true;');

const draft = ReaderImport.createReaderImportDraft({
    draftId: 'draft-1',
    sourceKind: 'local-text',
    format: 'md',
    fileName: 'novel.md',
    bytes: Buffer.from(markdown, 'utf8'),
    createdAt: '2026-07-15T08:00:00.000Z'
});
assert.strictEqual(draft.kind, 'reader-import-draft');
assert.strictEqual(draft.chapters.length, 2);
assert.strictEqual(draft.encodingPreview.encoding, 'utf-8');
assert.strictEqual(draft.warnings.length, 0);

const corrected = ReaderImport.applyReaderImportCorrections(draft, {
    title: '校正书名',
    chapters: draft.chapters.map((chapter, index) => ({
        ...chapter,
        title: index === 0 ? '序章' : chapter.title
    }))
});
assert.strictEqual(corrected.title, '校正书名');
assert.strictEqual(corrected.chapters[0].title, '序章');
assert.strictEqual(corrected.chapters[0].order, 0);

const confirmed = ReaderImport.confirmReaderImportDraft(corrected, {
    documentId: 'reader-book-1',
    revisionId: 'reader-revision-1',
    createdAt: '2026-07-15T09:00:00.000Z'
}, { digest });
assert.strictEqual(confirmed.document.schemaVersion, 2);
assert.strictEqual(confirmed.document.sourceKind, 'local-text');
assert.strictEqual(confirmed.document.activeRevisionId, 'reader-revision-1');
assert.strictEqual(confirmed.revision.chapters[0].title, '序章');
assert.ok(confirmed.revision.contentDigest.startsWith('sha256:'));

const pasted = ReaderImport.createReaderImportDraft({
    draftId: 'pasted-1',
    sourceKind: 'pasted-text',
    format: 'plain',
    title: '粘贴设定',
    text: '世界设定\r\n\r\n人物关系',
    createdAt: '2026-07-15T08:00:00.000Z'
});
assert.strictEqual(pasted.encodingPreview.encoding, 'unicode-text');
assert.strictEqual(pasted.chapters.length, 1);
assert.strictEqual(pasted.chapters[0].blocks.length, 2);

const uncertainDraft = ReaderImport.createReaderImportDraft({
    draftId: 'uncertain-1',
    sourceKind: 'local-text',
    format: 'txt',
    fileName: 'legacy.txt',
    bytes: Buffer.from([0xFF, 0x81, 0x80]),
    createdAt: '2026-07-15T08:00:00.000Z'
});
assert.ok(uncertainDraft.warnings.includes('encoding-confirmation-required'));
assert.throws(() => ReaderImport.confirmReaderImportDraft(uncertainDraft, {
    documentId: 'legacy-book',
    revisionId: 'legacy-revision',
    createdAt: '2026-07-15T09:00:00.000Z'
}, { digest }), /encoding must be confirmed/);

const emptyDraft = ReaderImport.createReaderImportDraft({
    draftId: 'empty-1',
    sourceKind: 'pasted-text',
    format: 'plain',
    text: '   \r\n',
    createdAt: '2026-07-15T08:00:00.000Z'
});
assert.ok(emptyDraft.warnings.includes('empty-content'));
assert.throws(() => ReaderImport.confirmReaderImportDraft(emptyDraft, {
    documentId: 'empty-book',
    revisionId: 'empty-revision',
    createdAt: '2026-07-15T09:00:00.000Z'
}, { digest }), /content must not be empty/);

assert.throws(() => ReaderImport.createReaderImportDraft({
    schemaVersion: 2,
    draftId: 'future-draft',
    sourceKind: 'pasted-text',
    format: 'plain',
    text: '正文',
    createdAt: '2026-07-15T08:00:00.000Z'
}), /schemaVersion must be 1/);
assert.throws(() => ReaderImport.createReaderImportDraft({
    draftId: 'pdf-draft',
    sourceKind: 'local-text',
    format: 'pdf',
    bytes: Buffer.from('pdf'),
    createdAt: '2026-07-15T08:00:00.000Z'
}), /format pdf is not valid/);
assert.throws(() => ReaderImport.createReaderImportDraft({
    draftId: 'pasted-txt-draft',
    sourceKind: 'pasted-text',
    format: 'txt',
    text: '正文',
    createdAt: '2026-07-15T08:00:00.000Z'
}), /format txt is not valid/);

console.log('Reader import tests passed.');
