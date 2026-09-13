/* global bindCompendium compendiumState nativeEditorState renderCompendium
          saveCompendiumEntry loadCompendium selectCompendiumEntry */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const initialCards = [
  { id: 'a', projectId: 'project-a', type: 'character', category: 'character', title: 'Captain A', body: 'Saved A.',
    summary: 'Original summary.', tags: ['crew'], aliases: ['Captain'], order: 5, imageUrl: 'assets/a.png',
    sourceReferences: [{ kind: 'reader-transfer', envelopeId: 'source', sceneId: 'scene-a', excerpt: 'Evidence.' }],
    relatedSceneIds: ['scene-a'], contextPolicy: { mode: 'manual' }, updatedAt: '2026-09-13T00:00:00.000Z' },
  { id: 'b', projectId: 'project-a', type: 'lore', category: 'lore', title: 'Lore B', body: 'Saved B.',
    tags: [], aliases: [], contextPolicy: { mode: 'manual' }, updatedAt: '2026-09-13T00:00:00.000Z' }
];

async function setup(page, fragment, source) {
  await page.setContent(`<!doctype html><html><body>${fragment}</body></html>`);
  await page.evaluate(cards => {
    window.compendiumState = { entries: cards, selectedId: 'a', query: '', type: '', loading: false, dirty: false };
    window.nativeEditorState = { snapshot: { project: { id: 'project-a', title: 'Project A' }, compendium: cards } };
    window.renderContextStrip = () => {};
    window.openCompendiumRewrite = () => {};
    window.contextPolicyMode = entry => entry.contextPolicy?.mode || 'manual';
    window.contextPolicyLabel = () => '手动';
    window.confirmResult = true;
    window.confirmCalls = 0;
    window.confirm = () => { window.confirmCalls += 1; return window.confirmResult; };
    window.requests = [];
    window.fetch = async (url, options = {}) => {
      const request = { url, body: options.body ? JSON.parse(options.body) : null, signal: options.signal };
      window.requests.push(request);
      // Ignore abort intentionally to verify identity guards as well.
      return new Promise(resolve => {
        request.resolve = (payload, ok = true) => resolve({ ok, status: ok ? 200 : 409, json: async () => payload });
      });
    };
  }, structuredClone(initialCards));
  await page.addScriptTag({ content: source });
  await page.evaluate(() => bindCompendium());
}

async function beginSave(page) {
  await page.evaluate(() => { window.pendingSave = saveCompendiumEntry(); });
}

async function finishSave(page, index = 0) {
  await page.evaluate(async position => {
    const request = window.requests[position];
    const entry = { ...request.body.entry, updatedAt: '2026-09-13T00:00:01.000Z' };
    delete entry.expectedUpdatedAt;
    request.resolve({ ok: true, entry });
    await window.pendingSave;
  }, index);
}

