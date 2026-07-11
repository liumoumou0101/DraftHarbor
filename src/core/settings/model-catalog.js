(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborModelCatalog = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var PROVIDER_MODELS = Object.freeze({
        deepseek: [
            { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', thinkingSupported: true },
            { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', thinkingSupported: true }
        ],
        openai: [
            { id: 'gpt-4o', label: 'GPT-4o' },
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
            { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' }
        ],
        openrouter: [
            { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
            { id: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
            { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
            { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' }
        ],
        nanogpt: [
            { id: 'gpt-4o', label: 'GPT-4o' },
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini' }
        ],
        'openai-compatible': [
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini (compatible)' }
        ],
        custom: []
    });

    var CUSTOM_MODEL_OPTION = { id: '__custom__', label: '自定义模型...' };

    var PROVIDER_METADATA = Object.freeze({
        deepseek: { label: 'DeepSeek', defaultEndpoint: 'https://api.deepseek.com/chat/completions', defaultModelHint: 'deepseek-v4-pro', modelHint: '模型ID，如 deepseek-v4-pro / deepseek-v4-flash' },
        openai: { label: 'OpenAI', defaultEndpoint: 'https://api.openai.com/v1/chat/completions', defaultModelHint: 'gpt-4o-mini', modelHint: '模型ID，如 gpt-4o / gpt-4o-mini / gpt-4-turbo' },
        openrouter: { label: 'OpenRouter', defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions', defaultModelHint: '', modelHint: '完整模型ID，如 openai/gpt-4o / anthropic/claude-sonnet-4-20250514' },
        nanogpt: { label: 'NanoGPT', defaultEndpoint: '', defaultModelHint: '', modelHint: '模型ID，由 NanoGPT 服务端决定' },
        'openai-compatible': { label: 'OpenAI-compatible', defaultEndpoint: '', defaultModelHint: 'gpt-4o-mini', modelHint: '由兼容 endpoint 决定的模型ID' },
        custom: { label: 'Custom', defaultEndpoint: '', defaultModelHint: '', modelHint: '自定义模型ID' },
        lmstudio: { label: 'LM Studio', defaultEndpoint: 'http://localhost:1234', defaultModelHint: '', modelHint: '' },
        ollama: { label: 'Ollama', defaultEndpoint: 'http://localhost:11434', defaultModelHint: '', modelHint: '' },
        anthropic: { label: 'Anthropic', defaultEndpoint: '', defaultModelHint: '', modelHint: '' },
        google: { label: 'Google AI', defaultEndpoint: '', defaultModelHint: '', modelHint: '' }
    });

    function getProviderMetadata(provider) {
        return PROVIDER_METADATA[provider] || { label: provider, defaultEndpoint: '', defaultModelHint: '', modelHint: '' };
    }

    function getProviderModels(provider) {
        var entries = PROVIDER_MODELS[provider];
        if (!entries) return [CUSTOM_MODEL_OPTION];
        return entries.concat([CUSTOM_MODEL_OPTION]);
    }

    function getProviderModelEntry(provider, modelId) {
        var entries = PROVIDER_MODELS[provider] || [];
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].id === modelId) return entries[i];
        }
        return null;
    }

    function isThinkingSupported(provider, modelId) {
        if (provider !== 'deepseek') return false;
        var entry = getProviderModelEntry(provider, modelId);
        return entry ? !!entry.thinkingSupported : false;
    }

    function isKnownDefaultEndpoint(endpoint) {
        if (!endpoint) return false;
        var trimmed = endpoint.trim();
        if (!trimmed) return false;
        var providers = Object.keys(PROVIDER_METADATA);
        for (var i = 0; i < providers.length; i++) {
            var meta = PROVIDER_METADATA[providers[i]];
            if (meta.defaultEndpoint && meta.defaultEndpoint === trimmed) return true;
        }
        return false;
    }

    function isKnownDefaultModelHint(model) {
        if (!model) return false;
        var trimmed = model.trim();
        if (!trimmed) return false;
        var providers = Object.keys(PROVIDER_METADATA);
        for (var i = 0; i < providers.length; i++) {
            var meta = PROVIDER_METADATA[providers[i]];
            if (meta.defaultModelHint && meta.defaultModelHint === trimmed) return true;
        }
        return false;
    }

    var API_COMPATIBLE_PROVIDERS = Object.freeze([
        'deepseek', 'openai', 'openrouter', 'nanogpt', 'openai-compatible', 'custom'
    ]);

    function isApiCompatibleProvider(provider) {
        return API_COMPATIBLE_PROVIDERS.indexOf(provider) >= 0;
    }

    return {
        PROVIDER_MODELS: PROVIDER_MODELS,
        PROVIDER_METADATA: PROVIDER_METADATA,
        CUSTOM_MODEL_OPTION: CUSTOM_MODEL_OPTION,
        getProviderModels: getProviderModels,
        getProviderModelEntry: getProviderModelEntry,
        getProviderMetadata: getProviderMetadata,
        isThinkingSupported: isThinkingSupported,
        isKnownDefaultEndpoint: isKnownDefaultEndpoint,
        isKnownDefaultModelHint: isKnownDefaultModelHint,
        API_COMPATIBLE_PROVIDERS: API_COMPATIBLE_PROVIDERS,
        isApiCompatibleProvider: isApiCompatibleProvider
    };
});
