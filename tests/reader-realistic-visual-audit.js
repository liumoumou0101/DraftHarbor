const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const { realisticReaderMarkdown } = require('./reader-visual-fixture');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, '.ai_state', 'test_reports', 'reader_realistic_visual_audit');
const scenarios = [
  { name: 'dark-double-wide', theme: 'dark', layout: 'double-page', width: 1440, height: 900, chapter: 1 },
  { name: 'paper-single-laptop', theme: 'paper', layout: 'single-page', width: 1280, height: 720, chapter: 1 },
  { name: 'sepia-flow-compact', theme: 'sepia', layout: 'flow', width: 960, height: 640, chapter: 0 },
  { name: 'paper-auto-narrow', theme: 'paper', layout: 'auto', width: 720, height: 640, chapter: 2 }
];

function luminance(rgb) {
  const values = String(rgb).match(/\d+(?:\.\d+)?/g).slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrast(foreground, background) {
  const left = luminance(foreground);
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

async function selectReaderStudioSection(page, section) {
  await page.click(`[data-reader-studio-tab="${section}"]`);
  await page.waitForFunction((expected) => document.querySelector(`[data-reader-studio-section="${expected}"]`)?.hidden === false, section);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-visual-audit-'));
  const fixturePath = path.join(dataRoot, 'reader-realistic-visual.md');
  let servers;
  let browser;
  try {
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(fixturePath, realisticReaderMarkdown(), 'utf8');
    servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const remoteRequests = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(servers.appUrl) && !url.startsWith('data:')) remoteRequests.push(url);
    });
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.click('[data-view-target="reader"]');
    await page.setInputFiles('[data-reader-file]', fixturePath);
    await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]')?.open === true);
    await page.click('[data-reader-import-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('第一章'));
    await page.waitForFunction(() => readerState.apiMode && readerState.contents.length >= 4);
    await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'true');
    const issues = [];
    const contrastResults = [];

    for (const scenario of scenarios) {
      await page.setViewportSize({ width: scenario.width, height: scenario.height });
      await page.evaluate(async (chapterIndex) => {
        const target = readerState.contents[chapterIndex];
        await loadReaderWorkspaceChapter(target.chapterId);
      }, scenario.chapter);
      await page.click('[data-reader-settings-toggle]');
      await selectReaderStudioSection(page, 'paper');
      await page.selectOption('select[data-reader-theme]', scenario.theme);
      await selectReaderStudioSection(page, 'page');
      await page.selectOption('[data-reader-layout-mode]', scenario.layout);
      await page.click('[data-reader-settings-close]');
      await page.waitForFunction((requested) => {
        const effective = document.querySelector('[data-reader-content]').dataset.readerLayout;
        return requested === 'auto' ? ['flow', 'single-page', 'double-page'].includes(effective) : effective === requested;
      }, scenario.layout);
      await page.waitForTimeout(180);
      const state = await page.evaluate(() => {
        const content = document.querySelector('[data-reader-content]');
        const style = getComputedStyle(content);
        const pages = Array.from(document.querySelectorAll('[data-reader-page]'));
        return {
          color: style.color,
          background: style.backgroundColor,
          blockCount: document.querySelectorAll('[data-reader-block]').length,
          layout: content.dataset.readerLayout,
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
          clippedPages: pages.filter((page) => page.scrollHeight > page.clientHeight + 2 || page.scrollWidth > page.clientWidth + 2).length,
          contentWidth: content.clientWidth,
          contentHeight: content.clientHeight
        };
      });
      const ratio = contrast(state.color, state.background);
      contrastResults.push({ scenario: scenario.name, ratio: Math.round(ratio * 100) / 100 });
      if (ratio < 7) issues.push(`${scenario.name}: body contrast ${ratio.toFixed(2)} < 7`);
      if (state.horizontalOverflow > 2) issues.push(`${scenario.name}: horizontal overflow ${state.horizontalOverflow}px`);
      if (state.clippedPages) issues.push(`${scenario.name}: ${state.clippedPages} clipped page(s)`);
      if (state.contentWidth < 240 || state.contentHeight < 120) issues.push(`${scenario.name}: reading content is too small`);
      if (state.layout === 'flow' && state.blockCount > 73) issues.push(`${scenario.name}: flow DOM contains ${state.blockCount} blocks`);
      await page.screenshot({ path: path.join(reportDir, `${scenario.name}.png`), fullPage: false });
    }

    if (remoteRequests.length) issues.push(`unexpected remote requests: ${remoteRequests.join(', ')}`);
    assert.deepStrictEqual(issues, [], `Reader realistic visual audit failed:\n${issues.join('\n')}`);
    console.log(`READER_VISUAL_CONTRAST=${JSON.stringify(contrastResults)}`);
    console.log(`Reader realistic visual audit passed. Screenshots saved to ${path.relative(root, reportDir)}`);
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
