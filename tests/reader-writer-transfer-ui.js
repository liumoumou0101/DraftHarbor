/* global bindReaderWriterTransfer openReaderWriterTransfer readerWriterTransferState */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

async function prepare(page, dialog, source) {
  await page.setContent(`<!doctype html><html><body>${dialog}</body></html>`);
  await page.evaluate(() => {
    const project = id => ({
      id, title: id, updatedAt: 'fixed-version',
      chapters: [{ id: `${id}-chapter`, title: `${id} chapter` }],
      scenes: ['a', 'b'].map(name => ({ id: `${id}-${name}`, chapterId: `${id}-chapter`, title: `${id} ${name}`, content: 'Kept manuscript.' }))
    });
    window.transferFixture = {
      envelope: { envelopeId: 'envelope-1', characterCount: 10, sourceKind: 'local-text' },
      snapshot: { sourceTitle: 'Source title' }, freshness: {}
    };
    window.previewRequests = [];
    window.targetRequests = [];
    window.applyRequests = [];
    window.autoPreview = true;
    window.autoTarget = true;
    window.autoApply = true;
    const response = payload => ({ ok: true, status: 200, json: async () => payload });
    window.fetch = async (url, options = {}) => {
      if (url === '/api/list-projects') return response({ projects: ['p', 'q'].map(id => ({ id, name: id, health: 'ok' })) });
      if (url.startsWith('/api/get-project?')) {
        const id = new URL(url, 'http://fixture.test').searchParams.get('projectId');
        if (window.autoTarget) return response({ ok: true, project: project(id) });
        return new Promise(resolve => window.targetRequests.push({ id, signal: options.signal, resolve: () => resolve(response({ ok: true, project: project(id) })) }));
      }
      if (url === '/api/writer/reader-transfer/preview') {
        const request = JSON.parse(options.body);
        const preview = {
          request, previewToken: `token-${window.previewRequests.length}`, intent: request.intent,
          targetProject: request.intent === 'new-project' ? null : { id: request.targetProjectId, updatedAt: 'fixed-version' },
          targetSceneId: request.targetSceneId, targetChapterId: request.targetChapterId,
          location: { sceneId: '', message: `${request.intent} ${request.targetSceneId} ${request.newProjectTitle}` },
          conflicts: [`${request.intent} ${request.targetSceneId}`],
          items: ['one', 'two'].map(itemId => ({ itemId, title: itemId, characterCount: 5 }))
        };
        const entry = { request, signal: options.signal, preview };
        window.previewRequests.push(entry);
        if (window.autoPreview) return response({ ok: true, preview });
        // Deliberately ignore abort here, so request identity must also protect
        // against servers/transports that complete an already-cancelled request.
        return new Promise((resolve, reject) => {
          entry.resolve = () => resolve(response({ ok: true, preview }));
          entry.reject = () => reject(new Error('Obsolete preview failed'));
        });
      }
      if (url === '/api/writer/reader-transfer/apply') {
        const request = JSON.parse(options.body);
        const entry = { request };
        window.applyRequests.push(entry);
        const result = { ok: true, applied: true, projectId: request.targetProjectId || 'imported', targetSceneIds: [request.targetSceneId] };
        if (window.autoApply) return response(result);
        return new Promise(resolve => { entry.resolve = () => resolve(response(result)); });
      }
      throw new Error(`Unexpected network request: ${url}`);
    };
    window.currentProjectId = () => 'p';
    window.loadNativeProjectEditor = value => { window.loadedProject = value; };
    window.nativeEditorState = {};
    window.renderNativeEditor = () => {};
    window.loadProjectLibrary = async () => {};
  });
  await page.addScriptTag({ content: source });
  await page.evaluate(async () => {
    bindReaderWriterTransfer();
    await openReaderWriterTransfer(window.transferFixture);
  });
}

async function ready(page) {
  await page.waitForFunction(() => !readerWriterTransferState.busy && !!readerWriterTransferState.preview);
}

