/**
 * Live OpenCode Go smoke for thinkingControl.
 * Reads the local DraftHarbor key, never prints it, and is not part of npm test.
 *
 * Usage: node tests/opencode-go-thinking-smoke.js --live
 */
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');
const settingsService = require('../desktop/services/settings-service');
const ModelCatalog = require('../src/core/settings/model-catalog');

const OUTPUT_PATH = path.join(__dirname, '..', '.ai_state', 'opencode-go-thinking-smoke.json');
const GO_MODELS_URL = 'https://opencode.ai/zen/go/v1/models';
const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';

function redact(value, key) {
  const text = String(value || '');
  return (key ? text.split(key).join('[redacted]') : text)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, '[redacted]');
}

async function readLocalGoKey() {
  const fromEnv = String(process.env.OPENCODE_API_KEY || process.env.OPENCODE_GO_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const settings = await settingsService.readSettings(path.resolve(__dirname, '..'));
  const profiles = Array.isArray(settings.providerProfiles) ? settings.providerProfiles : [];
  const goProfile = profiles.find((item) => item && item.provider === 'opencode-go' && item.apiKey);
  const fallback = settings.providerSettings && settings.providerSettings.provider === 'opencode-go'
    ? settings.providerSettings.apiKey
    : '';
  return String((goProfile && goProfile.apiKey) || fallback || '').trim();
}

async function fetchModelIds(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload.data) ? payload.data : (Array.isArray(payload.models) ? payload.models : []));
  return rows.map((row) => String((row && (row.id || row.model || row)) || '').trim()).filter(Boolean);
}

