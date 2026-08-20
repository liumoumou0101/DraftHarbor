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
    await page.click('[data-native-summary-dialog-close]');
    await page.click('[data-native-save-scene]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));

    await page.locator('[data-native-scene-id]').first().click();
    await openNativePanel(page, 'metadata');
    await page.waitForSelector('[data-native-generate-chapter-summary]:not([disabled])');
    await page.click('[data-native-generate-chapter-summary]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('章节摘要已生成'));
    const chapterPrompt = await page.evaluate(() => window.__draftHarborLastSummaryPrompt);
    assert.ok(chapterPrompt.some((message) => message.content.includes('下一章从哪接')), 'chapter summary should use the default chapter summary template');
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog]').open);
    await page.click('[data-native-summary-dialog-close]');
    await page.click('[data-native-save-scene]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));
    const saved = await fetch(`${servers.appUrl}/api/get-project?projectId=summary-project`).then((response) => response.json());
    assert.strictEqual(saved.project.scenes[0].summary, 'Scene summary.', 'scene summary should persist after save');
    assert.strictEqual(saved.project.chapters[0].summary, 'Scene summary.', 'chapter summary should persist after save');

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
    assert.strictEqual(afterFailure.project.chapters[0].summary, 'Scene summary.', 'failed generation must not overwrite a saved chapter summary');
    console.log('Summary workflow test passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => { console.error('Summary workflow test failed:', error && error.stack ? error.stack : error); process.exit(1); });
