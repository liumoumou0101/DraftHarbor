(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborProjectStats = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    /**
     * Product body stats (library authority): CJK characters + Latin word tokens.
     * Used for targets, progress, and bookshelf word counts.
     */
    function countWords(text) {
        const value = String(text || '').trim();
        if (!value) return 0;
        const cjk = value.match(/[\u3400-\u9fff]/g) || [];
        const latin = value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
        return cjk.length + latin.length;
    }

    /** Alias: product “正文统计字数”. */
    function countBodyStats(text) {
        return countWords(text);
    }

    /** Raw character count (code units after trim) — diagnostic only. */
    function countRawCharacters(text) {
        return String(text === undefined || text === null ? '' : text).trim().length;
    }

    function textLengthMetrics(text) {
        return {
            bodyStatsChars: countBodyStats(text),
            rawCharacters: countRawCharacters(text)
        };
    }

    function projectStats(project) {
        const chapters = Array.isArray(project && project.chapters) ? project.chapters : [];
        const scenes = Array.isArray(project && project.scenes) ? project.scenes : [];
        const wordCount = scenes.reduce((total, scene) => total + countWords(scene.content), 0);
        const rawCharacters = scenes.reduce((total, scene) => total + countRawCharacters(scene.content), 0);
        return {
            chapterCount: chapters.length,
            sceneCount: scenes.length,
            wordCount,
            bodyStatsChars: wordCount,
            rawCharacters
        };
    }

    return {
        countWords,
        countBodyStats,
        countRawCharacters,
        textLengthMetrics,
        projectStats
    };
});
