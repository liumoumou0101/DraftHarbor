const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Navigation = require('../src/core/document/reader-navigation');
const Locator = require('../src/core/document/reader-locator');
const Layout = require('../src/core/document/reader-layout');

const source = file => fs.readFileSync(path.join(__dirname, '../src/desktop/shell', file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const chapter = (id, text = 'Harbor text') => ({
    chapterId: id, title: id, blocks: [{ blockId: `${id}-block`, type: 'paragraph', text }]
});

function fixture() {
    const requests = [];
    const renders = [];
    const frames = [];
    const history = [];
    const errors = [];
    const content = {
        textContent: 'Current book remains visible', scrollTop: 14, scrollHeight: 1000, clientHeight: 100,
        style: {}, querySelector: () => ({ cloneNode: () => ({}) })
    };
    const context = {
        console, URL, AbortController, Map, Date, CSS: { escape: value => value },
        readerState: {
            r: 0, apiMode: true, activeDocumentId: 'book-a', activeRevisionId: 'revision-a',
            activeChapterId: 'a1', currentChapter: chapter('a1'), documentMetadata: { title: 'Book A' },
            contents: ['a1', 'a2', 'a3'].map(chapterId => ({ chapterId, title: chapterId, characterCount: 100 })),
            documentRecordState: {}, preferenceOverrides: {}, pageIndex: 0, pages: [], effectiveLayoutMode: 'flow',
            searchRequestId: 0, searchResults: [], searchStatus: 'idle', searchAbortController: null,
            annotations: [], annotationResolutions: new Map(), annotationRecordUpdatedAt: '',
            historyItems: [], historyCursor: -1, historyRecordUpdatedAt: ''
        },
        document: {
            querySelector: selector => {
                if (selector === '[data-reader-content]') return content;
                if (selector === '[data-reader-content] .desktop-reader-page-deck') return { cloneNode: () => ({}) };
                return null;
            },
            querySelectorAll: () => [], contains: () => false
        },
        setTimeout, clearTimeout,
        requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
        readerApi: (url, options = {}) => new Promise((resolve, reject) => {
            const parsed = new URL(url, 'http://reader.invalid');
            requests.push({ path: parsed.pathname, params: parsed.searchParams, options, resolve, reject, settled: false });
        }),
        DraftHarborReaderNavigation: Navigation, DraftHarborReaderLocator: Locator, DraftHarborReaderLayout: Layout,
        renderReaderBookmarks: () => {}, refreshReaderBookmarkResolutions: () => {},
        readerTtsPauseForNavigation: () => {}, applyReaderPreferenceModel: () => {}
    };
    context.window = context;
    vm.createContext(context);
    for (const file of ['reader-navigation.js', 'reader-workspace.js', 'reader-page-flip.js']) {
        vm.runInContext(source(file), context, { filename: file });
    }
    context.renderReaderWorkspace = () => renders.push({
        documentId: context.readerState.activeDocumentId, revisionId: context.readerState.activeRevisionId,
        chapterId: context.readerState.activeChapterId, chapter: context.readerState.currentChapter
    });
    context.renderReaderSearchResults = () => {};
    context.readerSetNavigationStatus = (kind, message) => errors.push({ kind, message });
    context.setReaderDrawer = () => {};
    context.captureReaderPositionLocator = () => null;
    context.saveReaderWorkspacePosition = async () => {};
    context.recordReaderPositionHistory = async locator => history.push(locator);
    const updateProgress = context.updateReaderWorkspaceProgress;
    context.updateReaderWorkspaceProgress = () => {};
    let animations = 0;
    context.animateReaderPageTurn = () => { animations += 1; };
    context.renderReaderPages = () => { throw new Error('Stale navigation must not repaginate the new chapter.'); };

    function pending(endpoint, params = {}) {
        const request = requests.find(item => !item.settled && item.path === `/api/reader/${endpoint}`
            && Object.entries(params).every(([name, value]) => item.params.get(name) === value));
        assert.ok(request, `missing pending request ${endpoint} ${JSON.stringify(params)}`);
        return request;
    }
    async function respond(endpoint, params, payload, error) {
        const request = pending(endpoint, params);
        request.settled = true;
        if (error) request.reject(error);
        else request.resolve(payload);
        await tick();
    }
    async function respondBook(documentId, revisionId, chapterId) {
        await respond('document', { documentId }, { metadata: { title: documentId, activeRevisionId: revisionId } });
        await respond('contents', { documentId }, { contents: { chapters: [{ chapterId, title: chapterId, characterCount: 100 }] } });
        await respond('state', { documentId }, { state: { documentId, bookmarks: [] } });
        await respond('chapter', { documentId, chapterId }, { chapter: chapter(chapterId) });
    }
    const flushFrames = () => { const current = frames.splice(0); current.forEach(callback => callback()); };
    return { context, state: context.readerState, requests, renders, frames, history, errors, content, pending, respond, respondBook, flushFrames, updateProgress, animations: () => animations };
}

const tests = [
    ['the latest chapter click wins when responses arrive out of order', async () => {
        const f = fixture();
        const first = f.context.loadReaderWorkspaceChapter('a2');
        const latest = f.context.loadReaderWorkspaceChapter('a3');
        await f.respond('chapter', { chapterId: 'a3' }, { chapter: chapter('a3') });
        assert.strictEqual(await latest, true);
        await f.respond('chapter', { chapterId: 'a2' }, { chapter: chapter('a2') });
        assert.strictEqual(await first, false);
        assert.strictEqual(f.state.activeChapterId, 'a3');
        assert.deepStrictEqual(f.renders.map(item => item.chapterId), ['a3']);
    }],
    ['stale errors are ignored while a current error remains actionable', async () => {
        const f = fixture();
        const first = f.context.loadReaderWorkspaceChapter('a2');
        const latest = f.context.loadReaderWorkspaceChapter('a3');
        await f.respond('chapter', { chapterId: 'a3' }, { chapter: chapter('a3') });
        await latest;
        await f.respond('chapter', { chapterId: 'a2' }, null, new Error('obsolete failure'));
        assert.strictEqual(await first, false);
        const current = f.context.loadReaderWorkspaceChapter('missing');
        const rejection = assert.rejects(current, /current failure/);
        await f.respond('chapter', { chapterId: 'missing' }, null, new Error('current failure'));
        await rejection;
        assert.strictEqual(f.state.activeChapterId, 'a3');
    }],
    ['a revision change invalidates a pending chapter without reusing its locator', async () => {
        const f = fixture();
        const pending = f.context.loadReaderWorkspaceChapter('a2');
        f.state.activeRevisionId = 'revision-a-new';
        await f.respond('chapter', { chapterId: 'a2' }, { chapter: chapter('a2') });
        assert.strictEqual(await pending, false);
        assert.strictEqual(f.state.activeChapterId, 'a1');
        assert.strictEqual(f.renders.length, 0);
    }],
    ['opening a book commits its identity and chapter atomically', async () => {
        const f = fixture();
        const oldChapter = f.context.loadReaderWorkspaceChapter('a2');
        const opening = f.context.openReaderLibraryDocument('book-b');
        await tick();
        await f.respond('document', { documentId: 'book-b' }, { metadata: { title: 'B', activeRevisionId: 'revision-b' } });
        await f.respond('contents', { documentId: 'book-b' }, { contents: { chapters: [{ chapterId: 'b1' }] } });
        await f.respond('state', { documentId: 'book-b' }, { state: { documentId: 'book-b' } });
        assert.strictEqual(f.state.activeDocumentId, 'book-a', 'the visible old chapter retains its old identity until the new chapter is ready');
        await f.respond('chapter', { documentId: 'book-b' }, { chapter: chapter('b1') });
        assert.strictEqual(await opening, true);
        await f.respond('chapter', { documentId: 'book-a', chapterId: 'a2' }, { chapter: chapter('a2') });
        assert.strictEqual(await oldChapter, false);
        assert.strictEqual(f.state.activeDocumentId, 'book-b');
        assert.strictEqual(f.state.activeChapterId, 'b1');
        assert.ok(f.renders.every(item => item.documentId === 'book-b' && item.revisionId === 'revision-b' && item.chapter.chapterId === 'b1'));
    }],
    ['a superseded book open cannot show an obsolete error over the latest book', async () => {
        const f = fixture();
        const first = f.context.openReaderLibraryDocument('book-b');
        await tick();
        const latest = f.context.openReaderLibraryDocument('book-c');
        await tick();
        await f.respondBook('book-c', 'revision-c', 'c1');
        assert.strictEqual(await latest, true);
        await f.respond('document', { documentId: 'book-b' }, null, new Error('obsolete book error'));
        assert.strictEqual(await first, false);
        assert.strictEqual(f.state.activeDocumentId, 'book-c');
        assert.ok(!f.content.textContent.includes('obsolete'));
        assert.ok(!f.requests.some(item => item.path === '/api/reader/chapter' && item.params.get('documentId') === 'book-b'));
    }],
    ['explicit project bridge tokens remain valid throughout an open', async () => {
        const f = fixture();
        f.state.r = 42;
        const opening = f.context.openReaderLibraryDocument('project:p', 42);
        await tick();
        await f.respondBook('project:p', 'project-revision', 'project-chapter');
        assert.strictEqual(await opening, true);
        assert.strictEqual(f.state.r, 42, 'nested work must not invalidate the bridge token');
        const count = f.requests.length;
        assert.strictEqual(await f.context.openReaderLibraryDocument('obsolete-project', 41), false);
        assert.strictEqual(f.requests.length, count);
    }],
    ['an older progress request cannot override a later chapter click', async () => {
        const f = fixture();
        const progress = f.context.navigateReaderToBookRatio(1);
        const click = f.context.loadReaderWorkspaceChapter('a2');
        await f.respond('chapter', { chapterId: 'a2' }, { chapter: chapter('a2') });
        await click;
        await f.respond('chapter', { chapterId: 'a3' }, { chapter: chapter('a3') });
        assert.strictEqual(await progress, false);
        assert.strictEqual(f.state.activeChapterId, 'a2');
        assert.strictEqual(f.requests.length, 2, 'the superseded progress request must not initiate its final chapter load');
    }],
    ['a pending progress frame cannot scroll a newly selected chapter', async () => {
        const f = fixture();
        const progress = f.context.navigateReaderToBookRatio(1);
        await f.respond('chapter', { chapterId: 'a3' }, { chapter: chapter('a3') });
        await f.respond('chapter', { chapterId: 'a3' }, { chapter: chapter('a3') });
        assert.ok(f.frames.length > 0);
        const latest = f.context.loadReaderWorkspaceChapter('a2');
        await f.respond('chapter', { chapterId: 'a2' }, { chapter: chapter('a2') });
        await latest;
        f.content.scrollTop = 22;
        f.flushFrames();
        assert.strictEqual(await progress, false);
        assert.strictEqual(f.content.scrollTop, 22);
    }],
    ['a single-page final chapter reports its locator progress through the end of the book', async () => {
        for (const mode of ['single-page', 'double-page']) {
            const f = fixture();
            vm.runInContext(source('reader-reading.js'), f.context, { filename: 'reader-reading.js' });
            const elements = { content: f.content, progress: {}, progressPercent: {}, positionLabel: {} };
            f.context.readerElements = () => elements;
            f.context.setTimeout = () => null;
            f.context.updateReaderWorkspaceProgress = f.updateProgress;
            f.context.renderReaderWorkspace = () => {
                f.state.pages = Layout.buildReaderPages(f.state.currentChapter, { capacity: 128 });
            };
            f.state.effectiveLayoutMode = mode;
            const finalChapter = chapter('a3', 'x'.repeat(100));
            const navigation = f.context.navigateReaderToBookRatio(1);
            await f.respond('chapter', { chapterId: 'a3' }, { chapter: finalChapter });
            await f.respond('chapter', { chapterId: 'a3' }, { chapter: finalChapter });
            f.flushFrames();
            assert.strictEqual(await navigation, true);
            assert.strictEqual(f.state.pages.length, 1, `${mode}: the final chapter must fit on one page`);
            assert.strictEqual(f.state.pageIndex, 0);
            assert.strictEqual(f.state.anchorLocator.offset, 100);
            assert.strictEqual(elements.positionLabel.textContent, '本章 100% · 全书 100%');
            assert.strictEqual(elements.progress.value, 100);
            assert.strictEqual(elements.progressPercent.textContent, '100%');
            f.state.anchorLocator = { ...f.state.anchorLocator, offset: 50 };
            f.updateProgress();
            assert.strictEqual(elements.positionLabel.textContent, '本章 50% · 全书 83%', `${mode}: page zero must still reflect an interior character locator`);
            f.state.effectiveLayoutMode = 'flow';
            f.content.scrollTop = 225;
            f.updateProgress();
            assert.strictEqual(elements.positionLabel.textContent, '本章 25% · 全书 75%', 'flow progress keeps using its current scroll ratio');
        }
    }],
    ['queued page-turn frames cannot act after the chapter, navigation, or layout changes', async () => {
        for (const change of ['chapter', 'navigation', 'flow', 'double-page']) {
            const f = fixture();
            vm.runInContext(source('reader-reading.js'), f.context, { filename: 'reader-reading.js' });
            const rendered = [];
            f.context.renderReaderPages = locator => { rendered.push(locator); return {}; };
            f.context.animateReaderPageTurn = () => {};
            f.context.updateReaderWorkspaceProgress = () => {};
            f.context.createReaderLocatorAt = (blockId, offset) => ({ blockId, offset });
            Object.assign(f.state, {
                currentChapter: chapter('a1', 'x'.repeat(500)), effectiveLayoutMode: 'single-page',
                pendingPageDelta: 0, pageTurnFrame: null, chapterPageTurnPromise: null
            });
            f.state.pages = Layout.buildReaderPages(f.state.currentChapter, { capacity: 128 });
            f.context.queueReaderPageTurn(1);
            assert.strictEqual(f.frames.length, 1, `${change}: an old page-turn frame must actually be pending`);
            // A later navigation/render becomes authoritative before the queued
            // frame gets CPU time. Run the two frames in that controlled order.
            f.context.requestAnimationFrame(() => {
                if (change === 'chapter') {
                    f.state.currentChapter = chapter('new', 'n'.repeat(500));
                    f.state.activeChapterId = 'new';
                    f.state.pages = Layout.buildReaderPages(f.state.currentChapter, { capacity: 128 });
                } else if (change === 'navigation') f.state.r += 1;
                else f.state.effectiveLayoutMode = change;
                f.state.pageIndex = 2;
                f.content.scrollTop = 42;
            });
            f.frames.pop()();
            f.flushFrames();
            assert.strictEqual(f.state.pageIndex, 2, `${change}: stale turns must not advance the current page`);
            assert.strictEqual(f.content.scrollTop, 42, `${change}: stale turns must not scroll current content`);
            assert.strictEqual(rendered.length, 0, `${change}: stale turns must not render a new spread`);
            assert.strictEqual(f.requests.length, 0, `${change}: stale turns must not start a cross-chapter request`);
            assert.strictEqual(f.state.pendingPageDelta, 0, `${change}: stale input must be discarded`);
            assert.strictEqual(f.state.pageTurnFrame, null, `${change}: the stale scheduler lock must be released`);
            f.state.effectiveLayoutMode = 'single-page';
            f.context.queueReaderPageTurn(1);
            f.flushFrames();
            assert.strictEqual(f.state.pageIndex, 3, `${change}: a subsequent current input must still work`);
            assert.strictEqual(rendered.length, 1);
        }
    }],
    ['queued flow-window shifts cannot redraw after the chapter, navigation, or layout changes', async () => {
        const longChapter = id => ({ chapterId: id, blocks: Array.from({ length: 100 }, (_, i) => ({ blockId: `${id}-${i}`, text: 'paragraph' })) });
        for (const change of ['chapter', 'navigation', 'single-page']) {
            const f = fixture();
            vm.runInContext(source('reader-reading.js'), f.context, { filename: 'reader-reading.js' });
            const rendered = [];
            f.context.renderReaderFlow = locator => { rendered.push(locator); f.content.scrollTop = 0; };
            f.context.createReaderLocatorAt = (blockId, offset) => ({ blockId, offset });
            Object.assign(f.state, {
                currentChapter: longChapter('old'), effectiveLayoutMode: 'flow', virtualWindow: { start: 0, end: 73 }
            });
            f.content.scrollTop = 810;
            f.context.maybeShiftReaderFlowWindow();
            assert.strictEqual(f.frames.length, 1, `${change}: an old flow-window frame must actually be pending`);
            f.context.requestAnimationFrame(() => {
                if (change === 'chapter') f.state.currentChapter = longChapter('new');
                else if (change === 'navigation') f.state.r += 1;
                else f.state.effectiveLayoutMode = change;
                f.content.scrollTop = 720;
            });
            f.frames.pop()();
            f.flushFrames();
            assert.strictEqual(rendered.length, 0, `${change}: obsolete virtual windows must not replace current content`);
            assert.strictEqual(f.content.scrollTop, 720, `${change}: obsolete shifts must leave current scrolling unchanged`);
            f.state.effectiveLayoutMode = 'flow';
            f.context.maybeShiftReaderFlowWindow();
            f.flushFrames();
            assert.strictEqual(rendered.length, 1, `${change}: a subsequent current flow-window shift must still work`);
            const expectedChapter = change === 'chapter' ? 'new' : 'old';
            assert.ok(rendered[0].blockId.startsWith(`${expectedChapter}-`));
        }
    }],
    ['revision snapshots retain their captured document and do not evict a newer cache', async () => {
        const f = fixture();
        f.state.contents = f.state.contents.slice(0, 2);
        const old = f.context.readerRevisionSnapshot();
        const oldRejection = assert.rejects(old, /old snapshot error/);
        Object.assign(f.state, { activeDocumentId: 'book-b', activeRevisionId: 'revision-b', contents: [{ chapterId: 'b1' }] });
        const latest = f.context.readerRevisionSnapshot();
        await f.respond('chapter', { documentId: 'book-a', chapterId: 'a1' }, { chapter: chapter('a1') });
        assert.strictEqual(f.pending('chapter', { chapterId: 'a2' }).params.get('documentId'), 'book-a');
        await f.respond('chapter', { documentId: 'book-a', chapterId: 'a2' }, null, new Error('old snapshot error'));
        await oldRejection;
        await f.respond('chapter', { documentId: 'book-b' }, { chapter: chapter('b1') });
        const revision = await latest;
        assert.strictEqual(revision.revisionId, 'revision-b');
        const count = f.requests.length;
        assert.strictEqual((await f.context.readerRevisionSnapshot()).chapters[0].chapterId, 'b1');
        assert.strictEqual(f.requests.length, count, 'a valid newer snapshot stays cached');
    }],
    ['a failed current revision snapshot can be retried', async () => {
        const f = fixture();
        f.state.contents = f.state.contents.slice(0, 1);
        const first = f.context.readerRevisionSnapshot();
        const rejection = assert.rejects(first, /retryable/);
        await f.respond('chapter', { chapterId: 'a1' }, null, new Error('retryable'));
        await rejection;
        const retry = f.context.readerRevisionSnapshot();
        await f.respond('chapter', { chapterId: 'a1' }, { chapter: chapter('a1') });
        assert.strictEqual((await retry).chapters[0].chapterId, 'a1');
        assert.strictEqual(f.requests.length, 2);
    }],
    ['locators from a different book are rejected before starting navigation', async () => {
        const f = fixture();
        assert.strictEqual(await f.context.navigateReaderToLocator({ documentId: 'book-b', revisionId: 'revision-a', chapterId: 'a2' }), false);
        assert.strictEqual(f.state.r, 0);
        assert.strictEqual(f.requests.length, 0);
    }],
    ['a slow locator revision resolution cannot replace a later chapter selection', async () => {
        const f = fixture();
        f.state.contents = f.state.contents.slice(0, 1);
        const old = f.context.navigateReaderToLocator({ documentId: 'book-a', revisionId: 'old-revision', chapterId: 'a1', blockId: 'a1-block', offset: 0 });
        const latest = f.context.loadReaderWorkspaceChapter('a2');
        await f.respond('chapter', { chapterId: 'a2' }, { chapter: chapter('a2') });
        await latest;
        await f.respond('chapter', { chapterId: 'a1' }, { chapter: chapter('a1') });
        assert.strictEqual(await old, false);
        assert.strictEqual(f.state.activeChapterId, 'a2');
        assert.strictEqual(f.requests.length, 2);
        assert.strictEqual(f.history.length, 0);
    }],
    ['search completion from the old book leaves the new search intact', async () => {
        const f = fixture();
        f.state.contents = f.state.contents.slice(0, 1);
        const old = f.context.runReaderSearch('Harbor');
        Object.assign(f.state, { activeDocumentId: 'book-b', activeRevisionId: 'revision-b', contents: [{ chapterId: 'b1', title: 'B' }] });
        const latest = f.context.runReaderSearch('Harbor');
        await f.respond('chapter', { documentId: 'book-a' }, { chapter: chapter('a1') });
        await old;
        assert.strictEqual(f.state.searchStatus, 'running');
        assert.strictEqual(f.state.searchResults.length, 0);
        await f.respond('chapter', { documentId: 'book-b' }, { chapter: chapter('b1') });
        await latest;
        assert.strictEqual(f.state.searchStatus, 'complete');
        assert.strictEqual(f.state.searchResults[0].locator.documentId, 'book-b');
    }],
    ['a superseded backward chapter flip cannot repaginate or animate the new chapter', async () => {
        const f = fixture();
        f.state.activeChapterId = 'a2';
        f.state.currentChapter = chapter('a2');
        f.state.effectiveLayoutMode = 'single-page';
        f.state.pages = Layout.buildReaderPages(chapter('a2', 'x'.repeat(500)), { capacity: 128 });
        const flip = f.context.navigateReaderChapterPageTurn(-1);
        const latest = f.context.loadReaderWorkspaceChapter('a3');
        await f.respond('chapter', { chapterId: 'a3' }, { chapter: chapter('a3') });
        await latest;
        await f.respond('chapter', { chapterId: 'a1' }, { chapter: chapter('a1') });
        assert.strictEqual(await flip, false);
        assert.strictEqual(f.state.activeChapterId, 'a3');
        assert.strictEqual(f.animations(), 0);
        assert.strictEqual(f.history.length, 0);
    }],
    ['stale annotation/history loads cannot replace current records or display errors', async () => {
        const f = fixture();
        vm.runInContext(source('reader-annotation-ui.js'), f.context, { filename: 'reader-annotation-ui.js' });
        f.context.refreshReaderAnnotationResolutions = async () => {};
        f.context.renderReaderHistory = () => {};
        f.context.readerAnnotationStatus = message => f.errors.push(message);
        f.context.readerAnnotationHistoryStatus = message => f.errors.push(message);
        const annotations = f.context.loadReaderAnnotationDocument();
        const history = f.context.loadReaderPositionHistory();
        Object.assign(f.state, {
            activeDocumentId: 'book-b', activeRevisionId: 'revision-b',
            annotations: [{ annotationId: 'new' }], annotationRecordUpdatedAt: 'new-time',
            historyItems: [{ entryId: 'new' }], historyRecordUpdatedAt: 'new-time'
        });
        await f.respond('annotations', { documentId: 'book-a' }, { record: { annotations: [{ annotationId: 'old' }], updatedAt: 'old-time' } });
        await f.respond('history', { documentId: 'book-a' }, null, new Error('obsolete history failure'));
        await Promise.all([annotations, history]);
        assert.strictEqual(f.state.annotations[0].annotationId, 'new');
        assert.strictEqual(f.state.annotationRecordUpdatedAt, 'new-time');
        assert.strictEqual(f.state.historyItems[0].entryId, 'new');
        assert.strictEqual(f.state.historyRecordUpdatedAt, 'new-time');
        assert.strictEqual(f.errors.length, 0);
    }],
    ['a late history write cannot clear the newly opened book history', async () => {
        const f = fixture();
        vm.runInContext(source('reader-annotation-ui.js'), f.context);
        f.context.renderReaderHistory = () => {};
        f.context.readerAnnotationHistoryStatus = message => f.errors.push(message);
        const write = f.context.recordReaderPositionHistory({ documentId: 'book-a', revisionId: 'revision-a', chapterId: 'a1', blockId: 'a1-block', offset: 0 });
        Object.assign(f.state, { r: 1, activeDocumentId: 'book-b', activeRevisionId: 'revision-b' });
        const load = f.context.loadReaderPositionHistory();
        await f.respond('history', { documentId: 'book-b' }, { record: { updatedAt: 'b-version', history: { items: [{ documentId: 'book-b', label: 'B history' }] } } });
        await load;
        await f.respond('history', {}, { record: { updatedAt: 'a-version', history: { items: [{ documentId: 'book-a', label: 'A history' }] } } });
        await write;
        assert.strictEqual(f.state.historyRecordUpdatedAt, 'b-version');
        assert.strictEqual(f.state.historyItems[0].label, 'B history');
        assert.strictEqual(f.errors.length, 0);
    }],
    ['obsolete history navigation neither moves the cursor nor clears a newer navigation flag', async () => {
        const f = fixture();
        vm.runInContext(source('reader-annotation-ui.js'), f.context);
        f.context.renderReaderHistory = () => {};
        f.state.historyItems = [0, 1, 2].map(index => ({ locator: { chapterId: `a${index + 1}` } }));
        f.state.historyCursor = 2;
        const resolves = [];
        f.context.navigateReaderToLocator = () => new Promise(resolve => resolves.push(resolve));
        const old = f.context.navigateReaderHistory(0);
        const latest = f.context.navigateReaderHistory(1);
        resolves[0](false);
        assert.strictEqual(await old, false);
        assert.strictEqual(f.state.historyCursor, 2);
        assert.strictEqual(f.state.historyNavigating, true);
        resolves[1](true);
        assert.strictEqual(await latest, true);
        assert.strictEqual(f.state.historyCursor, 1);
        assert.strictEqual(f.state.historyNavigating, false);
    }],
    ['returning to a transfer source respects a superseded book open', async () => {
        const f = fixture();
        vm.runInContext(source('reader-transfer-consumer.js'), f.context);
        vm.runInContext("readerTransferTargetState.transfers.writer = { envelope: { documentId: 'book-b', sourceLocators: [{ documentId: 'book-b', chapterId: 'b1' }] } };", f.context);
        f.context.setView = () => {};
        let finishOpen;
        let navigations = 0;
        f.context.openReaderLibraryDocument = () => new Promise(resolve => { finishOpen = resolve; });
        f.context.navigateReaderToLocator = async () => { navigations += 1; return true; };
        const returning = f.context.returnToReaderTransferSource('writer');
        f.state.activeDocumentId = 'book-b'; // A newer action opened the same source book at a different location.
        finishOpen(false);
        await returning;
        assert.strictEqual(navigations, 0);
    }]
];

(async () => {
    for (const [name, run] of tests) {
        let timeout;
        try {
            await Promise.race([run(), new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 5000);
            })]);
        } finally {
            clearTimeout(timeout);
        }
        console.log(`PASS ${name}`);
    }
    console.log(`Reader navigation state tests passed (${tests.length} cases, mocked APIs only).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
