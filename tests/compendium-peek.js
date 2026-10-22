/* global nativeEditorState compendiumState renderNativeContext renderNativeCharacters renderCompendium renderNativeGeneration */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const cards = [
    { id: 'captain', projectId: 'project-a', title: '林舟 <script>unsafe</script>', type: 'character', summary: '船长，正在追查失踪的航海图。', body: '这是资料正文。'.repeat(600), tags: ['船员'], aliases: ['阿舟'], characterProfile: { goal: '找到航海图', voice: '简短直接' }, contextPolicy: { mode: 'always' }, sourceReferences: [{ kind: 'reader-transfer', sceneId: 'scene-a', excerpt: '船长在港口收到一封信。' }] },
    { id: 'port', projectId: 'project-a', title: '旧港', type: 'location', body: '潮汐退去后才能进入。', contextPolicy: { mode: 'manual' } }
];

async function setup(page, scripts) {
    await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><div id="desktop-root" data-view="writer" data-compendium-appearance="paper"><button id="origin">查看资料</button><textarea data-native-scene-editor style="height:80px;width:400px"></textarea><div data-native-context-compendium></div><div data-native-context-compendium-tags></div><div data-native-context-chapters></div><div data-native-context-scenes></div><div data-native-context-summary></div><div data-native-character-list></div><input data-compendium-title><textarea data-compendium-body></textarea></div></body></html>' }));
    await page.goto('http://compendium-peek.test/');
    await page.evaluate(entries => {
        window.compendiumState = { entries, selectedId: 'port', query: '', type: '', dirty: false, loading: false };
        window.nativeEditorState = { snapshot: { project: { id: 'project-a' }, compendium: entries, scenes: [{ id: 'scene-a', title: '港口来信' }], chapters: [] }, context: { compendiumIds: [], compendiumTags: [], chapterModes: {}, sceneModes: {} }, generation: {}, activeSceneId: 'scene-a' };
        window.currentNativeScene = () => nativeEditorState.snapshot.scenes[0];
        window.renderContextStrip = () => {};
        window.renderNativeEditor = () => { throw new Error('Peek must not rerender the writer'); };
        window.contextPolicyMode = entry => entry.contextPolicy?.mode || 'manual';
        window.contextPolicyLabel = entry => entry.contextPolicy?.mode === 'always' ? '始终引用' : '手动引用';
        window.confirmAllowed = false;
        window.confirm = () => window.confirmAllowed;
        window.navigationAllowed = true;
        window.countNativeWords = text => text.length;
        window.queueNativeGenerationLayer = () => {};
        window.cancelNativeGeneration = () => {};
        window.setView = view => { if (window.navigationAllowed) document.querySelector('#desktop-root').dataset.view = view; };
        const editor = document.querySelector('[data-native-scene-editor]');
        editor.value = '未保存正文\n'.repeat(100);
        editor.setSelectionRange(12, 20, 'backward');
        editor.scrollTop = 120;
    }, cards);
    for (const script of scripts) if (script) await page.addScriptTag({ content: script });
    await page.evaluate(() => { window.nativeWriterThinkingActive = () => false; renderNativeContext(); renderNativeCharacters(); });
}

