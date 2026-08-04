(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./reader-document-schema'));
    } else {
        root.DraftHarborReaderImport = factory(root.DraftHarborReaderDocumentSchema);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderSchema) {
    const IMPORT_DRAFT_SCHEMA_VERSION = 1;
    const SUPPORTED_ENCODINGS = Object.freeze(['utf-8', 'utf-16le', 'utf-16be', 'gb18030']);
    const IMPORT_FORMATS = Object.freeze(['txt', 'md', 'epub', 'plain']);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function asBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        if (Array.isArray(value)) return Uint8Array.from(value);
        throw new Error('reader import bytes must be a byte array');
    }

    function normalizeEncoding(value) {
        const label = cleanString(value, 'auto').toLowerCase().replace(/_/g, '-');
        const aliases = {
            utf8: 'utf-8',
            'utf-8-bom': 'utf-8',
            utf16le: 'utf-16le',
            'utf-16-le': 'utf-16le',
            utf16be: 'utf-16be',
            'utf-16-be': 'utf-16be',
            gbk: 'gb18030',
            'gb-18030': 'gb18030'
        };
        return aliases[label] || label;
    }

    function decodeWithTextDecoder(bytes, encoding, fatal) {
        if (typeof TextDecoder !== 'function') throw new Error('TextDecoder is unavailable');
        return new TextDecoder(encoding, { fatal: !!fatal }).decode(bytes);
    }

    function hasPrefix(bytes, prefix) {
        return prefix.every((value, index) => bytes[index] === value);
    }

    function utf16Heuristic(bytes) {
        if (bytes.length < 4) return '';
        let evenZeros = 0;
        let oddZeros = 0;
        const sampleLength = Math.min(bytes.length, 512);
        for (let index = 0; index < sampleLength; index += 1) {
            if (bytes[index] !== 0) continue;
            if (index % 2) oddZeros += 1;
            else evenZeros += 1;
        }
        const pairs = Math.floor(sampleLength / 2) || 1;
        if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return 'utf-16le';
        if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return 'utf-16be';
        return '';
    }

    function detectEncoding(bytesInput) {
        const bytes = asBytes(bytesInput);
        if (hasPrefix(bytes, [0xEF, 0xBB, 0xBF])) return { encoding: 'utf-8', confidence: 1, bomLength: 3, reason: 'bom' };
        if (hasPrefix(bytes, [0xFF, 0xFE])) return { encoding: 'utf-16le', confidence: 1, bomLength: 2, reason: 'bom' };
        if (hasPrefix(bytes, [0xFE, 0xFF])) return { encoding: 'utf-16be', confidence: 1, bomLength: 2, reason: 'bom' };
        const utf16 = utf16Heuristic(bytes);
        if (utf16) return { encoding: utf16, confidence: 0.8, bomLength: 0, reason: 'null-byte-pattern' };
        try {
            decodeWithTextDecoder(bytes, 'utf-8', true);
            return { encoding: 'utf-8', confidence: 0.9, bomLength: 0, reason: 'valid-utf8' };
        } catch (error) {
            return { encoding: '', confidence: 0, bomLength: 0, reason: 'manual-selection-required' };
        }
    }

    function countReplacementCharacters(text) {
        return (String(text || '').match(/\uFFFD/g) || []).length;
    }

    function decodeReaderBytes(bytesInput, requestedEncoding = 'auto') {
        const bytes = asBytes(bytesInput);
        const requested = normalizeEncoding(requestedEncoding);
        if (requested !== 'auto' && !SUPPORTED_ENCODINGS.includes(requested)) {
            throw new Error(`reader import encoding is not supported: ${requested}`);
        }
        const detected = detectEncoding(bytes);
        const encoding = requested === 'auto' ? detected.encoding : requested;
        if (!encoding) {
            const preview = decodeWithTextDecoder(bytes, 'utf-8', false);
            return {
                text: ReaderSchema.normalizeText(preview).replace(/^\uFEFF/, ''),
                encoding: '',
                detectedEncoding: '',
                confidence: 0,
                detectionReason: detected.reason,
                replacementCharacterCount: countReplacementCharacters(preview),
                requiresEncodingConfirmation: true,
                supportedEncodings: [...SUPPORTED_ENCODINGS]
            };
        }
        const bomLength = requested === 'auto' || detected.encoding === requested ? detected.bomLength : 0;
        const decoded = decodeWithTextDecoder(bytes.subarray(bomLength), encoding, false);
        const normalized = ReaderSchema.normalizeText(decoded).replace(/^\uFEFF/, '');
        const replacements = countReplacementCharacters(normalized);
        return {
            text: normalized,
            encoding,
            detectedEncoding: detected.encoding,
            confidence: requested === 'auto' ? detected.confidence : 1,
            detectionReason: requested === 'auto' ? detected.reason : 'manual-selection',
            replacementCharacterCount: replacements,
            requiresEncodingConfirmation: requested === 'auto' ? detected.confidence < 0.5 || replacements > 0 : replacements > 0,
            supportedEncodings: [...SUPPORTED_ENCODINGS]
        };
    }

    function documentTitle(fileName, fallback = '未命名文档') {
        return cleanString(fileName, fallback).replace(/\.(txt|md|markdown)$/i, '').trim() || fallback;
    }

    function isHeading(line, format) {
        const trimmed = line.trim();
        const markdown = format === 'md' ? trimmed.match(/^(#{1,3})\s+(.+)$/) : null;
        if (markdown) return { title: markdown[2].trim(), level: markdown[1].length };
        if (/^第[零〇一二三四五六七八九十百千万\d]+[章节卷部集回](?:\s|$|[：:、.-]).*/.test(trimmed)) {
            return { title: trimmed, level: 1 };
        }
        if (/^Chapter\s+\d+(?:\s|$|[：:.-]).*/i.test(trimmed)) return { title: trimmed, level: 1 };
        return null;
    }

    function linesToBlocks(lines, format, chapterIndex) {
        const blocks = [];
        let pending = [];
        let codeLines = [];
        let inCode = false;

        function pushTextBlock() {
            const text = pending.join('\n').trim();
            pending = [];
            if (!text) return;
            blocks.push({
                blockId: `chapter-${chapterIndex + 1}-block-${blocks.length + 1}`,
                type: 'paragraph',
                text,
                order: blocks.length
            });
        }

        function pushCodeBlock() {
            blocks.push({
                blockId: `chapter-${chapterIndex + 1}-block-${blocks.length + 1}`,
                type: 'code',
                text: codeLines.join('\n'),
                order: blocks.length
            });
            codeLines = [];
        }

        for (const line of lines) {
            if (format === 'md' && /^\s*```/.test(line)) {
                if (inCode) {
                    pushCodeBlock();
                    inCode = false;
                } else {
                    pushTextBlock();
                    inCode = true;
                }
                continue;
            }
            if (inCode) {
                codeLines.push(line);
                continue;
            }
            if (!line.trim()) {
                pushTextBlock();
                continue;
            }
            pending.push(line);
        }
        if (inCode) pushCodeBlock();
        else pushTextBlock();
        return blocks;
    }

    function parseReaderText(textInput, options = {}) {
        const format = cleanString(options.format, 'plain');
        if (!IMPORT_FORMATS.includes(format)) throw new Error(`reader import format is not supported: ${format}`);
        const text = ReaderSchema.normalizeText(textInput).replace(/^\uFEFF/, '');
        const lines = text.split('\n');
        const rawChapters = [];
        let current = { title: documentTitle(options.fileName, '正文'), lines: [] };
        let foundHeading = false;
        for (const line of lines) {
            const heading = isHeading(line, format);
            if (heading) {
                if (foundHeading || current.lines.some((item) => item.trim())) rawChapters.push(current);
                current = { title: heading.title || `第 ${rawChapters.length + 1} 章`, lines: [] };
                foundHeading = true;
            } else {
                current.lines.push(line);
            }
        }
        if (current.lines.some((line) => line.trim()) || foundHeading || !rawChapters.length) rawChapters.push(current);
        const chapters = rawChapters.map((chapter, index) => ({
            chapterId: `chapter-${index + 1}`,
            title: chapter.title || `第 ${index + 1} 章`,
            order: index,
            sourceChapterId: '',
            blocks: linesToBlocks(chapter.lines, format, index)
        }));
        return {
            title: documentTitle(options.fileName, '未命名文档'),
            chapters,
            characterCount: chapters.reduce((total, chapter) => total + chapter.blocks.reduce((sum, block) => sum + block.text.length, 0), 0)
        };
    }

    function createReaderImportDraft(input = {}) {
        const schemaVersion = input.schemaVersion === undefined ? IMPORT_DRAFT_SCHEMA_VERSION : Number(input.schemaVersion);
        if (schemaVersion !== IMPORT_DRAFT_SCHEMA_VERSION) throw new Error(`reader import draft schemaVersion must be ${IMPORT_DRAFT_SCHEMA_VERSION}`);
        const sourceKind = cleanString(input.sourceKind, input.bytes === undefined ? 'pasted-text' : 'local-text');
        if (!['local-text', 'pasted-text'].includes(sourceKind)) throw new Error(`reader import sourceKind is not supported: ${sourceKind}`);
        const format = cleanString(input.format, sourceKind === 'pasted-text' ? 'plain' : 'txt');
        const validFormats = sourceKind === 'local-text' ? ['txt', 'md', 'epub'] : ['plain', 'md'];
        if (!IMPORT_FORMATS.includes(format) || !validFormats.includes(format)) {
            throw new Error(`reader import format ${format} is not valid for ${sourceKind}`);
        }
        const draftId = cleanString(input.draftId || input.id);
        if (!draftId) throw new Error('reader import draftId is required');
        const createdAt = cleanString(input.createdAt);
        if (!createdAt || Number.isNaN(new Date(createdAt).getTime())) throw new Error('reader import draft createdAt is required');
        const isEpub = format === 'epub';
        if (isEpub && (!input.parsed || !Array.isArray(input.parsed.chapters))) {
            throw new Error('reader EPUB import parsed result is required');
        }
        const decoded = isEpub ? {
            text: '',
            encoding: 'epub',
            detectedEncoding: 'epub',
            confidence: 1,
            detectionReason: 'epub-container',
            replacementCharacterCount: 0,
            requiresEncodingConfirmation: false,
            supportedEncodings: []
        } : input.bytes === undefined
            ? {
                text: ReaderSchema.normalizeText(input.text),
                encoding: 'unicode-text',
                detectedEncoding: 'unicode-text',
                confidence: 1,
                detectionReason: 'pasted-text',
                replacementCharacterCount: countReplacementCharacters(input.text),
                requiresEncodingConfirmation: false,
                supportedEncodings: []
            }
            : decodeReaderBytes(input.bytes, input.encoding || 'auto');
        const parsed = isEpub ? {
            title: cleanString(input.parsed.title, documentTitle(input.originalFileName || input.fileName, '未命名 EPUB')) || '未命名 EPUB',
            chapters: input.parsed.chapters,
            characterCount: Number(input.parsed.characterCount) || 0
        } : parseReaderText(decoded.text, { format, fileName: input.originalFileName || input.fileName });
        const warnings = isEpub && Array.isArray(input.parsed.warnings) ? [...new Set(input.parsed.warnings.map((warning) => cleanString(warning)).filter(Boolean))] : [];
        if (decoded.requiresEncodingConfirmation) warnings.push('encoding-confirmation-required');
        if (!parsed.characterCount) warnings.push('empty-content');
        return {
            schemaVersion: IMPORT_DRAFT_SCHEMA_VERSION,
            kind: 'reader-import-draft',
            draftId,
            sourceKind,
            format,
            title: cleanString(input.title, parsed.title) || parsed.title,
            originalFileName: cleanString(input.originalFileName || input.fileName),
            parserVersion: cleanString(input.parserVersion, isEpub ? (input.parsed.parserVersion || 'reader-epub@1') : 'reader-import@1') || 'reader-import@1',
            createdAt: new Date(createdAt).toISOString(),
            encodingPreview: {
                encoding: decoded.encoding,
                detectedEncoding: decoded.detectedEncoding,
                confidence: decoded.confidence,
                detectionReason: decoded.detectionReason,
                replacementCharacterCount: decoded.replacementCharacterCount,
                requiresEncodingConfirmation: decoded.requiresEncodingConfirmation,
                supportedEncodings: decoded.supportedEncodings
            },
            chapters: parsed.chapters,
            characterCount: parsed.characterCount,
            warnings
        };
    }

    function applyReaderImportCorrections(draftInput = {}, corrections = {}) {
        if (!draftInput || draftInput.kind !== 'reader-import-draft') throw new Error('reader import draft is required');
        if (Number(draftInput.schemaVersion) !== IMPORT_DRAFT_SCHEMA_VERSION) {
            throw new Error(`reader import draft schemaVersion must be ${IMPORT_DRAFT_SCHEMA_VERSION}`);
        }
        if (!['local-text', 'pasted-text'].includes(draftInput.sourceKind)) {
            throw new Error(`reader import sourceKind is not supported: ${cleanString(draftInput.sourceKind)}`);
        }
        const validFormats = draftInput.sourceKind === 'local-text' ? ['txt', 'md', 'epub'] : ['plain', 'md'];
        if (!IMPORT_FORMATS.includes(draftInput.format) || !validFormats.includes(draftInput.format)) {
            throw new Error(`reader import format ${cleanString(draftInput.format)} is not valid for ${draftInput.sourceKind}`);
        }
        const chaptersInput = corrections.chapters === undefined ? draftInput.chapters : corrections.chapters;
        const chapters = (Array.isArray(chaptersInput) ? chaptersInput : []).map((chapter, index) => ReaderSchema.createReaderChapter({
            ...chapter,
            order: index
        }, { index }));
        if (!chapters.length) throw new Error('reader import correction requires at least one chapter');
        const chapterIds = new Set();
        for (const chapter of chapters) {
            if (chapterIds.has(chapter.chapterId)) throw new Error(`duplicate reader import chapter id: ${chapter.chapterId}`);
            chapterIds.add(chapter.chapterId);
        }
        const characterCount = chapters.reduce((total, chapter) => total + chapter.blocks.reduce((sum, block) => sum + block.text.length, 0), 0);
        const encodingConfirmed = corrections.encodingConfirmed === true || draftInput.encodingPreview.requiresEncodingConfirmation === false;
        const warnings = (Array.isArray(draftInput.warnings) ? draftInput.warnings : [])
            .filter((warning) => warning !== 'encoding-confirmation-required' && warning !== 'empty-content');
        if (!encodingConfirmed) warnings.push('encoding-confirmation-required');
        if (!characterCount) warnings.push('empty-content');
        return {
            ...draftInput,
            title: cleanString(corrections.title, draftInput.title) || draftInput.title,
            chapters,
            characterCount,
            encodingPreview: {
                ...draftInput.encodingPreview,
                requiresEncodingConfirmation: !encodingConfirmed
            },
            warnings
        };
    }

    function reindexImportBlocks(blocksInput, chapterIndex) {
        return (Array.isArray(blocksInput) ? blocksInput : []).map((block, blockIndex) => ({
            ...block,
            blockId: `chapter-${chapterIndex + 1}-block-${blockIndex + 1}`,
            order: blockIndex
        }));
    }

    function splitReaderImportChapter(draftInput = {}, input = {}) {
        const chapterId = cleanString(input.chapterId);
        const chapterIndex = (Array.isArray(draftInput.chapters) ? draftInput.chapters : [])
            .findIndex((chapter) => chapter.chapterId === chapterId);
        if (chapterIndex < 0) throw new Error(`reader import chapter not found: ${chapterId || '(empty)'}`);
        const chapter = draftInput.chapters[chapterIndex];
        const blockIndex = Number(input.blockIndex);
        if (!Number.isInteger(blockIndex) || blockIndex <= 0 || blockIndex >= chapter.blocks.length) {
            throw new Error('reader import split blockIndex must be inside the chapter');
        }
        const existingIds = new Set(draftInput.chapters.map((item) => item.chapterId));
        let suffix = 2;
        let nextId = `${chapter.chapterId}-split-${suffix}`;
        while (existingIds.has(nextId)) {
            suffix += 1;
            nextId = `${chapter.chapterId}-split-${suffix}`;
        }
        const chapters = [
            ...draftInput.chapters.slice(0, chapterIndex),
            {
                ...chapter,
                title: cleanString(input.beforeTitle, chapter.title) || chapter.title,
                blocks: chapter.blocks.slice(0, blockIndex)
            },
            {
                ...chapter,
                chapterId: nextId,
                title: cleanString(input.afterTitle, `第 ${chapterIndex + 2} 章`) || `第 ${chapterIndex + 2} 章`,
                blocks: chapter.blocks.slice(blockIndex)
            },
            ...draftInput.chapters.slice(chapterIndex + 1)
        ].map((item, index) => ({
            ...item,
            order: index,
            blocks: reindexImportBlocks(item.blocks, index)
        }));
        return applyReaderImportCorrections(draftInput, { chapters });
    }

    function mergeReaderImportChapters(draftInput = {}, input = {}) {
        const requested = Array.isArray(input.chapterIds) ? input.chapterIds.map((value) => cleanString(value)).filter(Boolean) : [];
        if (requested.length < 2) throw new Error('reader import merge requires at least two chapters');
        const indexes = requested.map((chapterId) => draftInput.chapters.findIndex((chapter) => chapter.chapterId === chapterId));
        if (indexes.some((index) => index < 0)) throw new Error('reader import merge chapter was not found');
        const sorted = [...indexes].sort((left, right) => left - right);
        if (new Set(sorted).size !== sorted.length || sorted.some((value, index) => index > 0 && value !== sorted[index - 1] + 1)) {
            throw new Error('reader import merge chapters must be unique and adjacent');
        }
        const start = sorted[0];
        const selected = sorted.map((index) => draftInput.chapters[index]);
        const merged = {
            ...selected[0],
            title: cleanString(input.title, selected[0].title) || selected[0].title,
            blocks: selected.flatMap((chapter) => chapter.blocks)
        };
        const selectedIndexes = new Set(sorted);
        const chapters = draftInput.chapters
            .flatMap((chapter, index) => index === start ? [merged] : selectedIndexes.has(index) ? [] : [chapter])
            .map((chapter, index) => ({
                ...chapter,
                order: index,
                blocks: reindexImportBlocks(chapter.blocks, index)
            }));
        return applyReaderImportCorrections(draftInput, { chapters });
    }

    function confirmReaderImportDraft(draftInput = {}, input = {}, options = {}) {
        if (!draftInput || draftInput.kind !== 'reader-import-draft') throw new Error('reader import draft is required');
        const draft = applyReaderImportCorrections(draftInput, {
            chapters: draftInput.chapters,
            title: draftInput.title,
            encodingConfirmed: input.encodingConfirmed
        });
        if (draft.encodingPreview.requiresEncodingConfirmation) throw new Error('reader import encoding must be confirmed');
        if (!draft.characterCount) throw new Error('reader import content must not be empty');
        const timestamp = cleanString(input.createdAt || input.importedAt);
        const revision = ReaderSchema.createReaderDocumentRevision({
            schemaVersion: 1,
            revisionId: input.revisionId,
            parentRevisionId: input.parentRevisionId,
            contentDigest: input.contentDigest,
            structureDigest: input.structureDigest,
            createdAt: timestamp,
            encoding: draft.encodingPreview.encoding,
            lineEnding: 'lf',
            parserVersion: draft.parserVersion,
            chapters: draft.chapters
        }, options);
        const format = draft.format;
        const document = ReaderSchema.createReaderDocument({
            schemaVersion: 2,
            documentId: input.documentId,
            sourceKind: draft.sourceKind,
            format,
            title: cleanString(input.title, draft.title) || draft.title,
            originalFileName: draft.originalFileName,
            importedAt: timestamp,
            updatedAt: timestamp,
            activeRevisionId: revision.revisionId,
            revisions: [revision]
        }, options);
        return { document, revision, draftId: draft.draftId };
    }

    return {
        IMPORT_DRAFT_SCHEMA_VERSION,
        SUPPORTED_ENCODINGS,
        IMPORT_FORMATS,
        normalizeEncoding,
        detectEncoding,
        decodeReaderBytes,
        parseReaderText,
        createReaderImportDraft,
        applyReaderImportCorrections,
        splitReaderImportChapter,
        mergeReaderImportChapters,
        confirmReaderImportDraft
    };
});
