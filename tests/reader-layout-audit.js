const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const { realisticReaderMarkdown } = require('./reader-visual-fixture');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, '.ai_state', 'test_reports', 'reader_layout_audit');
const scenarios = [
  { label: '1280x800-100', width: 1280, height: 800 },
  { label: '1280x800-125', width: 1024, height: 640 },
  { label: '1280x800-150', width: 853, height: 533 },
  { label: '1280x800-200', width: 640, height: 400 },
  { label: '1366x768-100', width: 1366, height: 768 },
  { label: '1920x1080-100', width: 1920, height: 1080 },
  { label: '2560x1440-100', width: 2560, height: 1440 }
];

async function importFixture(page, appUrl, fixturePath) {
  await page.goto(`${appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-view-target="reader"]');
  await page.setInputFiles('[data-reader-file]', fixturePath);
  await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]')?.open === true);
  try {
    await page.click('[data-reader-import-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('第一章'));
    await page.waitForFunction(() => readerState.apiMode && readerState.contents.length >= 4, null, { timeout: 15000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      apiMode: readerState.apiMode,
      contents: readerState.contents.length,
      title: document.querySelector('[data-reader-title]')?.textContent,
      body: document.querySelector('[data-reader-content]')?.textContent.slice(0, 300)
    }));
    throw new Error(`reader visual fixture failed to open: ${JSON.stringify(state)}`);
  }
  await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'true');
  await page.waitForFunction(() => document.querySelectorAll('[data-reader-block]').length > 0);
}

async function auditViewport(page, label) {
  return page.evaluate((auditLabel) => {
    const issues = [];
    const tolerance = 2;
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    };
    const rect = (node) => {
      const value = node.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    const name = (node) => String(node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth + tolerance) issues.push(`${auditLabel}: document horizontal overflow ${doc.scrollWidth} > ${innerWidth}`);
    const shell = document.querySelector('[data-reader-shell]');
    const stage = document.querySelector('[data-reader-theme-panel]');
    const content = document.querySelector('[data-reader-content]');
    for (const [kind, node] of [['shell', shell], ['stage', stage], ['content', content]]) {
      if (!node || !visible(node)) issues.push(`${auditLabel}: ${kind} is not visible`);
      else {
        const box = rect(node);
        if (box.left < -tolerance || box.right > innerWidth + tolerance) issues.push(`${auditLabel}: ${kind} exceeds viewport horizontally`);
        if (box.height < 40) issues.push(`${auditLabel}: ${kind} has insufficient height ${box.height}`);
      }
    }
    const controls = Array.from(document.querySelectorAll('.desktop-reader-topbar button, .desktop-reader-reading-bar button, .desktop-reader-bottombar button, [data-reader-progress-slider]')).filter(visible);
    for (const control of controls) {
      const box = rect(control);
      if (box.left < -tolerance || box.right > innerWidth + tolerance || box.top < -tolerance || box.bottom > innerHeight + tolerance) {
        issues.push(`${auditLabel}: control outside viewport: ${name(control)}`);
      }
      if (!name(control)) issues.push(`${auditLabel}: unnamed control ${control.tagName}`);
    }
    const closedDrawers = Array.from(document.querySelectorAll('[data-reader-left-drawer][aria-hidden="true"], [data-reader-settings-drawer][aria-hidden="true"]'));
    if (closedDrawers.some((drawer) => !drawer.inert)) issues.push(`${auditLabel}: closed drawer is not inert`);
    const pageNodes = Array.from(document.querySelectorAll('[data-reader-page]')).filter(visible);
    for (const page of pageNodes) {
      if (page.scrollHeight > page.clientHeight + tolerance) issues.push(`${auditLabel}: paged content clips vertically ${page.scrollHeight} > ${page.clientHeight}`);
      if (page.scrollWidth > page.clientWidth + tolerance) issues.push(`${auditLabel}: paged content clips horizontally ${page.scrollWidth} > ${page.clientWidth}`);
    }
    return issues;
  }, label);
}

async function selectReaderStudioSection(page, section) {
  await page.click(`[data-reader-studio-tab="${section}"]`);
  await page.waitForFunction((expected) => document.querySelector(`[data-reader-studio-section="${expected}"]`)?.hidden === false, section);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-layout-audit-'));
  const fixturePath = path.join(dataRoot, 'reader-realistic-layout.md');
  let servers;
  let browser;
  try {
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(fixturePath, realisticReaderMarkdown(), 'utf8');
    servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: scenarios[0] });
    await importFixture(page, servers.appUrl, fixturePath);
    await page.evaluate(() => {
        document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
        readerState.hudMode = 'visible';
        document.querySelector('[data-reader-settings-toggle]')?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-reader-settings-drawer]')?.getAttribute('aria-hidden') === 'false');
    await selectReaderStudioSection(page, 'page');
    await page.selectOption('[data-reader-layout-mode]', 'auto');
    await page.evaluate(() => document.querySelector('[data-reader-settings-close]')?.click());
    const issues = [];
    for (const scenario of scenarios) {
      await page.setViewportSize({ width: scenario.width, height: scenario.height });
      // Reader resize handling intentionally debounces repagination. Audit the
      // settled layout rather than the old page snapshot during that interval.
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        readerState.hudMode = 'visible';
        window.readerHudShow?.();
      });
      await page.waitForTimeout(220);
      await page.waitForFunction(() => {
        const content = document.querySelector('[data-reader-content]');
        return !!content && ['flow', 'single-page', 'double-page', 'illustrated'].includes(content.dataset.readerLayout);
      });
      issues.push(...await auditViewport(page, scenario.label));
      await page.screenshot({ path: path.join(reportDir, `${scenario.label}.png`), fullPage: false });
      await page.evaluate(() => document.querySelector('[data-reader-library-toggle]')?.click());
      await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]').getAttribute('aria-hidden') === 'false');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-reader-left-drawer]')).transform === 'matrix(1, 0, 0, 1, 0, 0)');
      const drawerIssue = await page.evaluate((auditLabel) => {
        const drawer = document.querySelector('[data-reader-left-drawer]');
        const box = drawer.getBoundingClientRect();
        return box.left < -2 || box.right > innerWidth + 2 ? `${auditLabel}: navigation drawer outside viewport` : '';
      }, scenario.label);
      if (drawerIssue) issues.push(drawerIssue);
      await page.evaluate(() => document.querySelector('[data-reader-left-close]')?.click());
    }
    assert.deepStrictEqual(issues, [], `Reader layout audit failed:\n${issues.join('\n')}`);
    console.log(`Reader layout audit passed. Screenshots saved to ${path.relative(root, reportDir)}`);
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