async function readSse(response) {
  const text = await response.text();
  return text.split(/\r\n\r\n|\n\n|\r\r/).map((event) => event.split(/\r?\n/)
    .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'))
    .filter((data) => data && data !== '[DONE]').map((data) => JSON.parse(data));
}

function evaluateGeneration(response, events) {
  let content = '';
  let reasoning = '';
  let finishReason = '';
  let done = false;
  const failures = [];
  if (!response.ok) failures.push(`HTTP ${response.status}`);
  for (const event of events) {
    if (event.type === 'error') failures.push(String(event.error && (event.error.message || event.error.code) || 'stream error'));
    if (event.type === 'finish') {
      finishReason = event.meta && event.meta.finishReason || '';
      if (!['stop', 'end_turn', 'stop_sequence'].includes(finishReason)) failures.push(`Unsuccessful finish: ${finishReason || 'missing'}`);
    }
    if (event.type === 'done') done = true;
    if (event.type === 'reasoning') reasoning += event.token || '';
    if (event.type === 'content') content += event.token || '';
  }
  if (!content.trim()) failures.push('No answer content');
  if (!finishReason) failures.push('Missing provider finish');
  if (!done) failures.push('Missing generation done');
  return { ok: failures.length === 0, content, reasoning, finishReason, done, error: failures.join('; ') };
}

function assertSmokeCalls(calls) {
  assert.ok(calls.length > 0, 'No smoke calls completed');
  const failed = calls.filter((row) => !row.ok);
  assert.strictEqual(failed.length, 0, failed.map((row) => `${row.label}: ${row.error || 'generation failed'}`).join('\n'));
}

function catalogGap(provider, liveIds) {
  const builtin = new Set(ModelCatalog.getBuiltinProviderModels(provider).map((item) => item.id));
  const missingBuiltin = liveIds.filter((id) => !builtin.has(id));
  const thinking = liveIds.map((id) => ({
    id,
    inBuiltin: builtin.has(id),
    thinkingControl: ModelCatalog.getThinkingControl(provider, id),
    transportGuess: ModelCatalog.inferTransportFromModelId(id)
  }));
  return { missingBuiltin, thinking };
}

async function main() {
  const key = await readLocalGoKey();
  if (!key) {
    console.error('No OpenCode Go API key in local settings or OPENCODE_API_KEY.');
    process.exitCode = 2;
    return;
  }

  const [goIds, zenIds] = await Promise.all([
    fetchModelIds(GO_MODELS_URL),
    fetchModelIds(ZEN_MODELS_URL).catch(() => [])
  ]);
  const goGap = catalogGap('opencode-go', goIds);
  const zenGap = catalogGap('opencode-zen', zenIds);

  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-go-think-'));
  let servers = null;
  const calls = [];

  async function ping(model, extras = {}) {
    const started = Date.now();
    const response = await fetch(`${servers.appUrl}/api/generation/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        enableThinking: !!extras.enableThinking,
        includeUsage: true,
        temperature: 0.2,
        maxTokens: extras.maxTokens || (extras.enableThinking ? 800 : 240),
        useProviderDefaults: false,
        taskKind: 'writer-prose',
        confirmPrivacyRisk: true,
        firstResponseTimeoutMs: 90000,
        idleTimeoutMs: 60000,
        prompt: {
          messages: [
            { role: 'system', content: 'You are a connectivity probe. Keep the final answer short. Do not mention secrets.' },
            { role: 'user', content: extras.user || 'Compute 17 multiplied by 19. Put only the final number on the last line.' }
          ]
        }
      })
    });
    const events = await readSse(response);
    const result = evaluateGeneration(response, events);
    const { content, reasoning, finishReason } = result;
    const row = {
      label: extras.label || `${model}:${extras.enableThinking ? 'on' : 'off'}`,
      model,
      thinkingControl: ModelCatalog.getThinkingControl('opencode-go', model),
      enableThinking: !!extras.enableThinking,
      httpStatus: response.status,
      ok: result.ok,
      durationMs: Date.now() - started,
      contentCharacters: content.length,
      reasoningCharacters: reasoning.length,
      finishReason,
      done: result.done,
      error: redact(result.error, key),
      contentPreview: redact(content, key).replace(/\s+/g, ' ').trim().slice(0, 80),
      reasoningPreview: redact(reasoning, key).replace(/\s+/g, ' ').trim().slice(0, 80)
    };
    calls.push(row);
    console.log(`${row.label} control=${row.thinkingControl} http=${row.httpStatus} ok=${row.ok} reason=${row.reasoningCharacters} content=${row.contentCharacters} err=${row.error || '-'}`);
    return row;
  }

  try {
    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-go',
        apiKey: key,
        model: 'glm-5.2'
      },
      modelCatalogPreferences: { hidePrivacyRiskModels: false }
    });
    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async () => ''
    });

    await ping('glm-5.2', { enableThinking: true, label: 'glm-5.2-always-on', maxTokens: 1600 });
    const kimiOff = await ping('kimi-k2.6', { enableThinking: false, label: 'kimi-k2.6-off' });
    const alwaysOn = await ping('kimi-k2.7-code', { enableThinking: false, label: 'kimi-k2.7-code-forced-off', maxTokens: 1600 });
    const miniOff = await ping('minimax-m3', { enableThinking: false, label: 'minimax-m3-off' });
    await ping('minimax-m3', { enableThinking: true, label: 'minimax-m3-adaptive', maxTokens: 1600 });
    const mimoOff = await ping('mimo-v2.5-pro', { enableThinking: false, label: 'mimo-v2.5-pro-off' });

    const report = {
      startedAt: new Date().toISOString(),
      liveGoModels: goIds,
      liveZenModels: zenIds,
      goMissingFromBuiltin: goGap.missingBuiltin,
      zenMissingFromBuiltin: zenGap.missingBuiltin,
      goThinking: goGap.thinking,
      calls
    };
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    assertSmokeCalls(calls);
    assert.strictEqual(kimiOff.reasoningCharacters, 0, 'Kimi K2.6 with thinking off should not emit reasoning');
    assert.ok(alwaysOn.reasoningCharacters > 0, 'Kimi K2.7 Code should still think when the toggle is off');
    assert.strictEqual(miniOff.reasoningCharacters, 0, 'MiniMax M3 with thinking off should not emit reasoning');
    assert.strictEqual(mimoOff.reasoningCharacters, 0, 'MiMo V2.5 Pro with thinking off should not emit reasoning');

    console.log('OpenCode Go thinking smoke passed.');
    console.log(`Go live ${goIds.length} models; builtin missing ${goGap.missingBuiltin.length}: ${goGap.missingBuiltin.join(', ') || '(none)'}`);
    if (zenIds.length) {
      console.log(`Zen live ${zenIds.length} models; builtin missing ${zenGap.missingBuiltin.length}: ${zenGap.missingBuiltin.join(', ') || '(none)'}`);
    }
    console.log(`report: ${OUTPUT_PATH}`);
  } catch (error) {
    console.error('OpenCode Go thinking smoke failed:', redact(error && error.stack ? error.stack : error, key));
    try {
      await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
      await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({ error: redact(error.message || error, key), calls, goMissingFromBuiltin: goGap.missingBuiltin }, null, 2)}\n`);
    } catch (_) { /* keep original error */ }
    process.exitCode = 1;
  } finally {
    if (servers && servers.close) await servers.close();
  }
}

module.exports = { evaluateGeneration, assertSmokeCalls, redact };

if (require.main === module) {
  if (!process.argv.includes('--live')) {
    console.log('Live OpenCode Go smoke skipped. Run with --live to read the local key and call the provider.');
  } else {
    main().catch(() => {
      // Startup may fail before the key is available to the redactor.
      console.error('OpenCode Go thinking smoke failed during setup.');
      process.exitCode = 1;
    });
  }
}
