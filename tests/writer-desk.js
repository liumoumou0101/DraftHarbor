const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const { openNativePanel } = require('./helpers/native-panel');

// Exercise the complete shell using an isolated project and no model requests.
(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-writer-desk-'));
    let servers;
    let browser;
    try {
        await projectService.createProject(dataRoot, {
            id: 'desk-test', title: '书桌状态测试',
            chapters: [{ id: 'c1', title: '第一章', order: 0 }],
            scenes: [
                { id: 's1', chapterId: 'c1', title: '雨夜', summary: '等待来信。', content: '雨落在窗前。她收起了来信。', order: 0 },
                { id: 's2', chapterId: 'c1', title: '天明', content: '第二场的正文。', order: 1 }
            ],
            compendium: [
                { id: 'e1', title: '来信', type: 'item', summary: '一封来自故乡的信。', body: '正文中的细节更长。' },
                { id: 'e2', title: '街道', type: 'location', body: '沿河的一条旧街。' }
            ]
        });
        servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(servers.appUrl + '/desktop.html', { waitUntil: 'domcontentloaded' });
        await page.locator('.desktop-project-card').first().click();
        await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent.includes('书桌状态测试'));
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-literary-desk')), true, 'new profiles start in the literary desk');
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.style.getPropertyValue('--native-editor-font-size')), '24px');
        assert.strictEqual(await page.locator('[data-native-editor-font-family]').inputValue(), 'serif');
        assert.strictEqual(await page.locator('[data-native-gen-task="continue"]').evaluate(el => el.classList.contains('is-active')), true, 'the initial writing mode selects the real continue task');
        assert.strictEqual(await page.locator('[data-native-desk-reference="e1"] span').textContent(), '一封来自故乡的信。', 'reference cards show the native summary before body');
        assert.strictEqual(await page.locator('[data-native-desk-reference="e2"] span').textContent(), '沿河的一条旧街。', 'reference cards fall back to the native body');
        await page.locator('[data-native-scene-editor]').fill('未保存的草稿。雨落在窗前。她收起了来信。');
        await page.locator('[data-native-beat-input]').fill('保持含蓄的叙事。');
        await page.locator('[data-native-scene-editor]').evaluate(el => { el.setSelectionRange(7, 13); el.focus(); });
        const before = await page.locator('[data-native-scene-editor]').evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd }));
        await page.locator('[data-native-desk-mode="revise"]').click();
        assert.strictEqual(await page.locator('[data-native-panel="rewrite"]').evaluate(el => !el.hidden && !!el.closest('[data-native-desk-dock]')), true);
        for (const tool of ['characters', 'context', 'metadata', 'structure', 'search', 'history', 'overview']) {
            await page.locator('[data-native-desk-tool]').selectOption(tool);
            assert.strictEqual(await page.locator('[data-native-panel="rewrite"]').evaluate(el => !el.hidden), true, 'auxiliary tools must not hide the composer');
            if (tool !== 'overview') assert.strictEqual(await page.locator(`[data-native-panel="${tool}"]`).evaluate(el => !el.hidden), true, `tool ${tool} remains reachable`);
        }
        assert.deepStrictEqual(await page.locator('[data-native-scene-editor]').evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd })), before, 'navigation retains manuscript and selection');
        await page.locator('[data-native-desk-mode="conceive"]').click();
        assert.strictEqual(await page.locator('[data-native-gen-task="beat"]').evaluate(el => el.classList.contains('is-active')), true, 'conceive uses the real beat handler');
        assert.strictEqual(await page.locator('[data-native-beat-input]').inputValue(), '保持含蓄的叙事。');
        const nodeIdentity = await page.evaluate(() => {
            window.__deskEditor = document.querySelector('[data-native-scene-editor]');
            window.__deskGenerate = document.querySelector('[data-native-panel="generate"]');
            return document.querySelectorAll('[data-native-scene-editor]').length;
        });
        assert.strictEqual(nodeIdentity, 1);
        await page.locator('[data-native-desk-layout]').click();
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-literary-desk')), false);
        assert.strictEqual(await page.locator('[data-native-panel="generate"]').evaluate(el => !!el.closest('.desktop-native-assistant')), true);
        await openNativePanel(page, 'metadata');
        assert.strictEqual(await page.locator('[data-native-panel="metadata"]').isVisible(), true, 'classic native panel routes remain reachable');
        await openNativePanel(page, 'generate');
        await page.locator('[data-native-desk-layout]').click();
        assert.strictEqual(await page.evaluate(() => window.__deskEditor === document.querySelector('[data-native-scene-editor]') && window.__deskGenerate === document.querySelector('[data-native-panel="generate"]')), true, 'classic fallback moves the original controls');
        await page.locator('[data-native-desk-appearance-toggle]').click();
        await page.locator('[data-native-desk-font-size]').fill('32');
        await page.locator('[data-native-desk-font-size]').dispatchEvent('input');
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.style.getPropertyValue('--native-editor-font-size')), '32px', 'readable size range reaches 32px');
        await page.locator('[data-native-desk-night]').check();
        await page.locator('[data-native-desk-reduce-motion]').check();
        await page.locator('[data-native-desk-appearance-close]').click();
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-desk-night') && el.classList.contains('is-desk-reduced-motion')), true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-native-writer]').classList.contains('is-desk-night'));
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-desk-reduced-motion')), true, 'appearance preferences persist locally');
        await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent.includes('书桌状态测试'));
        await page.locator('[data-native-focus-mode]').click();
        assert.strictEqual(await page.locator('[data-native-desk-focus-exit]').evaluate(el => !el.hidden), true, 'focus mode always exposes a visible exit');
        await page.locator('[data-native-desk-focus-exit]').click();
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-focus-mode')), false);
        await page.locator('[data-native-open-rewrite]').evaluate(el => el.click());
        assert.strictEqual(await page.locator('[data-native-panel="rewrite"]').evaluate(el => !el.hidden), true, 'original rewrite entry points route to the central dock');
        await page.locator('[data-native-desk-tool]').selectOption('metadata');
        await page.locator('[data-native-scene-summary]').fill('草稿中的新摘要。');
        await page.locator('[data-native-desk-tool]').selectOption('overview');
        assert.strictEqual(await page.locator('[data-native-scene-summary]').inputValue(), '草稿中的新摘要。', 'tool navigation must retain unfinished metadata edits');
        assert.strictEqual(await page.locator('[data-native-desk-scene-summary]').textContent(), '草稿中的新摘要。', 'overview reflects the current unsaved metadata draft');
        await page.locator('[data-native-context-action="view-summary"]').evaluate(el => el.click());
        await page.locator('[data-native-summary-dialog-edit]').click();
        assert.strictEqual(await page.locator('[data-native-panel="metadata"]').evaluate(el => !el.hidden), true, 'native summary edit reopens metadata after returning to overview');
        assert.strictEqual(await page.locator('[data-native-scene-summary]').evaluate(el => document.activeElement === el), true, 'summary edit focuses the visible metadata field');
        assert.strictEqual(await page.evaluate(() => window.saveNativeScene()), true);
        await page.locator('[data-native-desk-tool]').selectOption('overview');
        assert.strictEqual(await page.locator('[data-native-desk-scene-summary]').textContent(), '草稿中的新摘要。', 'saving metadata keeps the overview in sync');
        await page.evaluate(() => localStorage.setItem('draftharbor:desktop:nativeEditorPrefs', JSON.stringify({ fontSize: 16, fontFamily: 'yahei', lineHeight: 1.75, textWidth: 800, paragraphSpacing: 0.2, wordGoal: 1000 })));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-native-writer]').style.getPropertyValue('--native-editor-font-size') === '16px');
        await page.waitForFunction(() => document.querySelector('[data-native-desk-scene-summary]').textContent === '草稿中的新摘要。');
        assert.strictEqual(await page.locator('[data-native-editor-font-family]').inputValue(), 'yahei', 'explicit existing font preferences survive the new defaults');
        assert.deepStrictEqual(errors, [], 'desk integration has no renderer errors');
        console.log('writer desk routing, state, fallback and appearance passed');
    } finally {
        if (browser) await browser.close();
        if (servers) await servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
