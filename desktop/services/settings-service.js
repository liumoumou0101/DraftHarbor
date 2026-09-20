const path = require('path');
const http = require('http');
const https = require('https');
const settingsStore = require('../storage/settings-store');
const SettingsSchema = require('../../src/core/settings/settings-schema');

function projectSaveRoot(dataRoot, settings) {
  return (settings && settings.projectSaveLocation) || path.join(dataRoot, 'projects');
}

function backupRoot(dataRoot, settings) {
  return (settings && settings.backupLocation) || path.join(projectSaveRoot(dataRoot, settings), 'backups');
}

async function readSettings(dataRoot) {
  return settingsStore.readSettings(dataRoot);
}

async function writeSettings(dataRoot, settingsInput) {
  return settingsStore.writeSettings(dataRoot, settingsInput);
}

function incomingApiKey(source) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'apiKey')) return '';
  return String(source.apiKey || '').trim();
}

function resolveRetainedApiKey(currentBinding, nextBinding, incomingKey) {
  if (incomingKey) return incomingKey;
  if (currentBinding && currentBinding.apiKey && SettingsSchema.canRetainStoredApiKey(currentBinding, nextBinding)) {
    return currentBinding.apiKey;
  }
  return '';
}

async function updateSettings(dataRoot, patch = {}) {
  const current = await readSettings(dataRoot);
  const providerPatch = { ...(patch.providerSettings || {}) };
  const nextBinding = SettingsSchema.normalizeProviderSettings({
    ...current.providerSettings,
    ...providerPatch
  });
  providerPatch.apiKey = resolveRetainedApiKey(
    current.providerSettings,
    nextBinding,
    incomingApiKey(providerPatch)
  );
  let directiveStack = typeof SettingsSchema.mergeDirectiveStackSettings === 'function'
    ? SettingsSchema.mergeDirectiveStackSettings(current.directiveStack, patch.directiveStack || {})
    : { ...(current.directiveStack || {}), ...(patch.directiveStack || {}) };
  if (patch.globalPrompt && typeof patch.globalPrompt === 'object') {
    directiveStack = {
      ...directiveStack,
      userGlobal: {
        ...((directiveStack && directiveStack.userGlobal) || {}),
        ...(Object.prototype.hasOwnProperty.call(patch.globalPrompt, 'enabled')
          ? { enabled: !!patch.globalPrompt.enabled } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch.globalPrompt, 'content')
          ? { content: String(patch.globalPrompt.content || '') } : {})
      }
    };
  }
  return writeSettings(dataRoot, {
    ...current,
    ...patch,
    providerSettings: {
      ...current.providerSettings,
      ...providerPatch
    },
    providerProfiles: patch.providerProfiles !== undefined ? patch.providerProfiles : current.providerProfiles,
    generationDefaults: {
      ...current.generationDefaults,
      ...(patch.generationDefaults || {})
    },
    localModelSettings: {
      ...current.localModelSettings,
      ...(patch.localModelSettings || {})
    },
    compendiumAgent: {
      ...current.compendiumAgent,
      ...(patch.compendiumAgent || {})
    },
    workflowGeneration: {
      ...current.workflowGeneration,
      ...(patch.workflowGeneration || {})
    },
    modelCatalogPreferences: {
      ...(current.modelCatalogPreferences || {}),
      ...(patch.modelCatalogPreferences || {})
    },
    globalPrompt: {
      ...current.globalPrompt,
      ...(patch.globalPrompt || {})
    },
    directiveStack
  });
}

async function updateProviderProfile(dataRoot, profile) {
  const current = await readSettings(dataRoot);
  const profiles = [...(current.providerProfiles || [])];
  const normalized = SettingsSchema.normalizeProviderProfile(profile);
  const existing = profiles.find(function (p) { return p.id === normalized.id; });
  if (existing) {
    normalized.apiKey = resolveRetainedApiKey(existing, normalized, incomingApiKey(profile));
    normalized.hasApiKey = !!normalized.apiKey;
  }
  const idx = profiles.findIndex(function (p) { return p.id === normalized.id; });
  if (idx >= 0) {
    profiles[idx] = normalized;
  } else {
    profiles.push(normalized);
  }
  return writeSettings(dataRoot, { ...current, providerProfiles: profiles });
}

