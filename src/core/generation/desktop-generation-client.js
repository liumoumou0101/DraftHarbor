(function (root, factory) {
    const ProviderStream = typeof module === 'object' && module.exports
        ? require('./provider-stream')
        : root.DraftHarborProviderStream;
    const ModelCatalog = typeof module === 'object' && module.exports
        ? require('../settings/model-catalog')
        : root.DraftHarborModelCatalog;
    const api = factory(root, ProviderStream, ModelCatalog);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DraftHarborDesktopGeneration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (runtime, ProviderStream, ModelCatalog) {
    function publicConfig(config) {
        const source = config && typeof config === 'object' ? config : {};
        return {
            profileId: source.profileId || '',
            projectId: source.projectId || '',
            runId: source.runId || '',
            model: source.model || source.aiModel || '',
            enableThinking: source.enableThinking,
            temperature: source.temperature,
            maxTokens: source.maxTokens,
            useProviderDefaults: source.useProviderDefaults,
            includeUsage: source.includeUsage,
            taskKind: source.taskKind,
            workflowNodeId: source.workflowNodeId,
            directiveStackMode: source.directiveStackMode,
            frozenDirectiveStack: source.frozenDirectiveStack,
            projectDirectiveStack: source.projectDirectiveStack,
            sessionDirective: source.sessionDirective,
            globalPrompt: source.globalPrompt,
            firstResponseTimeoutMs: source.firstResponseTimeoutMs,
            idleTimeoutMs: source.idleTimeoutMs,
            confirmPrivacyRisk: !!source.confirmPrivacyRisk,
            snapshot: source.snapshot || null,
            catalog: source.catalog || null
        };
    }

    function serializePrompt(prompt) {
        if (!prompt) return { messages: [] };
        if (Array.isArray(prompt.messages)) {
            return { messages: prompt.messages };
        }
        return { text: String(prompt && typeof prompt.asString === 'function' ? prompt.asString() : prompt || '') };
    }

    async function consumeBridgeStream(response, onToken) {
        if (!response.body || typeof response.body.getReader !== 'function') {
            const payload = await response.json();
            throw Object.assign(new Error((payload && payload.error && payload.error.message) || '后台生成桥没有返回流。'), payload && payload.error || {});
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        let streamError = null;
        while (true) {
            const part = await reader.read();
            pending += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() || '';
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                let event = null;
                try { event = JSON.parse(data); } catch (error) { continue; }
                if (!event) continue;
                if (event.type === 'error' && event.error) {
                    streamError = Object.assign(new Error(event.error.message || '生成失败'), event.error);
                    continue;
                }
                if (event.type === 'done') continue;
                if (typeof onToken === 'function') {
                    onToken(event.token || '', event.meta || { type: event.type || 'content' });
                }
            }
            if (part.done) break;
        }
        if (streamError) throw streamError;
    }

    async function streamViaBridge(prompt, onToken, config) {
        const response = await fetch('/api/generation/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...publicConfig(config),
                prompt: serializePrompt(prompt)
            }),
            signal: config && config.signal
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const detail = payload.error || payload;
            throw Object.assign(new Error(detail.message || `后台生成失败（HTTP ${response.status}）`), detail);
        }
        await consumeBridgeStream(response, onToken);
    }

    function needsPrivacyConfirmation(config) {
        if (!ModelCatalog || typeof ModelCatalog.getProviderModelEntry !== 'function') return null;
        const entry = ModelCatalog.getProviderModelEntry(config.provider, config.model || config.aiModel, {
            catalog: config.catalog
        });
        if (!entry || !ModelCatalog.requiresPrivacyConfirmation(entry)) return null;
        return entry;
    }

    async function confirmPrivacyIfNeeded(config, options) {
        const entry = needsPrivacyConfirmation(config);
        if (!entry) return config;
        const acknowledged = options && Array.isArray(options.acknowledgedPrivacyModels)
            ? options.acknowledgedPrivacyModels
            : [];
        if (acknowledged.indexOf(entry.id) >= 0 || config.confirmPrivacyRisk) {
            return { ...config, confirmPrivacyRisk: true };
        }
        const confirm = options.confirm || (typeof runtime.confirm === 'function'
            ? (item) => runtime.confirm(`模型「${item.label || item.id}」可能将内容用于改进训练。确定将这次请求发送出去吗？`)
            : null);
        if (typeof confirm !== 'function') {
            const error = new Error('该模型可能将内容用于改进，请确认后再发送。');
            error.code = 'privacy_confirmation_required';
            error.modelId = entry.id;
            throw error;
        }
        const accepted = await confirm(entry);
        if (!accepted) {
            const error = new Error('已取消发送。');
            error.name = 'AbortError';
            error.code = 'privacy_rejected';
            throw error;
        }
        const acknowledge = options.onAcknowledge || (async function (item) {
            if (typeof runtime.fetch !== 'function') return;
            await runtime.fetch('/api/settings/acknowledge-model-privacy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelId: item.id })
            }).catch(function () {});
        });
        await acknowledge(entry);
        return { ...config, confirmPrivacyRisk: true };
    }

    async function streamGeneration(prompt, onToken, config, options) {
        const settings = config && typeof config === 'object' ? config : {};
        if (typeof runtime.__draftHarborGenerationStub === 'function') {
            if (!ProviderStream || typeof ProviderStream.streamGeneration !== 'function') {
                throw new Error('生成服务尚未加载');
            }
            return ProviderStream.streamGeneration(prompt, onToken, { ...settings, apiKey: '' });
        }
        if ((settings.mode || settings.aiMode || 'local') !== 'api') {
            if (!ProviderStream || typeof ProviderStream.streamGeneration !== 'function') {
                throw new Error('生成服务尚未加载');
            }
            return ProviderStream.streamGeneration(prompt, onToken, settings);
        }
        const next = await confirmPrivacyIfNeeded(settings, options || {});
        return streamViaBridge(prompt, onToken, next);
    }

    return Object.freeze({
        streamGeneration,
        publicConfig,
        serializePrompt,
        needsPrivacyConfirmation,
        confirmPrivacyIfNeeded
    });
});
