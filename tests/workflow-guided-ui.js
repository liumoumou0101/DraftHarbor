const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');

async function activeStage(page, title) {
  try {
    await page.waitForFunction((expected) => {
      const node = document.querySelector('.desktop-workflow-step-card.is-active strong');
      return node && node.textContent.includes(expected);
    }, title);
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      active: document.querySelector('.desktop-workflow-step-card.is-active strong')?.textContent || '',
      status: document.querySelector('[data-workflow-status]')?.textContent || ''
    }));
    throw new Error(`${error.message}; expected=${title}; active=${diagnostics.active}; status=${diagnostics.status}`);
  }
}

async function generateAndApprove(page, title) {
  await activeStage(page, title);
  await page.click('[data-workflow-guided-generate]');
  await page.waitForFunction(() => document.querySelector('[data-workflow-reasoning-content]')?.textContent.includes('正在梳理人物与情节'));
  await page.waitForSelector('[data-workflow-guided-approve]:not([disabled])');
  await page.click('[data-workflow-guided-approve]');
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-guided-ui-'));
  let servers = null;
  let browser = null;
  try {
    await projectService.createProject(dataRoot, {
      id: 'guided-ui-project',
      title: '引导工作流验收项目',
      chapters: [{ id: 'chapter-1', title: '钟楼疑云', order: 0 }],
      scenes: [{ id: 'scene-1', chapterId: 'chapter-1', title: '停止的怀表', summary: '林岚发现怀表', content: '林岚在旧钟楼发现一枚停止转动的怀表。', order: 0 }]
    });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const browserErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.desktop-project-card');
    await page.focus('.desktop-project-card');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent.includes('引导工作流验收项目'));
    await page.click('[data-view-target="workflow"]');
    await page.waitForSelector('[data-view-panel="workflow"].is-active');

    await page.evaluate(() => {
      window.__workflowThinkingSeen = false;
      window.__workflowFailNext = false;
      window.__workflowSlowProse = false;
      window.__releaseWorkflowProse = null;
      window.__draftHarborGenerationStub = async (prompt, onToken, settings) => {
        if (window.__workflowFailNext) {
          window.__workflowFailNext = false;
          throw new Error('模拟 Provider 首响应超时');
        }
        if (settings && settings.enableThinking) window.__workflowThinkingSeen = true;
        const system = prompt.messages[0].content;
        let output = '';
        onToken('正在梳理人物与情节…', { type: 'reasoning' });
        if (system.includes('分析小说原文')) {
          output = JSON.stringify({ hierarchicalSummary: { projectSummary: '林岚调查钟楼' }, outline: ['发现怀表'], characterCandidates: [{ id: 'lin', type: 'character', title: '林岚', summary: '钟楼谜案调查者', aliases: ['小林'] }] });
        } else if (system.includes('续写方向')) {
          output = JSON.stringify({ directions: [
            { id: 'countdown', title: '怀表倒计时', premise: '怀表开始倒计时。', plotFocus: '钟楼秘密', emotionalArc: '疑惑到恐惧', risks: [] },
            { id: 'letter', title: '表中密信', premise: '表盖内藏着密信。', plotFocus: '失踪案', emotionalArc: '希望到怀疑', risks: [] }
          ] });
        } else if (system.includes('场景计划')) {
          output = JSON.stringify({ fineOutlineEnabled: true, scenes: [
            { id: 'midnight', title: '午夜回响', povCharacter: '林岚', location: '旧钟楼', goal: '启动怀表', conflict: '齿轮逆转', outcome: '暗门开启', emotionalBeat: '恐惧', fineOutline: ['登塔', '启动怀表'] },
            { id: 'secret-room', title: '暗门之后', povCharacter: '林岚', location: '密室', goal: '寻找线索', conflict: '脚步逼近', outcome: '取得密信', emotionalBeat: '紧张', fineOutline: ['进入密室', '取得密信'] }
          ] });
        } else if (system.includes('语义连续性审查')) {
          output = JSON.stringify({ summary: '语义审查通过', findings: [] });
        } else {
          const payload = JSON.parse(prompt.messages[1].content);
          output = `${payload.currentScene.title}的验收正文。林岚遵守约束继续调查。`;
        }
        if (window.__workflowSlowProse && !output.startsWith('{')) {
          window.__workflowSlowProse = false;
          const splitAt = Math.max(1, Math.floor(output.length / 2));
          onToken(output.slice(0, splitAt), { type: 'content' });
          await new Promise((resolve) => { window.__releaseWorkflowProse = resolve; });
          onToken(output.slice(splitAt), { type: 'content' });
          return;
        }
        onToken(output, { type: 'content' });
      };
    });

    await page.fill('[data-workflow-brief]', '续写钟楼谜案，保持悬疑感。');
    await page.fill('[data-workflow-direction-locks]', '强化林岚的不安');
    await page.fill('[data-workflow-exclusion-locks]', '不要揭晓幕后凶手');
    await page.check('[data-workflow-thinking]');
    await page.click('[data-workflow-start-guided]');
    await page.waitForSelector('[data-workflow-guided-generate]');
    assert.ok(
      !(await page.locator('[data-workflow-status]').innerText()).includes('续写范围内没有正文'),
      'workflow launch validation must read prose from snapshot.sceneContents'
    );
    assert.strictEqual(await page.locator('[data-workflow-launcher]').evaluate((node) => node.open), false, 'new-run settings should collapse after launch');
    assert.strictEqual(await page.locator('[data-workflow-events-details]').evaluate((node) => node.open), false, 'diagnostic events should stay collapsed by default');
    await page.click('[data-workflow-launcher] > summary');
    await page.uncheck('[data-workflow-thinking]');
    assert.strictEqual(
      await page.evaluate(() => window.guidedStageProviderConfig('analysis').enableThinking),
      true,
      'run must retain its frozen thinking setting after the launch form changes'
    );

    assert.strictEqual(await page.evaluate(() => window.guidedStageProviderConfig('analysis').firstResponseTimeoutMs), 90000);
    await page.evaluate(() => { window.__workflowFailNext = true; });
    await page.click('[data-workflow-guided-generate]');
    await page.waitForSelector('[data-workflow-generation-error]');
    assert.ok((await page.locator('[data-workflow-generation-error]').innerText()).includes('模拟 Provider 首响应超时'));
    assert.strictEqual(await page.locator('[data-workflow-guided-generate]').isEnabled(), true, 'failed stage must remain retryable');

    await generateAndApprove(page, '原文分析');
    await activeStage(page, '续写方向');
    await page.click('[data-workflow-guided-generate]');
    await page.waitForSelector('.desktop-workflow-direction-options input');
    assert.ok(await page.locator('.desktop-workflow-direction-options input').first().isChecked());
    await page.waitForSelector('[data-workflow-current-result]');
    assert.ok((await page.locator('[data-workflow-current-result]').innerText()).includes('怀表倒计时'));
    assert.strictEqual(await page.locator('[data-workflow-guided-generate]').count(), 0, 'waiting review must not show a disabled generate action');
    assert.ok((await page.locator('[data-workflow-guided-approve]').getAttribute('class')).includes('desktop-primary-action'));
    assert.strictEqual(await page.locator('[data-workflow-guided-regenerate]').isVisible(), true);
    await page.click('[data-workflow-guided-regenerate]');
    await page.waitForSelector('[data-workflow-guided-generate]:not([disabled])');
    await page.click('[data-workflow-guided-generate]');
    await page.waitForSelector('[data-workflow-current-result]');
    await page.click('[data-workflow-guided-approve]');

    await activeStage(page, '场景计划与细纲');
    assert.strictEqual(await page.locator('[data-workflow-guided-return="direction"]').isVisible(), true);
    await page.click('[data-workflow-guided-generate]');
    await page.waitForSelector('[data-artifact-view="json"]');
    await page.click('[data-artifact-view="json"]');
    await page.waitForSelector('[data-workflow-artifact-editor]:not([readonly])');
    const planEditor = page.locator('[data-workflow-artifact-editor]');
    const plan = JSON.parse(await planEditor.inputValue());
    plan.scenes[0].title = '用户修改后的午夜回响';
    await planEditor.fill(JSON.stringify(plan, null, 2));
    await page.click('[data-workflow-artifact-save]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]')?.textContent.includes('修改已保存'));
    await page.click('[data-workflow-guided-approve]');

    await activeStage(page, '分场正文');
    await page.evaluate(() => { window.__workflowSlowProse = true; });
    await page.click('[data-workflow-guided-generate]');
    await page.waitForSelector('[data-workflow-stream-stage][data-phase="streaming"]');
    const liveText = await page.locator('[data-workflow-stream-text]').innerText();
    assert.ok(liveText.length > 0, 'partial prose must become visible before the provider response finishes');
    assert.ok(!liveText.includes('继续调查'), 'live stage must expose an intermediate response instead of waiting for completion');
    assert.ok(
      (await page.locator('[data-workflow-step-progress]').innerText()).includes(`${liveText.length} 字符`),
      'compact progress and live manuscript must report the same received length'
    );
    if (process.env.WORKFLOW_STREAM_SCREENSHOT) {
      await page.screenshot({ path: process.env.WORKFLOW_STREAM_SCREENSHOT, fullPage: true });
    }
    assert.strictEqual(await page.locator('[data-workflow-stream-follow]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-workflow-stream-viewport]').evaluate((node) => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    });
    assert.strictEqual(await page.locator('[data-workflow-stream-follow]').getAttribute('aria-pressed'), 'false', 'scrolling upward must pause auto-follow');
    await page.click('[data-workflow-stream-follow]');
    assert.strictEqual(await page.locator('[data-workflow-stream-follow]').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.__releaseWorkflowProse());
    await page.waitForSelector('[data-workflow-guided-approve]:not([disabled])');
    assert.strictEqual(await page.locator('[data-workflow-stream-stage]').getAttribute('data-phase'), 'complete');
    const completedLiveText = await page.locator('[data-workflow-stream-text]').innerText();
    assert.ok(completedLiveText.includes('继续调查'));
    assert.ok(completedLiveText.includes('暗门之后'), 'each scene must start with a clean live preview');
    assert.ok(!completedLiveText.includes('用户修改后的午夜回响'), 'the previous scene must not leak into the next live preview');
    await page.click('[data-workflow-guided-approve]');
    await activeStage(page, '自动审查');
    await page.click('[data-workflow-guided-generate]');
    await activeStage(page, '转到写作与资料库');
    await page.click('[data-workflow-guided-transfer-writer]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('正文已转入写作区'));
    await page.click('[data-workflow-guided-transfer-compendium]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('资料建议已写入资料库'));

    const opened = await projectService.openProject(dataRoot, 'guided-ui-project');
    const generated = opened.project.scenes.filter((scene) => scene.sourceRunId);
    assert.strictEqual(generated.length, 2);
    assert.ok(generated.every((scene) => scene.sourceArtifactId && scene.sourceRevisionId));
    assert.ok(generated.some((scene) => scene.content.includes('用户修改后的午夜回响')));
    assert.strictEqual(await page.evaluate(() => window.__workflowThinkingSeen), true);
    const compendiumResponse = await fetch(`${servers.appUrl}/api/compendium?projectId=guided-ui-project`);
    const compendium = await compendiumResponse.json();
    assert.ok(compendium.entries.some((entry) => entry.title === '林岚'));
    assert.deepStrictEqual(browserErrors, []);

    console.log('Workflow guided UI test passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow guided UI test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
