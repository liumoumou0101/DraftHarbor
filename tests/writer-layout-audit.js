const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');

const projectRoot = path.resolve(__dirname, '..');
const reportDir = path.join(projectRoot, '.ai_state', 'test_reports', 'writer_layout_audit');

const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1493, height: 1061 },
  { width: 1920, height: 1080 }
];

const themes = ['morandi-ink', 'mist-library', 'ash-rose'];

async function openWriterProject(page, appUrl) {
  await page.goto(`${appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.desktop-project-card', { timeout: 10000 });
  await page.focus('.desktop-project-card');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#desktop-root')?.dataset.view === 'writer');
  await page.waitForFunction(() => document.querySelector('[data-native-project-title]')?.textContent.includes('Writer Layout Audit Project'));
  await page.waitForSelector('.desktop-native-scene', { timeout: 10000 });
  await page.locator('.desktop-native-scene').first().click();
  await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]') && !document.querySelector('[data-native-scene-editor]').disabled);
}

async function auditCurrentViewport(page, label) {
  return page.evaluate((auditLabel) => {
    const issues = [];
    const tolerance = 2;

    function rectOf(element) {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        label: (element.textContent || element.getAttribute('title') || element.getAttribute('aria-label') || element.className || element.tagName)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80)
      };
    }

    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.offsetParent !== null;
    }

    function intersects(a, b) {
      return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > tolerance
        && Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > tolerance;
    }

    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + tolerance) {
      issues.push(`${auditLabel}: horizontal overflow ${doc.scrollWidth}px > ${window.innerWidth}px`);
    }

    const root = document.querySelector('#desktop-root');
    if (root) {
      const rootRect = rectOf(root);
      if (rootRect.left < -tolerance || rootRect.right > window.innerWidth + tolerance) {
        issues.push(`${auditLabel}: desktop root exceeds viewport horizontally`);
      }
    }

    const groups = [
      ['context strip actions', '.desktop-context-strip button:not([hidden])'],
      ['editor header actions', '.desktop-native-editor-actions button:not([hidden])'],
      ['assistant tabs', '.desktop-native-assistant-tabs button:not([hidden])'],
      ['outline actions', '.desktop-native-outline-actions button:not([hidden])'],
      ['rail navigation', '.desktop-nav-item']
    ];

    for (const [name, selector] of groups) {
      const rects = Array.from(document.querySelectorAll(selector))
        .filter(isVisible)
        .map(rectOf);

      for (let i = 0; i < rects.length; i += 1) {
        const rect = rects[i];
        if (rect.left < -tolerance || rect.right > window.innerWidth + tolerance) {
          issues.push(`${auditLabel}: ${name} item outside viewport: ${rect.label}`);
        }
        for (let j = i + 1; j < rects.length; j += 1) {
          if (intersects(rect, rects[j])) {
            issues.push(`${auditLabel}: ${name} overlap: "${rect.label}" with "${rects[j].label}"`);
          }
        }
      }
    }

    const unclippedSelectors = [
      '.desktop-context-strip button:not([hidden])',
      '.desktop-native-editor-actions button:not([hidden])',
      '.desktop-native-assistant-tabs button:not([hidden])',
      '.desktop-native-outline-actions button:not([hidden])'
    ];

    for (const element of document.querySelectorAll(unclippedSelectors.join(','))) {
      if (!isVisible(element)) continue;
      if (element.scrollWidth > element.clientWidth + tolerance || element.scrollHeight > element.clientHeight + tolerance) {
        issues.push(`${auditLabel}: clipped control text: ${rectOf(element).label}`);
      }
    }

    return issues;
  }, label);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-layout-audit-'));
  let servers = null;
  let browser = null;

  try {
    await fs.mkdir(reportDir, { recursive: true });
    await projectService.createProject(dataRoot, {
      id: 'writer-layout-audit',
      title: 'Writer Layout Audit Project',
      description: 'Project used by layout overlap audit.',
      chapters: [{ id: 'chapter-layout', title: 'Layout Chapter', order: 0 }],
      scenes: [{
        id: 'scene-layout',
        chapterId: 'chapter-layout',
        title: 'Layout Audit Scene',
        summary: 'Layout audit summary.',
        content: 'This scene exists to verify that writer controls do not overlap at common laptop and desktop sizes.',
        order: 0
      }]
    });

    servers = await startDesktopServers({
      appRoot: projectRoot,
      dataRoot,
      revealPath: async () => ''
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: viewports[0] });
    await openWriterProject(page, servers.appUrl);

    const allIssues = [];
    for (const theme of themes) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.desktopTheme = nextTheme;
        document.querySelector('#desktop-root')?.setAttribute('data-desktop-theme', nextTheme);
      }, theme);

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(150);
        const label = `${theme}-${viewport.width}x${viewport.height}`;
        const screenshotPath = path.join(reportDir, `writer-${label}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        allIssues.push(...await auditCurrentViewport(page, label));
      }
    }

    assert.deepStrictEqual(allIssues, [], `Writer layout audit failed:\n${allIssues.join('\n')}`);
    console.log(`Writer layout audit passed. Screenshots saved to ${path.relative(projectRoot, reportDir)}`);
  } finally {
    if (browser) await browser.close();
    if (servers && typeof servers.close === 'function') servers.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
