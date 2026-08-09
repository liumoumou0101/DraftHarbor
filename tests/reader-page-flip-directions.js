/* global DraftHarborReaderLayout, createReaderLocatorAt, loadLegacyReaderProjectProjection, loadReaderWorkspaceChapter, readerState, renderReader, renderReaderPages, renderReaderReading, setReaderDrawer */

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

async function recordPageFlip(page, key, direction, screenshotPath) {
    const previousIndex = await page.evaluate(() => readerState.pageIndex);
    const liveLayout = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.desktop-reader-page-deck > .desktop-reader-page'));
        if (pages.length < 2) return { gap: 0, pageWidth: pages[0]?.getBoundingClientRect().width || 0 };
        const first = pages[0].getBoundingClientRect();
        const second = pages[1].getBoundingClientRect();
        return {
            gap: second.left - first.right,
            pageWidth: first.width
        };
    });
    const previousStarts = await page.evaluate(() => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0));
    const previousCompletions = await page.evaluate(() => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0));
    await page.evaluate(() => {
        window.__readerPageFlipTestHook = (session) => { window.__readerPageFlipTestSession = session; };
    });

    await page.focus('[data-reader-content]');
    await page.keyboard.press(key);
    await page.waitForFunction(({ previousIndex, previousStarts, direction }) => (
        (direction === 'next' ? readerState.pageIndex > previousIndex : readerState.pageIndex < previousIndex)
        && document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipDirection === direction
        && Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0) > previousStarts
    ), { previousIndex, previousStarts, direction });
    const midFrame = await page.evaluate((expectedDirection) => {
        const session = window.__readerPageFlipTestSession;
        if (!session || session.direction !== expectedDirection) throw new Error(`Missing ${expectedDirection} StPageFlip test session`);
        const renderer = session.pageFlip.getRender();
        const animation = renderer.animation;
        if (!animation) throw new Error(`Missing ${expectedDirection} StPageFlip animation`);
        renderer.stop();
        renderer.render(animation.startedAt + animation.duration * 0.25);
        session.frozenAnimation = renderer.animation;
        renderer.animation = null;
        const turningSheet = Array.from(document.querySelectorAll('.desktop-reader-page-flip-sheet'))
            .find((sheet) => getComputedStyle(sheet).zIndex === '5');
        const animatedIndentedParagraph = turningSheet?.querySelector('p:not(:first-child)');
        const liveIndentedParagraph = document.querySelector('.desktop-reader-page-deck > .desktop-reader-page p:not(:first-child)');
        return {
            fallback: Boolean(document.querySelector('.desktop-reader-page-transition-layer')),
            active: Boolean(document.querySelector('[data-reader-content].is-reader-page-flip-active')),
            animatedPageWidth: turningSheet?.offsetWidth || 0,
            animatedTextIndent: Number.parseFloat(getComputedStyle(animatedIndentedParagraph).textIndent) || 0,
            liveTextIndent: Number.parseFloat(getComputedStyle(liveIndentedParagraph).textIndent) || 0,
            centerMask: getComputedStyle(document.querySelector('[data-reader-page-flip-host]'), '::after').content !== 'none',
            sheets: Array.from(document.querySelectorAll('.desktop-reader-page-flip-sheet')).map((sheet) => {
                const style = getComputedStyle(sheet);
                return {
                    classes: sheet.className,
                    display: style.display,
                    zIndex: style.zIndex,
                    clipPath: style.clipPath,
                    transform: style.transform
                };
            })
        };
    }, direction);
    await page.screenshot({ path: screenshotPath });
    await page.evaluate(() => {
        const renderer = window.__readerPageFlipTestSession.pageFlip.getRender();
        const animation = window.__readerPageFlipTestSession.frozenAnimation;
        renderer.animation = animation;
        if (animation) renderer.render(animation.startedAt + animation.duration + 1);
    });
    await page.waitForFunction((previous) => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0) > previous, previousCompletions);
    return { ...midFrame, liveLayout };
}

function assertRealCurl(frame, direction) {
    assert.strictEqual(frame.fallback, false, `${direction} must not render the legacy curl layer`);
    const turningSheet = frame.sheets.find((sheet) => sheet.zIndex === '5' && sheet.display !== 'none');
    assert.ok(frame.active && turningSheet && (
        turningSheet.clipPath !== 'none' || turningSheet.transform !== 'none'
    ), `${direction} must visibly deform a StPageFlip sheet`);
    assert.ok(turningSheet.classes.includes(direction === 'next' ? '--left' : '--right'), `${direction} must turn from the matching book edge`);
    assert.strictEqual(frame.centerMask, false, `${direction} must not cover the turning sheet with a center mask`);
    assert.ok(Math.abs(frame.animatedPageWidth - frame.liveLayout.pageWidth) <= 1,
        `${direction} animation sheet must keep the live page width (${frame.animatedPageWidth} vs ${frame.liveLayout.pageWidth})`);
    assert.ok(frame.liveTextIndent > 0 && Math.abs(frame.animatedTextIndent - frame.liveTextIndent) <= 1,
        `${direction} animation paragraphs must keep the live first-line indent (${frame.animatedTextIndent} vs ${frame.liveTextIndent})`);
}

