(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./prompt-builder'),
            require('./generation-result')
        );
    } else {
        root.DraftHarborAIProviderClient = factory(root.DraftHarborPromptBuilder, root.DraftHarborGenerationResult);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PromptBuilder, GenerationResult) {
    function normalizeProviderConfig(config = {}) {
        return {
            mode: config.mode || config.aiMode || 'api',
            provider: config.provider || config.aiProvider || 'anthropic',
            apiKey: config.apiKey || config.aiApiKey || '',
            model: config.model || config.aiModel || '',
            endpoint: config.endpoint || config.aiEndpoint || '',
            temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.8,
            maxTokens: Number.isFinite(Number(config.maxTokens)) ? Number(config.maxTokens) : 300,
            useProviderDefaults: !!config.useProviderDefaults
        };
    }

    function createProviderRequest(input = {}) {
        const provider = normalizeProviderConfig(input.provider || input.config || {});
        const prompt = input.prompt || {};
        const messages = Array.isArray(prompt.messages)
            ? prompt.messages
            : Array.isArray(input.messages)
                ? input.messages
                : [{ role: 'user', content: String(input.prompt || '') }];

        return {
            task: input.task || (prompt.meta && prompt.meta.task) || 'generation',
            provider,
            messages,
            promptText: provider.mode === 'local' ? PromptBuilder.messagesToChatML(messages) : '',
            signal: input.signal || null
        };
    }

    async function runProviderRequest(request, adapter) {
        const startedAt = new Date().toISOString();
        try {
            if (!adapter || typeof adapter.run !== 'function') {
                throw new Error('Provider adapter is required');
            }
            const result = await adapter.run(request);
            return GenerationResult.createGenerationResult({
                ok: true,
                task: request.task,
                provider: request.provider.provider,
                model: request.provider.model,
                text: result && result.text,
                reasoning: result && result.reasoning,
                messages: request.messages,
                usage: result && result.usage,
                startedAt,
                finishedAt: new Date().toISOString()
            });
        } catch (error) {
            return GenerationResult.createGenerationResult({
                ok: false,
                task: request.task,
                provider: request.provider.provider,
                model: request.provider.model,
                messages: request.messages,
                startedAt,
                finishedAt: new Date().toISOString(),
                error: GenerationResult.normalizeGenerationError(error, {
                    provider: request.provider.provider,
                    model: request.provider.model
                })
            });
        }
    }

    return {
        normalizeProviderConfig,
        createProviderRequest,
        runProviderRequest
    };
});
