const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');
const settingsService = require('../desktop/services/settings-service');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const { createCompendiumAgentRunnerService } = require('../desktop/services/compendium-agent-runner-service');
const { createCompendiumAgentService } = require('../desktop/services/compendium-agent-service');
const ModelCatalog = require('../src/core/settings/model-catalog');

const KEY = String(process.env.OPENCODE_API_KEY || process.env.OPENCODE_ZEN_API_KEY || '').trim();
const OUTPUT_PATH = path.join(__dirname, '..', '.ai_state', 'opencode-zen-real-provider-acceptance-20260814.json');
const MARKER = 'ZEN_OK';

function redact(value) {
  return String(value || '')
    .replace(KEY, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, '[redacted]');
}

function publicUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
    completionTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0)
  };
}

async function readSse(response) {
  const text = await response.text();
  return text.split(/\n/).map((line) => line.trim()).filter((line) => line.startsWith('data:')).map((line) => {
    try { return JSON.parse(line.slice(5).trim()); } catch (error) { return null; }
  }).filter(Boolean);
}

async function streamCall(baseUrl, label, payload) {
  const started = Date.now();
  let firstTokenMs = null;
  const response = await fetch(`${baseUrl}/api/generation/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const events = await readSse(response);
  const finished = Date.now();
  let content = '';
  let reasoning = '';
  let finishReason = '';
  let usage = null;
  let error = null;
  events.forEach((event) => {
    if (event.type === 'error') error = event.error || { message: 'stream error' };
    if (event.type === 'finish') finishReason = (event.meta && event.meta.finishReason) || event.finishReason || finishReason;
    if (event.type === 'usage') usage = (event.meta && event.meta.usage) || event.usage || usage;
    if (event.type === 'reasoning') {
      if (firstTokenMs == null) firstTokenMs = Date.now() - started;
      reasoning += event.token || '';
    }
    if (event.type === 'content') {
      if (firstTokenMs == null) firstTokenMs = Date.now() - started;
      content += event.token || '';
    }
  });
  const serialized = JSON.stringify({ events, content, reasoning, error });
  assert.ok(!KEY || !serialized.includes(KEY), `${label} stream output must not contain the API key`);
  return {
    label,
    model: payload.model,
    taskKind: payload.taskKind || '',
    thinking: !!payload.enableThinking,
    httpStatus: response.status,
    ok: response.ok && !error && content.trim().length > 0,
    firstTokenMs,
    durationMs: finished - started,
    contentCharacters: content.length,
    reasoningCharacters: reasoning.length,
    finishReason,
    usage: publicUsage(usage),
    complete: content.includes(MARKER),
    error: error ? redact(error.message || error.code || 'error') : '',
    errorCode: error && error.code ? String(error.code) : ''
  };
}

(async () => {
  if (!KEY) {
    console.error('OPENCODE_API_KEY is required for real Zen acceptance. The key was not found in the environment.');
    process.exit(2);
  }

  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-zen-real-'));
  let servers = null;
  const startedAt = new Date().toISOString();
  const calls = [];

  try {
    const zenProfileId = 'zen-real-acceptance';
    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-zen',
        apiKey: KEY,
        model: 'deepseek-v4-flash'
      },
      providerProfiles: [{
        id: zenProfileId,
        name: 'OpenCode Zen acceptance',
        provider: 'opencode-zen',
        apiKey: KEY,
        model: 'glm-5.2'
      }],
      workflowGeneration: { providerProfileId: zenProfileId },
      compendiumAgent: {
        enabled: true,
        providerProfileId: zenProfileId,
        model: 'kimi-k2.6',
        maxCardsPerRun: 2
      },
      modelCatalogPreferences: {
        hidePrivacyRiskModels: false,
        acknowledgedPrivacyModels: ['big-pickle', 'deepseek-v4-flash-free', 'mimo-v2.5-free']
      }
    });

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async () => ''
    });

    const publicSettings = await (await fetch(`${servers.appUrl}/api/settings`)).json();
    assert.ok(publicSettings.ok, 'settings API should load');
    assert.strictEqual(publicSettings.runtimeProvider.apiKey, '', 'public settings must not return the key');
    assert.ok(!JSON.stringify(publicSettings).includes(KEY), 'settings JSON must not contain the key');

    const liveTest = await (await fetch(`${servers.appUrl}/api/settings/test-provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ live: true })
    })).json();
    assert.ok(liveTest.ok, `live connection test failed: ${redact(liveTest.result && liveTest.result.error)}`);

    const catalogRefresh = await (await fetch(`${servers.appUrl}/api/settings/refresh-model-catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'opencode-zen' })
    })).json();
    const catalog = catalogRefresh.catalog || { models: [] };
    const onlineIds = new Set((catalog.models || []).filter((item) => item.availability !== 'offline').map((item) => item.id));
    const pickOnline = (candidates) => candidates.find((id) => onlineIds.has(id)) || candidates[0];
    const freeModel = pickOnline(['big-pickle', 'deepseek-v4-flash-free', 'mimo-v2.5-free']);
    const paidAlt = pickOnline(['minimax-m3', 'glm-5.2', 'kimi-k2.6', 'kimi-k3']);

    const ping = (model, extras = {}) => streamCall(servers.appUrl, extras.label || model, {
      model,
      enableThinking: !!extras.enableThinking,
      confirmPrivacyRisk: !!extras.confirmPrivacyRisk,
      includeUsage: true,
      temperature: 0.1,
      maxTokens: extras.maxTokens || 80,
      useProviderDefaults: false,
      taskKind: extras.taskKind || 'writer-prose',
      snapshot: extras.snapshot,
      prompt: {
        messages: [
          { role: 'system', content: 'This is a connectivity test. Reply with only the requested marker. Do not include secrets.' },
          { role: 'user', content: extras.user || `Reply with exactly ${MARKER} and nothing else.` }
        ]
      }
    });

    const flashPlain = await ping('deepseek-v4-flash', { label: 'writer-flash-no-thinking', enableThinking: false, taskKind: 'writer-prose' });
    assert.ok(flashPlain.ok, `DeepSeek V4 Flash failed: ${flashPlain.error}`);
    assert.strictEqual(flashPlain.reasoningCharacters, 0, 'non-thinking Flash should not emit reasoning');
    calls.push(flashPlain);

    const flashThink = await ping('deepseek-v4-flash', { label: 'writer-flash-thinking', enableThinking: true, taskKind: 'writer-prose', maxTokens: 200 });
    assert.ok(flashThink.ok, `DeepSeek V4 Flash thinking failed: ${flashThink.error}`);
    assert.ok(flashThink.reasoningCharacters > 0, 'thinking Flash should emit reasoning_content separately');
    assert.ok(flashThink.contentCharacters > 0, 'thinking Flash should still emit content');
    calls.push(flashThink);

    const paid = await ping(paidAlt, { label: `writer-paid-${paidAlt}`, enableThinking: false, taskKind: 'writer-prose' });
    assert.ok(paid.ok, `paid model ${paidAlt} failed: ${paid.error}`);
    calls.push(paid);

    const free = await ping(freeModel, {
      label: `writer-free-${freeModel}`,
      enableThinking: false,
      confirmPrivacyRisk: true,
      taskKind: 'writer-prose',
      user: `This is a non-sensitive connectivity test. Reply with exactly ${MARKER}.`
    });
    assert.ok(free.ok, `free model ${freeModel} failed: ${free.error}`);
    calls.push(free);

    const rejected = await streamCall(servers.appUrl, 'privacy-reject-path', {
      model: freeModel,
      confirmPrivacyRisk: false,
      includeUsage: true,
      taskKind: 'writer-prose',
      prompt: { messages: [{ role: 'user', content: 'should not send' }] }
    });
    assert.ok(!rejected.ok, 'unconfirmed free/privacy model must not generate');
    assert.strictEqual(rejected.errorCode, 'privacy_confirmation_required');
    calls.push(rejected);

    const workflow = await ping(paidAlt, {
      label: 'workflow-frozen-model',
      taskKind: 'workflow-draft',
      snapshot: {
        source: 'workflow-profile',
        profileId: zenProfileId,
        provider: 'opencode-zen',
        model: paidAlt,
        enableThinking: false
      }
    });
    assert.ok(workflow.ok, `workflow loop failed: ${workflow.error}`);
    calls.push(workflow);

    const project = await projectService.createProject(dataRoot, {
      id: 'zen-real-acceptance',
      title: 'Zen real acceptance'
    });
    await compendiumService.saveEntry(dataRoot, project.project.id, {
      id: 'zen-card',
      type: 'character',
      title: 'Harbor Clerk',
      summary: '',
      tags: [],
      body: 'A clerk who records tide times. Used only for a connectivity test.'
    });
    const agentService = createCompendiumAgentService({ projectService, compendiumService });
    const runner = createCompendiumAgentRunnerService({ settingsService, compendiumAgentService: agentService });
    const agentStarted = Date.now();
    const agent = await runner.analyze(dataRoot, project.project.id, ['zen-card']);
    calls.push({
      label: 'compendium-agent',
      model: agent.provider && agent.provider.model,
      taskKind: 'compendium-agent',
      thinking: false,
      httpStatus: 200,
      ok: !!agent.ok,
      firstTokenMs: null,
      durationMs: Date.now() - agentStarted,
      contentCharacters: JSON.stringify(agent.findings || []).length,
      reasoningCharacters: 0,
      finishReason: 'agent',
      usage: null,
      complete: Array.isArray(agent.findings),
      error: '',
      errorCode: ''
    });
    assert.ok(agent.ok, 'compendium agent loop failed');
    assert.strictEqual(agent.provider.provider, 'opencode-zen');

    const metrics = {
      schemaVersion: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      endpoint: ModelCatalog.ZEN_CHAT_ENDPOINT,
      transport: 'chat-completions',
      liveConnection: {
        ok: !!liveTest.ok,
        statusCode: liveTest.result && liveTest.result.statusCode,
        checked: liveTest.result && liveTest.result.checked
      },
      catalog: {
        ok: !!catalogRefresh.ok,
        source: catalog.source || '',
        fetchedAt: catalog.fetchedAt || '',
        modelCount: (catalog.models || []).length,
        refreshFailed: !!catalog.refreshFailed,
        lastError: redact(catalog.lastError || '')
      },
      selected: {
        thinkingModel: 'deepseek-v4-flash',
        paidModel: paidAlt,
        freeModel
      },
      calls,
      security: {
        keyRecorded: false,
        publicSettingsHasKey: false
      }
    };
    const serialized = JSON.stringify(metrics);
    assert.ok(!serialized.includes(KEY), 'metrics file must not contain the API key');
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, `${serialized}\n`, 'utf8');
    console.log(`OpenCode Zen real acceptance passed: ${calls.map((item) => `${item.label}/${item.httpStatus}/${item.durationMs}ms`).join(', ')}`);
  } finally {
    if (servers && typeof servers.close === 'function') servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('OpenCode Zen real acceptance failed:', redact(error && error.stack ? error.stack : error));
  process.exit(1);
});
