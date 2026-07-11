const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-test-'));
    const fixturePath = path.join(dataRoot, 'reader-fixture.md');
    let servers = null;
    let browser = null;

    try {
        await fs.writeFile(
            fixturePath,
            [
                '# Chapter One',
                '',
                'First paragraph.',
                '',
                'Second paragraph.',
                '',
                '# Chapter Two',
                '',
                'New chapter content.',
                '',
                ...Array.from({ length: 90 }, (_, index) => `Long reading paragraph ${index + 1}. This text makes the reader content scroll.`)
            ].join('\n'),
            'utf8'
        );

        servers = await startDesktopServers({
            appRoot: path.resolve(__dirname, '..'),
            dataRoot,
            revealPath: async () => ''
        });

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        await page.goto(servers.appUrl + '/desktop.html', { waitUntil: 'domcontentloaded' });
        await page.click('[data-view-target="reader"]');
        await page.setInputFiles('[data-reader-file]', fixturePath);
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter One'));

        const initial = await page.evaluate(() => ({
            title: document.querySelector('[data-reader-title]').textContent,
            source: document.querySelector('[data-reader-source]').textContent,
            chapters: Array.from(document.querySelectorAll('.desktop-reader-chapter')).map((item) => item.textContent),
            progress: document.querySelector('[data-reader-progress-percent]').textContent,
            body: document.querySelector('[data-reader-content]').textContent
        }));
        assert.strictEqual(initial.title, 'Chapter One', 'reader should show the first detected chapter');
        assert.ok(initial.source.includes('reader-fixture'), 'reader should show the imported file title');
        assert.deepStrictEqual(initial.chapters, ['Chapter One', 'Chapter Two'], 'reader should detect markdown chapters');
        assert.strictEqual(initial.progress, '1%', 'reader progress should start at the beginning of the book');
        assert.ok(initial.body.includes('First paragraph.') && initial.body.includes('Second paragraph.'), 'reader should render chapter paragraphs');

        await page.click('[data-reader-next]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter Two'));
        await page.waitForFunction(() => document.querySelector('[data-reader-progress-percent]').textContent === '50%');
        assert.strictEqual(await page.locator('[data-reader-progress-percent]').innerText(), '50%', 'reader progress should update on chapter change');

        await page.fill('[data-reader-font-size]', '22');
        await page.fill('[data-reader-line-height]', '2');
        await page.fill('[data-reader-width]', '840');
        await page.fill('[data-reader-paragraph-spacing]', '1.3');
        await page.selectOption('[data-reader-font-family]', 'serif');
        await page.selectOption('[data-reader-theme]', 'paper');
        await page.locator('[data-reader-indent]').setChecked(false);
        await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = content.scrollHeight - content.clientHeight;
            requestAnimationFrame(() => content.dispatchEvent(new Event('scroll')));
        });
        await page.waitForFunction(() => document.querySelector('[data-reader-progress-percent]').textContent === '100%');
        await page.waitForFunction(() => {
            const saved = JSON.parse(localStorage.getItem('draftharbor:desktop:reader'));
            return Object.values(saved.scrollPositions || {}).some((value) => Number(value) > 0.9);
        });
        const settings = await page.evaluate(() => {
            const panel = document.querySelector('[data-reader-theme-panel]');
            return {
                theme: panel.dataset.readerTheme,
                indent: panel.dataset.readerIndentEnabled,
                fontSize: panel.style.getPropertyValue('--reader-font-size'),
                lineHeight: panel.style.getPropertyValue('--reader-line-height'),
                textWidth: panel.style.getPropertyValue('--reader-width'),
                paragraphSpacing: panel.style.getPropertyValue('--reader-paragraph-spacing'),
                fontFamily: panel.style.getPropertyValue('--reader-font-family'),
                progress: document.querySelector('[data-reader-progress-percent]').textContent,
                saved: JSON.parse(localStorage.getItem('draftharbor:desktop:reader'))
            };
        });
        assert.strictEqual(settings.theme, 'paper', 'reader theme should apply to the panel');
        assert.strictEqual(settings.indent, 'false', 'reader indent toggle should apply to the panel');
        assert.strictEqual(settings.fontSize, '22px', 'reader font size should update the panel CSS variable');
        assert.strictEqual(settings.lineHeight, '2', 'reader line height should update the panel CSS variable');
        assert.strictEqual(settings.textWidth, '840px', 'reader width should update the panel CSS variable');
        assert.strictEqual(settings.paragraphSpacing, '1.3em', 'reader paragraph spacing should update the panel CSS variable');
        assert.ok(settings.fontFamily.includes('SimSun'), 'reader font family should update the panel CSS variable');
        assert.strictEqual(settings.progress, '100%', 'reader progress should reach the end after scrolling down');
        assert.strictEqual(settings.saved.chapterIndex, 1, 'reader progress should be persisted');
        assert.strictEqual(settings.saved.theme, 'paper', 'reader settings should be persisted');
        assert.strictEqual(settings.saved.textWidth, 840, 'reader width should be persisted');
        assert.strictEqual(settings.saved.indent, false, 'reader indent preference should be persisted');
        assert.ok(Object.keys(settings.saved.scrollPositions).length > 0, 'reader scroll position should be persisted');
        assert.ok(Object.values(settings.saved.scrollPositions).some((value) => Number(value) > 0.9), 'reader should persist a near-end scroll position');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter Two'));
        await page.waitForFunction(() => document.querySelector('[data-reader-progress-percent]').textContent === '100%');
        assert.strictEqual(await page.locator('[data-reader-progress-percent]').innerText(), '100%', 'reader should restore persisted progress after reload');

        console.log('Desktop reader test passed.');
    } finally {
        if (browser) await browser.close();
        if (servers) servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('Desktop reader test failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