async function stressPreviousPageFlips(page, turns = 8) {
    await page.evaluate(async () => {
        const secondChapter = readerState.contents[1];
        if (!secondChapter) throw new Error('Previous-page stress test requires two chapters');
        await loadReaderWorkspaceChapter(secondChapter.chapterId);
    });
    const setup = await page.evaluate((count) => {
        window.__readerPageFlipTestHook = null;
        const spreadSize = readerState.effectiveLayoutMode === 'double-page' ? 2 : 1;
        const target = Math.min(readerState.pages.length - spreadSize, Math.max(spreadSize * (count + 2), spreadSize));
        readerState.pageIndex = target - target % spreadSize;
        const position = DraftHarborReaderLayout.locatorPositionForPage(readerState.pages, readerState.pageIndex);
        readerState.anchorLocator = position ? createReaderLocatorAt(position.blockId, position.offset) : null;
        renderReaderPages(readerState.anchorLocator);
        return { pageCount: readerState.pages.length, pageIndex: readerState.pageIndex, spreadSize };
    }, turns);
    const availableTurns = Math.min(turns, Math.floor(setup.pageIndex / setup.spreadSize));

    for (let index = 0; index < availableTurns; index += 1) {
        const before = await page.evaluate(() => ({
            pageIndex: readerState.pageIndex,
            starts: Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0),
            completions: Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0)
        }));
        await page.focus('[data-reader-content]');
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction((snapshot) => readerState.pageIndex < snapshot.pageIndex
            && Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0) > snapshot.starts,
        before);
        await page.waitForFunction((snapshot) => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0) > snapshot.completions
            && document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle',
        before);
    }

    const boundary = await page.evaluate(() => ({
        chapterId: readerState.activeChapterId,
        starts: Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0),
        completions: Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0)
    }));
    await page.click('[data-reader-page-prev]');
    await page.waitForFunction((snapshot) => readerState.activeChapterId !== snapshot.chapterId
        && readerState.pageIndex > 0
        && Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0) > snapshot.starts,
    boundary);
    await page.waitForFunction((snapshot) => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0) > snapshot.completions
        && document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle',
    boundary);

    return page.evaluate(() => ({
        pageCount: readerState.pages.length,
        pageIndex: readerState.pageIndex,
        chapterId: readerState.activeChapterId,
        spread: document.querySelector('.desktop-reader-page-deck')?.dataset.readerSpread,
        visiblePages: document.querySelectorAll('.desktop-reader-page-deck > .desktop-reader-page').length,
        state: document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState
    }));
}

async function stressRapidPreviousPageFlips(page, turns = 5) {
    const setup = await page.evaluate(async () => {
        const secondChapter = readerState.contents[1];
        await loadReaderWorkspaceChapter(secondChapter.chapterId);
        readerState.pageIndex = 0;
        const position = DraftHarborReaderLayout.locatorPositionForPage(readerState.pages, 0);
        readerState.anchorLocator = position ? createReaderLocatorAt(position.blockId, position.offset) : null;
        renderReaderPages(readerState.anchorLocator);
        return { chapterId: readerState.activeChapterId };
    });
    await page.focus('[data-reader-content]');
    for (let index = 0; index < turns; index += 1) await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((snapshot) => readerState.activeChapterId !== snapshot.chapterId
        && !readerState.chapterPageTurnPromise
        && readerState.pendingPageDelta === 0
        && !readerState.pageTurnFrame
        && document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle',
    setup);
    return page.evaluate(() => ({
        chapterId: readerState.activeChapterId,
        pageIndex: readerState.pageIndex,
        pendingPageDelta: readerState.pendingPageDelta,
        sessionPending: Boolean(readerState.chapterPageTurnPromise),
        state: document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState
    }));
}

async function crossChapterForward(page) {
    const setup = await page.evaluate(async () => {
        await loadReaderWorkspaceChapter(readerState.contents[0].chapterId);
        const spreadSize = readerState.effectiveLayoutMode === 'double-page' ? 2 : 1;
        const target = readerState.effectiveLayoutMode === 'double-page'
            ? Math.max(0, readerState.pages.length - (readerState.pages.length % 2 || 2))
            : Math.max(0, readerState.pages.length - 1);
        const position = DraftHarborReaderLayout.locatorPositionForPage(readerState.pages, target);
        readerState.anchorLocator = position ? createReaderLocatorAt(position.blockId, position.offset) : null;
        readerState.pageIndex = target - target % spreadSize;
        renderReaderPages(readerState.anchorLocator);
        return {
            chapterId: readerState.activeChapterId,
            starts: Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0),
            completions: Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0)
        };
    });
    await page.click('[data-reader-page-next]');
    await page.waitForFunction((snapshot) => readerState.activeChapterId !== snapshot.chapterId
        && readerState.pageIndex === 0
        && Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipStarts || 0) > snapshot.starts,
    setup);
    await page.waitForFunction((snapshot) => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipCompletions || 0) > snapshot.completions
        && document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle',
    setup);
}

