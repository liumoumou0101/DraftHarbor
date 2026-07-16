(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborWorkflowGenerationPolicy = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function optionalNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeWorkflowGenerationPolicy(input = {}) {
        const parameters = input.parameters && typeof input.parameters === 'object' ? input.parameters : input;
        return {
            providerProfileId: cleanString(input.providerProfileId || input.profileId, 'inherit') || 'inherit',
            model: cleanString(input.model),
            temperature: optionalNumber(parameters.temperature),
            maxTokens: optionalNumber(parameters.maxTokens),
            useProviderDefaults: typeof parameters.useProviderDefaults === 'boolean'
                ? parameters.useProviderDefaults
                : null
        };
    }

    function mergeWorkflowGenerationPolicy(...inputs) {
        const merged = {
            providerProfileId: 'inherit',
            model: '',
            temperature: null,
            maxTokens: null,
            useProviderDefaults: null
        };
        for (const input of inputs) {
            const policy = normalizeWorkflowGenerationPolicy(input);
            if (policy.providerProfileId && policy.providerProfileId !== 'inherit') merged.providerProfileId = policy.providerProfileId;
            if (policy.model) merged.model = policy.model;
            if (policy.temperature !== null) merged.temperature = policy.temperature;
            if (policy.maxTokens !== null) merged.maxTokens = policy.maxTokens;
            if (policy.useProviderDefaults !== null) merged.useProviderDefaults = policy.useProviderDefaults;
        }
        return merged;
    }

    return {
        normalizeWorkflowGenerationPolicy,
        mergeWorkflowGenerationPolicy
    };
});
