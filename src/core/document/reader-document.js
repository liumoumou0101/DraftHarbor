(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./manuscript-builder'),
            require('./scene-ordering')
        );
    } else {
        root.DraftHarborReaderDocument = factory(root.DraftHarborManuscriptBuilder, root.DraftHarborSceneOrdering);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ManuscriptBuilder, SceneOrdering) {
    function paragraphsFromScenes(scenes) {
        const paragraphs = [];
        for (const scene of scenes) {
            if (scene.title) paragraphs.push({ type: 'scene-title', text: scene.title });
            const blocks = String(scene.content || '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
            for (const block of blocks) {
                paragraphs.push({ type: 'paragraph', text: block });
            }
        }
        return paragraphs;
    }

    function projectToReaderDocument(project) {
        const chapters = SceneOrdering.sortChapters(project && project.chapters);
        const scenes = Array.isArray(project && project.scenes) ? project.scenes : [];
        const readerChapters = chapters.map((chapter) => {
            const chapterScenes = SceneOrdering.sortScenesForChapter(scenes, chapter.id);
            return {
                id: chapter.id,
                title: chapter.title || 'Untitled Chapter',
                paragraphs: paragraphsFromScenes(chapterScenes)
            };
        });

        return {
            id: project && project.id,
            title: project && project.title ? project.title : 'Untitled Project',
            source: 'project',
            chapters: readerChapters,
            text: ManuscriptBuilder.buildManuscript(project)
        };
    }

    return {
        projectToReaderDocument
    };
});
