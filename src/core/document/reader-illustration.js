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
            updatedAt: new Date(updatedAt).toISOString()
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

    function activeIllustrationsForPage(illustrations, chapter, page) {
        const blocks = Array.isArray(chapter && chapter.blocks) ? chapter.blocks : [];
        const segments = Array.isArray(page && page.segments) ? page.segments : [];
        if (!blocks.length || !segments.length) return [];
        const blockIndexes = new Map(blocks.map((block, index) => [String(block.blockId), index]));
        const lastSegment = segments[segments.length - 1];
        const pageEnd = {
            blockId: String(lastSegment.blockId || ''),
            offset: Math.max(0, Number(lastSegment.endOffset) || 0)
        };
        const eligible = (Array.isArray(illustrations) ? illustrations : []).filter((item) => (
            item && item.chapterId === chapter.chapterId
            && blockIndexes.has(item.blockId)
            // Page segment end offsets are exclusive. An anchor exactly at the
            // end belongs to the following page and must not trigger early.
            && compareAnchors(item, pageEnd, blockIndexes) < 0
        ));
        if (!eligible.length) return [];
        eligible.sort((left, right) => compareAnchors(left, right, blockIndexes) || left.createdAt.localeCompare(right.createdAt));
        const latest = eligible[eligible.length - 1];
        return eligible.filter((item) => item.blockId === latest.blockId && item.offset === latest.offset);
    }

    return { FIT_MODES, createReaderIllustration, compareAnchors, pageContainsAnchor, activeIllustrationsForPage };
});
