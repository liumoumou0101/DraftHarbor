(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowInputSchema = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SCOPES = Object.freeze(['selection', 'scene', 'chapter', 'project']);
    const INTENTS = Object.freeze(['continue', 'alternative', 'rewrite', 'extract-outline', 'extract-characters', 'style-reference']);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }
    function clonePlain(value) {
        if (Array.isArray(value)) return value.map(clonePlain);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
        return result;
    }
    function normalizeWriterSourceRequest(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const scope = cleanString(source.scope, 'scene');
        const intent = cleanString(source.intent, 'continue');
        const selection = source.selection && typeof source.selection === 'object' ? source.selection : {};
        return {
            scope: SCOPES.includes(scope) ? scope : 'scene',
            intent: INTENTS.includes(intent) ? intent : 'continue',
            sceneId: cleanString(source.sceneId || selection.sceneId),
            chapterId: cleanString(source.chapterId || selection.chapterId),
            selection: {
                start: Number.isInteger(Number(selection.start)) ? Number(selection.start) : 0,
                end: Number.isInteger(Number(selection.end)) ? Number(selection.end) : 0
            },
            label: cleanString(source.label),
            metadata: source.metadata && typeof source.metadata === 'object' ? clonePlain(source.metadata) : {}
        };
    }
    return { SCOPES, INTENTS, normalizeWriterSourceRequest };
});
