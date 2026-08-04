    /* global bindReaderTouchZone bindReaderContinuousInput recordReaderPositionHistory createReaderBookmarkAtCurrentPosition renderReaderBookmarks */

    function readerNavigationElements() {
        return {
            searchForm: document.querySelector('[data-reader-search-form]'),
            searchInput: document.querySelector('[data-reader-search-input]'),
            searchCancel: document.querySelector('[data-reader-search-cancel]'),
            searchStatus: document.querySelector('[data-reader-search-status]'),
            searchResults: document.querySelector('[data-reader-search-results]'),
            bookmarks: document.querySelector('[data-reader-bookmarks]'),
            bookmarkStatus: document.querySelector('[data-reader-bookmark-status]'),
            bookmarkCreate: document.querySelector('[data-reader-bookmark-create]'),
            addBookmark: document.querySelector('[data-reader-add-bookmark]'),
            progress: document.querySelector('[data-reader-progress-slider]'),
            touchPrevious: document.querySelector('[data-reader-touch-prev]'),
            touchNext: document.querySelector('[data-reader-touch-next]')
        };
    }

    function readerSetNavigationStatus(kind, message) {
        const elements = readerNavigationElements();
        const target = kind === 'search' ? elements.searchStatus : elements.bookmarkStatus;
        if (target) target.textContent = message;
    }

    function readerSearchLocator(chapter, match, query) {
        return window.DraftHarborReaderLocator.locatorFromBlockPosition({
            documentId: readerState.activeDocumentId,
            chapterId: chapter.chapterId,
            blockId: match.blockId,
            offset: match.offset
        }, { revisionId: readerState.activeRevisionId, chapters: [chapter] }, { exact: query });
    }

    function renderReaderSearchResults() {
        const elements = readerNavigationElements();
        if (!elements.searchResults) return;
        elements.searchResults.replaceChildren();
        readerState.searchResults.forEach((result, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'desktop-reader-search-result';
            const title = document.createElement('strong');
            title.textContent = `${result.chapterTitle} · 第 ${index + 1} 项`;
            const excerpt = document.createElement('span');
            excerpt.textContent = result.excerpt;
            button.append(title, excerpt);
            button.addEventListener('click', async () => {
                await navigateReaderToLocator(result.locator, { highlight: true, historySource: 'search', historyLabel: result.excerpt });
                setReaderDrawer('');
            });
            elements.searchResults.appendChild(button);
        });
    }

    function cancelReaderSearch(options = {}) {
        readerState.searchRequestId += 1;
        if (readerState.searchAbortController) readerState.searchAbortController.abort();
        readerState.searchAbortController = null;
        if (readerState.searchStatus === 'running') {
            readerState.searchStatus = 'cancelled';
            if (!options.silent) readerSetNavigationStatus('search', `已取消，保留 ${readerState.searchResults.length} 条结果。`);
        }
        const cancel = readerNavigationElements().searchCancel;
        if (cancel) cancel.disabled = true;
    }

    async function runReaderSearch(queryInput) {
        const query = String(queryInput || '').trim();
        if (!readerState.apiMode || !readerState.activeDocumentId || !query) {
            readerSetNavigationStatus('search', query ? '请先打开一本书。' : '请输入搜索关键词。');
            return;
        }
        cancelReaderSearch({ silent: true });
        const requestId = ++readerState.searchRequestId;
        const controller = new AbortController();
        readerState.searchAbortController = controller;
        readerState.searchQuery = query;
        readerState.searchResults = [];
        readerState.searchStatus = 'running';
        renderReaderSearchResults();
        const cancel = readerNavigationElements().searchCancel;
        if (cancel) cancel.disabled = false;
        try {
            for (let index = 0; index < readerState.contents.length; index += 1) {
                if (requestId !== readerState.searchRequestId) return;
                const summary = readerState.contents[index];
                readerSetNavigationStatus('search', `正在搜索第 ${index + 1} / ${readerState.contents.length} 章，已找到 ${readerState.searchResults.length} 条…`);
                const payload = await readerApi(`/api/reader/chapter?documentId=${encodeURIComponent(readerState.activeDocumentId)}&revisionId=${encodeURIComponent(readerState.activeRevisionId)}&chapterId=${encodeURIComponent(summary.chapterId)}`, { signal: controller.signal });
                if (requestId !== readerState.searchRequestId) return;
                const matches = window.DraftHarborReaderNavigation.findLiteralMatches(payload.chapter, query, {
                    limit: Math.max(1, 500 - readerState.searchResults.length)
                });
                matches.forEach((match) => readerState.searchResults.push({
                    ...match,
                    chapterTitle: summary.title || payload.chapter.title,
                    locator: readerSearchLocator(payload.chapter, match, query)
                }));
                renderReaderSearchResults();
                if (readerState.searchResults.length >= 500) break;
                await new Promise((resolve) => window.setTimeout(resolve, 0));
            }
            if (requestId !== readerState.searchRequestId) return;
            readerState.searchStatus = 'complete';
            readerSetNavigationStatus('search', readerState.searchResults.length
                ? `搜索完成，共 ${readerState.searchResults.length} 条结果。`
                : '搜索完成，没有匹配项。');
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            if (requestId === readerState.searchRequestId) {
                readerState.searchStatus = 'failed';
                readerSetNavigationStatus('search', `搜索失败：${error.message || error}`);
            }
        } finally {
            if (requestId === readerState.searchRequestId) {
                readerState.searchAbortController = null;
                if (cancel) cancel.disabled = true;
            }
        }
    }

    async function readerRevisionSnapshot() {
        const key = `${readerState.activeDocumentId}:${readerState.activeRevisionId}`;
        if (readerState.revisionSnapshotPromise && readerState.revisionSnapshotKey === key) return readerState.revisionSnapshotPromise;
        readerState.revisionSnapshotKey = key;
        readerState.revisionSnapshotPromise = (async () => {
            const chapters = [];
            for (const summary of readerState.contents) {
                const payload = await readerApi(`/api/reader/chapter?documentId=${encodeURIComponent(readerState.activeDocumentId)}&revisionId=${encodeURIComponent(readerState.activeRevisionId)}&chapterId=${encodeURIComponent(summary.chapterId)}`);
                chapters.push(payload.chapter);
            }
            return { revisionId: readerState.activeRevisionId, chapters };
        })();
        return readerState.revisionSnapshotPromise;
    }

    async function navigateReaderToLocator(locator, options = {}) {
        if (!locator || !readerState.activeDocumentId) return false;
        let target = locator;
        if (locator.revisionId !== readerState.activeRevisionId) {
            const revision = await readerRevisionSnapshot();
            target = window.DraftHarborReaderLocator.resolveReaderLocator(locator, revision).locator;
        }
        await loadReaderWorkspaceChapter(target.chapterId, target);
        readerState.anchorLocator = target;
        renderReaderWorkspace();
        if (!options.skipHistory && typeof recordReaderPositionHistory === 'function') {
            await recordReaderPositionHistory(target, { source: options.historySource || 'navigation', label: options.historyLabel || '' });
        }
        if (options.highlight) {
            window.requestAnimationFrame(() => {
                const node = document.querySelector(`[data-reader-block="${CSS.escape(target.blockId)}"]`);
                if (node) {
                    node.classList.add('is-reader-location-highlight');
                    window.setTimeout(() => node.classList.remove('is-reader-location-highlight'), 1800);
                }
            });
        }
        return true;
    }

    function updateReaderNavigationProgress(ratioInput) {
        const slider = readerNavigationElements().progress;
        if (!slider || !readerState.apiMode || !readerState.currentChapter || readerState.progressDragging) return;
        const locator = typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : readerState.anchorLocator;
        const ratio = Number.isFinite(Number(ratioInput))
            ? Math.max(0, Math.min(1, Number(ratioInput)))
            : window.DraftHarborReaderNavigation.contentProgressForLocator(readerState.contents, readerState.currentChapter, locator);
        slider.disabled = false;
        slider.value = String(Math.round(ratio * 1000) / 10);
    }

    async function navigateReaderToBookRatio(ratioInput) {
        if (!readerState.apiMode) return;
        const token = ++readerState.progressNavigationToken;
        const target = window.DraftHarborReaderNavigation.chapterTargetForBookRatio(readerState.contents, Number(ratioInput));
        if (!target) return;
        const payload = await readerApi(`/api/reader/chapter?documentId=${encodeURIComponent(readerState.activeDocumentId)}&revisionId=${encodeURIComponent(readerState.activeRevisionId)}&chapterId=${encodeURIComponent(target.chapterId)}`);
        if (token !== readerState.progressNavigationToken) return;
        const position = window.DraftHarborReaderNavigation.blockPositionForChapterRatio(payload.chapter, target.chapterRatio);
        if (!position) return;
        const locator = window.DraftHarborReaderLocator.locatorFromBlockPosition({
            documentId: readerState.activeDocumentId,
            chapterId: target.chapterId,
            blockId: position.blockId,
            offset: position.offset
        }, { revisionId: readerState.activeRevisionId, chapters: [payload.chapter] });
        await navigateReaderToLocator(locator);
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        const requestedRatio = Math.max(0, Math.min(1, Number(ratioInput) || 0));
        const content = document.querySelector('[data-reader-content]');
        if (content && readerState.effectiveLayoutMode === 'flow') {
            const previousScrollBehavior = content.style.scrollBehavior;
            content.style.scrollBehavior = 'auto';
            if (requestedRatio <= 0) content.scrollTop = 0;
            if (requestedRatio >= 1) content.scrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
            window.requestAnimationFrame(() => { content.style.scrollBehavior = previousScrollBehavior; });
        }
        updateReaderWorkspaceProgress();
    }

    function initializeReaderNavigationDocument() {
        const elements = readerNavigationElements();
        if (elements.addBookmark) elements.addBookmark.disabled = !readerState.apiMode;
        if (elements.bookmarkCreate) elements.bookmarkCreate.disabled = !readerState.apiMode;
        readerState.revisionSnapshotPromise = null;
        readerState.revisionSnapshotKey = '';
        renderReaderBookmarks();
        refreshReaderBookmarkResolutions();
        updateReaderNavigationProgress();
    }

    function initializeReaderNavigation() {
        const elements = readerNavigationElements();
        elements.searchForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            runReaderSearch(elements.searchInput && elements.searchInput.value);
        });
        elements.searchInput?.addEventListener('input', () => {
            if (readerState.searchStatus === 'running') cancelReaderSearch({ silent: true });
        });
        elements.searchCancel?.addEventListener('click', () => cancelReaderSearch());
        elements.addBookmark?.addEventListener('click', createReaderBookmarkAtCurrentPosition);
        elements.bookmarkCreate?.addEventListener('click', createReaderBookmarkAtCurrentPosition);
        elements.progress?.addEventListener('input', () => {
            readerState.progressDragging = true;
            const percent = Math.max(0, Math.min(100, Number(elements.progress.value) || 0));
            const label = document.querySelector('[data-reader-progress-percent]');
            if (label) label.textContent = `${Math.round(percent)}%`;
        });
        elements.progress?.addEventListener('change', async () => {
            readerState.progressDragging = false;
            await navigateReaderToBookRatio((Number(elements.progress.value) || 0) / 100);
        });
        bindReaderTouchZone(elements.touchPrevious, -1);
        bindReaderTouchZone(elements.touchNext, 1);
        bindReaderContinuousInput(document.querySelector('[data-reader-content]'));
        renderReaderBookmarks();
    }
