/* global readerState clearReaderLayoutCache renderReaderReading queueReaderPageTurn */

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

const root = path.resolve(__dirname, '..');
const sourceText = '潮声从防波堤外缓慢推来，灯塔的绿光在水面留下断续的刻度。'.repeat(240);

async function traceTransition(page, transition, delta) {
  return page.evaluate(({ selectedTransition, pageDelta }) => new Promise((resolve, reject) => {
    readerState.pageTransition = selectedTransition;
    readerState.reducedMotionOverride = false;
    const startedAt = performance.now();
    let activeLive = null;
    let firstIncomingStyle = null;
    let firstLiveOverflow = null;
    let activeFrames = 0;
    let seenLayer = false;
    const violations = [];

    queueReaderPageTurn(pageDelta);
    const sample = () => {
      const content = document.querySelector('[data-reader-content]');
      const layer = content?.querySelector(':scope > .desktop-reader-page-transition-layer');
      const live = content?.querySelector(':scope > .desktop-reader-page-deck');
      if (layer) {
        seenLayer = true;
        activeFrames += 1;
        if (!activeLive) activeLive = live;
        const snapshots = Array.from(layer.querySelectorAll(':scope > .desktop-reader-page-deck'));
        const incoming = layer.querySelector(':scope > .is-reader-transitioning-in');
        const incomingStyle = incoming && getComputedStyle(incoming);
        if (!firstIncomingStyle && incomingStyle) {
          firstIncomingStyle = { opacity: Number(incomingStyle.opacity), transform: incomingStyle.transform };
        }
        if (!firstLiveOverflow && live) {
          firstLiveOverflow = Array.from(live.querySelectorAll(':scope > [data-reader-page]')).map((item) => ({
            scrollHeight: item.scrollHeight, clientHeight: item.clientHeight
          }));
        }
        if (!live || getComputedStyle(live).visibility !== 'hidden') violations.push('authoritative deck became visible during animation');
        if (live !== activeLive) violations.push('authoritative deck identity changed during animation');
        if (snapshots.length !== 2) violations.push(`expected two snapshots, got ${snapshots.length}`);
        if (layer.getAttribute('aria-hidden') !== 'true') violations.push('snapshot layer leaked into accessibility tree');
      } else if (seenLayer) {
        resolve({
          transition: selectedTransition,
          activeFrames,
          elapsedMs: Math.round(performance.now() - startedAt),
          firstIncomingStyle,
          firstLiveOverflow,
          violations: [...new Set(violations)],
          finalSameDeck: activeLive === live,
          finalVisibility: live ? getComputedStyle(live).visibility : 'missing',
          activeClass: content?.classList.contains('is-reader-deck-transition-active') || false
        });
        return;
      }
      if (performance.now() - startedAt > 2000) {
        reject(new Error(`${selectedTransition} transition did not settle`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { selectedTransition: transition, pageDelta: delta });
}

async function traceLockedSpineTransition(page, transition, delta) {
  return page.evaluate(({ selectedTransition, pageDelta }) => new Promise((resolve, reject) => {
    readerState.pageTransition = selectedTransition;
    const content = document.querySelector('[data-reader-content]');
    const live = content?.querySelector(':scope > .desktop-reader-page-deck[data-reader-spread="double"]');
    const livePages = Array.from(live?.querySelectorAll(':scope > .desktop-reader-page') || []);
    if (livePages.length !== 2) {
      reject(new Error(`double-page fixture exposed ${livePages.length} live pages`));
      return;
    }
    const liveRects = livePages.map((node) => node.getBoundingClientRect());
    const originalSpine = (liveRects[0].right + liveRects[1].left) / 2;
    const startedAt = performance.now();
    const violations = [];
    let firstFrame = null;
    let seenLayer = false;
    let activeFrames = 0;

    queueReaderPageTurn(pageDelta);
    const sample = () => {
      const layer = content.querySelector(':scope > .desktop-reader-page-transition-layer');
      if (layer) {
        seenLayer = true;
        activeFrames += 1;
        const decks = Array.from(layer.querySelectorAll(':scope > .desktop-reader-page-deck'));
        const incoming = layer.querySelector(':scope > .is-reader-transitioning-in');
        const slots = Array.from(incoming?.querySelectorAll(':scope > .desktop-reader-transition-page-slot') || []);
        const slotRects = slots.map((node) => node.getBoundingClientRect());
        const spine = slotRects.length === 2 ? (slotRects[0].right + slotRects[1].left) / 2 : NaN;
        const deckTransforms = decks.map((node) => getComputedStyle(node).transform);
        const pageTransforms = slots.map((node) => getComputedStyle(node.firstElementChild).transform);
        if (!firstFrame) firstFrame = { deckTransforms, pageTransforms, spineDelta: spine - originalSpine };
        if (decks.length !== 2 || decks.some((node) => !node.classList.contains('is-reader-spine-locked'))) {
          violations.push('double-page snapshot was not spine locked');
        }
        if (deckTransforms.some((value) => value !== 'none')) violations.push('the spread deck moved with the spine');
        if (slots.length !== 2) violations.push(`expected two fixed page slots, got ${slots.length}`);
        if (Number.isFinite(spine) && Math.abs(spine - originalSpine) > 0.5) violations.push('the fixed spine changed position');
        if (slots.some((node) => getComputedStyle(node).overflow !== 'hidden')) violations.push('a moving page escaped its fixed slot');
      } else if (seenLayer) {
        resolve({ transition: selectedTransition, activeFrames, firstFrame, violations: [...new Set(violations)] });
        return;
      }
      if (performance.now() - startedAt > 2000) {
        reject(new Error(`${selectedTransition} double-page transition did not settle`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { selectedTransition: transition, pageDelta: delta });
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-transition-'));
  const fixturePath = path.join(dataRoot, 'transition-stability.md');
  let servers;
  let browser;
  try {
    await fs.writeFile(fixturePath, `# 无闪烁翻页\n\n${sourceText}\n`, 'utf8');
    servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.click('[data-view-target="reader"]');
    await page.setInputFiles('[data-reader-file]', fixturePath);
    await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]')?.open === true);
    await page.click('[data-reader-import-confirm]');
    await page.waitForFunction(() => readerState.apiMode && readerState.pages.length >= 5, null, { timeout: 15000 });
    await page.evaluate(() => {
      readerState.layoutMode = 'single-page';
      readerState.pageTransition = 'none';
      clearReaderLayoutCache();
      renderReaderReading({ locator: readerState.anchorLocator });
    });
    await page.waitForFunction(() => readerState.effectiveLayoutMode === 'single-page' && readerState.pages.length >= 5);
    await page.waitForTimeout(360);

    const traces = [];
    for (const [transition, delta] of [['fade', 1], ['slide', 1], ['cover', -1]]) {
      const trace = await traceTransition(page, transition, delta);
      assert.deepStrictEqual(trace.violations, [], `${transition} transition exposed an unstable frame`);
      assert.ok(trace.activeFrames >= 2, `${transition} transition must stay double-buffered across multiple frames`);
      assert.strictEqual(trace.finalSameDeck, true, `${transition} transition must reveal the same authoritative deck at completion`);
      assert.strictEqual(trace.finalVisibility, 'visible', `${transition} transition must reveal its destination`);
      assert.strictEqual(trace.activeClass, false, `${transition} transition must clean its active marker`);
      if (transition === 'fade') assert.ok(trace.firstIncomingStyle.opacity < 0.5, 'fade snapshot must be primed before its first visible frame');
      else assert.notStrictEqual(trace.firstIncomingStyle.transform, 'none', `${transition} snapshot must begin at its transformed start position`);
      traces.push(trace);
    }
    const rapidStart = await page.evaluate(() => {
      readerState.pageTransition = 'slide';
      const start = readerState.pageIndex;
      queueReaderPageTurn(1);
      queueReaderPageTurn(1);
      queueReaderPageTurn(1);
      return start;
    });
    await page.waitForFunction(() => document.querySelectorAll('.desktop-reader-page-transition-layer').length === 1);
    assert.deepStrictEqual(await page.evaluate(() => ({
      liveDecks: document.querySelectorAll('[data-reader-content] > .desktop-reader-page-deck').length,
      snapshotLayers: document.querySelectorAll('.desktop-reader-page-transition-layer').length
    })), { liveDecks: 1, snapshotLayers: 1 }, 'rapid turns must retain one authoritative deck and one snapshot layer');
    await page.waitForFunction(() => !document.querySelector('.desktop-reader-page-transition-layer'));
    assert.strictEqual(await page.evaluate((start) => readerState.pageIndex >= Math.min(start + 3, readerState.pages.length - 1), rapidStart), true, 'rapid turns must preserve their merged destination');

    await page.evaluate(() => {
      readerState.layoutMode = 'double-page';
      readerState.pageTransition = 'none';
      readerState.pageIndex = 2;
      readerState.anchorLocator = null;
      clearReaderLayoutCache();
      renderReaderReading();
    });
    await page.waitForFunction(() => readerState.effectiveLayoutMode === 'double-page'
      && document.querySelectorAll('[data-reader-content] > .desktop-reader-page-deck[data-reader-spread="double"] > .desktop-reader-page').length === 2);
    await page.waitForTimeout(360);
    const spineTraces = [];
    for (const [transition, delta] of [['slide', 1], ['cover', -1]]) {
      const trace = await traceLockedSpineTransition(page, transition, delta);
      assert.deepStrictEqual(trace.violations, [], `${transition} must keep the double-page spine fixed`);
      assert.ok(trace.activeFrames >= 2, `${transition} must keep its fixed page slots for multiple frames`);
      assert.ok(trace.firstFrame.pageTransforms.some((value) => value !== 'none'), `${transition} must animate pages inside the fixed slots`);
      assert.ok(Math.abs(trace.firstFrame.spineDelta) <= 0.5, `${transition} must not shift the spine on its first frame`);
      spineTraces.push(trace);
    }
    console.log(`READER_TRANSITION_STABILITY=${JSON.stringify(traces)}`);
    console.log(`READER_TRANSITION_SPINE=${JSON.stringify(spineTraces)}`);
    console.log('Reader transition stability tests passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader transition stability tests failed:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
