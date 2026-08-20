const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workshop-ui-'));
  let servers = null;
  let browser = null;
  try {
    await projectService.createProject(dataRoot, {
      id: 'workshop-ui-project',
      title: '讨论测试稿',
      chapters: [{ id: 'chapter-1', title: 'Opening', order: 0 }],
      scenes: [{
        id: 'scene-1',
        chapterId: 'chapter-1',
        title: '第一场',
        summary: '港口起雾。',
        content: '潮水拍上堤岸。'
      }]
    });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#desktop-root');

    await page.click('[data-view-target="workshop"]');
    await page.waitForFunction(() => document.querySelector('#desktop-root')?.dataset.view === 'workshop');
    const closedState = await page.evaluate(() => {
      const heading = document.querySelector('[data-workshop-empty-content] h3');
      const status = document.querySelector('[data-workshop-status]');
      const convert = document.querySelector('[data-workshop-output-actions]');
      const contract = document.querySelector('[data-workshop-contract-panel]');
      const title = document.querySelector('[data-workshop-title]');
      return {
        heading: heading ? heading.textContent : '',
        status: status ? status.textContent : '',
        convertHidden: !!(convert && convert.hidden),
        contractHidden: !!(contract && contract.hidden),
        title: title ? title.textContent : ''
      };
    });
    assert.strictEqual(closedState.heading, '想清楚再写', 'workshop without a project should show the closed empty state');
    assert.ok(closedState.status.includes('未打开项目'), 'workshop without a project should say so');
    assert.ok(closedState.convertHidden, 'convert bar must stay hidden without a reply');
    assert.ok(closedState.contractHidden, 'session contract must not occupy the first screen');
    assert.ok(!/workshop/i.test(closedState.title), 'workshop main title should not be English Workshop');

    await page.click('[data-view-target="bookshelf"]');
    await page.waitForSelector('.desktop-project-card');
    await page.focus('.desktop-project-card');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#desktop-root')?.dataset.view === 'writer');
    await page.click('[data-view-target="workshop"]');
    await page.waitForFunction(() => document.querySelector('#desktop-root')?.dataset.view === 'workshop');
    await page.waitForFunction(() => document.querySelector('[data-workshop-new]') && !document.querySelector('[data-workshop-new]').disabled);

    const openEmpty = await page.evaluate(() => {
      const starters = Array.from(document.querySelectorAll('.desktop-workshop-empty-starter')).map((button) => button.textContent);
      const convert = document.querySelector('[data-workshop-output-actions]');
      const contract = document.querySelector('[data-workshop-contract-panel]');
      const chat = document.querySelector('.desktop-workshop-chat');
      const thread = document.querySelector('.desktop-workshop-thread');
      const header = document.querySelector('.desktop-workshop-chat-header');
      const composer = document.querySelector('.desktop-workshop-composer');
      const chatStyle = chat ? window.getComputedStyle(chat) : {};
      return {
        starters,
        convertHidden: !!(convert && convert.hidden),
        contractHidden: !!(contract && contract.hidden),
        threadHeight: thread ? Math.round(thread.getBoundingClientRect().height) : 0,
        headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
        composerHeight: composer ? Math.round(composer.getBoundingClientRect().height) : 0,
        chatRows: chatStyle.gridTemplateRows || ''
      };
    });
    assert.strictEqual(openEmpty.starters.length, 3, 'open project empty state should offer three starters');
    assert.ok(openEmpty.starters.includes('人物卡住了：TA 现在会怎么做？'), 'starter copy should include the character prompt');
    assert.ok(openEmpty.convertHidden, 'convert bar should stay hidden before any assistant reply');
    assert.ok(openEmpty.contractHidden, 'session contract should stay folded on first screen');
    assert.ok(openEmpty.threadHeight > openEmpty.headerHeight, `thread should outgrow the header (${openEmpty.threadHeight} vs ${openEmpty.headerHeight})`);
    assert.ok(openEmpty.threadHeight > openEmpty.composerHeight, `thread should outgrow the composer (${openEmpty.threadHeight} vs ${openEmpty.composerHeight})`);

    await page.click('.desktop-workshop-empty-starter');
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-workshop-input]');
      return input && input.value.includes('人物卡住了');
    });

    const templateCount = await page.locator('[data-workshop-template] option').count();
    assert.ok(templateCount >= 3, 'discussion angle select should list built-in workshop templates');

    await page.evaluate(() => {
      window.__workshopGenerationCalls = 0;
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        window.__workshopGenerationCalls += 1;
        window.__lastWorkshopPrompt = prompt && prompt.asString ? prompt.asString() : JSON.stringify(prompt);
        for (const token of [' 港口', ' 仍有', ' 退路。']) {
          await new Promise((resolve) => setTimeout(resolve, 4));
          onToken(token);
        }
      };
    });
    await page.click('[data-workshop-send]');
    await page.waitForFunction(() => window.__workshopGenerationCalls > 0);
    await page.waitForFunction(() => document.querySelector('[data-workshop-messages]') && document.querySelector('[data-workshop-messages]').textContent.includes('港口 仍有 退路。'));
    await page.waitForFunction(() => {
      const convert = document.querySelector('[data-workshop-output-actions]');
      return convert && !convert.hidden;
    });

    page.once('dialog', async (dialog) => {
      assert.strictEqual(dialog.type(), 'confirm');
      await dialog.dismiss();
    });
    await page.click('[data-workshop-to-compendium]');
    const dismissedStatus = await page.locator('[data-workshop-status]').textContent();
    assert.ok(!dismissedStatus.includes('已转为资料条目'), 'dismissing convert confirm must not save a note');

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.click('[data-workshop-to-compendium]');
    await page.waitForFunction(() => document.querySelector('[data-workshop-status]').textContent.includes('已转为资料条目'));

    await page.click('[data-workshop-more]');
    await page.waitForFunction(() => document.querySelector('[data-workshop-more-menu]') && !document.querySelector('[data-workshop-more-menu]').hidden);
    await page.click('[data-workshop-contract-toggle]');
    await page.waitForFunction(() => document.querySelector('[data-workshop-contract-panel]') && !document.querySelector('[data-workshop-contract-panel]').hidden);
    await page.check('[data-workshop-contract-enabled]');
    await page.fill('[data-workshop-contract-content]', '只讨论人物动机。');
    await page.click('[data-workshop-contract-save]');
    await page.waitForFunction(() => document.querySelector('[data-workshop-contract-content]').value.includes('只讨论人物动机'));

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.click('[data-workshop-more]');
    await page.waitForFunction(() => document.querySelector('[data-workshop-more-menu]') && !document.querySelector('[data-workshop-more-menu]').hidden);
    await page.click('[data-workshop-delete]');
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-workshop-session-list]');
      return list && !list.textContent.includes('对话 1');
    });

    console.log('Workshop UI test passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workshop UI test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
