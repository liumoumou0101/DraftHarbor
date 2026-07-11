(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborProjectStats = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function countWords(text) {
        const value = String(text || '').trim();
        if (!value) return 0;
        const cjk = value.match(/[\u3400-\u9fff]/g) || [];
        const latin = value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
        return cjk.length + latin.length;
    }

    function projectStats(project) {
        const chapters = Array.isArray(project && project.chapters) ? project.chapters : [];
        const scenes = Array.isArray(project && project.scenes) ? project.scenes : [];
        const wordCount = scenes.reduce((total, scene) => total + countWords(scene.content), 0);
        return {
            chapterCount: chapters.length,
            sceneCount: scenes.length,
            wordCount
        };
    }

    return {
        countWords,
        projectStats
    };
});
