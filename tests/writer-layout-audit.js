const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const { setAssistantPlacement } = require('./helpers/native-panel');

const projectRoot = path.resolve(__dirname, '..');
const reportDir = path.join(projectRoot, '.ai_state', 'test_reports', 'writer_layout_audit');

const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1493, height: 1061 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
];

const themes = ['morandi-ink', 'mist-library', 'ash-rose', 'night-paper', 'harbor-dusk', 'xuan-paper'];
const sampleViewports = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 }
];

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
      ['editor header actions', '.desktop-native-core-actions > .desktop-native-toolbar-button:not([hidden]), .desktop-native-more-wrap > [data-native-more-tools]'],
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
      '.desktop-native-core-actions > .desktop-native-toolbar-button:not([hidden]), .desktop-native-more-wrap > [data-native-more-tools]',
      '.desktop-native-assistant-tabs button:not([hidden])',
      '.desktop-native-outline-actions button:not([hidden])'
    ];

    for (const element of document.querySelectorAll(unclippedSelectors.join(','))) {
      if (!isVisible(element)) continue;
      if (element.scrollWidth > element.clientWidth + tolerance || element.scrollHeight > element.clientHeight + tolerance) {
        issues.push(`${auditLabel}: clipped control text: ${rectOf(element).label}`);
      }
    }

    const header = document.querySelector('.desktop-native-editor-header');
    if (header) {
      const headerHeight = header.getBoundingClientRect().height;
      if (headerHeight > 42) {
        issues.push(`${auditLabel}: editor header height ${Math.round(headerHeight)}px > 42px`);
      }
    }

    const editor = document.querySelector('[data-native-scene-editor]');
    const assistant = document.querySelector('.desktop-native-assistant');
    const generate = document.querySelector('[data-native-generate]');
    const writer = document.querySelector('[data-native-writer]');
    if (editor && isVisible(editor)) {
      const floor = {
        720: 280,
        768: 300,
        1061: 420,
        1080: 520,
        1440: 700
      }[window.innerHeight];
      if (floor && editor.getBoundingClientRect().height + tolerance < floor) {
        issues.push(`${auditLabel}: textarea height ${Math.round(editor.getBoundingClientRect().height)}px < ${floor}px`);
      }
      if (window.innerWidth === 2560 && writer) {
        const paperWidth = editor.getBoundingClientRect().width;
        const minPaper = writer.classList.contains('is-assistant-bottom') ? 1480 : 1080;
        if (paperWidth + tolerance < minPaper) {
          issues.push(`${auditLabel}: 2K paper width ${Math.round(paperWidth)}px < ${minPaper}px`);
        }
      }
    }
    if (assistant && writer && writer.classList.contains('is-assistant-bottom')) {
      const dockTarget = { 720: 208, 1080: 270, 1440: 360 }[window.innerHeight];
      if (dockTarget) {
        const dockHeight = assistant.getBoundingClientRect().height;
        if (Math.abs(dockHeight - dockTarget) > 2) {
          issues.push(`${auditLabel}: dock height ${Math.round(dockHeight)}px != ${dockTarget}±2`);
        }
      }
      if (generate && isVisible(generate)) {
        const dockRect = assistant.getBoundingClientRect();
        const generateRect = generate.getBoundingClientRect();
        if (generateRect.bottom > dockRect.bottom + tolerance || generateRect.top < dockRect.top - tolerance) {
          issues.push(`${auditLabel}: generate button is outside the dock`);
        }
      }
      const visibleTabs = Array.from(document.querySelectorAll('[data-native-panel-tab]')).filter(isVisible);
      const groups = new Set(visibleTabs.map((tab) => tab.dataset.nativePanelGroup));
      if (groups.size > 1) {
        issues.push(`${auditLabel}: visible panel tabs span multiple groups: ${Array.from(groups).join(',')}`);
      }
    }

    if (window.innerHeight === 720 && writer) {
      const writerHeight = writer.getBoundingClientRect().height;
      if (writerHeight < 640) {
        issues.push(`${auditLabel}: writer workspace ${Math.round(writerHeight)}px collapsed below 640px`);
      }
    }

    const advanced = document.querySelector('[data-native-generation-advanced]');
    const generatePanel = document.querySelector('[data-native-panel="generate"]');
    if (advanced && generatePanel && assistant && writer && writer.classList.contains('is-assistant-bottom')) {
      const wasOpen = advanced.open;
      advanced.open = true;
      const dockBefore = assistant.getBoundingClientRect().height;
      const dockRect = assistant.getBoundingClientRect();
      const preview = document.querySelector('[data-native-preview-prompt]');
      const previewRect = preview ? preview.getBoundingClientRect() : null;
      const previewInDock = previewRect
        && previewRect.top >= dockRect.top - tolerance
        && previewRect.bottom <= dockRect.bottom + tolerance;
      const panelScrolls = generatePanel.scrollHeight > generatePanel.clientHeight + tolerance;
      if (!previewInDock && !panelScrolls) {
        issues.push(`${auditLabel}: advanced preview is clipped and the generate panel is not a scroller`);
      }
      if (Math.abs(assistant.getBoundingClientRect().height - dockBefore) > tolerance) {
        issues.push(`${auditLabel}: opening advanced changed dock height`);
      }
      advanced.open = wasOpen;
    }

    return issues;
  }, label);
}

