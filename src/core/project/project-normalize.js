(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('../document/scene-ordering'),
            require('./project-schema'),
            require('../knowledge/compendium-schema'),
            require('../prompt/prompt-template-schema')
        );
    } else {
        root.DraftHarborProjectNormalize = factory(root.DraftHarborSceneOrdering, root.DraftHarborProjectSchema, root.DraftHarborCompendiumSchema, root.DraftHarborPromptTemplateSchema);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SceneOrdering, ProjectSchema, CompendiumSchema, PromptTemplateSchema) {
    const CURRENT_SCHEMA_VERSION = ProjectSchema ? ProjectSchema.CURRENT_SCHEMA_VERSION : 1;

    function nowIso() {
        return new Date().toISOString();
    }

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function cleanArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const result = [];
        for (const value of cleanArray(values)) {
            const text = cleanString(value);
            if (!text || seen.has(text)) continue;
            seen.add(text);
            result.push(text);
        }
        return result;
    }

    function normalizeTimestamp(value, fallback) {
        if (!value) return fallback;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return fallback;
        return date.toISOString();
    }

    function localizedSystemTitle(value, kind, index) {
        const fallback = kind === 'chapter' ? `第 ${index + 1} 章` : `场景 ${index + 1}`;
        const title = cleanString(value, fallback) || fallback;
        const legacyPattern = kind === 'chapter' ? /^chapter\s+(\d+)$/i : /^scene\s+(\d+)$/i;
        const match = title.match(legacyPattern);
        if (!match) return title;
        return kind === 'chapter' ? `第 ${match[1]} 章` : `场景 ${match[1]}`;
    }

    function normalizeChapter(raw, index, timestamp) {
        const id = cleanString(raw && raw.id, `chapter-${index + 1}`);
        return {
            id,
            title: localizedSystemTitle(raw && raw.title, 'chapter', index),
            summary: cleanString(raw && raw.summary),
            summaryUpdated: cleanString(raw && raw.summaryUpdated),
            summarySource: cleanString(raw && raw.summarySource),
            summaryStale: !!(raw && raw.summaryStale),
            order: Number.isFinite(Number(raw && raw.order)) ? Number(raw.order) : index,
            sceneIds: uniqueStrings(raw && raw.sceneIds),
            createdAt: normalizeTimestamp(raw && (raw.createdAt || raw.created), timestamp),
            updatedAt: normalizeTimestamp(raw && (raw.updatedAt || raw.modified), timestamp)
        };
    }

    function normalizeScene(raw, index, fallbackChapterId, timestamp) {
        const id = cleanString(raw && raw.id, `scene-${index + 1}`);
        return {
            id,
            chapterId: cleanString(raw && raw.chapterId, fallbackChapterId),
            title: localizedSystemTitle(raw && raw.title, 'scene', index),
            summary: cleanString(raw && raw.summary),
            summaryUpdated: cleanString(raw && raw.summaryUpdated),
            summarySource: cleanString(raw && raw.summarySource),
            summaryStale: !!(raw && raw.summaryStale),
            content: raw && raw.content !== undefined ? String(raw.content || '') : '',
            order: Number.isFinite(Number(raw && raw.order)) ? Number(raw.order) : index,
            tags: uniqueStrings(raw && raw.tags),
            povCharacter: cleanString(raw && (raw.povCharacter || raw.pov)),
            tense: cleanString(raw && raw.tense),
            createdAt: normalizeTimestamp(raw && (raw.createdAt || raw.created), timestamp),
            updatedAt: normalizeTimestamp(raw && (raw.updatedAt || raw.modified), timestamp)
        };
    }

    function normalizeProject(input) {
        const raw = input && typeof input === 'object' ? input : {};
        const timestamp = normalizeTimestamp(raw.updatedAt || raw.modified || raw.exportedAt, nowIso());
        const projectId = cleanString(raw.id || (raw.project && raw.project.id), `project-${Date.now()}`);
        const sourceProject = raw.project && typeof raw.project === 'object' ? raw.project : raw;
        const rawChapters = cleanArray(raw.chapters);
        const rawScenes = cleanArray(raw.scenes);
        const sceneContents = raw.sceneContents && typeof raw.sceneContents === 'object' ? raw.sceneContents : {};

        if (rawChapters.length === 0 && rawScenes.length === 0 && ProjectSchema && typeof ProjectSchema.createProject === 'function') {
            return ProjectSchema.createProject({
                id: projectId,
                title: cleanString(sourceProject.title || sourceProject.name, 'Untitled Project') || 'Untitled Project',
                description: cleanString(sourceProject.description),
                status: cleanString(sourceProject.status, 'draft') || 'draft',
                tags: uniqueStrings(sourceProject.tags),
                createdAt: normalizeTimestamp(sourceProject.createdAt || sourceProject.created, timestamp),
                updatedAt: normalizeTimestamp(sourceProject.updatedAt || sourceProject.modified, timestamp)
            });
        }

        let chapters = rawChapters.map((chapter, index) => normalizeChapter(chapter, index, timestamp));
        if (chapters.length === 0) {
            chapters = [normalizeChapter({ id: 'chapter-1', title: '第 1 章', order: 0 }, 0, timestamp)];
        }

        chapters = SceneOrdering.sortChapters(chapters);

        const chapterIds = new Set(chapters.map((chapter) => chapter.id));
        const fallbackChapterId = chapters[0].id;
        let scenes = rawScenes.map((scene, index) => {
            const normalized = normalizeScene(scene, index, fallbackChapterId, timestamp);
            if (!chapterIds.has(normalized.chapterId)) normalized.chapterId = fallbackChapterId;
            if (sceneContents[normalized.id] !== undefined && !normalized.content) {
                normalized.content = String(sceneContents[normalized.id] || '');
            }
            return normalized;
        });

        const project = {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            id: projectId,
            title: cleanString(sourceProject.title || sourceProject.name, 'Untitled Project') || 'Untitled Project',
            description: cleanString(sourceProject.description),
            status: cleanString(sourceProject.status, 'draft') || 'draft',
            tags: uniqueStrings(sourceProject.tags),
            coverImage: cleanString(sourceProject.coverImage),
            createdAt: normalizeTimestamp(sourceProject.createdAt || sourceProject.created, timestamp),
            updatedAt: normalizeTimestamp(sourceProject.updatedAt || sourceProject.modified, timestamp),
            chapterOrder: chapters.map((chapter) => chapter.id),
            sceneOrder: scenes.map((scene) => scene.id),
            currentSceneId: cleanString(raw.currentSceneId || sourceProject.currentSceneId || (scenes[0] && scenes[0].id)),
            chapters,
            scenes,
            compendium: CompendiumSchema && typeof CompendiumSchema.normalizeCompendiumEntries === 'function'
                ? CompendiumSchema.normalizeCompendiumEntries(raw.compendium, projectId)
                : cleanArray(raw.compendium),
            prompts: PromptTemplateSchema && typeof PromptTemplateSchema.normalizePromptTemplates === 'function'
                ? PromptTemplateSchema.normalizePromptTemplates(raw.prompts, projectId)
                : cleanArray(raw.prompts),
            promptHistory: cleanArray(raw.promptHistory),
            workshopSessions: cleanArray(raw.workshopSessions),
            workflowRuns: cleanArray(raw.workflowRuns)
            ,styleGuardRules: typeof window !== 'undefined' && window.DraftHarborAvoidanceRules
                ? window.DraftHarborAvoidanceRules.normalizeRules(raw.styleGuardRules)
                : cleanArray(raw.styleGuardRules)
        };

        return SceneOrdering.reindexProjectOrder(project);
    }

    return {
        CURRENT_SCHEMA_VERSION,
        normalizeProject,
        normalizeChapter,
        normalizeScene
    };
});
