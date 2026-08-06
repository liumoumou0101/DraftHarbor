(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderTransition = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const TRANSITION_SCHEMA_VERSION = 1;
    const TRANSITION_IDS = Object.freeze(['fade', 'slide', 'cover', 'none', 'curl']);
    const FORMAL_TRANSITION_IDS = Object.freeze(['fade', 'slide', 'cover', 'curl', 'none']);

    function normalizeTransition(value) {
        const transition = String(value || 'none').trim();
        return TRANSITION_IDS.includes(transition) ? transition : 'none';
    }

    function createReaderTransitionAdapter(input = {}) {
        const requested = normalizeTransition(input.transition);
        const reducedMotion = input.reducedMotion === true;
        const experimental = false;
        const transition = reducedMotion ? 'none' : requested;
        const durationMs = transition === 'curl' ? 620 : transition === 'cover' ? 240 : transition === 'slide' ? 220 : transition === 'fade' ? 180 : 0;
        return Object.freeze({
            schemaVersion: TRANSITION_SCHEMA_VERSION,
            requested,
            transition,
            durationMs,
            experimental,
            reducedMotion,
            direction: input.direction < 0 ? 'previous' : 'next',
            cssToken: transition
        });
    }

    return { TRANSITION_SCHEMA_VERSION, TRANSITION_IDS, FORMAL_TRANSITION_IDS, normalizeTransition, createReaderTransitionAdapter };
});
