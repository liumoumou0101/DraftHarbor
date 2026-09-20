const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

const root = path.resolve(__dirname, '..');
const materials = ['flat', 'soft', 'grain', 'fiber', 'aged', 'xuan', 'ruled', 'grid', 'canvas'];
const fractions = [0, 0.25, 0.5, 0.75, 0.95];
const auditDirectory = path.join(root, '.ai_state', 'audits', '2026-09-17-reader-page-flip-materials');
const auditLabel = (process.env.READER_MATERIAL_AUDIT_LABEL || 'current').replace(/[^a-z0-9_-]/gi, '');
const fixture = `<!doctype html><meta charset="utf-8">
${['desktop-foundation', 'reader', 'reader-hud', 'reader-appearance'].map(name => `<link rel="stylesheet" href="/src/styles/desktop/${name}.css">`).join('\n')}
<div class="desktop-reader-shell"><div class="desktop-reader-stage" data-reader-material="flat" data-reader-paper-shadow="true" style="width:1100px;height:760px;--reader-font-family:serif;--reader-font-size:18px;--reader-page-margin:48px">
<main class="desktop-reader-content" data-reader-content data-reader-layout="double-page"><div class="desktop-reader-page-deck" data-reader-spread="double"></div></main>
<div class="desktop-reader-page-flip-host" data-reader-page-flip-host hidden></div></div></div>
${['src/core/document/reader-transition.js', 'src/vendor/page-flip-2.0.7/page-flip.browser.js', 'src/desktop/shell/reader-page-flip.js', 'src/desktop/shell/reader-reading.js'].map(file => `<script src="/${file}"></script>`).join('\n')}`;

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-flip-materials-'));
    let servers;
    let browser;
    const mismatches = new Set();
    let checkedSheets = 0;
    const compare = (expected, surfaces, label) => {
        assert.ok(surfaces.length, `${label}: actual animation sheets must exist`);
        for (const surface of surfaces) {
            checkedSheets += 1;
            for (const property of ['backgroundImage', 'backgroundSize', 'backgroundColor']) {
                if (surface[property] !== expected[property]) mismatches.add(`${label}: ${property}`);
            }
        }
    };
    try {
        await fs.mkdir(auditDirectory, { recursive: true });
        servers = await startDesktopServers({ appRoot: root, dataRoot, revealPath: async () => '' });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/reader-material-fixture.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
        await page.goto(`${servers.appUrl}/reader-material-fixture.html`, { waitUntil: 'networkidle' });
        await page.evaluate(() => {
            window.readerState = { pageTransition: 'curl' };
            window.materialSurfaceSnapshot = selector => Array.from(document.querySelectorAll(selector)).map(sheet => {
                const style = getComputedStyle(sheet);
                return { backgroundImage: style.backgroundImage, backgroundSize: style.backgroundSize,
                    backgroundColor: style.backgroundColor, visible: style.display !== 'none',
                    static: sheet.classList.contains('--simple'), turning: style.zIndex === '5' };
            });
        });
        for (const material of materials) for (const spread of ['single', 'double']) for (const direction of [-1, 1]) {
            const label = `${material}/${spread}/${direction < 0 ? 'previous' : 'next'}`;
            const audit = ['ruled', 'grid'].includes(material) && spread === 'double' && direction === 1;
            const live = await page.evaluate(({ material, spread }) => {
                const stage = document.querySelector('.desktop-reader-stage');
                const content = document.querySelector('[data-reader-content]');
                const deck = content.firstElementChild;
                stage.dataset.readerMaterial = material;
                content.dataset.readerLayout = spread === 'double' ? 'double-page' : 'single-page';
                deck.dataset.readerSpread = spread;
                deck.style.cssText = `--reader-layout-page-width:420px;--reader-layout-deck-width:${spread === 'double' ? 868 : 420}px;--reader-layout-gap:28px`;
                deck.innerHTML = Array.from({ length: spread === 'double' ? 2 : 1 }, (_, index) => `<section class="desktop-reader-page"><h3 data-reader-block>纸张材质 · 第 ${index + 1} 页</h3><p data-reader-block>翻页前后，横线与纹理应保持一致。</p><p data-reader-block>海风越过堤岸，远处灯塔映着归航的船。</p></section>`).join('');
                return window.materialSurfaceSnapshot('.desktop-reader-page-deck > .desktop-reader-page')[0];
            }, { material, spread });
            assert.strictEqual(live.backgroundImage === 'none', material === 'flat', `${label}: the live fixture must display its selected texture`);
            if (audit) await page.screenshot({ path: path.join(auditDirectory, `${auditLabel}-${material}-live.png`) });
            const started = await page.evaluate(async direction => {
                const content = document.querySelector('[data-reader-content]');
                const deck = content.firstElementChild;
                let initialized;
                const ready = new Promise(resolve => { initialized = resolve; });
                window.__readerPageFlipTestHook = ({ pageFlip }) => {
                    window.materialFlipRenderer = pageFlip.getRender();
                    pageFlip.on('init', initialized);
                };
                const started = window.startReaderPageFlip({ content, outgoingDeck: deck.cloneNode(true), incomingDeck: deck, direction, durationMs: 10000 });
                if (!started) return false;
                await ready;
                window.materialFlipRenderer.stop();
                window.materialFlipAnimation = window.materialFlipRenderer.animation;
                return !!window.materialFlipAnimation;
            }, direction);
            assert.strictEqual(started, true, `${label}: the real vendored PageFlip engine must animate`);
            for (const fraction of fractions) {
                const surfaces = await page.evaluate(fraction => {
                    const renderer = window.materialFlipRenderer;
                    const animation = window.materialFlipAnimation;
                    renderer.animation = animation;
                    renderer.render(animation.startedAt + animation.duration * fraction);
                    renderer.animation = null;
                    return window.materialSurfaceSnapshot('.desktop-reader-page-flip-sheet');
                }, fraction);
                assert.ok(surfaces.some(sheet => sheet.visible), `${label}/${fraction}: visible sheets must be rendered`);
                if (fraction === 0.25) assert.ok(surfaces.some(sheet => sheet.visible && sheet.turning), `${label}: a real turning sheet must be sampled`);
                if (spread === 'double') assert.ok(surfaces.some(sheet => sheet.visible && sheet.static), `${label}: static sheets must also retain their texture`);
                compare(live, surfaces, `${label}/curl-${fraction}`);
                if (audit && fraction === 0.25) await page.screenshot({ path: path.join(auditDirectory, `${auditLabel}-${material}-curl-25.png`) });
            }
            const fallback = await page.evaluate(direction => {
                window.stopReaderPageFlip();
                const content = document.querySelector('[data-reader-content]');
                const deck = content.firstElementChild;
                const engine = window.St;
                // Exercise the production fallback for an unavailable engine.
                window.St = undefined;
                try { window.animateReaderPageTurn(direction, { outgoingDeck: deck.cloneNode(true), incomingDeck: deck }); }
                finally { window.St = engine; }
                const surfaces = window.materialSurfaceSnapshot('.desktop-reader-page-transition-layer > .desktop-reader-page-deck > .desktop-reader-page');
                window.stopReaderDeckTransition();
                return surfaces;
            }, direction);
            assert.strictEqual(fallback.length, spread === 'double' ? 4 : 2, `${label}: both fallback snapshots must be checked`);
            compare(live, fallback, `${label}/fallback`);
        }
        assert.deepStrictEqual(errors, [], 'real reader styles and animation scripts must not emit runtime errors');
        assert.strictEqual(mismatches.size, 0, `Paper material changed during animation (${mismatches.size} checks):\n${[...mismatches].slice(0, 24).join('\n')}`);
        console.log(`Reader page-flip materials passed: 9 materials, 2 layouts, 2 directions, 5 frames, fallback snapshots, ${checkedSheets} sheets.`);
        console.log(`Material audit screenshots: ${auditDirectory}`);
    } finally {
        if (browser) await browser.close();
        if (servers) await servers.close();
        assert.strictEqual(path.dirname(path.resolve(dataRoot)), path.resolve(os.tmpdir()));
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
