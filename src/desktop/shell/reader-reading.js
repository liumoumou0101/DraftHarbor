    /* global readerCanPageTurn readerReducedMotionActive */

    let readerReflowTimer = null;
    let readerFlowShiftFrame = null;
    let readerPageFitScale = 1;
    let readerPageFitAttempts = 0;
    let readerPageFitBaseKey = '';
    let readerPageFitFrame = 0;
    let readerDeckTransitionSession = null;

    function createReaderBlockNode(block, startOffset = 0, endOffset) {
        const heading = block.type === 'heading' || block.type === 'scene-title';
        const node = document.createElement(heading ? 'h3' : 'p');
        const limit = endOffset === undefined ? String(block.text || '').length : endOffset;
        node.dataset.readerBlock = block.blockId;
        node.dataset.readerBlockType = block.type || 'paragraph';
        node.dataset.readerStartOffset = String(startOffset);
        node.dataset.readerEndOffset = String(limit);
        node.textContent = String(block.text || '').slice(startOffset, limit);
        window.decorateReaderIllustrationBlockNode?.(node, block, startOffset, limit);
        return node;
    }

    function createReaderLocatorAt(blockId, offset = 0) {
        const chapter = readerState.currentChapter;
        if (!chapter || !window.DraftHarborReaderLocator) return null;
        try {
            const legacyKey = readerState.document && (readerState.document.projectId || readerState.document.fileName || readerState.document.title) || 'document';
            return window.DraftHarborReaderLocator.locatorFromBlockPosition({
                documentId: readerState.activeDocumentId || `legacy:${legacyKey}`,
                chapterId: readerState.activeChapterId,
                blockId,
                offset
            }, { revisionId: readerState.activeRevisionId || `legacy-revision:${legacyKey}`, chapters: [chapter] });
        } catch (error) {
            console.warn('Failed to create reader locator:', error);
            return null;
        }
    }

    function captureReaderPositionLocator() {
        if (!readerState.currentChapter) return null;
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
        const effective = window.DraftHarborReaderLayout.effectiveLayoutMode(readerState.layoutMode, width, {
            viewportHeight: height,
            minimumPageHeight: 240,
            minimumPageWidth: 360,
            minimumForcedPageWidth: 220,
            gap: readerState.bookSpine || 28
        });
        const gap = Math.max(0, Math.min(96, Number(readerState.bookSpine) || 28));
        const geometry = window.DraftHarborReaderLayout.pagedGeometry({
            viewportWidth: Math.max(240, width - 48),
            viewportHeight: Math.max(120, height - 36),
            effectiveMode: effective,
            gap
        });
        const pageWidth = geometry.pageWidth;
        const pageHeight = geometry.pageHeight;
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

    function createReaderPaginationProbe(metrics) {
        const stage = document.querySelector('[data-reader-theme-panel]');
        const host = document.createElement('div');
        host.className = 'desktop-reader-content desktop-reader-pagination-probe';
        host.dataset.readerLayout = metrics.effective;
        host.setAttribute('aria-hidden', 'true');
        Object.assign(host.style, {
            position: 'fixed',
            left: '-100000px',
            top: '0',
            zIndex: '-1',
            width: `${metrics.width}px`,
            height: `${metrics.height}px`,
            visibility: 'hidden',
            pointerEvents: 'none',
            contain: 'strict'
        });
        const deck = document.createElement('div');
        deck.className = 'desktop-reader-page-deck';
        deck.dataset.readerSpread = metrics.effective === 'double-page' ? 'double' : 'single';
        const pageNode = document.createElement('section');
        pageNode.className = 'desktop-reader-page';
        deck.appendChild(pageNode);
        host.appendChild(deck);
        (stage || document.body).appendChild(host);
        return { host, pageNode };
    }

    function readerProbeTextFits(pageNode, node, text, startOffset, length) {
        node.textContent = text.slice(startOffset, startOffset + length);
        return pageNode.scrollHeight <= pageNode.clientHeight + 1
            && pageNode.scrollWidth <= pageNode.clientWidth + 1;
    }

    function readerFittingTextLength(pageNode, node, text, startOffset, estimatedCapacity) {
        const remaining = text.length - startOffset;
        if (remaining <= 0) return 0;
        let low = 0;
        let high = Math.min(remaining, Math.max(64, Math.ceil(estimatedCapacity * 1.35)));
        if (readerProbeTextFits(pageNode, node, text, startOffset, high)) {
            low = high;
            while (low < remaining) {
                high = Math.min(remaining, Math.max(low + 1, low * 2));
                if (!readerProbeTextFits(pageNode, node, text, startOffset, high)) break;
                low = high;
            }
            if (low === remaining) return low;
        }
        while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2);
            if (readerProbeTextFits(pageNode, node, text, startOffset, middle)) low = middle;
            else high = middle;
        }
        node.textContent = text.slice(startOffset, startOffset + low);
        return low;
    }

    function readerRenderedLineCount(node) {
        const textNode = node && node.firstChild;
        if (!textNode || !textNode.nodeValue) return 0;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = new Set(Array.from(range.getClientRects())
            .filter((rect) => rect.height > 0.5 && rect.width >= 0)
            .map((rect) => Math.round(rect.top * 2)));
        return tops.size;
    }

    function readerLastLineStart(node) {
        const textNode = node && node.firstChild;
        const length = textNode && textNode.nodeValue ? textNode.nodeValue.length : 0;
        if (length < 2) return 0;
        const range = document.createRange();
        const characterTop = (offset) => {
            range.setStart(textNode, Math.max(0, offset));
            range.setEnd(textNode, Math.min(length, offset + 1));
            return range.getBoundingClientRect().top;
        };
        const lastTop = characterTop(length - 1);
        let low = 0;
        let high = length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (characterTop(middle) >= lastTop - 0.5) high = middle;
            else low = middle + 1;
        }
        return low;
    }

    function buildMeasuredReaderPages(metrics, estimatedCapacity) {
        if (!document.createRange || !metrics.content) return null;
        const chapter = readerState.currentChapter || {};
        const blocks = Array.isArray(chapter.blocks) ? chapter.blocks : [];
        const probe = createReaderPaginationProbe(metrics);
        const tailProbe = createReaderPaginationProbe(metrics);
        const pages = [];
        let page = { pageIndex: 0, weight: 0, segments: [] };

        const commitPage = () => {
            if (page.segments.length || !pages.length) pages.push(page);
            page = { pageIndex: pages.length, weight: 0, segments: [] };
            probe.pageNode.replaceChildren();
        };
        const appendSegment = (block, blockIndex, type, startOffset, endOffset, node) => {
            node.dataset.readerStartOffset = String(startOffset);
            node.dataset.readerEndOffset = String(endOffset);
            page.segments.push({ blockId: block.blockId, blockIndex, type, startOffset, endOffset });
            page.weight += endOffset - startOffset;
        };
        const moveTrailingHeading = () => {
            const segment = page.segments[page.segments.length - 1];
            if (!segment || !['heading', 'scene-title'].includes(segment.type) || page.segments.length < 2) return null;
            page.segments.pop();
            page.weight -= segment.endOffset - segment.startOffset;
            probe.pageNode.lastElementChild?.remove();
            commitPage();
            const block = blocks[segment.blockIndex];
            const node = createReaderBlockNode(block, segment.startOffset, segment.endOffset);
            probe.pageNode.appendChild(node);
            appendSegment(block, segment.blockIndex, segment.type, segment.startOffset, segment.endOffset, node);
            return segment;
        };

        try {
            blocks.forEach((block, blockIndex) => {
                const text = String(block && block.text || '');
                const type = String(block && block.type || 'paragraph');
                const normalizedBlock = { ...block, blockId: String(block && block.blockId || `block-${blockIndex + 1}`), type, text };
                if (!text.length) {
                    let node = createReaderBlockNode(normalizedBlock, 0, 0);
                    probe.pageNode.appendChild(node);
                    if (!readerProbeTextFits(probe.pageNode, node, '', 0, 0) && page.segments.length) {
                        node.remove();
                        commitPage();
                        node = createReaderBlockNode(normalizedBlock, 0, 0);
                        probe.pageNode.appendChild(node);
                    }
                    appendSegment(normalizedBlock, blockIndex, type, 0, 0, node);
                    return;
                }
                let startOffset = 0;
                while (startOffset < text.length) {
                    const node = createReaderBlockNode(normalizedBlock, startOffset, startOffset);
                    probe.pageNode.appendChild(node);
                    let fittingLength = readerFittingTextLength(probe.pageNode, node, text, startOffset, estimatedCapacity);
                    if (!fittingLength && page.segments.length) {
                        node.remove();
                        if (!moveTrailingHeading()) commitPage();
                        continue;
                    }
                    if (!fittingLength) fittingLength = 1;
                    let endOffset = window.DraftHarborReaderLayout.fittedBreakOffset(
                        text,
                        startOffset + fittingLength,
                        startOffset,
                        { breakWindow: Math.min(160, Math.max(16, Math.floor(estimatedCapacity * 0.12))) }
                    );
                    node.textContent = text.slice(startOffset, endOffset);
                    const split = endOffset < text.length;
                    const lineCount = readerRenderedLineCount(node);
                    if (split && page.segments.length && lineCount < Math.max(1, readerState.orphanLines || 2)) {
                        node.remove();
                        if (!moveTrailingHeading()) commitPage();
                        continue;
                    }
                    if (split && text.length - endOffset <= estimatedCapacity * 2) {
                        const tailNode = createReaderBlockNode(normalizedBlock, endOffset, text.length);
                        tailProbe.pageNode.replaceChildren(tailNode);
                        let tailLines = readerRenderedLineCount(tailNode);
                        let currentLines = lineCount;
                        let widowAttempts = 0;
                        while (tailLines < Math.max(1, readerState.widowLines || 2)
                            && currentLines > Math.max(1, readerState.orphanLines || 2)
                            && widowAttempts < 8) {
                            widowAttempts += 1;
                            const lineStart = readerLastLineStart(node);
                            if (lineStart <= 0) break;
                            endOffset = window.DraftHarborReaderLayout.fittedBreakOffset(
                                text, startOffset + lineStart, startOffset, { breakWindow: 48 }
                            );
                            node.textContent = text.slice(startOffset, endOffset);
                            tailNode.textContent = text.slice(endOffset);
                            currentLines = readerRenderedLineCount(node);
                            tailLines = readerRenderedLineCount(tailNode);
                        }
                    }
                    appendSegment(normalizedBlock, blockIndex, type, startOffset, endOffset, node);
                    startOffset = endOffset;
                    if (startOffset < text.length) commitPage();
                }
            });
            if (page.segments.length || !pages.length) commitPage();
            return pages;
        } finally {
            probe.host.remove();
            tailProbe.host.remove();
        }
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
        if (previous) previous.disabled = readerState.pageIndex <= 0 && !window.readerHasAdjacentChapter?.(-1);
        if (next) next.disabled = readerState.pageIndex + spreadSize >= readerState.pages.length && !window.readerHasAdjacentChapter?.(1);
        if (touchPrevious) touchPrevious.disabled = readerState.pageIndex <= 0 && !window.readerHasAdjacentChapter?.(-1);
        if (touchNext) touchNext.disabled = readerState.pageIndex + spreadSize >= readerState.pages.length && !window.readerHasAdjacentChapter?.(1);
    }

    function readerVisiblePagesOverflow() {
        return Array.from(document.querySelectorAll('[data-reader-content] > .desktop-reader-page-deck > [data-reader-page]')).some((node) => (
            node.scrollHeight > node.clientHeight + 2
        ));
    }

    function scheduleReaderPageFit(locator) {
        if (readerPageFitFrame) window.cancelAnimationFrame(readerPageFitFrame);
        readerPageFitFrame = window.requestAnimationFrame(() => {
            readerPageFitFrame = window.requestAnimationFrame(() => {
                readerPageFitFrame = 0;
                if (readerState.effectiveLayoutMode === 'flow') return;
                if (!readerVisiblePagesOverflow()) return;
                if (readerPageFitAttempts >= 3) return;
                readerPageFitAttempts += 1;
                readerPageFitScale = Math.max(0.72, readerPageFitScale * 0.88);
                if (typeof clearReaderLayoutCache === 'function') clearReaderLayoutCache();
                renderReaderPages(locator);
            });
        });
    }

    function renderReaderPages(locator) {
        stopReaderDeckTransition();
        const metrics = readerLayoutMetrics();
        const content = metrics.content;
        const baseKey = readerLayoutKey(metrics);
        if (baseKey !== readerPageFitBaseKey) {
            readerPageFitBaseKey = baseKey;
            readerPageFitScale = 1;
            readerPageFitAttempts = 0;
        }
        const key = `${baseKey}|measured:1|fit:${readerPageFitScale}`;
        let pages = readerState.layoutCache.get(key);
        if (!validReaderPages(pages)) {
            readerState.layoutCache.delete(key);
            const estimated = window.DraftHarborReaderLayout.estimatePageCapacity({
                pageWidth: metrics.pageWidth,
                pageHeight: metrics.pageHeight,
                fontSize: readerState.fontSize,
                lineHeight: readerState.lineHeight,
                fontWeight: readerState.fontWeight || 400,
                bookSpine: readerState.bookSpine || 28,
                orphanLines: readerState.orphanLines || 2,
                widowLines: readerState.widowLines || 2,
                letterSpacing: readerState.letterSpacing || 0,
                paragraphSpacing: readerState.paragraphSpacing,
                pageMargin: readerState.pageMargin || 48
            });
            const capacity = Math.max(64, Math.floor(estimated * readerPageFitScale));
            pages = buildMeasuredReaderPages(metrics, capacity)
                || window.DraftHarborReaderLayout.buildReaderPages(readerState.currentChapter, {
                    capacity,
                    orphanLines: readerState.orphanLines || 2,
                    widowLines: readerState.widowLines || 2
                });
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
        window.appendReaderIllustrationPane?.(deck, pages[pageIndex], metrics.effective);
        content.appendChild(deck);
        const spreadSize = metrics.effective === 'double-page' ? 2 : 1;
        readerState.prefetchedPages = [pages[pageIndex - spreadSize], pages[pageIndex + spreadSize]].filter(Boolean);
        content.scrollTop = 0;
        updateReaderPageControls();
        window.syncReaderIllustrationControls?.();
        scheduleReaderPageFit(locator);
        return deck;
    }

    function renderReaderReading(options = {}) {
        if (!readerState.currentChapter || !window.DraftHarborReaderLayout) return;
        window.stopReaderPageFlip?.();
        stopReaderDeckTransition();
        const metrics = readerLayoutMetrics();
        if (!metrics.content) return;
        const requestedLocator = options.locator || readerState.anchorLocator
            || readerState.documentRecordState && readerState.documentRecordState.positionLocator;
        const locator = requestedLocator && requestedLocator.chapterId === readerState.activeChapterId
            ? requestedLocator
            : null;
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
        if (readerState.pageTurnFrame || readerState.chapterPageTurnPromise) return true;
        readerState.pageTurnFrame = window.requestAnimationFrame(() => {
            readerState.pageTurnFrame = null;
            const spreadSize = readerState.effectiveLayoutMode === 'double-page' ? 2 : 1;
            const maxStart = readerState.effectiveLayoutMode === 'double-page'
                ? Math.max(0, readerState.pages.length - (readerState.pages.length % 2 || 2))
                : Math.max(0, readerState.pages.length - 1);
            const pendingDelta = readerState.pendingPageDelta;
            const target = Math.max(0, Math.min(maxStart, readerState.pageIndex + pendingDelta * spreadSize));
            readerState.pendingPageDelta = 0;
            if (target === readerState.pageIndex) {
                const direction = pendingDelta < 0 ? -1 : pendingDelta > 0 ? 1 : 0;
                if (!direction || typeof window.navigateReaderChapterPageTurn !== 'function') return;
                readerState.chapterPageTurnPromise = window.navigateReaderChapterPageTurn(direction)
                    .catch((error) => console.warn('Reader chapter page turn failed.', error))
                    .finally(() => {
                        readerState.chapterPageTurnPromise = null;
                        if (readerState.pendingPageDelta) queueReaderPageTurn(0);
                    });
                return;
            }
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

    function stopReaderDeckTransition() {
        readerDeckTransitionSession?.finish();
    }

    function lockReaderTransitionSpine(deck, transition, direction, phase) {
        if (!deck || deck.dataset.readerSpread !== 'double' || !['slide', 'cover'].includes(transition)) return;
        deck.classList.add('is-reader-spine-locked');
        const motionName = transition === 'slide'
            ? `reader-page-slide-${phase}-${direction}`
            : phase === 'in' ? `reader-page-cover-in-${direction}` : '';
        if (motionName) {
            const duration = transition === 'slide' ? 260 : 300;
            deck.style.setProperty('--reader-spread-page-motion', `${motionName} ${duration}ms cubic-bezier(0.22, 0.72, 0.25, 1) both`);
        }
        Array.from(deck.children).forEach((pageNode) => {
            if (!pageNode.classList.contains('desktop-reader-page')) return;
            const slot = document.createElement('div');
            slot.className = 'desktop-reader-transition-page-slot';
            pageNode.replaceWith(slot);
            slot.appendChild(pageNode);
        });
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
        stopReaderDeckTransition();
        if (!content || transition === 'none') return;

        if (transition === 'curl' && typeof window.startReaderPageFlip === 'function' && window.startReaderPageFlip({
            content,
            outgoingDeck,
            incomingDeck,
            direction,
            durationMs: adapter.durationMs
        })) return;

        if (!outgoingDeck || !incomingDeck || !content.contains(incomingDeck)) return;

        const layer = document.createElement('div');
        layer.className = 'desktop-reader-page-transition-layer';
        layer.dataset.readerTransition = transition;
        layer.dataset.readerDirection = direction < 0 ? 'previous' : 'next';
        layer.setAttribute('aria-hidden', 'true');
        layer.inert = true;
        const contentStyle = window.getComputedStyle(content);
        layer.style.inset = `${contentStyle.paddingTop} ${contentStyle.paddingRight} ${contentStyle.paddingBottom} ${contentStyle.paddingLeft}`;

        outgoingDeck.classList.remove('is-reader-transitioning', 'is-reader-transitioning-in', 'is-reader-transitioning-out');
        outgoingDeck.classList.add('is-reader-transitioning-out');
        outgoingDeck.dataset.readerTransition = transition;
        outgoingDeck.dataset.readerDirection = layer.dataset.readerDirection;
        outgoingDeck.setAttribute('aria-hidden', 'true');
        outgoingDeck.inert = true;

        const animatedIncomingDeck = incomingDeck.cloneNode(true);
        animatedIncomingDeck.classList.add('is-reader-transitioning-in');
        animatedIncomingDeck.dataset.readerTransition = transition;
        animatedIncomingDeck.dataset.readerDirection = layer.dataset.readerDirection;
        lockReaderTransitionSpine(outgoingDeck, transition, layer.dataset.readerDirection, 'out');
        lockReaderTransitionSpine(animatedIncomingDeck, transition, layer.dataset.readerDirection, 'in');
        layer.append(outgoingDeck, animatedIncomingDeck);
        content.appendChild(layer);

        const animatedIncomingTarget = animatedIncomingDeck.querySelector('.desktop-reader-transition-page-slot > .desktop-reader-page')
            || animatedIncomingDeck;

        let timer;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            window.clearTimeout(timer);
            layer.remove();
            if (readerDeckTransitionSession?.finish === finish) {
                content.classList.remove('is-reader-deck-transition-active');
                readerDeckTransitionSession = null;
            }
        };
        readerDeckTransitionSession = { finish };
        animatedIncomingTarget.addEventListener('animationend', (event) => {
            if (event.target === animatedIncomingTarget) finish();
        });

        // Match the curl adapter's double-buffer sequence: lay out the complete
        // snapshots, prime their animation state, then hide the authoritative deck.
        layer.getBoundingClientRect();
        layer.classList.add('is-reader-transitioning');
        window.getComputedStyle(animatedIncomingTarget).transform;
        content.classList.add('is-reader-deck-transition-active');
        timer = window.setTimeout(finish, Math.max(360, Number(adapter.durationMs) + 140));
    }
