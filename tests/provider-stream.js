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
        assert.ok(!body.hasOwnProperty('temperature'), 'thinking mode should not send temperature');
        assert.ok(!body.hasOwnProperty('top_p'), 'thinking mode should not send top_p');
        assert.ok(!body.hasOwnProperty('presence_penalty'), 'thinking mode should not send presence_penalty');
        assert.ok(!body.hasOwnProperty('frequency_penalty'), 'thinking mode should not send frequency_penalty');

        var encoder = new TextEncoder();
        var chunkIndex = 0;
        var chunks = [
            { choices: [{ delta: { reasoning_content: 'Let me think about this...' } }] },
            { choices: [{ delta: { reasoning_content: ' more reasoning.' } }] },
            { choices: [{ delta: { content: 'Here is the answer.' } }] },
            { choices: [{ delta: { content: ' And more text.' } }] }
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

        console.log('Provider stream DeepSeek thinking test passed.');
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test 2: Non-DeepSeek OpenAI-compatible should NOT send thinking fields
    globalThis.fetch = async (url, init) => {
        var body = JSON.parse(init.body);
        assert.strictEqual(body.model, 'gpt-4o-mini', 'non-deepseek should use the specified model');
        assert.ok(!body.hasOwnProperty('thinking'), 'non-deepseek provider should NOT send thinking field');
        assert.ok(!body.hasOwnProperty('reasoning'), 'non-deepseek provider should NOT send reasoning field');
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

    // Test 3: active reasoning/content chunks renew the idle timeout.
    globalThis.fetch = async (url, init) => {
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
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('anthropic'), false, 'anthropic should not be API-compatible');
    assert.strictEqual(modelCatalog.isApiCompatibleProvider('google'), false, 'google should not be API-compatible');
    assert.strictEqual(modelCatalog.isThinkingSupported('deepseek', 'deepseek-v4-pro'), true);
    assert.strictEqual(modelCatalog.isThinkingSupported('openai', 'gpt-4o'), false, 'non-deepseek should not support thinking');

    var dsModels = modelCatalog.getProviderModels('deepseek');
    assert.ok(dsModels.length >= 3, 'deepseek should have models + custom option');
    assert.ok(dsModels.some(function (m) { return m.id === 'deepseek-v4-pro'; }), 'should have deepseek-v4-pro');
    assert.ok(dsModels.some(function (m) { return m.id === '__custom__'; }), 'should have custom option');

    console.log('Provider stream tests passed.');
})().catch((error) => {
    console.error('Provider stream tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
