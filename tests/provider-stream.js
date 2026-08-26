const assert = require('assert');

const providerStream = require('../src/core/generation/provider-stream');

assert.strictEqual(typeof providerStream.streamGeneration, 'function', 'streamGeneration should be exported');
assert.strictEqual(typeof providerStream.messagesToChatML, 'function', 'messagesToChatML should be exported');
assert.strictEqual(typeof providerStream.MODEL_CAPABILITIES, 'object', 'MODEL_CAPABILITIES should be exported');
assert.strictEqual(typeof providerStream.getModelCapability, 'function', 'getModelCapability should be exported');
assert.strictEqual(providerStream.STREAM_TIMEOUT_DEFAULTS.firstResponseMs, 600000, 'first response timeout should default to ten minutes');
assert.strictEqual(providerStream.STREAM_TIMEOUT_DEFAULTS.idleMs, 120000, 'idle timeout should default to two minutes');
assert.strictEqual(providerStream.STREAM_TIMEOUT_DEFAULTS.maxDurationMs, 0, 'active streams should have no total wall-clock limit by default');

const flashCap = providerStream.getModelCapability('deepseek-v4-flash');
assert.ok(flashCap, 'deepseek-v4-flash should have capability entry');
assert.strictEqual(flashCap.thinkingSupported, true, 'deepseek-v4-flash should support thinking');
assert.ok(flashCap.thinkingDisabledParams.includes('temperature'), 'flash thinking should disable temperature');
assert.ok(flashCap.thinkingDisabledParams.includes('top_p'), 'flash thinking should disable top_p');

const proCap = providerStream.getModelCapability('deepseek-v4-pro');
assert.ok(proCap, 'deepseek-v4-pro should have capability entry');
assert.strictEqual(proCap.thinkingSupported, true, 'deepseek-v4-pro should support thinking');
assert.ok(proCap.label.includes('Pro'), 'pro label should indicate Pro');

const unknown = providerStream.getModelCapability('unknown-model');
assert.strictEqual(unknown, null, 'unknown model should return null capability');

const chatML = providerStream.messagesToChatML([
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello.' }
]);
assert.ok(chatML.includes('<|im_start|>system'), 'ChatML should prefix system message');
assert.ok(chatML.includes('<|im_start|>user'), 'ChatML should prefix user message');
assert.ok(chatML.includes('<|im_start|>assistant'), 'ChatML should have an assistant prefix');