const cases = [
  ['normal saving retains hidden metadata and sends the captured optimistic version', async page => {
    await page.fill('[data-compendium-title]', 'Revised captain');
    await beginSave(page);
    const request = await page.evaluate(() => window.requests[0].body);
    assert.strictEqual(request.entry.expectedUpdatedAt, initialCards[0].updatedAt);
    for (const field of ['sourceReferences', 'relatedSceneIds', 'imageUrl', 'order']) {
      assert.deepStrictEqual(request.entry[field], initialCards[0][field]);
    }
    await finishSave(page);
    assert.strictEqual(await page.locator('[data-compendium-save-status]').textContent(), '已保存');
    assert.strictEqual(await page.isDisabled('[data-compendium-delete]'), false);
    assert.strictEqual(await page.evaluate(() => compendiumState.dirty), false);
    assert.strictEqual(await page.evaluate(() => window.requests.length), 1, 'save should not reload all cards');
  }],
  ['typing during save survives and the next draft uses the saved baseline version', async page => {
    await page.fill('[data-compendium-body]', 'Body at save click.');
    await beginSave(page);
    assert.strictEqual(await page.locator('[data-compendium-save-status]').textContent(), '保存中…');
    assert.strictEqual(await page.isDisabled('[data-compendium-body]'), false);
    assert.strictEqual(await page.isDisabled('[data-compendium-save]'), true);
    assert.strictEqual(await page.isDisabled('[data-compendium-delete]'), true);
    await page.fill('[data-compendium-body]', 'Newer unsaved input.');
    await finishSave(page);
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Newer unsaved input.');
    assert.strictEqual(await page.locator('[data-compendium-save-status]').textContent(), '未保存');
    assert.strictEqual(await page.isDisabled('[data-compendium-delete]'), false);
    const draft = await page.evaluate(() => window.captureCompendiumDraft());
    assert.strictEqual(draft.entry.body, 'Newer unsaved input.');
    assert.strictEqual(draft.entry.updatedAt, '2026-09-13T00:00:01.000Z');
    assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.compendium[0].body), 'Body at save click.');
  }],
  ['late save updates its own card without changing a newly selected card', async page => {
    await page.fill('[data-compendium-body]', 'Saved later for A.');
    await beginSave(page);
    assert.strictEqual(await page.evaluate(() => selectCompendiumEntry('b')), true);
    await page.fill('[data-compendium-body]', 'Unsaved B.');
    await finishSave(page);
    assert.strictEqual(await page.evaluate(() => compendiumState.selectedId), 'b');
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Unsaved B.');
    assert.strictEqual(await page.evaluate(() => window.captureCompendiumDraft().entryId), 'b');
    assert.strictEqual(await page.evaluate(() => compendiumState.entries.find(entry => entry.id === 'a').body), 'Saved later for A.');
  }],
  ['declining a card switch keeps the draft identity; selecting the same card succeeds', async page => {
    await page.fill('[data-compendium-body]', 'Unsubmitted A.');
    await page.evaluate(() => { window.confirmResult = false; });
    assert.strictEqual(await page.evaluate(() => selectCompendiumEntry('b')), false);
    assert.strictEqual(await page.evaluate(() => selectCompendiumEntry('a')), true);
    assert.strictEqual(await page.evaluate(() => selectCompendiumEntry('missing')), false);
    assert.strictEqual(await page.evaluate(() => window.confirmCalls), 1);
    const draft = await page.evaluate(() => window.captureCompendiumDraft());
    assert.strictEqual(draft.entryId, 'a');
    assert.strictEqual(draft.entry.body, 'Unsubmitted A.');
  }],
  ['external selection and new reader candidates bind the form to the correct entry', async page => {
    const result = await page.evaluate(() => {
      compendiumState.selectedId = 'b';
      const selected = window.captureCompendiumDraft();
      const candidate = { id: 'reader-new', type: 'lore', title: 'New reader candidate', body: 'New candidate evidence.' };
      compendiumState.entries.push(candidate);
      compendiumState.selectedId = candidate.id;
      compendiumState.dirty = true;
      renderCompendium();
      const draft = window.captureCompendiumDraft();
      return { selected: { id: selected.entryId, body: selected.entry.body }, draft: { id: draft.entryId, body: draft.entry.body }, dirty: compendiumState.dirty };
    });
    assert.deepStrictEqual(result, { selected: { id: 'b', body: 'Saved B.' }, draft: { id: 'reader-new', body: 'New candidate evidence.' }, dirty: true });
  }],
  ['an old project load cannot change the active project snapshot or form', async page => {
    await page.evaluate(() => { window.oldLoad = loadCompendium(); });
    await page.evaluate(() => {
      const card = { id: 'q-card', projectId: 'project-q', title: 'Q card', body: 'Q body.', type: 'note' };
      nativeEditorState.snapshot = { project: { id: 'project-q', title: 'Q' }, compendium: [card] };
      compendiumState.entries = [card];
      compendiumState.selectedId = card.id;
      compendiumState.dirty = false;
      renderCompendium();
    });
    await page.evaluate(async () => { window.requests[0].resolve({ ok: true, entries: [{ id: 'stale-a', body: 'A result.' }] }); await window.oldLoad; });
    assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.compendium[0].id), 'q-card');
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Q body.');
    assert.strictEqual(await page.evaluate(() => compendiumState.loading), false);
  }],
  ['only the latest load can finish loading or replace entries', async page => {
    await page.evaluate(() => { window.oldLoad = loadCompendium(); window.newLoad = loadCompendium(); });
    await page.evaluate(async () => { window.requests[0].resolve({ ok: false, error: 'Obsolete failure' }, false); await window.oldLoad; });
    assert.strictEqual(await page.evaluate(() => compendiumState.loading), true);
    await page.evaluate(async () => { window.requests[1].resolve({ ok: true, entries: [{ id: 'latest', type: 'note', title: 'Latest', body: 'Latest body.' }] }); await window.newLoad; });
    assert.strictEqual(await page.evaluate(() => compendiumState.entries[0].id), 'latest');
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Latest body.');
    assert.strictEqual(await page.evaluate(() => compendiumState.loading), false);
  }],
  ['reopening the same project creates a new snapshot that rejects an old save result', async page => {
    await page.fill('[data-compendium-body]', 'Old session save.');
    await beginSave(page);
    await page.evaluate(() => {
      const reopened = compendiumState.entries.map(entry => ({ ...entry, body: 'Reopened project body.' }));
      nativeEditorState.snapshot = { project: { id: 'project-a', title: 'Project A' }, compendium: reopened };
      compendiumState.entries = reopened;
      compendiumState.dirty = false;
      renderCompendium();
    });
    await finishSave(page);
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Reopened project body.');
    assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.compendium[0].body), 'Reopened project body.');
  }],
  ['refreshing dirty entries preserves draft text and its original conflict version', async page => {
    await page.fill('[data-compendium-body]', 'Local unsaved edit.');
    await page.evaluate(() => { window.refreshing = loadCompendium(); });
    await page.evaluate(async () => {
      window.requests[0].resolve({ ok: true, entries: [{ ...compendiumState.entries[0], body: 'Remote edit.', updatedAt: '2026-09-13T00:00:02.000Z' }] });
      await window.refreshing;
    });
    const draft = await page.evaluate(() => window.captureCompendiumDraft());
    assert.strictEqual(draft.entry.body, 'Local unsaved edit.');
    assert.strictEqual(draft.entry.updatedAt, initialCards[0].updatedAt, 'a reload must not silently rebase unsaved work over a remote edit');
    assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.compendium[0].body), 'Remote edit.');
  }],
  ['a save accepted during an older load invalidates that load', async page => {
    await page.evaluate(() => { window.oldLoad = loadCompendium(); });
    await page.fill('[data-compendium-body]', 'Newest saved body.');
    await beginSave(page);
    await finishSave(page, 1);
    await page.evaluate(async () => { window.requests[0].resolve({ ok: true, entries: [{ id: 'a', type: 'character', body: 'Stale disk read.' }] }); await window.oldLoad; });
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Newest saved body.');
  }],
  ['save and load failures retain the editable draft and report failure', async page => {
    await page.fill('[data-compendium-body]', 'Must survive conflict.');
    await beginSave(page);
    await page.evaluate(async () => { window.requests[0].resolve({ ok: false, error: 'Card version changed' }, false); await window.pendingSave; });
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Must survive conflict.');
    assert.strictEqual(await page.locator('[data-compendium-save-status]').textContent(), '保存失败，修改仍保留');
    assert.strictEqual(await page.isDisabled('[data-compendium-save]'), false);
    assert.strictEqual(await page.isDisabled('[data-compendium-delete]'), false);
    await page.evaluate(() => { window.failedLoad = loadCompendium(); });
    await page.evaluate(async () => { window.requests[1].resolve({ ok: false, error: 'Read failed' }, false); await window.failedLoad; });
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Must survive conflict.');
    assert.strictEqual(await page.evaluate(() => compendiumState.entries.length), 2);
  }],
  ['new-card clicks use the active category and clear a search that would hide the new card', async page => {
    await page.click('[data-compendium-type-chip="location"]');
    await page.fill('[data-compendium-search]', 'No new card could match');
    await page.click('[data-compendium-new]');
    const request = await page.evaluate(() => window.requests[0].body);
    assert.strictEqual(request.entry.type, 'location');
    await page.evaluate(() => window.requests[0].resolve({ ok: true, entry: { ...window.requests[0].body.entry, id: 'new-location', updatedAt: '2026-09-13T00:00:01.000Z' } }));
    await page.waitForFunction(() => compendiumState.selectedId === 'new-location');
    assert.strictEqual(await page.inputValue('[data-compendium-search]'), '');
    assert.strictEqual(await page.locator('[data-compendium-list] .is-active').count(), 1);
    assert.strictEqual(await page.inputValue('[data-compendium-entry-type]'), 'location');
    await page.click('[data-compendium-type-chip="summary"]');
    await page.click('[data-compendium-new]');
    await page.evaluate(() => window.requests[1].resolve({ ok: true, entry: { ...window.requests[1].body.entry, id: 'new-note', updatedAt: '2026-09-13T00:00:02.000Z' } }));
    await page.waitForFunction(() => compendiumState.selectedId === 'new-note');
    assert.strictEqual(await page.evaluate(() => compendiumState.type), 'note');
    assert.strictEqual(await page.locator('[data-compendium-list] .is-active').count(), 1);
  }],
  ['search and filter keep dirty text and the current edited character type visible', async page => {
    await page.evaluate(() => selectCompendiumEntry('b'));
    await page.selectOption('[data-compendium-entry-type]', 'character');
    await page.fill('[data-compendium-body]', 'Typed character body.');
    await page.fill('[data-compendium-search]', 'Nothing');
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Typed character body.');
    assert.strictEqual(await page.locator('[data-compendium-character]').isHidden(), false);
    assert.strictEqual(await page.evaluate(() => window.confirmCalls), 0);
  }]
];

(async () => {
  const root = path.resolve(__dirname, '..');
  const [fragment, source] = await Promise.all([
    fs.readFile(path.join(root, 'desktop/fragments/compendium.html'), 'utf8'),
    fs.readFile(path.join(root, 'src/desktop/shell/compendium.js'), 'utf8')
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, run] of cases) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.route('**/*', route => route.abort());
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(5000);
      try {
        await setup(page, fragment, source);
        await run(page);
        assert.deepStrictEqual(errors, []);
        console.log(`PASS ${name}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Compendium editor state tests passed (${cases.length} cases, no provider requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
