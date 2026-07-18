const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');

const settingsService = require('../desktop/services/settings-service');
const ProviderStream = require('../src/core/generation/provider-stream');

const DATA_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(DATA_ROOT, '.ai_state', 'workflow-provider-canary-20260715.json');

async function call(label, config, expected) {
  const started = Date.now();
  let content = '';
  let reasoningCharacters = 0;
  let usage = null;
  await ProviderStream.streamGeneration({ messages: [
    { role: 'system', content: '这是发布前在线连通性测试。严格按用户要求返回，不要解释。' },
    { role: 'user', content: `只返回字符串 ${expected}` }
  ] }, (token, meta) => {
    if (meta?.type === 'usage') usage = meta.usage;
    else if (meta?.type === 'reasoning') reasoningCharacters += String(token || '').length;
    else content += String(token || '');
  }, { ...config, includeUsage: true, maxTokens: 160 });
  assert.ok(content.includes(expected), `${label} did not return the expected canary marker`);
  return {
    label,
    model: config.model,
    thinking: config.enableThinking === true,
    durationMs: Date.now() - started,
    contentCharacters: content.length,
    reasoningCharacters,
    usage: usage ? {
      promptTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
      completionTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0)
    } : null
  };
}

(async () => {
  const settings = await settingsService.readSettings(DATA_ROOT);
  const flashProfile = (settings.providerProfiles || []).find((profile) => profile.model === 'deepseek-v4-flash');
  const flash = settingsService.runtimeProviderConfig(settings, { profileId: flashProfile?.id, model: 'deepseek-v4-flash', useProviderDefaults: false, temperature: 0.1 });
  const pro = settingsService.runtimeProviderConfig(settings, { model: 'deepseek-v4-pro', useProviderDefaults: false, temperature: 0.1 });
  if (!flash.apiKey || !flash.endpoint) throw new Error('DeepSeek V4 Flash provider is not configured');
  if (!pro.apiKey || !pro.endpoint) throw new Error('DeepSeek V4 Pro provider is not configured');

  const metrics = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    calls: [
      await call('flash-stream-canary', { ...flash, enableThinking: false }, 'CANARY_FLASH_OK'),
      await call('pro-thinking-canary', { ...pro, enableThinking: true }, 'CANARY_PRO_OK')
    ]
  };
  metrics.completedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`Workflow real Provider canary passed: ${metrics.calls.map((item) => `${item.model}/${item.durationMs}ms`).join(', ')}`);
})().catch((error) => {
  console.error('Workflow real Provider canary failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
