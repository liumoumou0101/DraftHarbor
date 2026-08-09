(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderDocumentSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DOCUMENT_SCHEMA_VERSION = 2;
    const REVISION_SCHEMA_VERSION = 1;
    const SOURCE_KINDS = Object.freeze(['project', 'local-text', 'pasted-text']);
    const FORMATS = Object.freeze(['project', 'txt', 'md', 'epub', 'plain']);
    const BLOCK_TYPES = Object.freeze(['heading', 'scene-title', 'paragraph', 'blank-break', 'code']);
    const LAYOUT_MODES = Object.freeze(['flow', 'single-page', 'double-page', 'illustrated', 'auto']);
    const PAGE_TRANSITIONS = Object.freeze(['fade', 'slide', 'cover', 'curl', 'none']);
    const THEME_IDS = Object.freeze(['white', 'paper', 'warm', 'eye', 'ink', 'oled', 'dark', 'sepia']);
    const FONT_FAMILY_IDS = Object.freeze(['system', 'serif', 'sans-serif', 'kai']);
    const TEXT_ALIGNMENTS = Object.freeze(['start', 'justify']);
    const APPEARANCE_PROFILE_IDS = Object.freeze(['default', 'paper', 'focus', 'custom']);
    const BOOKMARK_COLORS = Object.freeze(['yellow', 'blue', 'green', 'pink', 'gray']);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function normalizeText(value) {
        return String(value === null || value === undefined ? '' : value).replace(/\r\n?/g, '\n');
    }

    function clonePlain(value) {
        if (Array.isArray(value)) return value.map(clonePlain);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
        return result;
    }

    function deepFreeze(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        Object.freeze(value);
        for (const item of Object.values(value)) deepFreeze(item);
        return value;
    }

    function assertEnum(value, allowed, label) {
        const normalized = cleanString(value);
        if (!allowed.includes(normalized)) throw new Error(`${label} is not supported: ${normalized || '(empty)'}`);
        return normalized;
    }

    function assertSchemaVersion(value, expected, label) {
        const version = Number(value);
        if (version !== expected) throw new Error(`${label} schemaVersion must be ${expected}`);
        return version;
    }

    function normalizeTimestamp(value, label) {
        const text = cleanString(value);
        const parsed = new Date(text);
        if (!text || Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid timestamp`);
        return parsed.toISOString();
    }

    function nonNegativeInteger(value, fallback = 0) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 ? number : fallback;
    }

    function finiteNumber(value, fallback, minimum, maximum) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(minimum, Math.min(maximum, number));
    }

    function uniqueIds(items, label) {
        const seen = new Set();
        for (const item of items) {
            if (seen.has(item.id)) throw new Error(`duplicate ${label} id: ${item.id}`);
            seen.add(item.id);
        }
    }

    function resolveDigest(provided, canonical, options, label) {
        const existing = cleanString(provided);
        if (options && typeof options.digest === 'function') {
            const generated = cleanString(options.digest(canonical));
            if (!generated) throw new Error(`${label} digest function returned an empty value`);
            if (existing && existing !== generated) throw new Error(`${label} digest does not match normalized content`);
            return generated;
        }
        if (existing) return existing;
        throw new Error(`${label} digest is required`);
    }

    function createReaderBlock(input = {}, context = {}) {
        const type = assertEnum(input.type || 'paragraph', BLOCK_TYPES, 'reader block type');
        const order = nonNegativeInteger(input.order, nonNegativeInteger(context.index));
        const id = cleanString(input.blockId || input.id, `block-${order + 1}`);
        if (!id) throw new Error('reader block id is required');
        const text = normalizeText(input.text);
        if (['heading', 'scene-title', 'paragraph'].includes(type) && !text.trim()) {
            throw new Error(`reader block ${id} text is required`);
        }
        const sourceSceneId = cleanString(input.sourceSceneId);
        const hasStart = input.sourceStart !== undefined && input.sourceStart !== null && input.sourceStart !== '';
        const hasEnd = input.sourceEnd !== undefined && input.sourceEnd !== null && input.sourceEnd !== '';
        const sourceStart = hasStart ? nonNegativeInteger(input.sourceStart, -1) : undefined;
        const sourceEnd = hasEnd ? nonNegativeInteger(input.sourceEnd, -1) : undefined;
        if (hasStart !== hasEnd || sourceStart < 0 || sourceEnd < sourceStart) {
            throw new Error(`reader block ${id} source range is invalid`);
        }
        if ((hasStart || hasEnd) && !sourceSceneId) {
            throw new Error(`reader block ${id} sourceSceneId is required for a source range`);
        }
        return {
            blockId: id,
            type,
            text,
            order,
            sourceSceneId,
            sourceStart,
            sourceEnd,
            textDigest: cleanString(input.textDigest)
        };
    }

    function createReaderChapter(input = {}, context = {}) {
        const order = nonNegativeInteger(input.order, nonNegativeInteger(context.index));
        const chapterId = cleanString(input.chapterId || input.id, `chapter-${order + 1}`);
        if (!chapterId) throw new Error('reader chapter id is required');
        const blocks = (Array.isArray(input.blocks) ? input.blocks : []).map((block, index) => createReaderBlock(block, { index }));
        uniqueIds(blocks.map((block) => ({ id: block.blockId })), 'reader block');
        return {
            chapterId,
            title: cleanString(input.title, `第 ${order + 1} 章`) || `第 ${order + 1} 章`,
            order,
            sourceChapterId: cleanString(input.sourceChapterId),
            blocks
        };
    }

    function canonicalReaderRevisionContent(input = {}) {
        const chapters = (Array.isArray(input.chapters) ? input.chapters : []).map((chapter, chapterIndex) => {
            const normalized = createReaderChapter(chapter, { index: chapterIndex });
            return {
                title: normalized.title,
                blocks: normalized.blocks.map((block) => block.text)
            };
        });
        return JSON.stringify(chapters);
    }

    function canonicalReaderRevisionStructure(input = {}) {
        const chapters = (Array.isArray(input.chapters) ? input.chapters : []).map((chapter, chapterIndex) => {
            const normalized = createReaderChapter(chapter, { index: chapterIndex });
            return {
                chapterId: normalized.chapterId,
                title: normalized.title,
                order: normalized.order,
                sourceChapterId: normalized.sourceChapterId,
                blocks: normalized.blocks.map((block) => ({
                    blockId: block.blockId,
                    type: block.type,
                    order: block.order,
                    sourceSceneId: block.sourceSceneId,
                    sourceStart: block.sourceStart,
                    sourceEnd: block.sourceEnd,
                    length: block.text.length
                }))
            };
        });
        return JSON.stringify(chapters);
    }

    function createReaderDocumentRevision(input = {}, options = {}) {
        assertSchemaVersion(input.schemaVersion === undefined ? REVISION_SCHEMA_VERSION : input.schemaVersion, REVISION_SCHEMA_VERSION, 'reader revision');
        const revisionId = cleanString(input.revisionId || input.id);
        if (!revisionId) throw new Error('reader revisionId is required');
        const chapters = (Array.isArray(input.chapters) ? input.chapters : []).map((chapter, index) => {
            const normalized = createReaderChapter(chapter, { index });
            return {
                ...normalized,
                blocks: normalized.blocks.map((block) => ({
                    ...block,
                    textDigest: resolveDigest(block.textDigest, block.text, options, `reader block ${block.blockId} text`)
                }))
            };
        });
        if (!chapters.length) throw new Error('reader revision requires at least one chapter');
        uniqueIds(chapters.map((chapter) => ({ id: chapter.chapterId })), 'reader chapter');
        const canonicalContent = canonicalReaderRevisionContent({ chapters });
        const canonicalStructure = canonicalReaderRevisionStructure({ chapters });
        const revision = {
            schemaVersion: REVISION_SCHEMA_VERSION,
            revisionId,
            parentRevisionId: cleanString(input.parentRevisionId),
            contentDigest: resolveDigest(input.contentDigest, canonicalContent, options, 'reader revision content'),
            structureDigest: resolveDigest(input.structureDigest, canonicalStructure, options, 'reader revision structure'),
            createdAt: normalizeTimestamp(input.createdAt, 'reader revision createdAt'),
            encoding: cleanString(input.encoding),
            lineEnding: cleanString(input.lineEnding, 'lf') || 'lf',
            parserVersion: cleanString(input.parserVersion, 'reader-document@2') || 'reader-document@2',
            chapters
        };
        return deepFreeze(revision);
    }

    function validateSourceFormat(sourceKind, format) {
        const allowed = {
            project: ['project'],
            'local-text': ['txt', 'md', 'epub'],
            'pasted-text': ['plain', 'md']
        };
        if (!allowed[sourceKind].includes(format)) {
            throw new Error(`reader format ${format} is not valid for sourceKind ${sourceKind}`);
        }
    }

    function createReaderDocument(input = {}, options = {}) {
        assertSchemaVersion(input.schemaVersion === undefined ? DOCUMENT_SCHEMA_VERSION : input.schemaVersion, DOCUMENT_SCHEMA_VERSION, 'reader document');
        const sourceKind = assertEnum(input.sourceKind, SOURCE_KINDS, 'reader sourceKind');
        const format = assertEnum(input.format, FORMATS, 'reader format');
        validateSourceFormat(sourceKind, format);
        const documentId = cleanString(input.documentId || input.id);
        if (!documentId) throw new Error('reader documentId is required');
        const projectId = cleanString(input.projectId);
        if (sourceKind === 'project') {
            if (!projectId) throw new Error('project reader document requires projectId');
            if (documentId !== `project:${projectId}`) throw new Error('project reader documentId must equal project:<projectId>');
        } else if (documentId.startsWith('project:')) {
            throw new Error('external reader documentId must not use the project namespace');
        }
        const revisions = (Array.isArray(input.revisions) ? input.revisions : []).map((revision) => createReaderDocumentRevision(revision, options));
        uniqueIds(revisions.map((revision) => ({ id: revision.revisionId })), 'reader revision');
        const activeRevisionId = cleanString(input.activeRevisionId, revisions.length ? revisions[revisions.length - 1].revisionId : '');
        if (revisions.length && !revisions.some((revision) => revision.revisionId === activeRevisionId)) {
            throw new Error(`active reader revision not found: ${activeRevisionId}`);
        }
        if (!revisions.length && activeRevisionId) throw new Error('reader document without revisions cannot have activeRevisionId');
        return {
            schemaVersion: DOCUMENT_SCHEMA_VERSION,
            documentId,
            sourceKind,
            format,
            title: cleanString(input.title, '未命名文档') || '未命名文档',
            originalFileName: cleanString(input.originalFileName),
            projectId,
            importedAt: normalizeTimestamp(input.importedAt || input.createdAt, 'reader document importedAt'),
            updatedAt: normalizeTimestamp(input.updatedAt || input.importedAt || input.createdAt, 'reader document updatedAt'),
            activeRevisionId,
            revisions
        };
    }

    function appendReaderDocumentRevision(documentInput = {}, revisionInput = {}, options = {}) {
        const document = createReaderDocument(documentInput, options);
        const revision = createReaderDocumentRevision(revisionInput, options);
        if (document.revisions.some((item) => item.revisionId === revision.revisionId)) {
            throw new Error(`reader revision already exists: ${revision.revisionId}`);
        }
        if (revision.parentRevisionId && !document.revisions.some((item) => item.revisionId === revision.parentRevisionId)) {
            throw new Error(`reader parent revision not found: ${revision.parentRevisionId}`);
        }
        return createReaderDocument({
            ...document,
            activeRevisionId: revision.revisionId,
            updatedAt: revision.createdAt,
            revisions: [...document.revisions, revision]
        }, options);
    }

    function updateReaderDocumentMetadata(documentInput = {}, patch = {}, options = {}) {
        const document = createReaderDocument(documentInput, options);
        return createReaderDocument({
            ...document,
            title: patch.title === undefined ? document.title : patch.title,
            originalFileName: patch.originalFileName === undefined ? document.originalFileName : patch.originalFileName,
            updatedAt: patch.updatedAt || document.updatedAt,
            activeRevisionId: document.activeRevisionId,
            revisions: document.revisions
        }, options);
    }

    function createReaderGlobalPreferences(input = {}) {
        const layoutMode = input.layoutMode === undefined ? 'double-page' : assertEnum(input.layoutMode, LAYOUT_MODES, 'reader layoutMode');
        const pageTransition = input.pageTransition === undefined ? 'fade' : assertEnum(input.pageTransition, PAGE_TRANSITIONS, 'reader pageTransition');
        const themeId = input.themeId === undefined ? 'dark' : assertEnum(input.themeId, THEME_IDS, 'reader themeId');
        const fontFamilyId = input.fontFamilyId === undefined ? 'system' : assertEnum(input.fontFamilyId, FONT_FAMILY_IDS, 'reader fontFamilyId');
        const fontId = cleanString(input.fontId, {
            system: 'builtin:default',
            serif: 'builtin:serif',
            'sans-serif': 'builtin:sans',
            kai: 'builtin:kai'
        }[fontFamilyId] || 'builtin:default');
        if (!/^[a-z0-9][a-z0-9:._-]{1,119}$/i.test(fontId)) throw new Error('reader fontId is invalid');
        const appearanceProfileId = input.appearanceProfileId === undefined
            ? 'default' : assertEnum(input.appearanceProfileId, APPEARANCE_PROFILE_IDS, 'reader appearanceProfileId');
        const textAlign = input.textAlign === undefined ? 'start' : assertEnum(input.textAlign, TEXT_ALIGNMENTS, 'reader textAlign');
        const reducedMotionOverride = input.reducedMotionOverride;
        if (![undefined, null, true, false].includes(reducedMotionOverride)) {
            throw new Error('reader reducedMotionOverride must be true, false or unset');
        }
        return {
            schemaVersion: 1,
            layoutMode,
            pageTransition,
            themeId,
            fontFamilyId,
            fontId,
            fontCatalogVersion: Math.max(1, Math.floor(Number(input.fontCatalogVersion) || 1)),
            fontSize: finiteNumber(input.fontSize, 18, 12, 48),
            lineHeight: finiteNumber(input.lineHeight, 1.8, 1.2, 3),
            letterSpacing: finiteNumber(input.letterSpacing, 0, -0.05, 0.3),
            paragraphSpacing: finiteNumber(input.paragraphSpacing, 1.05, 0, 3),
            pageMargin: finiteNumber(input.pageMargin, 48, 12, 160),
            textWidth: finiteNumber(input.textWidth, 760, 420, 1400),
            textAlign,
            indent: input.indent !== false,
            reducedMotionOverride: reducedMotionOverride === null ? undefined : reducedMotionOverride,
            appearanceProfileId
        };
    }

    function createReaderBookmark(input = {}) {
        const id = cleanString(input.bookmarkId || input.id);
        if (!id) throw new Error('reader bookmark id is required');
        if (!input.locator || typeof input.locator !== 'object' || Array.isArray(input.locator)) {
            throw new Error(`reader bookmark ${id} locator is required`);
        }
        return {
            bookmarkId: id,
            title: cleanString(input.title, '书签') || '书签',
            excerpt: cleanString(input.excerpt).slice(0, 500),
            color: assertEnum(input.color || 'yellow', BOOKMARK_COLORS, `reader bookmark ${id} color`),
            category: cleanString(input.category, '未分类').slice(0, 80) || '未分类',
            note: cleanString(input.note).slice(0, 1000),
            locator: clonePlain(input.locator),
            createdAt: normalizeTimestamp(input.createdAt, 'reader bookmark createdAt'),
            lastVisitedAt: input.lastVisitedAt ? normalizeTimestamp(input.lastVisitedAt, 'reader bookmark lastVisitedAt') : null
        };
    }

    function createReaderDocumentState(input = {}) {
        const documentId = cleanString(input.documentId);
        if (!documentId) throw new Error('reader document state documentId is required');
        const bookmarks = (Array.isArray(input.bookmarks) ? input.bookmarks : []).map(createReaderBookmark);
        uniqueIds(bookmarks.map((bookmark) => ({ id: bookmark.bookmarkId })), 'reader bookmark');
        return {
            schemaVersion: 1,
            documentId,
            positionLocator: input.positionLocator && typeof input.positionLocator === 'object' && !Array.isArray(input.positionLocator)
                ? clonePlain(input.positionLocator)
                : null,
            updatedAt: normalizeTimestamp(input.updatedAt, 'reader document state updatedAt'),
            preferenceOverrides: input.preferenceOverrides && typeof input.preferenceOverrides === 'object' && !Array.isArray(input.preferenceOverrides)
                ? clonePlain(input.preferenceOverrides)
                : {},
            bookmarks
        };
    }

    return {
        DOCUMENT_SCHEMA_VERSION,
        REVISION_SCHEMA_VERSION,
        SOURCE_KINDS,
        FORMATS,
        BLOCK_TYPES,
        LAYOUT_MODES,
        PAGE_TRANSITIONS,
        THEME_IDS,
        FONT_FAMILY_IDS,
        BOOKMARK_COLORS,
        TEXT_ALIGNMENTS,
        APPEARANCE_PROFILE_IDS,
        normalizeText,
        createReaderBlock,
        createReaderChapter,
        canonicalReaderRevisionContent,
        canonicalReaderRevisionStructure,
        createReaderDocumentRevision,
        createReaderDocument,
        appendReaderDocumentRevision,
        updateReaderDocumentMetadata,
        createReaderGlobalPreferences,
        createReaderBookmark,
        createReaderDocumentState
    };
});
