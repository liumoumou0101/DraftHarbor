(function attachReaderIllustrations(global) {
    'use strict';

    let initialized = false;
    let loadRequestId = 0;
    let uploadContext = null;
    let mutation = null;
    let activeImages = [];
    let selectedImageId = '';
    let presentationDocumentId = '';
    let viewerImages = [];
    let viewerIndex = 0;
    let viewerDocumentId = '';
    let viewerReturnFocus = null;
    let viewerZoom = 1;
    let flowRefreshFrame = null;
    const documentChanges = new Map();

    function illustrationElements() {
        return {
            add: document.querySelector('[data-reader-illustration-add]'),
            file: document.querySelector('[data-reader-illustration-file]'),
            compact: document.querySelector('[data-reader-illustration-compact]'),
            view: document.querySelector('[data-reader-illustration-view]'),
            compactAdd: document.querySelector('[data-reader-illustration-compact-add]'),
            status: document.querySelector('[data-reader-illustration-status]'),
            viewer: document.querySelector('[data-reader-illustration-viewer]')
        };
    }

    function readerIllustrationMutationAllowed() {
        return !readerState.focusMode;
    }

    function requestedIllustrations() {
        return readerState.layoutMode === 'illustrated';
    }

    function compactIllustrations() {
        return readerState.effectiveLayoutMode !== 'illustrated' || global.innerWidth <= 760;
    }

    function contextCurrent(context) {
        return context.documentId === readerState.activeDocumentId && context.revisionId === readerState.activeRevisionId;
    }

    function setIllustrationStatus(message, context) {
        if (context && !contextCurrent(context)) return;
        const status = illustrationElements().status;
        if (status) status.textContent = message;
    }

    function visibleFlowPage() {
        const content = document.querySelector('[data-reader-content]');
        const chapter = readerState.currentChapter;
        if (!content || !chapter) return null;
        const bounds = content.getBoundingClientRect();
        const nodes = Array.from(content.querySelectorAll('[data-reader-block]')).filter(node => {
            const rect = node.getBoundingClientRect();
            return rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1;
        });
        const segments = nodes.map(node => {
            const block = chapter.blocks.find(item => item.blockId === node.dataset.readerBlock);
            const base = Math.max(0, Number(node.dataset.readerStartOffset) || 0);
            const limit = Math.min(block ? block.text.length : base + node.textContent.length, Number(node.dataset.readerEndOffset) || base + node.textContent.length);
            let startOffset = base;
            let endOffset = limit;
            if (typeof global.readerFlowVisibleOffset === 'function') {
                startOffset = Math.max(base, global.readerFlowVisibleOffset(node, bounds.top + 1));
            }
            if (typeof global.readerFlowVisibleEndOffset === 'function') endOffset = Math.min(limit, global.readerFlowVisibleEndOffset(node, bounds.bottom - 1));
            return { blockId: node.dataset.readerBlock, startOffset, endOffset };
        }).filter(segment => segment.endOffset > segment.startOffset);
        if (segments.length) return { segments };
        const locator = typeof global.captureReaderPositionLocator === 'function' ? global.captureReaderPositionLocator() : readerState.anchorLocator;
        const block = locator && chapter.blocks.find(item => item.blockId === locator.blockId);
        if (!block || !block.text.length) return null;
        const startOffset = Math.max(0, Math.min(block.text.length - 1, Number(locator.offset) || 0));
        return { segments: [{ blockId: block.blockId, startOffset, endOffset: Math.min(block.text.length, startOffset + 1) }] };
    }

    function captureIllustrationContext(page) {
        if (!readerState.apiMode || !readerState.activeDocumentId || !readerState.currentChapter) return null;
        const sourcePage = page || (readerState.effectiveLayoutMode === 'flow' ? visibleFlowPage() : readerState.pages?.[readerState.pageIndex]);
        const segments = (sourcePage?.segments || []).filter(segment => Number(segment.endOffset) > Number(segment.startOffset));
        if (!segments.length) return null;
        const first = segments[0];
        const last = segments[segments.length - 1];
        const block = readerState.currentChapter.blocks.find(item => item.blockId === first.blockId);
        if (!block) return null;
        const range = {
            start: { blockId: first.blockId, offset: Math.max(0, Number(first.startOffset) || 0) },
            end: { blockId: last.blockId, offset: Math.max(0, Number(last.endOffset) || 0) }
        };
        return {
            documentId: readerState.activeDocumentId,
            revisionId: readerState.activeRevisionId,
            chapterId: readerState.activeChapterId,
            blockId: range.start.blockId,
            offset: range.start.offset,
            excerpt: String(block.text || '').slice(range.start.offset, range.start.offset + 80),
            range
        };
    }

    function syncReaderIllustrationReadonlyState() {
        const readOnly = !readerIllustrationMutationAllowed();
        document.querySelectorAll('[data-reader-illustration-dropzone], .desktop-reader-illustration-remove, [data-reader-illustration-compact-add], [data-reader-illustration-viewer-remove]').forEach(control => {
            control.disabled = readOnly || !!readerState.illustrationBusy;
            control.setAttribute('aria-hidden', readOnly ? 'true' : 'false');
            if (control.matches('[data-reader-illustration-viewer-remove], [data-reader-illustration-compact-add]')) control.hidden = readOnly;
        });
    }

    function syncReaderIllustrationControls() {
        const elements = illustrationElements();
        const available = !!readerState.apiMode && !!readerState.activeDocumentId && requestedIllustrations() && readerIllustrationMutationAllowed() && !!captureIllustrationContext();
        if (elements.add) {
            elements.add.disabled = !available || !!readerState.illustrationBusy;
            elements.add.textContent = readerState.illustrationBusy ? '正在保存…' : '配图';
        }
        if (elements.compact) elements.compact.hidden = !requestedIllustrations() || !compactIllustrations() || (!activeImages.length && !available);
        if (elements.view) {
            elements.view.disabled = !activeImages.length;
            elements.view.textContent = `查看配图${activeImages.length ? ` ${activeImages.length}` : ''}`;
        }
        if (elements.compactAdd) elements.compactAdd.disabled = !available || !!readerState.illustrationBusy;
        syncReaderIllustrationReadonlyState();
        if (elements.viewer?.open && viewerDocumentId !== readerState.activeDocumentId) closeIllustrationViewer(false);
    }

    function illustrationAssetUrl(item) {
        const params = new URLSearchParams({ documentId: item.documentId || readerState.activeDocumentId, assetId: item.assetId });
        return `/api/reader/illustrations/file?${params.toString()}`;
    }

    function imageLabel(item) {
        return item.caption || item.fileName || '阅读配图';
    }

    function isolateIllustrationInput(node) {
        ['wheel', 'pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'keydown', 'dblclick'].forEach(type => {
            node.addEventListener(type, event => event.stopPropagation());
        });
    }

    function showImage(image, status, retry, item) {
        status.textContent = '正在载入图片…';
        retry.hidden = true;
        image.alt = imageLabel(item);
        image.dataset.readerIllustrationId = item.illustrationId;
        image.hidden = false;
        image.onload = () => { status.textContent = ''; image.hidden = false; };
        image.onerror = () => { image.hidden = true; status.textContent = '图片加载失败。'; retry.hidden = false; };
        const url = illustrationAssetUrl(item);
        retry.onclick = () => { image.src = ''; image.src = url; status.textContent = '正在载入图片…'; retry.hidden = true; };
        image.src = url;
    }

    function selectActiveImages(page) {
        const api = global.DraftHarborReaderIllustration;
        if (presentationDocumentId !== readerState.activeDocumentId) selectedImageId = '';
        presentationDocumentId = readerState.activeDocumentId;
        activeImages = api && readerState.currentChapter && page
            ? api.activeIllustrationsForPage((readerState.illustrations || []).filter(item => item.documentId === readerState.activeDocumentId), readerState.currentChapter, page, { revisionId: readerState.activeRevisionId }) : [];
        if (!activeImages.some(item => item.illustrationId === selectedImageId)) selectedImageId = activeImages[0]?.illustrationId || '';
        return activeImages;
    }

    function chooseFiles(page) {
        if (!readerIllustrationMutationAllowed() || readerState.illustrationBusy) return;
        uploadContext = captureIllustrationContext(page);
        if (uploadContext) illustrationElements().file?.click();
    }

    function bindIllustrationDropTarget(node, page) {
        node.addEventListener('dragover', event => {
            if (!readerIllustrationMutationAllowed()) return;
            event.preventDefault();
            event.stopPropagation();
            if (!readerState.illustrationBusy) node.classList.add('is-reader-dragover');
        });
        node.addEventListener('dragleave', () => node.classList.remove('is-reader-dragover'));
        node.addEventListener('drop', async event => {
            event.preventDefault();
            event.stopPropagation();
            node.classList.remove('is-reader-dragover');
            await importReaderIllustrationFiles(event.dataTransfer?.files, captureIllustrationContext(page));
        });
    }

    function createReaderIllustrationPane(page) {
        const images = selectActiveImages(page);
        if (!images.length) return null;
        const pane = document.createElement('aside');
        pane.className = 'desktop-reader-illustration-pane';
        pane.dataset.readerIllustrationPane = '';
        pane.dataset.readerIllustrationInput = '';
        pane.setAttribute('aria-label', '当前阅读配图');
        isolateIllustrationInput(pane);
        bindIllustrationDropTarget(pane, page);
        const stage = document.createElement('button');
        stage.type = 'button';
        stage.className = 'desktop-reader-illustration-image-button';
        stage.dataset.readerIllustrationOpen = '';
        stage.setAttribute('aria-label', '放大当前配图');
        const image = document.createElement('img');
        image.dataset.readerIllustrationMain = '';
        image.decoding = 'async';
        stage.appendChild(image);
        const status = document.createElement('span');
        status.className = 'desktop-reader-illustration-image-status';
        status.setAttribute('aria-live', 'polite');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重试';
        retry.hidden = true;
        retry.className = 'desktop-reader-tool';
        const controls = document.createElement('div');
        controls.className = 'desktop-reader-illustration-controls';
        const makeButton = (hook, label) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'desktop-reader-tool';
            button.dataset[hook] = '';
            button.textContent = label;
            return button;
        };
        const previous = makeButton('readerIllustrationPrev', '上一张');
        const count = document.createElement('span');
        count.dataset.readerIllustrationCount = '';
        count.setAttribute('aria-live', 'polite');
        const next = makeButton('readerIllustrationNext', '下一张');
        const add = makeButton('readerIllustrationDropzone', '添加');
        add.classList.add('desktop-reader-illustration-dropzone');
        const remove = makeButton('readerIllustrationRemove', '移除');
        remove.classList.add('desktop-reader-illustration-remove');
        const render = () => {
            const index = Math.max(0, images.findIndex(item => item.illustrationId === selectedImageId));
            const item = images[index];
            previous.disabled = index === 0;
            next.disabled = index === images.length - 1;
            count.textContent = `${index + 1} / ${images.length}`;
            remove.setAttribute('aria-label', `移除配图 ${imageLabel(item)}`);
            showImage(image, status, retry, item);
            stage.onclick = () => openIllustrationViewer(images, index, stage);
            remove.onclick = () => removeReaderIllustration(item);
        };
        previous.onclick = () => { const index = images.findIndex(item => item.illustrationId === selectedImageId); selectedImageId = images[Math.max(0, index - 1)].illustrationId; render(); };
        next.onclick = () => { const index = images.findIndex(item => item.illustrationId === selectedImageId); selectedImageId = images[Math.min(images.length - 1, index + 1)].illustrationId; render(); };
        add.onclick = () => chooseFiles(page);
        controls.append(previous, count, next, add, remove);
        pane.append(stage, status, retry, controls);
        render();
        return pane;
    }

    function refreshReaderIllustrationFlow() {
        if (readerState.effectiveLayoutMode !== 'flow') return;
        selectActiveImages(requestedIllustrations() ? visibleFlowPage() : null);
        syncReaderIllustrationControls();
    }

    function appendReaderIllustrationPane(deck, page, effectiveMode) {
        if (!requestedIllustrations()) {
            delete deck.dataset.readerIllustrations;
            selectActiveImages(null);
            syncReaderIllustrationControls();
            return 0;
        }
        const images = selectActiveImages(page);
        deck.dataset.readerIllustrations = images.length ? 'active' : 'empty';
        if (effectiveMode === 'illustrated') {
            const pane = createReaderIllustrationPane(page);
            if (pane) deck.appendChild(pane);
        }
        syncReaderIllustrationControls();
        return images.length;
    }

    function applyViewerZoom() {
        const dialog = illustrationElements().viewer;
        const image = dialog?.querySelector('[data-reader-illustration-viewer-image]');
        const viewport = dialog?.querySelector('[data-reader-illustration-viewer-viewport]');
        const scale = dialog?.querySelector('[data-reader-illustration-zoom-value]');
        if (!image || !viewport) return;
        const width = Math.min(image.naturalWidth || viewport.clientWidth, Math.max(1, viewport.clientWidth - 24));
        const height = Math.min(image.naturalHeight || viewport.clientHeight, Math.max(1, viewport.clientHeight - 24));
        const fit = Math.min(width / (image.naturalWidth || 1), height / (image.naturalHeight || 1));
        image.style.width = `${Math.max(1, (image.naturalWidth || width) * fit * viewerZoom)}px`;
        image.style.height = 'auto';
        if (scale) scale.textContent = `${Math.round(viewerZoom * 100)}%`;
    }

    function renderIllustrationViewer() {
        const dialog = illustrationElements().viewer;
        const item = viewerImages[viewerIndex];
        if (!dialog || !item) return;
        const image = dialog.querySelector('[data-reader-illustration-viewer-image]');
        const status = dialog.querySelector('[data-reader-illustration-viewer-status]');
        const retry = dialog.querySelector('[data-reader-illustration-viewer-retry]');
        dialog.querySelector('[data-reader-illustration-viewer-count]').textContent = `${viewerIndex + 1} / ${viewerImages.length}`;
        dialog.querySelector('[data-reader-illustration-viewer-prev]').disabled = viewerIndex === 0;
        dialog.querySelector('[data-reader-illustration-viewer-next]').disabled = viewerIndex === viewerImages.length - 1;
        dialog.querySelector('[data-reader-illustration-viewer-caption]').textContent = imageLabel(item);
        const remove = dialog.querySelector('[data-reader-illustration-viewer-remove]');
        remove.disabled = !readerIllustrationMutationAllowed() || !!readerState.illustrationBusy;
        remove.hidden = !readerIllustrationMutationAllowed();
        remove.onclick = () => removeReaderIllustration(item);
        viewerZoom = 1;
        showImage(image, status, retry, item);
        const loaded = image.onload;
        image.onload = () => { loaded(); applyViewerZoom(); };
        applyViewerZoom();
        dialog.querySelector('[data-reader-illustration-viewer-viewport]').scrollTo(0, 0);
    }

    function openIllustrationViewer(images = activeImages, index = 0, trigger = document.activeElement) {
        const dialog = illustrationElements().viewer;
        if (!dialog || !images.length) return;
        const theme = document.querySelector('[data-reader-theme-panel]');
        if (theme) {
            const style = getComputedStyle(theme);
            ['--reader-page', '--reader-text', '--reader-line', '--reader-mutedText', '--reader-accent'].forEach(name => dialog.style.setProperty(name, style.getPropertyValue(name)));
        }
        viewerImages = [...images];
        viewerIndex = Math.max(0, Math.min(images.length - 1, index));
        viewerDocumentId = readerState.activeDocumentId;
        viewerReturnFocus = trigger;
        renderIllustrationViewer();
        if (!dialog.open) dialog.showModal();
        dialog.querySelector('[data-reader-illustration-viewer-close]')?.focus();
    }

    function closeIllustrationViewer(restoreFocus = true) {
        const dialog = illustrationElements().viewer;
        const target = viewerReturnFocus;
        viewerReturnFocus = null;
        if (dialog?.open) dialog.close();
        if (restoreFocus && target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
        else if (restoreFocus) document.querySelector('[data-reader-content]')?.focus({ preventScroll: true });
    }

    async function loadReaderIllustrationDocument(documentId) {
        if (documentId !== readerState.activeDocumentId) return;
        const requestId = ++loadRequestId;
        const revisionId = readerState.activeRevisionId;
        readerState.illustrationRecord = null;
        readerState.illustrations = [];
        readerState.illustrationAnchor = null;
        selectActiveImages(null);
        syncReaderIllustrationControls();
        if (!documentId) return;
        while (requestId === loadRequestId && contextCurrent({ documentId, revisionId })) {
            const changeVersion = documentChanges.get(documentId) || 0;
            const payload = await global.readerApi(`/api/reader/illustrations?documentId=${encodeURIComponent(documentId)}`);
            if (requestId !== loadRequestId || !contextCurrent({ documentId, revisionId })) return;
            if (changeVersion !== (documentChanges.get(documentId) || 0)) continue;
            readerState.illustrationRecord = payload.record;
            readerState.illustrations = payload.record?.illustrations || [];
            syncReaderIllustrationControls();
            return;
        }
    }

    function fileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(String(reader.result || '').split(',')[1] || ''), { once: true });
            reader.addEventListener('error', () => reject(reader.error || new Error('图片读取失败')), { once: true });
            reader.readAsDataURL(file);
        });
    }

    function refreshIllustrationPresentation() {
        if (readerState.effectiveLayoutMode === 'flow') {
            refreshReaderIllustrationFlow();
            return;
        }
        if (typeof global.renderReaderReading === 'function') global.renderReaderReading({ locator: readerState.anchorLocator });
    }

    async function importReaderIllustrationFiles(files, context = captureIllustrationContext()) {
        if (!readerIllustrationMutationAllowed() || mutation || !context) return;
        const list = Array.from(files || []);
        if (!list.length) return;
        const frozen = structuredClone(context);
        const operation = {};
        mutation = operation;
        readerState.illustrationBusy = true;
        syncReaderIllustrationControls();
        let saved = 0;
        let errorMessage = '';
        try {
            for (const file of list) {
                const bytes = await fileAsBase64(file);
                const payload = await global.readerApi('/api/reader/illustrations', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ illustration: { ...frozen, fileName: file.name, bytes } })
                });
                saved += 1;
                documentChanges.set(frozen.documentId, (documentChanges.get(frozen.documentId) || 0) + 1);
                if (!contextCurrent(frozen)) continue;
                readerState.illustrationRecord = payload.record;
                readerState.illustrations = payload.record?.illustrations || [];
            }
            if (contextCurrent(frozen)) refreshIllustrationPresentation();
        } catch (error) {
            errorMessage = error.message || String(error);
            if (contextCurrent(frozen) && saved) refreshIllustrationPresentation();
        } finally {
            if (mutation === operation) mutation = null;
            readerState.illustrationBusy = false;
            syncReaderIllustrationControls();
            setIllustrationStatus(errorMessage ? `已保存 ${saved} 张，配图保存失败：${errorMessage}` : `已添加 ${saved} 张配图。`, frozen);
        }
    }

    async function removeReaderIllustration(item) {
        if (!readerIllustrationMutationAllowed() || mutation) return;
        if (!global.confirm(`移除配图“${imageLabel(item)}”？`)) return;
        const context = { documentId: readerState.activeDocumentId, revisionId: readerState.activeRevisionId };
        const operation = {};
        mutation = operation;
        readerState.illustrationBusy = true;
        syncReaderIllustrationControls();
        try {
            const payload = await global.readerApi('/api/reader/illustrations/delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentId: context.documentId, illustrationId: item.illustrationId })
            });
            documentChanges.set(context.documentId, (documentChanges.get(context.documentId) || 0) + 1);
            if (!contextCurrent(context)) return;
            readerState.illustrationRecord = payload.record;
            readerState.illustrations = payload.record?.illustrations || [];
            viewerImages = viewerImages.filter(image => image.illustrationId !== item.illustrationId);
            if (illustrationElements().viewer?.open) {
                if (!viewerImages.length) closeIllustrationViewer();
                else { viewerIndex = Math.min(viewerIndex, viewerImages.length - 1); renderIllustrationViewer(); }
            }
            refreshIllustrationPresentation();
            setIllustrationStatus('配图已移除。', context);
        } catch (error) {
            setIllustrationStatus(`移除配图失败：${error.message || error}`, context);
        } finally {
            if (mutation === operation) mutation = null;
            readerState.illustrationBusy = false;
            syncReaderIllustrationControls();
        }
    }

    function decorateReaderIllustrationBlockNode(node, block, startOffset, endOffset) {
        const anchor = readerState.illustrationAnchor;
        if (requestedIllustrations() && anchor && anchor.chapterId === readerState.activeChapterId
            && anchor.blockId === block.blockId && anchor.offset >= startOffset && anchor.offset < endOffset) node.classList.add('is-reader-illustration-anchor');
    }

    function initializeReaderIllustrations() {
        if (initialized) return;
        initialized = true;
        const elements = illustrationElements();
        elements.add?.addEventListener('click', () => chooseFiles());
        elements.compactAdd?.addEventListener('click', () => chooseFiles());
        elements.view?.addEventListener('click', event => openIllustrationViewer(activeImages, Math.max(0, activeImages.findIndex(item => item.illustrationId === selectedImageId)), event.currentTarget));
        elements.file?.addEventListener('change', async () => {
            const context = uploadContext || captureIllustrationContext();
            uploadContext = null;
            await importReaderIllustrationFiles(elements.file.files, context);
            elements.file.value = '';
        });
        elements.file?.addEventListener('cancel', () => { uploadContext = null; });
        const content = document.querySelector('[data-reader-content]');
        if (content) {
            content.addEventListener('scroll', () => {
                if (flowRefreshFrame || !requestedIllustrations() || readerState.effectiveLayoutMode !== 'flow') return;
                flowRefreshFrame = global.requestAnimationFrame(() => { flowRefreshFrame = null; refreshReaderIllustrationFlow(); });
            }, { passive: true });
            content.addEventListener('dragover', event => { if (requestedIllustrations() && readerIllustrationMutationAllowed()) event.preventDefault(); });
            content.addEventListener('drop', event => {
                if (!requestedIllustrations()) return;
                event.preventDefault();
                importReaderIllustrationFiles(event.dataTransfer?.files);
            });
        }
        if (elements.compact) isolateIllustrationInput(elements.compact);
        const dialog = elements.viewer;
        if (dialog) {
            isolateIllustrationInput(dialog);
            dialog.querySelector('[data-reader-illustration-viewer-close]')?.addEventListener('click', () => closeIllustrationViewer());
            dialog.addEventListener('cancel', event => { event.preventDefault(); closeIllustrationViewer(); });
            dialog.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); closeIllustrationViewer(); }
            });
            dialog.querySelector('[data-reader-illustration-viewer-prev]')?.addEventListener('click', () => { viewerIndex = Math.max(0, viewerIndex - 1); renderIllustrationViewer(); });
            dialog.querySelector('[data-reader-illustration-viewer-next]')?.addEventListener('click', () => { viewerIndex = Math.min(viewerImages.length - 1, viewerIndex + 1); renderIllustrationViewer(); });
            dialog.querySelector('[data-reader-illustration-zoom-in]')?.addEventListener('click', () => { viewerZoom = Math.min(8, viewerZoom * 1.25); applyViewerZoom(); });
            dialog.querySelector('[data-reader-illustration-zoom-out]')?.addEventListener('click', () => { viewerZoom = Math.max(0.25, viewerZoom / 1.25); applyViewerZoom(); });
            dialog.querySelector('[data-reader-illustration-zoom-reset]')?.addEventListener('click', () => { viewerZoom = 1; applyViewerZoom(); });
        }
        global.addEventListener('resize', () => { syncReaderIllustrationControls(); if (dialog?.open) applyViewerZoom(); });
        const openDocument = global.openReaderLibraryDocument;
        if (typeof openDocument === 'function') {
            global.openReaderLibraryDocument = async function openReaderDocumentWithIllustrations(documentId, token) {
                const opened = await openDocument(documentId, token);
                if (opened === false || readerState.activeDocumentId !== documentId) return opened;
                await loadReaderIllustrationDocument(documentId);
                if (readerState.activeDocumentId === documentId) refreshIllustrationPresentation();
                return opened;
            };
        }
        syncReaderIllustrationControls();
    }

    global.createReaderIllustrationPane = createReaderIllustrationPane;
    global.loadReaderIllustrationDocument = loadReaderIllustrationDocument;
    global.syncReaderIllustrationControls = syncReaderIllustrationControls;
    global.syncReaderIllustrationReadonlyState = syncReaderIllustrationReadonlyState;
    global.decorateReaderIllustrationBlockNode = decorateReaderIllustrationBlockNode;
    global.appendReaderIllustrationPane = appendReaderIllustrationPane;
    global.refreshReaderIllustrationFlow = refreshReaderIllustrationFlow;
    global.initializeReaderIllustrations = initializeReaderIllustrations;
})(window);
