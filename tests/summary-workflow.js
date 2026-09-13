/* global openNativeSummaryDialog saveNativeSummaryDialog nativeEditorState compendiumState */
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const { openNativePanel } = require('./helpers/native-panel');

function snapshot() {
  return {
    version: '2.1-summary-workflow-test',
    exportedAt: '2026-07-11T00:00:00.000Z',
    filesystemSavedAt: '2026-07-11T00:00:00.000Z',
    project: { id: 'summary-project', name: 'Summary Project', created: '2026-07-11T00:00:00.000Z', modified: '2026-07-11T00:00:00.000Z' },
    chapters: [{ id: 'summary-chapter', projectId: 'summary-project', title: 'Summary Chapter', order: 0 }],
    scenes: [{ id: 'summary-scene', projectId: 'summary-project', chapterId: 'summary-chapter', title: 'Summary Scene', order: 0 }],
    sceneContents: { 'summary-scene': 'The navigator finds the missing chart in the flooded archive.' },
    compendium: [], prompts: [], codex: [], promptHistory: [], workshopSessions: []
  };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-summary-'));
  let servers = null;
  let browser = null;
  try {
    const projectsDir = path.join(dataRoot, 'projects');
    await fs.mkdir(projectsDir, { recursive: true });
    await fs.writeFile(path.join(projectsDir, 'Summary Project--summary-project.json'), JSON.stringify(snapshot()), 'utf8');
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.desktop-project-card');
    await page.locator('.desktop-project-card').first().click();
    await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent.includes('Summary Project'));

    await page.click('[data-view-target="settings"]');
    await page.selectOption('[data-settings-mode]', 'api');
    await page.selectOption('[data-settings-provider]', 'openai-compatible');
    await page.fill('[data-settings-endpoint]', 'https://example.test/v1/chat/completions');
    await page.selectOption('[data-settings-model-pick]', '__custom__');
    await page.fill('[data-settings-model]', 'summary-test-model');
    await page.fill('[data-settings-api-key]', 'summary-test-key');
    await page.locator('[data-settings-form] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-settings-status]').textContent.includes('设置已保存'));

    await page.click('[data-view-target="writer"]');
    await page.locator('[data-native-scene-id]').first().click();
    await openNativePanel(page, 'metadata');
    await page.waitForSelector('[data-native-generate-scene-summary]:not([disabled])');
    await page.waitForFunction(() => Array.from(document.querySelector('[data-native-summary-template]').options).some((option) => option.value === 'default-summary-scene'));
    await page.evaluate(() => {
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        window.__draftHarborLastSummaryPrompt = prompt.messages;
        onToken('Hidden reasoning stream.', { type: 'reasoning' });
        onToken('<think>Hidden content reasoning.</think>', { type: 'content' });
        for (const token of ['Scene', ' summary.']) onToken(token);
      };
    });
    await page.click('[data-native-generate-scene-summary]');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-summary]').value === 'Scene summary.');
    const scenePrompt = await page.evaluate(() => window.__draftHarborLastSummaryPrompt);
    assert.ok(scenePrompt.some((message) => message.content.includes('发生了什么') && message.content.includes('谁的目标变了')), 'scene summary should use the default scene summary template');
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog]').open);
    await page.click('[data-native-summary-dialog-save]');
    await page.waitForFunction(() => {
      const meta = document.querySelector('[data-native-summary-dialog-meta]');
      const status = document.querySelector('[data-native-save-status]');
      return meta && meta.textContent.includes('已保存') && status && status.textContent.includes('场景摘要已保存');
    });
    await page.click('[data-native-summary-dialog-close]');
    const sceneNotes = await fetch(`${servers.appUrl}/api/compendium?projectId=summary-project&type=note`).then((response) => response.json());
    assert.ok(sceneNotes.ok, 'compendium list should return after saving a scene summary');
    assert.strictEqual(sceneNotes.entries.length, 1, 'saving a scene summary should create one note card');
    assert.ok(sceneNotes.entries[0].tags.includes('scene-summary'), 'scene summary note should be tagged');
    assert.ok(sceneNotes.entries[0].title.includes('第 1 章 · 第 1 场'), 'scene summary note should use a catalog chapter/scene heading');
    assert.ok(sceneNotes.entries[0].title.includes('Summary Scene'), 'custom scene titles should stay in the summary note name');
    assert.strictEqual(sceneNotes.entries[0].contextPolicy.mode, 'mention', 'summary notes should default to mention injection');
    await page.click('[data-view-target="compendium"]');
    await page.click('[data-compendium-type-chip="summary"]');
    await page.waitForFunction(() => {
      const items = Array.from(document.querySelectorAll('.desktop-compendium-item'));
      return items.some((item) => item.textContent.includes('第 1 章 · 第 1 场'))
        && items.some((item) => item.textContent.includes('提及时注入'));
    });
    await page.click('[data-compendium-type-chip="note"]');
    await page.waitForFunction(() => {
      const items = Array.from(document.querySelectorAll('.desktop-compendium-item'));
      return items.length === 1 && items[0].textContent.includes('没有匹配的资料');
    });
    await page.click('[data-view-target="writer"]');

    await page.locator('[data-native-scene-id]').first().click();
    await openNativePanel(page, 'metadata');
    await page.waitForSelector('[data-native-generate-chapter-summary]:not([disabled])');
    await page.click('[data-native-generate-chapter-summary]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('章节摘要已生成'));
    const chapterPrompt = await page.evaluate(() => window.__draftHarborLastSummaryPrompt);
    assert.ok(chapterPrompt.some((message) => message.content.includes('下一章从哪接')), 'chapter summary should use the default chapter summary template');
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog]').open);
    await page.click('[data-native-summary-dialog-save]');
    await page.waitForFunction(() => {
      const meta = document.querySelector('[data-native-summary-dialog-meta]');
      const status = document.querySelector('[data-native-save-status]');
      return meta && meta.textContent.includes('已保存') && status && status.textContent.includes('章节摘要已保存');
    });
    await page.click('[data-native-summary-dialog-close]');
    await page.click('[data-native-save-scene]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));
    const saved = await fetch(`${servers.appUrl}/api/get-project?projectId=summary-project`).then((response) => response.json());
    assert.strictEqual(saved.project.scenes[0].summary, 'Scene summary.', 'scene summary should persist after save');
    assert.strictEqual(saved.project.chapters[0].summary, 'Scene summary.', 'chapter summary should persist after save');
    const allNotes = await fetch(`${servers.appUrl}/api/compendium?projectId=summary-project&type=note`).then((response) => response.json());
    assert.strictEqual(allNotes.entries.length, 2, 'scene and chapter summaries should each keep one note card');
    assert.ok(allNotes.entries.some((entry) => entry.tags.includes('chapter-summary')), 'chapter summary note should be tagged');

    const chapterNote = allNotes.entries.find((entry) => entry.tags.includes('chapter-summary'));
    let noteWrites = 0;
    let heldNoteRoute = null;
    let noteRequest = null;
    const holdNote = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      noteWrites += 1;
      noteRequest = route.request().postDataJSON();
      heldNoteRoute = route;
    };
    await page.route('**/api/compendium', holdNote);
    await page.evaluate(() => openNativeSummaryDialog('chapter'));
    await page.fill('[data-native-summary-dialog-content]', 'Chapter summary revised.');
    const pendingNote = page.waitForRequest(request => request.url().endsWith('/api/compendium') && request.method() === 'POST');
    await page.click('[data-native-summary-dialog-save]');
    await pendingNote;
    assert.strictEqual(await page.isDisabled('[data-native-summary-dialog-save]'), true, 'summary saving should disable duplicate submissions');
    assert.strictEqual(await page.evaluate(() => saveNativeSummaryDialog()), false, 'programmatic duplicate saving should be ignored too');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('[data-native-summary-dialog]').evaluate(dialog => dialog.open), true, 'pending summary save should keep its dialog open');
    assert.strictEqual(noteRequest.entry.id, chapterNote.id, 'updating a linked summary should reuse its existing card');
    assert.strictEqual(noteRequest.entry.expectedUpdatedAt, chapterNote.updatedAt, 'summary cards should send the captured optimistic version');
    await heldNoteRoute.continue();
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog-meta]').textContent === '摘要和资料卡已保存');
    assert.strictEqual(noteWrites, 1);
    await page.unroute('**/api/compendium', holdNote);
    const revisedNotes = await fetch(`${servers.appUrl}/api/compendium?projectId=summary-project&type=note`).then(response => response.json());
    assert.strictEqual(revisedNotes.entries.length, 2, 'updating summaries must not create duplicate cards');
    assert.strictEqual(revisedNotes.entries.find(entry => entry.id === chapterNote.id).body, 'Chapter summary revised.');

    const failedWriter = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Simulated writer save failure' }) });
    await page.route('**/api/save-project', failedWriter);
    const failedNote = route => {
      if (route.request().method() !== 'POST') return route.continue();
      noteWrites += 1;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Simulated summary card failure' }) });
    };
    await page.route('**/api/compendium', failedNote);
    await page.fill('[data-native-summary-dialog-content]', 'Recovered chapter summary.');
    await page.click('[data-native-summary-dialog-save]');
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog-meta]').textContent.includes('摘要未保存'));
    assert.strictEqual(noteWrites, 1, 'failed writer save must not send a compendium write');
    await page.unroute('**/api/save-project', failedWriter);
    await page.click('[data-native-summary-dialog-save]');
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog-meta]').textContent.includes('摘要已保存；资料卡未保存'));
    const afterCardFailure = await fetch(`${servers.appUrl}/api/get-project?projectId=summary-project`).then(response => response.json());
    assert.strictEqual(afterCardFailure.project.chapters[0].summary, 'Recovered chapter summary.', 'card failure should not hide the successfully saved chapter summary');
    assert.strictEqual(await page.evaluate(id => compendiumState.entries.find(entry => entry.id === id).body, chapterNote.id), 'Chapter summary revised.', 'a failed card write must not update the local card');
    await page.unroute('**/api/compendium', failedNote);
    await page.click('[data-native-summary-dialog-save]');
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog-meta]').textContent === '摘要和资料卡已保存');
    const retriedNotes = await fetch(`${servers.appUrl}/api/compendium?projectId=summary-project&type=note`).then(response => response.json());
    assert.strictEqual(retriedNotes.entries.length, 2, 'retrying a failed card write should update the same linked note');
    assert.strictEqual(retriedNotes.entries.find(entry => entry.id === chapterNote.id).body, 'Recovered chapter summary.');
    await page.click('[data-native-summary-dialog-close]');

    await page.fill('[data-native-scene-editor]', 'The navigator revises the flooded archive plan.');
    await page.click('[data-native-save-scene]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));
    const staleSaved = await fetch(`${servers.appUrl}/api/get-project?projectId=summary-project`).then((response) => response.json());
    assert.strictEqual(staleSaved.project.scenes[0].summaryStale, true, 'editing scene content should mark its summary stale');
    assert.strictEqual(staleSaved.project.chapters[0].summaryStale, true, 'editing scene content should mark the chapter summary stale');

    await page.evaluate(() => { window.__draftHarborGenerationStub = async () => { throw new Error('summary provider failure'); }; });
    await openNativePanel(page, 'metadata');
    await page.waitForSelector('[data-native-generate-chapter-summary]:not([disabled])');
    await page.click('[data-native-generate-chapter-summary]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('summary provider failure'));
    const afterFailure = await fetch(`${servers.appUrl}/api/get-project?projectId=summary-project`).then((response) => response.json());
    assert.strictEqual(afterFailure.project.chapters[0].summary, 'Recovered chapter summary.', 'failed generation must not overwrite a saved chapter summary');

    await page.route('**/api/compendium', holdNote);
    await page.evaluate(() => openNativeSummaryDialog('chapter'));
    const lateNote = page.waitForRequest(request => request.url().endsWith('/api/compendium') && request.method() === 'POST');
    await page.click('[data-native-summary-dialog-save]');
    await lateNote;
    await page.evaluate(() => {
      nativeEditorState.snapshot = { project: { id: 'another-project' }, compendium: [] };
      compendiumState.entries = [];
      document.querySelector('[data-native-summary-dialog-meta]').textContent = 'New project remains untouched';
    });
    await heldNoteRoute.continue();
    await page.waitForFunction(() => !document.querySelector('[data-native-summary-dialog-save]').disabled);
    assert.deepStrictEqual(await page.evaluate(() => compendiumState.entries), [], 'late note responses must not populate another project');
    assert.strictEqual(await page.locator('[data-native-summary-dialog-meta]').textContent(), 'New project remains untouched');
    console.log('Summary workflow test passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => { console.error('Summary workflow test failed:', error && error.stack ? error.stack : error); process.exit(1); });
