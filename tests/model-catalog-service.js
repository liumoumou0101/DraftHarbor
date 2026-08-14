const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ModelCatalog = require('../src/core/settings/model-catalog');
const catalogService = require('../desktop/services/model-catalog-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-catalog-'));

  const builtin = ModelCatalog.getBuiltinProviderModels('opencode-zen');
  const pickle = builtin.find((item) => item.id === 'big-pickle');
  assert.ok(pickle, 'builtin catalog must include big-pickle');
  assert.strictEqual(pickle.pricingClass, 'free', 'big-pickle must be marked free from the versioned list, not a suffix');
  assert.ok(!pickle.id.endsWith('-free'), 'free exception must work without a -free suffix');

  const mergedOnline = ModelCatalog.mergeZenCatalog(builtin, ['deepseek-v4-flash', 'big-pickle', 'brand-new-model', 'claude-opus-4-6']);
  const flash = mergedOnline.models.find((item) => item.id === 'deepseek-v4-flash');
  const vanished = mergedOnline.models.find((item) => item.id === 'minimax-m3');
  const fresh = mergedOnline.models.find((item) => item.id === 'brand-new-model');
  const claude = mergedOnline.models.find((item) => item.id === 'claude-opus-4-6');
  assert.strictEqual(flash.availability, 'online');
  assert.strictEqual(vanished.availability, 'offline');
  assert.strictEqual(fresh.compatibility, 'unreviewed');
  assert.ok(!ModelCatalog.isModelSelectable(fresh), 'unknown new models must not be callable');
  assert.strictEqual(claude.compatibility, 'unsupported-transport');
  assert.ok(!ModelCatalog.isModelSelectable(claude), 'unsupported transport must stay disabled');
  assert.ok(mergedOnline.diff.added >= 1, 'new remote IDs should count as added');

  const hidden = ModelCatalog.mergeZenCatalog(builtin, ['big-pickle', 'deepseek-v4-pro'], { hidePrivacyRiskModels: true });
  assert.ok(!hidden.models.some((item) => item.id === 'big-pickle'), 'privacy hide should remove may-train models');
  assert.ok(hidden.models.some((item) => item.id === 'deepseek-v4-pro'));

  const presented = catalogService.presentCatalog('opencode-zen', null);
  assert.ok(presented.models.some((item) => item.id === 'kimi-k2.6'));
  assert.strictEqual(presented.source, 'builtin');

  const first = await catalogService.refreshRemoteCatalog(dataRoot, 'opencode-zen', {
    payload: { data: [{ id: 'deepseek-v4-flash' }, { id: 'big-pickle' }, { id: 'new-zen-model' }] },
    now: Date.parse('2026-08-14T00:00:00Z')
  });
  assert.strictEqual(first.source.includes('/models') || first.fetchedAt.length > 0, true);
  assert.ok(first.models.some((item) => item.id === 'new-zen-model'));
  const cached = await catalogService.loadCatalog(dataRoot, 'opencode-zen', {
    now: Date.parse('2026-08-14T12:00:00Z'),
    skipRefresh: true
  });
  assert.strictEqual(cached.fetchedAt, first.fetchedAt, '24h window should reuse the last successful cache');

  const stale = await catalogService.loadCatalog(dataRoot, 'opencode-zen', {
    now: Date.parse('2026-08-16T00:00:00Z'),
    background: false,
    payload: { data: [{ id: 'deepseek-v4-flash' }] }
  });
  assert.ok(stale.fetchedAt !== first.fetchedAt, 'expired cache should refresh');

  const failed = await catalogService.refreshRemoteCatalog(dataRoot, 'opencode-zen', {
    payload: { data: [{ id: 'ok', headers: { Authorization: 'Bearer x' } }] }
  });
  assert.ok(failed.refreshFailed, 'invalid remote payload should fail closed');
  assert.ok(failed.models.length > 0, 'failed refresh must keep builtin/cache models');

  assert.throws(() => catalogService.extractRemoteModelIds({ data: [{ id: 'ok', endpoint: 'https://evil.example' }] }), /不允许/);
  assert.throws(() => catalogService.cachePath(dataRoot, '../../outside'), /不支持的模型目录 Provider|缓存路径不合法/);
  assert.throws(() => catalogService.normalizeCatalogProvider('openai'), /不支持的模型目录 Provider/);
  const safePath = catalogService.cachePath(dataRoot, 'opencode-go');
  assert.ok(path.resolve(safePath).startsWith(path.resolve(dataRoot, 'cache')));

  console.log('model-catalog-service tests passed.');
})().catch((error) => {
  console.error('model-catalog-service tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
