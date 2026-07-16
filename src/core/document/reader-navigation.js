(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderNavigation = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function clampRatio(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
    }

    function orderedBlocks(chapter) {
        return (Array.isArray(chapter && chapter.blocks) ? chapter.blocks : [])
            .map((block, index) => ({ ...block, _index: index }))
            .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || left._index - right._index);
    }

    function findLiteralMatches(chapter, query, options = {}) {
        const needle = String(query || '').trim();
        if (!needle) return [];
        const insensitive = options.caseSensitive !== true;
        const sought = insensitive ? needle.toLocaleLowerCase() : needle;
        const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
        const results = [];
        for (const block of orderedBlocks(chapter)) {
            const text = String(block.text || '');
            const searchable = insensitive ? text.toLocaleLowerCase() : text;
            let cursor = 0;
            while (cursor <= searchable.length - sought.length && results.length < limit) {
                const offset = searchable.indexOf(sought, cursor);
                if (offset < 0) break;
                const excerptStart = Math.max(0, offset - 42);
                const excerptEnd = Math.min(text.length, offset + needle.length + 58);
                results.push({
                    chapterId: String(chapter.chapterId || ''),
                    blockId: String(block.blockId || ''),
                    offset,
                    endOffset: offset + needle.length,
                    excerpt: `${excerptStart ? '…' : ''}${text.slice(excerptStart, excerptEnd)}${excerptEnd < text.length ? '…' : ''}`
                });
                cursor = offset + Math.max(1, sought.length);
            }
            if (results.length >= limit) break;
        }
        return results;
    }

    function chapterWeight(item) {
        return Math.max(0, Number(item && item.characterCount) || 0);
    }

    function blockPositionForChapterRatio(chapter, ratio) {
        const blocks = orderedBlocks(chapter);
        const total = blocks.reduce((sum, block) => sum + String(block.text || '').length, 0);
        if (!blocks.length) return null;
        if (!total) return { blockId: blocks[0].blockId, offset: 0 };
        let target = clampRatio(ratio) * total;
        for (const block of blocks) {
            const length = String(block.text || '').length;
            if (target <= length) return { blockId: block.blockId, offset: Math.min(length, Math.round(target)) };
            target -= length;
        }
        const last = blocks[blocks.length - 1];
        return { blockId: last.blockId, offset: String(last.text || '').length };
    }

    function chapterTargetForBookRatio(contents, ratio) {
        const chapters = Array.isArray(contents) ? contents : [];
        if (!chapters.length) return null;
        const weights = chapters.map(chapterWeight);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        if (!total) return { chapterId: chapters[0].chapterId, chapterRatio: 0 };
        let target = clampRatio(ratio) * total;
        for (let index = 0; index < chapters.length; index += 1) {
            const weight = weights[index];
            if (target <= weight || index === chapters.length - 1) {
                return { chapterId: chapters[index].chapterId, chapterRatio: weight ? clampRatio(target / weight) : 0 };
            }
            target -= weight;
        }
        return { chapterId: chapters[chapters.length - 1].chapterId, chapterRatio: 1 };
    }

    function contentProgressForLocator(contents, chapter, locator) {
        const chapters = Array.isArray(contents) ? contents : [];
        if (!chapters.length || !chapter || !locator) return 0;
        const chapterIndex = chapters.findIndex((item) => item.chapterId === chapter.chapterId);
        if (chapterIndex < 0) return 0;
        const total = chapters.reduce((sum, item) => sum + chapterWeight(item), 0);
        if (!total) return 0;
        const before = chapters.slice(0, chapterIndex).reduce((sum, item) => sum + chapterWeight(item), 0);
        const blocks = orderedBlocks(chapter);
        const localTotal = blocks.reduce((sum, block) => sum + String(block.text || '').length, 0);
        const blockIndex = blocks.findIndex((block) => block.blockId === locator.blockId);
        const localBefore = blockIndex < 0 ? 0 : blocks.slice(0, blockIndex).reduce((sum, block) => sum + String(block.text || '').length, 0);
        const blockLength = blockIndex < 0 ? 0 : String(blocks[blockIndex].text || '').length;
        const local = localTotal ? (localBefore + Math.max(0, Math.min(blockLength, Number(locator.offset) || 0))) / localTotal : 0;
        return clampRatio((before + chapterWeight(chapters[chapterIndex]) * local) / total);
    }

    return {
        findLiteralMatches,
        blockPositionForChapterRatio,
        chapterTargetForBookRatio,
        contentProgressForLocator
    };
});