async function auditFocusModeViewport(page, label) {
  return page.evaluate((auditLabel) => {
    const issues = [];
    const writer = document.querySelector('[data-native-writer]');
    const editor = document.querySelector('.desktop-native-editor');
    const textarea = document.querySelector('[data-native-scene-editor]');
    const outline = document.querySelector('.desktop-native-outline');
    const assistant = document.querySelector('.desktop-native-assistant');
    if (!writer || !editor || !textarea) {
      issues.push(`${auditLabel}: missing writer, editor, or textarea`);
      return issues;
    }
    if (!writer.classList.contains('is-focus-mode')) {
      issues.push(`${auditLabel}: writer is not in focus mode`);
    }

    const writerStyle = window.getComputedStyle(writer);
    const columnTracks = writerStyle.gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
    if (columnTracks.length !== 1) {
      issues.push(`${auditLabel}: focus mode kept ${columnTracks.length} grid columns (${writerStyle.gridTemplateColumns})`);
    }
    const rowTracks = writerStyle.gridTemplateRows.trim().split(/\s+/).filter(Boolean);
    if (rowTracks.length !== 1) {
      issues.push(`${auditLabel}: focus mode kept ${rowTracks.length} grid rows (${writerStyle.gridTemplateRows})`);
    }

    const writerRect = writer.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    if (editorRect.width + 2 < writerRect.width * 0.85) {
      issues.push(`${auditLabel}: editor width ${Math.round(editorRect.width)}px is stuck in a leftover column of writer ${Math.round(writerRect.width)}px`);
    }
    if (editorRect.height + 2 < writerRect.height * 0.85) {
      issues.push(`${auditLabel}: editor height ${Math.round(editorRect.height)}px does not fill writer ${Math.round(writerRect.height)}px`);
    }

    const outlineStyle = outline ? window.getComputedStyle(outline) : null;
    const assistantStyle = assistant ? window.getComputedStyle(assistant) : null;
    if (outlineStyle && outlineStyle.display !== 'none') {
      issues.push(`${auditLabel}: outline is still visible in focus mode`);
    }
    if (assistantStyle && assistantStyle.display !== 'none') {
      issues.push(`${auditLabel}: assistant is still visible in focus mode`);
    }

    const minTextareaWidth = window.innerWidth >= 1800 ? 700 : 520;
    if (textareaRect.width + 2 < minTextareaWidth) {
      issues.push(`${auditLabel}: textarea width ${Math.round(textareaRect.width)}px < ${minTextareaWidth}px`);
    }
    const textareaFloor = { 720: 360, 768: 400, 1061: 560, 1080: 640, 1440: 860 }[window.innerHeight];
    if (textareaFloor && textareaRect.height + 2 < textareaFloor) {
      issues.push(`${auditLabel}: textarea height ${Math.round(textareaRect.height)}px < ${textareaFloor}px`);
    }

    const textareaStyle = window.getComputedStyle(textarea);
    const padLeft = Number.parseFloat(textareaStyle.paddingLeft) || 0;
    const padRight = Number.parseFloat(textareaStyle.paddingRight) || 0;
    if (padLeft + padRight > textareaRect.width * 0.45) {
      issues.push(`${auditLabel}: textarea padding ${Math.round(padLeft + padRight)}px crushes ${Math.round(textareaRect.width)}px paper`);
    }

    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 2) {
      issues.push(`${auditLabel}: horizontal overflow ${doc.scrollWidth}px > ${window.innerWidth}px`);
    }

    return issues;
  }, label);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-layout-audit-'));
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
    for (const placement of ['bottom', 'right']) {
      await setAssistantPlacement(page, placement);
      for (const theme of themes) {
        await page.evaluate((nextTheme) => {
          if (typeof applyDesktopTheme === 'function') applyDesktopTheme(nextTheme);
          else {
            document.documentElement.dataset.desktopTheme = nextTheme;
            document.querySelector('#desktop-root')?.setAttribute('data-desktop-theme', nextTheme);
          }
        }, theme);

        const themeViewports = theme === 'morandi-ink' ? viewports : sampleViewports;
        for (const viewport of themeViewports) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(150);
          const label = `${theme}-${placement}-${viewport.width}x${viewport.height}`;
          const screenshotPath = path.join(reportDir, `writer-${label}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: false });
          allIssues.push(...await auditCurrentViewport(page, label));
        }
      }
    }

    const focusCases = [
      { theme: 'morandi-ink', viewport: { width: 1280, height: 720 } },
      { theme: 'morandi-ink', viewport: { width: 1920, height: 1080 } },
      { theme: 'morandi-ink', viewport: { width: 2560, height: 1440 } },
      { theme: 'mist-library', viewport: { width: 1280, height: 720 } },
      { theme: 'mist-library', viewport: { width: 1920, height: 1080 } }
    ];
    for (const placement of ['bottom', 'right']) {
      await setAssistantPlacement(page, placement);
      for (const focusCase of focusCases) {
        await page.evaluate((nextTheme) => {
          if (typeof applyDesktopTheme === 'function') applyDesktopTheme(nextTheme);
          else {
            document.documentElement.dataset.desktopTheme = nextTheme;
            document.querySelector('#desktop-root')?.setAttribute('data-desktop-theme', nextTheme);
          }
        }, focusCase.theme);
        await page.setViewportSize(focusCase.viewport);
        const alreadyFocus = await page.evaluate(() => document.querySelector('[data-native-writer]')?.classList.contains('is-focus-mode'));
        if (!alreadyFocus) await page.click('[data-native-focus-mode]');
        await page.waitForFunction(() => document.querySelector('[data-native-writer]').classList.contains('is-focus-mode'));
        await page.waitForTimeout(150);
        const label = `focus-${focusCase.theme}-${placement}-${focusCase.viewport.width}x${focusCase.viewport.height}`;
        await page.screenshot({ path: path.join(reportDir, `writer-${label}.png`), fullPage: false });
        allIssues.push(...await auditFocusModeViewport(page, label));
        await page.click('[data-native-focus-mode]');
        await page.waitForFunction(() => !document.querySelector('[data-native-writer]').classList.contains('is-focus-mode'));
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
