    let readerPositionSaveTimer = null;
    let readerStateWriteQueue = Promise.resolve();
    let readerStateWriteRevision = 0;
    const readerStateWriteDrafts = new Map();

    function readerWorkspaceElements() {
        return {
            shell: document.querySelector('[data-reader-shell]'),
            leftDrawer: document.querySelector('[data-reader-left-drawer]'),
            settingsDrawer: document.querySelector('[data-reader-settings-drawer]'),
            leftToggle: document.querySelector('[data-reader-library-toggle]'),
            settingsToggle: document.querySelector('[data-reader-settings-toggle]'),
            content: document.querySelector('[data-reader-content]')
        };
    }

    function setReaderDrawer(drawer, trigger) {
        const elements = readerWorkspaceElements();
        readerState.drawer = drawer || '';
        if (trigger) readerState.drawerReturnFocus = trigger;
        if (elements.shell) elements.shell.dataset.readerDrawer = readerState.drawer;
        if (elements.leftDrawer) elements.leftDrawer.setAttribute('aria-hidden', drawer === 'left' ? 'false' : 'true');
        if (elements.settingsDrawer) elements.settingsDrawer.setAttribute('aria-hidden', drawer === 'right' ? 'false' : 'true');
        if (elements.leftDrawer) elements.leftDrawer.inert = drawer !== 'left';
        if (elements.settingsDrawer) elements.settingsDrawer.inert = drawer !== 'right';
        if (elements.leftToggle) elements.leftToggle.setAttribute('aria-expanded', drawer === 'left' ? 'true' : 'false');
        if (elements.settingsToggle) elements.settingsToggle.setAttribute('aria-expanded', drawer === 'right' ? 'true' : 'false');
        if (drawer) {
            const panel = drawer === 'left' ? elements.leftDrawer : elements.settingsDrawer;
            const firstControl = panel && panel.querySelector('button:not([disabled]), input, select');
            if (firstControl) window.setTimeout(() => {
                if (readerState.drawer !== drawer || !panel || panel.inert) return;
                if (!panel.contains(document.activeElement)) firstControl.focus({ preventScroll: true });
            }, 190);
        } else if (readerState.drawerReturnFocus && document.contains(readerState.drawerReturnFocus)) {
            readerState.drawerReturnFocus.focus();
            readerState.drawerReturnFocus = null;
        }
    }

    function readerDrawerFocusable(panel) {
        return Array.from(panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
            .filter((element) => !element.hidden && element.getClientRects().length > 0);
    }

    function handleReaderDrawerTab(event) {
        if (event.key !== 'Tab' || !readerState.drawer) return;
        const elements = readerWorkspaceElements();
        const panel = readerState.drawer === 'left' ? elements.leftDrawer : elements.settingsDrawer;
        const focusable = panel ? readerDrawerFocusable(panel) : [];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function handleReaderTabKey(event) {
        const button = event.target && event.target.closest('[data-reader-tab]');
        if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(document.querySelectorAll('[data-reader-tab]'));
        const current = tabs.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
    }

    function selectReaderLeftTab(tab) {
        readerState.leftTab = tab;
        document.querySelectorAll('[data-reader-tab]').forEach((button) => {
            const selected = button.dataset.readerTab === tab;
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.tabIndex = selected ? 0 : -1;
        });
        document.querySelectorAll('[data-reader-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.readerPanel !== tab;
        });
    }

    function handleReaderWorkspaceEscape() {
        if (readerState.drawer) {
            setReaderDrawer('');
            return;
        }
        readerState.controlsVisible = !readerState.controlsVisible;
        const shell = document.querySelector('[data-reader-shell]');
        if (shell) shell.dataset.readerControlsVisible = readerState.controlsVisible ? 'true' : 'false';
    }

    function readerWorkspaceChapterIndex() {
        return readerState.contents.findIndex((item) => item.chapterId === readerState.activeChapterId);
    }

    function renderReaderWorkspaceContents() {
        const container = document.querySelector('[data-reader-chapters]');
        if (!container) return;
        container.replaceChildren();
        readerState.contents.forEach((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'desktop-reader-chapter';
            button.classList.toggle('is-active', item.chapterId === readerState.activeChapterId);
            button.textContent = item.title || `第 ${index + 1} 章`;
            button.addEventListener('click', async () => {
                await loadReaderWorkspaceChapter(item.chapterId);
                setReaderDrawer('');
            });
            container.appendChild(button);
        });
    }

    function renderReaderWorkspace() {
        if (!readerState.apiMode || !readerState.currentChapter) return;
        const elements = readerElements();
        const chapter = readerState.currentChapter;
        const index = readerWorkspaceChapterIndex();
        if (elements.title) elements.title.textContent = chapter.title || `第 ${index + 1} 章`;
        if (elements.source) elements.source.textContent = `${readerState.documentMetadata.title} · ${index + 1} / ${readerState.contents.length}`;
        if (elements.progressLabel) elements.progressLabel.textContent = `${index + 1} / ${readerState.contents.length} 章`;
        if (elements.prev) elements.prev.disabled = index <= 0;
        if (elements.next) elements.next.disabled = index < 0 || index >= readerState.contents.length - 1;
        const selectionToggle = document.querySelector('[data-reader-selection-toggle]');
        if (selectionToggle) selectionToggle.disabled = false;
        if (typeof renderReaderReading === 'function') renderReaderReading({ locator: readerState.anchorLocator });
        renderReaderWorkspaceContents();
        renderReaderLibrary();
        updateReaderWorkspaceProgress();
    }

    function updateReaderWorkspaceProgress() {
        if (!readerState.apiMode) return;
        const elements = readerElements();
        const content = elements.content;
        const index = Math.max(0, readerWorkspaceChapterIndex());
        const maxScroll = content ? Math.max(0, content.scrollHeight - content.clientHeight) : 0;
        const layoutRatio = readerState.effectiveLayoutMode === 'flow'
            ? (maxScroll ? content.scrollTop / maxScroll : 0)
            : (readerState.pages.length > 1 ? readerState.pageIndex / (readerState.pages.length - 1) : 0);
        const totalWeight = readerState.contents.reduce((sum, chapter) => sum + Math.max(0, Number(chapter.characterCount) || 0), 0);
        const previousWeight = readerState.contents.slice(0, index).reduce((sum, chapter) => sum + Math.max(0, Number(chapter.characterCount) || 0), 0);
        const chapterWeight = Math.max(1, Number(readerState.contents[index] && readerState.contents[index].characterCount) || 1);
        const locator = typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : readerState.anchorLocator;
        const weighted = readerState.effectiveLayoutMode !== 'flow' && window.DraftHarborReaderNavigation && locator
            ? window.DraftHarborReaderNavigation.contentProgressForLocator(readerState.contents, readerState.currentChapter, locator)
            : (totalWeight > 0 ? (previousWeight + chapterWeight * layoutRatio) / totalWeight : 0);
        const percent = Math.max(0, Math.min(100, Math.round(weighted * 100)));
        if (elements.progress) elements.progress.value = percent;
        if (elements.progressPercent) elements.progressPercent.textContent = `${percent}%`;
        if (elements.positionLabel) elements.positionLabel.textContent = `本章 ${Math.round(layoutRatio * 100)}% · 全书 ${percent}%`;
        if (typeof updateReaderNavigationProgress === 'function') updateReaderNavigationProgress(weighted);
        if (typeof maybeShiftReaderFlowWindow === 'function') maybeShiftReaderFlowWindow();
        if (readerPositionSaveTimer) window.clearTimeout(readerPositionSaveTimer);
        readerPositionSaveTimer = window.setTimeout(saveReaderWorkspacePosition, 450);
    }

    function queueReaderDocumentStateWrite(changes = {}) {
        const documentId = readerState.activeDocumentId;
        const previousDraft = readerStateWriteDrafts.get(documentId);
        const queuedExisting = previousDraft && previousDraft.state || readerState.documentRecordState || {};
        const queuedLocator = changes.positionLocator !== undefined
            ? changes.positionLocator
            : (typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : null) || queuedExisting.positionLocator;
        const queuedOverrides = changes.preferenceOverrides !== undefined
            ? changes.preferenceOverrides : readerState.preferenceOverrides || queuedExisting.preferenceOverrides || {};
        const queuedBookmarks = changes.bookmarks !== undefined ? changes.bookmarks : queuedExisting.bookmarks || [];
        const revision = ++readerStateWriteRevision;
        const queuedState = {
            documentId,
            positionLocator: queuedLocator || null,
            updatedAt: new Date().toISOString(),
            preferenceOverrides: queuedOverrides,
            bookmarks: queuedBookmarks
        };
        readerStateWriteDrafts.set(documentId, { revision, state: queuedState });
        if (readerState.activeDocumentId === documentId) readerState.documentRecordState = queuedState;
        readerStateWriteQueue = readerStateWriteQueue.catch(() => null).then(async () => {
            if (!documentId) return null;
            try {
                const payload = await readerApi('/api/reader/state', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: queuedState })
                });
                const latest = readerStateWriteDrafts.get(documentId);
                if (latest && latest.revision === revision) {
                    readerStateWriteDrafts.delete(documentId);
                    if (readerState.activeDocumentId === documentId) readerState.documentRecordState = payload.state;
                }
                return payload.state;
            } catch (error) {
                const latest = readerStateWriteDrafts.get(documentId);
                if (latest && latest.revision === revision) {
                    readerStateWriteDrafts.delete(documentId);
                    if (readerState.activeDocumentId === documentId) readerState.documentRecordState = queuedExisting;
                }
                throw error;
            }
        });
        return readerStateWriteQueue;
    }

    async function saveReaderWorkspacePosition() {
        readerPositionSaveTimer = null;
        if (!readerState.apiMode || !readerState.currentChapter) return;
        const locator = typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : null;
        if (!locator) return;
        try {
            await queueReaderDocumentStateWrite({ positionLocator: locator });
        } catch (error) {
            console.warn('Failed to save reader position:', error);
        }
    }

    async function loadReaderWorkspaceChapter(chapterId, locator) {
        if (chapterId !== readerState.activeChapterId && typeof clearReaderTransferSelection === 'function') clearReaderTransferSelection();
        const payload = await readerApi(`/api/reader/chapter?documentId=${encodeURIComponent(readerState.activeDocumentId)}&revisionId=${encodeURIComponent(readerState.activeRevisionId)}&chapterId=${encodeURIComponent(chapterId)}`);
        readerState.activeChapterId = chapterId;
        readerState.currentChapter = payload.chapter;
        readerState.anchorLocator = locator && locator.chapterId === chapterId ? locator : null;
        readerState.pageIndex = 0;
        renderReaderWorkspace();
    }

    async function openReaderLibraryDocument(documentId) {
        try {
            const metadataPayload = await readerApi(`/api/reader/document?documentId=${encodeURIComponent(documentId)}`);
            const metadata = metadataPayload.metadata;
            const contentsPayload = await readerApi(`/api/reader/contents?documentId=${encodeURIComponent(documentId)}&revisionId=${encodeURIComponent(metadata.activeRevisionId)}`);
            const statePayload = await readerApi(`/api/reader/state?documentId=${encodeURIComponent(documentId)}`);
            readerState.apiMode = true;
            readerState.activeDocumentId = documentId;
            readerState.activeRevisionId = metadata.activeRevisionId;
            readerState.documentMetadata = metadata;
            readerState.contents = contentsPayload.contents.chapters || [];
            readerState.documentRecordState = statePayload.state;
            readerState.preferenceOverrides = statePayload.state && statePayload.state.preferenceOverrides || {};
            readerState.preferenceScope = Object.keys(readerState.preferenceOverrides).length ? 'document' : 'global';
            if (typeof applyReaderPreferenceModel === 'function') applyReaderPreferenceModel();
            const locator = statePayload.state && statePayload.state.positionLocator;
            const chapterId = locator && readerState.contents.some((item) => item.chapterId === locator.chapterId)
                ? locator.chapterId : readerState.contents[0] && readerState.contents[0].chapterId;
            if (!chapterId) throw new Error('文档没有可阅读章节');
            await loadReaderWorkspaceChapter(chapterId, locator);
            if (typeof initializeReaderNavigationDocument === 'function') initializeReaderNavigationDocument();
            setReaderDrawer('');
        } catch (error) {
            const content = document.querySelector('[data-reader-content]');
            if (content) content.textContent = `无法打开文档：${error.message || error}`;
        }
    }

    async function navigateReaderWorkspaceChapter(offset) {
        const next = readerState.contents[readerWorkspaceChapterIndex() + offset];
        if (next) await loadReaderWorkspaceChapter(next.chapterId);
    }

    function initializeReaderWorkspace() {
        const elements = readerWorkspaceElements();
        if (!elements.shell) return;
        loadReaderLibrary().then((documents) => {
            if (!readerState.document && !readerState.apiMode && documents[0]) {
                openReaderLibraryDocument(documents[0].documentId);
            }
        });
        if (typeof initializeReaderSettings === 'function') initializeReaderSettings();
        if (typeof initializeReaderNavigation === 'function') initializeReaderNavigation();
        if (typeof initializeReaderSelection === 'function') initializeReaderSelection();
        document.querySelector('[data-reader-exit]')?.addEventListener('click', () => setView('bookshelf'));
        elements.leftToggle?.addEventListener('click', (event) => setReaderDrawer(readerState.drawer === 'left' ? '' : 'left', event.currentTarget));
        elements.settingsToggle?.addEventListener('click', (event) => setReaderDrawer(readerState.drawer === 'right' ? '' : 'right', event.currentTarget));
        document.querySelector('[data-reader-left-close]')?.addEventListener('click', () => setReaderDrawer(''));
        document.querySelector('[data-reader-settings-close]')?.addEventListener('click', () => setReaderDrawer(''));
        document.querySelector('[data-reader-scrim]')?.addEventListener('click', () => setReaderDrawer(''));
        document.querySelector('[data-reader-empty-library]')?.addEventListener('click', (event) => setReaderDrawer('left', event.currentTarget));
        document.querySelectorAll('[data-reader-tab]').forEach((button) => {
            button.addEventListener('click', () => selectReaderLeftTab(button.dataset.readerTab));
            button.addEventListener('keydown', handleReaderTabKey);
        });
        document.addEventListener('keydown', handleReaderDrawerTab);
        elements.content?.addEventListener('dblclick', () => handleReaderWorkspaceEscape());
        document.querySelector('[data-reader-page-prev]')?.addEventListener('click', () => queueReaderPageTurn(-1));
        document.querySelector('[data-reader-page-next]')?.addEventListener('click', () => queueReaderPageTurn(1));
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (resizeTimer) window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                resizeTimer = null;
                if (readerState.apiMode && typeof scheduleReaderReflow === 'function') scheduleReaderReflow();
            }, 160);
        });
        if (document.fonts) {
            document.fonts.ready.then(() => {
                const content = document.querySelector('[data-reader-content]');
                const actual = typeof readerActualFontFamily === 'function' ? readerActualFontFamily(content) : '';
                if (actual && actual !== readerState.actualFontFamily) {
                    readerState.actualFontFamily = actual;
                    if (typeof clearReaderLayoutCache === 'function') clearReaderLayoutCache();
                    if (readerState.apiMode && typeof scheduleReaderReflow === 'function') scheduleReaderReflow();
                }
                if (typeof syncReaderSettingsControls === 'function') syncReaderSettingsControls();
            });
            document.fonts.addEventListener?.('loadingdone', () => {
                const content = document.querySelector('[data-reader-content]');
                const actual = typeof readerActualFontFamily === 'function' ? readerActualFontFamily(content) : '';
                if (actual && actual !== readerState.actualFontFamily) {
                    readerState.actualFontFamily = actual;
                    if (typeof clearReaderLayoutCache === 'function') clearReaderLayoutCache();
                    if (readerState.apiMode && typeof scheduleReaderReflow === 'function') scheduleReaderReflow();
                }
                if (typeof syncReaderSettingsControls === 'function') syncReaderSettingsControls();
            });
        }
        selectReaderLeftTab(readerState.leftTab);
    }
