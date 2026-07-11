(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./scene-ordering'));
    } else {
        root.DraftHarborManuscriptBuilder = factory(root.DraftHarborSceneOrdering);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SceneOrdering) {
    function buildManuscript(project, options = {}) {
        const includeSceneTitles = options.includeSceneTitles !== false;
        const chapters = SceneOrdering.sortChapters(project && project.chapters);
        const scenes = Array.isArray(project && project.scenes) ? project.scenes : [];

        const parts = [];
        for (const chapter of chapters) {
            parts.push(`# ${chapter.title || 'Untitled Chapter'}`);
            const chapterScenes = SceneOrdering.sortScenesForChapter(scenes, chapter.id);
            for (const scene of chapterScenes) {
                if (includeSceneTitles && scene.title) {
                    parts.push(`\n## ${scene.title}`);
                }
                if (scene.content) {
                    parts.push(`\n${String(scene.content).trim()}`);
                }
            }
        }

        return parts.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim();
    }

    return {
        buildManuscript
    };
});