async function deleteProviderProfile(dataRoot, profileId) {
  const current = await readSettings(dataRoot);
  const profiles = (current.providerProfiles || []).filter(function (p) { return p.id !== profileId; });
  return writeSettings(dataRoot, { ...current, providerProfiles: profiles });
}

function publicSettings(settingsInput) {
  return SettingsSchema.publicSettings(settingsInput);
}

function runtimeProviderConfig(settingsInput, extras = {}) {
  return SettingsSchema.providerRuntimeConfig(settingsInput, extras);
}

function publicRuntimeProvider(settingsInput, extras = {}) {
  return SettingsSchema.publicRuntimeConfig(runtimeProviderConfig(settingsInput, extras));
}

function runtimeProviderProfiles(settingsInput) {
  return SettingsSchema.providerProfileRuntimeConfigs(settingsInput);
}

function sanitizeKey(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '').trim();
}

function sanitizeProviderMessage(value, secrets = []) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || /<\/?[a-z][\s\S]*>/i.test(text)) return '';
  const secretValues = (Array.isArray(secrets) ? secrets : [secrets]).map(sanitizeKey).filter(Boolean);
  if (secretValues.some((secret) => text.includes(secret))) return '';
  if (/\b(?:sk|pk|rk|key|token)-[a-z0-9._-]{8,}\b|(?:api[\s_-]?key|authorization|bearer|access[\s_-]?token|secret|password|credential)\s*(?:is\s*)?(?::|=)?\s*[a-z0-9._-]{6,}/i.test(text)) return '';
  return text.slice(0, 180);
}

function extractErrorDetails(raw, secrets = []) {
  const text = String(raw || '').trim();
  if (!text) return { message: '', type: '', code: '' };
  try {
    const parsed = JSON.parse(text);
    const source = parsed && parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed;
    const message = source && (source.message || source.detail)
      ? (source.message || source.detail)
      : (typeof parsed.error === 'string' ? parsed.error : '');
    return {
      message: sanitizeProviderMessage(message, secrets),
      type: String((source && source.type) || '').slice(0, 80),
      code: String((source && source.code) || '').slice(0, 80)
    };
  } catch (error) {
    return { message: sanitizeProviderMessage(text, secrets), type: '', code: '' };
  }
}

function resolveLiveTest(config) {
  const ProviderStream = require('../../src/core/generation/provider-stream');
  if (typeof ProviderStream.buildProviderRequest !== 'function') {
    throw new Error('Provider request builder is unavailable.');
  }
  const built = ProviderStream.buildProviderRequest(
    [{ role: 'user', content: 'Reply with OK.' }],
    { ...config, apiKey: sanitizeKey(config.apiKey), maxTokens: 1024, useProviderDefaults: false },
    { stream: false }
  );
  return {
    model: (built.body && built.body.model) || config.model || 'model-check',
    endpoint: built.endpoint,
    headers: built.headers,
    body: JSON.stringify(built.body || {}),
    transport: built.transport || 'chat-completions'
  };
}

function textFromContent(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map((item) => {
    if (typeof item === 'string') return item;
    return item && typeof item === 'object' ? String(item.text || item.output_text || '') : '';
  }).join('').trim();
}

