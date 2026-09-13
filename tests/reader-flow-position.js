/* global readerState renderReaderFlow createReaderLocatorAt captureReaderPositionLocator */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const fixture = `<!doctype html><style>
  body { margin: 0; }
  [data-reader-content] { width: 420px; height: 280px; margin: 36px 24px; padding: 8px 12px;
    overflow: auto; font: 20px/30px serif; scroll-behavior: auto; }
  [data-reader-block] { margin: 0 0 24px; white-space: pre-wrap; overflow-wrap: anywhere; }
  mark { background: #ffe48a; }
</style><div data-reader-content></div><p id="outside">Outside selection remains unchanged.</p>`;

async function prepare(page, sources) {
    await page.setContent(fixture);
    await page.evaluate(() => {
        window.readerState = {
            activeDocumentId: 'book', activeRevisionId: 'revision-1', activeChapterId: 'chapter-1',
            effectiveLayoutMode: 'flow', layoutMode: 'flow', textWidth: 420,
            fontSize: 20, lineHeight: 1.5, paragraphSpacing: 0.8,
            currentChapter: {
                chapterId: 'chapter-1', title: 'Chapter', order: 0,
                blocks: [{ blockId: 'long-block', type: 'paragraph', order: 0,
                    text: '海风越过堤岸，远处灯塔映着归航的船。旅人翻开笔记，继续记下今日见闻。'.repeat(220) }]
            }
        };
        const nativeRaf = window.requestAnimationFrame.bind(window);
        window.flowTestSettle = () => new Promise(resolve => nativeRaf(() => nativeRaf(resolve)));
        // Independent geometry oracle: walk rendered text nodes and measure the
        // selected code point. It never calls production offset/scroll helpers.
        window.flowTestCharacterRect = (offset, blockId = 'long-block') => {
            const block = document.querySelector(`[data-reader-block="${CSS.escape(blockId)}"]`);
            const text = block.textContent;
            let index = Math.max(0, Math.min(text.length - 1, offset));
            if (index > 0 && /[\uDC00-\uDFFF]/.test(text[index])) index -= 1;
            const length = String.fromCodePoint(text.codePointAt(index)).length;
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
            const nodes = [];
            let node;
            while ((node = walker.nextNode())) nodes.push(node);
            const point = globalOffset => {
                let remaining = globalOffset;
                for (const item of nodes) {
                    if (remaining < item.length || item === nodes[nodes.length - 1]) return [item, Math.min(item.length, remaining)];
                    remaining -= item.length;
                }
                throw new Error('No text node at the requested offset');
            };
            const range = document.createRange();
            range.setStart(...point(index));
            range.setEnd(...point(index + length));
            const rect = range.getBoundingClientRect();
            const content = document.querySelector('[data-reader-content]');
            return { top: rect.top, bottom: rect.bottom, targetTop: content.getBoundingClientRect().top + 8, lineHeight: 30 };
        };
    });
    for (const source of sources) await page.addScriptTag({ content: source });
    await page.evaluate(async () => { renderReaderFlow(null); await window.flowTestSettle(); });
}

