(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DraftHarborSummarySource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULT_MAX_CHARS = 18000;
    const MAX_CHARS_PER_SCENE = 2400;
    const MIN_CHARS_PER_SCENE = 320;

    function cleanText(value) {
        return String(value || '').trim();
    }

    function truncate(text, maxChars) {
        const source = cleanText(text);
        if (source.length <= maxChars) return { text: source, truncated: false };
        const marker = '\n[内容已截断]';
        return {
            text: `${source.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`,
            truncated: true
        };
    }

    function buildChapterSummarySource(input = {}) {
        const scenes = Array.isArray(input.scenes) ? input.scenes : [];
        const getContent = typeof input.getContent === 'function' ? input.getContent : () => '';
        const maxChars = Math.max(1000, Number(input.maxChars) || DEFAULT_MAX_CHARS);
        const usableChars = Math.max(0, maxChars - 240);
        const fairSceneBudget = scenes.length ? Math.floor(usableChars / scenes.length) : usableChars;
        const perSceneBudget = Math.max(MIN_CHARS_PER_SCENE, Math.min(MAX_CHARS_PER_SCENE, fairSceneBudget));
        const blocks = [];
        let usedChars = 0;
        let truncatedSceneCount = 0;
        let omittedSceneCount = 0;

        for (let index = 0; index < scenes.length; index += 1) {
            const scene = scenes[index] || {};
            const summary = !scene.summaryStale ? cleanText(scene.summary) : '';
            const source = summary || cleanText(getContent(scene.id));
            if (!source) continue;
            const title = cleanText(scene.title) || `未命名场景 ${index + 1}`;
            const header = `${title}\n`;
            const remaining = maxChars - usedChars;
            const separatorChars = blocks.length ? 2 : 0;
            const availableForBlock = remaining - separatorChars;
            if (availableForBlock <= header.length + 48) {
                omittedSceneCount += scenes.length - index;
                break;
            }
            const limited = truncate(source, Math.min(perSceneBudget, availableForBlock - header.length));
            if (limited.truncated) truncatedSceneCount += 1;
            const block = `${header}${limited.text}`;
            blocks.push(block);
            usedChars += block.length + separatorChars;
        }

        return {
            text: blocks.join('\n\n'),
            maxChars,
            usedChars,
            truncatedSceneCount,
            omittedSceneCount,
            compressed: truncatedSceneCount > 0 || omittedSceneCount > 0
        };
    }

    return Object.freeze({ DEFAULT_MAX_CHARS, buildChapterSummarySource });
});