function validateLiveResponse(raw, transport, secrets = []) {
  let payload;
  try {
    payload = JSON.parse(String(raw || ''));
  } catch (error) {
    return { ok: false, error: 'AI Provider 返回了无法解析的响应。' };
  }
  if (payload && payload.error) {
    const details = extractErrorDetails(raw, secrets);
    return { ok: false, error: details.message || 'AI Provider 返回了错误响应。' };
  }
  if (transport === 'responses') {
    const status = String(payload && payload.status || '').toLowerCase();
    if (status !== 'completed' || (payload && payload.incomplete_details)) {
      return { ok: false, error: status ? `AI Provider 未正常完成测试响应（${status}）。` : 'AI Provider 响应缺少完成状态。' };
    }
    let content = textFromContent(payload && payload.output_text);
    if (!content && Array.isArray(payload && payload.output)) {
      content = payload.output.filter((item) => item && item.type !== 'reasoning').map((item) => {
        if (item && item.type === 'message') return textFromContent(item.content);
        return item && item.type === 'output_text' ? String(item.text || '') : '';
      }).join('').trim();
    }
    return content
      ? { ok: true }
      : { ok: false, error: 'AI Provider 没有返回可见正文。' };
  }
  if (transport === 'anthropic-messages') {
    const stopReason = String(payload && payload.stop_reason || '').toLowerCase();
    const blocks = Array.isArray(payload && payload.content) ? payload.content : [];
    const hasNonTextResult = blocks.some((item) => item && (item.type === 'tool_use' || item.type === 'refusal'));
    if (!['end_turn', 'stop_sequence'].includes(stopReason) || hasNonTextResult) {
      return { ok: false, error: stopReason ? `AI Provider 未正常结束测试响应（${stopReason}）。` : 'AI Provider 响应缺少正常结束状态。' };
    }
    return textFromContent(blocks.filter((item) => !item || !item.type || item.type === 'text'))
      ? { ok: true }
      : { ok: false, error: 'AI Provider 没有返回可见正文。' };
  }
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const finishReason = String(choice && choice.finish_reason || '').toLowerCase();
  const message = choice && choice.message;
  const hasToolCall = !!(message && Array.isArray(message.tool_calls) && message.tool_calls.length);
  const hasRefusal = !!(message && (message.refusal || message.content_filter));
  if (!['stop', 'end_turn', 'stop_sequence'].includes(finishReason) || hasToolCall || hasRefusal) {
    return { ok: false, error: finishReason ? `AI Provider 未正常结束测试响应（${finishReason}）。` : 'AI Provider 响应缺少正常结束状态。' };
  }
  const content = textFromContent(message && message.content);
  return content
    ? { ok: true }
    : { ok: false, error: 'AI Provider 没有返回可见正文。' };
}

