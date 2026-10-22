/* global bindCompendium compendiumState nativeEditorState renderCompendium selectCompendiumEntry loadNativeProjectEditor */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const cards = [
  { id: 'a', projectId: 'project-a', type: 'character', title: 'Captain A', summary: 'A quiet captain.', body: 'Captain A meets Lore B.', tags: ['crew'], aliases: ['Captain'], characterProfile: { goal: 'Reach home.' }, contextPolicy: { mode: 'manual' }, updatedAt: '2026-10-20T00:00:00Z', sourceReferences: [{ kind: 'reader-transfer', sceneId: 'gone', excerpt: '<img src=x onerror=alert(1)>' }] },
  { id: 'b', projectId: 'project-a', type: 'lore', title: 'Lore B', summary: 'The old lore.', body: 'Saved lore.', tags: ['crew'], aliases: [], contextPolicy: { mode: 'manual' }, updatedAt: '2026-10-21T00:00:00Z' },
  { id: 'c', projectId: 'project-a', type: 'character', title: 'Captain C', body: 'A second captain.', tags: [], aliases: [], contextPolicy: { mode: 'manual' } }
];

async function setup(page, fragment, sources) {
  await page.route('http://compendium.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body><main id="desktop-root" data-view="compendium">${fragment}</main></body></html>` }));
  await page.goto('http://compendium.test/');
  await page.evaluate(initial => {
    window.root = document.querySelector('#desktop-root');
    window.compendiumState = { entries: initial, selectedId: 'a', query: '', type: '', dirty: false, loading: false };
    window.nativeEditorState = { snapshot: { project: { id: 'project-a', title: 'A' }, compendium: initial, chapters: [{ id: 'chapter-a', title: 'Arrival' }], scenes: [{ id: 'scene-a', chapterId: 'chapter-a', title: 'Harbor', content: 'Captain A arrived at the harbor.' }] } };
    window.renderContextStrip = () => {};
    window.openCompendiumRewrite = () => {};
    window.contextPolicyMode = entry => entry.contextPolicy?.mode || 'manual';
    window.contextPolicyLabel = () => '手动';
    window.confirmCalls = 0;
    window.confirmResult = true;
    window.confirm = () => { window.confirmCalls += 1; return window.confirmResult; };
    window.requests = [];
    window.fetch = async (url, options) => {
      const request = { url, body: JSON.parse(options.body) };
      window.requests.push(request);
      return new Promise(resolve => { request.resolve = () => resolve({ ok: true, json: async () => ({ ok: true, entry: { ...request.body.entry, updatedAt: '2026-10-22T00:00:00Z' } }) }); });
    };
    window.peekCalls = [];
    window.openCompendiumPeek = (id, options) => window.peekCalls.push({ id, source: options.source });
    window.navigationCalls = [];
    window.navigationBlocked = false;
    window.setView = view => { if (!window.navigationBlocked && (!compendiumState.dirty || window.confirm())) document.querySelector('#desktop-root').dataset.view = view; };
    window.selectOutlineTarget = (kind, id) => { window.navigationCalls.push({ kind, id }); return true; };
  }, structuredClone(cards));
  for (const source of sources.filter(Boolean)) await page.addScriptTag({ content: source });
  await page.evaluate(() => bindCompendium());
}

const cases = [
  ['workspace hooks enhance the actual fragment and group one button per card', async page => {
    assert.strictEqual(await page.evaluate(() => typeof window.renderCompendiumWorkspace), 'function');
    assert.strictEqual(await page.locator('[data-compendium-list] button').count(), 3);
    assert.strictEqual(await page.locator('.compendium-list-group-title').count(), 2);
    assert.strictEqual(await page.locator('[data-compendium-list] [aria-current="true"]').getAttribute('data-compendium-entry-id'), 'a');
  }],
  ['search, favorite filtering, sorting and inspector changes preserve a focused draft', async page => {
    await page.fill('[data-compendium-body]', 'Unsubmitted text.');
    await page.locator('[data-compendium-pane-toggle="settings"]').last().click();
    await page.fill('[data-compendium-aliases]', 'Unsaved alias');
    await page.click('[data-compendium-inspector-close]');
    await page.click('[data-compendium-pin]');
    await page.click('[data-compendium-favorites]');
    await page.selectOption('[data-compendium-sort]', 'title');
    await page.fill('[data-compendium-search]', 'nothing matches');
    assert.strictEqual(await page.locator('[data-compendium-list] button').count(), 0);
    await page.click('[data-compendium-clear-search]');
    assert.strictEqual(await page.locator('[data-compendium-list] button').count(), 1);
    assert.ok((await page.locator('[data-compendium-status]').textContent()).includes('1 / 3'));
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Unsubmitted text.');
    assert.strictEqual(await page.inputValue('[data-compendium-aliases]'), 'Unsaved alias');
    assert.strictEqual(await page.evaluate(() => compendiumState.dirty), true);
    assert.strictEqual(await page.evaluate(() => window.confirmCalls), 0);
    assert.strictEqual(await page.evaluate(() => window.requests.length), 0);
  }],
  ['empty character fields can be revealed and filled without hiding their focused control', async page => {
    assert.strictEqual(await page.locator('[data-compendium-character-role]').isHidden(), true);
    assert.strictEqual(await page.locator('[data-compendium-character-goal]').isVisible(), true);
    await page.click('[data-compendium-show-empty]');
    await page.fill('[data-compendium-character-role]', 'Navigator');
    await page.click('[data-compendium-show-empty]');
    assert.strictEqual(await page.locator('[data-compendium-character-role]').isVisible(), true);
    assert.strictEqual(await page.inputValue('[data-compendium-character-role]'), 'Navigator');
    await page.fill('[data-compendium-body]', Array(50).fill('A whole line of long text.').join('\n'));
    assert.strictEqual(await page.locator('[data-compendium-body]').evaluate(node => node.clientHeight >= node.scrollHeight - 2), true);
  }],
  ['favorites stay project scoped and explicit selection wins over stored preferences', async page => {
    await page.click('[data-compendium-pin]');
    await page.selectOption('[data-compendium-sort]', 'recent');
    await page.evaluate(() => {
      window.aSnapshot = nativeEditorState.snapshot;
      const entry = { id: 'a', projectId: 'project-b', type: 'lore', title: 'Other project', body: 'B body' };
      nativeEditorState.snapshot = { project: { id: 'project-b' }, compendium: [entry] };
      compendiumState.entries = [entry]; compendiumState.selectedId = 'a'; compendiumState.dirty = false; renderCompendium();
    });
    assert.strictEqual(await page.locator('[data-compendium-pin]').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await page.inputValue('[data-compendium-sort]'), 'type');
    await page.evaluate(() => { nativeEditorState.snapshot = window.aSnapshot; compendiumState.entries = window.aSnapshot.compendium; compendiumState.selectedId = 'b'; renderCompendium(); });
    assert.strictEqual(await page.inputValue('[data-compendium-title]'), 'Lore B');
    assert.strictEqual(await page.inputValue('[data-compendium-sort]'), 'recent');
    await page.evaluate(() => selectCompendiumEntry('a'));
    assert.strictEqual(await page.locator('[data-compendium-pin]').getAttribute('aria-pressed'), 'true');
    const stored = await page.evaluate(() => Object.values(localStorage).join('\n'));
    assert.ok(!stored.includes('Captain A') && !stored.includes('Saved lore'), 'UI preferences must not contain author text');
  }],
  ['keyboard shortcuts respect module, editable fields, composition and open dialogs', async page => {
    await page.locator('[data-compendium-body]').focus();
    await page.keyboard.press('Control+s');
    assert.strictEqual(await page.evaluate(() => window.requests.length), 1);
    await page.keyboard.press('/');
    assert.strictEqual(await page.locator('[data-compendium-search]').evaluate(node => node === document.activeElement), false);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('/');
    assert.strictEqual(await page.locator('[data-compendium-search]').evaluate(node => node === document.activeElement), true);
    await page.evaluate(() => { document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true })); });
    assert.strictEqual(await page.locator('[data-compendium-search]').evaluate(node => node === document.activeElement), false);
    await page.evaluate(() => { const dialog = document.createElement('dialog'); document.body.append(dialog); dialog.showModal(); });
    await page.keyboard.press('Control+k');
    assert.strictEqual(await page.locator('[data-compendium-search]').evaluate(node => node === document.activeElement), false);
    await page.evaluate(() => { document.querySelector('dialog[open]').close(); document.querySelector('#desktop-root').dataset.view = 'writer'; });
    await page.keyboard.press('Control+s');
    assert.strictEqual(await page.evaluate(() => window.requests.length), 1);
  }],
  ['directory arrows focus only, space peeks and guarded Enter retains dirty content', async page => {
    await page.fill('[data-compendium-body]', 'Keep my draft.');
    await page.evaluate(() => { window.confirmResult = false; });
    await page.locator('[data-compendium-entry-id="a"]').focus();
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.compendiumEntryId), 'c');
    assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'a');
    await page.keyboard.press('Space');
    assert.strictEqual(await page.evaluate(() => window.peekCalls[0].id), 'c');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'a');
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Keep my draft.');
  }],
  ['inspector shows plaintext stale evidence and scene jumps honor the existing leave guard', async page => {
    await page.click('[data-compendium-pane-toggle="connections"]');
    assert.ok((await page.locator('[data-compendium-insights-sources]').textContent()).includes('<img src=x onerror=alert(1)>'));
    assert.strictEqual(await page.locator('[data-compendium-insights-sources] img').count(), 0);
    assert.strictEqual(await page.locator('[data-compendium-insights-sources] button').count(), 0);
    const scene = page.locator('[data-compendium-insights-mentions] button').first();
    assert.strictEqual(await scene.count(), 1);
    await page.evaluate(() => { window.navigationBlocked = true; });
    await scene.click();
    assert.strictEqual(await page.evaluate(() => window.navigationCalls.length), 0);
    await page.evaluate(() => { window.navigationBlocked = false; });
    await scene.click();
    assert.deepStrictEqual(await page.evaluate(() => window.navigationCalls), [{ kind: 'scene', id: 'scene-a' }]);
  }],
  ['appearance and directory controls affect only the compendium presentation', async page => {
    assert.strictEqual(await page.locator('#desktop-root').getAttribute('aria-pressed'), null);
    await page.click('[data-compendium-pin]');
    assert.strictEqual(await page.locator('[data-view-panel="compendium"]').getAttribute('data-appearance'), 'paper');
    await page.click('button[data-compendium-appearance]');
    assert.strictEqual(await page.locator('[data-view-panel="compendium"]').getAttribute('data-appearance'), 'ink');
    assert.strictEqual(await page.locator('#desktop-root').getAttribute('data-compendium-appearance'), 'ink');
    await page.click('[data-compendium-sidebar-toggle]');
    assert.strictEqual(await page.locator('[data-view-panel="compendium"]').getAttribute('data-directory-collapsed'), 'true');
    assert.strictEqual(await page.evaluate(() => window.requests.length), 0);
    await page.evaluate(() => { compendiumState.entries = []; compendiumState.selectedId = ''; renderCompendium(); });
    assert.strictEqual(await page.locator('[data-view-panel="compendium"]').getAttribute('data-directory-collapsed'), 'false');
  }],
  ['discard cannot race an active save and confirmed discard restores the accepted baseline', async page => {
    await page.fill('[data-compendium-body]', 'Saving this version.');
    await page.keyboard.press('Control+s');
    await page.fill('[data-compendium-body]', 'Newer unsaved version.');
    assert.strictEqual(await page.locator('[data-compendium-revert]').isDisabled(), true);
    await page.evaluate(() => window.requests[0].resolve());
    await page.waitForFunction(() => !document.querySelector('[data-compendium-save]').disabled);
    await page.locator('.compendium-entry-actions > summary').click();
    await page.evaluate(() => { window.confirmResult = false; });
    await page.click('[data-compendium-revert]');
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Newer unsaved version.');
    await page.evaluate(() => { window.confirmResult = true; });
    if (!await page.locator('.compendium-entry-actions').evaluate(element => element.open)) await page.locator('.compendium-entry-actions > summary').click();
    await page.click('[data-compendium-revert]');
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Saving this version.');
    assert.strictEqual(await page.evaluate(() => compendiumState.dirty), false);
  }],
  ['entry scroll restores independently and initial empty loads retain the saved selection preference', async page => {
    await page.addStyleTag({ content: '[data-compendium-scroll]{height:220px;overflow:auto}' });
    await page.evaluate(() => {
      compendiumState.entries[0].body = Array(100).fill('A long remembered paragraph.').join('\n');
      renderCompendium();
    });
    await page.waitForTimeout(30);
    await page.locator('[data-compendium-scroll]').evaluate(element => { element.scrollTop = 360; element.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => selectCompendiumEntry('b'));
    await page.waitForTimeout(30);
    await page.evaluate(() => selectCompendiumEntry('a'));
    await page.waitForTimeout(30);
    assert.ok(await page.locator('[data-compendium-scroll]').evaluate(element => element.scrollTop >= 350));
    await page.evaluate(() => {
      window.savedCards = compendiumState.entries;
      selectCompendiumEntry('c');
      nativeEditorState.snapshot = { project: { id: 'project-a' }, compendium: [] };
      compendiumState.entries = []; compendiumState.selectedId = ''; renderCompendium();
      compendiumState.entries = window.savedCards; nativeEditorState.snapshot.compendium = window.savedCards; renderCompendium();
    });
    assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'c');
    assert.strictEqual(await page.inputValue('[data-compendium-title]'), 'Captain C');
  }],
  ['no project and empty searches have truthful empty states with no active editor', async page => {
    await page.evaluate(() => { nativeEditorState.snapshot = null; compendiumState.entries = []; compendiumState.selectedId = ''; compendiumState.dirty = false; renderCompendium(); });
    assert.strictEqual(await page.locator('[data-compendium-form]').isHidden(), true);
    assert.ok((await page.locator('[data-compendium-list]').textContent()).includes('打开'));
    assert.strictEqual(await page.locator('[data-compendium-inspector]').isHidden(), true);
  }],
  ['a card loaded while another module is visible expands when the reading room opens', async page => {
    await page.addStyleTag({ content: '#desktop-root[data-view="writer"] [data-view-panel="compendium"]{display:none}' });
    await page.evaluate(() => {
      document.querySelector('#desktop-root').dataset.view = 'writer';
      compendiumState.entries[0].body = Array(60).fill('Text that must be readable when reopened.').join('\n');
      renderCompendium();
    });
    await page.waitForTimeout(30);
    await page.evaluate(() => { document.querySelector('#desktop-root').dataset.view = 'compendium'; });
    await page.waitForTimeout(50);
    assert.strictEqual(await page.locator('[data-compendium-body]').evaluate(element => element.clientHeight >= element.scrollHeight - 2), true);
  }],
  ['unavailable storage and an absent insights helper do not disable editing', async page => {
    await page.evaluate(() => {
      Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); };
      Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
      nativeEditorState.snapshot = { ...nativeEditorState.snapshot };
      delete window.DraftHarborCompendiumInsights;
      renderCompendium();
    });
    await page.click('[data-compendium-pin]');
    assert.strictEqual(await page.locator('[data-compendium-pin]').getAttribute('aria-pressed'), 'true');
    await page.click('[data-compendium-pane-toggle="connections"]');
    assert.ok((await page.locator('[data-compendium-insights-status]').textContent()).includes('尚未加载'));
    await page.fill('[data-compendium-body]', 'Still editable.');
    assert.strictEqual(await page.evaluate(() => compendiumState.dirty), true);
  }],
  ['the real project loader restores last selection only at its automatic default boundary', async page => {
    await page.addScriptTag({ content: await fs.readFile(path.resolve(__dirname, '../src/desktop/shell/writer-core.js'), 'utf8') });
    await page.evaluate(() => {
      window.renderNativeEditor = () => {};
      window.loadNativeContextPrefs = () => {};
      window.promptState = {};
      window.projectA = nativeEditorState.snapshot;
      selectCompendiumEntry('c');
      const entry = { id: 'c', projectId: 'project-b', title: 'Other project C', type: 'lore' };
      loadNativeProjectEditor({ project: { id: 'project-b' }, compendium: [entry] });
      loadNativeProjectEditor(window.projectA);
    });
    assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'c');
    assert.strictEqual(await page.inputValue('[data-compendium-title]'), 'Captain C');
    await page.evaluate(() => { compendiumState.selectedId = 'b'; renderCompendium(); });
    assert.strictEqual(await page.inputValue('[data-compendium-title]'), 'Lore B');
  }],
  ['wrapped title stays one logical line while preserving composition and paste selection', async page => {
    const title = page.locator('[data-compendium-title]');
    await title.fill('Captain A');
    await title.press('Enter');
    assert.strictEqual(await title.inputValue(), 'Captain A');
    const compositionPrevented = await title.evaluate(element => {
      const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      element.dispatchEvent(composing);
      return composing.defaultPrevented;
    });
    assert.strictEqual(compositionPrevented, false);
    await title.evaluate(element => {
      element.setSelectionRange(8, 9);
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'B\nNavigator');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    });
    assert.strictEqual(await title.inputValue(), 'Captain B Navigator');
    assert.strictEqual(await page.evaluate(() => compendiumState.dirty), true);
  }],
  ['entry actions and inspector close predictably without taking Escape from a modal', async page => {
    const actions = page.locator('.compendium-entry-actions');
    await actions.locator('summary').click();
    await page.click('[data-compendium-title]');
    assert.strictEqual(await actions.evaluate(element => element.open), false);
    await actions.locator('summary').click();
    await page.keyboard.press('Escape');
    assert.strictEqual(await actions.evaluate(element => element.open), false);
    assert.strictEqual(await actions.locator('summary').evaluate(element => element === document.activeElement), true);
    await actions.locator('summary').click();
    await actions.locator('[data-compendium-pane-toggle="settings"]').click();
    assert.strictEqual(await actions.evaluate(element => element.open), false);
    await page.locator('[data-compendium-aliases]').focus();
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('[data-compendium-inspector]').isHidden(), true);
    assert.strictEqual(await actions.locator('summary').evaluate(element => element === document.activeElement), true);
    await page.click('[data-compendium-pane-toggle="connections"]');
    await page.evaluate(() => {
      const modal = document.createElement('dialog');
      modal.innerHTML = '<button>Close</button>';
      document.body.append(modal); modal.showModal();
    });
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('[data-compendium-inspector]').isHidden(), false);
  }]
];

(async () => {
  const rootPath = path.resolve(__dirname, '..');
  const read = file => fs.readFile(path.join(rootPath, file), 'utf8');
  const [fragment, schema, source, workspace, insights] = await Promise.all([
    read('desktop/fragments/compendium.html'), read('src/core/knowledge/compendium-schema.js'), read('src/desktop/shell/compendium.js'),
    read('src/desktop/shell/compendium-workspace.js').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error)),
    read('src/core/knowledge/compendium-insights.js').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, run] of cases) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(5000);
      try {
        await setup(page, fragment, [schema, insights, source, workspace]);
        await run(page);
        assert.deepStrictEqual(errors, []);
        console.log(`PASS ${name}`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  console.log(`Compendium workspace tests passed (${cases.length} cases, no provider requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
