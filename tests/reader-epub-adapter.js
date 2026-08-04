const assert = require('assert');
const JSZip = require('jszip');

const Adapter = require('../src/core/document/reader-epub-adapter');

async function createEpub(files, options = {}) {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    Object.entries(files).forEach(([name, content]) => zip.file(name, content));
    return zip.generateAsync({ type: 'nodebuffer', compression: options.compression || 'DEFLATE' });
}

(async () => {
    const bytes = await createEpub({
        'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'OPS/content.opf': [
            '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">潮汐之书</dc:title></metadata>',
            '<manifest><item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="image" href="images/lighthouse.png" media-type="image/png"/></manifest>',
            '<spine><itemref idref="one"/><itemref idref="two"/></spine></package>'
        ].join(''),
        'OPS/text/one.xhtml': [
            '<html><head><title>潮汐序章</title><style>body { color: red; }</style></head><body>',
            '<h1>第一章</h1><p>你好 <em>世界</em>。</p><p><img src="../images/lighthouse.png" alt="灯塔"/></p>',
            '<p><img src="https://invalid.example/remote.png" alt="远程图"/></p><script>alert("不应进入正文")</script>',
            '</body></html>'
        ].join(''),
        'OPS/text/two.xhtml': '<html><body><h2>第二章</h2><pre>保留\n代码</pre><blockquote>引用内容</blockquote></body></html>',
        'OPS/images/lighthouse.png': Buffer.from([0, 1, 2, 3])
    }, { compression: 'DEFLATE' });
    const parsed = await Adapter.parseEpub(bytes, { fileName: 'tide.epub' });
    assert.strictEqual(parsed.title, '潮汐之书');
    assert.deepStrictEqual(parsed.chapters.map((chapter) => chapter.title), ['第一章', '第二章']);
    assert.ok(parsed.chapters[0].blocks.some((block) => block.text === '图片：灯塔'));
    assert.ok(parsed.chapters[1].blocks.some((block) => block.type === 'code' && block.text.includes('保留')));
    assert.ok(parsed.warnings.includes('remote-resource-stripped'));
    assert.ok(parsed.warnings.includes('unsafe-markup-stripped'));
    assert.ok(parsed.chapters.every((chapter) => chapter.blocks.every((block) => !Object.hasOwn(block, 'html'))));
    assert.ok(parsed.chapters.every((chapter) => chapter.blocks.every((block) => !/https?:\/\//i.test(block.text))));

    assert.throws(() => Adapter.safeArchivePath('../outside.xhtml'), /unsafe/);
    assert.throws(() => Adapter.safeArchivePath('/outside.xhtml'), /unsafe/);
    assert.throws(() => Adapter.resolveInternalPath('OPS/content.opf', '../../outside.xhtml'), /escapes/);
    const traversalZip = new JSZip();
    traversalZip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    traversalZip.file('../outside.xhtml', 'should never be readable');
    const traversalBytes = await traversalZip.generateAsync({ type: 'nodebuffer' });
    await assert.rejects(() => Adapter.parseEpub(traversalBytes), /unsafe/);

    const invalid = await createEpub({
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>',
        'OPS/content.opf': '<package/>'
    });
    const invalidZip = await JSZip.loadAsync(invalid);
    invalidZip.file('mimetype', 'not-epub', { compression: 'STORE' });
    const invalidBytes = await invalidZip.generateAsync({ type: 'nodebuffer' });
    await assert.rejects(() => Adapter.parseEpub(invalidBytes), /mimetype is invalid/);

    const oversized = await createEpub({
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>',
        'OPS/content.opf': '<package><manifest><item id="large" href="large.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="large"/></spine></package>',
        'OPS/large.xhtml': 'x'.repeat(200)
    });
    await assert.rejects(() => Adapter.parseEpub(oversized, { maxEntryBytes: 1000, maxMarkupBytes: 100 }), /too large/);

    console.log('Reader EPUB adapter tests passed.');
})().catch((error) => {
    console.error('Reader EPUB adapter tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
