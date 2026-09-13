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
                if (await navigateReaderToLocator(result.locator, { highlight: true, historySource: 'search', historyLabel: result.excerpt })) setReaderDrawer('');
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
        const documentId = readerState.activeDocumentId;
        const revisionId = readerState.activeRevisionId;
        const contents = readerState.contents.slice();
        const isCurrent = () => requestId === readerState.searchRequestId
            && documentId === readerState.activeDocumentId && revisionId === readerState.activeRevisionId;
        const controller = new AbortController();
        readerState.searchAbortController = controller;
        readerState.searchQuery = query;
        readerState.searchResults = [];
        readerState.searchStatus = 'running';
        renderReaderSearchResults();
        const cancel = readerNavigationElements().searchCancel;
        if (cancel) cancel.disabled = false;
        try {
            for (let index = 0; index < contents.length; index += 1) {
                if (!isCurrent()) return;
                const summary = contents[index];
                readerSetNavigationStatus('search', `正在搜索第 ${index + 1} / ${contents.length} 章，已找到 ${readerState.searchResults.length} 条…`);
                const payload = await readerApi(`/api/reader/chapter?documentId=${encodeURIComponent(documentId)}&revisionId=${encodeURIComponent(revisionId)}&chapterId=${encodeURIComponent(summary.chapterId)}`, { signal: controller.signal });
                if (!isCurrent()) return;
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
            if (!isCurrent()) return;
            readerState.searchStatus = 'complete';
            readerSetNavigationStatus('search', readerState.searchResults.length
                ? `搜索完成，共 ${readerState.searchResults.length} 条结果。`
                : '搜索完成，没有匹配项。');
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            if (isCurrent()) {
                readerState.searchStatus = 'failed';
                readerSetNavigationStatus('search', `搜索失败：${error.message || error}`);
            }
        } finally {
            if (isCurrent()) {
                readerState.searchAbortController = null;
                if (cancel) cancel.disabled = true;
            }
        }
    }

    async function readerRevisionSnapshot() {
        const documentId = readerState.activeDocumentId;
        const revisionId = readerState.activeRevisionId;
        const contents = readerState.contents.slice();
        const key = `${documentId}:${revisionId}`;
        if (readerState.revisionSnapshotPromise && readerState.revisionSnapshotKey === key) return readerState.revisionSnapshotPromise;
        readerState.revisionSnapshotKey = key;
        const promise = (async () => {
            const chapters = [];
            for (const summary of contents) {
                const payload = await readerApi(`/api/reader/chapter?documentId=${encodeURIComponent(documentId)}&revisionId=${encodeURIComponent(revisionId)}&chapterId=${encodeURIComponent(summary.chapterId)}`);
                chapters.push(payload.chapter);
            }
            return { revisionId, chapters };
        })();
        readerState.revisionSnapshotPromise = promise;
        try {
            return await promise;
        } catch (error) {
            if (readerState.revisionSnapshotPromise === promise) {
                readerState.revisionSnapshotPromise = null;
                readerState.revisionSnapshotKey = '';
            }
            throw error;
        }
    }

    async function navigateReaderToLocator(locator, options = {}) {
        const documentId = readerState.activeDocumentId;
        const revisionId = readerState.activeRevisionId;
        if (!locator || !documentId || (locator.documentId && locator.documentId !== documentId)) return false;
        const token = window.startReaderNavigation(options.navigationToken);
        if (token === null) return false;
        const isCurrent = () => window.readerNavigationCurrent(token, documentId, revisionId);
        try {
            let target = locator;
            if (locator.revisionId !== revisionId) {
                const revision = await readerRevisionSnapshot();
                if (!isCurrent()) return false;
                target = window.DraftHarborReaderLocator.resolveReaderLocator(locator, revision).locator;
            }
            if (await loadReaderWorkspaceChapter(target.chapterId, target, token) === false || !isCurrent()) return false;
            if (!options.skipHistory && typeof recordReaderPositionHistory === 'function') {
                await recordReaderPositionHistory(target, { source: options.historySource || 'navigation', label: options.historyLabel || '' });
            }
            if (!isCurrent()) return false;
            if (options.highlight) {
                window.requestAnimationFrame(() => {
                    if (!isCurrent()) return;
                    const node = document.querySelector(`[data-reader-block="${CSS.escape(target.blockId)}"]`);
                    if (node) {
                        node.classList.add('is-reader-location-highlight');
                        window.setTimeout(() => node.classList.remove('is-reader-location-highlight'), 1800);
                    }
                });
            }
            return true;
        } catch (error) {
            if (!isCurrent()) return false;
            throw error;
        }
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
        if (!readerState.apiMode) return false;
        const target = window.DraftHarborReaderNavigation.chapterTargetForBookRatio(readerState.contents, Number(ratioInput));
        if (!target) return false;
        const token = window.startReaderNavigation();
        const documentId = readerState.activeDocumentId;
        const revisionId = readerState.activeRevisionId;
        const isCurrent = () => window.readerNavigationCurrent(token, documentId, revisionId);
        try {
            const payload = await readerApi(`/api/reader/chapter?documentId=${encodeURIComponent(documentId)}&revisionId=${encodeURIComponent(revisionId)}&chapterId=${encodeURIComponent(target.chapterId)}`);
            if (!isCurrent()) return false;
            const position = window.DraftHarborReaderNavigation.blockPositionForChapterRatio(payload.chapter, target.chapterRatio);
            if (!position) return false;
            const locator = window.DraftHarborReaderLocator.locatorFromBlockPosition({
                documentId, chapterId: target.chapterId, blockId: position.blockId, offset: position.offset
            }, { revisionId, chapters: [payload.chapter] });
            if (!await navigateReaderToLocator(locator, { navigationToken: token })) return false;
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            if (!isCurrent()) return false;
            const requestedRatio = Math.max(0, Math.min(1, Number(ratioInput) || 0));
            const content = document.querySelector('[data-reader-content]');
            if (content && readerState.effectiveLayoutMode === 'flow') {
                const previousScrollBehavior = content.style.scrollBehavior;
                content.style.scrollBehavior = 'auto';
                if (requestedRatio <= 0) content.scrollTop = 0;
                if (requestedRatio >= 1) content.scrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
                window.requestAnimationFrame(() => { if (isCurrent()) content.style.scrollBehavior = previousScrollBehavior; });
            }
            updateReaderWorkspaceProgress();
            return true;
        } catch (error) {
            if (!isCurrent()) return false;
            throw error;
        }
    }

    function initializeReaderNavigationDocument() {
        cancelReaderSearch({ silent: true });
        readerState.searchResults = [];
        readerState.searchStatus = 'idle';
        readerSetNavigationStatus('search', '');
        renderReaderSearchResults();
        const elements = readerNavigationElements();
        const canBookmark = !!(readerState.currentChapter && (readerState.apiMode || readerState.document));
        if (elements.addBookmark) {
            elements.addBookmark.disabled = !canBookmark;
            elements.addBookmark.title = canBookmark ? '保存当前位置，可在目录里的书签列表跳回' : '打开一本书后可添加书签';
        }
        if (elements.bookmarkCreate) elements.bookmarkCreate.disabled = !canBookmark;
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
