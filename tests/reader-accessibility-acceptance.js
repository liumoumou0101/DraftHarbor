/* global readerState */

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const { realisticReaderMarkdown } = require('./reader-visual-fixture');

const root = path.resolve(__dirname, '..');
const viewports = [
  { name: '100%', width: 1280, height: 800 },
  { name: '125%', width: 1024, height: 640 },
  { name: '150%', width: 853, height: 533 },
  { name: '200%', width: 640, height: 400 }
];

async function openReader(page, appUrl, fixturePath) {
  await page.goto(`${appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#desktop-root');
  await page.waitForSelector('[data-view-target="reader"]');
  await page.click('[data-view-target="reader"]');
  await page.setInputFiles('[data-reader-file]', fixturePath);
  await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]')?.open === true);
  await page.click('[data-reader-import-confirm]');
  try {
    await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('第一章'));
  } catch (error) {
    const state = await page.evaluate(() => ({
      view: document.getElementById('desktop-root')?.dataset.view,
      title: document.querySelector('[data-reader-title]')?.textContent,
      file: document.querySelector('[data-reader-file]')?.files?.[0]?.name,
      importDialog: document.querySelector('[data-reader-import-dialog]')?.open,
      importStatus: document.querySelector('[data-reader-import-status]')?.textContent,
      body: document.body.textContent.slice(0, 500)
    }));
    throw new Error(`Reader accessibility fixture did not open: ${JSON.stringify(state)}; ${error.message}`);
  }
  await page.waitForFunction(() => readerState.apiMode && readerState.contents.length >= 4, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'true');
}

async function auditSurface(page, viewportName) {
  return page.evaluate((label) => {
    const issues = [];
    const isVisible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width > 1
        && rect.height > 1
        && node.getClientRects().length > 0;
    };
    const isExposed = (node) => isVisible(node)
      && !node.closest('[hidden], [aria-hidden="true"], [inert]');
    const readerShell = document.querySelector('[data-reader-shell]');
    const accessibleName = (node) => {
      const labelledBy = node.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
        if (text.trim()) return text.trim();
      }
      return String(
        node.getAttribute('aria-label')
        || node.getAttribute('title')
        || node.labels?.[0]?.textContent
        || node.getAttribute('placeholder')
        || node.textContent
        || ''
      ).replace(/\s+/g, ' ').trim();
    };
    const interactive = Array.from(document.querySelectorAll(
      'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="combobox"], [role="textbox"], [tabindex]'
    ));
    for (const node of interactive) {
      if (!isExposed(node) || node.disabled) continue;
      if (!accessibleName(node)) issues.push(`${label}: unnamed ${node.tagName.toLowerCase()}${node.outerHTML.slice(0, 100)}`);
    }
    for (const dialog of readerShell.querySelectorAll('dialog')) {
      if (!dialog.getAttribute('aria-labelledby') && !dialog.getAttribute('aria-label')) {
        issues.push(`${label}: dialog is missing an accessible name`);
      }
    }
    for (const tablist of readerShell.querySelectorAll('[role="tablist"]')) {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      if (!tabs.length || tabs.some((tab) => !['true', 'false'].includes(tab.getAttribute('aria-selected')))) {
        issues.push(`${label}: tablist has incomplete tab selection state`);
      }
    }
    for (const drawer of readerShell.querySelectorAll('[data-reader-left-drawer], [data-reader-settings-drawer]')) {
      const closed = drawer.getAttribute('aria-hidden') === 'true';
      if (closed && !drawer.inert) issues.push(`${label}: closed drawer is not inert`);
    }
    if (document.documentElement.scrollWidth > innerWidth + 2) {
      issues.push(`${label}: document overflows horizontally by ${document.documentElement.scrollWidth - innerWidth}px`);
    }
    return issues;
  }, viewportName);
}

async function assertFocusRestoration(page, openSelector, panelSelector, closeSelector, returnSelector) {
  await page.click(openSelector);
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-hidden') === 'false', panelSelector);
  await page.waitForFunction((selector) => document.querySelector(selector)?.contains(document.activeElement), panelSelector);
  await page.keyboard.press('Escape');
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-hidden') === 'true', panelSelector);
  await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), returnSelector);
  assert.ok(await page.locator(closeSelector).count() > 0, `close control should exist for ${panelSelector}`);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-accessibility-'));
  const fixturePath = path.join(dataRoot, 'reader-accessibility.md');
  let servers;
  let browser;
  try {
    await fs.writeFile(fixturePath, realisticReaderMarkdown(), 'utf8');
    servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: viewports[0] });
    await openReader(page, servers.appUrl, fixturePath);

    const issues = [];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(100);
      issues.push(...await auditSurface(page, viewport.name));
    }
    assert.deepStrictEqual(issues, [], `Reader accessibility surface audit failed:\n${issues.join('\n')}`);

    await assertFocusRestoration(
      page,
      '[data-reader-settings-toggle]',
      '[data-reader-settings-drawer]',
      '[data-reader-settings-close]',
      '[data-reader-settings-toggle]'
    );
    await assertFocusRestoration(
      page,
      '[data-reader-library-toggle]',
      '[data-reader-left-drawer]',
      '[data-reader-left-close]',
      '[data-reader-library-toggle]'
    );

    await page.click('[data-reader-settings-toggle]');
    await page.click('[data-reader-studio-tab="motion"]');
    await page.selectOption('[data-reader-reduced-motion]', 'reduce');
    await page.waitForFunction(() => readerState.reducedMotionOverride === true);
    await page.waitForFunction(() => document.querySelector('[data-reader-theme-panel]')?.dataset.readerMotion === 'reduce');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-reader-settings-drawer]')?.getAttribute('aria-hidden') === 'true');

    await page.click('[data-reader-selection-toggle]');
    await page.waitForFunction(() => document.querySelector('[data-reader-transfer-dialog]')?.open === true);
    await page.waitForFunction(() => document.querySelector('[data-reader-transfer-dialog]')?.contains(document.activeElement));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-reader-transfer-dialog]')?.open === false);
    await page.waitForFunction(() => document.activeElement === document.querySelector('[data-reader-selection-toggle]'));

    console.log(`Reader accessibility acceptance passed for ${viewports.length} viewport scales.`);
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader accessibility acceptance failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
