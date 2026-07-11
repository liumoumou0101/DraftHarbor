const { chromium } = require('playwright');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const dataRoot = process.env.APP_URL ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-smoke-'));
    const servers = process.env.APP_URL ? null : await startDesktopServers({
        appRoot: projectRoot,
        dataRoot,
        chooseBackupFolder: null,
        chooseProjectSaveFolder: null,
        openPath: null,
        revealPath: null
    });
    const fileUrl = process.env.APP_URL || servers.appUrl + '/desktop.html';

    console.log('Opening:', fileUrl);

    let browser = null;

    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        const consoleErrors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#desktop-root', { timeout: 10000 });
        await page.waitForSelector('[data-view-panel="bookshelf"]', { timeout: 10000 });

        const desktopReady = await page.evaluate(() => {
            const root = document.querySelector('#desktop-root');
            const bookshelf = document.querySelector('[data-view-panel="bookshelf"]');
            return Boolean(root && bookshelf && document.body.innerText.includes('书库'));
        });
        if (!desktopReady) {
            console.error('ERROR: desktop shell did not reach bookshelf state');
            process.exitCode = 2;
            return;
        }

        await page.waitForTimeout(1200);

        if (consoleErrors.length > 0) {
            console.error('Console errors were detected:');
            for (const error of consoleErrors) console.error('  -', error);
            process.exitCode = 3;
            return;
        }

        console.log('Smoke test passed: desktop shell loaded, bookshelf present, no console errors.');
    } catch (err) {
        console.error('Smoke test failed:', err.message || err);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (servers && typeof servers.close === 'function') servers.close();
    }
})();
