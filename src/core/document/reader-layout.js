(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderLayout = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const LAYOUT_MODES = Object.freeze(['flow', 'single-page', 'double-page', 'illustrated', 'auto']);
    const BREAK_AFTER = Object.freeze(' \t\r\n.,!?;:，。！？；：、，。！？；：、)）】》」』”’〕〉》〉》.!?'.split(''));
    const BREAK_BEFORE = Object.freeze('([{（【《「『“‘'.split(''));
    const GRAPHEME_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
    const GRAPHEME_BOUNDARY_CACHE = new Map();

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
        if (requested === 'flow') return requested;
        const viewportHeight = Number(options.viewportHeight);
        const minimumPageHeight = finiteNumber(options.minimumPageHeight, 240, 120, 720);
        if (Number.isFinite(viewportHeight) && viewportHeight < minimumPageHeight) return 'flow';
        if (requested === 'single-page') return requested;
        const minimumPageWidth = finiteNumber(options.minimumPageWidth, 360, 240, 720);
        const minimumForcedPageWidth = finiteNumber(options.minimumForcedPageWidth, 220, 160, 480);
        const gap = finiteNumber(options.gap, 28, 0, 96);
        if (requested === 'illustrated') {
            return finiteNumber(viewportWidth, 0, 0, 100000) >= minimumForcedPageWidth * 2 + gap
                ? 'illustrated'
                : 'single-page';
        }
        if (requested === 'double-page') {
            return finiteNumber(viewportWidth, 0, 0, 100000) >= minimumForcedPageWidth * 2 + gap
                ? 'double-page'
                : 'single-page';
        }
        const canShowSpread = finiteNumber(viewportWidth, 0, 0, 100000) >= minimumPageWidth * 2 + gap;
        return canShowSpread ? 'double-page' : 'single-page';
    }

    function pagedGeometry(input = {}) {
        const viewportWidth = finiteNumber(input.viewportWidth, 900, 240, 100000);
        const viewportHeight = finiteNumber(input.viewportHeight, 700, 120, 100000);
        const effective = cleanMode(input.effectiveMode);
        const gap = finiteNumber(input.gap, 28, 0, 96);
        const innerWidth = Math.max(240, viewportWidth);
        const innerHeight = Math.max(120, viewportHeight);
        const spread = effective === 'double-page' || effective === 'illustrated';
        const spreadMax = spread ? Math.min(1680, innerWidth) : Math.min(980, innerWidth);
        const pageWidth = spread
            ? Math.max(220, (spreadMax - gap) / 2)
            : Math.max(320, spreadMax);
        const pageHeight = Math.max(120, Math.min(innerHeight, Math.round(pageWidth * 1.38)));
        return { pageWidth, pageHeight, spreadMax, innerWidth, innerHeight };
    }

    function estimatePageCapacity(input = {}) {
        const width = finiteNumber(input.pageWidth, 720, 240, 2400);
        const height = finiteNumber(input.pageHeight, 720, 120, 2400);
        const fontSize = finiteNumber(input.fontSize, 18, 12, 48);
        const lineHeight = finiteNumber(input.lineHeight, 1.8, 1.2, 3);
        const pageMargin = finiteNumber(input.pageMargin, 48, 12, 160);
        const fontWeight = finiteNumber(input.fontWeight, 400, 300, 900);
        const bookSpine = finiteNumber(input.bookSpine, 28, 0, 96);
        const letterSpacing = finiteNumber(input.letterSpacing, 0, -0.05, 0.3);
        const usableWidth = Math.max(120, width - pageMargin * 2 - bookSpine * 0.25);
        const usableHeight = Math.max(fontSize * lineHeight * 3, height - pageMargin * 2);
        const weightFactor = 1 + ((fontWeight - 400) / 500) * 0.06;
        const averageGlyphWidth = fontSize * Math.max(0.84, (0.96 + letterSpacing) * weightFactor);
        const charactersPerLine = Math.max(8, Math.floor(usableWidth / averageGlyphWidth));
        const lineBox = fontSize * lineHeight;
        const linesPerPage = Math.max(3, Math.floor((usableHeight / lineBox) * 0.8));
        return Math.max(64, charactersPerLine * linesPerPage);
    }

    function isClosingPunctuation(character) {
        return !!character && BREAK_AFTER.includes(character) && !' \t\r\n'.includes(character);
    }

    function isCombiningMarkAt(text, offset) {
        const codePoint = text.codePointAt(offset);
        return Number.isFinite(codePoint) && (
            (codePoint >= 0x300 && codePoint <= 0x36f)
            || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
            || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
            || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
            || (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
        );
    }

    function graphemeBoundaries(text) {
        if (!GRAPHEME_SEGMENTER) return null;
        const cached = GRAPHEME_BOUNDARY_CACHE.get(text);
        if (cached) return cached;
        const boundaries = Array.from(GRAPHEME_SEGMENTER.segment(text), (item) => item.index);
        if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length);
        GRAPHEME_BOUNDARY_CACHE.set(text, boundaries);
        while (GRAPHEME_BOUNDARY_CACHE.size > 16) {
            GRAPHEME_BOUNDARY_CACHE.delete(GRAPHEME_BOUNDARY_CACHE.keys().next().value);
        }
        return boundaries;
    }

    function safeEndOffset(text, candidate, start) {
        let offset = Math.max(start + 1, Math.min(text.length, candidate));
        if (offset < text.length && text.charCodeAt(offset) >= 0xDC00 && text.charCodeAt(offset) <= 0xDFFF) offset -= 1;
        while (offset > start && isCombiningMarkAt(text, offset)) offset -= 1;
        if (offset < text.length && BREAK_BEFORE.includes(text[offset])) offset += 1;
        return Math.max(start + 1, Math.min(text.length, offset));
    }

    function safeBackwardEndOffset(text, candidate, start, boundaries) {
        let offset = Math.max(start + 1, Math.min(text.length, candidate));
        if (boundaries && offset < text.length) {
            let low = 0;
            let high = boundaries.length - 1;
            while (low < high) {
                const middle = Math.ceil((low + high) / 2);
                if (boundaries[middle] <= offset) low = middle;
                else high = middle - 1;
            }
            if (boundaries[low] < offset) offset = boundaries[low] > start ? boundaries[low] : boundaries[low + 1];
        }
        if (offset < text.length && text.charCodeAt(offset) >= 0xDC00 && text.charCodeAt(offset) <= 0xDFFF) offset -= 1;
        while (offset > start && isCombiningMarkAt(text, offset)) offset -= 1;
        return Math.max(start + 1, Math.min(text.length, offset));
    }

    function isNaturalBreak(text, offset, start) {
        if (offset <= start || offset >= text.length) return offset > start;
        const before = text[offset - 1];
        const after = text[offset];
        if (BREAK_BEFORE.includes(after) || isClosingPunctuation(after) || isCombiningMarkAt(text, offset)) return false;
        if (/\s/u.test(after)) return false;
        if (BREAK_AFTER.includes(before)) return true;
        if (/\s/u.test(before)) return true;
        if (/\p{Script=Han}/u.test(before) && !isClosingPunctuation(after)) return true;
        const beforeWord = /[\p{L}\p{N}]/u.test(before);
        const afterWord = /[\p{L}\p{N}]/u.test(after);
        return !(beforeWord && afterWord);
    }

    function preferredBreakOffset(text, candidate, start, options = {}) {
        const hard = safeEndOffset(text, candidate, start);
        if (hard >= text.length || options.keepWords === false && options.keepPunctuation === false) return hard;
        const window = Math.max(8, Math.floor(finiteNumber(options.breakWindow, 48, 8, 160)));
        const lower = Math.max(start + 1, hard - window);
        for (let offset = hard; offset >= lower; offset -= 1) {
            if (isNaturalBreak(text, offset, start)) return safeEndOffset(text, offset, start);
        }
        const upper = Math.min(text.length, hard + window);
        for (let offset = hard + 1; offset <= upper; offset += 1) {
            if (isNaturalBreak(text, offset, start)) return safeEndOffset(text, offset, start);
        }
        return hard;
    }

    function fittedBreakOffset(text, maximum, start, options = {}) {
        const boundaries = graphemeBoundaries(text);
        const hard = safeBackwardEndOffset(text, maximum, start, boundaries);
        if (hard >= text.length || options.keepWords === false && options.keepPunctuation === false) return hard;
        const window = Math.max(8, Math.floor(finiteNumber(options.breakWindow, 48, 8, 160)));
        const lower = Math.max(start + 1, hard - window);
        for (let offset = hard; offset >= lower; offset -= 1) {
            const safe = safeBackwardEndOffset(text, offset, start, boundaries);
            if (safe <= hard && isNaturalBreak(text, safe, start)) return safe;
        }
        return hard;
    }

    function buildReaderPages(chapterInput = {}, options = {}) {
        const blocks = Array.isArray(chapterInput.blocks) ? chapterInput.blocks : [];
        const capacity = Math.max(64, Math.floor(finiteNumber(options.capacity, 1200, 64, 1000000)));
        const widowLines = Math.max(1, Math.floor(finiteNumber(options.widowLines, 2, 1, 4)));
        const orphanLines = Math.max(1, Math.floor(finiteNumber(options.orphanLines, 2, 1, 4)));
        const minimumTail = Math.max(4, Math.floor(capacity * Math.min(0.3, 0.08 + widowLines * 0.04)));
        const breakOptions = { ...options, breakWindow: options.breakWindow || Math.min(64, Math.max(16, Math.floor(capacity * 0.25))) };
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
            if (heading && page.segments.length && capacity - page.weight < Math.min(120, Math.ceil(capacity * (0.05 + orphanLines * 0.05)))) commitPage();
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
                let candidate = startOffset + remaining;
                const tail = text.length - candidate;
                if (tail > 0 && tail < minimumTail && candidate - startOffset > minimumTail) candidate = text.length - minimumTail;
                const endOffset = fittedBreakOffset(text, candidate, startOffset, breakOptions);
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
            layoutVersion: 5,
            revisionId: String(input.revisionId || ''),
            chapterId: String(input.chapterId || ''),
            requestedMode: cleanMode(input.requestedMode),
            effectiveMode: cleanMode(input.effectiveMode),
            viewportWidth: Math.round(finiteNumber(input.viewportWidth, 0, 0, 100000)),
            viewportHeight: Math.round(finiteNumber(input.viewportHeight, 0, 0, 100000)),
            actualFontFamily: String(input.actualFontFamily || ''),
            fontCatalogVersion: Math.max(1, Math.floor(Number(input.fontCatalogVersion) || 1)),
            fontWeight: finiteNumber(input.fontWeight, 400, 300, 900),
            bookSpine: finiteNumber(input.bookSpine, 28, 0, 96),
            orphanLines: finiteNumber(input.orphanLines, 2, 1, 4),
            widowLines: finiteNumber(input.widowLines, 2, 1, 4),
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
        pagedGeometry,
        buildReaderPages,
        pageIndexForLocator,
        locatorPositionForPage,
        flowWindowForAnchor,
        preferredBreakOffset,
        fittedBreakOffset,
        layoutCacheKey
    };
});