const cases = [
    ['scroll capture and rerender resume inside a long paragraph', async page => {
        const result = await page.evaluate(async () => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = 1511;
            const before = content.scrollTop;
            const locator = captureReaderPositionLocator();
            const captured = window.flowTestCharacterRect(locator.offset);
            renderReaderFlow(locator);
            await window.flowTestSettle();
            return { locator, before, after: content.scrollTop, captured, restored: window.flowTestCharacterRect(locator.offset) };
        });
        assert.ok(result.locator.offset > 0, 'a paragraph extending above the viewport must not be captured at offset zero');
        assert.strictEqual(result.locator.blockId, 'long-block');
        assert.ok(Math.abs(result.captured.top - result.captured.targetTop) <= 32, 'capture should identify the visible text line');
        assert.ok(Math.abs(result.after - result.before) <= 32, 'restoring the captured locator may drift by at most one line');
        assert.ok(Math.abs(result.restored.top - result.restored.targetTop) <= 32);
    }],
    ['a given midpoint locator brings its line to the top of the viewport', async page => {
        const result = await page.evaluate(async () => {
            const text = readerState.currentChapter.blocks[0].text;
            const locator = createReaderLocatorAt('long-block', Math.floor(text.length * 0.53));
            renderReaderFlow(locator);
            await window.flowTestSettle();
            return { locator, scrollTop: document.querySelector('[data-reader-content]').scrollTop, rect: window.flowTestCharacterRect(locator.offset) };
        });
        assert.ok(result.scrollTop > 1000, 'midpoint navigation must not stop at the paragraph start');
        assert.ok(Math.abs(result.rect.top - result.rect.targetTop) <= 32, 'the requested character must be within one line of the target top');
    }],
    ['the terminal offset lands near the bottom rather than paragraph start', async page => {
        const result = await page.evaluate(async () => {
            const text = readerState.currentChapter.blocks[0].text;
            const locator = createReaderLocatorAt('long-block', text.length);
            renderReaderFlow(locator);
            await window.flowTestSettle();
            const content = document.querySelector('[data-reader-content]');
            return { offset: locator.offset, length: text.length, scrollTop: content.scrollTop, remaining: content.scrollHeight - content.clientHeight - content.scrollTop };
        });
        assert.strictEqual(result.offset, result.length);
        assert.ok(result.scrollTop > 1000);
        assert.ok(result.remaining <= 32, `terminal locator left ${result.remaining}px unread below the viewport`);
    }],
    ['Chinese and emoji capture stays on a grapheme boundary without changing selection', async page => {
        const result = await page.evaluate(async () => {
            const text = '海风🚢吹过码头，👩🏽‍💻记录e\u0301与🇨🇳旗帜，群岛之间仍有星光。'.repeat(240);
            readerState.currentChapter.blocks[0].text = text;
            renderReaderFlow(null);
            await window.flowTestSettle();
            const node = document.querySelector('[data-reader-block]').firstChild;
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, 4);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const selected = selection.toString();
            document.querySelector('[data-reader-content]').scrollTop = 1943;
            const locator = captureReaderPositionLocator();
            const unchanged = selection.toString() === selected && selection.anchorNode === node && selection.anchorOffset === 0 && selection.focusNode === node && selection.focusOffset === 4;
            const boundaries = [0, ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), item => item.index + item.segment.length)];
            const captured = window.flowTestCharacterRect(locator.offset);
            renderReaderFlow(locator);
            await window.flowTestSettle();
            return { offset: locator.offset, boundary: boundaries.includes(locator.offset), unchanged, captured, restored: window.flowTestCharacterRect(locator.offset) };
        });
        assert.ok(result.offset > 0);
        assert.ok(result.boundary, 'capture must not split a surrogate pair or emoji grapheme');
        assert.ok(result.unchanged, 'capture must use a private Range without touching the user selection');
        assert.ok(Math.abs(result.captured.top - result.captured.targetTop) <= 32);
        assert.ok(Math.abs(result.restored.top - result.restored.targetTop) <= 32);
    }],
    ['annotated mark/span text retains global offsets during capture and restore', async page => {
        const result = await page.evaluate(async () => {
            window.decorateReaderIllustrationBlockNode = node => {
                const characters = Array.from(node.textContent);
                node.replaceChildren();
                for (let index = 0; index < characters.length; index += 23) {
                    const wrapper = document.createElement(index % 46 ? 'mark' : 'span');
                    const nested = document.createElement('span');
                    nested.textContent = characters.slice(index, index + 23).join('');
                    wrapper.appendChild(nested);
                    node.appendChild(wrapper);
                }
            };
            renderReaderFlow(null);
            await window.flowTestSettle();
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = 2357;
            const before = content.scrollTop;
            const locator = captureReaderPositionLocator();
            const originalText = readerState.currentChapter.blocks[0].text;
            renderReaderFlow(locator);
            await window.flowTestSettle();
            const restoredTop = content.scrollTop;
            const textIntact = content.querySelector('[data-reader-block]').textContent === originalText;
            const middle = createReaderLocatorAt('long-block', 4001);
            renderReaderFlow(middle);
            await window.flowTestSettle();
            return { offset: locator.offset, before, restoredTop, textIntact, nestedCount: content.querySelectorAll('mark span').length, rect: window.flowTestCharacterRect(middle.offset) };
        });
        assert.ok(result.nestedCount > 5);
        assert.ok(result.offset > 100, 'capture offset must include all preceding text nodes, not restart in the current mark');
        assert.ok(result.textIntact);
        assert.ok(Math.abs(result.restoredTop - result.before) <= 32);
        assert.ok(Math.abs(result.rect.top - result.rect.targetTop) <= 32);
    }],
    ...[false, true].map(changeChapter => [changeChapter ? 'an old RAF cannot scroll the newly selected chapter' : 'an old RAF cannot override a later render in the same chapter', async page => {
        const result = await page.evaluate(async switchChapter => {
            let nextFrame = 0;
            const queued = new Map();
            window.requestAnimationFrame = callback => { const id = ++nextFrame; queued.set(id, callback); return id; };
            window.cancelAnimationFrame = id => queued.delete(id);
            const text = readerState.currentChapter.blocks[0].text;
            renderReaderFlow(createReaderLocatorAt('long-block', Math.floor(text.length * 0.8)));
            if (switchChapter) {
                readerState.activeChapterId = 'chapter-2';
                readerState.currentChapter = { chapterId: 'chapter-2', title: 'New chapter', blocks: [{ blockId: 'long-block', type: 'paragraph', order: 0, text }] };
            }
            const latest = createReaderLocatorAt('long-block', Math.floor(text.length * 0.2));
            renderReaderFlow(latest);
            // Intentionally run the old anchor callback last. Any outdated job
            // must be cancelled or rejected before it can change the new view.
            while (queued.size) {
                const jobs = [...queued.entries()].reverse();
                queued.clear();
                jobs.forEach(([, callback]) => callback(performance.now()));
            }
            return { chapterId: readerState.activeChapterId, rect: window.flowTestCharacterRect(latest.offset) };
        }, changeChapter);
        assert.strictEqual(result.chapterId, changeChapter ? 'chapter-2' : 'chapter-1');
        assert.ok(Math.abs(result.rect.top - result.rect.targetTop) <= 32, 'an obsolete scheduled anchor must not move the latest destination');
    }])
];

(async () => {
    const files = ['src/core/document/reader-document-schema.js', 'src/core/document/reader-locator.js', 'src/core/document/reader-layout.js', 'src/desktop/shell/reader-reading.js'];
    const sources = await Promise.all(files.map(file => fs.readFile(path.join(__dirname, '..', file), 'utf8')));
    const browser = await chromium.launch({ headless: true });
    let failures = 0;
    try {
        for (const [name, run] of cases) {
            const context = await browser.newContext();
            await context.route('**/*', route => route.abort());
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            try {
                await prepare(page, sources);
                await run(page);
                assert.deepStrictEqual(errors, [], 'real reader scripts must not emit unexpected DOM errors');
                console.log(`PASS ${name}`);
            } catch (error) {
                failures += 1;
                console.error(`FAIL ${name}: ${error.stack || error}`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
    assert.strictEqual(failures, 0, `${failures} reader flow position case(s) failed`);
    console.log(`Reader flow position tests passed (${cases.length} cases, no API requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