async function crossLegacyChapterPrevious(page) {
    await page.evaluate(() => {
        loadLegacyReaderProjectProjection({
            source: 'project',
            projectId: 'legacy-page-boundary',
            title: '旧项目连续翻页',
            chapters: [
                { id: 'legacy-1', title: '旧项目上章', content: Array.from({ length: 100 }, (_, index) => `旧项目上章第 ${index + 1} 段。用于验证跨章节左翻。`).join('\n\n') },
                { id: 'legacy-2', title: '旧项目下章', content: Array.from({ length: 100 }, (_, index) => `旧项目下章第 ${index + 1} 段。用于验证章节边界。`).join('\n\n') }
            ]
        });
        readerState.chapterIndex = 1;
        readerState.anchorLocator = null;
        readerState.pageIndex = 0;
        renderReader();
    });
    await page.waitForFunction(() => readerState.apiMode === false && readerState.chapterIndex === 1 && readerState.pageIndex === 0);
    await page.click('[data-reader-page-prev]');
    await page.waitForFunction(() => readerState.chapterIndex === 0
        && readerState.pageIndex > 0
        && document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle');
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-flip-directions-'));
    const fixturePath = path.join(dataRoot, 'flip-fixture.md');
    const normalScreenshot = path.join(dataRoot, 'normal.png');
    const nextScreenshot = path.join(dataRoot, 'next.png');
    const previousScreenshot = path.join(dataRoot, 'previous.png');
    let servers = null;
    let browser = null;

    try {
        await fs.writeFile(fixturePath, [
            '# 双向翻页测试·上章',
            '',
            ...Array.from({ length: 120 }, (_, index) => `上章第 ${index + 1} 段测试正文。这是一段足够长的阅读内容，用于稳定生成多个页面并检查左右两个方向的真实纸张翻页动画。`),
            '',
            '# 双向翻页测试·下章',
            '',
            ...Array.from({ length: 120 }, (_, index) => `下章第 ${index + 1} 段测试正文。这是一段足够长的阅读内容，用于稳定生成多个页面并检查连续向左翻页和跨章节动画。`)
        ].join('\n\n'), 'utf8');
        servers = await startDesktopServers({
            appRoot: path.resolve(__dirname, '..'),
            dataRoot,
            revealPath: async () => ''
        });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 2048, height: 1110 } });
        await page.goto(servers.appUrl + '/desktop.html', { waitUntil: 'domcontentloaded' });
        await page.click('[data-view-target="reader"]');
        await page.setInputFiles('[data-reader-file]', fixturePath);
        await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]').open);
        await page.click('[data-reader-import-confirm]');
        await page.waitForFunction(() => readerState.currentChapter && readerState.currentChapter.blocks.length > 100);
        await page.evaluate(() => {
            readerState.layoutMode = 'double-page';
            readerState.pageTransition = 'curl';
            readerState.reducedMotionOverride = false;
            renderReaderReading({ locator: createReaderLocatorAt(readerState.currentChapter.blocks[0].blockId, 0) });
        });
        await page.waitForFunction(() => readerState.pages.length > 4
            && readerState.effectiveLayoutMode === 'double-page'
            && document.querySelectorAll('.desktop-reader-page-deck > .desktop-reader-page').length === 2);
        await page.evaluate(() => setReaderDrawer(''));
        await page.waitForTimeout(350);
        await page.screenshot({ path: normalScreenshot });

        const nextFrame = await recordPageFlip(page, 'ArrowRight', 'next', nextScreenshot);
        const previousFrame = await recordPageFlip(page, 'ArrowLeft', 'previous', previousScreenshot);
        assertRealCurl(nextFrame, 'next');
        assertRealCurl(previousFrame, 'previous');
        await crossChapterForward(page);
        const previousStress = await stressPreviousPageFlips(page);
        assert.strictEqual(previousStress.state, 'idle', 'repeated previous flips must release the animation session');
        assert.strictEqual(previousStress.spread, 'double', 'repeated previous flips must retain the double-page spread');
        assert.ok(previousStress.visiblePages >= 1 && previousStress.visiblePages <= 2,
            'repeated previous flips must retain a valid double-page spread at a chapter edge');
        const rapidPreviousStress = await stressRapidPreviousPageFlips(page);
        assert.strictEqual(rapidPreviousStress.pendingPageDelta, 0, 'rapid previous flips must drain queued input');
        assert.strictEqual(rapidPreviousStress.sessionPending, false, 'rapid previous flips must release chapter navigation');
        assert.strictEqual(rapidPreviousStress.state, 'idle', 'rapid previous flips must release the animation session');
        await crossLegacyChapterPrevious(page);

        console.log(JSON.stringify({
            normalScreenshot,
            nextScreenshot,
            previousScreenshot,
            previousStress,
            rapidPreviousStress
        }));
        console.log('Reader page-flip direction test passed.');
    } catch (error) {
        console.error('Reader page-flip direction test failed:', error && error.stack || error);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (servers) await servers.close();
    }
})();
