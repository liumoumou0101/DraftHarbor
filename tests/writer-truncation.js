const assert = require('assert');
const Provider = require('../src/core/generation/provider-stream');
const Desktop = require('../src/core/generation/desktop-generation-client');
const Runner = require('../src/core/generation/ai-task-runner');
const Schema = require('../src/core/settings/settings-schema');
const History = require('../src/core/generation/ai-task-history');
const Catalog = require('../src/core/settings/model-catalog');
const prompt = { messages: [{ role: 'user', content: 'Write fiction.' }] };
const task = { projectId: 'test', domain: 'prose', action: 'rewrite', target: { type: 'scene', sceneId: 'test' }, scope: 'selection', instruction: 'Rewrite', outputContract: 'text' };
const config = { mode: 'api', provider: 'openai-compatible', model: 'mock', endpoint: 'http://mock.invalid/v1/chat/completions', activityTimeouts: false };
const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
function response(text) {
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }));
}
(async () => {
    const original = global.fetch;
    try {
        assert.strictEqual(Schema.thinkingOutputQuota(8000, true, 'minimax-m3').effective, 16384);
        assert.strictEqual(Schema.thinkingOutputQuota(8000, false, 'minimax-m3').effective, 8000);
        assert.strictEqual(Schema.thinkingOutputQuota(32000, true, 'mimo-v2.5').effective, 32000);
        const headers = Catalog.providerAuthHeaders('opencode-go', '', 'scene-a');
        assert.strictEqual(headers['x-opencode-session'], Catalog.providerAuthHeaders('opencode-go', '', 'scene-a')['x-opencode-session']);
        assert.notStrictEqual(headers['x-opencode-session'], Catalog.providerAuthHeaders('opencode-go', '', 'scene-b')['x-opencode-session']);
        assert.strictEqual(headers['User-Agent'], 'DraftHarbor/1.2.5');
        assert.ok(!Catalog.providerAuthHeaders('openai-compatible', '')['x-opencode-session']);
        const splitEvents = [];
        const splitter = Provider.createInlineThinkSplitter((token, meta) => splitEvents.push({ token, type: meta.type }));
        splitter.push('<think>analysis', { type: 'content' });
        splitter.push('', { type: 'usage', usage: { completion_tokens: 2 } });
        splitter.push(' continues</think>prose', { type: 'content' });
        splitter.finish();
        assert.strictEqual(splitEvents.filter(e => e.type === 'content').map(e => e.token).join(''), 'prose');
        const runner = Runner.createAITaskRunner({ streamGeneration: Provider.streamGeneration });
        global.fetch = async () => response(event({ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }], usage: { completion_tokens: 128 } }));
        const partial = await runner.run(task, { prompt, providerConfig: { ...config, maxTokens: 128 } });
        assert.strictEqual(partial.ok, false);
        assert.strictEqual(partial.error.code, 'provider_output_truncated');
        assert.strictEqual(partial.text, 'partial');
        assert.strictEqual(partial.record.finishReason, 'length');
        assert.strictEqual(partial.record.maxTokens, 128);
        assert.strictEqual(History.toLegacyGenerationRecord(partial.record).usage.completion_tokens, 128);
        global.fetch = async () => response(event({ choices: [{ delta: { reasoning_content: 'thinking' }, finish_reason: 'length' }] }));
        await assert.rejects(Provider.streamGeneration(prompt, () => {}, config), e => e.code === 'provider_output_truncated');
        global.fetch = async () => response(event({ choices: [{ delta: { content: 'partial' } }] }));
        await assert.rejects(Provider.streamGeneration(prompt, () => {}, config), e => e.code === 'provider_stream_incomplete');
        global.fetch = async () => response(event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }) + event({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }));
        const finishes = [];
        await Provider.streamGeneration(prompt, (t, m) => { if (m && m.type === 'finish') finishes.push(m); }, { ...config, provider: 'anthropic' });
        assert.strictEqual(finishes[0].finishReason, 'length');
        assert.strictEqual(finishes[0].rawFinishReason, 'max_tokens');
        global.fetch = async () => response(event({ content: 'partial', stop: true, stopped_limit: true }));
        await Provider.streamGeneration(prompt, (t, m) => { if (m && m.type === 'finish') finishes.push(m); }, { ...config, mode: 'local' });
        assert.strictEqual(finishes[1].finishReason, 'length');
        for (const reason of ['max_output_tokens', 'content_filter']) {
            global.fetch = async () => response(event({ type: 'response.output_text.delta', delta: 'partial' }) + event({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason }, usage: { output_tokens: 10, output_tokens_details: { reasoning_tokens: 8 } } } }));
            const result = await runner.run(task, { prompt, providerConfig: { ...config, provider: 'opencode-go', model: 'gpt-5.6-luna' } });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.finishReason, reason === 'max_output_tokens' ? 'length' : reason);
            assert.strictEqual(result.usage.completion_tokens_details.reasoning_tokens, 8);
        }
        global.fetch = async () => response(event({ choices: [{ delta: { content: 'partial' }, finish_reason: 'content_filter' }] }));
        await assert.rejects(Provider.streamGeneration(prompt, () => {}, config), e => e.code === 'provider_incomplete_response');
        global.fetch = async () => response(event({ type: 'content', token: 'prefix' }) + 'data: ' + JSON.stringify({ type: 'content', token: 'tail' }));
        let text = '';
        await assert.rejects(Desktop.streamGeneration(prompt, t => { text += t; }, config), e => e.code === 'provider_stream_incomplete');
        assert.strictEqual(text, 'prefixtail');
        global.fetch = async () => response(event({ type: 'content', token: 'complete' }) + 'data: {"type":"done"}');
        await Desktop.streamGeneration(prompt, () => {}, config);
        global.fetch = async () => response(event({ type: 'content', token: 'partial' }) + 'data: {broken}\n\n' + event({ type: 'done' }));
        await assert.rejects(Desktop.streamGeneration(prompt, () => {}, config), e => e.code === 'provider_stream_invalid');
        global.fetch = async () => response(event({ type: 'content', token: 'partial' }) + 'data: ' + JSON.stringify({ type: 'error', error: { code: 'test_error', message: 'interrupted' } }));
        await assert.rejects(Desktop.streamGeneration(prompt, () => {}, config), e => e.code === 'test_error');
        console.log('Writer truncation regression tests passed.');
    } finally { global.fetch = original; }
})().catch(e => { console.error(e); process.exitCode = 1; });
