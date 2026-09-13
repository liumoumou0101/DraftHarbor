/* global readerState, readerPositionSaveTimer, loadReaderLibrary, saveReaderWorkspacePosition, selectReaderLeftTab, updateReaderWorkspaceProgress */
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { createDesktopProtocolHandler } = require('../desktop/local-server');
const projectStore = require('../desktop/storage/project-file-store');

async function request(handler, pathname, method = 'GET', body) {
    const response = await handler(new Request(`draftharbor://app${pathname}`, {
        method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));
    const payload = await response.json();
    assert.strictEqual(response.status, 200, `${pathname}: ${JSON.stringify(payload)}`);
    return payload;
}

function position(book, chapterIndex, offset) {
    const chapter = book.chapters[chapterIndex];
    return { documentId: book.documentId, revisionId: book.revisionId, chapterId: chapter.chapterId, blockId: chapter.blocks[0].blockId, offset };
}

async function writePosition(handler, book, chapterIndex, offset) {
    return request(handler, '/api/reader/state', 'POST', {
        state: { documentId: book.documentId, positionLocator: position(book, chapterIndex, offset), updatedAt: new Date().toISOString() }
    });
}

async function prepareBrowser(browser, handler, book) {
    const context = await browser.newContext();
    const posts = [];
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/reader/')) {
            const method = route.request().method();
            const body = route.request().postDataJSON();
            if (url.pathname === '/api/reader/state' && method === 'POST') posts.push(body.state);
            const payload = await request(handler, url.pathname + url.search, method, body || undefined);
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
        } else {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<main data-reader-library></main><div data-reader-content></div>' });
        }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://reader.test/');
    for (const file of [
        'src/core/document/reader-library-view.js', 'src/core/document/reader-navigation.js',
        'src/core/document/reader-locator.js', 'src/core/document/reader-layout.js',
        'src/desktop/shell/reader-library.js', 'src/desktop/shell/reader-workspace.js', 'src/desktop/shell/reader-reading.js'
    ]) await page.addScriptTag({ content: await fs.readFile(path.join(__dirname, '..', file), 'utf8') });
    await page.evaluate(input => {
        window.readerState = {
            apiMode: true, activeDocumentId: input.documentId, activeRevisionId: input.revisionId,
            contents: input.chapters.map(chapter => ({ chapterId: chapter.chapterId, characterCount: chapter.blocks.reduce((sum, block) => sum + block.text.length, 0) })),
            libraryDocuments: [], leftTab: 'contents', effectiveLayoutMode: 'double-page', pageIndex: 0,
            documentRecordState: {}, preferenceOverrides: {}, r: 0
        };
        window.__setPosition = (chapterIndex, offset) => {
            readerState.currentChapter = input.chapters[chapterIndex];
            readerState.activeChapterId = readerState.currentChapter.chapterId;
            readerState.pages = window.DraftHarborReaderLayout.buildReaderPages(readerState.currentChapter, { capacity: 1000 });
            readerState.anchorLocator = {
                documentId: input.documentId, revisionId: input.revisionId, chapterId: readerState.activeChapterId,
                blockId: readerState.currentChapter.blocks[0].blockId, offset
            };
        };
        window.readerElements = () => ({ content: document.querySelector('[data-reader-content]') });
        window.__setPosition(0, 0);
    }, book);
    await page.evaluate(() => loadReaderLibrary());
    return { context, page, posts, errors };
}

