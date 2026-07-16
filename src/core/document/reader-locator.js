(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./reader-document-schema'));
    } else {
        root.DraftHarborReaderLocator = factory(root.DraftHarborReaderDocumentSchema);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderSchema) {
    const LOCATOR_SCHEMA_VERSION = 1;
    const RANGE_SCHEMA_VERSION = 1;
    const AFFINITIES = Object.freeze(['before', 'after']);
    const RESOLUTIONS = Object.freeze(['exact', 'approximate', 'unresolved']);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function normalizeQuoteText(value, limit) {
        return ReaderSchema.normalizeText(value === null || value === undefined ? '' : value).slice(0, limit);
    }

    function normalizeQuotePrefix(value) {
        return ReaderSchema.normalizeText(value === null || value === undefined ? '' : value).slice(-64);
    }

    function nonNegativeInteger(value, fallback = 0) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 ? number : fallback;
    }

    function locatorOffset(value) {
        if (value === undefined || value === null || value === '') return 0;
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0) throw new Error('reader locator offset must be a non-negative integer');
        return number;
    }

    function assertSchemaVersion(value, expected, label) {
        const version = Number(value);
        if (version !== expected) throw new Error(`${label} schemaVersion must be ${expected}`);
    }

    function createReaderLocator(input = {}) {
        assertSchemaVersion(input.schemaVersion === undefined ? LOCATOR_SCHEMA_VERSION : input.schemaVersion, LOCATOR_SCHEMA_VERSION, 'reader locator');
        const documentId = cleanString(input.documentId);
        const revisionId = cleanString(input.revisionId);
        const chapterId = cleanString(input.chapterId);
        const blockId = cleanString(input.blockId);
        const affinity = cleanString(input.affinity, 'before');
        if (!documentId) throw new Error('reader locator documentId is required');
        if (!revisionId) throw new Error('reader locator revisionId is required');
        if (!chapterId) throw new Error('reader locator chapterId is required');
        if (!AFFINITIES.includes(affinity)) throw new Error(`reader locator affinity is not supported: ${affinity}`);
        const projectInput = input.projectRef && typeof input.projectRef === 'object' && !Array.isArray(input.projectRef)
            ? input.projectRef
            : {};
        const projectRef = {
            projectId: cleanString(projectInput.projectId),
            chapterId: cleanString(projectInput.chapterId),
            sceneId: cleanString(projectInput.sceneId),
            sceneOffset: projectInput.sceneOffset === undefined || projectInput.sceneOffset === null
                ? undefined
                : nonNegativeInteger(projectInput.sceneOffset, -1)
        };
        if (projectRef.sceneOffset !== undefined && (projectRef.sceneOffset < 0 || !projectRef.sceneId)) {
            throw new Error('reader locator project sceneOffset requires a sceneId');
        }
        if (!blockId && !projectRef.sceneId) throw new Error('reader locator requires blockId or project sceneId');
        const quoteInput = input.quote && typeof input.quote === 'object' && !Array.isArray(input.quote) ? input.quote : {};
        const contextInput = input.contextBlockDigests && typeof input.contextBlockDigests === 'object' && !Array.isArray(input.contextBlockDigests)
            ? input.contextBlockDigests
            : {};
        return {
            schemaVersion: LOCATOR_SCHEMA_VERSION,
            documentId,
            revisionId,
            chapterId,
            blockId,
            offset: locatorOffset(input.offset),
            affinity,
            projectRef,
            quote: {
                exact: normalizeQuoteText(quoteInput.exact, 256),
                prefix: normalizeQuotePrefix(quoteInput.prefix),
                suffix: normalizeQuoteText(quoteInput.suffix, 64)
            },
            blockDigest: cleanString(input.blockDigest),
            contextBlockDigests: {
                previous: cleanString(contextInput.previous),
                next: cleanString(contextInput.next)
            }
        };
    }

    function createReaderRange(input = {}) {
        assertSchemaVersion(input.schemaVersion === undefined ? RANGE_SCHEMA_VERSION : input.schemaVersion, RANGE_SCHEMA_VERSION, 'reader range');
        const start = createReaderLocator(input.start);
        const end = createReaderLocator(input.end);
        if (start.documentId !== end.documentId) throw new Error('reader range locators must belong to the same document');
        if (start.revisionId !== end.revisionId) throw new Error('reader range locators must belong to the same revision');
        return { schemaVersion: RANGE_SCHEMA_VERSION, start, end };
    }

    function revisionView(input = {}) {
        const revisionId = cleanString(input.revisionId || input.id);
        if (!revisionId) throw new Error('reader locator target revisionId is required');
        const chapters = (Array.isArray(input.chapters) ? input.chapters : [])
            .map((chapter, chapterIndex) => ({
                ...ReaderSchema.createReaderChapter(chapter, { index: chapterIndex }),
                _sourceIndex: chapterIndex
            }))
            .sort((left, right) => left.order - right.order || left._sourceIndex - right._sourceIndex)
            .map((chapter) => ({
                ...chapter,
                blocks: chapter.blocks
                    .map((block, blockIndex) => ({ ...block, _sourceIndex: blockIndex }))
                    .sort((left, right) => left.order - right.order || left._sourceIndex - right._sourceIndex)
            }));
        if (!chapters.length) throw new Error('reader locator target requires at least one chapter');
        return { revisionId, chapters };
    }

    function graphemeBoundaries(text) {
        if (typeof Intl === 'object' && typeof Intl.Segmenter === 'function') {
            const boundaries = [0];
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            for (const segment of segmenter.segment(text)) boundaries.push(segment.index + segment.segment.length);
            return [...new Set(boundaries)].sort((left, right) => left - right);
        }
        const boundaries = [0];
        let offset = 0;
        for (const character of String(text || '')) {
            offset += character.length;
            boundaries.push(offset);
        }
        return boundaries;
    }

    function snapUtf16Offset(textInput, offsetInput, affinity = 'before') {
        const text = String(textInput || '');
        const offset = Math.max(0, Math.min(text.length, nonNegativeInteger(offsetInput)));
        const boundaries = graphemeBoundaries(text);
        if (boundaries.includes(offset)) return offset;
        if (affinity === 'after') return boundaries.find((boundary) => boundary > offset) ?? text.length;
        for (let index = boundaries.length - 1; index >= 0; index -= 1) {
            if (boundaries[index] < offset) return boundaries[index];
        }
        return 0;
    }

    function findChapter(view, chapterId) {
        return view.chapters.find((chapter) => chapter.chapterId === chapterId);
    }

    function findBlock(view, chapterId, blockId) {
        const chapter = findChapter(view, chapterId);
        if (!chapter) return null;
        const blockIndex = chapter.blocks.findIndex((block) => block.blockId === blockId);
        if (blockIndex < 0) return null;
        return { chapter, block: chapter.blocks[blockIndex], blockIndex };
    }

    function quoteMatchesAt(text, offset, quote, affinity) {
        const exact = quote.exact || '';
        const prefix = quote.prefix || '';
        const suffix = quote.suffix || '';
        if (exact) {
            const exactStart = affinity === 'after' ? offset - exact.length : offset;
            if (exactStart < 0 || text.slice(exactStart, exactStart + exact.length) !== exact) return false;
        }
        if (prefix && text.slice(Math.max(0, offset - prefix.length), offset) !== prefix) return false;
        if (suffix && text.slice(offset, offset + suffix.length) !== suffix) return false;
        return !!(exact || prefix || suffix);
    }

    function hasQuoteAnchor(locator) {
        return !!(locator.quote.exact || locator.quote.prefix || locator.quote.suffix);
    }

    function makeResolvedLocator(locator, revisionId, chapter, block, offset) {
        const snapped = snapUtf16Offset(block.text, offset, locator.affinity);
        const hasSourceRange = block.sourceSceneId && Number.isInteger(block.sourceStart);
        return createReaderLocator({
            ...locator,
            revisionId,
            chapterId: chapter.chapterId,
            blockId: block.blockId,
            offset: snapped,
            blockDigest: block.textDigest || locator.blockDigest,
            projectRef: hasSourceRange ? {
                ...locator.projectRef,
                chapterId: chapter.sourceChapterId || chapter.chapterId,
                sceneId: block.sourceSceneId,
                sceneOffset: block.sourceStart + snapped
            } : locator.projectRef
        });
    }

    function candidateEntries(view, locator) {
        const sameChapter = findChapter(view, locator.chapterId);
        const entries = [];
        const chapters = sameChapter ? [sameChapter] : view.chapters;
        for (const chapter of chapters) {
            chapter.blocks.forEach((block, blockIndex) => entries.push({ chapter, block, blockIndex }));
        }
        if (locator.projectRef.sceneId) {
            const sceneEntries = [];
            for (const chapter of view.chapters) {
                chapter.blocks.forEach((block, blockIndex) => {
                    if (block.sourceSceneId === locator.projectRef.sceneId) sceneEntries.push({ chapter, block, blockIndex });
                });
            }
            if (sceneEntries.length) return sceneEntries;
        }
        return entries;
    }

    function findProjectPosition(view, locator) {
        const { sceneId, sceneOffset } = locator.projectRef;
        if (!sceneId || !Number.isInteger(sceneOffset)) return null;
        const matches = [];
        for (const chapter of view.chapters) {
            chapter.blocks.forEach((block, blockIndex) => {
                if (block.sourceSceneId !== sceneId || !Number.isInteger(block.sourceStart) || !Number.isInteger(block.sourceEnd)) return;
                if (sceneOffset < block.sourceStart || sceneOffset > block.sourceEnd) return;
                const offset = snapUtf16Offset(block.text, sceneOffset - block.sourceStart, locator.affinity);
                matches.push({ chapter, block, blockIndex, offset });
            });
        }
        if (!matches.length) return null;
        return matches.find((match) => quoteMatchesAt(match.block.text, match.offset, locator.quote, locator.affinity)) || matches[0];
    }

    function exactOccurrences(text, exact) {
        const offsets = [];
        if (!exact) return offsets;
        let from = 0;
        while (from <= text.length - exact.length) {
            const index = text.indexOf(exact, from);
            if (index < 0) break;
            offsets.push(index);
            from = index + Math.max(1, exact.length);
        }
        return offsets;
    }

    function findUniqueQuotePosition(view, locator) {
        if (!hasQuoteAnchor(locator)) return null;
        const matches = [];
        for (const entry of candidateEntries(view, locator)) {
            const text = entry.block.text;
            const offsets = locator.quote.exact
                ? exactOccurrences(text, locator.quote.exact).map((offset) => locator.affinity === 'after' ? offset + locator.quote.exact.length : offset)
                : graphemeBoundaries(text);
            for (const offset of offsets) {
                if (quoteMatchesAt(text, offset, locator.quote, locator.affinity)) matches.push({ ...entry, offset });
                if (matches.length > 1) return null;
            }
        }
        return matches.length === 1 ? matches[0] : null;
    }

    function neighborDigestScore(entry, locator) {
        let score = 0;
        const previous = entry.chapter.blocks[entry.blockIndex - 1];
        const next = entry.chapter.blocks[entry.blockIndex + 1];
        if (locator.contextBlockDigests.previous && previous && previous.textDigest === locator.contextBlockDigests.previous) score += 1;
        if (locator.contextBlockDigests.next && next && next.textDigest === locator.contextBlockDigests.next) score += 1;
        return score;
    }

    function findDigestPosition(view, locator) {
        if (!locator.blockDigest) return null;
        const matches = candidateEntries(view, locator).filter((entry) => entry.block.textDigest === locator.blockDigest);
        if (matches.length === 1) return { ...matches[0], offset: snapUtf16Offset(matches[0].block.text, locator.offset, locator.affinity) };
        if (matches.length < 2) return null;
        const scored = matches.map((entry) => ({ entry, score: neighborDigestScore(entry, locator) })).sort((left, right) => right.score - left.score);
        if (!scored[0].score || scored[0].score === scored[1].score) return null;
        return { ...scored[0].entry, offset: snapUtf16Offset(scored[0].entry.block.text, locator.offset, locator.affinity) };
    }

    function fallbackPosition(view, locator) {
        const chapter = findChapter(view, locator.chapterId) || view.chapters[0];
        const block = chapter.blocks.find((item) => item.type !== 'blank-break' && item.text.length) || chapter.blocks[0];
        if (block) return { chapter, block, offset: 0 };
        for (const candidateChapter of view.chapters) {
            const candidate = candidateChapter.blocks.find((item) => item.type !== 'blank-break' && item.text.length) || candidateChapter.blocks[0];
            if (candidate) return { chapter: candidateChapter, block: candidate, offset: 0 };
        }
        throw new Error('reader locator target revision has no blocks');
    }

    function resolutionResult(resolution, reason, locator, revisionId, position) {
        return {
            resolution,
            reason,
            locator: makeResolvedLocator(locator, revisionId, position.chapter, position.block, position.offset),
            chapter: position.chapter,
            block: position.block
        };
    }

    function resolveReaderLocator(locatorInput = {}, revisionInput = {}) {
        const locator = createReaderLocator(locatorInput);
        const view = revisionView(revisionInput);
        const direct = findBlock(view, locator.chapterId, locator.blockId);
        if (locator.revisionId === view.revisionId && direct) {
            return resolutionResult('exact', 'same-revision-block', locator, view.revisionId, {
                ...direct,
                offset: snapUtf16Offset(direct.block.text, locator.offset, locator.affinity)
            });
        }
        const projectPosition = findProjectPosition(view, locator);
        if (projectPosition) {
            if (quoteMatchesAt(projectPosition.block.text, projectPosition.offset, locator.quote, locator.affinity)) {
                return resolutionResult('exact', 'project-scene-offset', locator, view.revisionId, projectPosition);
            }
            if (!hasQuoteAnchor(locator)) {
                return resolutionResult('approximate', 'project-scene-offset-unverified', locator, view.revisionId, projectPosition);
            }
        }
        const quotePosition = findUniqueQuotePosition(view, locator);
        if (quotePosition) return resolutionResult('approximate', 'unique-text-anchor', locator, view.revisionId, quotePosition);
        const digestPosition = findDigestPosition(view, locator);
        if (digestPosition) return resolutionResult('approximate', 'block-digest-context', locator, view.revisionId, digestPosition);
        const fallback = fallbackPosition(view, locator);
        return resolutionResult('unresolved', 'chapter-fallback', locator, view.revisionId, fallback);
    }

    function locatorFromBlockPosition(input = {}, revisionInput = {}, options = {}) {
        const view = revisionView(revisionInput);
        const documentId = cleanString(input.documentId);
        const found = findBlock(view, cleanString(input.chapterId), cleanString(input.blockId));
        if (!documentId) throw new Error('reader locator documentId is required');
        if (!found) throw new Error('reader locator source block was not found');
        const affinity = cleanString(input.affinity, 'before');
        if (!AFFINITIES.includes(affinity)) throw new Error(`reader locator affinity is not supported: ${affinity}`);
        const offset = snapUtf16Offset(found.block.text, locatorOffset(input.offset), affinity);
        const prefixLength = Math.max(0, Math.min(64, nonNegativeInteger(options.prefixLength, 32)));
        const suffixLength = Math.max(0, Math.min(64, nonNegativeInteger(options.suffixLength, 32)));
        const previous = found.chapter.blocks[found.blockIndex - 1];
        const next = found.chapter.blocks[found.blockIndex + 1];
        const hasSourceRange = found.block.sourceSceneId && Number.isInteger(found.block.sourceStart);
        return createReaderLocator({
            schemaVersion: LOCATOR_SCHEMA_VERSION,
            documentId,
            revisionId: view.revisionId,
            chapterId: found.chapter.chapterId,
            blockId: found.block.blockId,
            offset,
            affinity,
            projectRef: hasSourceRange ? {
                projectId: cleanString(input.projectId),
                chapterId: found.chapter.sourceChapterId || found.chapter.chapterId,
                sceneId: found.block.sourceSceneId,
                sceneOffset: found.block.sourceStart + offset
            } : {},
            quote: {
                exact: normalizeQuoteText(options.exact, 256),
                prefix: found.block.text.slice(Math.max(0, offset - prefixLength), offset),
                suffix: found.block.text.slice(offset, offset + suffixLength)
            },
            blockDigest: found.block.textDigest,
            contextBlockDigests: {
                previous: previous && previous.textDigest,
                next: next && next.textDigest
            }
        });
    }

    function flattenPositions(view) {
        const positions = [];
        view.chapters.forEach((chapter, chapterIndex) => {
            chapter.blocks.forEach((block, blockIndex) => positions.push({ chapter, block, chapterIndex, blockIndex }));
        });
        return positions;
    }

    function compareResolvedLocators(view, left, right) {
        const positions = flattenPositions(view);
        const leftIndex = positions.findIndex((entry) => entry.chapter.chapterId === left.chapterId && entry.block.blockId === left.blockId);
        const rightIndex = positions.findIndex((entry) => entry.chapter.chapterId === right.chapterId && entry.block.blockId === right.blockId);
        if (leftIndex < 0 || rightIndex < 0) throw new Error('resolved reader range block was not found');
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return left.offset - right.offset;
    }

    function resolveReaderRange(rangeInput = {}, revisionInput = {}) {
        const range = createReaderRange(rangeInput);
        const view = revisionView(revisionInput);
        const start = resolveReaderLocator(range.start, revisionInput);
        const end = resolveReaderLocator(range.end, revisionInput);
        if (compareResolvedLocators(view, start.locator, end.locator) > 0) throw new Error('reader range start must not follow end');
        const resolution = start.resolution === 'unresolved' || end.resolution === 'unresolved'
            ? 'unresolved'
            : start.resolution === 'approximate' || end.resolution === 'approximate'
                ? 'approximate'
                : 'exact';
        return { schemaVersion: RANGE_SCHEMA_VERSION, resolution, start, end };
    }

    function extractReaderRangeText(rangeInput = {}, revisionInput = {}) {
        const resolved = resolveReaderRange(rangeInput, revisionInput);
        const view = revisionView(revisionInput);
        const positions = flattenPositions(view);
        const startIndex = positions.findIndex((entry) => entry.chapter.chapterId === resolved.start.locator.chapterId
            && entry.block.blockId === resolved.start.locator.blockId);
        const endIndex = positions.findIndex((entry) => entry.chapter.chapterId === resolved.end.locator.chapterId
            && entry.block.blockId === resolved.end.locator.blockId);
        const parts = [];
        for (let index = startIndex; index <= endIndex; index += 1) {
            const text = positions[index].block.text;
            const startOffset = index === startIndex ? resolved.start.locator.offset : 0;
            const endOffset = index === endIndex ? resolved.end.locator.offset : text.length;
            parts.push(text.slice(startOffset, endOffset));
        }
        return { ...resolved, text: parts.join('\n\n') };
    }

    function readableCharacterCount(textInput) {
        let count = 0;
        for (const character of String(textInput || '')) {
            if (!/\s/u.test(character)) count += 1;
        }
        return count;
    }

    function readerContentWeight(revisionInput = {}) {
        const view = revisionView(revisionInput);
        return flattenPositions(view).reduce((total, entry) => total + readableCharacterCount(entry.block.text), 0);
    }

    function readerProgressForLocator(locatorInput = {}, revisionInput = {}) {
        const resolved = resolveReaderLocator(locatorInput, revisionInput);
        const view = revisionView(revisionInput);
        const positions = flattenPositions(view);
        let before = 0;
        for (const entry of positions) {
            if (entry.chapter.chapterId === resolved.locator.chapterId && entry.block.blockId === resolved.locator.blockId) {
                before += readableCharacterCount(entry.block.text.slice(0, resolved.locator.offset));
                break;
            }
            before += readableCharacterCount(entry.block.text);
        }
        const total = positions.reduce((sum, entry) => sum + readableCharacterCount(entry.block.text), 0);
        return {
            progress: total > 0 ? Math.max(0, Math.min(1, before / total)) : 0,
            completedWeight: before,
            totalWeight: total,
            resolution: resolved.resolution,
            locator: resolved.locator
        };
    }

    return {
        LOCATOR_SCHEMA_VERSION,
        RANGE_SCHEMA_VERSION,
        AFFINITIES,
        RESOLUTIONS,
        createReaderLocator,
        createReaderRange,
        snapUtf16Offset,
        locatorFromBlockPosition,
        resolveReaderLocator,
        resolveReaderRange,
        extractReaderRangeText,
        readableCharacterCount,
        readerContentWeight,
        readerProgressForLocator
    };
});