(async () => {
    var originalFetch = globalThis.fetch;

    // Test 1: DeepSeek thinking mode
    var lastTokens = [];
    var lastMeta = [];
    function captureToken(token, meta) {
        lastTokens.push(token);
        lastMeta.push(meta);
    }

    globalThis.fetch = async (url, init) => {
        var body = JSON.parse(init.body);
        assert.ok(body.stream, 'request body should have stream: true');
        assert.strictEqual(body.model, 'deepseek-v4-pro', 'request body should use deepseek-v4-pro model');
        assert.strictEqual(body.thinking.type, 'enabled', 'request body should have thinking enabled');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'temperature'), 'thinking mode should not send temperature');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'top_p'), 'thinking mode should not send top_p');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'presence_penalty'), 'thinking mode should not send presence_penalty');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'frequency_penalty'), 'thinking mode should not send frequency_penalty');

        var encoder = new TextEncoder();
        var chunkIndex = 0;
        var chunks = [
            { choices: [{ delta: { reasoning_content: 'Let me think about this...' } }] },
            { choices: [{ delta: { reasoning_content: ' more reasoning.' } }] },
            { choices: [{ delta: { content: 'Here is the answer.' } }] },
            { choices: [{ delta: { content: ' And more text.' } }] },
            { choices: [{ delta: {}, finish_reason: 'length' }] }
        ];

        var stream = new ReadableStream({
            async pull(controller) {
                if (chunkIndex < chunks.length) {
                    var data = JSON.stringify(chunks[chunkIndex]);
                    var line = 'data: ' + data + '\n\n';
                    controller.enqueue(encoder.encode(line));
                    chunkIndex++;
                } else {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            }
        });

        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    try {
        await providerStream.streamGeneration(
            { messages: [{ role: 'user', content: 'Test prompt' }] },
            captureToken,
            {
                mode: 'api',
                provider: 'deepseek',
                model: 'deepseek-v4-pro',
                enableThinking: true,
                endpoint: 'https://api.deepseek.com/chat/completions',
                apiKey: 'test-key',
                temperature: 0.8,
                maxTokens: 300
            }
        );

        assert.ok(lastTokens.length >= 4, 'should have received multiple tokens');

        assert.strictEqual(lastTokens[0], 'Let me think about this...');
        assert.strictEqual(lastMeta[0] && lastMeta[0].type, 'reasoning', 'first token should be reasoning type');
        assert.strictEqual(lastTokens[1], ' more reasoning.');
        assert.strictEqual(lastMeta[1] && lastMeta[1].type, 'reasoning', 'second token should be reasoning type');
        assert.strictEqual(lastTokens[2], 'Here is the answer.');
        assert.strictEqual(lastMeta[2] && lastMeta[2].type, 'content', 'third token should be content type');
        assert.strictEqual(lastTokens[3], ' And more text.');
        assert.strictEqual(lastMeta[3] && lastMeta[3].type, 'content', 'fourth token should be content type');

        var reasoningTokens = lastTokens.slice(0, 2).join('');
        var contentTokens = lastTokens.slice(2).join('');
        assert.ok(reasoningTokens.includes('think about'), 'reasoning content should not be mixed into body');
        assert.ok(contentTokens.includes('answer'), 'content should contain answer');
        assert.ok(!contentTokens.includes('reasoning'), 'content should not contain reasoning');
        assert.ok(lastMeta.some((meta) => meta && meta.type === 'finish' && meta.finishReason === 'length'), 'stream should expose provider finish reasons');

        console.log('Provider stream DeepSeek thinking test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test 2: Non-DeepSeek OpenAI-compatible should NOT send thinking fields
    globalThis.fetch = async (url, init) => {
        var body = JSON.parse(init.body);
        assert.strictEqual(body.model, 'gpt-4o-mini', 'non-deepseek should use the specified model');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'thinking'), 'non-deepseek provider should NOT send thinking field');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'reasoning'), 'non-deepseek provider should NOT send reasoning field');
        assert.strictEqual(body.temperature, 0.8, 'non-deepseek should send temperature');

        var encoder = new TextEncoder();
        var stream = new ReadableStream({
            async pull(controller) {
                var data = JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] });
                controller.enqueue(encoder.encode('data: ' + data + '\n\n'));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    try {
        var openAITokens = [];
        await providerStream.streamGeneration(
            { messages: [{ role: 'user', content: 'Test' }] },
            function (token) { openAITokens.push(token); },
            {
                mode: 'api',
                provider: 'openai',
                model: 'gpt-4o-mini',
                endpoint: 'https://api.openai.com/v1/chat/completions',
                apiKey: 'test-key',
                temperature: 0.8,
                maxTokens: 300
            }
        );
        assert.strictEqual(openAITokens[0], 'Hello', 'non-deepseek should stream content');
        console.log('Provider stream non-DeepSeek test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepStrictEqual(providerStream.prependGlobalPrompt([{ role: 'user', content: 'Draft.' }], 'Always use the project canon.'), [
        { role: 'system', content: 'Always use the project canon.' },
        { role: 'user', content: 'Draft.' }
    ], 'global prompt should be inserted as the first system instruction');

    // Test 3: active reasoning/content chunks renew the idle timeout.
    globalThis.fetch = async (_url, _init) => {
        var encoder = new TextEncoder();
        var index = 0;
        var chunks = ['思考一', '思考二', '正文一', '正文二'];
        var stream = new ReadableStream({
            async pull(controller) {
                await new Promise((resolve) => setTimeout(resolve, 12));
                if (index < chunks.length) {
                    var key = index < 2 ? 'reasoning_content' : 'content';
                    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { [key]: chunks[index++] } }] }) + '\n\n'));
                } else {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
        var renewed = [];
        await providerStream.streamGeneration(
            { messages: [{ role: 'user', content: 'Timeout renewal test' }] },
            function (token) { renewed.push(token); },
            {
                mode: 'api', provider: 'deepseek', model: 'deepseek-v4-pro', enableThinking: true,
                endpoint: 'https://api.deepseek.com/chat/completions', apiKey: 'test-key',
                firstResponseTimeoutMs: 30, idleTimeoutMs: 25, maxDurationMs: 250
            }
        );
        assert.strictEqual(renewed.join(''), '思考一思考二正文一正文二', 'active chunks should keep the stream alive beyond one idle window');
        console.log('Provider stream activity renewal test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test 4: no initial response fails with a stable timeout code.
    globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')), { once: true });
    });
    try {
        await assert.rejects(
            providerStream.streamGeneration(
                { messages: [{ role: 'user', content: 'No response test' }] },
                function () {},
                {
                    mode: 'api', provider: 'deepseek', model: 'deepseek-v4-pro',
                    endpoint: 'https://api.deepseek.com/chat/completions', apiKey: 'test-key',
                    firstResponseTimeoutMs: 20, idleTimeoutMs: 20, maxDurationMs: 100
                }
            ),
            function (error) { return error && error.code === 'stream_first_response_timeout'; }
        );
        console.log('Provider stream first response timeout test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test 5: a stream that becomes silent fails by idle timeout after its last chunk.
    globalThis.fetch = async (url, init) => {
        var encoder = new TextEncoder();
        var sent = false;
        var stream = new ReadableStream({
            pull(controller) {
                if (!sent) {
                    sent = true;
                    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'first' } }] }) + '\n\n'));
                    return;
                }
                return new Promise((resolve) => {
                    init.signal.addEventListener('abort', () => {
                        controller.error(init.signal.reason || new Error('aborted'));
                        resolve();
                    }, { once: true });
                });
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
        await assert.rejects(
            providerStream.streamGeneration(
                { messages: [{ role: 'user', content: 'Idle test' }] },
                function () {},
                {
                    mode: 'api', provider: 'openai', model: 'gpt-4o-mini',
                    endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: 'test-key',
                    firstResponseTimeoutMs: 30, idleTimeoutMs: 20, maxDurationMs: 120
                }
            ),
            function (error) { return error && error.code === 'stream_idle_timeout'; }
        );
        console.log('Provider stream idle timeout test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test 6: an otherwise successful empty stream must not be accepted as generated content.
    globalThis.fetch = async () => {
        var encoder = new TextEncoder();
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
        await assert.rejects(
            providerStream.streamGeneration(
                { messages: [{ role: 'user', content: 'Empty response test' }] },
                function () {},
                { mode: 'api', provider: 'deepseek', model: 'deepseek-v4-flash', endpoint: 'https://example.invalid', apiKey: 'test-key' }
            ),
            function (error) { return error && error.code === 'provider_empty_response'; }
        );
        console.log('Provider stream empty response test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test 7: rate limits expose a stable code and retry hint without leaking response content.
    globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '3' } });
    try {
        await assert.rejects(
            providerStream.streamGeneration(
                { messages: [{ role: 'user', content: 'Rate limit test' }] },
                function () {},
                { mode: 'api', provider: 'deepseek', model: 'deepseek-v4-flash', endpoint: 'https://example.invalid', apiKey: 'test-key' }
            ),
            function (error) { return error && error.code === 'provider_http_429' && error.retryAfter === '3'; }
        );
        console.log('Provider stream rate limit test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test 8: Model catalog
    var modelCatalog = require('../src/core/settings/model-catalog');
    assert.ok(modelCatalog, 'model-catalog should be requireable');
    assert.ok(modelCatalog.API_COMPATIBLE_PROVIDERS.length >= 5, 'should have API-compatible providers');
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('deepseek'), true);
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('openai'), true);
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('anthropic'), true, 'anthropic should be API-compatible via Messages');
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('google'), true, 'google should be API-compatible via OpenAI-compat');
    assert.strictEqual(modelCatalog.isAnthropicMessagesProvider('anthropic'), true);
    assert.strictEqual(modelCatalog.getProviderTransport('google'), 'chat-completions');
    assert.ok(modelCatalog.getProviderMetadata('anthropic').defaultEndpoint.includes('/v1/messages'));
    assert.ok(modelCatalog.getProviderMetadata('google').defaultEndpoint.includes('generativelanguage.googleapis.com'));
    assert.ok(modelCatalog.isTypedModelProvider('custom'));
    assert.ok(modelCatalog.isTypedModelProvider('openai-compatible'));
    assert.ok(modelCatalog.providerSetupHint('custom', 'api').includes('chat/completions'));
    const claudeEntry = modelCatalog.getProviderModelEntry('anthropic', 'claude-sonnet-4-6');
    assert.ok(claudeEntry && modelCatalog.isModelSelectable(claudeEntry), 'Anthropic catalog models should be selectable');
    const geminiEntry = modelCatalog.getProviderModelEntry('google', 'gemini-2.5-flash');
    assert.ok(geminiEntry && modelCatalog.isModelSelectable(geminiEntry), 'Gemini catalog models should be selectable');
    const liveAnthropic = modelCatalog.buildLiveTestRequest({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });
    assert.strictEqual(liveAnthropic.headers['x-api-key'], 'sk-ant-test');
    assert.ok(!liveAnthropic.headers.Authorization);
    const liveGoogle = modelCatalog.buildLiveTestRequest({ provider: 'google', apiKey: 'gem-key', model: 'gemini-2.5-flash' });
    assert.ok(String(liveGoogle.headers.Authorization).startsWith('Bearer '));
    assert.strictEqual(modelCatalog.isThinkingSupported('deepseek', 'deepseek-v4-pro'), true);
    assert.strictEqual(modelCatalog.isThinkingSupported('openai', 'gpt-4o'), false, 'non-deepseek should not support thinking');
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('opencode-zen'), true, 'opencode-zen should be API-compatible');
    assert.strictEqual(modelCatalog.isThinkingSupported('opencode-zen', 'deepseek-v4-pro'), true, 'Zen DeepSeek should support thinking');
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-zen', 'deepseek-v4-pro'), 'toggle');
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-zen', 'minimax-m3'), 'toggle-adaptive', 'MiniMax M3 thinking is adaptive/disabled');
    assert.strictEqual(modelCatalog.isThinkingSupported('opencode-zen', 'minimax-m3'), true, 'MiniMax M3 thinking can be toggled');
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-zen', 'minimax-m2.7'), 'always-on');
    assert.strictEqual(modelCatalog.isThinkingAlwaysOn('opencode-go', 'kimi-k2.7-code'), true);
    assert.strictEqual(modelCatalog.isThinkingAlwaysOn('opencode-go', 'kimi-k3'), true);
    assert.strictEqual(modelCatalog.isThinkingAlwaysOn('opencode-go', 'glm-5.3'), true);
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-go', 'kimi-k2.6'), 'toggle');
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-go', 'glm-5.2'), 'toggle');
    assert.strictEqual(modelCatalog.thinkingWillRun('opencode-go', 'kimi-k2.7-code', false), true, 'always-on models think even when the toggle is off');
    assert.strictEqual(modelCatalog.thinkingWillRun('opencode-zen', 'minimax-m3', false), false);
    assert.deepStrictEqual(modelCatalog.thinkingRequestPayload('toggle', true), { type: 'enabled' });
    assert.deepStrictEqual(modelCatalog.thinkingRequestPayload('toggle-adaptive', true), { type: 'adaptive' });
    assert.deepStrictEqual(modelCatalog.thinkingRequestPayload('toggle-adaptive', false), { type: 'disabled' });
    assert.strictEqual(modelCatalog.thinkingRequestPayload('always-on', false), null);
    assert.strictEqual(modelCatalog.getThinkingControl('openai', 'gpt-4o'), 'none');
    assert.strictEqual(modelCatalog.inferThinkingControl('openai-compatible/minimax-m3'), 'toggle-adaptive');
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-go', 'longcat-2.0'), 'always-on');
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-go', 'qwen3.6-plus'), 'always-on');
    assert.strictEqual(modelCatalog.inferOpencodeTransport('qwen3.6-plus'), 'chat-completions');
    assert.strictEqual(modelCatalog.inferOpencodeTransport('gpt-5.6-luna'), 'responses');
    assert.ok(modelCatalog.isOpencodeGatewayCallable(modelCatalog.getProviderModelEntry('opencode-go', 'longcat-2.0')));
    assert.ok(modelCatalog.isOpencodeGatewayCallable(modelCatalog.getProviderModelEntry('opencode-go', 'gpt-5.6-luna')));
    assert.ok(modelCatalog.isOpencodeGatewayCallable(modelCatalog.getProviderModelEntry('opencode-go', 'grok-4.6')));
    assert.ok(modelCatalog.isOpencodeGatewayCallable(modelCatalog.getProviderModelEntry('opencode-go', 'muse-spark-1.2-contributor')));
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-go', 'muse-spark-1.2-contributor'), 'always-on');
    assert.strictEqual(modelCatalog.getThinkingControl('opencode-go', 'gpt-5.6-luna'), 'responses-effort');
    assert.strictEqual(modelCatalog.resolveProviderEndpoint('opencode-go', '', { model: 'gpt-5.6-luna' }), modelCatalog.GO_RESPONSES_ENDPOINT);
    assert.strictEqual(modelCatalog.resolveProviderEndpoint('opencode-go', '', { model: 'glm-5.2' }), modelCatalog.GO_CHAT_ENDPOINT);
    assert.deepStrictEqual(modelCatalog.thinkingRequestPayload('responses-effort', false), { effort: 'none' });
    assert.strictEqual(modelCatalog.thinkingRequestPayload('responses-effort', true), null);
    var pickle = modelCatalog.getProviderModelEntry('opencode-zen', 'big-pickle');
    assert.ok(pickle, 'big-pickle should exist without a -free suffix');
    assert.strictEqual(pickle.pricingClass, 'free');
    assert.strictEqual(pickle.privacyClass, 'may-train');
    assert.strictEqual(modelCatalog.resolveProviderEndpoint('opencode-zen', 'https://evil.example/v1'), modelCatalog.ZEN_CHAT_ENDPOINT);
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('opencode-go'), true, 'opencode-go should be API-compatible');
    assert.strictEqual(modelCatalog.resolveProviderEndpoint('opencode-go', 'https://evil.example/v1'), modelCatalog.GO_CHAT_ENDPOINT);
    assert.strictEqual(modelCatalog.defaultTestModel('opencode-go', ''), 'glm-5.2');
    assert.ok(modelCatalog.getProviderModelEntry('opencode-go', 'glm-5.2'));

    var dsModels = modelCatalog.getProviderModels('deepseek');
    assert.ok(dsModels.length >= 3, 'deepseek should have models + custom option');
    assert.ok(dsModels.some(function (m) { return m.id === 'deepseek-v4-pro'; }), 'should have deepseek-v4-pro');
    assert.ok(dsModels.some(function (m) { return m.id === '__custom__'; }), 'should have custom option');

    // Test 9: Zen DeepSeek thinking uses official endpoint and reasoning_content.
    globalThis.fetch = async (url, init) => {
        assert.strictEqual(url, 'https://opencode.ai/zen/v1/chat/completions', 'Zen requests must use the official chat endpoint');
        var body = JSON.parse(init.body);
        assert.strictEqual(body.model, 'deepseek-v4-flash');
        assert.strictEqual(body.thinking.type, 'enabled');
        var encoder = new TextEncoder();
        var stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'think' } }] }) + '\n\n'));
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'answer' } }] }) + '\n\n'));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
        var zenTokens = [];
        var zenMeta = [];
        await providerStream.streamGeneration(
            { messages: [{ role: 'user', content: 'Zen thinking' }] },
            function (token, meta) { zenTokens.push(token); zenMeta.push(meta); },
            {
                mode: 'api',
                provider: 'opencode-zen',
                model: 'deepseek-v4-flash',
                enableThinking: true,
                endpoint: 'https://evil.example/chat/completions',
                apiKey: 'zen-key'
            }
        );
        assert.strictEqual(zenTokens[0], 'think');
        assert.strictEqual(zenMeta[0] && zenMeta[0].type, 'reasoning');
        assert.strictEqual(zenTokens[1], 'answer');
        assert.strictEqual(zenMeta[1] && zenMeta[1].type, 'content');
        console.log('Provider stream OpenCode Zen thinking test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    const converted = providerStream.toAnthropicMessages([
        { role: 'system', content: 'You are a writer.' },
        { role: 'user', content: 'Hello' },
        { role: 'user', content: 'Again' },
        { role: 'assistant', content: 'Hi' }
    ]);
    assert.strictEqual(converted.system, 'You are a writer.');
    assert.strictEqual(converted.messages.length, 2);
    assert.strictEqual(converted.messages[0].role, 'user');
    assert.ok(converted.messages[0].content.includes('Hello'));
    assert.ok(converted.messages[0].content.includes('Again'));

    globalThis.fetch = async (url, init) => {
        assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
        assert.strictEqual(init.headers['x-api-key'], 'sk-ant-test');
        assert.ok(!init.headers.Authorization);
        var body = JSON.parse(init.body);
        assert.strictEqual(body.model, 'claude-sonnet-4-6');
        assert.ok(body.max_tokens >= 1);
        assert.strictEqual(body.system, 'Stay literary.');
        assert.ok(!body.messages.some(function (item) { return item.role === 'system'; }));
        var encoder = new TextEncoder();
        var stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('event: ping\ndata: {"type":"ping"}\n\n'));
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Harbor' } }) + '\n\n'));
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) + '\n\n'));
                controller.close();
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
        var anthropicTokens = [];
        await providerStream.streamGeneration(
            { messages: [{ role: 'system', content: 'Stay literary.' }, { role: 'user', content: 'Write' }] },
            function (token) { if (token) anthropicTokens.push(token); },
            {
                mode: 'api',
                provider: 'anthropic',
                model: 'claude-sonnet-4-6',
                endpoint: 'https://api.anthropic.com/v1/messages',
                apiKey: 'sk-ant-test'
            }
        );
        assert.deepStrictEqual(anthropicTokens, ['Harbor']);
        console.log('Provider stream Anthropic Messages test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    globalThis.fetch = async (url, init) => {
        assert.ok(String(url).includes('generativelanguage.googleapis.com'));
        assert.ok(String(init.headers.Authorization).startsWith('Bearer '));
        var body = JSON.parse(init.body);
        assert.strictEqual(body.model, 'gemini-2.5-flash');
        assert.ok(!body.thinking);
        var encoder = new TextEncoder();
        var stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Gemini' } }] }) + '\n\n'));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
        var geminiTokens = [];
        await providerStream.streamGeneration(
            { messages: [{ role: 'user', content: 'Hi' }] },
            function (token) { if (token) geminiTokens.push(token); },
            {
                mode: 'api',
                provider: 'google',
                model: 'gemini-2.5-flash',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                apiKey: 'gem-key'
            }
        );
        assert.deepStrictEqual(geminiTokens, ['Gemini']);
        console.log('Provider stream Google OpenAI-compat test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.strictEqual(typeof providerStream.createInlineThinkSplitter, 'function', 'think splitter should be exported');
    (function () {
        const tokens = [];
        const types = [];
        const splitter = providerStream.createInlineThinkSplitter((token, meta) => {
            tokens.push(token);
            types.push(meta && meta.type);
        });
        splitter.push('<thi');
        splitter.push('nk>先想结尾');
        splitter.push('再写动作</think>\n她把门关上。');
        splitter.push(' 雨还在下。');
        splitter.finish();
        const reasoning = tokens.filter((_, index) => types[index] === 'reasoning').join('');
        const content = tokens.filter((_, index) => types[index] === 'content').join('');
        assert.strictEqual(reasoning, '先想结尾再写动作');
        assert.strictEqual(content, '\n她把门关上。 雨还在下。');
        assert.ok(!content.includes('先想'), 'MiniMax think blocks must not leak into content');
    })();
    (function () {
        const tokens = [];
        const types = [];
        const splitter = providerStream.createInlineThinkSplitter((token, meta) => {
            tokens.push(token);
            types.push(meta && meta.type);
        });
        splitter.push('温度低于 3 度，a < b 时她仍出门。');
        splitter.finish();
        assert.deepStrictEqual(types, ['content']);
        assert.strictEqual(tokens.join(''), '温度低于 3 度，a < b 时她仍出门。');
    })();

    function mockChatStream(inspect, chunks) {
        return async (url, init) => {
            var body = JSON.parse(init.body);
            inspect(body, url);
            var encoder = new TextEncoder();
            var stream = new ReadableStream({
                start(controller) {
                    (chunks || [
                        { choices: [{ delta: { content: 'ok' } }] },
                        { choices: [{ finish_reason: 'stop' }] }
                    ]).forEach((chunk) => {
                        controller.enqueue(encoder.encode('data: ' + JSON.stringify(chunk) + '\n\n'));
                    });
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            });
            return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
    }

    async function pingChat(config, inspect, chunks) {
        globalThis.fetch = mockChatStream(inspect, chunks);
        try {
            var tokens = [];
            var types = [];
            await providerStream.streamGeneration(
                { messages: [{ role: 'user', content: 'Continue' }] },
                function (token, meta) {
                    if (token) {
                        tokens.push(token);
                        types.push(meta && meta.type);
                    }
                },
                Object.assign({
                    mode: 'api',
                    endpoint: 'https://example.test/v1/chat/completions',
                    apiKey: 'test-key'
                }, config)
            );
            return { tokens: tokens, types: types };
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    globalThis.fetch = mockChatStream(function (body) {
        assert.strictEqual(body.model, 'minimax-m3');
        assert.strictEqual(body.thinking && body.thinking.type, 'disabled', 'MiniMax M3 off should send thinking.disabled');
    }, [
        { choices: [{ delta: { content: '<think>只在心里盘算。' } }] },
        { choices: [{ delta: { content: '</think>门口的灯灭了。' } }] },
        { choices: [{ finish_reason: 'stop' }] }
    ]);
    try {
        var miniTokens = [];
        var miniMeta = [];
        await providerStream.streamGeneration(
            { messages: [{ role: 'user', content: 'Continue' }] },
            function (token, meta) {
                if (token) {
                    miniTokens.push(token);
                    miniMeta.push(meta && meta.type);
                }
            },
            {
                mode: 'api',
                provider: 'openai-compatible',
                model: 'minimax-m3',
                endpoint: 'https://example.test/v1/chat/completions',
                apiKey: 'test-key'
            }
        );
        var miniReasoning = miniTokens.filter((_, index) => miniMeta[index] === 'reasoning').join('');
        var miniContent = miniTokens.filter((_, index) => miniMeta[index] === 'content').join('');
        assert.strictEqual(miniReasoning, '只在心里盘算。');
        assert.strictEqual(miniContent, '门口的灯灭了。');
        console.log('Provider stream MiniMax inline think test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    await pingChat({ provider: 'opencode-go', model: 'minimax-m3', enableThinking: true }, function (body) {
        assert.strictEqual(body.thinking && body.thinking.type, 'adaptive', 'MiniMax M3 on should send thinking.adaptive, not enabled');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'temperature'), 'thinking MiniMax should not send temperature');
    });
    await pingChat({ provider: 'opencode-go', model: 'kimi-k2.6', enableThinking: true }, function (body) {
        assert.strictEqual(body.thinking && body.thinking.type, 'enabled');
    });
    await pingChat({ provider: 'opencode-go', model: 'kimi-k2.6', enableThinking: false }, function (body) {
        assert.strictEqual(body.thinking && body.thinking.type, 'disabled');
        assert.strictEqual(body.temperature, 0.8, 'non-thinking Kimi should still send temperature');
    });
    await pingChat({ provider: 'opencode-go', model: 'kimi-k2.7-code', enableThinking: false }, function (body) {
        assert.ok(!body.thinking, 'Kimi K2.7 Code must not receive thinking.disabled');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'temperature'), 'always-on thinking should still drop temperature');
    });
    await pingChat({ provider: 'opencode-go', model: 'glm-5.3', enableThinking: false }, function (body) {
        assert.ok(!body.thinking, 'GLM 5.3 must not receive a thinking control field');
    });
    await pingChat({ provider: 'opencode-zen', model: 'minimax-m2.7', enableThinking: true }, function (body) {
        assert.ok(!body.thinking, 'MiniMax M2.x must not receive a thinking control field');
    });
    console.log('Provider stream thinkingControl mapping tests passed.');

    var responsesConverted = providerStream.toResponsesInput([
        { role: 'system', content: 'Keep answers short.' },
        { role: 'user', content: 'Hi' }
    ]);
    assert.strictEqual(responsesConverted.instructions, 'Keep answers short.');
    assert.strictEqual(responsesConverted.input[0].role, 'user');

    globalThis.fetch = async (url, init) => {
        assert.strictEqual(url, 'https://opencode.ai/zen/go/v1/responses');
        var body = JSON.parse(init.body);
        assert.strictEqual(body.model, 'gpt-5.6-luna');
        assert.ok(Array.isArray(body.input), 'Responses request should use input, not messages');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'messages'));
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'thinking'));
        assert.strictEqual(body.reasoning.effort, 'none');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'temperature'), 'GPT Responses should not send temperature');
        var encoder = new TextEncoder();
        var stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('event: response.reasoning_summary_text.delta\ndata: ' + JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'add first' }) + '\n\n'));
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '323' }) + '\n\n'));
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 } } }) + '\n\n'));
                controller.close();
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
        var respTokens = [];
        var respMeta = [];
        await providerStream.streamGeneration(
            { messages: [{ role: 'user', content: 'Compute 17*19' }] },
            function (token, meta) {
                if (token) {
                    respTokens.push(token);
                    respMeta.push(meta && meta.type);
                } else if (meta) {
                    respMeta.push(meta.type);
                }
            },
            {
                mode: 'api',
                provider: 'opencode-go',
                model: 'gpt-5.6-luna',
                enableThinking: false,
                endpoint: 'https://evil.example/v1/chat/completions',
                apiKey: 'go-key'
            }
        );
        assert.strictEqual(respTokens[0], 'add first');
        assert.strictEqual(respMeta[0], 'reasoning');
        assert.strictEqual(respTokens[1], '323');
        assert.strictEqual(respMeta[1], 'content');
        console.log('Provider stream OpenCode Responses test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    console.log('Provider stream tests passed.');
})().catch((error) => {
    console.error('Provider stream tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