async function cardProgress(page, documentId) {
    return page.evaluate(id => {
        const item = readerState.libraryDocuments.find(book => book.documentId === id);
        const card = [...document.querySelectorAll('.desktop-reader-library-card')].find(node => node.querySelector('h3').textContent === item.title);
        return { cached: item.reading.progress, displayed: Number(card.querySelector('progress').value), label: card.querySelector('.desktop-reader-card-progress span').textContent };
    }, documentId);
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-library-progress-'));
    let browser;
    let passed = 0;
    try {
        const config = { appRoot: path.resolve(__dirname, '..'), dataRoot, chooseBackupFolder: null, chooseProjectSaveFolder: null, openPath: null, revealPath: null };
        const handler = await createDesktopProtocolHandler(config);
        const preview = await request(handler, '/api/reader/import/paste-preview', 'POST', {
            draftId: 'progress-draft', format: 'md', title: 'Progress book',
            text: [100, 200, 300, 400].map((count, index) => `# Chapter ${index + 1}\n\n${String.fromCharCode(65 + index).repeat(count)}`).join('\n\n')
        });
        const imported = await request(handler, '/api/reader/import/confirm', 'POST', {
            draftId: preview.draft.draftId, documentId: 'progress-book', revisionId: 'progress-r1'
        });
        const chapters = await Promise.all(preview.draft.chapters.map(async chapter => (await request(handler,
            `/api/reader/chapter?documentId=${encodeURIComponent(imported.documentId)}&chapterId=${encodeURIComponent(chapter.chapterId)}`)).chapter));
        const book = { documentId: imported.documentId, revisionId: imported.revisionId, chapters };
        assert.deepStrictEqual(book.chapters.map(chapter => chapter.blocks.reduce((sum, block) => sum + block.text.length, 0)), [100, 200, 300, 400]);
        const initial = await request(handler, '/api/reader/documents');
        assert.strictEqual(initial.documents[0].reading.hasState, false);
        for (const [chapterIndex, offset, expected] of [[0, 0, 0], [0, 50, 5], [3, 200, 80], [3, 400, 100]]) {
            await writePosition(handler, book, chapterIndex, offset);
            const listed = await request(handler, '/api/reader/documents');
            assert.strictEqual(listed.documents[0].reading.progress, expected, 'library progress must include chapter weights and the saved character offset');
            assert.ok(!JSON.stringify(listed).includes('DDDDDDDDDD'), 'library summary must not expose chapter prose');
            assert.ok(!JSON.stringify(listed).includes(dataRoot), 'library summary must not expose storage paths');
        }
        console.log('PASS external book progress uses saved characters, including zero and 100 percent'); passed += 1;

        const reloaded = await createDesktopProtocolHandler(config);
        assert.strictEqual((await request(reloaded, '/api/reader/documents')).documents[0].reading.progress, 100);
        console.log('PASS a fresh protocol handler derives the same progress from persisted state'); passed += 1;

        const created = await projectStore.createProject(dataRoot, { id: 'progress-project', title: 'Project progress' });
        created.project.scenes[0].content = 'Project content at the end.';
        await projectStore.saveProject(dataRoot, created.project);
        const projectContents = (await request(handler, '/api/reader/contents?documentId=project:progress-project')).contents;
        const projectChapter = (await request(handler, `/api/reader/chapter?documentId=project:progress-project&chapterId=${encodeURIComponent(projectContents.chapters[0].chapterId)}`)).chapter;
        const last = projectChapter.blocks.at(-1);
        await request(handler, '/api/reader/state', 'POST', { state: {
            documentId: 'project:progress-project', updatedAt: new Date().toISOString(),
            positionLocator: { documentId: 'project:progress-project', revisionId: projectContents.revisionId, chapterId: projectChapter.chapterId, blockId: last.blockId, offset: last.text.length }
        } });
        assert.strictEqual((await request(handler, '/api/reader/documents')).documents.find(item => item.documentId === 'project:progress-project').reading.progress, 100);
        console.log('PASS projected project books also report their actual end locator as 100 percent'); passed += 1;

        browser = await chromium.launch({ headless: true });
        const cases = [
            ['successful position saves update cached and visible cards without reloading the library', async ({ page }) => {
                await page.evaluate(async () => { window.__setPosition(3, 400); await saveReaderWorkspacePosition(); selectReaderLeftTab('library'); });
                assert.deepStrictEqual(await cardProgress(page, book.documentId), { cached: 100, displayed: 100, label: '100%' });
            }],
            ['opening the library flushes pending progress once before its debounce fires', async ({ page, posts }) => {
                await page.evaluate(() => {
                    window.__setPosition(3, 400);
                    updateReaderWorkspaceProgress();
                    if (!readerPositionSaveTimer) throw new Error('the save debounce must actually be pending');
                    selectReaderLeftTab('library');
                });
                await page.waitForFunction(() => readerState.libraryDocuments.find(item => item.documentId === 'progress-book').reading.progress === 100);
                await page.waitForTimeout(550);
                assert.strictEqual(posts.length, 1, 'opening the library should cancel the delayed duplicate save');
                assert.deepStrictEqual(await cardProgress(page, book.documentId), { cached: 100, displayed: 100, label: '100%' });
            }],
            ['an older library response cannot overwrite progress saved while it was in flight', async ({ page }) => {
                await page.evaluate(() => {
                    const api = window.readerApi;
                    window.readerApi = async (url, options) => {
                        const payload = await api(url, options);
                        if (url === '/api/reader/documents') {
                            window.__oldListReady = true;
                            await new Promise(resolve => { window.__releaseList = resolve; });
                        }
                        return payload;
                    };
                    window.__oldList = loadReaderLibrary();
                });
                await page.waitForFunction(() => window.__oldListReady);
                await page.evaluate(async () => { window.__setPosition(3, 400); await saveReaderWorkspacePosition(); window.__releaseList(); await window.__oldList; });
                assert.deepStrictEqual(await cardProgress(page, book.documentId), { cached: 100, displayed: 100, label: '100%' });
            }],
            ['a save finishing after switching books updates its captured source book only', async ({ page }) => {
                await page.evaluate(() => {
                    const api = window.readerApi;
                    window.readerApi = async (url, options) => {
                        const payload = await api(url, options);
                        if (url === '/api/reader/state' && options?.method === 'POST') {
                            window.__savedReady = true;
                            await new Promise(resolve => { window.__releaseSave = resolve; });
                        }
                        return payload;
                    };
                    window.__setPosition(3, 400);
                    window.__saving = saveReaderWorkspacePosition();
                });
                await page.waitForFunction(() => window.__savedReady);
                await page.evaluate(async () => {
                    readerState.activeDocumentId = 'project:progress-project';
                    readerState.contents = [];
                    readerState.currentChapter = { chapterId: 'other', blocks: [{ blockId: 'other', text: 'other' }] };
                    readerState.leftTab = 'library';
                    window.__releaseSave(); await window.__saving;
                });
                assert.deepStrictEqual(await cardProgress(page, book.documentId), { cached: 100, displayed: 100, label: '100%' });
                assert.strictEqual(await page.evaluate(() => readerState.activeDocumentId), 'project:progress-project');
                assert.strictEqual(await page.evaluate(() => readerState.libraryDocuments.find(item => item.documentId === 'project:progress-project').reading.progress), 100);
            }],
            ['failed saves do not advertise unsaved progress on library cards', async ({ page }) => {
                await page.evaluate(async () => {
                    const api = window.readerApi;
                    window.readerApi = (url, options) => url === '/api/reader/state' ? Promise.reject(new Error('simulated failed save')) : api(url, options);
                    window.__setPosition(3, 400); await saveReaderWorkspacePosition();
                });
                assert.deepStrictEqual(await cardProgress(page, book.documentId), { cached: 0, displayed: 0, label: '0%' });
            }]
        ];
        for (const [name, run] of cases) {
            await writePosition(handler, book, 0, 0);
            const fixture = await prepareBrowser(browser, handler, book);
            try {
                await run(fixture);
                assert.deepStrictEqual(fixture.errors, []);
                console.log(`PASS ${name}`); passed += 1;
            } finally { await fixture.context.close(); }
        }
        await writePosition(handler, book, 3, 400);
        const reopened = await prepareBrowser(browser, reloaded, book);
        try { assert.deepStrictEqual(await cardProgress(reopened.page, book.documentId), { cached: 100, displayed: 100, label: '100%' }); }
        finally { await reopened.context.close(); }
        console.log('PASS a new page loads the persisted 100 percent into its rendered card'); passed += 1;
        console.log(`Reader library progress tests passed (${passed} cases, isolated storage and local protocol only).`);
    } finally {
        if (browser) await browser.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
