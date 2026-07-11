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

    async function consumeEventStream(response, visit) {
        if (!response.body || typeof response.body.getReader !== 'function') return false;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (true) {
            const part = await reader.read();
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

    async function requestLocal(promptText, emit, config) {
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
        if (!response.ok) throw new Error(`Local generation server returned ${response.status}`);
        await consumeEventStream(response, (serialized) => {
            try {
                const event = JSON.parse(serialized);
                if (event.content) emit(event.content);
            } catch (_) {
                // A broken event must not discard later valid stream events.
            }
        });
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

    async function requestChat(messages, emit, config) {
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
        if (!response.ok) throw new Error(`API generation returned ${response.status}`);

        if (!response.body || typeof response.body.getReader !== 'function') {
            const payload = await response.json();
            const message = payload && payload.choices && payload.choices[0] ? payload.choices[0].message || {} : {};
            if (message.reasoning_content) emit(message.reasoning_content, { type: 'reasoning' });
            if (message.content) emit(message.content, { type: 'content' });
            return;
        }

        await consumeEventStream(response, (serialized) => {
            const payload = JSON.parse(serialized);
            const choice = payload && payload.choices && payload.choices[0];
            const delta = choice && choice.delta ? choice.delta : {};
            if (request.thinking && delta.reasoning_content) emit(delta.reasoning_content, { type: 'reasoning' });
            if (delta.content) emit(delta.content, request.thinking ? { type: 'content' } : undefined);
        });
    }

    async function streamGeneration(prompt, onToken, config) {
        const settings = config && typeof config === 'object' ? config : {};
        if (typeof runtime.__draftHarborGenerationStub === 'function') {
            return runtime.__draftHarborGenerationStub(prompt, onToken, settings);
        }
        const messages = prompt && Array.isArray(prompt.messages) ? prompt.messages : null;
        const mode = settings.mode || settings.aiMode || 'local';
        if (mode === 'api') {
            const chatMessages = messages || [{ role: 'user', content: String(prompt || '') }];
            return requestChat(chatMessages, onToken, settings);
        }
        const serialized = messages
            ? messagesToChatML(messages)
            : String(prompt && typeof prompt.asString === 'function' ? prompt.asString() : prompt || '');
        return requestLocal(serialized, onToken, settings);
    }

    return Object.freeze({ MODEL_CAPABILITIES, getModelCapability, messagesToChatML, streamGeneration });
});
