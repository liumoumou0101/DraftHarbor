const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

async function recordPageFlip(page, key, direction, screenshotPath) {
    const previousIndex = await page.evaluate(() => readerState.pageIndex);
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
        return {
            fallback: Boolean(document.querySelector('.desktop-reader-page-transition-layer')),
            active: Boolean(document.querySelector('[data-reader-content].is-reader-page-flip-active')),
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
    return midFrame;
}

function assertRealCurl(frame, direction) {
    assert.strictEqual(frame.fallback, false, `${direction} must not render the legacy curl layer`);
    const turningSheet = frame.sheets.find((sheet) => sheet.zIndex === '5' && sheet.display !== 'none');
    assert.ok(frame.active && turningSheet && (
        turningSheet.clipPath !== 'none' || turningSheet.transform !== 'none'
    ), `${direction} must visibly deform a StPageFlip sheet`);
    assert.ok(turningSheet.classes.includes(direction === 'next' ? '--left' : '--right'), `${direction} must turn from the matching book edge`);
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-flip-directions-'));
    const fixturePath = path.join(dataRoot, 'flip-fixture.md');
    const nextScreenshot = path.join(dataRoot, 'next.png');
    const previousScreenshot = path.join(dataRoot, 'previous.png');
    let servers = null;
    let browser = null;

    try {
        await fs.writeFile(fixturePath, [
            '# 双向翻页测试',
            '',
            ...Array.from({ length: 180 }, (_, index) => `第 ${index + 1} 段测试正文。这是一段足够长的阅读内容，用于稳定生成多个页面并检查左右两个方向的真实纸张翻页动画。`)
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

        const nextFrame = await recordPageFlip(page, 'ArrowRight', 'next', nextScreenshot);
        const previousFrame = await recordPageFlip(page, 'ArrowLeft', 'previous', previousScreenshot);
        assertRealCurl(nextFrame, 'next');
        assertRealCurl(previousFrame, 'previous');

        console.log(JSON.stringify({
            nextScreenshot,
            previousScreenshot
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
