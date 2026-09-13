/* global bindCompendium bindCompendiumRewrite bindNativeCompendiumExtraction bindCompendiumDraw
          compendiumState openNativeCompendiumExtraction */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const dialogs = {
  rewrite: { modal: '[data-compendium-rewrite-modal]', generate: '[data-compendium-rewrite-generate]',
    status: '[data-compendium-rewrite-status]', output: '[data-compendium-rewrite-preview]',
    generateFunction: 'generateCompendiumRewrite', saveFunction: 'applyCompendiumRewrite',
    save: '[data-compendium-rewrite-apply]', trigger: '[data-compendium-ai-rewrite]' },
  extract: { modal: '[data-native-extract-modal]', generate: '[data-native-extract-generate]',
    status: '[data-native-extract-status]', output: '[data-native-extract-title]',
    generateFunction: 'generateNativeCompendiumDraft', saveFunction: 'saveNativeCompendiumDraft',
    save: '[data-native-extract-form] button[type="submit"]', trigger: '[data-test-extract-trigger]' },
  draw: { modal: '[data-compendium-draw-modal]', generate: '[data-compendium-draw-generate]',
    status: '[data-compendium-draw-status]', output: '[data-compendium-draw-title]',
    generateFunction: 'generateCompendiumDraw', saveFunction: 'saveCompendiumDraw',
    save: '[data-compendium-draw-save]', trigger: '[data-compendium-more]' }
};

async function prepare(page, fragments, sources) {
  await page.setContent(`<!doctype html><html><head><style>[hidden]{display:none!important} dialog{max-height:85vh;max-width:90vw;overflow:auto}</style></head><body>
    <button data-test-extract-trigger>Extract selected text</button><button data-test-background>Background control</button>
    ${fragments.join('\n')}</body></html>`);
  await page.evaluate(() => {
    const cards = [
      { id: 'a', projectId: 'project-a', type: 'character', title: 'Captain A', body: 'Saved original body.', summary: 'Original summary.',
        tags: ['crew'], aliases: ['Captain'], order: 7, imageUrl: 'assets/a.png', relatedSceneIds: ['scene-a'],
        sourceReferences: [{ kind: 'reader-transfer', envelopeId: 'origin', excerpt: 'Original evidence.' }],
        characterProfile: { goal: 'Keep the ship afloat.' }, updatedAt: '2026-09-13T00:00:00.000Z', contextPolicy: { mode: 'manual' } },
      { id: 'b', projectId: 'project-a', type: 'lore', title: 'Reference B', body: 'Reference only.', tags: [], aliases: [], contextPolicy: { mode: 'manual' } }
    ];
    window.compendiumState = { entries: cards, selectedId: 'a', query: '', type: '', loading: false, dirty: false };
    window.nativeEditorState = { snapshot: { project: { id: 'project-a', title: 'A' }, compendium: cards } };
    window.renderContextStrip = () => {};
    window.contextPolicyMode = () => 'manual';
    window.contextPolicyLabel = () => '手动';
    window.setNativeSaveStatus = () => {};
    window.setView = () => {};
    window.confirm = () => true;
    window.currentExcerpt = { scene: { id: 'scene-a', title: 'Scene A' }, selected: 'Evidence from A.' };
    window.nativeSelectedOrSceneExcerpt = () => window.currentExcerpt;
    window.writerEffectiveProfile = () => { if (window.throwProfile) throw new Error('Profile setup failure'); return {}; };
    window.writerSelectedModelId = () => 'offline-test';
    window.nativeGenerationConfig = () => ({});
    window.calls = [];
    window.writes = [];
    window.getNativeAITaskRunner = () => ({ run: (task, options) => {
      if (window.throwRunner) throw new Error('Runner threw synchronously');
      return new Promise((resolve, reject) => {
        window.calls.push({ task, prompt: options.prompt.asString(), signal: options.abortController?.signal,
          token: text => options.onToken({ text }), finish: output => resolve({ ok: true, output }),
          fail: () => reject(new Error('Old request failure')) });
      });
    } });
    window.fetch = async (url, options = {}) => {
      if (url === '/api/compendium' && options.method === 'POST') {
        const body = JSON.parse(options.body);
        return new Promise(resolve => {
          window.writes.push({ body, finish: () => {
            const entry = { ...body.entry };
            delete entry.expectedUpdatedAt;
            const saved = { ...entry, id: entry.id || `created-${window.writes.length}`, updatedAt: '2026-09-13T00:00:01.000Z' };
            const index = cards.findIndex(card => card.id === saved.id);
            if (index < 0) cards.push(saved); else cards[index] = saved;
            resolve({ ok: true, json: async () => ({ ok: true, entry: saved }) });
          } });
        });
      }
      // Real save success must update the cache from its own response. A
      // subsequent GET failure must not hide a successfully created card.
      throw new Error(`Unexpected follow-up network request: ${url}`);
    };
  });
  for (const source of sources) await page.addScriptTag({ content: source });
  await page.evaluate(() => {
    bindCompendium(); bindCompendiumRewrite(); bindNativeCompendiumExtraction(); bindCompendiumDraw();
    document.querySelector('[data-test-extract-trigger]').addEventListener('click', openNativeCompendiumExtraction);
  });
}

