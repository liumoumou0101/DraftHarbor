(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowLongformSchema = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function clean(value, fallback = '') { return String(value || fallback || '').trim(); }
    function clone(value) { return JSON.parse(JSON.stringify(value === undefined ? null : value)); }

    function createChunkPlan(scenePlan = {}, options = {}) {
        const scenes = Array.isArray(scenePlan.scenes) ? scenePlan.scenes : [];
        if (!scenes.length) throw new Error('long-form chunk plan requires scene plan entries');
        return {
            schemaVersion: 1,
            kind: 'longform-chunk-plan',
            scenePlanRevisionId: clean(options.scenePlanRevisionId),
            constraintSnapshotId: clean(options.constraintSnapshotId),
            chunks: scenes.map((scene, index) => ({
                id: clean(scene.chunkId, `chunk-${scene.id || index + 1}`),
                sequence: index,
                sceneId: clean(scene.id, `planned-scene-${index + 1}`),
                title: clean(scene.title, `场景 ${index + 1}`),
                plan: clone(scene)
            }))
        };
    }

    function createRollingState(input = {}) {
        return {
            schemaVersion: 1,
            completedSceneIds: Array.from(new Set((Array.isArray(input.completedSceneIds) ? input.completedSceneIds : []).map(clean).filter(Boolean))),
            lastSceneId: clean(input.lastSceneId),
            lastSceneSummary: clean(input.lastSceneSummary),
            characterStates: input.characterStates && typeof input.characterStates === 'object' ? clone(input.characterStates) : {},
            locations: input.locations && typeof input.locations === 'object' ? clone(input.locations) : {},
            items: input.items && typeof input.items === 'object' ? clone(input.items) : {},
            knowledge: input.knowledge && typeof input.knowledge === 'object' ? clone(input.knowledge) : {}
        };
    }

    function advanceRollingState(input, scene, text, patch = {}) {
        const state = createRollingState(input);
        const sceneId = clean(scene && (scene.sceneId || scene.id));
        const compact = clean(text).replace(/\s+/g, ' ');
        return createRollingState({
            ...state,
            ...patch,
            completedSceneIds: [...state.completedSceneIds, sceneId],
            lastSceneId: sceneId,
            lastSceneSummary: clean(patch.lastSceneSummary, compact.slice(-240))
        });
    }

    return { createChunkPlan, createRollingState, advanceRollingState };
});
