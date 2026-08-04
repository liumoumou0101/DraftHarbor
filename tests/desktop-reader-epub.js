/* global readerState */

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

async function createFixture(target) {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
    zip.file('OPS/book.opf', '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">桌面 EPUB 试读</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
    zip.file('OPS/one.xhtml', '<html><body><h1>第一章</h1><p>桌面 EPUB 第一段。</p><p><strong>强调内容。</strong></p></body></html>');
    zip.file('OPS/two.xhtml', '<html><body><h1>第二章</h1><p>桌面 EPUB 第二段。</p></body></html>');
    await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-epub-ui-'));
    const fixturePath = path.join(dataRoot, 'desktop-book.epub');
    let servers;
    let browser;
    try {
        await createFixture(fixturePath);
        servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
        await page.click('[data-view-target="reader"]');
        await page.setInputFiles('[data-reader-file]', fixturePath);
        await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]')?.open === true);
        assert.strictEqual(await page.locator('[data-reader-import-file-name]').textContent(), 'desktop-book.epub');
        await page.waitForFunction(() => document.querySelector('[data-reader-import-summary]')?.textContent.includes('2 章'));
        await page.click('[data-reader-import-confirm]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('第一章'));
        await page.waitForFunction(() => readerState.apiMode && readerState.contents.length === 2);
        const content = await page.locator('[data-reader-content]').innerText();
        assert.ok(content.includes('桌面 EPUB 第一段。') && content.includes('强调内容。'));
        const documents = await (await fetch(`${servers.appUrl}/api/reader/documents`)).json();
        assert.strictEqual(documents.documents[0].format, 'epub');
        assert.strictEqual(documents.documents[0].title, '桌面 EPUB 试读');
        assert.strictEqual(documents.documents[0].originalFileName, 'desktop-book.epub');
        console.log('Desktop EPUB reader tests passed.');
    } finally {
        if (browser) await browser.close();
        if (servers) servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('Desktop EPUB reader tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
