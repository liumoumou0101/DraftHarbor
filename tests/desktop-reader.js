const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

async function createReaderSelectionTransfer(page, layoutMode, destination, target) {
    await page.evaluate((mode) => {
        const control = document.querySelector('[data-reader-layout-mode]');
        control.value = mode;
        control.dispatchEvent(new Event('change', { bubbles: true }));
    }, layoutMode);
    await page.waitForFunction((mode) => document.querySelector('[data-reader-content]').dataset.readerLayout === mode, layoutMode);
    await page.evaluate(({ blockId, start, end }) => {
        const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => (
            node.dataset.readerBlock === blockId
            && Number(node.dataset.readerStartOffset) <= start
            && Number(node.dataset.readerEndOffset) >= end
        ));
        if (!fragment) throw new Error(`No rendered fragment contains ${blockId}:${start}-${end}`);
        const base = Number(fragment.dataset.readerStartOffset);
        const textNode = fragment.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) throw new Error('Reader fragment must expose a text node');
        const range = document.createRange();
        range.setStart(textNode, start - base);
        range.setEnd(textNode, end - base);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }, target);
    await page.waitForFunction(({ blockId, start, end }) => {
        const selection = readerState.transferSelection;
        return selection && selection.start.blockId === blockId && selection.start.offset === start && selection.end.offset === end;
    }, target);
    await page.waitForFunction(() => !document.querySelector('[data-reader-selection-toolbar]').hidden);
    await page.click('[data-reader-selection-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-reader-transfer-dialog]').open);
    await page.selectOption('[data-reader-transfer-scope]', 'selection');
    const previousEnvelopeId = await page.evaluate(() => readerState.transferLastEnvelopeId);
    await page.click(`[data-reader-transfer-destination="${destination}"]`);
    await page.waitForFunction((previous) => readerState.transferLastEnvelopeId && readerState.transferLastEnvelopeId !== previous, previousEnvelopeId);
    await page.waitForFunction((target) => document.getElementById('desktop-root').dataset.view === target, destination);
    await page.waitForFunction((target) => !document.querySelector(`[data-reader-source-bar="${target}"]`).hidden, destination);
    const result = await page.evaluate(async () => {
        const envelopeId = readerState.transferLastEnvelopeId;
        const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`)).json();
        return {
            transfer: payload.transfer,
            selection: structuredClone(readerState.transferSelection),
            summary: `${payload.transfer.envelope.characterCount} 字符`
        };
    });
    await page.click(`[data-reader-source-bar="${destination}"] [data-reader-source-return]`);
    await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'reader');
    return result;
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-test-'));
    const fixturePath = path.join(dataRoot, 'reader-fixture.md');
    let servers = null;
    let browser = null;

    try {
        await fs.writeFile(
            fixturePath,
            [
                '# Chapter One',
                '',
                'First paragraph.',
                '',
                'Second paragraph.',
                '',
                '# Chapter Two',
                '',
                'New chapter content.',
                '',
                ...Array.from({ length: 90 }, (_, index) => `Long reading paragraph ${index + 1}. This text makes the reader content scroll.`)
            ].join('\n'),
            'utf8'
        );

        servers = await startDesktopServers({
            appRoot: path.resolve(__dirname, '..'),
            dataRoot,
            revealPath: async () => ''
        });

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        await page.goto(servers.appUrl + '/desktop.html', { waitUntil: 'domcontentloaded' });
        await page.click('[data-view-target="reader"]');
        await page.setInputFiles('[data-reader-file]', fixturePath);
        await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]').open);
        await page.click('[data-reader-import-confirm]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter One'));

        const initial = await page.evaluate(() => ({
            title: document.querySelector('[data-reader-title]').textContent,
            source: document.querySelector('[data-reader-source]').textContent,
            chapters: Array.from(document.querySelectorAll('.desktop-reader-chapter')).map((item) => item.textContent),
            progress: document.querySelector('[data-reader-progress-percent]').textContent,
            body: document.querySelector('[data-reader-content]').textContent
        }));
        assert.strictEqual(initial.title, 'Chapter One', 'reader should show the first detected chapter');
        assert.ok(initial.source.includes('reader-fixture'), 'reader should show the imported file title');
        assert.deepStrictEqual(initial.chapters, ['Chapter One', 'Chapter Two'], 'reader should detect markdown chapters');
        assert.strictEqual(initial.progress, '0%', 'reader progress should start at the beginning of the book');
        assert.ok(initial.body.includes('First paragraph.') && initial.body.includes('Second paragraph.'), 'reader should render chapter paragraphs');

        await page.click('[data-reader-next]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter Two'));
        await page.waitForFunction(() => document.querySelector('[data-reader-progress-percent]').textContent !== '0%');
        assert.ok(Number.parseInt(await page.locator('[data-reader-progress-percent]').innerText(), 10) > 0, 'reader progress should update on chapter change');

        await page.click('[data-reader-settings-toggle]');
        assert.strictEqual(await page.locator('[data-reader-settings-drawer]').getAttribute('aria-hidden'), 'false', 'settings drawer should open from the reading stage');
        await page.waitForFunction(() => document.activeElement === document.querySelector('[data-reader-settings-close]'));
        await page.selectOption('[data-reader-appearance-profile]', 'paper');
        await page.waitForFunction(() => readerState.appearanceProfileId === 'paper' && readerState.theme === 'paper');
        await page.fill('[data-reader-font-size]', '22');
        await page.fill('[data-reader-line-height]', '2');
        await page.fill('[data-reader-width]', '840');
        await page.fill('[data-reader-paragraph-spacing]', '1.3');
        await page.selectOption('[data-reader-font-family]', 'serif');
        await page.selectOption('select[data-reader-theme]', 'paper');
        await page.locator('[data-reader-indent]').setChecked(false);
        await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = content.scrollHeight - content.clientHeight;
            requestAnimationFrame(() => content.dispatchEvent(new Event('scroll')));
        });
        await page.waitForFunction(() => document.querySelector('[data-reader-progress-percent]').textContent !== '0%');
        await page.waitForFunction(() => readerState.fontSize === 22 && readerState.lineHeight === 2 && readerState.textWidth === 840 && readerState.paragraphSpacing === 1.3);
        await page.waitForFunction(() => document.querySelector('[data-reader-preference-status]').textContent.includes('全局设置已保存'));
        const settings = await page.evaluate(() => {
            const panel = document.querySelector('[data-reader-theme-panel]');
            return Promise.all([
                fetch('/api/reader/preferences').then((response) => response.json()),
                fetch(`/api/reader/state?documentId=${encodeURIComponent(readerState.activeDocumentId)}`).then((response) => response.json())
            ]).then(([globalPayload, statePayload]) => ({
                theme: panel.dataset.readerTheme,
                indent: panel.dataset.readerIndentEnabled,
                fontSize: panel.style.getPropertyValue('--reader-font-size'),
                lineHeight: panel.style.getPropertyValue('--reader-line-height'),
                textWidth: panel.style.getPropertyValue('--reader-width'),
                paragraphSpacing: panel.style.getPropertyValue('--reader-paragraph-spacing'),
                fontFamily: panel.style.getPropertyValue('--reader-font-family'),
                progress: document.querySelector('[data-reader-progress-percent]').textContent,
                global: globalPayload.record.preferences,
                state: statePayload.state || {},
                saved: localStorage.getItem('draftharbor:desktop:reader')
            }));
        });
        assert.strictEqual(settings.theme, 'paper', 'reader theme should apply to the panel');
        assert.strictEqual(settings.indent, 'false', 'reader indent toggle should apply to the panel');
        assert.strictEqual(settings.fontSize, '22px', 'reader font size should update the panel CSS variable');
        assert.strictEqual(settings.lineHeight, '2', 'reader line height should update the panel CSS variable');
        assert.strictEqual(settings.textWidth, '840px', 'reader width should update the panel CSS variable');
        assert.strictEqual(settings.paragraphSpacing, '1.3em', 'reader paragraph spacing should update the panel CSS variable');
        assert.ok(settings.fontFamily.includes('SimSun'), 'reader font family should update the panel CSS variable');
        assert.ok(Number.parseInt(settings.progress, 10) > 0, 'reader progress should advance after scrolling down');
        assert.strictEqual(settings.global.themeId, 'paper', 'reader settings should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.textWidth, 840, 'reader width should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.indent, false, 'reader indent preference should be persisted in the global Reader preferences');
        assert.ok(settings.state && typeof settings.state === 'object', 'Reader Store state endpoint should remain available');
        assert.strictEqual(settings.saved, null, 'authoritative Reader Store flow must not mirror prose into localStorage');

        await page.click('[data-reader-font-help]');
        await page.waitForFunction(() => document.querySelector('[data-reader-font-dialog]').open);
        await page.click('[data-reader-font-close]');
        await page.waitForFunction(() => !document.querySelector('[data-reader-font-dialog]').open);
        await page.click('[data-reader-settings-close]');
        await page.click('[data-reader-focus-toggle]');
        await page.waitForFunction(() => document.querySelector('[data-reader-shell]').dataset.readerControlsVisible === 'false');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('[data-reader-shell]').dataset.readerControlsVisible === 'true');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'false');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        assert.strictEqual(await page.locator('[data-reader-title]').innerText(), '选择一本书开始阅读', 'reopening Reader should land on the library surface');
        await page.click('[data-reader-library] .desktop-reader-library-item');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('Chapter One'));
        await page.click('[data-reader-next]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('Chapter Two'));
        assert.ok(Number.parseInt(await page.locator('[data-reader-progress-percent]').innerText(), 10) > 0, 'reader should restore and advance progress after reload');
        const formalLibrary = await page.evaluate(async () => (await fetch('/api/reader/documents')).json());
        assert.strictEqual(formalLibrary.documents.length, 1, 'confirmed file import should enter the Reader Store once');

        await page.click('[data-reader-library-toggle]');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        await page.waitForFunction(() => readerState.apiMode === true);
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]').getAttribute('aria-hidden') === 'false');
        await page.click('[data-reader-library] .desktop-reader-library-item');
        await page.waitForFunction(() => document.querySelectorAll('[data-reader-block]').length > 0 && !document.querySelector('[data-reader-shell]').dataset.readerDrawer);
        const apiReader = await page.evaluate(() => ({
            apiMode: readerState.apiMode,
            activeDocumentId: readerState.activeDocumentId,
            renderedBlocks: document.querySelectorAll('[data-reader-block]').length,
            drawer: document.querySelector('[data-reader-shell]').dataset.readerDrawer || ''
        }));
        assert.strictEqual(apiReader.apiMode, true, 'library selection should switch to the authoritative Reader Store flow');
        assert.ok(apiReader.activeDocumentId, 'library selection should set the active document id');
        assert.ok(apiReader.renderedBlocks > 0, 'Reader Store flow should render chapter blocks');
        assert.strictEqual(apiReader.drawer, '', 'selecting a library document should return focus to the reading stage');

        await page.click('[data-reader-next]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter Two'));

        const selectionTarget = await page.evaluate(() => {
            const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => node.textContent.length >= 8);
            const start = Number(fragment.dataset.readerStartOffset);
            return { blockId: fragment.dataset.readerBlock, start, end: start + 5 };
        });
        const flowTransfer = await createReaderSelectionTransfer(page, 'flow', 'writer', selectionTarget);
        const singleTransfer = await createReaderSelectionTransfer(page, 'single-page', 'compendium', selectionTarget);
        const doubleTransfer = await createReaderSelectionTransfer(page, 'double-page', 'workflow', selectionTarget);
        const transferIdentity = (result) => ({
            text: result.transfer.text,
            textDigest: result.transfer.snapshot.textDigest,
            start: result.selection.start,
            end: result.selection.end
        });
        assert.deepStrictEqual(transferIdentity(singleTransfer), transferIdentity(flowTransfer), 'single-page selection must create the same locator and snapshot text as flow mode');
        assert.deepStrictEqual(transferIdentity(doubleTransfer), transferIdentity(flowTransfer), 'double-page selection must create the same locator and snapshot text as flow mode');
        assert.ok(flowTransfer.summary.includes('5'), 'selection confirmation should report the selected character count');

        await page.route('**/api/reader/transfer/range', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'forced failure' }) }));
        await page.click('[data-reader-selection-confirm]');
        const positionBeforeFailedTransfer = await page.evaluate(() => ({
            pageIndex: readerState.pageIndex,
            selection: structuredClone(readerState.transferSelection)
        }));
        await page.click('[data-reader-transfer-destination="writer"]');
        await page.waitForFunction(() => document.querySelector('[data-reader-transfer-status]').textContent.includes('范围和阅读位置已保留'));
        const positionAfterFailedTransfer = await page.evaluate(() => ({
            pageIndex: readerState.pageIndex,
            selection: structuredClone(readerState.transferSelection),
            dialogOpen: document.querySelector('[data-reader-transfer-dialog]').open
        }));
        assert.deepStrictEqual(positionAfterFailedTransfer.selection, positionBeforeFailedTransfer.selection, 'failed transfer must preserve the normalized selection');
        assert.strictEqual(positionAfterFailedTransfer.pageIndex, positionBeforeFailedTransfer.pageIndex, 'failed transfer must preserve the reading page');
        assert.strictEqual(positionAfterFailedTransfer.dialogOpen, true, 'failed transfer must keep confirmation open for retry');
        await page.unroute('**/api/reader/transfer/range');
        await page.click('[data-reader-transfer-close]');

        await page.click('[data-reader-selection-toggle]');
        await page.selectOption('[data-reader-transfer-scope]', 'document');
        const documentSummary = await page.locator('[data-reader-transfer-counts]').textContent();
        assert.ok(documentSummary.includes('2 章'), 'document confirmation should report its chapter count');
        const previousDocumentEnvelope = await page.evaluate(() => readerState.transferLastEnvelopeId);
        await page.click('[data-reader-transfer-destination="workflow"]');
        await page.waitForFunction((previous) => readerState.transferLastEnvelopeId !== previous, previousDocumentEnvelope);
        await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'workflow');
        const documentLeakage = await page.evaluate(async () => {
            const envelopeId = readerState.transferLastEnvelopeId;
            const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`)).json();
            return {
                text: payload.transfer.text,
                domText: document.querySelector('[data-reader-content]').textContent,
                url: location.href,
                localStorage: JSON.stringify(localStorage),
                historyState: JSON.stringify(history.state)
            };
        });
        assert.ok(documentLeakage.text.includes('First paragraph.') && documentLeakage.text.includes('Long reading paragraph 90.'), 'document scope should freeze chapters that are not mounted together in the reader DOM');
        assert.ok(!documentLeakage.domText.includes('First paragraph.'), 'inactive chapter prose should remain outside the mounted reader DOM');
        assert.ok(!documentLeakage.url.includes('First paragraph.'), 'snapshot prose must not enter the route');
        assert.ok(!documentLeakage.localStorage.includes('First paragraph.'), 'snapshot prose must not enter localStorage');
        assert.ok(!documentLeakage.historyState.includes('First paragraph.'), 'snapshot prose must not enter browser history state');
        await page.click('[data-reader-source-bar="workflow"] [data-reader-source-return]');
        await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'reader');
        await page.evaluate(() => {
            const control = document.querySelector('[data-reader-layout-mode]');
            control.value = 'flow';
            control.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'flow');

        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="search"]');
        await page.evaluate(() => {
            window.__readerSearchFetch = window.fetch;
            window.fetch = (...args) => String(args[0]).includes('/api/reader/chapter')
                ? new Promise((resolve, reject) => window.setTimeout(() => window.__readerSearchFetch(...args).then(resolve, reject), 80))
                : window.__readerSearchFetch(...args);
        });
        await page.fill('[data-reader-search-input]', 'Long reading paragraph');
        await page.click('[data-reader-search-submit]');
        await page.waitForFunction(() => readerState.searchStatus === 'running');
        await page.click('[data-reader-search-cancel]');
        await page.waitForFunction(() => readerState.searchStatus === 'cancelled');
        const cancelledCount = await page.evaluate(() => readerState.searchResults.length);
        await page.waitForTimeout(250);
        assert.strictEqual(await page.evaluate(() => readerState.searchResults.length), cancelledCount, 'cancelled search must not append late chapter results');
        await page.evaluate(() => { window.fetch = window.__readerSearchFetch; });
        await page.fill('[data-reader-search-input]', 'First paragraph');
        await page.click('[data-reader-search-submit]');
        await page.fill('[data-reader-search-input]', 'New chapter content');
        await page.click('[data-reader-search-submit]');
        await page.waitForFunction(() => readerState.searchStatus === 'complete');
        const searchState = await page.evaluate(() => ({
            query: readerState.searchQuery,
            count: readerState.searchResults.length,
            excerpts: readerState.searchResults.map((result) => result.excerpt)
        }));
        assert.strictEqual(searchState.query, 'New chapter content', 'latest search request must own the result list');
        assert.strictEqual(searchState.count, 1, 'literal search should return the matching block once');
        assert.ok(searchState.excerpts.every((excerpt) => excerpt.includes('New chapter content')), 'cancelled search results must not arrive late');
        await page.click('[data-reader-search-results] .desktop-reader-search-result');
        await page.waitForFunction(() => readerState.activeChapterId === readerState.contents[1].chapterId);

        await page.click('[data-reader-add-bookmark]');
        await page.waitForFunction(() => readerState.documentRecordState.bookmarks.length === 1);
        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="bookmarks"]');
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="exact"]').count(), 1, 'new bookmarks should resolve exactly in the active revision');
        await page.fill('.desktop-reader-bookmark-controls input', 'Harbor checkpoint');
        await page.click('.desktop-reader-bookmark-controls .desktop-secondary-action');
        await page.waitForFunction(() => readerState.documentRecordState.bookmarks[0].title === 'Harbor checkpoint');
        await page.click('[data-reader-left-close]');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'false');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        await page.click('[data-reader-library] .desktop-reader-library-item');
        await page.waitForFunction(() => readerState.apiMode && readerState.documentRecordState && readerState.documentRecordState.bookmarks.length === 1);
        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="bookmarks"]');
        assert.strictEqual(await page.locator('.desktop-reader-bookmark-open strong').innerText(), 'Harbor checkpoint', 'bookmark edits should survive reload');
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="exact"]').count(), 1, 'persisted bookmarks should retain exact accuracy in the same revision');
        await page.evaluate(async () => {
            window.__readerOriginalBookmark = structuredClone(readerState.documentRecordState.bookmarks[0]);
            readerState.documentRecordState.bookmarks[0].locator.revisionId = 'older-revision';
            await refreshReaderBookmarkResolutions();
        });
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="approximate"]').count(), 1, 'a changed revision should expose approximate bookmark recovery');
        await page.evaluate(async () => {
            const bookmark = readerState.documentRecordState.bookmarks[0];
            bookmark.locator.blockId = 'missing-block';
            bookmark.locator.quote = { exact: '', prefix: '', suffix: '' };
            bookmark.locator.blockDigest = '';
            bookmark.locator.contextBlockDigests = { previous: '', next: '' };
            bookmark.locator.projectRef = {};
            await refreshReaderBookmarkResolutions();
        });
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="unresolved"]').count(), 1, 'unresolvable bookmarks should require confirmation instead of silently guessing');
        await page.evaluate(async () => {
            await persistReaderNavigationState([window.__readerOriginalBookmark]);
            await refreshReaderBookmarkResolutions();
        });
        await page.click('[data-reader-left-close]');

        await page.evaluate(async () => {
            const target = readerState.contents[1] || readerState.contents[0];
            await loadReaderWorkspaceChapter(target.chapterId);
        });
        const flowAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset };
        });
        await page.click('[data-reader-settings-toggle]');
        await page.selectOption('[data-reader-preference-scope]', 'document');
        await page.selectOption('[data-reader-layout-mode]', 'single-page');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'single-page' && readerState.pages.length > 2);
        const singleAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset, pageCount: readerState.pages.length };
        });
        assert.deepStrictEqual({ blockId: singleAnchor.blockId, offset: singleAnchor.offset }, flowAnchor, 'flow to single-page must preserve the shared locator');
        assert.ok(singleAnchor.pageCount > 2, 'long chapters should create multiple temporary pages');
        await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            for (const key of readerState.layoutCache.keys()) readerState.layoutCache.set(key, { corrupt: true });
            renderReaderReading({ locator });
        });
        assert.ok(await page.evaluate(() => readerState.pages.length) > 2, 'corrupt pagination cache must rebuild from the authoritative chapter');

        const preferenceAnchor = await page.evaluate(() => captureReaderPositionLocator());
        await page.fill('[data-reader-letter-spacing]', '0.06');
        await page.fill('[data-reader-page-margin]', '64');
        await page.fill('[data-reader-width]', '900');
        await page.selectOption('[data-reader-text-align]', 'justify');
        await page.selectOption('[data-reader-font-family]', 'kai');
        await page.selectOption('select[data-reader-theme]', 'sepia');
        await page.selectOption('[data-reader-page-transition]', 'slide');
        await page.selectOption('[data-reader-reduced-motion]', 'reduce');
        await page.waitForFunction(() => document.querySelector('[data-reader-preference-status]').textContent.includes('本书设置已保存'));
        const scopedPreferences = await page.evaluate(async () => {
            const [globalPayload, statePayload] = await Promise.all([
                fetch('/api/reader/preferences').then((response) => response.json()),
                fetch(`/api/reader/state?documentId=${encodeURIComponent(readerState.activeDocumentId)}`).then((response) => response.json())
            ]);
            return {
                globalTheme: globalPayload.record.preferences.themeId,
                overrides: statePayload.state.preferenceOverrides,
                locator: captureReaderPositionLocator()
            };
        });
        assert.notStrictEqual(scopedPreferences.globalTheme, 'sepia', 'per-book changes must not overwrite global preferences');
        assert.strictEqual(scopedPreferences.overrides.themeId, 'sepia', 'per-book theme override should be authoritative');
        assert.strictEqual(scopedPreferences.overrides.fontFamilyId, 'kai', 'stable font family id should persist per book');
        assert.strictEqual(scopedPreferences.overrides.letterSpacing, 0.06, 'letter spacing should persist per book');
        assert.strictEqual(scopedPreferences.overrides.pageMargin, 64, 'page margin should persist per book');
        assert.strictEqual(scopedPreferences.overrides.textWidth, 900, 'text width should persist per book');
        assert.deepStrictEqual(
            { blockId: scopedPreferences.locator.blockId, offset: scopedPreferences.locator.offset },
            { blockId: preferenceAnchor.blockId, offset: preferenceAnchor.offset },
            'typography changes must preserve the shared locator'
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'false');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        await page.click('[data-reader-library] .desktop-reader-library-item');
        await page.waitForFunction(() => readerState.apiMode && readerState.preferenceScope === 'document' && readerState.theme === 'sepia');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'single-page');
        await page.click('[data-reader-settings-toggle]');
        assert.strictEqual(await page.locator('[data-reader-font-family]').inputValue(), 'kai', 'per-book font override should survive reload');
        assert.strictEqual(await page.locator('[data-reader-page-margin]').inputValue(), '64', 'per-book page margin should survive reload');
        assert.strictEqual(await page.locator('[data-reader-width]').inputValue(), '900', 'per-book text width should survive reload');
        await page.click('[data-reader-settings-close]');

        const reducedMotionPage = await page.evaluate(() => readerState.pageIndex);
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction((previous) => readerState.pageIndex > previous, reducedMotionPage);
        const reducedMotionResult = await page.evaluate(() => ({
            transition: readerEffectiveTransition(),
            motion: document.querySelector('[data-reader-theme-panel]').dataset.readerMotion,
            animationName: getComputedStyle(document.querySelector('.desktop-reader-page-deck')).animationName
        }));
        assert.strictEqual(reducedMotionResult.transition, 'none', 'reduced motion must downgrade page transitions to none');
        assert.strictEqual(reducedMotionResult.motion, 'reduce', 'explicit reduced-motion preference should be visible on the stage');
        assert.strictEqual(reducedMotionResult.animationName, 'none', 'reduced motion must not translate or simulate a page turn');
        await page.waitForFunction(() => !document.querySelector('.desktop-reader-page-deck')?.classList.contains('is-reader-transitioning'));

        await page.click('[data-reader-settings-toggle]');
        await page.selectOption('[data-reader-reduced-motion]', 'allow');
        await page.click('[data-reader-settings-close]');
        await page.waitForFunction(() => readerState.reducedMotionOverride === false && readerEffectiveTransition() === 'slide');
        const motionKey = await page.evaluate(() => readerState.pageIndex < readerState.pages.length - 1 ? 'ArrowRight' : 'ArrowLeft');
        await page.keyboard.press(motionKey);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-reader-page-deck')).animationName.includes('slide'));
        await page.waitForTimeout(300);

        const touchSelectionIndex = await page.evaluate(() => {
            const node = document.querySelector('[data-reader-page] [data-reader-block]');
            const range = document.createRange();
            range.selectNodeContents(node);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return readerState.pageIndex;
        });
        await page.click('[data-reader-touch-next]');
        await page.waitForTimeout(120);
        assert.strictEqual(await page.evaluate(() => readerState.pageIndex), touchSelectionIndex, 'text selection must take priority over the touch page-turn zone');
        await page.evaluate(() => window.getSelection().removeAllRanges());
        await page.click('[data-reader-touch-next]');
        await page.waitForFunction((previous) => readerState.pageIndex > previous, touchSelectionIndex);

        await page.evaluate(() => {
            window.__readerStateWrites = 0;
            const originalFetch = window.fetch;
            window.fetch = (...args) => {
                if (String(args[0]).includes('/api/reader/state') && args[1] && args[1].method === 'POST') window.__readerStateWrites += 1;
                return originalFetch(...args);
            };
            queueReaderPageTurn(1);
            queueReaderPageTurn(1);
            queueReaderPageTurn(1);
        });
        await page.waitForFunction(() => readerState.pageIndex >= 3);
        await page.waitForTimeout(700);
        assert.ok(await page.evaluate(() => window.__readerStateWrites) <= 1, 'rapid page turns should merge into at most one authoritative position write');

        const pagedAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset };
        });
        await page.click('[data-reader-settings-toggle]');
        await page.selectOption('[data-reader-layout-mode]', 'double-page');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'double-page');
        const doubleAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset, visiblePages: document.querySelectorAll('[data-reader-page]').length };
        });
        assert.deepStrictEqual({ blockId: doubleAnchor.blockId, offset: doubleAnchor.offset }, pagedAnchor, 'single-page to double-page must preserve the shared locator');
        assert.strictEqual(doubleAnchor.visiblePages, 2, 'double-page mode should render a left-to-right spread');
        await page.selectOption('[data-reader-layout-mode]', 'auto');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'double-page');
        await page.setViewportSize({ width: 720, height: 820 });
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'single-page');
        assert.strictEqual(await page.locator('[data-reader-layout-mode]').inputValue(), 'auto', 'automatic fallback must not overwrite the saved auto choice');
        await page.selectOption('[data-reader-layout-mode]', 'flow');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'flow');
        await page.click('[data-reader-settings-close]');
        assert.ok(await page.locator('[data-reader-block]').count() <= 73, 'flow mode must keep a bounded DOM window');
        await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = content.scrollHeight - content.clientHeight;
            content.dispatchEvent(new Event('scroll'));
        });
        await page.waitForFunction(() => readerState.virtualWindow.end === readerState.currentChapter.blocks.length);
        assert.ok(await page.locator('[data-reader-block]').count() <= 73, 'shifting the flow window must not accumulate chapter DOM');

        await page.evaluate(() => {
            const slider = document.querySelector('[data-reader-progress-slider]');
            slider.value = '0';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => readerState.activeChapterId === readerState.contents[0].chapterId && document.querySelector('[data-reader-progress-percent]').textContent === '0%');
        await page.evaluate(() => {
            const slider = document.querySelector('[data-reader-progress-slider]');
            slider.value = '100';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => readerState.activeChapterId === readerState.contents[readerState.contents.length - 1].chapterId);
        await page.waitForTimeout(300);
        const endProgress = await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            return {
                label: document.querySelector('[data-reader-progress-percent]').textContent,
                slider: document.querySelector('[data-reader-progress-slider]').value,
                scrollTop: content.scrollTop,
                maxScroll: content.scrollHeight - content.clientHeight
            };
        });
        assert.strictEqual(endProgress.label, '100%', `book progress should end at 100% (${JSON.stringify(endProgress)})`);

        await page.click('[data-reader-settings-toggle]');
        await page.click('[data-reader-preference-reset]');
        await page.waitForFunction(() => document.querySelector('[data-reader-preference-status]').textContent.includes('已恢复全局设置'));
        const resetPreferences = await page.evaluate(async () => {
            const payload = await fetch(`/api/reader/state?documentId=${encodeURIComponent(readerState.activeDocumentId)}`).then((response) => response.json());
            return { overrides: payload.state.preferenceOverrides, theme: readerState.theme };
        });
        assert.deepStrictEqual(resetPreferences.overrides, {}, 'reset should remove every per-book preference override');
        assert.strictEqual(resetPreferences.theme, scopedPreferences.globalTheme, 'reset should immediately restore the global theme');
        await page.click('[data-reader-settings-close]');

        await page.click('[data-reader-library-toggle]');
        assert.strictEqual(await page.locator('[data-reader-left-drawer]').evaluate((node) => node.inert), false, 'the active navigation drawer must be reachable');
        assert.strictEqual(await page.locator('[data-reader-settings-drawer]').evaluate((node) => node.inert), true, 'the inactive settings drawer must stay inert');
        assert.strictEqual(await page.locator('[data-reader-position-label]').getAttribute('aria-live'), 'polite', 'reading position changes should be announced politely');
        assert.strictEqual(await page.locator('[data-reader-progress-percent]').getAttribute('aria-live'), 'polite', 'book progress changes should be announced politely');
        await page.waitForTimeout(220);
        await page.locator('[data-reader-left-close]').focus();
        await page.keyboard.press('Shift+Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement === readerDrawerFocusable(document.querySelector('[data-reader-left-drawer]')).at(-1)), true, 'Shift+Tab at the start of a drawer must wrap to its last reachable control');
        await page.keyboard.press('Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement === document.querySelector('[data-reader-left-close]')), true, 'Tab at the end of a drawer must wrap to its close control');
        await page.locator('[data-reader-tab="bookmarks"]').focus();
        await page.keyboard.press('Home');
        assert.strictEqual(await page.locator('[data-reader-tab="library"]').getAttribute('aria-selected'), 'true', 'Home should select the first navigation tab');
        assert.strictEqual(await page.locator('[data-reader-tab="library"]').getAttribute('tabindex'), '0', 'the selected tab should be the only tab in the natural tab order');
        await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-tab="contents"]').getAttribute('aria-selected'), 'true', 'ArrowRight should advance and select a navigation tab');
        await page.keyboard.press('End');
        assert.strictEqual(await page.locator('[data-reader-tab="bookmarks"]').getAttribute('aria-selected'), 'true', 'End should select the final navigation tab');
        await page.click('[data-reader-tab="bookmarks"]');
        await page.click('.desktop-reader-bookmark-controls .desktop-reader-tool');
        await page.waitForFunction(() => readerState.documentRecordState.bookmarks.length === 0);
        assert.strictEqual(await page.locator('.desktop-reader-bookmark').count(), 0, 'bookmark delete should update persistent state and the list');
        await page.click('[data-reader-tab="contents"]');
        assert.ok(await page.locator('[data-reader-chapters] .desktop-reader-chapter').count() >= 2, 'contents tab should expose the document chapter list');
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.locator('[data-reader-left-drawer]').getAttribute('aria-hidden'), 'true', 'Escape should close the active drawer');
        assert.strictEqual(await page.evaluate(() => document.activeElement === document.querySelector('[data-reader-library-toggle]')), true, 'closing a drawer should restore focus to its trigger');

        console.log('Desktop reader test passed.');
    } finally {
        if (browser) await browser.close();
        if (servers) servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('Desktop reader test failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
