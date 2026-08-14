const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const ModelCatalog = require('../../src/core/settings/model-catalog');
const { writeJsonAtomic } = require('../storage/atomic-write');

const CACHE_SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_MODELS = 400;
const MAX_ID_LENGTH = 128;
const FETCH_TIMEOUT_MS = 15000;

const inflight = new Map();
const ALLOWED_CATALOG_PROVIDERS = Object.freeze(['opencode-zen', 'opencode-go']);

function normalizeCatalogProvider(provider) {
  const id = String(provider || '').trim();
  if (ALLOWED_CATALOG_PROVIDERS.indexOf(id) < 0) {
    const error = new Error('不支持的模型目录 Provider');
    error.code = 'catalog_forbidden_provider';
    throw error;
  }
  return id;
}

function cachePath(dataRoot, provider) {
  const safe = normalizeCatalogProvider(provider);
  const root = path.resolve(String(dataRoot || ''), 'cache');
  const target = path.resolve(root, `${safe}-models.json`);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('模型目录缓存路径不合法');
    error.code = 'catalog_forbidden_path';
    throw error;
  }
  return target;
}

function emptyCache(provider) {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    provider: provider || 'opencode-zen',
    fetchedAt: '',
    source: '',
    modelIds: [],
    lastError: ''
  };
}

function isSafeModelId(value) {
  const id = String(value || '');
  if (!id || id.length > MAX_ID_LENGTH) return false;
  if (id === '__custom__') return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(id);
}

function extractRemoteModelIds(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.data) ? payload.data
      : (payload && Array.isArray(payload.models) ? payload.models : []));
  if (rows.length > MAX_MODELS) {
    const error = new Error('远端模型目录过大');
    error.code = 'catalog_too_large';
    throw error;
  }
  const ids = [];
  const seen = new Set();
  rows.forEach((row) => {
    const id = String(row && (row.id || row.model || row) || '').trim();
    if (!isSafeModelId(id) || seen.has(id)) return;
    if (row && typeof row === 'object') {
      if (row.endpoint || row.baseUrl || row.headers || row.authorization || row.script) {
        const error = new Error('远端目录包含不允许的字段');
        error.code = 'catalog_forbidden_field';
        throw error;
      }
    }
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

function requestJson(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:' && !options.allowInsecure) {
      reject(Object.assign(new Error('模型目录只允许 HTTPS'), { code: 'catalog_insecure_url' }));
      return;
    }
    if (options.allowedHost && parsed.hostname !== options.allowedHost) {
      reject(Object.assign(new Error('模型目录域名不被允许'), { code: 'catalog_forbidden_host' }));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeout: options.timeoutMs || FETCH_TIMEOUT_MS
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        reject(Object.assign(new Error('模型目录不允许重定向'), { code: 'catalog_redirect', status: response.statusCode }));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          request.destroy();
          reject(Object.assign(new Error('模型目录响应过大'), { code: 'catalog_too_large' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(Object.assign(new Error(`模型目录返回 HTTP ${response.statusCode}`), { code: 'catalog_http', status: response.statusCode }));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(Object.assign(new Error('模型目录不是合法 JSON'), { code: 'catalog_invalid_json' }));
        }
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('模型目录请求超时'), { code: 'catalog_timeout' })));
    request.on('error', reject);
    request.end();
  });
}

async function readCache(dataRoot, provider) {
  provider = normalizeCatalogProvider(provider);
  const target = cachePath(dataRoot, provider);
  try {
    const raw = await require('fs/promises').readFile(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.modelIds)) {
      return emptyCache(provider);
    }
    return {
      ...emptyCache(provider),
      ...parsed,
      modelIds: parsed.modelIds.filter(isSafeModelId)
    };
  } catch (error) {
    return emptyCache(provider);
  }
}

function cacheAgeMs(cache, now) {
  if (!cache || !cache.fetchedAt) return Number.POSITIVE_INFINITY;
  const stamp = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(stamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - stamp);
}

function presentCatalog(provider, cache, options = {}) {
  const hidePrivacyRiskModels = !!(options.hidePrivacyRiskModels);
  const builtin = ModelCatalog.getBuiltinProviderModels(provider);
  const remoteIds = cache && cache.fetchedAt ? cache.modelIds : null;
  const merged = ModelCatalog.mergeZenCatalog(builtin, remoteIds, { hidePrivacyRiskModels });
  return {
    provider,
    source: cache && cache.source ? cache.source : 'builtin',
    fetchedAt: (cache && cache.fetchedAt) || '',
    stale: cacheAgeMs(cache, options.now || Date.now()) >= CACHE_TTL_MS,
    lastError: (cache && cache.lastError) || '',
    models: merged.models,
    diff: merged.diff
  };
}

async function refreshRemoteCatalog(dataRoot, provider = 'opencode-zen', options = {}) {
  provider = normalizeCatalogProvider(provider);
  const key = `${dataRoot}::${provider}`;
  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    const previous = await readCache(dataRoot, provider);
    try {
      const url = options.url || ModelCatalog.resolveModelsUrl(provider) || ModelCatalog.ZEN_MODELS_URL;
      const payload = options.payload || await requestJson(url, {
        allowedHost: options.allowedHost || ModelCatalog.ZEN_HOST,
        allowInsecure: !!options.allowInsecure,
        timeoutMs: options.timeoutMs
      });
      const modelIds = extractRemoteModelIds(payload);
      const next = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider,
        fetchedAt: new Date(options.now || Date.now()).toISOString(),
        source: url,
        modelIds,
        lastError: ''
      };
      await writeJsonAtomic(cachePath(dataRoot, provider), next);
      return presentCatalog(provider, next, options);
    } catch (error) {
      const failed = {
        ...previous,
        lastError: error && error.message ? String(error.message).slice(0, 200) : 'refresh failed'
      };
      if (previous.fetchedAt) {
        try { await writeJsonAtomic(cachePath(dataRoot, provider), failed); } catch (writeError) { /* keep memory result */ }
      }
      const presented = presentCatalog(provider, previous.fetchedAt ? previous : null, options);
      presented.lastError = failed.lastError;
      presented.refreshFailed = true;
      return presented;
    }
  })();
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

async function loadCatalog(dataRoot, provider = 'opencode-zen', options = {}) {
  provider = normalizeCatalogProvider(provider);
  const cache = await readCache(dataRoot, provider);
  const now = options.now || Date.now();
  const presented = presentCatalog(provider, cache.fetchedAt ? cache : null, { ...options, now });
  if (options.refresh === 'always' || (!options.skipRefresh && cacheAgeMs(cache, now) >= CACHE_TTL_MS)) {
    if (options.background !== false && options.refresh !== 'always') {
      refreshRemoteCatalog(dataRoot, provider, options).catch(() => {});
      return presented;
    }
    return refreshRemoteCatalog(dataRoot, provider, options);
  }
  return presented;
}

module.exports = {
  CACHE_TTL_MS,
  ALLOWED_CATALOG_PROVIDERS,
  normalizeCatalogProvider,
  cachePath,
  readCache,
  presentCatalog,
  loadCatalog,
  refreshRemoteCatalog,
  extractRemoteModelIds,
  isSafeModelId
};