const cases = [
    ['peek preserves editor state and renders saved text safely', async page => {
        assert.strictEqual(await page.evaluate(() => typeof window.openCompendiumPeek), 'function');
        const before = await page.locator('[data-native-scene-editor]').evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, scroll: el.scrollTop }));
        await page.locator('[data-native-compendium-peek="captain"]').click();
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), true);
        assert.strictEqual(await page.locator('[data-compendium-peek-title]').textContent(), cards[0].title);
        assert.ok((await page.locator('[data-compendium-peek-sources]').textContent()).includes('港口来信'));
        assert.ok((await page.locator('[data-compendium-peek-sources]').textContent()).includes(cards[0].sourceReferences[0].excerpt));
        assert.ok((await page.locator('[data-compendium-peek-profile]').textContent()).includes('找到航海图'));
        assert.ok((await page.locator('[data-compendium-peek-body]').textContent()).length < cards[0].body.length);
        assert.strictEqual(await page.locator('[data-compendium-peek] script').count(), 0);
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), false);
        assert.strictEqual(await page.locator('[data-native-compendium-peek="captain"]').evaluate(el => el === document.activeElement), true);
        assert.deepStrictEqual(await page.locator('[data-native-scene-editor]').evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, scroll: el.scrollTop })), before);
        assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'port');
    }],
    ['manual references persist and checkbox and peek stay consistent', async page => {
        await page.locator('[data-native-compendium-peek="captain"]').click();
        await page.locator('[data-compendium-peek-reference]').click();
        assert.deepStrictEqual(await page.evaluate(() => nativeEditorState.context.compendiumIds), ['captain']);
        assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('draftharbor:nativeContext:project-a')).compendiumIds), ['captain']);
        assert.strictEqual(await page.locator('[data-native-compendium-reference="captain"]').isChecked(), true);
        await page.locator('[data-native-compendium-reference="captain"]').uncheck();
        assert.deepStrictEqual(await page.evaluate(() => nativeEditorState.context.compendiumIds), []);
        assert.ok((await page.locator('[data-compendium-peek-reference]').textContent()).includes('加入'));
        assert.ok((await page.locator('[data-compendium-peek-reference-status]').textContent()).includes('自动'));
        await page.evaluate(() => { nativeEditorState.generation.inProgress = true; window.refreshCompendiumPeek(); });
        assert.strictEqual(await page.locator('[data-compendium-peek-reference]').isDisabled(), true);
        assert.strictEqual(await page.evaluate(() => window.setNativeCompendiumReference('captain', true)), false);
        assert.strictEqual(await page.evaluate(() => window.setNativeCompendiumReference('missing', true)), false);
        assert.deepStrictEqual(await page.evaluate(() => nativeEditorState.context.compendiumIds), []);
    }],
    ['writing with the panel open keeps the new cursor and focus on Escape', async page => {
        await page.locator('[data-native-compendium-peek="captain"]').click();
        const editor = page.locator('[data-native-scene-editor]');
        await editor.focus();
        await page.keyboard.type('继续写作');
        const before = await editor.evaluate(el => ({ value: el.value, start: el.selectionStart, scroll: el.scrollTop }));
        await page.keyboard.press('Escape');
        assert.deepStrictEqual(await editor.evaluate(el => ({ value: el.value, start: el.selectionStart, scroll: el.scrollTop })), before);
        assert.strictEqual(await editor.evaluate(el => el === document.activeElement), true);
    }],
    ['generation render updates the reference lock without rebuilding content', async page => {
        await page.evaluate(() => { nativeEditorState.generation.inProgress = true; });
        await page.locator('[data-native-compendium-peek="captain"]').click();
        assert.strictEqual(await page.locator('[data-compendium-peek-reference]').isDisabled(), true);
        await page.evaluate(() => {
            window.savedPeekBody = document.querySelector('[data-compendium-peek-body] p');
            nativeEditorState.generation.inProgress = false;
            renderNativeGeneration();
        });
        assert.strictEqual(await page.locator('[data-compendium-peek-reference]').isDisabled(), false);
        assert.strictEqual(await page.evaluate(() => window.savedPeekBody === document.querySelector('[data-compendium-peek-body] p')), true);
        await page.evaluate(() => { nativeEditorState.generation.inProgress = true; renderNativeGeneration(); });
        assert.strictEqual(await page.locator('[data-compendium-peek-reference]').isDisabled(), true);
    }],
    ['switching cards resets peek scroll while ordinary refresh preserves it', async page => {
        await page.locator('[data-native-compendium-peek="captain"]').click();
        await page.locator('.desktop-compendium-peek-content').evaluate(el => { el.style.cssText = 'height:100px;overflow:auto'; el.scrollTop = 150; });
        await page.evaluate(() => window.refreshCompendiumPeek());
        assert.ok(await page.locator('.desktop-compendium-peek-content').evaluate(el => el.scrollTop) > 0);
        await page.evaluate(() => window.openCompendiumPeek('port'));
        assert.strictEqual(await page.locator('.desktop-compendium-peek-content').evaluate(el => el.scrollTop), 0);
    }],
    ['project switching and entry deletion invalidate stale panels and actions', async page => {
        await page.locator('[data-native-compendium-peek="captain"]').click();
        await page.evaluate(() => { nativeEditorState.snapshot = { ...nativeEditorState.snapshot, project: { id: 'project-b' } }; });
        await page.locator('[data-compendium-peek-reference]').click();
        assert.deepStrictEqual(await page.evaluate(() => nativeEditorState.context.compendiumIds), []);
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), false);
        await page.evaluate(() => { nativeEditorState.snapshot.project.id = 'project-a'; window.openCompendiumPeek('captain'); compendiumState.entries = []; window.refreshCompendiumPeek(); });
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), false);
    }],
    ['full open respects dirty draft and rejected navigation', async page => {
        await page.evaluate(() => { renderCompendium(); compendiumState.dirty = true; });
        await page.locator('[data-native-compendium-peek="captain"]').click();
        await page.locator('[data-compendium-peek-open]').click();
        assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'port');
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), true);
        await page.evaluate(() => { window.confirmAllowed = true; window.navigationAllowed = false; });
        await page.locator('[data-compendium-peek-open]').click();
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), true);
        await page.evaluate(() => { window.navigationAllowed = true; });
        await page.locator('[data-compendium-peek-open]').click();
        assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'captain');
        assert.strictEqual(await page.locator('#desktop-root').getAttribute('data-view'), 'compendium');
        assert.strictEqual(await page.locator('[data-compendium-peek]').isVisible(), false);
        assert.strictEqual(await page.locator('[data-compendium-title]').evaluate(el => el === document.activeElement), true);
    }]
];

(async () => {
    const scripts = await Promise.all(['writer-elements.js', 'compendium.js', 'writer-prompts.js', 'writer-generation-view.js', 'compendium-peek.js'].map(name => fs.readFile(path.join(root, 'src/desktop/shell', name), 'utf8').catch(error => { if (name === 'compendium-peek.js' && error.code === 'ENOENT') return ''; throw error; })));
    const browser = await chromium.launch({ headless: true });
    try {
        for (const [name, run] of cases) {
            const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.setDefaultTimeout(4000);
            try { await setup(page, scripts); await run(page); assert.deepStrictEqual(errors, []); console.log(`PASS ${name}`); }
            finally { await page.close(); }
        }
    } finally { await browser.close(); }
    console.log(`Compendium peek passed (${cases.length} cases; no external requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
