(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./reader-document-schema'), require('./reader-locator'));
    } else {
        root.DraftHarborReaderSelection = factory(root.DraftHarborReaderDocumentSchema, root.DraftHarborReaderLocator);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderSchema, ReaderLocator) {
    const SCOPES = Object.freeze(['selection', 'scene', 'chapter', 'chapters', 'document']);

    function cleanString(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function orderedRevision(revisionInput = {}) {
        const revisionId = cleanString(revisionInput.revisionId || revisionInput.id);
        if (!revisionId) throw new Error('reader selection revisionId is required');
        const chapters = (Array.isArray(revisionInput.chapters) ? revisionInput.chapters : [])
            .map((chapter, index) => ({ ...ReaderSchema.createReaderChapter(chapter, { index }), _index: index }))
            .sort((left, right) => left.order - right.order || left._index - right._index)
            .map((chapter) => ({
                ...chapter,
                blocks: chapter.blocks
                    .map((block, index) => ({ ...block, _index: index }))
                    .sort((left, right) => left.order - right.order || left._index - right._index)
            }));
        if (!chapters.length) throw new Error('reader selection requires at least one chapter');
        return { revisionId, chapters };
    }

    function flatten(view) {
        return view.chapters.flatMap((chapter) => chapter.blocks.map((block) => ({ chapter, block })));
    }

    function locatorIndex(positions, locator) {
        return positions.findIndex((entry) => entry.chapter.chapterId === locator.chapterId && entry.block.blockId === locator.blockId);
    }

    function normalizedRange(view, rangeInput) {
        const start = ReaderLocator.createReaderLocator(rangeInput && rangeInput.start);
        const end = ReaderLocator.createReaderLocator(rangeInput && rangeInput.end);
        if (start.revisionId !== view.revisionId || end.revisionId !== view.revisionId) throw new Error('reader selection range revision does not match');
        const positions = flatten(view);
        const startIndex = locatorIndex(positions, start);
        const endIndex = locatorIndex(positions, end);
        if (startIndex < 0 || endIndex < 0) throw new Error('reader selection range block was not found');
        const startOffset = ReaderLocator.snapUtf16Offset(positions[startIndex].block.text, start.offset, 'before');
        const endOffset = ReaderLocator.snapUtf16Offset(positions[endIndex].block.text, end.offset, 'after');
        const reversed = startIndex > endIndex || (startIndex === endIndex && startOffset > endOffset);
        return reversed
            ? { start: { ...end, offset: ReaderLocator.snapUtf16Offset(positions[endIndex].block.text, end.offset, 'before') }, end: { ...start, offset: ReaderLocator.snapUtf16Offset(positions[startIndex].block.text, start.offset, 'after') } }
            : { start: { ...start, offset: startOffset }, end: { ...end, offset: endOffset } };
    }

    function selectedPositions(view, request = {}) {
        const scope = cleanString(request.scope);
        if (!SCOPES.includes(scope)) throw new Error(`reader selection scope is not supported: ${scope || '(empty)'}`);
        const positions = flatten(view);
        if (scope === 'selection') {
            const range = normalizedRange(view, request.range);
            const startIndex = locatorIndex(positions, range.start);
            const endIndex = locatorIndex(positions, range.end);
            return positions.slice(startIndex, endIndex + 1).map((entry, index, selected) => ({
                ...entry,
                startOffset: index === 0 ? range.start.offset : 0,
                endOffset: index === selected.length - 1 ? range.end.offset : entry.block.text.length
            }));
        }
        let chapterIds = [];
        if (scope === 'chapter') chapterIds = [cleanString(request.chapterId || (request.chapterIds || [])[0])];
        if (scope === 'chapters') chapterIds = (Array.isArray(request.chapterIds) ? request.chapterIds : []).map(cleanString).filter(Boolean);
        if (['chapter', 'chapters'].includes(scope)) {
            if (!chapterIds.length) throw new Error(`reader ${scope} selection requires chapterIds`);
            const known = new Set(view.chapters.map((chapter) => chapter.chapterId));
            if (chapterIds.some((chapterId) => !known.has(chapterId))) throw new Error('reader selection chapter was not found');
            const selected = new Set(chapterIds);
            return positions.filter((entry) => selected.has(entry.chapter.chapterId)).map((entry) => ({ ...entry, startOffset: 0, endOffset: entry.block.text.length }));
        }
        if (scope === 'scene') {
            const sceneId = cleanString(request.sceneId);
            if (!sceneId) throw new Error('reader scene selection requires sceneId');
            const matches = positions.filter((entry) => entry.block.sourceSceneId === sceneId);
            if (!matches.length) throw new Error('reader selection scene was not found');
            return matches.map((entry) => ({ ...entry, startOffset: 0, endOffset: entry.block.text.length }));
        }
        return positions.map((entry) => ({ ...entry, startOffset: 0, endOffset: entry.block.text.length }));
    }

    function locatorFor(entry, offset, affinity, context) {
        return ReaderLocator.createReaderLocator({
            documentId: context.documentId,
            revisionId: context.revisionId,
            chapterId: entry.chapter.chapterId,
            blockId: entry.block.blockId,
            offset,
            affinity,
            projectRef: {
                projectId: context.projectId,
                chapterId: entry.chapter.sourceChapterId,
                sceneId: entry.block.sourceSceneId,
                sceneOffset: entry.block.sourceStart === undefined ? undefined : entry.block.sourceStart + offset
            },
            blockDigest: entry.block.textDigest
        });
    }

    function buildReaderTransferSelection(revisionInput = {}, request = {}) {
        const view = orderedRevision(revisionInput);
        const documentId = cleanString(request.documentId);
        if (!documentId) throw new Error('reader selection documentId is required');
        const selected = selectedPositions(view, request).filter((entry) => entry.endOffset > entry.startOffset || entry.block.text.length === 0);
        if (!selected.length) throw new Error('reader selection is empty');
        const chapterGroups = [];
        for (const entry of selected) {
            let group = chapterGroups[chapterGroups.length - 1];
            if (!group || group.chapterId !== entry.chapter.chapterId) {
                group = { chapterId: entry.chapter.chapterId, title: entry.chapter.title, sourceChapterId: entry.chapter.sourceChapterId, entries: [] };
                chapterGroups.push(group);
            }
            group.entries.push(entry);
        }
        const sections = chapterGroups.map((group, index) => {
            const text = group.entries.map((entry) => entry.block.text.slice(entry.startOffset, entry.endOffset)).join('\n\n');
            return {
                sectionId: `section-${index + 1}:${group.chapterId}`,
                title: group.title,
                chapterId: group.chapterId,
                sourceChapterId: group.sourceChapterId,
                order: index,
                characterCount: text.length,
                text,
                sceneIds: [...new Set(group.entries.map((entry) => entry.block.sourceSceneId).filter(Boolean))]
            };
        });
        const text = sections.map((section) => sections.length > 1 ? `# ${section.title}\n\n${section.text}` : section.text).join('\n\n');
        if (!text.trim()) throw new Error('reader selection is empty');
        const first = selected[0];
        const last = selected[selected.length - 1];
        const context = { documentId, revisionId: view.revisionId, projectId: cleanString(request.projectId) };
        return {
            scope: cleanString(request.scope),
            text,
            characterCount: text.length,
            sourceLocators: [
                locatorFor(first, first.startOffset, 'before', context),
                locatorFor(last, last.endOffset, 'after', context)
            ],
            sections,
            chapterIds: sections.map((section) => section.chapterId),
            sourceChapterIds: [...new Set(sections.map((section) => section.sourceChapterId).filter(Boolean))],
            sceneIds: [...new Set(sections.flatMap((section) => section.sceneIds))]
        };
    }

    return { SCOPES, buildReaderTransferSelection };
});
