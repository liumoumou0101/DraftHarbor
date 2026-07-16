(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderLayout = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const LAYOUT_MODES = Object.freeze(['flow', 'single-page', 'double-page', 'auto']);

    function finiteNumber(value, fallback, minimum, maximum) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(minimum, Math.min(maximum, number));
    }

    function cleanMode(value) {
        return LAYOUT_MODES.includes(value) ? value : 'flow';
    }

    function effectiveLayoutMode(requestedMode, viewportWidth, options = {}) {
        const requested = cleanMode(requestedMode);
        if (requested === 'flow' || requested === 'single-page') return requested;
        const minimumPageWidth = finiteNumber(options.minimumPageWidth, 360, 240, 720);
        const gap = finiteNumber(options.gap, 28, 0, 96);
        const canShowSpread = finiteNumber(viewportWidth, 0, 0, 100000) >= minimumPageWidth * 2 + gap;
        return canShowSpread ? 'double-page' : 'single-page';
    }

    function estimatePageCapacity(input = {}) {
        const width = finiteNumber(input.pageWidth, 720, 240, 2400);
        const height = finiteNumber(input.pageHeight, 720, 120, 2400);
        const fontSize = finiteNumber(input.fontSize, 18, 12, 48);
        const lineHeight = finiteNumber(input.lineHeight, 1.8, 1.2, 3);
        const pageMargin = finiteNumber(input.pageMargin, 48, 12, 160);
        const letterSpacing = finiteNumber(input.letterSpacing, 0, -0.05, 0.3);
        const usableWidth = Math.max(120, width - pageMargin * 2);
        const usableHeight = Math.max(fontSize * lineHeight * 3, height - pageMargin * 2);
        const averageGlyphWidth = fontSize * Math.max(0.72, 0.95 + letterSpacing);
        const charactersPerLine = Math.max(8, Math.floor(usableWidth / averageGlyphWidth));
        const linesPerPage = Math.max(3, Math.floor((usableHeight / (fontSize * lineHeight)) * 0.58));
        return Math.max(64, charactersPerLine * linesPerPage);
    }

    function safeEndOffset(text, candidate, start) {
        let offset = Math.max(start + 1, Math.min(text.length, candidate));
        const code = text.charCodeAt(offset);
        if (offset < text.length && code >= 0xDC00 && code <= 0xDFFF) offset -= 1;
        return Math.max(start + 1, offset);
    }

    function buildReaderPages(chapterInput = {}, options = {}) {
        const blocks = Array.isArray(chapterInput.blocks) ? chapterInput.blocks : [];
        const capacity = Math.max(64, Math.floor(finiteNumber(options.capacity, 1200, 64, 1000000)));
        const pages = [];
        let page = { pageIndex: 0, weight: 0, segments: [] };

        function commitPage() {
            if (!page.segments.length && pages.length) return;
            pages.push(page);
            page = { pageIndex: pages.length, weight: 0, segments: [] };
        }

        blocks.forEach((block, blockIndex) => {
            const text = String(block && block.text || '');
            const blockId = String(block && block.blockId || `block-${blockIndex + 1}`);
            const type = String(block && block.type || 'paragraph');
            const heading = type === 'heading' || type === 'scene-title';
            if (heading && page.segments.length && capacity - page.weight < Math.min(120, Math.ceil(capacity * 0.15))) commitPage();
            if (!text.length) {
                if (page.weight >= capacity) commitPage();
                page.segments.push({ blockId, blockIndex, type, startOffset: 0, endOffset: 0 });
                page.weight += Math.min(8, capacity);
                return;
            }
            let startOffset = 0;
            while (startOffset < text.length) {
                if (page.weight >= capacity) commitPage();
                const remaining = Math.max(1, capacity - page.weight);
                const endOffset = safeEndOffset(text, startOffset + remaining, startOffset);
                page.segments.push({ blockId, blockIndex, type, startOffset, endOffset });
                page.weight += endOffset - startOffset;
                startOffset = endOffset;
                if (startOffset < text.length) commitPage();
            }
        });
        if (page.segments.length || !pages.length) commitPage();
        return pages;
    }

    function pageIndexForLocator(pages, locator = {}) {
        if (!Array.isArray(pages) || !pages.length) return 0;
        const offset = Math.max(0, Number(locator.offset) || 0);
        const index = pages.findIndex((page) => page.segments.some((segment) => (
            segment.blockId === locator.blockId
            && offset >= segment.startOffset
            && (offset < segment.endOffset || (offset === segment.endOffset && segment.endOffset === segment.startOffset))
        )));
        if (index >= 0) return index;
        const fallback = pages.findIndex((page) => page.segments.some((segment) => segment.blockId === locator.blockId));
        return fallback >= 0 ? fallback : 0;
    }

    function locatorPositionForPage(pages, pageIndex) {
        const pagesList = Array.isArray(pages) ? pages : [];
        const page = pagesList[Math.max(0, Math.min(pagesList.length - 1, Number(pageIndex) || 0))];
        const segment = page && page.segments[0];
        return segment ? { blockId: segment.blockId, offset: segment.startOffset } : null;
    }

    function flowWindowForAnchor(blockCount, anchorIndex, options = {}) {
        const total = Math.max(0, Number(blockCount) || 0);
        const before = Math.max(0, Number(options.before) || 24);
        const after = Math.max(1, Number(options.after) || 48);
        const anchor = Math.max(0, Math.min(Math.max(0, total - 1), Number(anchorIndex) || 0));
        let start = Math.max(0, anchor - before);
        let end = Math.min(total, anchor + after + 1);
        const desired = Math.min(total, before + after + 1);
        if (end - start < desired) start = Math.max(0, end - desired);
        if (end - start < desired) end = Math.min(total, start + desired);
        return { start, end };
    }

    function layoutCacheKey(input = {}) {
        const normalized = {
            layoutVersion: 1,
            revisionId: String(input.revisionId || ''),
            chapterId: String(input.chapterId || ''),
            requestedMode: cleanMode(input.requestedMode),
            effectiveMode: cleanMode(input.effectiveMode),
            viewportWidth: Math.round(finiteNumber(input.viewportWidth, 0, 0, 100000)),
            viewportHeight: Math.round(finiteNumber(input.viewportHeight, 0, 0, 100000)),
            actualFontFamily: String(input.actualFontFamily || ''),
            fontSize: finiteNumber(input.fontSize, 18, 12, 48),
            lineHeight: finiteNumber(input.lineHeight, 1.8, 1.2, 3),
            letterSpacing: finiteNumber(input.letterSpacing, 0, -0.05, 0.3),
            paragraphSpacing: finiteNumber(input.paragraphSpacing, 1.05, 0, 3),
            pageMargin: finiteNumber(input.pageMargin, 48, 12, 160),
            textAlign: String(input.textAlign || 'start'),
            indent: input.indent !== false
        };
        return JSON.stringify(normalized);
    }

    return {
        LAYOUT_MODES,
        effectiveLayoutMode,
        estimatePageCapacity,
        buildReaderPages,
        pageIndexForLocator,
        locatorPositionForPage,
        flowWindowForAnchor,
        layoutCacheKey
    };
});
