const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');

const projectRoot = path.resolve(__dirname, '..');

const cards = [
  { type: 'character', title: '陆辞舟', summary: '文物修复师，接到匿名委托修复《无渡》。', tags: ['主角'], alwaysInContext: true, characterProfile: { role: '现代线主角', goal: '查明家族与手抄本的关联', conflict: '中立修复 vs 揭露历史' }, body: '陆辞舟性格沉静，对历史真实近乎偏执。' },
  { type: 'character', title: '雾都少女·艾琳', summary: '旧书店店员，夜间调查父亲失踪。', tags: ['配角'], contextPolicy: { mode: 'mention' }, body: '白天是店员，夜晚独行雾巷。' },
  { type: 'location', title: '无渡书坊', summary: '隐在旧城区的修复工坊。', tags: ['地点'], contextPolicy: { mode: 'auto' }, body: '铁门后是檀香与矿物颜料气味。' },
  { type: 'organization', title: '守墨会', summary: '保存被删削史籍的隐秘组织。', tags: ['组织'], body: '自称不改一字，只保存被烧掉的页。' },
  { type: 'item', title: '《无渡》手抄本', summary: '明代装帧，夹层藏符号。', tags: ['关键物'], alwaysInContext: true, body: '夹层符号与陆氏族徽同源。' },
  { type: 'lore', title: '无渡纪年', summary: '被抹去的王朝使用潮汐纪年。', tags: ['设定'], contextPolicy: { mode: 'disabled' }, body: '无渡之夜指潮水不退的那一晚。' },
  { type: 'timeline', title: '匿名委托到来', summary: '故事真正开始。', tags: ['时间线'], body: '委托信没有落款。' },
  { type: 'note', title: '写作备忘', summary: '物件必须先于人物说话。', tags: ['笔记'], body: '先让书页入场。' }
];

async function createFixture(dataRoot) {
  await projectService.createProject(dataRoot, {
    id: 'compendium-layout-audit',
    title: '无渡',
    description: '资料库布局审计',
    status: 'Drafting',
    tags: ['audit']
  });
  for (const card of cards) {
    await compendiumService.saveEntry(dataRoot, 'compendium-layout-audit', card);
  }
}

async function openCompendium(page, appUrl) {
  await page.goto(`${appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.desktop-project-card', { timeout: 10000 });
  await page.locator('.desktop-project-card').filter({ hasText: '无渡' }).first().click();
  await page.waitForFunction(() => document.querySelector('#desktop-root')?.dataset.view === 'writer');
  await page.click('[data-view-target="compendium"]');
  await page.waitForSelector('.desktop-compendium-item.is-active', { timeout: 10000 });
}

async function auditViewport(page, label) {
  return page.evaluate((auditLabel) => {
    const issues = [];
    const tolerance = 2;
    const list = document.querySelector('.desktop-compendium-list');
    const tools = document.querySelector('.desktop-compendium-tools');
    const body = document.querySelector('[data-compendium-body]');
    const strip = document.querySelector('[data-context-strip]');
    const rewriteFooter = document.querySelector('[data-compendium-rewrite-form] .desktop-modal-actions');
    const rewriteOpen = document.querySelector('[data-compendium-rewrite-modal]');
    if (!list || !tools || !body) {
      issues.push(`${auditLabel}: missing list, tools, or body`);
      return issues;
    }
    const listRect = list.getBoundingClientRect();
    const toolsRect = tools.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const items = document.querySelectorAll('.desktop-compendium-list .desktop-compendium-item');
    const visibleItems = Array.from(items).filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > listRect.top + 4 && rect.top < listRect.bottom - 4;
    }).length;
    if (listRect.height + tolerance < toolsRect.height) {
      issues.push(`${auditLabel}: list ${Math.round(listRect.height)}px is shorter than tools ${Math.round(toolsRect.height)}px`);
    }
    if (visibleItems < 4) {
      issues.push(`${auditLabel}: only ${visibleItems} list rows visible, expected at least 4`);
    }
    if (bodyRect.top >= window.innerHeight - 24 || bodyRect.height < 160) {
      issues.push(`${auditLabel}: body is not on the first screen (top ${Math.round(bodyRect.top)}, height ${Math.round(bodyRect.height)})`);
    }
    const floor = window.innerHeight <= 720 ? 180 : window.innerHeight <= 1080 ? 240 : 280;
    if (bodyRect.height + tolerance < floor) {
      issues.push(`${auditLabel}: body height ${Math.round(bodyRect.height)}px < ${floor}px`);
    }
    if (strip && !strip.hidden && getComputedStyle(strip).display !== 'none') {
      issues.push(`${auditLabel}: context strip is still visible`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth + tolerance) {
      issues.push(`${auditLabel}: horizontal overflow`);
    }
    if (rewriteOpen && !rewriteOpen.hidden && rewriteFooter) {
      const footerRect = rewriteFooter.getBoundingClientRect();
      if (footerRect.bottom > window.innerHeight + tolerance || footerRect.height < 24) {
        issues.push(`${auditLabel}: rewrite footer is clipped`);
      }
    }
    return issues;
  }, label);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-compendium-layout-'));
  let servers = null;
  let browser = null;
  try {
    await createFixture(dataRoot);
    servers = await startDesktopServers({ appRoot: projectRoot, dataRoot });
    browser = await chromium.launch({ headless: true });
    const viewports = [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 }
    ];
    const themes = ['morandi-ink', 'mist-library', 'xuan-paper'];
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      await openCompendium(page, servers.appUrl);
      for (const theme of themes) {
        await page.evaluate((nextTheme) => {
          if (typeof window.applyDesktopTheme === 'function') window.applyDesktopTheme(nextTheme);
        }, theme);
        const issues = await auditViewport(page, `${viewport.width}x${viewport.height}/${theme}`);
        assert.deepStrictEqual(issues, [], issues.join('\n'));
      }
      if (viewport.height === 720) {
        await page.click('[data-compendium-ai-rewrite]');
        await page.waitForFunction(() => document.querySelector('[data-compendium-rewrite-modal]') && !document.querySelector('[data-compendium-rewrite-modal]').hidden);
        const rewriteIssues = await auditViewport(page, '720-rewrite');
        assert.deepStrictEqual(rewriteIssues, [], rewriteIssues.join('\n'));
        const patchOpen = await page.locator('[data-compendium-rewrite-patch]').evaluate((element) => element.open);
        assert.strictEqual(patchOpen, false, 'rewrite JSON patch should stay collapsed until generated');
      }
      await page.close();
    }
    console.log('Compendium layout audit passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Compendium layout audit failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
