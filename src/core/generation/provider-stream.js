(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DraftHarborProviderStream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (runtime) {
    const MODEL_CAPABILITIES = Object.freeze({
        'deepseek-v4-flash': Object.freeze({
            label: 'DeepSeek V4 Flash',
            thinkingSupported: true,
            contextNote: '1M 上下文，快速响应',
            thinkingDisabledParams: Object.freeze(['temperature', 'top_p', 'presence_penalty', 'frequency_penalty'])
        }),
        'deepseek-v4-pro': Object.freeze({
            label: 'DeepSeek V4 Pro',
            thinkingSupported: true,
            contextNote: '1M 上下文，深度推理',
            thinkingDisabledParams: Object.freeze(['temperature', 'top_p', 'presence_penalty', 'frequency_penalty'])
        })
    });

    const STREAM_TIMEOUT_DEFAULTS = Object.freeze({
        firstResponseMs: 600000,
        idleMs: 120000,
        maxDurationMs: 0
    });

    function getModelCapability(modelId) {
        return MODEL_CAPABILITIES[String(modelId || '')] || null;
    }

    function messagesToChatML(input) {
        const messages = Array.isArray(input) ? input : [];
        return messages
            .map((message) => `<|im_start|>${message.role || 'user'}\n${message.content || ''}<|im_end|>`)
            .concat('<|im_start|>assistant\n')
            .join('\n');
    }

    async function consumeEventStream(response, visit, onActivity) {
        if (!response.body || typeof response.body.getReader !== 'function') return false;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (true) {
            const part = await reader.read();
            if (part.value && part.value.length && typeof onActivity === 'function') onActivity();
            pending += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() || '';
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data) continue;
                if (data === '[DONE]') return true;
                visit(data);
            }
            if (part.done) break;
        }
        if (pending.trim().startsWith('data:')) visit(pending.trim().slice(5).trim());
        return true;
    }

    function numeric(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function positiveDuration(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function timeoutError(code, durationMs) {
        const seconds = Math.max(1, Math.round(durationMs / 1000));
        const messages = {
            stream_first_response_timeout: `AI Provider 在 ${seconds} 秒内没有返回任何数据。`,
            stream_idle_timeout: `AI Provider 已连续 ${seconds} 秒没有返回新数据。`,
            stream_max_duration: `AI Provider 生成已达到 ${seconds} 秒安全上限。`
        };
        const error = new Error(messages[code] || 'AI Provider 流式生成超时。');
        error.name = 'TimeoutError';
        error.code = code;
        return error;
    }

    function providerError(code, message, details = {}) {
        const error = new Error(message);
        error.name = 'ProviderError';
        error.code = code;
        Object.assign(error, details);
        return error;
    }

    function createActivityWatchdog(config = {}) {
        if (config.activityTimeouts === false || typeof AbortController === 'undefined') {
            return { signal: config.signal, touch() {}, finish() {}, error() { return null; } };
        }
        const firstResponseMs = positiveDuration(config.firstResponseTimeoutMs, STREAM_TIMEOUT_DEFAULTS.firstResponseMs);
        const idleMs = positiveDuration(config.idleTimeoutMs, STREAM_TIMEOUT_DEFAULTS.idleMs);
        const configuredMax = Number(config.maxDurationMs);
        const maxDurationMs = Number.isFinite(configuredMax) && configuredMax >= 0 ? configuredMax : STREAM_TIMEOUT_DEFAULTS.maxDurationMs;
        const controller = new AbortController();
        const externalSignal = config.signal;
        let firstTimer = null;
        let idleTimer = null;
        let maxTimer = null;
        let failure = null;
        let finished = false;
        let externalAbortHandler = null;

        const clear = () => {
            if (firstTimer) clearTimeout(firstTimer);
            if (idleTimer) clearTimeout(idleTimer);
            if (maxTimer) clearTimeout(maxTimer);
            firstTimer = idleTimer = maxTimer = null;
        };
        const abort = (error) => {
            if (finished || controller.signal.aborted) return;
            failure = error;
            clear();
            controller.abort(error);
        };
        const touch = () => {
            if (finished || controller.signal.aborted) return;
            if (firstTimer) clearTimeout(firstTimer);
            firstTimer = null;
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => abort(timeoutError('stream_idle_timeout', idleMs)), idleMs);
        };
        firstTimer = setTimeout(() => abort(timeoutError('stream_first_response_timeout', firstResponseMs)), firstResponseMs);
        if (maxDurationMs > 0) maxTimer = setTimeout(() => abort(timeoutError('stream_max_duration', maxDurationMs)), maxDurationMs);
        if (externalSignal) {
            if (externalSignal.aborted) controller.abort(externalSignal.reason);
            else {
                externalAbortHandler = () => controller.abort(externalSignal.reason);
                externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
            }
        }
        return {
            signal: controller.signal,
            touch,
            finish() {
                finished = true;
                clear();
                if (externalSignal && externalAbortHandler) externalSignal.removeEventListener('abort', externalAbortHandler);
            },
            error() { return failure; }
        };
    }

    async function requestLocal(promptText, emit, config, onActivity) {
        const endpoint = String(config.endpoint || config.aiEndpoint || 'http://localhost:8080').replace(/\/$/, '');
        const requestBody = {
            prompt: promptText,
            stream: true,
            top_p: 0.9,
            stop: ['<|im_end|>', '<|endoftext|>', '\n\n\n\n', 'USER:', 'HUMAN:']
        };
        if (!config.useProviderDefaults) {
            requestBody.n_predict = numeric(config.maxTokens, 300);
            requestBody.temperature = numeric(config.temperature, 0.8);
        }
        const response = await fetch(`${endpoint}/completion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: config.signal
        });
        if (!response.ok) throw providerError(`provider_http_${response.status}`, `本地生成服务返回 HTTP ${response.status}。`, { status: response.status });
        if (typeof onActivity === 'function') onActivity();
        await consumeEventStream(response, (serialized) => {
            try {
                const event = JSON.parse(serialized);
                if (event.content) emit(event.content);
            } catch (_) {
                // A broken event must not discard later valid stream events.
            }
        }, onActivity);
    }

    function resolveDeepSeekSelection(config) {
        const requested = String(config.model || config.aiModel || 'deepseek-v4-pro').trim();
        const aliases = {
            'deepseek-chat': ['deepseek-v4-flash', false],
            'deepseek-reasoner': ['deepseek-v4-flash', true],
            'deepseek-v4-pro-thinking': ['deepseek-v4-pro', true],
            'deepseek-v4-flash-thinking': ['deepseek-v4-flash', true]
        };
        const alias = aliases[requested];
        return {
            model: alias ? alias[0] : requested,
            thinking: config.enableThinking === undefined ? !!(alias && alias[1]) : !!config.enableThinking
        };
    }

    function createChatRequest(messages, config) {
        const deepSeek = config.provider === 'deepseek';
        const selection = deepSeek
            ? resolveDeepSeekSelection(config)
            : { model: config.model || config.aiModel || 'gpt-4o-mini', thinking: false };
        const body = { model: selection.model, messages, stream: true };
        if (config.includeUsage) body.stream_options = { include_usage: true };
        if (deepSeek) body.thinking = { type: selection.thinking ? 'enabled' : 'disabled' };
        if (!config.useProviderDefaults) {
            body.temperature = numeric(config.temperature, 0.8);
            body.max_tokens = numeric(config.maxTokens, 300);
        }
        if (selection.thinking) {
            const unsupported = new Set((getModelCapability(selection.model) || {}).thinkingDisabledParams || []);
            for (const key of unsupported) delete body[key];
        }
        return { body, deepSeek, thinking: selection.thinking };
    }

    async function requestChat(messages, emit, config, onActivity) {
        const endpoint = config.endpoint || config.aiEndpoint
            || (config.provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : '');
        if (!endpoint) throw new Error('API endpoint is required.');
        const request = createChatRequest(messages, config);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
            },
            body: JSON.stringify(request.body),
            signal: config.signal
        });
        if (!response.ok) {
            const retryAfter = response.headers && response.headers.get ? response.headers.get('retry-after') : null;
            const message = response.status === 429 ? 'AI Provider 请求过于频繁，请稍后重试。' : `AI Provider 返回 HTTP ${response.status}。`;
            throw providerError(`provider_http_${response.status}`, message, { status: response.status, retryAfter });
        }
        if (typeof onActivity === 'function') onActivity();

        if (!response.body || typeof response.body.getReader !== 'function') {
            const payload = await response.json();
            if (typeof onActivity === 'function') onActivity();
            const message = payload && payload.choices && payload.choices[0] ? payload.choices[0].message || {} : {};
            if (message.reasoning_content) emit(message.reasoning_content, { type: 'reasoning' });
            if (message.content) emit(message.content, { type: 'content' });
            return;
        }

        await consumeEventStream(response, (serialized) => {
            const payload = JSON.parse(serialized);
            if (payload && payload.usage) emit('', { type: 'usage', usage: payload.usage });
            const choice = payload && payload.choices && payload.choices[0];
            const delta = choice && choice.delta ? choice.delta : {};
            if (request.thinking && delta.reasoning_content) emit(delta.reasoning_content, { type: 'reasoning' });
            if (delta.content) emit(delta.content, request.thinking ? { type: 'content' } : undefined);
        }, onActivity);
    }

    async function streamGeneration(prompt, onToken, config) {
        const settings = config && typeof config === 'object' ? config : {};
        if (typeof runtime.__draftHarborGenerationStub === 'function') {
            return runtime.__draftHarborGenerationStub(prompt, onToken, settings);
        }
        const watchdog = createActivityWatchdog(settings);
        const activeSettings = { ...settings, signal: watchdog.signal };
        let contentCharacters = 0;
        const emit = (token, meta) => {
            watchdog.touch();
            if (!meta || meta.type === 'content') contentCharacters += String(token || '').length;
            if (typeof onToken === 'function') onToken(token, meta);
        };
        const messages = prompt && Array.isArray(prompt.messages) ? prompt.messages : null;
        const mode = activeSettings.mode || activeSettings.aiMode || 'local';
        try {
            if (mode === 'api') {
                const chatMessages = messages || [{ role: 'user', content: String(prompt || '') }];
                const result = await requestChat(chatMessages, emit, activeSettings, watchdog.touch);
                if (!contentCharacters) throw providerError('provider_empty_response', 'AI Provider 没有返回可用正文。');
                return result;
            }
            const serialized = messages
                ? messagesToChatML(messages)
                : String(prompt && typeof prompt.asString === 'function' ? prompt.asString() : prompt || '');
            const result = await requestLocal(serialized, emit, activeSettings, watchdog.touch);
            if (!contentCharacters) throw providerError('provider_empty_response', '本地生成服务没有返回可用正文。');
            return result;
        } catch (error) {
            throw watchdog.error() || error;
        } finally {
            watchdog.finish();
        }
    }

    return Object.freeze({ MODEL_CAPABILITIES, STREAM_TIMEOUT_DEFAULTS, getModelCapability, messagesToChatML, streamGeneration });
});
