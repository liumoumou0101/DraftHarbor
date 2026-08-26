(function (root, factory) {
    const instructionStack = typeof module === 'object' && module.exports
        ? require('./instruction-stack')
        : root.DraftHarborInstructionStack;
    const api = factory(root, instructionStack);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DraftHarborProviderStream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (runtime, InstructionStack) {
    const THINKING_DISABLED_PARAMS = Object.freeze(['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']);
    const MODEL_CAPABILITIES = Object.freeze({
        'deepseek-v4-flash': Object.freeze({
            label: 'DeepSeek V4 Flash',
            thinkingSupported: true,
            thinkingControl: 'toggle',
            contextNote: '1M 上下文，快速响应',
            thinkingDisabledParams: THINKING_DISABLED_PARAMS
        }),
        'deepseek-v4-pro': Object.freeze({
            label: 'DeepSeek V4 Pro',
            thinkingSupported: true,
            thinkingControl: 'toggle',
            contextNote: '1M 上下文，深度推理',
            thinkingDisabledParams: THINKING_DISABLED_PARAMS
        })
    });

    const STREAM_TIMEOUT_DEFAULTS = Object.freeze({
        firstResponseMs: 600000,
        idleMs: 120000,
        maxDurationMs: 0
    });

    const INLINE_THINK_OPEN = /<(think|thinking|analysis)(?:\s[^>]*)?>/i;
    const INLINE_THINK_CLOSE = /<\/(think|thinking|analysis)>/i;

    function incompleteInlineTagIndex(text) {
        const index = String(text || '').lastIndexOf('<');
        if (index < 0) return -1;
        if (text.indexOf('>', index) !== -1) return -1;
        const tail = text.slice(index);
        return /^<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?$/.test(tail) || /^<\/?[a-zA-Z]*$/.test(tail) ? index : -1;
    }

    function createInlineThinkSplitter(emit) {
        let hold = '';
        let inThink = false;
        const deliver = typeof emit === 'function' ? emit : function () {};

        function emitChunk(text, type) {
            if (!text) return;
            deliver(text, { type });
        }

        function processHold() {
            while (hold) {
                if (!inThink) {
                    const open = hold.match(INLINE_THINK_OPEN);
                    if (!open) {
                        const keepFrom = incompleteInlineTagIndex(hold);
                        if (keepFrom === 0) return;
                        if (keepFrom > 0) {
                            emitChunk(hold.slice(0, keepFrom), 'content');
                            hold = hold.slice(keepFrom);
                            return;
                        }
                        emitChunk(hold, 'content');
                        hold = '';
                        return;
                    }
                    if (open.index > 0) emitChunk(hold.slice(0, open.index), 'content');
                    hold = hold.slice(open.index + open[0].length);
                    inThink = true;
                    continue;
                }
                const close = hold.match(INLINE_THINK_CLOSE);
                if (!close) {
                    const keepFrom = incompleteInlineTagIndex(hold);
                    if (keepFrom === 0) return;
                    if (keepFrom > 0) {
                        emitChunk(hold.slice(0, keepFrom), 'reasoning');
                        hold = hold.slice(keepFrom);
                        return;
                    }
                    emitChunk(hold, 'reasoning');
                    hold = '';
                    return;
                }
                if (close.index > 0) emitChunk(hold.slice(0, close.index), 'reasoning');
                hold = hold.slice(close.index + close[0].length);
                inThink = false;
            }
        }

        function finish() {
            if (hold) emitChunk(hold, inThink ? 'reasoning' : 'content');
            hold = '';
            inThink = false;
        }

        function push(token, meta) {
            const type = meta && meta.type ? meta.type : 'content';
            if (type !== 'content') {
                if (type === 'finish' || type === 'usage') finish();
                deliver(token, meta || { type });
                return;
            }
            hold += String(token || '');
            processHold();
        }

        return { push, finish };
    }

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

    function prependGlobalPrompt(messages, value) {
        const prefix = String(value || '').trim();
        if (!prefix) return Array.isArray(messages) ? messages : [];
        return [{ role: 'system', content: prefix }, ...(Array.isArray(messages) ? messages : [])];
    }

    function prepareDirectiveMessages(messages, prompt, config) {
        const source = Array.isArray(messages) ? messages : [];
        const stackMode = config.directiveStackMode
            || (config.directiveStack && config.directiveStack.mode)
            || 'parity';
        // Scoped mode must fail closed if the compiler is unavailable. Falling
        // back to legacy prepend would re-pollute JSON/agent/reader requests.
        if (!InstructionStack) {
            return {
                messages: stackMode === 'scoped'
                    ? source
                    : prependGlobalPrompt(source, config.globalPrompt),
                debug: null
            };
        }
        if (stackMode !== 'scoped') {
            return {
                messages: prependGlobalPrompt(source, config.globalPrompt),
                debug: null
            };
        }
        const taskKind = InstructionStack.resolveTaskKind(config, prompt);
        const compiled = config.compiledDirectives || InstructionStack.compileInstructionStack({
            taskKind,
            directiveStack: config.directiveStack,
            projectDirectiveStack: config.projectDirectiveStack,
            frozenDirectiveStack: config.frozenDirectiveStack,
            sessionDirective: config.sessionDirective
                || (prompt && prompt.meta && prompt.meta.directiveContext && prompt.meta.directiveContext.sessionDirective),
            directiveOverride: config.directiveOverride
                || (prompt && prompt.meta && prompt.meta.directiveContext && prompt.meta.directiveContext.override),
            globalPrompt: config.globalPrompt
        });
        if (typeof config.onDirectiveStackDebug === 'function') {
            config.onDirectiveStackDebug(compiled.debug);
        }
        return {
            messages: InstructionStack.applyInstructionStack(source, compiled),
            debug: compiled.debug
        };
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

    function resolveModelCatalog() {
        if (typeof module === 'object' && module.exports) {
            try { return require('../settings/model-catalog'); } catch (error) { /* browser bundle */ }
        }
        return runtime.DraftHarborModelCatalog || null;
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

    function resolveThinkingControl(config, modelId, entry) {
        const catalog = resolveModelCatalog();
        if (catalog && typeof catalog.getThinkingControl === 'function') {
            return catalog.getThinkingControl(config.provider, modelId, { entry: entry });
        }
        if (entry && (entry.thinkingControl === 'toggle' || entry.thinkingControl === 'toggle-adaptive' || entry.thinkingControl === 'always-on')) {
            return entry.thinkingControl;
        }
        if (entry && entry.thinkingSupported) return 'toggle';
        if (String(config.provider || '') === 'deepseek') return 'toggle';
        return 'none';
    }

    function resolveChatSelection(config) {
        const provider = String(config.provider || '');
        const catalog = resolveModelCatalog();
        let model = '';
        let requestedThinking = !!config.enableThinking;
        if (provider === 'deepseek') {
            const deepseek = resolveDeepSeekSelection(config);
            model = deepseek.model;
            requestedThinking = deepseek.thinking;
        } else {
            const requested = String(config.model || config.aiModel || '').trim();
            const fallback = catalog && typeof catalog.getProviderMetadata === 'function'
                ? (catalog.getProviderMetadata(provider).defaultModelHint || 'gpt-4o-mini')
                : 'gpt-4o-mini';
            model = requested || fallback;
        }
        const entry = catalog && typeof catalog.getProviderModelEntry === 'function'
            ? catalog.getProviderModelEntry(provider, model)
            : getModelCapability(model);
        const thinkingControl = resolveThinkingControl(config, model, entry);
        const thinkingSupported = thinkingControl === 'toggle' || thinkingControl === 'toggle-adaptive';
        const thinking = thinkingControl === 'always-on' || (thinkingSupported && requestedThinking);
        return {
            model,
            thinking,
            requestedThinking,
            thinkingControl,
            thinkingSupported,
            capability: entry || getModelCapability(model)
        };
    }

    function resolveChatEndpoint(config) {
        const catalog = resolveModelCatalog();
        if (catalog && typeof catalog.resolveProviderEndpoint === 'function') {
            return catalog.resolveProviderEndpoint(config.provider, config.endpoint || config.aiEndpoint, config);
        }
        return config.endpoint || config.aiEndpoint
            || (config.provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : '');
    }

    function createChatRequest(messages, config) {
        const selection = resolveChatSelection(config);
        const capability = selection.capability || getModelCapability(selection.model) || {};
        const catalog = resolveModelCatalog();
        const payload = catalog && typeof catalog.thinkingRequestPayload === 'function'
            ? catalog.thinkingRequestPayload(selection.thinkingControl, selection.requestedThinking)
            : (selection.thinkingSupported
                ? { type: selection.thinkingControl === 'toggle-adaptive'
                    ? (selection.requestedThinking ? 'adaptive' : 'disabled')
                    : (selection.requestedThinking ? 'enabled' : 'disabled') }
                : null);
        const body = { model: selection.model, messages, stream: true };
        if (config.includeUsage) body.stream_options = { include_usage: true };
        if (payload) body.thinking = payload;
        if (!config.useProviderDefaults) {
            body.temperature = numeric(config.temperature, 0.8);
            body.max_tokens = numeric(config.maxTokens, 300);
        }
        if (selection.thinking) {
            const unsupported = new Set(
                (capability.thinkingDisabledParams && capability.thinkingDisabledParams.length)
                    ? capability.thinkingDisabledParams
                    : THINKING_DISABLED_PARAMS
            );
            for (const key of unsupported) delete body[key];
        }
        return {
            body,
            thinking: selection.thinking,
            thinkingSupported: selection.thinkingSupported,
            thinkingControl: selection.thinkingControl
        };
    }

    async function requestChat(messages, emit, config, onActivity) {
        const endpoint = resolveChatEndpoint(config);
        if (!endpoint) throw new Error('API endpoint is required.');
        const request = createChatRequest(messages, config);
        const catalog = resolveModelCatalog();
        const headers = catalog && typeof catalog.providerAuthHeaders === 'function'
            ? catalog.providerAuthHeaders(config.provider, config.apiKey)
            : {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
            };
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(request.body),
            signal: config.signal
        });
        if (!response.ok) {
            const retryAfter = response.headers && response.headers.get ? response.headers.get('retry-after') : null;
            let providerType = '';
            let detail = '';
            try {
                const raw = await response.text();
                const parsed = raw ? JSON.parse(raw) : null;
                const err = parsed && parsed.error ? parsed.error : parsed;
                providerType = String((err && (err.type || err.code)) || '');
                detail = String((err && err.message) || '').replace(/\s+/g, ' ').trim().slice(0, 180);
            } catch (_) { /* keep status-only fallback */ }
            const message = response.status === 429
                ? (detail || 'AI Provider 请求过于频繁，请稍后重试。')
                : (detail || `AI Provider 返回 HTTP ${response.status}。`);
            throw providerError(`provider_http_${response.status}`, message, {
                status: response.status,
                retryAfter,
                providerType
            });
        }
        if (typeof onActivity === 'function') onActivity();

        if (!response.body || typeof response.body.getReader !== 'function') {
            const payload = await response.json();
            if (typeof onActivity === 'function') onActivity();
            const choice = payload && payload.choices && payload.choices[0] ? payload.choices[0] : {};
            const message = choice.message || {};
            if (message.reasoning_content) emit(message.reasoning_content, { type: 'reasoning' });
            if (message.content) emit(message.content, { type: 'content' });
            if (choice.finish_reason) emit('', { type: 'finish', finishReason: choice.finish_reason });
            if (payload && payload.usage) emit('', { type: 'usage', usage: payload.usage });
            return;
        }

        await consumeEventStream(response, (serialized) => {
            const payload = JSON.parse(serialized);
            if (payload && payload.usage) emit('', { type: 'usage', usage: payload.usage });
            const choice = payload && payload.choices && payload.choices[0];
            const delta = choice && choice.delta ? choice.delta : {};
            if (delta.reasoning_content) emit(delta.reasoning_content, { type: 'reasoning' });
            if (delta.content) emit(delta.content, { type: 'content' });
            if (choice && choice.finish_reason) emit('', { type: 'finish', finishReason: choice.finish_reason });
        }, onActivity);
    }

    function toAnthropicMessages(messages) {
        const systemParts = [];
        const rest = [];
        (Array.isArray(messages) ? messages : []).forEach((message) => {
            const role = message && message.role === 'assistant'
                ? 'assistant'
                : (message && message.role === 'system' ? 'system' : 'user');
            const content = String((message && message.content) || '');
            if (role === 'system') {
                if (content.trim()) systemParts.push(content);
                return;
            }
            const last = rest[rest.length - 1];
            if (last && last.role === role) last.content = `${last.content}\n\n${content}`.trim() || ' ';
            else rest.push({ role, content: content.trim() || ' ' });
        });
        if (!rest.length) rest.push({ role: 'user', content: ' ' });
        if (rest[0].role !== 'user') rest.unshift({ role: 'user', content: '请开始。' });
        return { system: systemParts.join('\n\n'), messages: rest };
    }

    function visitAnthropicEvent(serialized, emit) {
        if (!serialized || serialized === '[DONE]') return;
        const payload = JSON.parse(serialized);
        if (!payload || payload.type === 'ping') return;
        if (payload.type === 'error') {
            const detail = String((payload.error && payload.error.message) || 'Anthropic 返回错误。').replace(/\s+/g, ' ').trim().slice(0, 180);
            throw providerError('provider_error', detail || 'Anthropic 返回错误。');
        }
        if (payload.type === 'content_block_delta') {
            const delta = payload.delta || {};
            if (delta.type === 'thinking_delta' && delta.thinking) emit(delta.thinking, { type: 'reasoning' });
            if (delta.type === 'text_delta' && delta.text) emit(delta.text, { type: 'content' });
            return;
        }
        if (payload.type === 'message_delta') {
            const stop = payload.delta && payload.delta.stop_reason;
            if (stop) emit('', { type: 'finish', finishReason: stop === 'end_turn' ? 'stop' : stop });
            if (payload.usage) emit('', { type: 'usage', usage: payload.usage });
        }
    }

    async function requestAnthropic(messages, emit, config, onActivity) {
        const endpoint = resolveChatEndpoint(config) || 'https://api.anthropic.com/v1/messages';
        if (!endpoint) throw new Error('API endpoint is required.');
        const catalog = resolveModelCatalog();
        const fallback = catalog && typeof catalog.getProviderMetadata === 'function'
            ? (catalog.getProviderMetadata(config.provider).defaultModelHint || 'claude-sonnet-4-6')
            : 'claude-sonnet-4-6';
        const converted = toAnthropicMessages(messages);
        const body = {
            model: String(config.model || config.aiModel || fallback).trim() || fallback,
            messages: converted.messages,
            stream: true,
            max_tokens: numeric(config.maxTokens, 8000)
        };
        if (converted.system) body.system = converted.system;
        if (!config.useProviderDefaults) {
            body.temperature = Math.max(0, Math.min(1, numeric(config.temperature, 0.8)));
        }
        const headers = catalog && typeof catalog.providerAuthHeaders === 'function'
            ? catalog.providerAuthHeaders(config.provider, config.apiKey)
            : {
                'Content-Type': 'application/json',
                'x-api-key': String(config.apiKey || ''),
                'anthropic-version': '2023-06-01'
            };
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: config.signal
        });
        if (!response.ok) {
            const retryAfter = response.headers && response.headers.get ? response.headers.get('retry-after') : null;
            let providerType = '';
            let detail = '';
            try {
                const raw = await response.text();
                const parsed = raw ? JSON.parse(raw) : null;
                const err = parsed && parsed.error ? parsed.error : parsed;
                providerType = String((err && (err.type || err.code)) || '');
                detail = String((err && err.message) || '').replace(/\s+/g, ' ').trim().slice(0, 180);
            } catch (_) { /* keep status-only fallback */ }
            throw providerError(`provider_http_${response.status}`, detail || `AI Provider 返回 HTTP ${response.status}。`, {
                status: response.status,
                retryAfter,
                providerType
            });
        }
        if (typeof onActivity === 'function') onActivity();
        if (!response.body || typeof response.body.getReader !== 'function') {
            const payload = await response.json();
            if (typeof onActivity === 'function') onActivity();
            const blocks = Array.isArray(payload && payload.content) ? payload.content : [];
            for (const block of blocks) {
                if (block && block.type === 'thinking' && block.thinking) emit(block.thinking, { type: 'reasoning' });
                if (block && block.type === 'text' && block.text) emit(block.text, { type: 'content' });
            }
            if (payload && payload.stop_reason) emit('', { type: 'finish', finishReason: payload.stop_reason === 'end_turn' ? 'stop' : payload.stop_reason });
            if (payload && payload.usage) emit('', { type: 'usage', usage: payload.usage });
            return;
        }
        await consumeEventStream(response, (serialized) => visitAnthropicEvent(serialized, emit), onActivity);
    }

    function toResponsesInput(messages) {
        const systemParts = [];
        const input = [];
        (Array.isArray(messages) ? messages : []).forEach((message) => {
            const role = message && message.role === 'assistant'
                ? 'assistant'
                : (message && message.role === 'system' ? 'system' : 'user');
            const content = String((message && message.content) || '');
            if (role === 'system') {
                if (content.trim()) systemParts.push(content);
                return;
            }
            const last = input[input.length - 1];
            if (last && last.role === role) last.content = `${last.content}\n\n${content}`.trim() || ' ';
            else input.push({ role, content: content.trim() || ' ' });
        });
        if (!input.length) input.push({ role: 'user', content: ' ' });
        return { instructions: systemParts.join('\n\n'), input };
    }

    function responsesUsage(usage) {
        if (!usage || typeof usage !== 'object') return null;
        return {
            prompt_tokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
            completion_tokens: Number(usage.completion_tokens || usage.output_tokens || 0),
            total_tokens: Number(usage.total_tokens || 0),
            input_tokens: Number(usage.input_tokens || usage.prompt_tokens || 0),
            output_tokens: Number(usage.output_tokens || usage.completion_tokens || 0)
        };
    }

    function emitResponsesOutput(output, emit, options) {
        const skipContent = !!(options && options.skipContent);
        const skipReasoning = !!(options && options.skipReasoning);
        const items = Array.isArray(output) ? output : [];
        items.forEach((item) => {
            if (!item) return;
            if (item.type === 'reasoning') {
                if (skipReasoning) return;
                const summaries = Array.isArray(item.summary) ? item.summary : [];
                summaries.forEach((part) => {
                    if (part && part.text) emit(part.text, { type: 'reasoning' });
                });
                if (item.content && typeof item.content === 'string') emit(item.content, { type: 'reasoning' });
                return;
            }
            if (skipContent) return;
            const parts = Array.isArray(item.content) ? item.content : [];
            parts.forEach((part) => {
                if (part && part.type === 'output_text' && part.text) emit(part.text, { type: 'content' });
                if (part && part.type === 'text' && part.text) emit(part.text, { type: 'content' });
            });
            if (item.type === 'message' && typeof item.content === 'string' && item.content) {
                emit(item.content, { type: 'content' });
            }
        });
    }

    function createResponsesVisitor(emit) {
        let streamedContent = false;
        let streamedReasoning = false;
        return function visitResponsesEvent(serialized) {
            if (!serialized || serialized === '[DONE]') return;
            const payload = JSON.parse(serialized);
            if (!payload || !payload.type) return;
            if (payload.type === 'error' || payload.type === 'response.failed') {
                const detail = String((payload.error && payload.error.message) || payload.message || 'Responses 返回错误。').replace(/\s+/g, ' ').trim().slice(0, 180);
                throw providerError('provider_error', detail || 'Responses 返回错误。');
            }
            const deltaText = typeof payload.delta === 'string'
                ? payload.delta
                : (payload.delta && payload.delta.text ? String(payload.delta.text) : '');
            if ((payload.type === 'response.output_text.delta' || payload.type === 'response.text.delta') && deltaText) {
                streamedContent = true;
                emit(deltaText, { type: 'content' });
                return;
            }
            if ((payload.type === 'response.reasoning_summary_text.delta' || payload.type === 'response.reasoning_text.delta') && deltaText) {
                streamedReasoning = true;
                emit(deltaText, { type: 'reasoning' });
                return;
            }
            if (payload.type === 'response.completed' || payload.type === 'response.incomplete') {
                const completed = payload.response || payload;
                if (!streamedContent || !streamedReasoning) {
                    emitResponsesOutput(completed && completed.output, emit, {
                        skipContent: streamedContent,
                        skipReasoning: streamedReasoning
                    });
                }
                if (completed && completed.usage) emit('', { type: 'usage', usage: responsesUsage(completed.usage) });
                const truncated = payload.type === 'response.incomplete'
                    || (completed && completed.status === 'incomplete')
                    || (completed && completed.incomplete_details && completed.incomplete_details.reason === 'max_output_tokens');
                emit('', { type: 'finish', finishReason: truncated ? 'length' : 'stop' });
            }
        };
    }

    function createResponsesRequest(messages, config) {
        const selection = resolveChatSelection(config);
        const catalog = resolveModelCatalog();
        const converted = toResponsesInput(messages);
        const body = {
            model: selection.model,
            input: converted.input,
            stream: true
        };
        if (converted.instructions) body.instructions = converted.instructions;
        if (!config.useProviderDefaults) {
            body.max_output_tokens = numeric(config.maxTokens, 800);
        }
        const payload = catalog && typeof catalog.thinkingRequestPayload === 'function'
            ? catalog.thinkingRequestPayload(selection.thinkingControl, selection.requestedThinking)
            : null;
        if (payload && payload.effort) body.reasoning = { effort: payload.effort };
        return {
            body,
            thinking: selection.thinking,
            thinkingSupported: selection.thinkingSupported,
            thinkingControl: selection.thinkingControl
        };
    }

    async function requestResponses(messages, emit, config, onActivity) {
        const endpoint = resolveChatEndpoint(config);
        if (!endpoint) throw new Error('API endpoint is required.');
        const request = createResponsesRequest(messages, config);
        const catalog = resolveModelCatalog();
        const headers = catalog && typeof catalog.providerAuthHeaders === 'function'
            ? catalog.providerAuthHeaders(config.provider, config.apiKey)
            : {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
            };
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(request.body),
            signal: config.signal
        });
        if (!response.ok) {
            const retryAfter = response.headers && response.headers.get ? response.headers.get('retry-after') : null;
            let providerType = '';
            let detail = '';
            try {
                const raw = await response.text();
                const parsed = raw ? JSON.parse(raw) : null;
                const err = parsed && parsed.error ? parsed.error : parsed;
                providerType = String((err && (err.type || err.code)) || '');
                detail = String((err && err.message) || '').replace(/\s+/g, ' ').trim().slice(0, 180);
            } catch (_) { /* keep status-only fallback */ }
            throw providerError(`provider_http_${response.status}`, detail || `AI Provider 返回 HTTP ${response.status}。`, {
                status: response.status,
                retryAfter,
                providerType
            });
        }
        if (typeof onActivity === 'function') onActivity();
        if (!response.body || typeof response.body.getReader !== 'function') {
            const payload = await response.json();
            if (typeof onActivity === 'function') onActivity();
            emitResponsesOutput(payload && payload.output, emit);
            if (payload && payload.usage) emit('', { type: 'usage', usage: responsesUsage(payload.usage) });
            emit('', { type: 'finish', finishReason: payload && payload.status === 'incomplete' ? 'length' : 'stop' });
            return;
        }
        await consumeEventStream(response, createResponsesVisitor(emit), onActivity);
    }

    function resolveApiTransport(config) {
        const catalog = resolveModelCatalog();
        const modelId = config && (config.model || config.aiModel);
        if (catalog && typeof catalog.getModelTransport === 'function') {
            return catalog.getModelTransport(config.provider, modelId);
        }
        if (catalog && typeof catalog.getProviderTransport === 'function') {
            return catalog.getProviderTransport(config.provider);
        }
        return config.provider === 'anthropic' ? 'anthropic-messages' : 'chat-completions';
    }

    async function streamGeneration(prompt, onToken, config) {
        const settings = config && typeof config === 'object' ? config : {};
        const deliver = typeof onToken === 'function' ? onToken : function () {};
        let contentCharacters = 0;
        const splitter = createInlineThinkSplitter((token, meta) => {
            if (!meta || meta.type === 'content') contentCharacters += String(token || '').length;
            deliver(token, meta);
        });
        if (typeof runtime.__draftHarborGenerationStub === 'function') {
            try {
                return await runtime.__draftHarborGenerationStub(prompt, splitter.push, settings);
            } finally {
                splitter.finish();
            }
        }
        const watchdog = createActivityWatchdog(settings);
        const activeSettings = { ...settings, signal: watchdog.signal };
        const emit = (token, meta) => {
            watchdog.touch();
            splitter.push(token, meta);
        };
        const messages = prompt && Array.isArray(prompt.messages) ? prompt.messages : null;
        const mode = activeSettings.mode || activeSettings.aiMode || 'local';
        try {
            if (mode === 'api') {
                const prepared = prepareDirectiveMessages(
                    messages || [{ role: 'user', content: String(prompt || '') }],
                    prompt,
                    activeSettings
                );
                const chatMessages = prepared.messages;
                const transport = resolveApiTransport(activeSettings);
                const result = transport === 'anthropic-messages'
                    ? await requestAnthropic(chatMessages, emit, activeSettings, watchdog.touch)
                    : (transport === 'responses'
                        ? await requestResponses(chatMessages, emit, activeSettings, watchdog.touch)
                        : await requestChat(chatMessages, emit, activeSettings, watchdog.touch));
                splitter.finish();
                if (!contentCharacters) throw providerError('provider_empty_response', 'AI Provider 没有返回可用正文。');
                return result;
            }
            const serialized = messages
                ? messagesToChatML(prepareDirectiveMessages(messages, prompt, activeSettings).messages)
                : String(prompt && typeof prompt.asString === 'function' ? prompt.asString() : prompt || '');
            const result = await requestLocal(serialized, emit, activeSettings, watchdog.touch);
            splitter.finish();
            if (!contentCharacters) throw providerError('provider_empty_response', '本地生成服务没有返回可用正文。');
            return result;
        } catch (error) {
            splitter.finish();
            throw watchdog.error() || error;
        } finally {
            watchdog.finish();
        }
    }

    return Object.freeze({
        MODEL_CAPABILITIES,
        STREAM_TIMEOUT_DEFAULTS,
        getModelCapability,
        messagesToChatML,
        prependGlobalPrompt,
        prepareDirectiveMessages,
        toAnthropicMessages,
        toResponsesInput,
        createInlineThinkSplitter,
        streamGeneration
    });
});
