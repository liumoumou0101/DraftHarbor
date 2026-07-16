(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./manuscript-builder'),
            require('./scene-ordering'),
            require('./reader-document-schema')
        );
    } else {
        root.DraftHarborReaderDocument = factory(
            root.DraftHarborManuscriptBuilder,
            root.DraftHarborSceneOrdering,
            root.DraftHarborReaderDocumentSchema
        );
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ManuscriptBuilder, SceneOrdering, ReaderSchema) {
    const SYNTHETIC_CHAPTER_TITLE = '未分章';
    const EPOCH_TIMESTAMP = '1970-01-01T00:00:00.000Z';

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function stableHash(value) {
        const text = String(value || '');
        let first = 2166136261;
        let second = 5381;
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            first ^= code;
            first = Math.imul(first, 16777619);
            second = Math.imul(second, 33) ^ code;
        }
        return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
    }

    function idSegment(value) {
        return encodeURIComponent(cleanString(value, 'unknown'));
    }

    function trimSourceRange(source, initialStart, initialEnd) {
        let start = initialStart;
        let end = initialEnd;
        while (start < end && /\s/u.test(source[start])) start += 1;
        while (end > start && /\s/u.test(source[end - 1])) end -= 1;
        return { start, end };
    }

    function paragraphRanges(contentInput) {
        const content = String(contentInput || '');
        const ranges = [];
        const separator = /\r?\n[\t ]*\r?\n/g;
        let segmentStart = 0;
        let match;
        while ((match = separator.exec(content))) {
            ranges.push(trimSourceRange(content, segmentStart, match.index));
            segmentStart = separator.lastIndex;
        }
        ranges.push(trimSourceRange(content, segmentStart, content.length));
        return ranges.filter((range) => range.end > range.start);
    }

    function blocksFromScene(sceneInput = {}) {
        const sceneId = cleanString(sceneInput.id);
        const sceneKey = idSegment(sceneId);
        const blocks = [];
        const title = cleanString(sceneInput.title);
        if (title) {
            blocks.push({
                blockId: `scene:${sceneKey}:title`,
                type: 'scene-title',
                text: title,
                sourceSceneId: sceneId
            });
        }
        const content = String(sceneInput.content || '');
        const occurrences = new Map();
        for (const range of paragraphRanges(content)) {
            const text = content.slice(range.start, range.end).replace(/\r\n?/g, '\n');
            const textKey = stableHash(text);
            const occurrence = (occurrences.get(textKey) || 0) + 1;
            occurrences.set(textKey, occurrence);
            blocks.push({
                blockId: `scene:${sceneKey}:paragraph:${textKey}:${occurrence}`,
                type: 'paragraph',
                text,
                sourceSceneId: sceneId,
                sourceStart: range.start,
                sourceEnd: range.end
            });
        }
        return blocks.map((block, order) => ({ ...block, order }));
    }

    function syntheticChapterId(projectId) {
        return `project:${idSegment(projectId)}:synthetic:scenes`;
    }

    function projectReaderChapters(projectInput = {}, options = {}) {
        const chapters = SceneOrdering.sortChapters(projectInput.chapters);
        const scenes = Array.isArray(projectInput.scenes) ? projectInput.scenes : [];
        const assignedSceneIds = new Set();
        const projected = chapters.map((chapter, order) => {
            const chapterScenes = SceneOrdering.sortScenesForChapter(scenes, chapter.id);
            chapterScenes.forEach((scene) => assignedSceneIds.add(scene.id));
            return {
                chapterId: cleanString(chapter.id),
                title: cleanString(chapter.title, 'Untitled Chapter') || 'Untitled Chapter',
                order,
                sourceChapterId: cleanString(chapter.id),
                blocks: chapterScenes.flatMap(blocksFromScene).map((block, blockOrder) => ({ ...block, order: blockOrder }))
            };
        });
        const orphanScenes = [...scenes]
            .filter((scene) => !assignedSceneIds.has(scene.id))
            .sort(SceneOrdering.byOrderThenTitle);
        if (orphanScenes.length || (!projected.length && options.ensureChapter)) {
            projected.push({
                chapterId: syntheticChapterId(projectInput.id),
                title: SYNTHETIC_CHAPTER_TITLE,
                order: projected.length,
                sourceChapterId: '',
                blocks: orphanScenes.flatMap(blocksFromScene).map((block, blockOrder) => ({ ...block, order: blockOrder }))
            });
        }
        return projected;
    }

    function projectToReaderDocument(project) {
        const chapters = projectReaderChapters(project).map((chapter) => ({
            id: chapter.chapterId,
            title: chapter.title,
            paragraphs: chapter.blocks.map((block) => ({
                ...block,
                id: block.blockId
            })),
            blocks: chapter.blocks
        }));
        return {
            id: project && project.id,
            title: project && project.title ? project.title : 'Untitled Project',
            source: 'project',
            chapters,
            text: ManuscriptBuilder.buildManuscript(project)
        };
    }

    function projectTimestamp(projectInput, options) {
        return options.createdAt || projectInput.updatedAt || projectInput.modifiedAt || projectInput.createdAt || EPOCH_TIMESTAMP;
    }

    function digestRevisionIdentity(chapters, digest) {
        const content = ReaderSchema.canonicalReaderRevisionContent({ chapters });
        const structure = ReaderSchema.canonicalReaderRevisionStructure({ chapters });
        const result = cleanString(digest(JSON.stringify({ content, structure })));
        if (!result) throw new Error('project reader digest function returned an empty value');
        return result.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || stableHash(result);
    }

    function detectLineEnding(projectInput) {
        const contents = (Array.isArray(projectInput.scenes) ? projectInput.scenes : [])
            .map((scene) => String(scene.content || ''))
            .join('');
        const hasCrLf = /\r\n/.test(contents);
        const withoutCrLf = contents.replace(/\r\n/g, '');
        const hasLf = /\n/.test(withoutCrLf);
        const hasCr = /\r/.test(withoutCrLf);
        if ([hasCrLf, hasLf, hasCr].filter(Boolean).length > 1) return 'mixed';
        if (hasCrLf) return 'crlf';
        if (hasCr) return 'cr';
        return 'lf';
    }

    function projectToReaderDocumentV2(projectInput = {}, options = {}) {
        if (!ReaderSchema) throw new Error('Reader Document schema is required for project v2 projection');
        if (typeof options.digest !== 'function') throw new Error('project reader projection requires a digest function');
        const projectId = cleanString(projectInput.id);
        if (!projectId) throw new Error('project reader projection requires project.id');
        const chapters = projectReaderChapters(projectInput, { ensureChapter: true });
        const timestamp = projectTimestamp(projectInput, options);
        const revisionId = cleanString(options.revisionId)
            || `project-revision:${digestRevisionIdentity(chapters, options.digest)}`;
        const revision = ReaderSchema.createReaderDocumentRevision({
            revisionId,
            createdAt: timestamp,
            lineEnding: detectLineEnding(projectInput),
            parserVersion: 'reader-project-projection@1',
            chapters
        }, { digest: options.digest });
        return ReaderSchema.createReaderDocument({
            documentId: `project:${projectId}`,
            sourceKind: 'project',
            format: 'project',
            title: cleanString(projectInput.title, 'Untitled Project') || 'Untitled Project',
            projectId,
            importedAt: timestamp,
            updatedAt: timestamp,
            activeRevisionId: revision.revisionId,
            revisions: [revision]
        }, { digest: options.digest });
    }

    return {
        paragraphRanges,
        blocksFromScene,
        projectReaderChapters,
        projectToReaderDocument,
        projectToReaderDocumentV2
    };
});
