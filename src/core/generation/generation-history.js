(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborGenerationHistory = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function createGenerationRecord(input = {}) {
        const now = new Date().toISOString();
        return {
            id: input.id || `generation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            projectId: input.projectId || '',
            sceneId: input.sceneId || '',
            task: input.task || 'generation',
            beat: input.beat || '',
            provider: input.provider || '',
            model: input.model || '',
            messages: Array.isArray(input.messages) ? input.messages : [],
            promptText: input.promptText || '',
            resultText: input.resultText || '',
            reasoning: input.reasoning || '',
            error: input.error || null,
            createdAt: input.createdAt || now
        };
    }

    return {
        createGenerationRecord
    };
});
