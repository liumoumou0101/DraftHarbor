(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborSceneOrdering = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function byOrderThenTitle(a, b) {
        return (a.order || 0) - (b.order || 0) || String(a.title || '').localeCompare(String(b.title || ''));
    }

    function sortChapters(chapters) {
        return (Array.isArray(chapters) ? [...chapters] : [])
            .sort(byOrderThenTitle)
            .map((chapter, index) => ({ ...chapter, order: index }));
    }

    function sortScenesForChapter(scenes, chapterId) {
        return (Array.isArray(scenes) ? scenes : [])
            .filter((scene) => scene.chapterId === chapterId)
            .sort(byOrderThenTitle)
            .map((scene, index) => ({ ...scene, order: index }));
    }

    function orderScenesByChapter(chapters, scenes) {
        const orderedChapters = sortChapters(chapters);
        const result = [];
        for (const chapter of orderedChapters) {
            result.push(...sortScenesForChapter(scenes, chapter.id));
        }
        return result;
    }

    function attachSceneIdsToChapters(chapters, scenes) {
        const orderedChapters = sortChapters(chapters);
        return orderedChapters.map((chapter) => ({
            ...chapter,
            sceneIds: sortScenesForChapter(scenes, chapter.id).map((scene) => scene.id)
        }));
    }

    function reindexProjectOrder(project) {
        const chapters = attachSceneIdsToChapters(project.chapters, project.scenes);
        const scenes = orderScenesByChapter(chapters, project.scenes);
        return {
            ...project,
            chapters,
            scenes,
            chapterOrder: chapters.map((chapter) => chapter.id),
            sceneOrder: scenes.map((scene) => scene.id),
            currentSceneId: project.currentSceneId || (scenes[0] && scenes[0].id) || ''
        };
    }

    return {
        byOrderThenTitle,
        sortChapters,
        sortScenesForChapter,
        orderScenesByChapter,
        attachSceneIdsToChapters,
        reindexProjectOrder
    };
});
