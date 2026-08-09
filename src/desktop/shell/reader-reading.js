    /* global readerCanPageTurn readerReducedMotionActive */

    let readerReflowTimer = null;
    let readerFlowShiftFrame = null;

    function createReaderBlockNode(block, startOffset = 0, endOffset) {
        const heading = block.type === 'heading' || block.type === 'scene-title';
        const node = document.createElement(heading ? 'h3' : 'p');
        const limit = endOffset === undefined ? String(block.text || '').length : endOffset;
        node.dataset.readerBlock = block.blockId;
        node.dataset.readerBlockType = block.type || 'paragraph';
        node.dataset.readerStartOffset = String(startOffset);
        node.dataset.readerEndOffset = String(limit);
        node.textContent = String(block.text || '').slice(startOffset, limit);
        return node;
    }

    function createReaderLocatorAt(blockId, offset = 0) {
        const chapter = readerState.currentChapter;
        if (!chapter || !window.DraftHarborReaderLocator) return null;
        try {
            return window.DraftHarborReaderLocator.locatorFromBlockPosition({
                documentId: readerState.activeDocumentId,
                chapterId: readerState.activeChapterId,
                blockId,
                offset
            }, { revisionId: readerState.activeRevisionId, chapters: [chapter] });
        } catch (error) {
            console.warn('Failed to create reader locator:', error);
            return null;
        }
    }

    function captureReaderPositionLocator() {
        if (!readerState.apiMode || !readerState.currentChapter) return null;
        if (readerState.effectiveLayoutMode !== 'flow') {
            const spreadSize = readerState.effectiveLayoutMode === 'double-page' ? 2 : 1;
            if (readerState.anchorLocator) {
                const anchorPage = window.DraftHarborReaderLayout.pageIndexForLocator(readerState.pages, readerState.anchorLocator);
                if (anchorPage >= readerState.pageIndex && anchorPage < readerState.pageIndex + spreadSize) {
                    return readerState.anchorLocator;
                }
            }
            const position = window.DraftHarborReaderLayout.locatorPositionForPage(readerState.pages, readerState.pageIndex);
            return position ? createReaderLocatorAt(position.blockId, position.offset) : null;
        }
        const content = document.querySelector('[data-reader-content]');
        if (!content) return null;
        const contentTop = content.getBoundingClientRect().top;
        const nodes = Array.from(content.querySelectorAll('[data-reader-block]'));
        const visible = nodes.find((node) => node.getBoundingClientRect().bottom > contentTop + 8) || nodes[0];
        return visible ? createReaderLocatorAt(visible.dataset.readerBlock, Number(visible.dataset.readerStartOffset) || 0) : null;
    }

    function readerActualFontFamily(content) {
        if (!content) return readerFontStack();
        const stack = getComputedStyle(content).fontFamily || readerFontStack();
        if (!document.fonts || typeof document.fonts.check !== 'function') return stack;
        const candidates = stack.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        const actual = candidates.find((family) => {
            if (/^(serif|sans-serif|system-ui)$/i.test(family)) return true;
            try { return document.fonts.check(`16px "${family.replace(/"/g, '')}"`); } catch { return false; }
        }) || stack;
        const preferred = candidates[0] || '';
        readerState.fontFallback = !!preferred && actual !== preferred;
        return actual;
    }

    function readerLayoutMetrics() {
        const content = document.querySelector('[data-reader-content]');
        const width = content ? content.clientWidth : 900;
        const height = content ? content.clientHeight : 700;
        let effective = window.DraftHarborReaderLayout.effectiveLayoutMode(readerState.layoutMode, width, {
            minimumPageWidth: 360,
            minimumForcedPageWidth: 220,
            gap: readerState.bookSpine || 28
        });
        if (effective !== 'flow' && height < 420) effective = 'flow';
        const gap = Math.max(0, Math.min(96, Number(readerState.bookSpine) || 28));
        const pageWidth = effective === 'double-page' ? Math.max(220, (width - gap - 48) / 2) : Math.min(980, Math.max(320, width - 48));
        const pageHeight = Math.max(120, height - 36);
        const actualFontFamily = readerActualFontFamily(content);
        return { content, width, height, effective, gap, pageWidth, pageHeight, actualFontFamily };
    }

    function readerLayoutKey(metrics) {
        return window.DraftHarborReaderLayout.layoutCacheKey({
            revisionId: readerState.activeRevisionId,
            chapterId: readerState.activeChapterId,
            requestedMode: readerState.layoutMode,
            effectiveMode: metrics.effective,
            viewportWidth: metrics.width,
            viewportHeight: metrics.height,
            actualFontFamily: metrics.actualFontFamily,
            fontCatalogVersion: readerState.fontCatalogVersion || 1,
            fontWeight: readerState.fontWeight || 400,
            bookSpine: readerState.bookSpine || 28,
            orphanLines: readerState.orphanLines || 2,
            widowLines: readerState.widowLines || 2,
            fontSize: readerState.fontSize,
            lineHeight: readerState.lineHeight,
            letterSpacing: readerState.letterSpacing || 0,
            paragraphSpacing: readerState.paragraphSpacing,
            pageMargin: readerState.pageMargin || 48,
            textAlign: readerState.textAlign || 'start',
            indent: readerState.indent
        });
    }

    function cacheReaderPages(key, pages) {
        readerState.layoutCache.set(key, pages);
        while (readerState.layoutCache.size > 16) {
            readerState.layoutCache.delete(readerState.layoutCache.keys().next().value);
        }
    }

    function validReaderPages(pages) {
        return Array.isArray(pages) && pages.length > 0 && pages.every((page, index) => (
            page && page.pageIndex === index && Array.isArray(page.segments)
        ));
    }

    function clearReaderLayoutCache() {
        readerState.layoutCache.clear();
    }

    function estimatedReaderBlockHeight(block, contentWidth) {
        const fontSize = readerState.fontSize || 18;
        const lineHeight = fontSize * (readerState.lineHeight || 1.8);
        const charsPerLine = Math.max(8, Math.floor(Math.max(240, contentWidth) / (fontSize * 0.95)));
        const lines = Math.max(1, Math.ceil(String(block.text || '').length / charsPerLine));
        return lines * lineHeight + lineHeight * (readerState.paragraphSpacing || 1.05);
    }

    function setReaderFlowScrollTop(content, value) {
        if (!content) return;
        const previousScrollBehavior = content.style.scrollBehavior;
        content.style.scrollBehavior = 'auto';
        content.scrollTop = value;
        window.requestAnimationFrame(() => {
            if (previousScrollBehavior) content.style.scrollBehavior = previousScrollBehavior;
            else content.style.removeProperty('scroll-behavior');
        });
    }

    function renderReaderFlow(locator, options = {}) {
        const content = document.querySelector('[data-reader-content]');
        const blocks = readerState.currentChapter.blocks || [];
        const anchorIndex = Math.max(0, blocks.findIndex((block) => block.blockId === (locator && locator.blockId)));
        const range = window.DraftHarborReaderLayout.flowWindowForAnchor(blocks.length, anchorIndex);
        const previousRatio = options.preserveRatio && content.scrollHeight > content.clientHeight
            ? content.scrollTop / (content.scrollHeight - content.clientHeight)
            : null;
        readerState.virtualWindow = range;
        content.replaceChildren();
        const width = Math.max(320, Math.min(readerState.textWidth || 760, content.clientWidth - 48));
        const topHeight = blocks.slice(0, range.start).reduce((sum, block) => sum + estimatedReaderBlockHeight(block, width), 0);
        const bottomHeight = blocks.slice(range.end).reduce((sum, block) => sum + estimatedReaderBlockHeight(block, width), 0);
        const topSpacer = document.createElement('div');
        topSpacer.className = 'desktop-reader-virtual-spacer';
        topSpacer.dataset.readerVirtualSpacer = 'top';
        topSpacer.style.height = `${Math.round(topHeight)}px`;
        content.appendChild(topSpacer);
        blocks.slice(range.start, range.end).forEach((block) => content.appendChild(createReaderBlockNode(block)));
        const bottomSpacer = document.createElement('div');
        bottomSpacer.className = 'desktop-reader-virtual-spacer';
        bottomSpacer.dataset.readerVirtualSpacer = 'bottom';
        bottomSpacer.style.height = `${Math.round(bottomHeight)}px`;
        content.appendChild(bottomSpacer);
        if (previousRatio !== null) {
            const max = Math.max(0, content.scrollHeight - content.clientHeight);
            setReaderFlowScrollTop(content, max * previousRatio);
        } else if (locator && locator.blockId) {
            window.requestAnimationFrame(() => {
                const target = content.querySelector(`[data-reader-block="${CSS.escape(locator.blockId)}"]`);
                if (target) target.scrollIntoView({ block: 'start', behavior: 'auto' });
            });
        } else {
            setReaderFlowScrollTop(content, 0);
        }
    }

    function renderReaderPage(page, pageNumber) {
        const pageNode = document.createElement('section');
        pageNode.className = 'desktop-reader-page';
        pageNode.dataset.readerPage = String(pageNumber);
        pageNode.setAttribute('aria-label', `第 ${pageNumber + 1} 页`);
        if (!page || !page.segments.length) {
            const empty = document.createElement('p');
            empty.textContent = '这一页暂时没有正文。';
            pageNode.appendChild(empty);
            return pageNode;
        }
        page.segments.forEach((segment) => {
            const block = readerState.currentChapter.blocks[segment.blockIndex];
            if (block) pageNode.appendChild(createReaderBlockNode(block, segment.startOffset, segment.endOffset));
        });
        return pageNode;
    }

    function updateReaderPageControls() {
        const paged = readerState.effectiveLayoutMode !== 'flow';
        const controls = document.querySelector('[data-reader-page-controls]');
        const previous = document.querySelector('[data-reader-page-prev]');
        const next = document.querySelector('[data-reader-page-next]');
        const label = document.querySelector('[data-reader-page-label]');
        if (controls) controls.hidden = !paged;
        const touchPrevious = document.querySelector('[data-reader-touch-prev]');
        const touchNext = document.querySelector('[data-reader-touch-next]');
        if (touchPrevious) touchPrevious.hidden = !paged;
        if (touchNext) touchNext.hidden = !paged;
        if (!paged) return;
        const spreadSize = readerState.effectiveLayoutMode === 'double-page' ? 2 : 1;
        const lastVisible = Math.min(readerState.pages.length, readerState.pageIndex + spreadSize);
        if (label) label.textContent = spreadSize === 2
            ? `第 ${readerState.pageIndex + 1}–${lastVisible} / ${readerState.pages.length} 页`
            : `第 ${readerState.pageIndex + 1} / ${readerState.pages.length} 页`;
        if (previous) previous.disabled = readerState.pageIndex <= 0;
        if (next) next.disabled = readerState.pageIndex + spreadSize >= readerState.pages.length;
        if (touchPrevious) touchPrevious.disabled = readerState.pageIndex <= 0;
        if (touchNext) touchNext.disabled = readerState.pageIndex + spreadSize >= readerState.pages.length;
    }

    function renderReaderPages(locator) {
        const metrics = readerLayoutMetrics();
        const content = metrics.content;
        const key = readerLayoutKey(metrics);
        let pages = readerState.layoutCache.get(key);
        if (!validReaderPages(pages)) {
            readerState.layoutCache.delete(key);
            const capacity = window.DraftHarborReaderLayout.estimatePageCapacity({
                pageWidth: metrics.pageWidth,
                pageHeight: metrics.pageHeight,
                fontSize: readerState.fontSize,
                lineHeight: readerState.lineHeight,
                fontWeight: readerState.fontWeight || 400,
                bookSpine: readerState.bookSpine || 28,
                orphanLines: readerState.orphanLines || 2,
                widowLines: readerState.widowLines || 2,
                letterSpacing: readerState.letterSpacing || 0,
                pageMargin: readerState.pageMargin || 48
            });
            pages = window.DraftHarborReaderLayout.buildReaderPages(readerState.currentChapter, { capacity });
            cacheReaderPages(key, pages);
        }
        readerState.pages = pages;
        readerState.actualFontFamily = metrics.actualFontFamily;
        if (typeof syncReaderSettingsControls === 'function') syncReaderSettingsControls();
        let pageIndex = locator
            ? window.DraftHarborReaderLayout.pageIndexForLocator(pages, locator)
            : Math.max(0, Math.min(pages.length - 1, readerState.pageIndex || 0));
        if (metrics.effective === 'double-page') pageIndex -= pageIndex % 2;
        readerState.pageIndex = pageIndex;
        content.replaceChildren();
        const deck = document.createElement('div');
        deck.className = 'desktop-reader-page-deck';
        deck.dataset.readerSpread = metrics.effective === 'double-page' ? 'double' : 'single';
        deck.appendChild(renderReaderPage(pages[pageIndex], pageIndex));
        if (metrics.effective === 'double-page' && pages[pageIndex + 1]) deck.appendChild(renderReaderPage(pages[pageIndex + 1], pageIndex + 1));
        content.appendChild(deck);
        const spreadSize = metrics.effective === 'double-page' ? 2 : 1;
        readerState.prefetchedPages = [pages[pageIndex - spreadSize], pages[pageIndex + spreadSize]].filter(Boolean);
        content.scrollTop = 0;
        updateReaderPageControls();
        return deck;
    }

    function renderReaderReading(options = {}) {
        if (!readerState.currentChapter || !window.DraftHarborReaderLayout) return;
        window.stopReaderPageFlip?.();
        const metrics = readerLayoutMetrics();
        if (!metrics.content) return;
        const locator = options.locator || readerState.anchorLocator || readerState.documentRecordState && readerState.documentRecordState.positionLocator;
        readerState.effectiveLayoutMode = metrics.effective;
        readerState.anchorLocator = locator || null;
        metrics.content.dataset.readerLayout = metrics.effective;
        if (metrics.effective === 'flow') {
            readerState.pages = [];
            renderReaderFlow(locator, { preserveRatio: options.preserveFlowRatio === true });
            updateReaderPageControls();
        } else {
            renderReaderPages(locator);
        }
        if (window.renderReaderAnnotationMarks) window.renderReaderAnnotationMarks();
    }

    function scheduleReaderReflow() {
        const locator = captureReaderPositionLocator() || readerState.anchorLocator;
        const preserveFlowRatio = readerState.effectiveLayoutMode === 'flow';
        if (readerReflowTimer) window.clearTimeout(readerReflowTimer);
        readerReflowTimer = window.setTimeout(() => {
            readerReflowTimer = null;
            const activeLocator = locator && locator.chapterId === readerState.activeChapterId
                ? locator
                : (readerState.anchorLocator && readerState.anchorLocator.chapterId === readerState.activeChapterId
                    ? readerState.anchorLocator : null);
            readerState.anchorLocator = activeLocator;
            renderReaderReading({ locator: activeLocator, preserveFlowRatio });
            updateReaderWorkspaceProgress();
        }, 120);
    }

    function maybeShiftReaderFlowWindow() {
        if (readerState.effectiveLayoutMode !== 'flow' || readerFlowShiftFrame) return;
        const content = document.querySelector('[data-reader-content]');
        const blocks = readerState.currentChapter && readerState.currentChapter.blocks || [];
        if (!content || blocks.length <= 73 || content.scrollHeight <= content.clientHeight) return;
        readerFlowShiftFrame = window.requestAnimationFrame(() => {
            readerFlowShiftFrame = null;
            const ratio = content.scrollTop / Math.max(1, content.scrollHeight - content.clientHeight);
            const approximate = Math.max(0, Math.min(blocks.length - 1, Math.round(ratio * (blocks.length - 1))));
            const range = readerState.virtualWindow;
            if (approximate < range.start + 10 || approximate >= range.end - 10) {
                renderReaderFlow(createReaderLocatorAt(blocks[approximate].blockId, 0), { preserveRatio: true });
            }
        });
    }

    function queueReaderPageTurn(delta, options = {}) {
        window.readerTtsPauseForNavigation?.();
        if (options.source && typeof readerCanPageTurn === 'function' && !readerCanPageTurn(options.source)) return false;
        if (readerState.effectiveLayoutMode === 'flow') return false;
        readerState.pendingPageDelta += Number(delta) || 0;
        if (readerState.pageTurnFrame) return true;
        readerState.pageTurnFrame = window.requestAnimationFrame(() => {
            readerState.pageTurnFrame = null;
            const spreadSize = readerState.effectiveLayoutMode === 'double-page' ? 2 : 1;
            const maxStart = readerState.effectiveLayoutMode === 'double-page'
                ? Math.max(0, readerState.pages.length - (readerState.pages.length % 2 || 2))
                : Math.max(0, readerState.pages.length - 1);
            const pendingDelta = readerState.pendingPageDelta;
            const target = Math.max(0, Math.min(maxStart, readerState.pageIndex + pendingDelta * spreadSize));
            readerState.pendingPageDelta = 0;
            if (target === readerState.pageIndex) return;
            const content = document.querySelector('[data-reader-content]');
            const currentDeck = content && (content.querySelector('.desktop-reader-page-transition-layer .desktop-reader-page-deck.is-reader-transitioning-in')
                || content.querySelector('.desktop-reader-page-deck'));
            const outgoingDeck = currentDeck ? currentDeck.cloneNode(true) : null;
            const position = window.DraftHarborReaderLayout.locatorPositionForPage(readerState.pages, target);
            readerState.anchorLocator = position ? createReaderLocatorAt(position.blockId, position.offset) : readerState.anchorLocator;
            readerState.pageIndex = target;
            const incomingDeck = renderReaderPages(readerState.anchorLocator);
            animateReaderPageTurn(pendingDelta < 0 ? -1 : 1, { outgoingDeck, incomingDeck });
            updateReaderWorkspaceProgress();
        });
        return true;
    }

    function animateReaderPageTurn(direction, context = {}) {
        const content = document.querySelector('[data-reader-content]');
        const transitionApi = window.DraftHarborReaderTransition;
        const adapter = transitionApi && typeof transitionApi.createReaderTransitionAdapter === 'function'
            ? transitionApi.createReaderTransitionAdapter({
                transition: readerState.pageTransition,
                reducedMotion: typeof readerReducedMotionActive === 'function' && readerReducedMotionActive(),
                direction
            }) : { transition: typeof readerEffectiveTransition === 'function' ? readerEffectiveTransition() : 'none', durationMs: 0 };
        const transition = adapter.transition;
        const outgoingDeck = context.outgoingDeck;
        const incomingDeck = context.incomingDeck;
        if (!content || transition === 'none') return;

        if (transition === 'curl' && typeof window.startReaderPageFlip === 'function' && window.startReaderPageFlip({
            content,
            outgoingDeck,
            incomingDeck,
            direction,
            durationMs: adapter.durationMs
        })) return;

        if (outgoingDeck && incomingDeck && content.contains(incomingDeck)) {
            const layer = document.createElement('div');
            layer.className = 'desktop-reader-page-transition-layer';
            layer.dataset.readerTransition = transition;
            layer.dataset.readerDirection = direction < 0 ? 'previous' : 'next';

            outgoingDeck.classList.remove('is-reader-transitioning', 'is-reader-transitioning-in', 'is-reader-transitioning-out');
            outgoingDeck.classList.add('is-reader-transitioning-out');
            outgoingDeck.dataset.readerTransition = transition;
            outgoingDeck.dataset.readerDirection = layer.dataset.readerDirection;
            outgoingDeck.setAttribute('aria-hidden', 'true');
            outgoingDeck.inert = true;

            incomingDeck.classList.add('is-reader-transitioning-in');
            incomingDeck.dataset.readerTransition = transition;
            incomingDeck.dataset.readerDirection = layer.dataset.readerDirection;
            layer.append(outgoingDeck, incomingDeck);
            content.replaceChildren(layer);

            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                incomingDeck.classList.remove('is-reader-transitioning-in', 'is-reader-transitioning');
                if (layer.isConnected) layer.replaceWith(incomingDeck);
            };
            incomingDeck.addEventListener('animationend', finish, { once: true });
            window.requestAnimationFrame(() => {
                if (!layer.isConnected) return;
                layer.classList.add('is-reader-transitioning');
                window.setTimeout(finish, Math.max(320, Number(adapter.durationMs) + 100));
            });
            return;
        }

        const target = content.querySelector('.desktop-reader-page-deck') || content;
        if (target === content && !target.dataset.readerLayout) return;
        target.dataset.readerTransition = transition;
        target.dataset.readerDirection = direction < 0 ? 'previous' : 'next';
        target.classList.add('is-reader-transitioning');
        const finish = () => target.classList.remove('is-reader-transitioning');
        target.addEventListener('animationend', finish, { once: true });
        window.setTimeout(finish, Math.max(280, Number(adapter.durationMs) + 60));
    }
