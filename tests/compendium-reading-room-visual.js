// Fully styled, offline acceptance. Run: node tests/compendium-reading-room-visual.js
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, CHARACTER_ID, makeFixture, inlineDesktop, mount } = require('./helpers/compendium-visual-fixture');

const output = path.join(ROOT, 'docs/audits/compendium-reading-room-2026-10-22');
const report = { fixture: 'Nine synthetic 无渡 cards; no user project or model provider.', checks: [], screenshots: [] };

async function inViewport(page, selector, label, fully = true) {
    const bounds = await page.locator(selector).first().boundingBox();
    const viewport = page.viewportSize();
    assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `${label} must be visible`);
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, `${label} must fit horizontally: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.y < viewport.height && bounds.y + bounds.height > 0, `${label} must intersect the viewport`);
    if (fully) assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1, `${label} must fit vertically: ${JSON.stringify(bounds)}`);
}

async function noHorizontalOverflow(page) {
    const overflowing = await page.evaluate(() => [document.documentElement, document.body, ...document.querySelectorAll('#desktop-root, [data-view-panel="compendium"], .desktop-compendium-editor, [data-compendium-scroll], [data-compendium-inspector]:not([hidden]), [data-compendium-peek]:not([hidden])')]
        .filter(node => node.getBoundingClientRect().width > 0 && node.scrollWidth > node.clientWidth + 2)
        .map(node => ({ tag: node.tagName, className: node.className, client: node.clientWidth, scroll: node.scrollWidth })));
    assert.deepStrictEqual(overflowing, [], 'Desktop and compendium containers must not overflow horizontally');
}

async function capture(page, filename) {
    await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
    report.screenshots.push(filename);
}

async function appearanceColors(page) {
    return page.locator('[data-view-panel="compendium"]').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, text: getComputedStyle(node).color }));
}

async function readableMutedText(page) {
    const samples = await page.evaluate(() => [
        document.querySelector('.desktop-compendium-item.is-active .compendium-item-summary'),
        document.querySelector('.desktop-compendium-item.is-active .compendium-item-meta'),
        document.querySelector('.compendium-project-name')
    ].map(node => {
        let parent = node;
        let background = '';
        while (parent) {
            const candidate = getComputedStyle(parent).backgroundColor;
            if (candidate !== 'transparent' && candidate !== 'rgba(0, 0, 0, 0)') { background = candidate; break; }
            parent = parent.parentElement;
        }
        return { selector: node.className, color: getComputedStyle(node).color, background };
    }));
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    for (const sample of samples) {
        const foreground = luminance(sample.color);
        const background = luminance(sample.background);
        sample.contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        assert.ok(sample.contrast >= 4.5, `Small text needs readable contrast: ${JSON.stringify(sample)}`);
    }
    return samples;
}

async function main() {
    await fs.mkdir(output, { recursive: true });
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-compendium-visual-'));
    const { html, linkedStylesheets } = await inlineDesktop();
    report.stylesheets = linkedStylesheets;
    const htmlPath = path.join(scratch, 'desktop-fixture.html');
    await fs.writeFile(htmlPath, html);
    const launchOptions = { headless: true };
    const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '');
    if (chrome) { await fs.access(chrome); launchOptions.executablePath = chrome; }
    const browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'UTC', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(6000);
    try {
        const fixture = makeFixture();
        const { networkRequests } = await mount(page, htmlPath, fixture);
        assert.strictEqual(await page.locator('[data-compendium-entry-id]').count(), 9, 'All nine representative cards must render');
        assert.strictEqual(await page.inputValue('[data-compendium-title]'), '陆辞舟');
        assert.strictEqual(await page.locator('[data-reader-compendium-dialog]').isVisible(), false, 'Original reader extraction dialog must remain closed');
        assert.strictEqual(await page.locator('[data-compendium-inspector]').isVisible(), false);
        const paperColors = await appearanceColors(page);
        report.contrast = { paper: await readableMutedText(page) };
        await inViewport(page, '[data-compendium-type]', 'Directory type filter');
        assert.strictEqual(await page.locator('[data-compendium-favorites]').evaluate(node => {
            const range = document.createRange(); range.selectNodeContents(node);
            return range.getClientRects().length;
        }), 1, 'Favorite filter label must stay on one line');

        for (const [width, height, screenshot] of [[1440, 900, '01-paper-1440x900.png'], [1280, 720, '02-paper-1280x720.png'], [1920, 1080, '03-paper-1920x1080.png']]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(() => { document.querySelector('[data-compendium-scroll]').scrollTop = 0; });
            await noHorizontalOverflow(page);
            await inViewport(page, '[data-compendium-title]', 'Title');
            await inViewport(page, '[data-compendium-body]', 'Body opening', false);
            await inViewport(page, '[data-compendium-save]', 'Save control');
            await capture(page, screenshot);
        }
        report.checks.push('Paper layout at 1280×720, 1440×900 and 1920×1080; title, body opening and save control accessible; original reader dialog hidden.');

        for (const [width, height] of [[1024, 720], [1920, 1080]]) {
            await page.setViewportSize({ width, height });
            const before = await page.locator('.desktop-compendium-editor').boundingBox();
            const sidebar = await page.locator('.desktop-compendium-sidebar').boundingBox();
            await page.locator('[data-compendium-sidebar-toggle]').click();
            assert.strictEqual(await page.locator('.desktop-compendium-sidebar').isVisible(), false);
            const after = await page.locator('.desktop-compendium-editor').boundingBox();
            assert.ok(after.width >= before.width + sidebar.width - 3, `Collapsed directory must release its width at ${width}px`);
            await noHorizontalOverflow(page);
            await inViewport(page, '[data-compendium-save]', `Save control with collapsed directory at ${width}px`);
            if (width === 1024) await capture(page, '03b-directory-collapsed-1024x720.png');
            await page.locator('[data-compendium-sidebar-toggle]').click();
            await inViewport(page, '[data-compendium-type]', `Restored type filter at ${width}px`);
        }
        report.checks.push('Directory collapse releases the full sidebar width at 1024px and 1920px, then restores accessible controls.');

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('button[data-compendium-appearance]').click();
        assert.strictEqual(await page.locator('#desktop-root').getAttribute('data-compendium-appearance'), 'ink');
        const inkColors = await appearanceColors(page);
        report.contrast.ink = await readableMutedText(page);
        assert.notDeepStrictEqual(inkColors, paperColors, 'Ink mode must change the computed colors');
        const brightness = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).reduce((sum, value) => sum + value, 0);
        assert.ok(brightness(inkColors.background) < brightness(paperColors.background), 'Ink must have a darker actual background than paper');
        report.appearanceColors = { paper: paperColors, ink: inkColors };
        await noHorizontalOverflow(page);
        await capture(page, '04-ink-1440x900.png');
        await page.locator('button[data-compendium-appearance]').click();
        assert.strictEqual(await page.locator('#desktop-root').getAttribute('data-compendium-appearance'), 'paper', 'Appearance toggle must round-trip');
        assert.deepStrictEqual(await appearanceColors(page), paperColors, 'Returning to paper must restore its computed colors');
        await page.locator('[data-compendium-pane-toggle="connections"]').click();
        assert.strictEqual(await page.locator('#desktop-root').getAttribute('data-compendium-appearance'), 'paper', 'An unrelated click must not toggle the appearance');
        assert.ok((await page.locator('[data-compendium-insights-mentions]').textContent()).includes('旧信抵达'));
        const sourceText = await page.locator('[data-compendium-insights-sources]').textContent();
        assert.ok(sourceText.includes('青铜扣') && sourceText.includes('最后一页'), 'Both current and historical evidence must remain readable');
        await noHorizontalOverflow(page);
        await inViewport(page, '[data-compendium-inspector-close]', 'Inspector close control');
        await inViewport(page, '[data-compendium-save]', 'Save control with inspector');
        await capture(page, '05-references-inspector-1440x900.png');
        await page.locator('[data-compendium-insights-sources]').scrollIntoViewIfNeeded();
        await inViewport(page, '[data-compendium-inspector-close]', 'Inspector close control after source scroll');
        await capture(page, '05b-historical-sources-1440x900.png');
        await page.locator('[data-compendium-pane="connections"]').evaluate(node => { node.scrollTop = 0; });
        await page.setViewportSize({ width: 1280, height: 720 });
        await noHorizontalOverflow(page);
        await inViewport(page, '[data-compendium-inspector-close]', 'Compact inspector close control');
        await inViewport(page, '[data-compendium-save]', 'Compact save control with inspector');
        await capture(page, '06-references-inspector-1280x720.png');
        await page.locator('[data-compendium-inspector-close]').click();
        await page.locator('[data-compendium-sidebar-toggle]').click();
        assert.strictEqual(await page.locator('.desktop-compendium-sidebar').isVisible(), false, 'Directory must collapse');
        await noHorizontalOverflow(page);
        await inViewport(page, '[data-compendium-save]', 'Save control with collapsed directory');
        await page.locator('[data-compendium-sidebar-toggle]').click();
        await inViewport(page, '[data-compendium-type]', 'Restored directory filter');
        report.checks.push('Ink appearance; live scene mentions, historical source excerpts, inspector close and save controls at both desktop sizes.');

        assert.strictEqual(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
        const motion = await page.locator('[data-view-panel="compendium"]').evaluate(node => [node, ...node.querySelectorAll('*')].filter(item => item.getBoundingClientRect().width > 0).map(item => {
            const style = getComputedStyle(item);
            const seconds = value => Math.max(...value.split(',').map(part => (parseFloat(part) || 0) / (part.trim().endsWith('ms') ? 1000 : 1)));
            return { node: item.className || item.tagName, duration: Math.max(seconds(style.animationDuration), seconds(style.transitionDuration)) };
        }).filter(item => item.duration > 0.01));
        assert.deepStrictEqual(motion, [], 'Reduced motion must disable perceptible compendium transitions');
        report.checks.push('Reduced motion is honored by visible compendium controls.');

        const longTitle = '陆辞舟与无渡镇：'.repeat(16);
        await page.locator('[data-compendium-title]').fill(longTitle);
        const titleSize = await page.locator('[data-compendium-title]').evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }));
        assert.ok(titleSize.client >= titleSize.scroll - 2, 'Long titles must wrap and auto-grow without clipping');
        await noHorizontalOverflow(page);
        await page.locator('[data-compendium-scroll]').evaluate(node => { node.scrollTop = 0; });
        await capture(page, '06b-long-title-1280x720.png');
        const longBody = Array.from({ length: 70 }, (_, index) => `第 ${index + 1} 段：陆辞舟把修复过的纸页放回窗下。沈青萝记下每一处被遗漏的名字，河面上的秋潮正缓慢退去。长篇资料应保留完整内容，并让页面承担阅读滚动。`).join('\n\n');
        await page.locator('[data-compendium-body]').fill(longBody);
        assert.strictEqual(await page.evaluate(() => window.compendiumState.dirty), true, 'Real input events must mark the draft dirty');
        const fieldSize = await page.locator('[data-compendium-body]').evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }));
        assert.ok(fieldSize.client >= fieldSize.scroll - 2, `Long body must auto-grow, not clip: ${JSON.stringify(fieldSize)}`);
        await page.keyboard.press('Control+s');
        await page.waitForFunction(() => !window.compendiumState.dirty);
        assert.strictEqual(await page.evaluate(id => window.compendiumState.entries.find(entry => entry.id === id).body, CHARACTER_ID), longBody);
        assert.strictEqual(await page.evaluate(id => window.compendiumState.entries.find(entry => entry.id === id).title, CHARACTER_ID), longTitle);
        assert.strictEqual(await page.inputValue('[data-compendium-body]'), longBody);
        assert.strictEqual(await page.evaluate(() => window.fixtureRequests.length), 1, 'Exactly one isolated mock save should occur');
        await page.locator('[data-compendium-scroll]').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await inViewport(page, '[data-compendium-save]', 'Save control at the end of a long entry');
        await noHorizontalOverflow(page);
        await capture(page, '07-long-entry-end-1280x720.png');
        report.checks.push('Real input auto-grows long title and body; Ctrl+S preserves complete saved values; save remains available at the bottom.');

        await page.evaluate(initial => {
            const entries = Array.from({ length: 500 }, (_, index) => ({ ...initial.entries[index % initial.entries.length], id: `directory-${String(index).padStart(3, '0')}`, title: `档案 ${String(index).padStart(3, '0')} · ${initial.entries[index % initial.entries.length].title}` }));
            window.compendiumState.entries = entries;
            window.nativeEditorState.snapshot.compendium = entries;
            window.compendiumState.selectedId = entries[0].id;
            window.renderCompendium();
        }, fixture);
        assert.strictEqual(await page.locator('[data-compendium-entry-id]').count(), 500);
        await page.locator('[data-compendium-entry-id]').first().focus();
        await page.keyboard.press('End');
        const lastEntry = await page.locator('[data-compendium-entry-id]').last().getAttribute('data-compendium-entry-id');
        assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.compendiumEntryId), lastEntry);
        await inViewport(page, `[data-compendium-entry-id="${lastEntry}"]`, 'Last directory entry reached with End');
        await page.keyboard.press('Enter');
        assert.strictEqual(await page.evaluate(() => window.compendiumState.selectedId), lastEntry);
        await page.locator('[data-compendium-search]').fill('没有任何资料会匹配这段验收查询');
        assert.strictEqual(await page.locator('[data-compendium-entry-id]').count(), 0);
        await capture(page, '08-search-empty-1280x720.png');
        await page.locator('[data-compendium-clear-search]').click();
        assert.strictEqual(await page.locator('[data-compendium-entry-id]').count(), 500);
        assert.match(await page.locator('[data-compendium-status]').textContent(), /^\s*500\s*\/\s*500\b/, 'Directory status count must recover after clearing the search');
        await noHorizontalOverflow(page);
        await capture(page, '09-directory-500-1280x720.png');
        report.checks.push('500 entries remain keyboard navigable, End reaches the last entry, and zero-result search can restore the directory.');

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(initial => {
            window.compendiumState.entries = initial.entries;
            window.compendiumState.selectedId = initial.selectedId;
            window.nativeEditorState.snapshot = initial.snapshot;
            window.renderCompendium();
            window.setView('writer');
            document.querySelectorAll('[data-native-panel]').forEach(node => node.classList.toggle('is-active', node.dataset.nativePanel === 'context'));
            document.querySelectorAll('[data-native-tab]').forEach(node => node.classList.toggle('is-active', node.dataset.nativeTab === 'context'));
            const editor = document.querySelector('[data-native-scene-editor]');
            editor.value = `${initial.snapshot.sceneContents['scene-old-letter']}\n\n`.repeat(12);
            editor.setSelectionRange(16, 28, 'backward');
            editor.scrollTop = 110;
            document.querySelector('[data-native-scene-title]').textContent = '旧信抵达';
            document.querySelector('[data-native-paper-title]').textContent = '旧信抵达';
            document.querySelector('[data-native-chapter-title]').textContent = '第一章 · 归来的旧信';
            document.querySelector('[data-native-paper-chapter]').textContent = '第一章 · 归来的旧信';
            document.querySelector('[data-native-project-source]').textContent = '写作项目';
            document.querySelector('[data-native-project-title]').textContent = initial.snapshot.project.title;
            document.querySelector('[data-native-project-meta]').textContent = '2 章 · 3 个场景';
            document.querySelector('[data-native-paper-position]').textContent = '第一章 · 旧信抵达';
            document.querySelector('[data-native-paper-stats]').textContent = `${editor.value.length} 字`;
            document.querySelector('[data-native-editor-stats]').textContent = `${editor.value.length} 字`;
            document.querySelector('[data-native-paper-status]').textContent = '未保存';
            document.querySelector('[data-native-save-status]').textContent = '未保存';
            document.querySelector('[data-native-save-scene]').disabled = false;
            window.renderNativeContext();
            window.renderNativeCharacters();
        }, fixture);
        const editorState = () => page.locator('[data-native-scene-editor]').evaluate(node => ({ value: node.value, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection, scroll: node.scrollTop }));
        const writerBefore = await editorState();
        await page.locator(`[data-native-compendium-peek="${CHARACTER_ID}"]`).click();
        await inViewport(page, '[data-compendium-peek-close]', 'Writer peek close control');
        await inViewport(page, '[data-compendium-peek-reference]', 'Writer peek reference control');
        await noHorizontalOverflow(page);
        await capture(page, '10-writer-peek-1440x900.png');
        await page.locator('[data-compendium-peek-reference]').click();
        assert.deepStrictEqual(await page.evaluate(() => window.nativeEditorState.context.compendiumIds), [CHARACTER_ID]);
        assert.strictEqual(await page.locator(`[data-native-compendium-reference="${CHARACTER_ID}"]`).isChecked(), true);
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), false);
        assert.deepStrictEqual(await editorState(), writerBefore, 'Peek and reference action must preserve the writing text, selection and scroll');
        report.checks.push('Real writer reference button opens the peek; reference state/checkbox stay consistent; Escape preserves editor text, selection and scroll.');

        await page.evaluate(() => {
            window.setView('compendium');
            window.nativeEditorState.snapshot = null;
            Object.assign(window.compendiumState, { entries: [], selectedId: '', dirty: false, query: '', type: '' });
            window.renderCompendium();
            window.setCompendiumCountStatus();
        });
        assert.strictEqual(await page.locator('[data-compendium-form]').isVisible(), false);
        assert.strictEqual(await page.locator('[data-compendium-new]').isDisabled(), true);
        assert.strictEqual(await page.locator('[data-compendium-inspector]').isVisible(), false);
        await noHorizontalOverflow(page);
        await capture(page, '11-no-project-1440x900.png');
        report.checks.push('No-project empty state hides the editor/inspector and disables creation.');
        assert.deepStrictEqual(errors, [], 'The actual components must not raise page errors');
        assert.deepStrictEqual(networkRequests, [], 'The offline fixture must not issue HTTP requests');
        report.checks.push('No page errors, HTTP requests, real project changes, or provider calls.');
        await fs.rm(path.join(output, 'failure.png'), { force: true });
        await fs.writeFile(path.join(output, 'visual-acceptance.json'), JSON.stringify(report, null, 2));
        console.log(`PASS compendium reading-room visual acceptance: ${report.checks.length} checks, ${report.screenshots.length} screenshots.\n${output}`);
    } catch (error) {
        await capture(page, 'failure.png').catch(() => {});
        console.error(`Page errors: ${JSON.stringify(errors)}\nScreenshot directory: ${output}`);
        throw error;
    } finally {
        await browser.close();
        // Only this runner's unique temporary fixture is removed; screenshots remain reviewable.
        assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir()) + path.sep));
        await fs.rm(scratch, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
