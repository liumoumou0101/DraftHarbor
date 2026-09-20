/* global readerState createReaderLocatorAt renderReaderPages clearReaderLayoutCache renderReaderReading applyReaderSettings captureReaderPositionLocator */

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

const root = path.resolve(__dirname, '..');
const sourceText = '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张；寒来暑往，秋收冬藏。'.repeat(220);

async function paginationSnapshot(page) {
  return page.evaluate(() => {
    const blocks = readerState.currentChapter.blocks || [];
    const block = blocks.reduce((longest, candidate) => (
      String(candidate.text || '').length > String(longest && longest.text || '').length ? candidate : longest
    ), null);
    const segments = readerState.pages.flatMap((pageItem) => pageItem.segments
      .filter((segment) => segment.blockId === block.blockId)
      .map((segment) => ({ ...segment, pageIndex: pageItem.pageIndex })));
    return {
      blockId: block.blockId,
      text: block.text,
      pageCount: readerState.pages.length,
      segments,
      firstLength: segments[0].endOffset - segments[0].startOffset,
      probeCount: document.querySelectorAll('.desktop-reader-pagination-probe').length
    };
  });
}

async function assertMeasuredPages(page, snapshot, label) {
  assert.strictEqual(snapshot.probeCount, 0, `${label}: measurement probes must be removed after pagination`);
  assert.strictEqual(
    snapshot.segments.map((segment) => snapshot.text.slice(segment.startOffset, segment.endOffset)).join(''),
    snapshot.text,
    `${label}: measured pagination must preserve every character exactly once`
  );
  snapshot.segments.slice(1).forEach((segment) => {
    const first = snapshot.text[segment.startOffset] || '';
    assert.ok(!'，。！？；：、)]）】》」』”’'.includes(first), `${label}: page ${segment.pageIndex + 1} starts with closing punctuation`);
    assert.ok(!/\s/u.test(first), `${label}: page ${segment.pageIndex + 1} starts with whitespace`);
  });
  const inspected = await page.evaluate(async ({ blockId, segments }) => {
    const results = [];
    const candidates = segments.slice(0, Math.max(0, segments.length - 2)).slice(0, 5);
    for (const segment of candidates) {
      const locator = createReaderLocatorAt(blockId, segment.startOffset);
      renderReaderPages(locator);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const pageNode = document.querySelector(`[data-reader-page="${segment.pageIndex}"]`);
      const blockNode = pageNode && pageNode.querySelector(`[data-reader-block="${CSS.escape(blockId)}"][data-reader-start-offset="${segment.startOffset}"]`);
      const nextSegment = segments.find((item) => item.startOffset === segment.endOffset);
      if (!pageNode || !blockNode || !nextSegment) continue;
      const original = blockNode.textContent;
      const block = readerState.currentChapter.blocks.find((item) => item.blockId === blockId);
      const range = document.createRange();
      range.selectNodeContents(blockNode);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0.5);
      const lastRect = rects[rects.length - 1];
      const pageRect = pageNode.getBoundingClientRect();
      const style = getComputedStyle(pageNode);
      const innerBottom = pageRect.bottom - parseFloat(style.borderBottomWidth || 0) - parseFloat(style.paddingBottom || 0);
      const innerWidth = pageNode.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
      let appendableCharacters = 0;
      const tail = Array.from(String(block.text || '').slice(segment.endOffset, segment.endOffset + 24));
      for (let index = 0; index < tail.length; index += 1) {
        blockNode.textContent = original + tail.slice(0, index + 1).join('');
        if (pageNode.scrollHeight > pageNode.clientHeight + 1 || pageNode.scrollWidth > pageNode.clientWidth + 1) break;
        appendableCharacters = index + 1;
      }
      blockNode.textContent = original;
      results.push({
        pageIndex: segment.pageIndex,
        bottomGap: innerBottom - lastRect.bottom,
        lineHeight: parseFloat(getComputedStyle(blockNode).lineHeight),
        lastLineRatio: lastRect.width / Math.max(1, innerWidth),
        appendableCharacters,
        clipped: pageNode.scrollHeight > pageNode.clientHeight + 1 || pageNode.scrollWidth > pageNode.clientWidth + 1
      });
    }
    return results;
  }, { blockId: snapshot.blockId, segments: snapshot.segments });
  assert.ok(inspected.length >= 2, `${label}: expected several measurable split pages`);
  inspected.forEach((item) => {
    assert.strictEqual(item.clipped, false, `${label}: page ${item.pageIndex + 1} must not clip`);
    assert.ok(item.appendableCharacters <= 2, `${label}: page ${item.pageIndex + 1} still fits ${item.appendableCharacters} extra characters`);
    assert.ok(item.bottomGap <= item.lineHeight + 2, `${label}: page ${item.pageIndex + 1} leaves ${item.bottomGap}px below its last line`);
    assert.ok(item.lastLineRatio >= 0.72, `${label}: page ${item.pageIndex + 1} ends with a ${item.lastLineRatio.toFixed(2)}-width partial line`);
  });
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-pagination-'));
  const fixturePath = path.join(dataRoot, 'measured-pagination.md');
  let servers;
  let browser;
  try {
    await fs.writeFile(fixturePath, `# 实测分页\n\n${sourceText}\n`, 'utf8');
    servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.click('[data-view-target="reader"]');
    await page.setInputFiles('[data-reader-file]', fixturePath);
    await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]')?.open === true);
    await page.click('[data-reader-import-confirm]');
    await page.waitForFunction(() => readerState.apiMode && readerState.pages.length >= 5, null, { timeout: 15000 });
    const baselinePaginationMs = await page.evaluate(() => {
      const startedAt = performance.now();
      readerState.layoutMode = 'single-page';
      readerState.pageTransition = 'none';
      clearReaderLayoutCache();
      renderReaderReading({ locator: readerState.anchorLocator });
      return performance.now() - startedAt;
    });
    await page.waitForFunction(() => readerState.effectiveLayoutMode === 'single-page' && readerState.pages.length >= 5);

    const baseline = await paginationSnapshot(page);
    await assertMeasuredPages(page, baseline, 'default typography');

    // Changing text width must alter the rendered leaf and measured boundaries
    // without manually clearing the cache or losing the current reading anchor.
    const widthSnapshots = [];
    for (const textWidth of [320, 980, 760]) {
      widthSnapshots.push(await page.evaluate((width) => {
        const anchor = captureReaderPositionLocator();
        readerState.textWidth = width;
        applyReaderSettings({ reflow: false });
        renderReaderReading({ locator: anchor });
        const leaf = document.querySelector('[data-reader-page]');
        const block = leaf.querySelector('[data-reader-block]');
        return {
          pageWidth: leaf.getBoundingClientRect().width,
          textWidth: block.getBoundingClientRect().width,
          boundaries: JSON.stringify(readerState.pages),
          anchor,
          restoredAnchor: captureReaderPositionLocator()
        };
      }, textWidth));
      await assertMeasuredPages(page, await paginationSnapshot(page), `text width ${textWidth}`);
    }
    assert.ok(widthSnapshots[0].textWidth <= 321, 'the narrow text-width setting must cap the actual text column');
    assert.ok(widthSnapshots[1].pageWidth > widthSnapshots[0].pageWidth + 200, 'widening text must visibly enlarge a single page');
    assert.notStrictEqual(widthSnapshots[0].boundaries, widthSnapshots[1].boundaries, 'text width must invalidate measured pagination');
    widthSnapshots.forEach((snapshot) => assert.deepStrictEqual(snapshot.restoredAnchor, snapshot.anchor, 'text width changes must preserve the exact reading anchor'));
    assert.deepStrictEqual((await paginationSnapshot(page)).segments, baseline.segments, 'returning to the original width must restore the original measured boundaries');

    // Isolate focus layout changes from window resize / fullscreen events.
    await page.evaluate(() => {
      window.draftHarborDesktop = { isFullscreen: async () => true };
      const block = readerState.currentChapter.blocks.find((item) => item.text.length > 1800);
      renderReaderReading({ locator: createReaderLocatorAt(block.blockId, 1800) });
    });
    const beforeFocus = await page.evaluate(() => ({
      height: document.querySelector('[data-reader-page]').clientHeight,
      anchor: captureReaderPositionLocator(),
      boundaries: JSON.stringify(readerState.pages)
    }));
    await page.evaluate(() => window.readerHudToggleFocusMode());
    await page.waitForTimeout(550);
    const focused = await paginationSnapshot(page);
    const focusState = await page.evaluate(() => ({
      height: document.querySelector('[data-reader-page]').clientHeight,
      anchor: captureReaderPositionLocator()
    }));
    assert.strictEqual(focusState.height, beforeFocus.height, 'focus controls must overlay the stable reading surface');
    assert.strictEqual(focused.firstLength, baseline.firstLength, 'focus must retain page boundaries when the text geometry is unchanged');
    assert.deepStrictEqual(focusState.anchor, beforeFocus.anchor, 'focus must preserve the exact reading anchor');
    await assertMeasuredPages(page, focused, 'focus typography');
    const focusedBoundaries = await page.evaluate(() => JSON.stringify(readerState.pages));
    await page.evaluate(() => window.readerHudShow());
    await page.waitForTimeout(350);
    assert.strictEqual(await page.evaluate(() => JSON.stringify(readerState.pages)), focusedBoundaries,
      'showing focus controls must not change pagination');
    const textClearOfChrome = await page.evaluate(() => {
      const leaves = Array.from(document.querySelectorAll('[data-reader-page]'));
      const chrome = Array.from(document.querySelectorAll('.desktop-reader-topbar, .desktop-reader-reading-bar, .desktop-reader-bottombar'))
        .filter((node) => getComputedStyle(node).visibility !== 'hidden' && Number(getComputedStyle(node).opacity) > 0)
        .map((node) => node.getBoundingClientRect());
      return leaves.every((leaf) => Array.from(leaf.querySelectorAll('[data-reader-block]')).every((block) => {
        const range = document.createRange();
        range.selectNodeContents(block);
        return Array.from(range.getClientRects()).every((line) => chrome.every((bar) => (
          line.bottom <= bar.top || line.top >= bar.bottom || line.right <= bar.left || line.left >= bar.right
        )));
      }));
    });
    assert.strictEqual(textClearOfChrome, true, 'visible focus controls must not cover a line of text');
    await page.screenshot({ path: path.join(os.tmpdir(), 'draftharbor-reader-focus-controls.png') });
    await page.evaluate(() => window.readerHudToggleFocusMode());
    await page.waitForTimeout(550);
    assert.strictEqual(await page.evaluate(() => JSON.stringify(readerState.pages)), beforeFocus.boundaries,
      'leaving focus must restore normal pagination');
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const anchor = await page.evaluate(() => captureReaderPositionLocator());
      await page.evaluate(() => window.readerHudToggleFocusMode());
      await page.waitForTimeout(350);
      await page.evaluate(() => window.readerHudToggleFocusMode());
      await page.waitForTimeout(350);
      assert.deepStrictEqual(await page.evaluate(() => captureReaderPositionLocator()), anchor,
        'repeated focus switches must preserve the reading anchor');
    }

    const adjustedStartedAt = Date.now();
    const adjustedPaginationMs = await page.evaluate(() => {
      const startedAt = performance.now();
      readerState.fontSize = 22;
      readerState.lineHeight = 1.9;
      readerState.pageMargin = 72;
      applyReaderSettings({ reflow: false });
      clearReaderLayoutCache();
      renderReaderReading({ locator: readerState.anchorLocator });
      return performance.now() - startedAt;
    });
    await page.waitForFunction((previous) => readerState.pages[0].segments[0].endOffset !== previous, baseline.segments[0].endOffset);
    const adjusted = await paginationSnapshot(page);
    assert.ok(adjusted.firstLength < baseline.firstLength, 'larger text and margins must reduce the measured first-page capacity');
    assert.ok(Date.now() - adjustedStartedAt < 3000, 'measured repagination must remain interactive for a long chapter');
    await assertMeasuredPages(page, adjusted, 'large typography');

    const stableBefore = JSON.stringify(adjusted.segments);
    await page.evaluate(() => renderReaderReading({ locator: readerState.anchorLocator }));
    const stableAfter = JSON.stringify((await paginationSnapshot(page)).segments);
    assert.strictEqual(stableAfter, stableBefore, 'identical layout inputs must reuse stable measured page boundaries');

    const doublePaginationMs = await page.evaluate(() => {
      const startedAt = performance.now();
      readerState.layoutMode = 'double-page';
      clearReaderLayoutCache();
      renderReaderReading({ locator: readerState.anchorLocator });
      return performance.now() - startedAt;
    });
    await page.waitForFunction(() => readerState.effectiveLayoutMode === 'double-page');
    const spread = await paginationSnapshot(page);
    await assertMeasuredPages(page, spread, 'double-page spread');

    // Fullscreen / large-window growth must repaginate without an explicit render.
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForTimeout(550);
    const tall = await paginationSnapshot(page);
    const tallHeight = await page.evaluate(() => document.querySelector('[data-reader-page]').clientHeight);
    await page.setViewportSize({ width: 2560, height: 1600 });
    await page.waitForTimeout(550);
    const taller = await paginationSnapshot(page);
    assert.ok(await page.evaluate(() => document.querySelector('[data-reader-page]').clientHeight) > tallHeight,
      'large-window pages must not freeze at the old 1140px height cap');
    assert.ok(taller.firstLength > tall.firstLength, 'extra large-window height must display more text');
    await assertMeasuredPages(page, taller, 'large-window spread');

    const spreadWidths = [];
    for (const textWidth of [620, 980]) {
      spreadWidths.push(await page.evaluate((width) => {
        const anchor = captureReaderPositionLocator();
        readerState.textWidth = width;
        applyReaderSettings({ reflow: false });
        renderReaderReading({ locator: anchor });
        const leaf = document.querySelector('[data-reader-page]');
        return { width: leaf.getBoundingClientRect().width, anchor, restoredAnchor: captureReaderPositionLocator() };
      }, textWidth));
      await assertMeasuredPages(page, await paginationSnapshot(page), `spread text width ${textWidth}`);
    }
    assert.ok(spreadWidths[1].width > spreadWidths[0].width + 300, '620 to 980 text width must visibly widen a spread when the window has space');
    spreadWidths.forEach((snapshot) => assert.deepStrictEqual(snapshot.restoredAnchor, snapshot.anchor, 'spread width changes must preserve the exact reading anchor'));

    await page.evaluate(() => { delete window.draftHarborDesktop; });
    await page.click('[data-reader-focus-toggle]');
    await page.waitForFunction(() => !!document.fullscreenElement && readerState.focusMode);
    await page.waitForTimeout(550);
    const fullscreen = await paginationSnapshot(page);
    assert.strictEqual(fullscreen.segments.map((segment) => fullscreen.text.slice(segment.startOffset, segment.endOffset)).join(''),
      fullscreen.text, 'fullscreen must preserve every character exactly once');
    assert.strictEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-reader-page]')).some((node) =>
      node.scrollHeight > node.clientHeight + 2 || node.scrollWidth > node.clientWidth + 2)), false,
    'fullscreen pages must not overflow');
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !readerState.focusMode);
    await page.waitForTimeout(350);

    await page.setViewportSize({ width: 960, height: 720 });
    await page.evaluate(() => {
      readerState.layoutMode = 'auto';
      readerState.fontSize = 18;
      readerState.pageMargin = 48;
      readerState.textWidth = 760;
      applyReaderSettings({ reflow: false });
      renderReaderReading({ locator: readerState.anchorLocator });
    });
    await page.waitForFunction(() => readerState.effectiveLayoutMode === 'single-page');
    await assertMeasuredPages(page, await paginationSnapshot(page), 'narrow automatic layout');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => readerState.effectiveLayoutMode === 'double-page');
    await assertMeasuredPages(page, await paginationSnapshot(page), 'wide automatic layout');

    await page.setViewportSize({ width: 900, height: 350 });
    await page.evaluate(() => {
      readerState.layoutMode = 'single-page';
      clearReaderLayoutCache();
      renderReaderReading({ locator: readerState.anchorLocator });
    });
    assert.strictEqual(await page.evaluate(() => readerState.effectiveLayoutMode), 'flow', 'a viewport with less than 240px remaining after chrome padding must use flow');
    const compact = await page.evaluate(() => ({
      pageCount: readerState.pages.length,
      layout: document.querySelector('[data-reader-content]')?.dataset.readerLayout,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth
    }));
    assert.deepStrictEqual(compact, { pageCount: 0, layout: 'flow', horizontalOverflow: 0 }, 'too-short viewports must fall back to scroll reading instead of one-character pages');
    console.log(`READER_MEASURED_PAGINATION=${JSON.stringify({
      baselinePages: baseline.pageCount,
      baselineFirstPageCharacters: baseline.firstLength,
      focusedFirstPageCharacters: focused.firstLength,
      normalPageHeight: beforeFocus.height,
      focusedPageHeight: focusState.height,
      baselinePaginationMs: Math.round(baselinePaginationMs * 100) / 100,
      adjustedPages: adjusted.pageCount,
      adjustedFirstPageCharacters: adjusted.firstLength,
      adjustedPaginationMs: Math.round(adjustedPaginationMs * 100) / 100,
      doublePages: spread.pageCount,
      doublePaginationMs: Math.round(doublePaginationMs * 100) / 100
    })}`);
    console.log('Reader measured pagination tests passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader measured pagination tests failed:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
