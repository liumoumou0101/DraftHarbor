const assert = require('assert');
const ProviderStream = require('../src/core/generation/provider-stream');

const cases = [];
const test = (name, run) => cases.push({ name, run });
const messages = [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Reply OK.' }];
const base = { mode: 'api', provider: 'opencode-go', apiKey: 'fixture-key', sessionId: 'fixture-session', maxTokens: 1500, activityTimeouts: false };
const configFor = (transport) => ({ ...base, model: transport === 'anthropic-messages' ? 'minimax-m3' : transport === 'responses' ? 'gpt-5.6-luna' : 'hy4-preview' });
const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const payloadFor = (transport) => transport === 'anthropic-messages'
    ? { content: [{ type: 'thinking', thinking: 'Check.' }, { type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } }
    : transport === 'responses'
        ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }], usage: { input_tokens: 3, output_tokens: 2 } }
        : { choices: [{ message: { content: 'OK', reasoning: 'Check.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } };

async function capture(response, config) {
    const original = globalThis.fetch;
    const events = [];
    globalThis.fetch = async () => response;
    try {
        await ProviderStream.streamGeneration({ messages }, (token, meta) => events.push({ token, ...meta }), config);
        return events;
    } finally { globalThis.fetch = original; }
}

test('common builder uses the same model protocol, headers and fields in both modes', () => {
    for (const transport of ['chat-completions', 'anthropic-messages', 'responses']) {
        const config = { ...configFor(transport), enableThinking: false };
        const streamed = ProviderStream.buildProviderRequest(messages, config);
        const direct = ProviderStream.buildProviderRequest(messages, config, { stream: false });
        assert.strictEqual(streamed.transport, transport);
        assert.deepStrictEqual({ ...streamed.body, stream: false }, direct.body);
        assert.deepStrictEqual(streamed.headers, direct.headers);
        assert.strictEqual(streamed.endpoint, direct.endpoint);
        if (transport === 'anthropic-messages') {
            assert.match(direct.endpoint, /\/messages$/);
            assert.strictEqual(direct.headers['x-api-key'], 'fixture-key');
            assert.strictEqual(direct.headers.Authorization, undefined);
            assert.deepStrictEqual(direct.body.thinking, { type: 'disabled' });
            assert.strictEqual(direct.body.system, 'Be brief.');
        } else if (transport === 'responses') {
            assert.strictEqual(direct.body.messages, undefined);
            assert.strictEqual(direct.body.max_tokens, undefined);
            assert.ok(direct.body.input);
            assert.strictEqual(direct.body.max_output_tokens, 1500);
        } else assert.strictEqual(direct.body.reasoning_effort, 'none');
    }
});

test('Qwen thinking budget fits the Messages output limit and usage flags are streaming only', () => {
    const config = { ...base, model: 'qwen3.8-flash', enableThinking: true, maxTokens: 300, includeUsage: true };
    const { body } = ProviderStream.buildProviderRequest(messages, config);
    assert.deepStrictEqual(body.thinking, { type: 'enabled', budget_tokens: 1024 });
    assert.ok(body.max_tokens > body.thinking.budget_tokens);
    assert.strictEqual(body.temperature, undefined);
    const direct = ProviderStream.buildProviderRequest(messages, { ...base, model: 'hy3', includeUsage: true }, { stream: false });
    assert.strictEqual(direct.body.stream_options, undefined);
});

test('shared builder retains implicit thinking on legacy DeepSeek aliases', () => {
    const { body } = ProviderStream.buildProviderRequest(messages, { provider: 'deepseek', model: 'deepseek-reasoner' });
    assert.strictEqual(body.model, 'deepseek-v4-flash');
    assert.deepStrictEqual(body.thinking, { type: 'enabled' });
    assert.strictEqual(body.temperature, undefined);
});

test('Chat reasoning alias is separated without duplicating reasoning_content', async () => {
    const wire = event({ choices: [{ delta: { reasoning: 'Think.' } }] })
        + event({ choices: [{ delta: { reasoning_content: 'Once.', reasoning: 'Once.' } }] })
        + event({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] });
    const events = await capture(new Response(wire, { headers: { 'content-type': 'text/event-stream' } }), configFor('chat-completions'));
    assert.strictEqual(events.filter((e) => e.type === 'reasoning').map((e) => e.token).join(''), 'Think.Once.');
    assert.strictEqual(events.filter((e) => e.type === 'content').map((e) => e.token).join(''), 'OK');
});

for (const transport of ['chat-completions', 'anthropic-messages', 'responses']) {
    test(`${transport} accepts HTTP 200 JSON even when Response has a stream reader`, async () => {
        const events = await capture(Response.json(payloadFor(transport)), configFor(transport));
        assert.strictEqual(events.filter((e) => e.type === 'content').map((e) => e.token).join(''), 'OK');
        assert.ok(events.some((e) => e.type === 'finish' && e.finishReason === 'stop'));
        if (transport === 'responses') assert.strictEqual(events.find((e) => e.type === 'usage').usage.total_tokens, 5);
    });
    test(`${transport} parses multiline SSE across CRLF byte boundaries`, async () => {
        const payload = transport === 'chat-completions'
            ? { choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }
            : transport === 'anthropic-messages'
                ? { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } }
                : { type: 'response.completed', response: payloadFor(transport) };
        let wire = ': heartbeat\r\nevent: message\r\n' + JSON.stringify(payload, null, 2).split('\n').map((line) => `data: ${line}\r\n`).join('') + '\r\n';
        if (transport === 'anthropic-messages') wire += event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
        const bytes = new TextEncoder().encode(wire);
        const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
        const events = await capture(response, configFor(transport));
        assert.strictEqual(events.filter((e) => e.type === 'content').map((e) => e.token).join(''), 'OK');
    });
}

test('Messages retains input usage from message_start and final output usage', async () => {
    const wire = event({ type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 0 } } })
        + event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } })
        + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } });
    const events = await capture(new Response(wire), configFor('anthropic-messages'));
    assert.deepStrictEqual(events.filter((e) => e.type === 'usage').at(-1).usage, { input_tokens: 7, output_tokens: 2 });
});

