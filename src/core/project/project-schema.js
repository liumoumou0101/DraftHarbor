(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborProjectSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CURRENT_SCHEMA_VERSION = 1;

    function timestamp(value) {
        if (value) {
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
        return new Date().toISOString();
    }

    function makeId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function createChapter(input = {}) {
        const now = timestamp(input.createdAt || input.created);
        return {
            id: input.id || makeId('chapter'),
            title: String(input.title || 'Chapter 1').trim() || 'Chapter 1',
            summary: String(input.summary || ''),
            order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
            sceneIds: Array.isArray(input.sceneIds) ? [...input.sceneIds] : [],
            createdAt: timestamp(input.createdAt || now),
            updatedAt: timestamp(input.updatedAt || input.modified || now)
        };
    }

    function createScene(input = {}) {
        const now = timestamp(input.createdAt || input.created);
        return {
            id: input.id || makeId('scene'),
            chapterId: String(input.chapterId || ''),
            title: String(input.title || 'Scene 1').trim() || 'Scene 1',
            summary: String(input.summary || ''),
            content: String(input.content || ''),
            order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
            tags: Array.isArray(input.tags) ? [...input.tags] : [],
            povCharacter: String(input.povCharacter || input.pov || ''),
            tense: String(input.tense || ''),
            sourceRunId: String(input.sourceRunId || ''),
            sourceArtifactId: String(input.sourceArtifactId || ''),
            sourceRevisionId: String(input.sourceRevisionId || ''),
            sourceReferences: Array.isArray(input.sourceReferences) ? input.sourceReferences.map((item) => ({ ...item })) : [],
            createdAt: timestamp(input.createdAt || now),
            updatedAt: timestamp(input.updatedAt || input.modified || now)
        };
    }

    function createProject(input = {}) {
        const now = timestamp(input.createdAt || input.created);
        const chapter = createChapter({
            id: input.chapterId || 'chapter-1',
            title: input.chapterTitle || 'Chapter 1',
            order: 0,
            createdAt: now,
            updatedAt: now
        });
        const scene = createScene({
            id: input.sceneId || 'scene-1',
            chapterId: chapter.id,
            title: input.sceneTitle || 'Scene 1',
            order: 0,
            createdAt: now,
            updatedAt: now
        });
        chapter.sceneIds = [scene.id];

        return {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            id: input.id || makeId('project'),
            title: String(input.title || input.name || 'Untitled Project').trim() || 'Untitled Project',
            description: String(input.description || ''),
            status: String(input.status || 'draft'),
            tags: Array.isArray(input.tags) ? [...input.tags] : [],
            coverImage: String(input.coverImage || ''),
            createdAt: timestamp(input.createdAt || now),
            updatedAt: timestamp(input.updatedAt || input.modified || now),
            chapterOrder: [chapter.id],
            sceneOrder: [scene.id],
            currentSceneId: scene.id,
            chapters: [chapter],
            scenes: [scene],
            compendium: [],
            prompts: [],
            promptHistory: [],
            workshopSessions: [],
            workflowRuns: []
            ,readerApplications: []
            ,styleGuardRules: []
        };
    }

    return {
        CURRENT_SCHEMA_VERSION,
        createProject,
        createChapter,
        createScene
    };
});
