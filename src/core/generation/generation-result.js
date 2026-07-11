(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborGenerationResult = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function normalizeGenerationError(error, context = {}) {
        const message = error && error.message ? error.message : String(error || 'Unknown generation error');
        const lower = message.toLowerCase();
        let code = context.code || 'generation_error';
        if (error && error.name === 'AbortError') code = 'aborted';
        else if (lower.includes('auth') || lower.includes('401') || lower.includes('403')) code = 'auth_error';
        else if (lower.includes('quota') || lower.includes('balance') || lower.includes('402')) code = 'quota_error';
        else if (lower.includes('rate') || lower.includes('429')) code = 'rate_limited';
        else if (lower.includes('model')) code = 'model_error';
        else if (lower.includes('network') || lower.includes('fetch')) code = 'network_error';

        return {
            ok: false,
            code,
            provider: context.provider || '',
            model: context.model || '',
            message,
            raw: error || null
        };
    }

    function createGenerationResult(input = {}) {
        const startedAt = input.startedAt || new Date().toISOString();
        const finishedAt = input.finishedAt || new Date().toISOString();
        return {
            ok: input.ok !== false,
            task: input.task || 'generation',
            provider: input.provider || '',
            model: input.model || '',
            text: String(input.text || ''),
            reasoning: String(input.reasoning || ''),
            messages: Array.isArray(input.messages) ? input.messages : [],
            usage: input.usage || null,
            startedAt,
            finishedAt,
            error: input.error || null
        };
    }

    return {
        normalizeGenerationError,
        createGenerationResult
    };
});
