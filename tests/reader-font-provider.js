const assert = require('assert');
const Provider = require('../src/core/document/reader-font-provider');

(async () => {
  const provider = Provider.createReaderFontProvider({
    probe: async (entry) => entry.fontId !== 'user:missing',
    load: async (entry) => entry.fontId !== 'user:broken'
  });

  assert.strictEqual(provider.list().length, 4);
  assert.strictEqual(provider.resolve('builtin:serif').actual.fontId, 'builtin:serif');
  assert.strictEqual(provider.resolve('unknown').fallback, true);

  provider.register({ fontId: 'user:missing', family: 'Missing Font', displayName: 'Missing', format: 'woff2' });
  assert.strictEqual(await provider.probe('user:missing'), false);
  assert.strictEqual(provider.resolve('user:missing').reason, 'missing');

  provider.register({ fontId: 'user:broken', family: 'Broken Font', displayName: 'Broken', format: 'woff2' });
  const failed = await provider.load('user:broken');
  assert.strictEqual(failed.fallback, true);
  assert.strictEqual(failed.reason, 'failed');
  assert.ok(provider.snapshot().catalogVersion > 1);

  assert.strictEqual(provider.remove('user:missing'), true);
  assert.strictEqual(provider.get('user:missing'), null);
  assert.throws(() => provider.remove('builtin:default'), /cannot be removed/);
  assert.throws(() => provider.register({ fontId: 'builtin:serif', family: 'Duplicate' }), /already exists/);

  console.log('Reader font provider tests passed.');
})().catch((error) => {
  console.error('Reader font provider tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
