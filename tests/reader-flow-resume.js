/* global readerState readerReflowTimer setView openReaderLibraryDocument captureReaderPositionLocator saveReaderWorkspacePosition createReaderLocatorAt navigateReaderToLocator */
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const { createReaderLibraryService } = require('../desktop/services/reader-library-service');

const documentId = 'reader-flow-resume-fixture';
const root = path.resolve(__dirname, '..');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function readPosition(appUrl) {
    const response = await fetch(`${appUrl}/api/reader/state?documentId=${documentId}`);
    const payload = await response.json();
    assert.ok(response.ok && payload.ok !== false);
    return payload.state && payload.state.positionLocator;
}

async function removeTemporaryData(dataRoot) {
    assert.strictEqual(path.dirname(path.resolve(dataRoot)), path.resolve(os.tmpdir()), 'Unexpected temporary test directory');
    await fs.rm(dataRoot, { recursive: true, force: true });
}

async function openReader(page, viaContinueButton = false) {
    await page.waitForFunction(() => typeof window.openReaderLibraryDocument === 'function' && document.querySelector('[data-reader-content]'));
    if (viaContinueButton) {
        await page.click('[data-view-target="reader"]');
        await page.locator('[data-reader-library]').getByRole('button', { name: '继续阅读', exact: true }).first().click();
    } else {
        await page.evaluate(async id => {
            setView('reader');
            await openReaderLibraryDocument(id);
        }, documentId);
    }
    await page.waitForFunction(id => readerState.activeDocumentId === id && readerState.currentChapter, documentId);
    await page.evaluate(() => {
        const layout = document.querySelector('[data-reader-layout-mode]');
        if (layout.value !== 'flow') {
            layout.value = 'flow';
            layout.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
    try {
        await page.waitForFunction(() => readerState.effectiveLayoutMode === 'flow'
            && document.querySelector('[data-reader-content]').scrollHeight > 1800);
    } catch (error) {
        console.log('openReader diagnostic', await page.evaluate(() => ({
            view: document.querySelector('#desktop-root').dataset.view,
            mode: readerState.layoutMode, effective: readerState.effectiveLayoutMode,
            blocks: readerState.currentChapter && readerState.currentChapter.blocks.length,
            content: document.querySelector('[data-reader-content]').outerHTML.slice(0, 1500),
            dimensions: ['clientWidth', 'clientHeight', 'scrollHeight'].map(key => document.querySelector('[data-reader-content]')[key])
        })));
        throw error;
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function snapshot(page) {
    return page.evaluate(() => {
        const content = document.querySelector('[data-reader-content]');
        return {
            view: document.querySelector('#desktop-root').dataset.view,
            scrollTop: content.scrollTop,
            locator: captureReaderPositionLocator(),
            lineHeight: parseFloat(getComputedStyle(content).lineHeight),
            visible: content.clientWidth > 0 && content.clientHeight > 0
        };
    });
}

async function assertFlowDestinationClearOfChrome(page) {
    const navigateToDestination = async () => {
        const navigated = await page.evaluate(async () => {
            const block = readerState.currentChapter.blocks.find(item => item.text.length > 600);
            return navigateReaderToLocator(createReaderLocatorAt(block.blockId, 600));
        });
        assert.strictEqual(navigated, true, 'the same locator navigation used by bookmarks and search must succeed');
    };
    const readDestination = async () => {
        let previous;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const current = await page.evaluate(async () => {
                await new Promise(resolve => requestAnimationFrame(resolve));
                const block = readerState.currentChapter.blocks.find(item => item.text.length > 600);
                const node = document.querySelector(`[data-reader-block="${CSS.escape(block.blockId)}"]`);
                const range = document.createRange();
                range.setStart(node.firstChild, 600);
                range.setEnd(node.firstChild, 601);
                const content = document.querySelector('[data-reader-content]');
                return {
                    targetTop: range.getBoundingClientRect().top,
                    chromeBottom: Math.max(...Array.from(document.querySelectorAll('.desktop-reader-topbar, .desktop-reader-reading-bar'))
                        .map(bar => bar.getBoundingClientRect().bottom)),
                    origin: content.getBoundingClientRect().top + parseFloat(getComputedStyle(content).paddingTop),
                    reflowPending: readerReflowTimer !== null,
                    locator: captureReaderPositionLocator()
                };
            });
            // Opening a saved flow book queues a preferences reflow. Sample the
            // settled destination, never the frame between rebuilding its DOM
            // and restoring its scroll position in the following RAF.
            if (!current.reflowPending && Math.abs(current.targetTop - current.origin) < 1
                && previous && !previous.reflowPending && current.targetTop === previous.targetTop
                && current.locator.offset === previous.locator.offset) return current;
            previous = current;
        }
        assert.fail(`flow destination did not settle at its reading origin: ${JSON.stringify(previous)}`);
    };
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => readerReflowTimer === null);
    await page.evaluate(() => window.readerHudShow());
    await navigateToDestination();
    const visible = await readDestination();
    assert.ok(visible.targetTop >= visible.chromeBottom, 'flow navigation must reveal its destination below the overlay header');
    await page.evaluate(() => window.readerHudHide());
    const hidden = await readDestination();
    assert.strictEqual(hidden.targetTop, visible.targetTop, 'hiding the HUD must retain the same flow destination origin');
    assert.deepStrictEqual(hidden.locator, visible.locator, 'HUD visibility must not change the captured reading line');
    await page.evaluate(() => {
        window.draftHarborDesktop = { isFullscreen: async () => true };
        window.readerHudToggleFocusMode();
    });
    await page.waitForFunction(() => readerState.focusMode);
    await navigateToDestination();
    const focused = await readDestination();
    assert.ok(Math.abs(focused.targetTop - focused.origin) < 1, 'focus mode must preserve the reserved flow reading origin');
    await page.evaluate(() => { window.readerHudToggleFocusMode(); delete window.draftHarborDesktop; });
    await page.waitForFunction(() => !readerState.focusMode);
    await navigateToDestination();
    await readDestination();
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-flow-resume-'));
    let servers;
    let browser;
    try {
        const library = createReaderLibraryService();
        const draft = library.previewPastedImport({
            draftId: 'flow-resume-draft', title: 'Flow resume fixture', format: 'plain',
            text: '海风吹过旧港，旅人沿着堤岸寻找灯塔，记录遥远船只归来的消息。'.repeat(400)
        });
        await library.confirmImportDraft(dataRoot, draft.draftId, { documentId, revisionId: 'flow-resume-revision' });
        servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
        browser = await chromium.launch({ headless: true });
        const allowedOrigins = new Set([new URL(servers.appUrl).origin, new URL(servers.updaterUrl).origin]);
        for (const reload of [false, true]) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
            await context.route('**/*', route => allowedOrigins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
            const page = await context.newPage();
            page.setDefaultTimeout(10000);
            const errors = [];
            const stateWrites = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => {
                if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/reader/state') {
                    const state = request.postDataJSON().state;
                    if (state.documentId === documentId) stateWrites.push(state.positionLocator);
                }
            });
            try {
                await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'networkidle' });
                await openReader(page);
                await assertFlowDestinationClearOfChrome(page);
                await page.evaluate(() => {
                    const content = document.querySelector('[data-reader-content]');
                    content.scrollTo({ top: 0, behavior: 'instant' });
                    content.dispatchEvent(new Event('scroll'));
                });
                // Let setup preference/position writes finish before testing an
                // immediate exit, which must beat the normal 450 ms debounce.
                await pause(750);
                await page.evaluate(() => saveReaderWorkspacePosition());
                stateWrites.length = 0;
                const before = await page.evaluate(useButton => {
                    const content = document.querySelector('[data-reader-content]');
                    content.scrollTo({ top: 845, behavior: 'instant' });
                    content.dispatchEvent(new Event('scroll'));
                    const result = {
                        view: document.querySelector('#desktop-root').dataset.view,
                        clientWidth: content.clientWidth,
                        clientHeight: content.clientHeight,
                        scrollHeight: content.scrollHeight,
                        scrollTop: content.scrollTop,
                        locator: captureReaderPositionLocator(),
                        lineHeight: parseFloat(getComputedStyle(content).lineHeight)
                    };
                    if (useButton) document.querySelector('[data-reader-exit]').click();
                    else setView('bookshelf');
                    return result;
                }, reload);
                assert.ok(before.locator && before.locator.offset > 0, `the fixture must leave while reading inside the long paragraph: ${JSON.stringify(before)}`);
                assert.strictEqual(await page.locator('#desktop-root').getAttribute('data-view'), 'bookshelf');
                await pause(750);
                const hidden = await snapshot(page);
                const persisted = await readPosition(servers.appUrl);
                assert.strictEqual(hidden.visible, false);
                assert.strictEqual(hidden.locator, null, 'a hidden reader must not manufacture a locator from zero-sized rectangles');
                assert.ok(stateWrites.some(locator => locator && locator.blockId === before.locator.blockId && locator.offset === before.locator.offset), 'leaving Reader must enqueue the last visible position');
                assert.strictEqual(persisted.blockId, before.locator.blockId);
                assert.strictEqual(persisted.offset, before.locator.offset, 'a delayed hidden save must not overwrite the visible paragraph offset');
                if (reload) await page.reload({ waitUntil: 'networkidle' });
                await openReader(page, reload);
                const reopened = await snapshot(page);
                assert.ok(Math.abs(reopened.scrollTop - before.scrollTop) <= Math.max(32, before.lineHeight + 2), 'reopening must resume within one rendered line of the previous scroll position');
                assert.strictEqual(reopened.locator.blockId, before.locator.blockId);
                assert.ok(reopened.locator.offset > 0);
                await pause(750);
                const afterDelayedSave = await readPosition(servers.appUrl);
                const stable = await snapshot(page);
                assert.strictEqual(afterDelayedSave.blockId, reopened.locator.blockId);
                assert.strictEqual(afterDelayedSave.offset, reopened.locator.offset, 'a later debounced save must preserve the resumed text offset');
                assert.strictEqual(stable.locator.blockId, reopened.locator.blockId);
                assert.strictEqual(stable.locator.offset, reopened.locator.offset, 'a later reflow must preserve the resumed text offset');
                assert.ok(Math.abs(stable.scrollTop - reopened.scrollTop) <= Math.max(32, reopened.lineHeight + 2), 'the resumed line must remain visible after delayed work settles');
                assert.deepStrictEqual(errors, [], 'complete product scripts must not emit runtime errors');
                console.log(`PASS ${reload ? 'exit button, reload and Continue Reading' : 'setView and same-page reopen'}: scroll ${before.scrollTop} → ${reopened.scrollTop}, saved/resumed offset ${persisted.offset}/${reopened.locator.offset}, hidden capture null`);
            } finally {
                await context.close();
            }
        }
        console.log('Reader flow resume integration tests passed (2 full-product cases, temporary imported book, no provider calls).');
    } finally {
        if (browser) await browser.close();
        if (servers) servers.close();
        await removeTemporaryData(dataRoot);
    }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