async function open(page, name) {
  if (name === 'draw') {
    if (await page.locator('[data-compendium-more-menu]').isHidden()) await page.click('[data-compendium-more]');
    await page.click('[data-compendium-draw]');
  } else await page.click(dialogs[name].trigger);
  await page.waitForFunction(selector => document.querySelector(selector).open, dialogs[name].modal);
}

async function complete(page, name, index, value = 'Current result') {
  await page.evaluate(({ type, position, text }) => {
    const output = type === 'rewrite' ? { summary: text } : [{ type: 'character', title: text, body: `${text} body.`, characterProfile: { goal: 'A concrete goal.' } }];
    window.calls[position].finish(output);
  }, { type: name, position: index, text: value });
  await page.waitForFunction(selector => !document.querySelector(selector).disabled, dialogs[name].generate);
}

const cases = [
  ['rewrite captures unsaved body and summary-only application preserves metadata with CAS', async page => {
    await page.fill('[data-compendium-body]', 'Visible unsaved manuscript facts.');
    await open(page, 'rewrite');
    await page.locator('[data-compendium-rewrite-field]').evaluateAll(fields => {
      for (const field of fields) field.checked = field.value === 'summary';
      fields[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click(dialogs.rewrite.generate);
    assert.ok((await page.evaluate(() => window.calls[0].prompt)).includes('Visible unsaved manuscript facts.'));
    await complete(page, 'rewrite', 0, 'Only the summary changes.');
    await page.click(dialogs.rewrite.save);
    const request = await page.evaluate(() => window.writes[0].body);
    assert.strictEqual(request.entry.body, 'Visible unsaved manuscript facts.');
    assert.strictEqual(request.entry.summary, 'Only the summary changes.');
    assert.strictEqual(request.entry.expectedUpdatedAt, '2026-09-13T00:00:00.000Z');
    assert.strictEqual(request.entry.imageUrl, 'assets/a.png');
    assert.strictEqual(request.entry.order, 7);
    assert.deepStrictEqual(request.entry.relatedSceneIds, ['scene-a']);
    assert.strictEqual(request.entry.sourceReferences[0].envelopeId, 'origin');
    await page.evaluate(() => window.writes[0].finish());
    await page.waitForFunction(() => !document.querySelector('[data-compendium-rewrite-modal]').open);
    assert.strictEqual(await page.inputValue('[data-compendium-body]'), 'Visible unsaved manuscript facts.');
    assert.strictEqual(await page.evaluate(() => compendiumState.dirty), false);
  }],
  ['a changed draft rejects an already generated rewrite patch', async page => {
    await open(page, 'rewrite');
    await page.click(dialogs.rewrite.generate);
    await complete(page, 'rewrite', 0);
    await page.evaluate(() => {
      const body = document.querySelector('[data-compendium-body]');
      body.value = 'Changed by another editor action.';
      body.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click(dialogs.rewrite.save);
    assert.strictEqual(await page.evaluate(() => window.writes.length), 0);
    assert.ok((await page.locator(dialogs.rewrite.status).textContent()).includes('发生变化'));
    assert.strictEqual(await page.isDisabled(dialogs.rewrite.save), true);
  }],
  ['rewrite field, instruction, and reference changes each invalidate the preview', async page => {
    await open(page, 'rewrite');
    for (const [index, input] of ['field', 'instruction', 'reference'].entries()) {
      await page.click(dialogs.rewrite.generate);
      await complete(page, 'rewrite', index);
      assert.strictEqual(await page.isDisabled(dialogs.rewrite.save), false);
      if (input === 'field') await page.locator('[data-compendium-rewrite-field][value="tags"]').check();
      if (input === 'instruction') await page.fill('[data-compendium-rewrite-instruction]', 'A new requirement.');
      if (input === 'reference') {
        await page.locator('[data-compendium-rewrite-reference-list]').evaluate(list => { list.closest('details').open = true; });
        await page.locator('[data-compendium-rewrite-reference-list] input').first().check();
      }
      assert.strictEqual(await page.isDisabled(dialogs.rewrite.save), true, `${input} changes need a new preview`);
      assert.strictEqual(await page.inputValue(dialogs.rewrite.output), '');
    }
  }]
];

for (const name of Object.keys(dialogs)) {
  const config = dialogs[name];
  for (const outcome of ['success', 'failure']) {
    cases.push([`${name}: closing and reopening ignores obsolete tokens and ${outcome}`, async page => {
      await open(page, name);
      await page.click(config.generate);
      await page.evaluate(functionName => window[functionName](), config.generateFunction);
      assert.strictEqual(await page.evaluate(() => window.calls.length), 1, 'duplicate generation must not start another request');
      await page.keyboard.press('Escape');
      await page.waitForFunction(selector => !document.querySelector(selector).open, config.modal);
      assert.strictEqual(await page.evaluate(() => window.calls[0].signal.aborted), true);
      if (name === 'extract') await page.evaluate(() => { window.currentExcerpt = { scene: { id: 'scene-b', title: 'B' }, selected: 'Evidence from B.' }; });
      await open(page, name);
      await page.click(config.generate);
      const status = await page.locator(config.status).textContent();
      await page.evaluate(result => {
        window.calls[0].token('OLD TOKEN MUST NOT APPEAR');
        if (result === 'failure') window.calls[0].fail();
        else window.calls[0].finish([{ title: 'OLD RESULT', body: 'Old result body.' }]);
      }, outcome);
      assert.strictEqual(await page.locator(config.status).textContent(), status);
      assert.strictEqual(await page.isDisabled(config.generate), true, 'old finally must not unlock a new generation');
      assert.strictEqual(await page.inputValue(config.output), '');
      await complete(page, name, 1);
      assert.ok((await page.inputValue(config.output)).includes('Current result'));
      if (name === 'extract') {
        await page.click(config.save);
        assert.strictEqual(await page.evaluate(() => window.writes[0].body.entry.sourceReferences[0].sceneId), 'scene-b');
        await page.evaluate(() => window.writes[0].finish());
      }
    }]);
  }
  cases.push([`${name}: setup and runner exceptions always release busy controls`, async page => {
    await open(page, name);
    await page.evaluate(() => { window.throwProfile = true; });
    await page.click(config.generate);
    assert.strictEqual(await page.isDisabled(config.generate), false);
    assert.ok((await page.locator(config.status).textContent()).includes('Profile setup failure'));
    await page.evaluate(() => { window.throwProfile = false; window.throwRunner = true; });
    await page.click(config.generate);
    assert.strictEqual(await page.isDisabled(config.generate), false);
    assert.ok((await page.locator(config.status).textContent()).includes('Runner threw synchronously'));
  }]);
  cases.push([`${name}: saving is single-flight and updates local state without a follow-up GET`, async page => {
    await open(page, name);
    await page.click(config.generate);
    await complete(page, name, 0);
    await page.click(config.save);
    await page.evaluate(functionName => window[functionName](), config.saveFunction);
    assert.strictEqual(await page.evaluate(() => window.writes.length), 1);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator(config.modal).evaluate(modal => modal.open), true, 'saving cannot be dismissed midway');
    await page.evaluate(() => window.writes[0].finish());
    await page.waitForFunction(selector => !document.querySelector(selector).open, config.modal);
    assert.ok(await page.evaluate(type => compendiumState.entries.some(entry => type === 'rewrite' ? entry.summary === 'Current result' : entry.title === 'Current result'), name));
  }]);
  cases.push([`${name}: native dialog keeps keyboard focus out of the background and Escape restores the trigger`, async page => {
    await open(page, name);
    assert.strictEqual(await page.locator(config.modal).evaluate(modal => modal.matches(':modal')), true);
    for (let index = 0; index < 18; index += 1) {
      await page.keyboard.press(index % 3 ? 'Tab' : 'Shift+Tab');
      const focus = await page.evaluate(selector => {
        const active = document.activeElement;
        return { background: active.matches('[data-test-background], [data-compendium-title], [data-compendium-body], [data-compendium-new]'),
          contained: document.querySelector(selector).contains(active), browserChrome: active === document.body };
      }, config.modal);
      assert.strictEqual(focus.background, false);
      assert.ok(focus.contained || focus.browserChrome);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(selector => !document.querySelector(selector).open, config.modal);
    assert.strictEqual(await page.locator(config.trigger).evaluate(trigger => document.activeElement === trigger), true);
  }]);
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const fragments = await Promise.all(['compendium', 'modals'].map(name => fs.readFile(path.join(root, `desktop/fragments/${name}.html`), 'utf8')));
  const sources = await Promise.all(['compendium', 'compendium-references', 'compendium-rewrite', 'compendium-extraction', 'compendium-draw']
    .map(name => fs.readFile(path.join(root, `src/desktop/shell/${name}.js`), 'utf8')));
  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  try {
    for (const [name, run] of cases) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.route('**/*', route => route.abort());
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(5000);
      try {
        await prepare(page, fragments, sources);
        await run(page);
        assert.deepStrictEqual(errors, []);
        console.log(`PASS ${name}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}: ${error.stack || error}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.strictEqual(failures, 0, `${failures} compendium AI dialog case(s) failed`);
  console.log(`Compendium AI dialog tests passed (${cases.length} cases, no provider requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
