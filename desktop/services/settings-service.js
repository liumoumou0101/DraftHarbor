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

function sanitizeProviderMessage(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || /<\/?[a-z][\s\S]*>/i.test(text)) return '';
  if (/api[_-]?key|authorization|bearer\s+\S+/i.test(text) && text.length > 80) return '';
  return text.slice(0, 180);
}

function extractErrorMessage(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    const message = parsed && parsed.error && (parsed.error.message || parsed.error.code)
      ? (parsed.error.message || parsed.error.code)
      : (parsed.message || parsed.error || '');
    return sanitizeProviderMessage(message);
  } catch (error) {
    return sanitizeProviderMessage(text);
  }
}

function resolveLiveTest(config) {
  const ModelCatalog = require('../../src/core/settings/model-catalog');
  if (ModelCatalog.isOpencodeProvider(config.provider)) {
    return {
      model: ModelCatalog.defaultTestModel(config.provider, config.model),
      endpoint: ModelCatalog.resolveProviderEndpoint(config.provider, config.endpoint)
    };
  }
  return {
    model: config.model || 'model-check',
    endpoint: config.endpoint
  };
}

function requestUrl(url, { method = 'GET', headers = {}, body = '', timeoutMs = 2500, readBody = false } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, { method, headers, timeout: timeoutMs }, (response) => {
      const retryAfter = response.headers && response.headers['retry-after'];
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (!readBody || size > 2048) return;
        size += chunk.length;
        chunks.push(chunk);
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
    const liveTarget = resolveLiveTest(config);
    const model = liveTarget.model;
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    });
    const result = await requestUrl(liveTarget.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sanitizeKey(config.apiKey)}`
      },
      body,
      timeoutMs: 15000,
      readBody: true
    });
    const ok = result.statusCode >= 200 && result.statusCode < 300;
    const detail = extractErrorMessage(result.body);
    const classified = !ok ? require('./generation-bridge-service').classifyHttpStatus(result.statusCode, result.retryAfter, { message: detail }) : null;
    return {
      ok,
      mode: 'api',
      provider: config.provider,
      model,
      statusCode: result.statusCode,
      checked: 'live',
      error: !ok ? ((classified && classified.message) || detail || `HTTP ${result.statusCode}`) : undefined
    };
  } catch (error) {
    return { ok: false, mode: 'api', provider: config.provider, error: error.message };
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
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    });
    const result = await requestUrl(liveTarget.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.apiKey
      },
      body: body,
      timeoutMs: 15000,
      readBody: true
    });
    const ok = result.statusCode >= 200 && result.statusCode < 300;
    const detail = extractErrorMessage(result.body);
    const classified = !ok ? require('./generation-bridge-service').classifyHttpStatus(result.statusCode, result.retryAfter, { message: detail }) : null;
    return {
      ok,
      mode: 'api',
      provider: config.provider,
      profileId: profile.id,
      model,
      statusCode: result.statusCode,
      checked: 'live',
      error: !ok ? ((classified && classified.message) || detail || `HTTP ${result.statusCode}`) : undefined
    };
  } catch (error) {
    return { ok: false, mode: 'api', provider: config.provider, profileId: profile.id, error: error.message };
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
  testProviderProfile
};
