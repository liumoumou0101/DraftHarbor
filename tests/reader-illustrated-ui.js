/* global readerState, renderReaderReading, createReaderLocatorAt, queueReaderPageTurn */

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

const root = path.resolve(__dirname, '..');

async function importBook(page, fixturePath) {
    const previousId = await page.evaluate(() => readerState.activeDocumentId);
    await page.setInputFiles('[data-reader-file]', fixturePath);
    await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]')?.open === true);
    await page.click('[data-reader-import-confirm]');
    await page.waitForFunction(id => readerState.apiMode && readerState.currentChapter && !readerState.drawer && readerState.activeDocumentId !== id, previousId);
    return page.evaluate(() => readerState.activeDocumentId);
}

async function setIllustrated(page) {
    await page.evaluate(() => {
        readerState.layoutMode = 'illustrated';
        readerState.pageTransition = 'none';
        readerState.hudMode = 'visible';
        window.readerHudShow();
        renderReaderReading({ locator: readerState.anchorLocator });
    });
    await page.waitForFunction(() => readerState.pages.length > 1);
    await page.waitForFunction(() => document.querySelector('[data-reader-content] > .desktop-reader-page-deck > .desktop-reader-page')?.getBoundingClientRect().width > 100);
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-illustrated-ui-'));
    let servers;
    let browser;
    try {
        const paragraphs = Array.from({ length: 24 }, (_, index) => `段落 ${index + 1}：${'灯塔照亮海面，船沿着防波堤驶进港口。'.repeat(12)}`);
        const firstPath = path.join(dataRoot, 'first-book.md');
        const secondPath = path.join(dataRoot, 'second-book.md');
        await fs.writeFile(firstPath, ['# 第一册', '', ...paragraphs.flatMap(text => [text, ''])].join('\n'));
        await fs.writeFile(secondPath, '# 第二册\n\n另一本文档的正文。\n\n这本书没有配图。');
        const png = await fs.readFile(path.join(root, 'assets/draftharbor-icon-256.png'));
        const imageFiles = count => Array.from({ length: count }, (_, index) => ({ name: `real-image-${index + 1}.png`, mimeType: 'image/png', buffer: png }));
        servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
        await page.click('[data-view-target="reader"]');
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer]').count(), 1,
            'reader composition must load the image viewer before shell bindings');
        const firstDocumentId = await importBook(page, firstPath);
        await setIllustrated(page);
        const firstPageRange = await page.evaluate(() => {
            const segments = readerState.pages[readerState.pageIndex].segments;
            return {
                revisionId: readerState.activeRevisionId,
                start: { blockId: segments[0].blockId, offset: segments[0].startOffset },
                end: { blockId: segments.at(-1).blockId, offset: segments.at(-1).endOffset }
            };
        });
        const emptyPageWidth = await page.locator('[data-reader-content] > .desktop-reader-page-deck > .desktop-reader-page').first().evaluate(node => node.getBoundingClientRect().width);

        // Catches silent four-file truncation and the old multi-card presentation.
        await page.setInputFiles('[data-reader-illustration-file]', imageFiles(5));
        await page.waitForFunction(() => !readerState.illustrationBusy && readerState.illustrations.length > 0);
        assert.strictEqual(await page.evaluate(() => readerState.illustrations.length), 5, 'all five selected images must be saved instead of silently discarding the fifth');
        const captured = await page.evaluate(() => readerState.illustrations.map(item => ({ revisionId: item.revisionId, range: item.range })));
        assert.deepStrictEqual(captured, Array.from({ length: 5 }, () => ({ revisionId: firstPageRange.revisionId, range: { start: firstPageRange.start, end: firstPageRange.end } })), 'every uploaded image must freeze the original visible text range and revision');
        assert.strictEqual(await page.locator('[data-reader-illustration-main]').count(), 1, 'the image pane must show one large main image');
        await page.waitForFunction(() => {
            const img = document.querySelector('[data-reader-illustration-main]');
            return img?.complete && img.naturalWidth > 0;
        });
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '1 / 5');
        const firstImageId = await page.locator('[data-reader-illustration-main]').getAttribute('data-reader-illustration-id');
        const textPageIndex = await page.evaluate(() => readerState.pageIndex);
        await page.click('[data-reader-illustration-next]');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '2 / 5');
        assert.notStrictEqual(await page.locator('[data-reader-illustration-main]').getAttribute('data-reader-illustration-id'), firstImageId);
        assert.strictEqual(await page.evaluate(() => readerState.pageIndex), textPageIndex, 'switching images must leave the text page unchanged');
        const illustratedPageWidth = await page.locator('[data-reader-content] > .desktop-reader-page-deck > .desktop-reader-page').first().evaluate(node => node.getBoundingClientRect().width);
        assert.ok(Math.abs(illustratedPageWidth - emptyPageWidth) < 2, `adding images must not change text page geometry (${emptyPageWidth} -> ${illustratedPageWidth})`);

        // These real PNG interactions catch image shortcuts leaking into text
        // navigation, losing focus, or leaving either presentation out of sync.
        const imagePosition = () => page.evaluate(() => ({ pageIndex: readerState.pageIndex,
            locator: window.captureReaderPositionLocator(), scrollTop: document.querySelector('[data-reader-content]').scrollTop }));
        const wheelImage = (selector, deltaY, options = {}) => page.locator(selector).dispatchEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...options });
        const swipeImage = (selector, { vertical = false, cancel = false, multi = false } = {}) => page.locator(selector).evaluate((node, options) => {
            const send = (type, id, x, y) => node.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
            send('pointerdown', 91, 400, 300);
            if (options.multi) send('pointerdown', 92, 420, 300);
            send('pointermove', 91, options.vertical ? 390 : 220, options.vertical ? 480 : 305);
            send(options.cancel ? 'pointercancel' : 'pointerup', 91, options.vertical ? 390 : 220, options.vertical ? 480 : 305);
            if (options.multi) send('pointerup', 92, 220, 300);
        }, { vertical, cancel, multi });
        const paneSelector = '[data-reader-illustration-pane]';
        const viewportSelector = '[data-reader-illustration-viewer-viewport]';
        const imagePositionBefore = await imagePosition();
        await page.evaluate(async () => {
            queueReaderPageTurn(1);
            document.querySelector('[data-reader-illustration-pane]').dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true }));
            await new Promise(resolve => requestAnimationFrame(resolve));
        });
        assert.deepStrictEqual(await imagePosition(), imagePositionBefore, 'image input must cancel a text page turn already queued for the next frame');
        await page.locator('[data-reader-illustration-open]').focus();
        await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '3 / 5', 'focused image ArrowRight must select the next image');
        assert.strictEqual(await page.evaluate(() => document.activeElement.matches('[data-reader-illustration-open]')), true);
        assert.strictEqual(await page.locator(`${paneSelector} [data-reader-illustration-thumbnail]`).count(), 5);
        await page.locator(`${paneSelector} [data-reader-illustration-thumbnail]`).first().click();
        await page.keyboard.press('ArrowLeft');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '1 / 5', 'image keys must stop at the first image');
        assert.strictEqual(await page.locator(`${paneSelector} [data-reader-illustration-thumbnail]`).first().getAttribute('aria-current'), 'true');
        await page.locator('[data-reader-illustration-next]').focus();
        for (let index = 0; index < 4; index++) await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '5 / 5');
        await page.keyboard.press('ArrowLeft');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '4 / 5', 'a focused next button reaching the last image must retain keyboard navigation');
        await page.locator('[data-reader-illustration-prev]').focus();
        for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '2 / 5', 'a focused previous button reaching the first image must retain keyboard navigation');
        await page.locator(`${paneSelector} [data-reader-illustration-thumbnail]`).first().click();
        await wheelImage(paneSelector, 20);
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '1 / 5', 'small wheel movement must accumulate before switching');
        await wheelImage(paneSelector, 80);
        await wheelImage(paneSelector, 120);
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '2 / 5', 'an inertia burst must switch only one image');
        await page.waitForTimeout(300);
        await wheelImage(paneSelector, 120, { ctrlKey: true });
        await wheelImage(paneSelector, 120, { metaKey: true });
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '2 / 5', 'modified wheel gestures must not select images');
        for (const options of [{ vertical: true }, { cancel: true }, { multi: true }]) await swipeImage(paneSelector, options);
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '2 / 5', 'vertical, cancelled and multi-touch gestures must keep the image');
        await swipeImage('[data-reader-illustration-open]');
        await page.locator('[data-reader-illustration-open]').dispatchEvent('click', { bubbles: true, cancelable: true, detail: 1 });
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '3 / 5');
        assert.strictEqual(await page.evaluate(() => document.querySelector('[data-reader-illustration-viewer]').open), false, 'a completed swipe must suppress its following click');
        await page.waitForTimeout(450);
        await page.click('[data-reader-illustration-open]');
        await page.waitForFunction(() => document.querySelector('[data-reader-illustration-viewer]').open);
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '3 / 5');
        await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '4 / 5');
        await page.locator('[data-reader-illustration-viewer-next]').focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '4 / 5', 'viewer next at the last image must retain keyboard navigation');
        await page.locator('[data-reader-illustration-viewer-prev]').focus();
        for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '2 / 5', 'viewer previous at the first image must retain keyboard navigation');
        await page.locator('[data-reader-illustration-viewer-thumbnails] [data-reader-illustration-thumbnail]').first().click();
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '1 / 5');
        await page.evaluate(() => { window.__oldImageThumbnail = document.querySelector('[data-reader-illustration-viewer-thumbnails] [data-reader-illustration-thumbnail]'); });
        assert.strictEqual(await page.evaluate(() => document.activeElement.matches('[data-reader-illustration-thumbnail]')), true);
        await wheelImage(viewportSelector, 120);
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '2 / 5');
        await swipeImage(viewportSelector);
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '3 / 5');
        await page.click('[data-reader-illustration-zoom-in]');
        await page.waitForTimeout(300);
        await wheelImage(viewportSelector, 120);
        await swipeImage(viewportSelector);
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '3 / 5', 'enlarged images must retain wheel and touch panning');
        await page.click('[data-reader-illustration-zoom-reset]');
        await page.locator('[data-reader-illustration-viewer-thumbnails] [data-reader-illustration-thumbnail]').last().click();
        await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '5 / 5', 'viewer selection must stop at the last image');
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '5 / 5', 'closing the viewer must retain its selected image in the pane');
        assert.strictEqual(await page.evaluate(() => document.activeElement.matches('[data-reader-illustration-open]')), true);
        assert.deepStrictEqual(await imagePosition(), imagePositionBefore, 'image navigation must preserve the text locator and scroll position');
        const thumbAssets = await page.locator(`${paneSelector} [data-reader-illustration-thumbnail] img`).evaluateAll(nodes => nodes.map(node => ({ loading: node.loading, decoding: node.decoding })));
        assert.deepStrictEqual(thumbAssets, Array.from({ length: 5 }, () => ({ loading: 'lazy', decoding: 'async' })));
        await page.locator(`${paneSelector} [data-reader-illustration-thumbnail]`).first().click();
        await page.click('[data-reader-illustration-open]');
        await page.keyboard.press('ArrowRight');
        await page.evaluate(() => window.__oldImageThumbnail.click());
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '2 / 5', 'a detached thumbnail from a closed viewer session must not change the reopened viewer');
        const selectedBeforePaneRebuild = await page.locator('[data-reader-illustration-viewer-image]').getAttribute('data-reader-illustration-id');
        await page.evaluate(() => renderReaderReading({ locator: readerState.anchorLocator }));
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.evaluate(() => document.activeElement.matches('[data-reader-illustration-open]')), true, 'closing a viewer after pane reflow must focus the current main image trigger');
        assert.strictEqual(await page.locator('[data-reader-illustration-main]').getAttribute('data-reader-illustration-id'), selectedBeforePaneRebuild, 'pane reflow while viewing must preserve the selected image');
        await page.locator(`${paneSelector} [data-reader-illustration-thumbnail]`).first().click();
        await page.locator('[data-reader-illustration-thumbnails]').evaluate(node => { node.style.maxWidth = '110px'; });
        await page.locator('[data-reader-illustration-open]').focus();
        await page.evaluate(() => {
            readerState.wheelTurnAccumulator = 39;
            readerState.pointerGesture = { pointerId: 501, startX: 500, startY: 300 };
        });
        await page.keyboard.press('ArrowRight');
        const residualInput = await page.evaluate(() => ({ wheel: readerState.wheelTurnAccumulator, pointer: readerState.pointerGesture }));
        assert.deepStrictEqual(residualInput, { wheel: 0, pointer: null }, 'image input must discard residual text gestures');
        for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowRight');
        const selectedVisible = await page.locator('[data-reader-illustration-thumbnails]').evaluate(strip => {
            const bounds = strip.getBoundingClientRect();
            const selected = strip.querySelector('[aria-current="true"]').getBoundingClientRect();
            return strip.scrollLeft > 0 && selected.left >= bounds.left - 1 && selected.right <= bounds.right + 1;
        });
        assert.strictEqual(selectedVisible, true, 'keyboard selection must expose the thumbnail by scrolling its strip');
        assert.deepStrictEqual(await imagePosition(), imagePositionBefore, 'thumbnail scrolling must not move the text');
        await page.evaluate(async () => {
            renderReaderReading({ locator: readerState.anchorLocator });
            document.querySelector('[data-reader-illustration-thumbnails]').style.maxWidth = '110px';
            await new Promise(resolve => requestAnimationFrame(resolve));
        });
        assert.ok(await page.locator('[data-reader-illustration-thumbnails]').evaluate(strip => strip.scrollLeft > 0), 'a rebuilt pane must expose its preserved selected thumbnail');
        await page.evaluate(() => {
            window.__allSwitchTestImages = readerState.illustrations;
            readerState.illustrations = [readerState.illustrations[0]];
            renderReaderReading({ locator: readerState.anchorLocator });
        });
        await page.locator('[data-reader-illustration-open]').focus();
        await page.keyboard.press('ArrowRight');
        await wheelImage(paneSelector, 120);
        await swipeImage(paneSelector);
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '1 / 1', 'a lone image must remain selected for every shortcut');
        assert.strictEqual(await page.locator('[data-reader-illustration-thumbnails]').isVisible(), false, 'a lone image must hide the pane thumbnail strip');
        await page.locator('[data-reader-illustration-open]').dispatchEvent('click', { bubbles: true, cancelable: true, detail: 1 });
        assert.strictEqual(await page.evaluate(() => document.querySelector('[data-reader-illustration-viewer]').open), false, 'a boundary swipe must suppress its click even without another image');
        await page.waitForTimeout(450);
        await page.click('[data-reader-illustration-open]');
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-thumbnails]').isVisible(), false, 'a lone image must hide the viewer thumbnail strip');
        await page.keyboard.press('ArrowRight');
        await wheelImage(viewportSelector, 120);
        await swipeImage(viewportSelector);
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-count]').textContent(), '1 / 1');
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            readerState.illustrations = window.__allSwitchTestImages;
            delete window.__allSwitchTestImages;
            renderReaderReading({ locator: readerState.anchorLocator });
        });

        // A separate existing range on the same text page must join the viewer,
        // rather than replacing the group added at the beginning of that page.
        const secondRange = { start: { blockId: firstPageRange.end.blockId, offset: Math.max(0, firstPageRange.end.offset - 2) }, end: firstPageRange.end };
        const extra = await (await fetch(`${servers.appUrl}/api/reader/illustrations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ illustration: { documentId: firstDocumentId, revisionId: firstPageRange.revisionId, chapterId: 'chapter-1', blockId: secondRange.start.blockId, offset: secondRange.start.offset, range: secondRange, fileName: 'separate-range.png', bytes: png.toString('base64') } })
        })).json();
        assert.strictEqual(extra.ok, true);
        await page.evaluate(async id => { await window.loadReaderIllustrationDocument(id); renderReaderReading({ locator: readerState.anchorLocator }); }, firstDocumentId);
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '1 / 6', 'all images from separate overlapping ranges must be available on the same page');
        await fetch(`${servers.appUrl}/api/reader/illustrations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: firstDocumentId, illustrationId: extra.illustration.illustrationId }) });
        await page.evaluate(async id => { await window.loadReaderIllustrationDocument(id); renderReaderReading({ locator: readerState.anchorLocator }); }, firstDocumentId);
        await page.click('[data-reader-font-increase]');
        assert.strictEqual(await page.locator('[data-reader-illustration-count]').textContent(), '1 / 5', 'text repagination must preserve images for the same content range');

        // Simulate a failed image request, then exercise the real retry control.
        await page.route('**/api/reader/illustrations/file?**', route => route.abort('failed'));
        await page.locator('[data-reader-illustration-main]').evaluate(node => { node.src += '&failed-image-check=1'; });
        await page.waitForFunction(() => document.querySelector('.desktop-reader-illustration-image-status')?.textContent === '图片加载失败。');
        await page.unroute('**/api/reader/illustrations/file?**');
        await page.locator('[data-reader-illustration-pane]').getByRole('button', { name: '重试', exact: true }).click();
        await page.waitForFunction(() => { const image = document.querySelector('[data-reader-illustration-main]'); return image?.complete && image.naturalWidth > 0 && !image.hidden; });

        // Real image inspection must preserve both the text position and focus.
        await page.click('[data-reader-illustration-open]');
        await page.waitForFunction(() => document.querySelector('[data-reader-illustration-viewer]')?.open);
        const beforeZoom = await page.locator('[data-reader-illustration-viewer-image]').evaluate(node => node.getBoundingClientRect().width);
        await page.click('[data-reader-illustration-zoom-in]');
        const afterZoom = await page.locator('[data-reader-illustration-viewer-image]').evaluate(node => node.getBoundingClientRect().width);
        assert.ok(afterZoom > beforeZoom, 'zoom must enlarge the decoded image');
        await page.locator('[data-reader-illustration-viewer-viewport]').dispatchEvent('wheel', { deltaY: 180, bubbles: true });
        assert.strictEqual(await page.evaluate(() => readerState.pageIndex), textPageIndex, 'viewer wheel input must not page the text');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-reader-illustration-viewer]')?.open);
        assert.strictEqual(await page.evaluate(() => document.activeElement?.matches('[data-reader-illustration-open]')), true, 'closing the viewer must restore its trigger focus');

        // Image-side gestures must not leak into the text swipe coordinator.
        await page.evaluate(() => {
            const pane = document.querySelector('[data-reader-illustration-pane]');
            pane.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientX: 620, clientY: 300, bubbles: true }));
            pane.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77, pointerType: 'touch', clientX: 420, clientY: 300, bubbles: true }));
            pane.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        });
        await page.waitForTimeout(100);
        assert.strictEqual(await page.evaluate(() => readerState.pageIndex), textPageIndex);

        await page.evaluate(() => {
            const block = readerState.currentChapter.blocks.at(-1);
            renderReaderReading({ locator: createReaderLocatorAt(block.blockId, block.text.length - 1) });
        });
        assert.strictEqual(await page.locator('[data-reader-illustration-pane]').count(), 0, 'images must stop outside their captured text range');
        assert.strictEqual(await page.locator('.desktop-reader-page-deck').first().getAttribute('data-reader-illustrations'), 'empty');
        assert.strictEqual(await page.locator('.desktop-reader-illustration-empty').count(), 0, 'empty pages must not reserve an editor panel');
        await page.evaluate(() => { const block = readerState.currentChapter.blocks[0]; renderReaderReading({ locator: createReaderLocatorAt(block.blockId, 0) }); });

        await page.setViewportSize({ width: 720, height: 900 });
        await page.waitForTimeout(350);
        assert.strictEqual(await page.locator('[data-reader-illustration-view]').isVisible(), true, 'narrow readers must retain an image-viewing entry point');
        await page.click('[data-reader-illustration-view]');
        await page.waitForFunction(() => document.querySelector('[data-reader-illustration-viewer]')?.open);
        assert.ok(await page.locator('[data-reader-illustration-viewer-image]').evaluate(node => node.naturalWidth > 0));
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.locator('[data-reader-illustration-add]').isEnabled(), true, 'compact layout must still allow image uploads');

        await page.setViewportSize({ width: 1280, height: 360 });
        await page.waitForFunction(() => readerState.effectiveLayoutMode === 'flow');
        assert.strictEqual(await page.locator('[data-reader-illustration-view]').isVisible(), true, 'low-height flow fallback must retain access to images');
        const reviewFailures = [];
        const checkReview = (name, check) => {
            try { check(); } catch (error) { reviewFailures.push(`${name}: ${error.message}`); }
        };
        await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = 379;
            content.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(180);
        const beforeFlowWrite = await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            const bounds = content.getBoundingClientRect();
            const style = getComputedStyle(content);
            const visibleTop = bounds.top + content.clientTop + parseFloat(style.paddingTop);
            const visibleBottom = bounds.top + content.clientTop + content.clientHeight - parseFloat(style.paddingBottom);
            const nodes = Array.from(content.querySelectorAll('[data-reader-block]')).filter(node => { const rect = node.getBoundingClientRect(); return rect.bottom > visibleTop && rect.top < visibleBottom; });
            const last = nodes.at(-1);
            const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
            const range = document.createRange();
            let textNode;
            let offset = Number(last.dataset.readerStartOffset) || 0;
            let end = offset;
            while ((textNode = walker.nextNode())) {
                for (let index = 0; index < textNode.length; index++) {
                    range.setStart(textNode, index);
                    range.setEnd(textNode, index + 1);
                    const rect = range.getBoundingClientRect();
                    if (rect.top < visibleBottom && rect.bottom > visibleTop) end = offset + index + 1;
                }
                offset += textNode.length;
            }
            return { scrollTop: content.scrollTop, locator: window.captureReaderPositionLocator(), end: { blockId: last.dataset.readerBlock, offset: end } };
        });
        await page.setInputFiles('[data-reader-illustration-file]', imageFiles(1));
        await page.waitForFunction(() => !readerState.illustrationBusy && readerState.illustrations.length === 6);
        assert.ok(await page.evaluate(() => readerState.illustrations.at(-1).range?.start.blockId), 'flow uploads must have a meaningful visible text range');
        const afterFlowWrite = await page.evaluate(() => ({ scrollTop: document.querySelector('[data-reader-content]').scrollTop, locator: window.captureReaderPositionLocator(), start: readerState.illustrations.at(-1).range.start, end: readerState.illustrations.at(-1).range.end }));
        assert.deepStrictEqual(afterFlowWrite.start, { blockId: beforeFlowWrite.locator.blockId, offset: beforeFlowWrite.locator.offset },
            'a flow image range must start at the visible reading line below reserved HUD chrome');
        checkReview('flow upload preserves position', () => {
            assert.ok(Math.abs(afterFlowWrite.scrollTop - beforeFlowWrite.scrollTop) < 2, `scrollTop ${beforeFlowWrite.scrollTop} -> ${afterFlowWrite.scrollTop}`);
            assert.deepStrictEqual(afterFlowWrite.locator, beforeFlowWrite.locator);
        });
        checkReview('flow range includes the last visible line above reserved bottom chrome', () => assert.deepStrictEqual(afterFlowWrite.end, beforeFlowWrite.end));
        await page.evaluate(scrollTop => { const content = document.querySelector('[data-reader-content]'); content.scrollTop = scrollTop; content.dispatchEvent(new Event('scroll')); }, beforeFlowWrite.scrollTop);
        await page.waitForTimeout(100);
        await page.click('[data-reader-illustration-view]');
        const beforeFlowDelete = await page.evaluate(() => ({ scrollTop: document.querySelector('[data-reader-content]').scrollTop, locator: window.captureReaderPositionLocator() }));
        page.once('dialog', dialog => dialog.accept());
        await page.click('[data-reader-illustration-viewer-remove]');
        await page.waitForFunction(() => !readerState.illustrationBusy && readerState.illustrations.length === 5);
        const afterFlowDelete = await page.evaluate(() => ({ scrollTop: document.querySelector('[data-reader-content]').scrollTop, locator: window.captureReaderPositionLocator() }));
        checkReview('flow viewer delete preserves position', () => {
            assert.ok(Math.abs(afterFlowDelete.scrollTop - beforeFlowDelete.scrollTop) < 2, `scrollTop ${beforeFlowDelete.scrollTop} -> ${afterFlowDelete.scrollTop}`);
            assert.deepStrictEqual(afterFlowDelete.locator, beforeFlowDelete.locator);
        });
        await page.evaluate(() => {
            document.querySelector('[data-reader-illustration-viewer]')?.close();
            const content = document.querySelector('[data-reader-content]'); content.scrollTop = 0; content.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(100);

        await page.evaluate(() => window.readerHudToggleFocusMode());
        assert.strictEqual(await page.locator('[data-reader-illustration-add]').isDisabled(), true);
        const focusViewerTrigger = await page.locator('[data-reader-illustration-open]').isVisible() ? '[data-reader-illustration-open]' : '[data-reader-illustration-view]';
        await page.click(focusViewerTrigger);
        await page.waitForFunction(() => document.querySelector('[data-reader-illustration-viewer]')?.open);
        assert.strictEqual(await page.locator('[data-reader-illustration-viewer-remove]').isVisible(), false, 'focus mode must remain read-only while viewing images');
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.readerHudToggleFocusMode());

        // Real delayed HTTP import catches both response contamination and the
        // remaining files accidentally acquiring the newly opened book identity.
        const secondDocumentId = await importBook(page, secondPath);
        await page.evaluate(async id => { await window.openReaderLibraryDocument(id); }, firstDocumentId);
        await page.setViewportSize({ width: 1600, height: 1000 });
        await setIllustrated(page);
        let releaseFirstUpload;
        let signalStarted;
        const started = new Promise(resolve => { signalStarted = resolve; });
        let held = false;
        const delayedRequests = [];
        const delayedErrors = [];
        page.on('response', async response => {
            if (response.url().endsWith('/api/reader/illustrations') && response.request().method() === 'POST' && !response.ok()) delayedErrors.push(await response.text());
        });
        await page.route('**/api/reader/illustrations', async route => {
            if (route.request().method() !== 'POST') return route.continue();
            const request = route.request().postDataJSON().illustration;
            delayedRequests.push({ documentId: request.documentId, range: request.range });
            if (held) return route.continue();
            held = true;
            signalStarted();
            await new Promise(resolve => { releaseFirstUpload = resolve; });
            await route.continue();
        });
        await page.setInputFiles('[data-reader-illustration-file]', imageFiles(2));
        await started;
        let signalSecondLoad;
        let releaseSecondLoad;
        const secondLoadFetched = new Promise(resolve => { signalSecondLoad = resolve; });
        await page.route('**/api/reader/illustrations?**', async route => {
            if (new URL(route.request().url()).searchParams.get('documentId') !== secondDocumentId) return route.continue();
            const response = await route.fetch();
            signalSecondLoad();
            await new Promise(resolve => { releaseSecondLoad = resolve; });
            await route.fulfill({ response });
        });
        await page.evaluate(id => {
            window.__staleImagePane = document.querySelector('[data-reader-illustration-pane]');
            window.__staleImagePane?.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 81, pointerType: 'touch', clientX: 500, clientY: 300, bubbles: true }));
            window.__readerIllustrationSwitch = window.openReaderLibraryDocument(id);
        }, secondDocumentId);
        await secondLoadFetched;
        releaseFirstUpload();
        await page.waitForFunction(() => !readerState.illustrationBusy);
        releaseSecondLoad();
        await page.evaluate(() => window.__readerIllustrationSwitch);
        await page.unroute('**/api/reader/illustrations?**');
        const readImages = async id => (await (await fetch(`${servers.appUrl}/api/reader/illustrations?documentId=${encodeURIComponent(id)}`)).json()).record.illustrations;
        assert.strictEqual((await readImages(firstDocumentId)).length, 7, `all delayed uploads must remain in the original document (${JSON.stringify({ delayedRequests, delayedErrors })})`);
        assert.strictEqual((await readImages(secondDocumentId)).length, 0, 'remaining uploaded files must not move into the newly opened document');
        assert.strictEqual(await page.evaluate(() => readerState.illustrations.length), 0, 'old upload responses must not replace the new book state');
        assert.strictEqual(await page.evaluate(() => readerState.illustrationRecord?.documentId), secondDocumentId, 'successful writes to A must not invalidate B’s pending image load');
        const newBookPosition = await imagePosition();
        await page.evaluate(() => {
            const pane = window.__staleImagePane;
            pane?.dispatchEvent(new PointerEvent('pointerup', { pointerId: 81, pointerType: 'touch', clientX: 200, clientY: 300, bubbles: true }));
            pane?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
            pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            pane?.querySelector('[data-reader-illustration-thumbnail]')?.click();
            pane?.querySelector('[data-reader-illustration-open]')?.click();
            delete window.__staleImagePane;
        });
        assert.deepStrictEqual(await imagePosition(), newBookPosition, 'old image gestures must not change the newly opened book');
        assert.strictEqual(await page.evaluate(() => document.querySelector('[data-reader-illustration-viewer]').open), false, 'an old image click must not reopen the previous book viewer');
        await page.unroute('**/api/reader/illustrations');

        await page.evaluate(async id => { await window.openReaderLibraryDocument(id); }, firstDocumentId);
        await setIllustrated(page);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.desktop-reader-illustration-remove').click();
        await page.waitForFunction(() => !readerState.illustrationBusy && readerState.illustrations.length === 6);
        assert.strictEqual((await readImages(firstDocumentId)).length, 6, 'confirmed removal must update stored images without changing documents');

        const staleLoadAfterWrite = async operation => {
            const initialCount = (await readImages(firstDocumentId)).length;
            let signalResponse;
            let releaseResponse;
            const fetched = new Promise(resolve => { signalResponse = resolve; });
            let heldResponse = false;
            await page.route('**/api/reader/illustrations?**', async route => {
                if (heldResponse) return route.continue();
                heldResponse = true;
                const response = await route.fetch();
                signalResponse();
                await new Promise(resolve => { releaseResponse = resolve; });
                await route.fulfill({ response });
            });
            const removedId = await page.locator('[data-reader-illustration-main]').getAttribute('data-reader-illustration-id');
            await page.evaluate(() => { window.__readerIllustrationPendingLoad = window.loadReaderIllustrationDocument(readerState.activeDocumentId); });
            await fetched;
            const expectedCount = operation === 'POST' ? initialCount + 1 : initialCount - 1;
            if (operation === 'POST') await page.setInputFiles('[data-reader-illustration-file]', imageFiles(1));
            else { page.once('dialog', dialog => dialog.accept()); await page.locator('.desktop-reader-illustration-remove').click(); }
            await page.waitForFunction(count => !readerState.illustrationBusy && readerState.illustrations.length === count, expectedCount);
            releaseResponse();
            await page.evaluate(() => window.__readerIllustrationPendingLoad);
            await page.unroute('**/api/reader/illustrations?**');
            const result = await page.evaluate(() => readerState.illustrations.map(item => item.illustrationId));
            checkReview(`late GET after ${operation}`, () => {
                assert.strictEqual(result.length, expectedCount, 'an older GET must not undo the successful write');
                if (operation === 'DELETE') assert.ok(!result.includes(removedId), 'an older GET must not resurrect a removed image');
            });
            await page.evaluate(async id => { await window.loadReaderIllustrationDocument(id); renderReaderReading({ locator: readerState.anchorLocator }); }, firstDocumentId);
        };
        await staleLoadAfterWrite('POST');
        await staleLoadAfterWrite('DELETE');
        assert.deepStrictEqual(reviewFailures, [], `Illustration review regressions:\n${reviewFailures.join('\n')}`);

        // An old-revision upload can finish after a same-book reimport. The
        // new revision's image load must reread the final record, not stay empty.
        const legacy = await (await fetch(`${servers.appUrl}/api/reader/illustrations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ illustration: { documentId: firstDocumentId, chapterId: 'chapter-1', blockId: 'chapter-1-block-1', offset: 0, fileName: 'legacy-image.png', bytes: png.toString('base64') } })
        })).json();
        assert.strictEqual(legacy.ok, true);
        await page.evaluate(async id => { await window.loadReaderIllustrationDocument(id); renderReaderReading({ locator: readerState.anchorLocator }); }, firstDocumentId);
        const beforeReimport = await page.evaluate(() => ({ revisionId: readerState.activeRevisionId, count: readerState.illustrations.length }));
        let releaseOldRevisionUpload;
        let signalOldRevisionUpload;
        const oldUploadStarted = new Promise(resolve => { signalOldRevisionUpload = resolve; });
        await page.route('**/api/reader/illustrations', async route => {
            if (route.request().method() !== 'POST') return route.continue();
            signalOldRevisionUpload();
            await new Promise(resolve => { releaseOldRevisionUpload = resolve; });
            await route.continue();
        });
        await page.setInputFiles('[data-reader-illustration-file]', imageFiles(1));
        await oldUploadStarted;
        const preview = await (await fetch(`${servers.appUrl}/api/reader/import/file-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: firstPath }) })).json();
        assert.strictEqual(preview.ok, true);
        const reimport = await (await fetch(`${servers.appUrl}/api/reader/import/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: preview.draft.draftId, documentId: firstDocumentId }) })).json();
        assert.strictEqual(reimport.ok, true);
        assert.notStrictEqual(reimport.revisionId, beforeReimport.revisionId);
        let releaseReimportLoad;
        let signalReimportLoad;
        const reimportLoadFetched = new Promise(resolve => { signalReimportLoad = resolve; });
        let reimportLoadCount = 0;
        await page.route('**/api/reader/illustrations?**', async route => {
            reimportLoadCount += 1;
            if (reimportLoadCount > 1) return route.continue();
            const response = await route.fetch();
            signalReimportLoad();
            await new Promise(resolve => { releaseReimportLoad = resolve; });
            await route.fulfill({ response });
        });
        await page.evaluate(id => { window.__readerIllustrationReimportLoad = window.openReaderLibraryDocument(id); }, firstDocumentId);
        await reimportLoadFetched;
        assert.strictEqual(await page.evaluate(() => readerState.activeRevisionId), reimport.revisionId);
        releaseOldRevisionUpload();
        await page.waitForFunction(() => !readerState.illustrationBusy);
        releaseReimportLoad();
        await page.evaluate(() => window.__readerIllustrationReimportLoad);
        await page.unroute('**/api/reader/illustrations?**');
        await page.unroute('**/api/reader/illustrations');
        const finalRecord = await page.evaluate(() => readerState.illustrations.map(item => item.illustrationId));
        assert.ok(finalRecord.includes(legacy.illustration.illustrationId), 'a same-book reimport load must retain legacy images when an old-revision upload finishes');
        assert.strictEqual(finalRecord.length, beforeReimport.count + 1, 'a changed record must be reread after the old-revision upload succeeds');
        assert.strictEqual(reimportLoadCount, 2, 'the current revision must refresh the invalidated GET exactly once');

        let signalDiscardedLoad;
        let releaseDiscardedLoad;
        const discardedLoadFetched = new Promise(resolve => { signalDiscardedLoad = resolve; });
        let discardedLoadCount = 0;
        await page.route('**/api/reader/illustrations?**', async route => {
            if (new URL(route.request().url()).searchParams.get('documentId') !== firstDocumentId) return route.continue();
            discardedLoadCount += 1;
            if (discardedLoadCount > 1) return route.continue();
            const response = await route.fetch();
            signalDiscardedLoad();
            await new Promise(resolve => { releaseDiscardedLoad = resolve; });
            await route.fulfill({ response });
        });
        await page.evaluate(() => { window.__readerIllustrationDiscardedLoad = window.loadReaderIllustrationDocument(readerState.activeDocumentId); });
        await discardedLoadFetched;
        await page.setInputFiles('[data-reader-illustration-file]', imageFiles(1));
        await page.waitForFunction(count => !readerState.illustrationBusy && readerState.illustrations.length === count, finalRecord.length + 1);
        await page.evaluate(async id => { await window.openReaderLibraryDocument(id); }, secondDocumentId);
        releaseDiscardedLoad();
        await page.evaluate(() => window.__readerIllustrationDiscardedLoad);
        await page.unroute('**/api/reader/illustrations?**');
        assert.strictEqual(discardedLoadCount, 1, 'switching books must stop a stale load without retrying the old document');
        assert.strictEqual(await page.evaluate(() => readerState.illustrationRecord?.documentId), secondDocumentId);

        console.log('Illustrated reader UI tests passed (real PNG, ranges, viewer, compact/flow and delayed upload isolation).');
    } finally {
        if (browser) await browser.close();
        if (servers) servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error('Illustrated reader UI tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
