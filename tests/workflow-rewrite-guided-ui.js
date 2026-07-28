const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');

async function activeStage(page, title) {
  try {
    await page.waitForFunction((expected) => document.querySelector('.desktop-workflow-step-card.is-active strong')?.textContent.includes(expected), title);
  } catch (error) {
    const state = await page.evaluate(() => ({ active: document.querySelector('.desktop-workflow-step-card.is-active strong')?.textContent || '', status: document.querySelector('[data-workflow-status]')?.textContent || '' }));
    throw new Error(`${error.message}; expected=${title}; state=${JSON.stringify(state)}`);
  }
}

async function generateAndApprove(page, title) {
  await activeStage(page, title);
  await page.click('[data-workflow-guided-generate]');
  await page.waitForSelector('[data-workflow-guided-approve]:not([disabled])');
  await page.click('[data-workflow-guided-approve]');
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-rewrite-guided-ui-'));
  let servers = null;
  let browser = null;
  try {
    const created = await projectService.createProject(dataRoot, { id: 'rewrite-ui-project', title: '重写界面验收' });
    const firstOriginal = '雨下了很久。林岚终于抵达钟楼，并发现地上的足迹。';
    const secondOriginal = '暗门打开，林岚走进密室，看到一枚停止转动的怀表。';
    await projectService.saveProject(dataRoot, {
      ...created.project,
      chapterOrder: ['chapter-1'], sceneOrder: ['s1', 's2'], currentSceneId: 's1',
      chapters: [{ ...created.project.chapters[0], id: 'chapter-1', title: '钟楼', sceneIds: ['s1', 's2'], order: 0 }],
      scenes: [
        { ...created.project.scenes[0], id: 's1', chapterId: 'chapter-1', title: '抵达', content: firstOriginal, order: 0 },
        { ...created.project.scenes[0], id: 's2', chapterId: 'chapter-1', title: '密室', content: secondOriginal, order: 1 }
      ]
    });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const browserErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.type() === 'prompt' ? dialog.accept('强化冲突替代版') : dialog.accept());
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.desktop-project-card');
    await page.focus('.desktop-project-card');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent.includes('重写界面验收'));
    await page.click('[data-view-target="workflow"]');

    await page.evaluate(() => {
      window.__rewriteThinkingSeen = false;
      window.__draftHarborGenerationStub = async (prompt, onToken, settings) => {
        if (settings?.enableThinking) window.__rewriteThinkingSeen = true;
        const system = prompt.messages[0].content;
        const payload = JSON.parse(prompt.messages[1].content);
        let output = '';
        onToken('正在比较原文、重写规则与相邻场景…', { type: 'reasoning' });
        if (system.includes('为每个来源场景设计')) {
          output = JSON.stringify({ strategy: '压缩铺垫并增加机关阻力', units: [
            { id: 'arrival', title: '抵达', sourceSceneId: 's1', targetSceneId: 's1', objective: '尽快进入悬念', rules: [{ kind: 'compress', instruction: '压缩雨景' }], preserveFacts: ['发现足迹'] },
            { id: 'room', title: '密室', sourceSceneId: 's2', targetSceneId: 's2', objective: '增加进入代价', rules: [{ kind: 'expand', instruction: '增加机关' }], preserveFacts: ['发现怀表'] }
          ] });
        } else if (system.includes('长篇小说改稿作者')) {
          output = `替代版：${payload.original}`;
        } else if (system.includes('长篇连续性编辑')) {
          output = payload.unit.targetSceneId === 's1'
            ? '林岚冲进钟楼，湿漉的足迹一路通向暗门。'
            : '循着足迹，林岚触发齿轮机关，避开后闯入密室并拾起怀表。';
        } else if (system.includes('长篇小说作者')) {
          output = payload.unit.targetSceneId === 's1'
            ? '林岚冲进钟楼，足迹通向暗门。'
            : '机关落下，林岚闯入密室并拾起怀表。';
        } else if (system.includes('重写审查编辑')) {
          output = JSON.stringify({ summary: '重写符合计划', findings: [] });
        }
        onToken(output, { type: 'content' });
      };
    });

    await page.selectOption('[data-workflow-mode]', 'rewrite');
    await page.selectOption('[data-workflow-rewrite-scope]', 'chapter');
    await page.fill('[data-workflow-rewrite-instruction]', '压缩开场，强化悬疑与场景衔接，保留关键线索。');
    await page.fill('[data-workflow-rewrite-style]', '克制冷峻');
    await page.check('[data-workflow-thinking]');
    await page.click('[data-workflow-start-rewrite]');

    await activeStage(page, '可编辑重写计划');
    await page.click('[data-workflow-guided-generate]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-reasoning-content]')?.textContent.includes('正在比较原文'));
    await page.waitForSelector('[data-workflow-artifact-editor]:not([readonly])');
    await page.waitForSelector('[data-workflow-current-result]');
    assert.strictEqual(await page.locator('[data-workflow-current-result]').isVisible(), true);
    assert.ok((await page.locator('[data-workflow-mode-note]').innerText()).includes('正在查看：大段重写'));
    const editor = page.locator('[data-workflow-artifact-editor]');
    const plan = JSON.parse(await editor.inputValue());
    plan.units[0].objective = '用户确认：直接进入足迹悬念';
    await editor.fill(JSON.stringify(plan, null, 2));
    await page.click('[data-workflow-artifact-save]');
    await page.waitForSelector('[data-workflow-guided-approve]:not([disabled])');
    await page.click('[data-workflow-guided-approve]');

    await generateAndApprove(page, '分场景大段重写');
    await activeStage(page, '衔接修复与差异');
    await page.click('[data-workflow-guided-generate]');
    await page.waitForSelector('.desktop-workflow-rewrite-comparison');
    assert.strictEqual(await page.locator('.desktop-workflow-rewrite-comparison').count(), 2);
    const checkboxes = page.locator('.desktop-workflow-rewrite-comparison input[type="checkbox"]');
    assert.strictEqual(await checkboxes.count(), 2);
    assert.ok(await checkboxes.nth(0).isChecked());
    assert.ok(await checkboxes.nth(1).isChecked());
    await checkboxes.nth(1).uncheck();
    assert.ok(await page.locator('[data-diff-type="delete"]').count() > 0);
    assert.ok(await page.locator('[data-diff-type="insert"]').count() > 0);
    await page.click('[data-workflow-guided-approve]');

    await activeStage(page, '重写审查');
    await page.click('[data-workflow-guided-generate]');
    await activeStage(page, '选择场景并回流写作区');
    await page.click('[data-workflow-guided-transfer-writer]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('已更新 1 个原场景'));

    const opened = await projectService.openProject(dataRoot, 'rewrite-ui-project');
    const first = opened.project.scenes.find((scene) => scene.id === 's1');
    const second = opened.project.scenes.find((scene) => scene.id === 's2');
    assert.ok(first.content.includes('足迹一路通向暗门'));
    assert.strictEqual(second.content, secondOriginal, 'unchecked scene must preserve its original content');
    assert.ok(first.sourceRunId && first.sourceArtifactId && first.sourceRevisionId);
    assert.strictEqual(await page.evaluate(() => window.__rewriteThinkingSeen), true);

    await page.click('[data-workflow-generate-variant]');
    try { await page.waitForSelector('[data-workflow-variant-panel]'); }
    catch (error) {
      const status = await page.locator('[data-workflow-status]').innerText();
      throw new Error(`${error.message}; status=${status}`);
    }
    await page.check('[data-workflow-variant-choice="s2"][value="left"]');
    await page.click('[data-workflow-approve-variant]');
    await page.waitForSelector('[data-workflow-apply-variant-selection]:not([disabled])');
    await page.click('[data-workflow-apply-variant-selection]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('所选场景版本已应用'));
    const mixedProject = (await projectService.openProject(dataRoot, 'rewrite-ui-project')).project;
    assert.ok(mixedProject.scenes.find((scene) => scene.id === 's1').content.startsWith('替代版：'));
    assert.ok(mixedProject.scenes.find((scene) => scene.id === 's2').content.includes('循着足迹'), 'second scene should adopt the main workflow version');
    assert.deepStrictEqual(browserErrors, []);
    console.log('Workflow rewrite guided UI test passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => { console.error('Workflow rewrite guided UI test failed:', error && error.stack ? error.stack : error); process.exit(1); });
