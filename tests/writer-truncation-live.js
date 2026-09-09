// Opt-in paid canary; no real manuscripts or settings are changed.
// node tests/writer-truncation-live.js --paid
const assert = require('assert');
const Settings = require('../desktop/services/settings-service');
const Schema = require('../src/core/settings/settings-schema');
const Bridge = require('../desktop/services/generation-bridge-service');
const Desktop = require('../src/core/generation/desktop-generation-client');
const Runner = require('../src/core/generation/ai-task-runner');

(async () => {
    if (!process.argv.includes('--paid')) throw new Error('Pass --paid to authorize the live canary.');
    const stored = await Settings.readSettings(require('path').resolve(__dirname, '..'));
    const profiles = stored.providerProfiles || [];
    const profile = profiles.find(p => p.provider === 'opencode-go' && p.apiKey) || stored.providerSettings;
    const key = process.env.OPENCODE_GO_API_KEY || process.env.OPENCODE_API_KEY || (profile && profile.provider === 'opencode-go' && profile.apiKey);
    assert.ok(key, 'OpenCode Go key is unavailable');
    const model = 'minimax-m3';
    const settings = Schema.normalizeDesktopSettings({ providerSettings: { mode: 'api', provider: 'opencode-go', apiKey: key, model } });
    const originalFetch = global.fetch;
    // Exercise the desktop client and production bridge without changing stored settings.
    global.fetch = async (url, init) => url === '/api/generation/stream'
        ? Promise.resolve(Bridge.createFetchStreamResponse(settings, JSON.parse(init.body), init.signal))
        : originalFetch(url, init).then(async response => {
            if (!response.ok) console.log('Provider diagnostic:', (await response.clone().text()).split(key).join('[redacted]').replace(/sk-[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 400));
            return response;
        });
    const runner = Runner.createAITaskRunner({ streamGeneration: Desktop.streamGeneration });
    try {
        for (const maxTokens of [128, Schema.thinkingOutputQuota(8000, true, model).effective]) {
            console.log(JSON.stringify({ phase: 'start', model, maxTokens }));
            const started = Date.now();
            const result = await runner.run({ projectId: 'canary', domain: 'prose', action: 'rewrite', target: { type: 'scene', sceneId: 'canary' }, scope: 'selection', instruction: '小说改写测试', outputContract: 'text' }, {
                providerConfig: { mode: 'api', provider: 'opencode-go', model, enableThinking: true, maxTokens, useProviderDefaults: false, includeUsage: true, signal: AbortSignal.timeout(180000), firstResponseTimeoutMs: 90000, idleTimeoutMs: 60000 },
                prompt: { messages: [
                    { role: 'system', content: '你是中文小说编辑。只输出完整正文，不要标题或说明。' },
                    { role: 'user', content: '将以下原文扩写成约600字的悬疑小说片段，有动作、对白、环境细节，保留事实与第三人称视角，收束到完整句子：雨落在码头。林舟遇见一个拿着信封的陌生人。陌生人说，这是林舟失踪七年的父亲托他带来的。信封上写着明天的日期。林舟没有拆信，而是问他从哪里来。' }
                ] }
            });
            console.log(JSON.stringify({ model, maxTokens, ok: result.ok, code: result.error && result.error.code, finishReason: result.finishReason, contentCharacters: result.text.length, reasoningCharacters: result.reasoning.length, usage: result.usage, elapsedMs: Date.now() - started, endsWithPunctuation: /[。！？…」”]$/.test(result.text.trim()) }));
            if (result.error) console.log(String(result.error.message || '').split(key).join('[redacted]').replace(/sk-[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 240));
            if (maxTokens === 128) {
                assert.strictEqual(result.ok, false, 'Low-budget result must not be reported as completed');
                assert.strictEqual(result.finishReason, 'length');
            } else {
                assert.strictEqual(result.ok, true, 'Normal-budget rewrite should finish');
                assert.ok(result.text.length > 100);
                assert.strictEqual(result.finishReason, 'stop');
            }
        }
    } finally { global.fetch = originalFetch; }
})().catch(e => { console.error('Live canary failed:', e.code || e.name); process.exitCode = 1; });
