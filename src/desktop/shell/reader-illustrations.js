(function attachReaderIllustrations(global) {
    'use strict';

    let initialized = false;

    function illustrationElements() {
        return {
            add: document.querySelector('[data-reader-illustration-add]'),
            file: document.querySelector('[data-reader-illustration-file]')
        };
    }

    function syncReaderIllustrationControls() {
        const elements = illustrationElements();
        const available = !!readerState.apiMode && !!readerState.activeDocumentId && readerState.layoutMode === 'illustrated';
        const selected = selectedReaderIllustrationAnchor();
        if (elements.add) {
            elements.add.disabled = !available || readerState.illustrationBusy;
            elements.add.textContent = readerState.illustrationBusy
                ? '正在保存…'
                : selected
                    ? '为所选段落配图'
                    : '为本页配图';
        }
    }

    function selectedReaderIllustrationAnchor() {
        const selected = readerState.illustrationAnchor;
        const page = readerState.pages && readerState.pages[readerState.pageIndex];
        const api = global.DraftHarborReaderIllustration;
        return selected && selected.chapterId === readerState.activeChapterId
            && api && api.pageContainsAnchor(page, selected) ? selected : null;
    }

    function currentReaderIllustrationAnchor() {
        const selected = selectedReaderIllustrationAnchor();
        if (selected) return selected;
        const page = readerState.pages && readerState.pages[readerState.pageIndex];
        return readerPageIllustrationAnchor(page);
    }

    function readerPageIllustrationAnchor(page) {
        const segment = page && page.segments && page.segments[0];
        const blocks = readerState.currentChapter && readerState.currentChapter.blocks || [];
        const block = segment && (blocks[segment.blockIndex]
            || blocks.find((candidate) => candidate.blockId === segment.blockId));
        if (!block) return null;
        const offset = Math.max(0, Number(segment.startOffset) || 0);
        return {
            chapterId: readerState.activeChapterId,
            blockId: block.blockId,
            offset,
            excerpt: String(block.text || '').slice(offset, offset + 80)
        };
    }

    function illustrationAssetUrl(item) {
        const params = new URLSearchParams({ documentId: readerState.activeDocumentId, assetId: item.assetId });
        return `/api/reader/illustrations/file?${params.toString()}`;
    }

    function createIllustrationFigure(item) {
        const figure = document.createElement('figure');
        figure.className = 'desktop-reader-illustration-figure';
        figure.dataset.readerIllustration = item.illustrationId;
        const image = document.createElement('img');
        image.src = illustrationAssetUrl(item);
        image.alt = item.caption || item.fileName || '阅读配图';
        image.loading = 'eager';
        image.decoding = 'async';
        image.dataset.readerIllustrationFit = item.fit || 'contain';
        const footer = document.createElement('figcaption');
        const label = document.createElement('span');
        label.textContent = item.caption || item.fileName || '阅读配图';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'desktop-reader-illustration-remove';
        remove.textContent = '移除';
        remove.setAttribute('aria-label', `移除配图 ${label.textContent}`);
        remove.addEventListener('click', () => removeReaderIllustration(item));
        footer.append(label, remove);
        figure.append(image, footer);
        return figure;
    }

    function createReaderIllustrationDropzone(page) {
        const zone = document.createElement('button');
        zone.type = 'button';
        zone.className = 'desktop-reader-illustration-dropzone';
        zone.dataset.readerIllustrationDropzone = '';
        zone.innerHTML = '<strong>＋ 当前页放置新图片</strong><span>点击选择，或把图片拖到这里</span>';
        const usePageAnchor = () => {
            const anchor = readerPageIllustrationAnchor(page);
            if (!anchor) return null;
            readerState.illustrationAnchor = anchor;
            syncReaderIllustrationControls();
            return anchor;
        };
        zone.addEventListener('click', () => {
            if (!usePageAnchor()) return;
            illustrationElements().file?.click();
        });
        zone.addEventListener('dragover', (event) => {
            event.preventDefault();
            if (!readerState.illustrationBusy) zone.classList.add('is-reader-dragover');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('is-reader-dragover'));
        zone.addEventListener('drop', async (event) => {
            event.preventDefault();
            zone.classList.remove('is-reader-dragover');
            if (!usePageAnchor()) return;
            await importReaderIllustrationFiles(event.dataTransfer && event.dataTransfer.files);
        });
        return zone;
    }

    function createReaderIllustrationPane(page) {
        const pane = document.createElement('aside');
        pane.className = 'desktop-reader-illustration-pane';
        pane.dataset.readerIllustrationPane = '';
        pane.setAttribute('aria-label', '当前阅读配图');
        const heading = document.createElement('header');
        const title = document.createElement('strong');
        title.textContent = '章节配图';
        const hint = document.createElement('span');
        hint.textContent = '每一页都可以设置不同图片';
        heading.append(title, hint);
        pane.append(heading, createReaderIllustrationDropzone(page));

        const api = global.DraftHarborReaderIllustration;
        const active = api && readerState.currentChapter
            ? api.activeIllustrationsForPage(readerState.illustrations, readerState.currentChapter, page)
            : [];
        if (!active.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-reader-illustration-empty';
            empty.innerHTML = '<span aria-hidden="true">◇</span><strong>这一页还没有配图</strong><p>使用上方投放区添加图片；翻到后面的页面可以继续设置新的图片。</p>';
            pane.appendChild(empty);
            return pane;
        }
        const gallery = document.createElement('div');
        gallery.className = 'desktop-reader-illustration-gallery';
        gallery.dataset.readerIllustrationCount = String(active.length);
        active.forEach((item) => gallery.appendChild(createIllustrationFigure(item)));
        pane.appendChild(gallery);
        const trigger = document.createElement('p');
        trigger.className = 'desktop-reader-illustration-trigger';
        trigger.textContent = active[0].excerpt ? `触发段落：${active[0].excerpt}` : '本页段落触发';
        pane.appendChild(trigger);
        return pane;
    }

    async function loadReaderIllustrationDocument(documentId) {
        readerState.illustrationRecord = null;
        readerState.illustrations = [];
        readerState.illustrationAnchor = null;
        if (!documentId) return;
        const payload = await global.readerApi(`/api/reader/illustrations?documentId=${encodeURIComponent(documentId)}`);
        if (readerState.activeDocumentId && readerState.activeDocumentId !== documentId) return;
        readerState.illustrationRecord = payload.record;
        readerState.illustrations = payload.record && payload.record.illustrations || [];
        syncReaderIllustrationControls();
    }

    function fileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(String(reader.result || '').split(',')[1] || ''), { once: true });
            reader.addEventListener('error', () => reject(reader.error || new Error('图片读取失败')), { once: true });
            reader.readAsDataURL(file);
        });
    }

    async function importReaderIllustrationFiles(files) {
        const anchor = currentReaderIllustrationAnchor();
        const existing = anchor ? readerState.illustrations.filter((item) => item.chapterId === anchor.chapterId
            && item.blockId === anchor.blockId && item.offset === anchor.offset).length : 0;
        const list = Array.from(files || []).slice(0, Math.max(0, 4 - existing));
        if (files && files.length && !list.length) global.alert('同一触发位置最多保存 4 张配图。');
        if (!list.length || !anchor || !readerState.activeDocumentId) return;
        readerState.illustrationBusy = true;
        syncReaderIllustrationControls();
        try {
            for (const file of list) {
                const payload = await global.readerApi('/api/reader/illustrations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ illustration: {
                        documentId: readerState.activeDocumentId,
                        ...anchor,
                        fileName: file.name,
                        bytes: await fileAsBase64(file)
                    } })
                });
                readerState.illustrationRecord = payload.record;
                readerState.illustrations = payload.record.illustrations || [];
            }
            if (typeof global.renderReaderReading === 'function') global.renderReaderReading({ locator: readerState.anchorLocator });
        } catch (error) {
            global.alert(`配图保存失败：${error.message || error}`);
        } finally {
            readerState.illustrationBusy = false;
            syncReaderIllustrationControls();
        }
    }

    async function removeReaderIllustration(item) {
        if (!global.confirm(`移除配图“${item.caption || item.fileName || '未命名'}”？`)) return;
        try {
            const payload = await global.readerApi('/api/reader/illustrations/delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentId: readerState.activeDocumentId, illustrationId: item.illustrationId })
            });
            readerState.illustrationRecord = payload.record;
            readerState.illustrations = payload.record && payload.record.illustrations || [];
            if (typeof global.renderReaderReading === 'function') global.renderReaderReading({ locator: readerState.anchorLocator });
        } catch (error) {
            global.alert(`移除配图失败：${error.message || error}`);
        }
    }

    function selectReaderIllustrationAnchor(blockNode) {
        const start = Math.max(0, Number(blockNode.dataset.readerStartOffset) || 0);
        readerState.illustrationAnchor = {
            chapterId: readerState.activeChapterId,
            blockId: blockNode.dataset.readerBlock,
            offset: start,
            excerpt: String(blockNode.textContent || '').trim().slice(0, 80)
        };
        document.querySelectorAll('[data-reader-block].is-reader-illustration-anchor').forEach((node) => node.classList.remove('is-reader-illustration-anchor'));
        blockNode.classList.add('is-reader-illustration-anchor');
        syncReaderIllustrationControls();
    }

    function decorateReaderIllustrationBlockNode(node, block, startOffset, endOffset) {
        const anchor = readerState.illustrationAnchor;
        if (readerState.layoutMode === 'illustrated' && anchor && anchor.chapterId === readerState.activeChapterId
            && anchor.blockId === block.blockId && anchor.offset >= startOffset && anchor.offset <= endOffset) {
            node.classList.add('is-reader-illustration-anchor');
        }
    }

    function appendReaderIllustrationPane(deck, page, effectiveMode) {
        if (effectiveMode === 'illustrated') deck.appendChild(createReaderIllustrationPane(page));
    }

    function initializeReaderIllustrations() {
        if (initialized) return;
        initialized = true;
        const elements = illustrationElements();
        elements.add?.addEventListener('click', () => elements.file?.click());
        elements.file?.addEventListener('change', async () => {
            await importReaderIllustrationFiles(elements.file.files);
            elements.file.value = '';
        });
        document.querySelector('[data-reader-content]')?.addEventListener('click', (event) => {
            if (readerState.layoutMode !== 'illustrated') return;
            const block = event.target.closest('[data-reader-block]');
            if (block) selectReaderIllustrationAnchor(block);
        });
        const openDocument = global.openReaderLibraryDocument;
        if (typeof openDocument === 'function') {
            global.openReaderLibraryDocument = async function openReaderDocumentWithIllustrations(documentId, token) {
                const opened = await openDocument(documentId, token);
                if (opened === false) return false;
                await loadReaderIllustrationDocument(documentId);
                if (readerState.activeDocumentId === documentId && typeof global.renderReaderReading === 'function') {
                    global.renderReaderReading({ locator: readerState.anchorLocator });
                }
                return opened;
            };
        }
        syncReaderIllustrationControls();
    }

    global.createReaderIllustrationPane = createReaderIllustrationPane;
    global.loadReaderIllustrationDocument = loadReaderIllustrationDocument;
    global.syncReaderIllustrationControls = syncReaderIllustrationControls;
    global.decorateReaderIllustrationBlockNode = decorateReaderIllustrationBlockNode;
    global.appendReaderIllustrationPane = appendReaderIllustrationPane;
    global.initializeReaderIllustrations = initializeReaderIllustrations;
})(window);