function requestUrl(url, { method = 'GET', headers = {}, body = '', timeoutMs = 2500, readBody = false } = {}) {
  const maxResponseBytes = 64 * 1024;
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const requestHeaders = body
      ? { ...headers, 'Content-Length': Buffer.byteLength(body, 'utf8') }
      : headers;
    const request = client.request(parsed, { method, headers: requestHeaders, timeout: timeoutMs }, (response) => {
      const retryAfter = response.headers && response.headers['retry-after'];
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (!readBody || size >= maxResponseBytes) return;
        const remaining = maxResponseBytes - size;
        const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        size += accepted.length;
        chunks.push(accepted);
      });
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        retryAfter: retryAfter || null,
        body: readBody ? Buffer.concat(chunks).toString('utf8') : ''
      }));
    });
    request.on('timeout', () => {
      request.destroy(new Error('Connection timed out'));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function testProvider(settingsInput, options = {}) {
  const settings = SettingsSchema.normalizeDesktopSettings(settingsInput);
  const config = runtimeProviderConfig(settings);
  const live = !!options.live;

  if (config.mode === 'local') {
    if (!config.endpoint) {
      return { ok: false, mode: 'local', error: 'Local endpoint is required.' };
    }
    if (!live) {
      return { ok: true, mode: 'local', checked: 'configuration', endpoint: config.endpoint };
    }
    try {
      const result = await requestUrl(config.endpoint.replace(/\/+$/, '/health'));
      return { ok: result.statusCode < 500, mode: 'local', endpoint: config.endpoint, statusCode: result.statusCode };
    } catch (error) {
      return { ok: false, mode: 'local', endpoint: config.endpoint, error: error.message };
    }
  }

  if (!config.endpoint) {
    return { ok: false, mode: 'api', provider: config.provider, error: 'API endpoint is required.' };
  }
  if (!sanitizeKey(config.apiKey)) {
    return { ok: false, mode: 'api', provider: config.provider, error: 'API key is required.' };
  }
  if (!live) {
    return { ok: true, mode: 'api', provider: config.provider, checked: 'configuration', endpoint: config.endpoint };
  }

  try {
    const liveTarget = resolveLiveTest({ ...config, apiKey: sanitizeKey(config.apiKey) });
    const model = liveTarget.model;
    const result = await requestUrl(liveTarget.endpoint, {
      method: 'POST',
      headers: liveTarget.headers,
      body: liveTarget.body,
      timeoutMs: 15000,
      readBody: true
    });
    const httpOk = result.statusCode >= 200 && result.statusCode < 300;
    const details = extractErrorDetails(result.body, [config.apiKey]);
    const classified = !httpOk ? require('./generation-bridge-service').classifyHttpStatus(result.statusCode, result.retryAfter, details) : null;
    const validation = httpOk ? validateLiveResponse(result.body, liveTarget.transport, [config.apiKey]) : { ok: false };
    const ok = httpOk && validation.ok;
    return {
      ok,
      mode: 'api',
      provider: config.provider,
      model,
      statusCode: result.statusCode,
      checked: 'live',
      error: !ok ? ((classified && classified.message) || validation.error || details.message || `HTTP ${result.statusCode}`) : undefined
    };
  } catch (error) {
    return { ok: false, mode: 'api', provider: config.provider, error: sanitizeProviderMessage(error.message, [config.apiKey]) || 'AI Provider 请求失败。' };
  }
}

async function testProviderProfile(dataRoot, profileId, options = {}) {
  if (!profileId || !String(profileId).trim()) {
    return { ok: false, error: 'profileId is required' };
  }
  const settings = SettingsSchema.normalizeDesktopSettings(await readSettings(dataRoot));
  const profiles = settings.providerProfiles || [];
  const profile = profiles.find(function (p) { return p.id === profileId; });
  if (!profile) {
    return { ok: false, error: 'Profile not found' };
  }
  if (!SettingsSchema.isApiCompatibleProvider(profile.provider)) {
    return { ok: false, provider: profile.provider, error: 'Provider is not API-compatible and cannot be tested' };
  }
  const config = {
    mode: 'api',
    provider: profile.provider,
    endpoint: profile.endpoint,
    apiKey: sanitizeKey(profile.apiKey),
    model: profile.model
  };
  const live = !!options.live;
  if (!config.endpoint) {
    return { ok: false, mode: 'api', provider: config.provider, profileId: profile.id, error: 'API endpoint is required.' };
  }
  if (!config.apiKey) {
    return { ok: false, mode: 'api', provider: config.provider, profileId: profile.id, error: 'API key is required.' };
  }
  if (!live) {
    return { ok: true, mode: 'api', provider: config.provider, profileId: profile.id, checked: 'configuration', endpoint: config.endpoint };
  }
  try {
    const liveTarget = resolveLiveTest(config);
    const model = liveTarget.model;
    const result = await requestUrl(liveTarget.endpoint, {
      method: 'POST',
      headers: liveTarget.headers,
      body: liveTarget.body,
      timeoutMs: 15000,
      readBody: true
    });
    const httpOk = result.statusCode >= 200 && result.statusCode < 300;
    const details = extractErrorDetails(result.body, [config.apiKey]);
    const classified = !httpOk ? require('./generation-bridge-service').classifyHttpStatus(result.statusCode, result.retryAfter, details) : null;
    const validation = httpOk ? validateLiveResponse(result.body, liveTarget.transport, [config.apiKey]) : { ok: false };
    const ok = httpOk && validation.ok;
    return {
      ok,
      mode: 'api',
      provider: config.provider,
      profileId: profile.id,
      model,
      statusCode: result.statusCode,
      checked: 'live',
      error: !ok ? ((classified && classified.message) || validation.error || details.message || `HTTP ${result.statusCode}`) : undefined
    };
  } catch (error) {
    return { ok: false, mode: 'api', provider: config.provider, profileId: profile.id, error: sanitizeProviderMessage(error.message, [config.apiKey]) || 'AI Provider 请求失败。' };
  }
}

module.exports = {
  readSettings,
  writeSettings,
  updateSettings,
  updateProviderProfile,
  deleteProviderProfile,
  publicSettings,
  runtimeProviderConfig,
  publicRuntimeProvider,
  runtimeProviderProfiles,
  projectSaveRoot,
  backupRoot,
  testProvider,
  testProviderProfile,
  validateLiveResponse
};
