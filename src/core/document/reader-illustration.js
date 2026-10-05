(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderIllustration = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const FIT_MODES = Object.freeze(['contain', 'cover']);

    function cleanString(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function rangePosition(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || typeof input.blockId !== 'string' || !input.blockId.trim()
            || !Number.isSafeInteger(input.offset) || input.offset < 0) {
            throw new Error('reader illustration range position is invalid');
        }
        return Object.freeze({ blockId: input.blockId.trim(), offset: input.offset });
    }

    function createRange(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new Error('reader illustration range is invalid');
        }
        const start = rangePosition(input.start);
        const end = rangePosition(input.end);
        if (start.blockId === end.blockId && start.offset >= end.offset) {
            throw new Error('reader illustration range must be nonempty and forward');
        }
        return Object.freeze({ start, end });
    }

    function createReaderIllustration(input = {}) {
        const illustrationId = cleanString(input.illustrationId || input.id);
        const documentId = cleanString(input.documentId);
        const chapterId = cleanString(input.chapterId);
        const blockId = cleanString(input.blockId);
        const assetId = cleanString(input.assetId);
        if (!illustrationId || !documentId || !chapterId || !blockId || !assetId) {
            throw new Error('reader illustration identity and anchor are required');
        }
        const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
        const createdAt = cleanString(input.createdAt);
        const updatedAt = cleanString(input.updatedAt, createdAt);
        if (!createdAt || Number.isNaN(new Date(createdAt).getTime())) throw new Error('reader illustration createdAt is invalid');
        if (!updatedAt || Number.isNaN(new Date(updatedAt).getTime())) throw new Error('reader illustration updatedAt is invalid');
        const revisionId = cleanString(input.revisionId);
        const range = input.range === undefined ? undefined : createRange(input.range);
        return Object.freeze({
            illustrationId,
            documentId,
            chapterId,
            blockId,
            offset,
            excerpt: cleanString(input.excerpt).slice(0, 160),
            assetId,
            fileName: cleanString(input.fileName, '插图'),
            mediaType: cleanString(input.mediaType),
            sizeBytes: Math.max(0, Math.floor(Number(input.sizeBytes) || 0)),
            fit: FIT_MODES.includes(input.fit) ? input.fit : 'contain',
            caption: cleanString(input.caption).slice(0, 240),
            createdAt: new Date(createdAt).toISOString(),
            updatedAt: new Date(updatedAt).toISOString(),
            ...(revisionId ? { revisionId } : {}),
            ...(range ? { range } : {})
        });
    }

    function compareAnchors(left, right, blockIndexes) {
        const leftIndex = blockIndexes.get(left.blockId);
        const rightIndex = blockIndexes.get(right.blockId);
        if (leftIndex !== rightIndex) return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
        return left.offset - right.offset;
    }

    function pageContainsAnchor(page, anchor) {
        if (!anchor) return false;
        return (Array.isArray(page && page.segments) ? page.segments : []).some((segment) => {
            if (String(segment.blockId || '') !== String(anchor.blockId || '')) return false;
            const start = Math.max(0, Number(segment.startOffset) || 0);
            const end = Math.max(start, Number(segment.endOffset) || 0);
            const offset = Math.max(0, Number(anchor.offset) || 0);
            return offset >= start && offset < end;
        });
    }

    function activeIllustrationsForPage(illustrations, chapter, page, options = {}) {
        const blocks = Array.isArray(chapter && chapter.blocks) ? chapter.blocks : [];
        const segments = Array.isArray(page && page.segments) ? page.segments : [];
        if (!blocks.length || !segments.length) return [];
        const blockIndexes = new Map(blocks.map((block, index) => [String(block.blockId), index]));
        const revisionId = cleanString(options.revisionId);
        const positionInChapter = (position) => {
            const index = position && blockIndexes.get(position.blockId);
            return index !== undefined && Number.isSafeInteger(position.offset) && position.offset >= 0
                && position.offset <= String(blocks[index].text || '').length;
        };
        const eligible = (Array.isArray(illustrations) ? illustrations : []).map((item, uploadOrder) => ({ item, uploadOrder }))
            .filter(({ item }) => {
                if (!item || item.chapterId !== chapter.chapterId || !blockIndexes.has(item.blockId)
                    || (item.revisionId && item.revisionId !== revisionId)) return false;
                if (!item.range) return positionInChapter(item) && pageContainsAnchor(page, item);
                const { start, end } = item.range;
                // Cross-block ordering and bounds require the actual chapter.
                // Stale or invalid ranges remain stored but cannot bind to prose.
                if (!positionInChapter(start) || !positionInChapter(end)
                    || compareAnchors(start, end, blockIndexes) >= 0) return false;
                return segments.some((segment) => {
                    const segmentStart = { blockId: String(segment.blockId || ''), offset: Number(segment.startOffset || 0) };
                    const segmentEnd = { blockId: segmentStart.blockId, offset: Number(segment.endOffset) };
                    return positionInChapter(segmentStart) && positionInChapter(segmentEnd)
                        && segmentStart.offset < segmentEnd.offset
                        && compareAnchors(start, segmentEnd, blockIndexes) < 0
                        && compareAnchors(end, segmentStart, blockIndexes) > 0;
                });
            });
        const startFor = (item) => item.range ? item.range.start : item;
        const endFor = (item) => item.range ? item.range.end : item;
        eligible.sort((left, right) => compareAnchors(startFor(left.item), startFor(right.item), blockIndexes)
            || compareAnchors(endFor(left.item), endFor(right.item), blockIndexes)
            || left.uploadOrder - right.uploadOrder);
        return eligible.map(({ item }) => item);
    }

    return { FIT_MODES, createReaderIllustration, compareAnchors, pageContainsAnchor, activeIllustrationsForPage };
});