const cases = [
  ['latest intent and scene preview wins; stale success and failure cannot restore confirmation', async page => {
    await page.check('[data-reader-writer-confirm]');
    await page.evaluate(() => { window.autoPreview = false; });
    await page.selectOption('[data-reader-writer-intent]', 'append');
    await page.waitForFunction(() => window.previewRequests.length === 2);
    assert.strictEqual(await page.isChecked('[data-reader-writer-confirm]'), false);
    assert.strictEqual(await page.isDisabled('[data-reader-writer-apply]'), true);
    await page.selectOption('[data-reader-writer-intent]', 'replace');
    await page.waitForFunction(() => window.previewRequests.length === 3);
    await page.selectOption('[data-reader-writer-scene]', 'p-b');
    await page.waitForFunction(() => window.previewRequests.length === 4);
    assert.strictEqual(await page.evaluate(() => window.previewRequests[1].signal.aborted), true);
    await page.evaluate(() => window.previewRequests[3].resolve());
    await ready(page);
    await page.evaluate(() => { window.previewRequests[1].resolve(); window.previewRequests[2].reject(); });
    assert.deepStrictEqual(await page.evaluate(() => ({
      intent: readerWriterTransferState.preview.intent,
      scene: readerWriterTransferState.previewRequest.targetSceneId,
      status: document.querySelector('[data-reader-writer-status]').textContent,
      busy: readerWriterTransferState.busy
    })), { intent: 'replace', scene: 'p-b', status: '预览完成；确认前项目磁盘不会变化。', busy: false });
    assert.strictEqual(await page.isChecked('[data-reader-writer-confirm]'), false);
    await page.check('[data-reader-writer-confirm]');
    await page.click('[data-reader-writer-apply]');
    assert.deepStrictEqual(await page.evaluate(() => window.applyRequests.map(item => [item.request.intent, item.request.targetSceneId])), [['replace', 'p-b']]);
  }],
  ['application sends the frozen preview request and locks controls until completion', async page => {
    await page.selectOption('[data-reader-writer-intent]', 'append');
    await ready(page);
    await page.check('[data-reader-writer-confirm]');
    await page.evaluate(() => {
      window.autoApply = false;
      // A programmatic control update without its change event must not change
      // the already-confirmed request that will be sent to the service.
      document.querySelector('[data-reader-writer-intent]').value = 'replace';
      document.querySelector('[data-reader-writer-scene]').value = 'p-b';
    });
    await page.click('[data-reader-writer-apply]');
    const sent = await page.evaluate(() => window.applyRequests[0].request);
    assert.strictEqual(sent.intent, 'append');
    assert.strictEqual(sent.targetSceneId, 'p-a');
    assert.strictEqual(sent.previewToken, 'token-1');
    assert.strictEqual(sent.expectedTargetUpdatedAt, 'fixed-version');
    for (const name of ['project', 'intent', 'chapter', 'scene', 'project-title', 'refresh', 'confirm']) {
      assert.strictEqual(await page.isDisabled(`[data-reader-writer-${name}]`), true, `${name} must not change during application`);
    }
    await page.evaluate(() => window.applyRequests[0].resolve());
    await page.waitForFunction(() => !document.querySelector('[data-reader-writer-dialog]').open);
  }],
  ['obsolete project loads cannot replace the latest target options', async page => {
    await page.evaluate(() => { window.autoTarget = false; });
    await page.selectOption('[data-reader-writer-project]', 'q');
    await page.waitForFunction(() => window.targetRequests.length === 1);
    await page.selectOption('[data-reader-writer-project]', 'p');
    await page.waitForFunction(() => window.targetRequests.length === 2);
    await page.evaluate(() => window.targetRequests[1].resolve());
    await ready(page);
    await page.evaluate(() => window.targetRequests[0].resolve());
    assert.deepStrictEqual(await page.evaluate(() => ({
      project: readerWriterTransferState.targetSnapshot.id,
      request: readerWriterTransferState.previewRequest.targetProjectId,
      scenes: [...document.querySelector('[data-reader-writer-scene]').options].map(option => option.value)
    })), { project: 'p', request: 'p', scenes: ['p-a', 'p-b'] });
  }],
  ['editing a new project title invalidates confirmation and previews the new title', async page => {
    await page.selectOption('[data-reader-writer-intent]', 'new-project');
    await ready(page);
    await page.check('[data-reader-writer-confirm]');
    await page.evaluate(() => { window.autoPreview = false; });
    await page.fill('[data-reader-writer-project-title]', 'Confirmed new title');
    await page.waitForFunction(() => window.previewRequests.length === 3);
    assert.strictEqual(await page.isChecked('[data-reader-writer-confirm]'), false);
    assert.strictEqual(await page.isDisabled('[data-reader-writer-confirm]'), true);
    await page.evaluate(() => window.previewRequests[2].resolve());
    await ready(page);
    await page.check('[data-reader-writer-confirm]');
    await page.click('[data-reader-writer-apply]');
    assert.strictEqual(await page.evaluate(() => window.applyRequests[0].request.newProjectTitle), 'Confirmed new title');
  }],
  ['section changes clear confirmation and an empty selection cannot apply', async page => {
    await page.check('[data-reader-writer-confirm]');
    const sections = page.locator('[data-reader-writer-sections] input');
    await sections.nth(0).uncheck();
    assert.strictEqual(await page.isChecked('[data-reader-writer-confirm]'), false);
    await sections.nth(1).uncheck();
    await page.check('[data-reader-writer-confirm]');
    assert.strictEqual(await page.isDisabled('[data-reader-writer-apply]'), true);
    assert.strictEqual(await page.evaluate(() => window.applyRequests.length), 0);
    await sections.nth(0).check();
    assert.strictEqual(await page.isChecked('[data-reader-writer-confirm]'), false);
    await page.check('[data-reader-writer-confirm]');
    await page.click('[data-reader-writer-apply]');
    assert.deepStrictEqual(await page.evaluate(() => window.applyRequests[0].request.selectedItemIds), ['one']);
  }],
  ['closing and opening another envelope isolates unfinished previews', async page => {
    await page.evaluate(() => { window.autoPreview = false; });
    await page.selectOption('[data-reader-writer-intent]', 'append');
    await page.waitForFunction(() => window.previewRequests.length === 2);
    await page.click('[data-reader-writer-close]');
    await page.waitForFunction(() => readerWriterTransferState.transfer === null);
    await page.evaluate(() => {
      window.transferFixture.envelope.envelopeId = 'envelope-2';
      window.openingSecondTransfer = openReaderWriterTransfer(window.transferFixture);
    });
    await page.waitForFunction(() => window.previewRequests.length === 3);
    await page.evaluate(() => window.previewRequests[1].resolve());
    assert.deepStrictEqual(await page.evaluate(() => ({ busy: readerWriterTransferState.busy, preview: readerWriterTransferState.preview })), { busy: true, preview: null });
    await page.evaluate(async () => { window.previewRequests[2].resolve(); await window.openingSecondTransfer; });
    await ready(page);
    assert.strictEqual(await page.evaluate(() => readerWriterTransferState.previewRequest.envelopeId), 'envelope-2');
  }]
];

(async () => {
  const root = path.resolve(__dirname, '..');
  const [fragment, source] = await Promise.all([
    fs.readFile(path.join(root, 'desktop/fragments/writer.html'), 'utf8'),
    fs.readFile(path.join(root, 'src/desktop/shell/reader-writer-transfer.js'), 'utf8')
  ]);
  const dialog = fragment.match(/<dialog\b[^>]*data-reader-writer-dialog[\s\S]*?<\/dialog>/)[0];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, run] of cases) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(5000);
      try {
        await prepare(page, dialog, source);
        await run(page);
        assert.deepStrictEqual(errors, []);
        console.log(`PASS ${name}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Reader writer transfer UI tests passed (${cases.length} cases, isolated DOM and mocked network).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
