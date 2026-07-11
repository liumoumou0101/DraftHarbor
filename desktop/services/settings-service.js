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

async function updateSettings(dataRoot, patch = {}) {
  const current = await readSettings(dataRoot);
  const providerPatch = { ...(patch.providerSettings || {}) };
  if (Object.prototype.hasOwnProperty.call(providerPatch, 'apiKey') && !String(providerPatch.apiKey || '').trim() && current.providerSettings.apiKey) {
    providerPatch.apiKey = current.providerSettings.apiKey;
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
    }
  });
}

async function updateProviderProfile(dataRoot, profile) {
  const current = await readSettings(dataRoot);
  const profiles = [...(current.providerProfiles || [])];
  const normalized = SettingsSchema.normalizeProviderProfile(profile);
  if (Object.prototype.hasOwnProperty.call(profile, 'apiKey') && !String(profile.apiKey || '').trim()) {
    const existing = profiles.find(function (p) { return p.id === normalized.id; });
    if (existing && existing.apiKey) {
      normalized.apiKey = existing.apiKey;
      normalized.hasApiKey = true;
    }
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

function runtimeProviderProfiles(settingsInput) {
  return SettingsSchema.providerProfileRuntimeConfigs(settingsInput);
}

function requestUrl(url, { method = 'GET', headers = {}, body = '', timeoutMs = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, { method, headers, timeout: timeoutMs }, (response) => {
      response.resume();
      response.on('end', () => resolve({ statusCode: response.statusCode || 0 }));
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
  if (!config.apiKey) {
    return { ok: false, mode: 'api', provider: config.provider, error: 'API key is required.' };
  }
  if (!live) {
    return { ok: true, mode: 'api', provider: config.provider, checked: 'configuration', endpoint: config.endpoint };
  }

  try {
    const body = JSON.stringify({
      model: config.model || 'model-check',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    });
    const result = await requestUrl(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body
    });
    return { ok: result.statusCode >= 200 && result.statusCode < 300, mode: 'api', provider: config.provider, statusCode: result.statusCode };
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
    apiKey: profile.apiKey,
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
    const body = JSON.stringify({
      model: config.model || 'model-check',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    });
    const result = await requestUrl(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.apiKey
      },
      body: body
    });
    return { ok: result.statusCode >= 200 && result.statusCode < 300, mode: 'api', provider: config.provider, profileId: profile.id, statusCode: result.statusCode };
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
  runtimeProviderProfiles,
  projectSaveRoot,
  backupRoot,
  testProvider,
  testProviderProfile
};