test('Responses failure retains nested provider error details in SSE and JSON', async () => {
    const failure = { status: 'failed', error: { code: 'model_unavailable', message: 'Model is unavailable in this region.' } };
    for (const response of [Response.json(failure), new Response(event({ type: 'response.failed', response: failure }))]) {
        await assert.rejects(capture(response, configFor('responses')), (error) => error.message.includes('unavailable in this region') && error.providerType === 'model_unavailable');
    }
});

test('truncated SSE and reasoning-only output cannot count as completed content', async () => {
    await assert.rejects(capture(new Response(event({ choices: [{ delta: { content: 'partial' } }] })), configFor('chat-completions')), { code: 'provider_stream_incomplete' });
    await assert.rejects(capture(new Response(event({ choices: [{ delta: { reasoning: 'Still thinking.' }, finish_reason: 'stop' }] })), configFor('chat-completions')), { code: 'provider_empty_response' });
});

test('upstream error details never echo the configured key', async () => {
    await assert.rejects(capture(Response.json({ error: { message: 'Unsupported thinking for credential fixture-key.' } }, { status: 400 }), configFor('chat-completions')),
        (error) => error.message.includes('Unsupported thinking') && !error.message.includes('fixture-key') && !error.stack.includes('fixture-key'));
});

(async () => {
    let failures = 0;
    for (const item of cases) {
        try { await item.run(); console.log(`PASS ${item.name}`); }
        catch (error) { failures++; console.error(`FAIL ${item.name}: ${error.message}`); }
    }
    assert.strictEqual(failures, 0, `${failures}/${cases.length} provider compatibility regressions failed`);
    console.log(`OpenCode provider compatibility: ${cases.length} passed.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
