const assert = require('assert');
const Catalog = require('../src/core/document/reader-font-catalog');

const builtins = Catalog.createBuiltinReaderFontCatalog();
assert.strictEqual(builtins.entries.length, 4);
assert.ok(builtins.entries.some((entry) => entry.fontId === 'builtin:default'));

const user = Catalog.createReaderFontCatalog({
  catalogVersion: 2,
  entries: [
    ...builtins.entries,
    { fontId: 'user:quiet-serif', displayName: 'Quiet Serif', family: 'Quiet Serif', sourceKind: 'user', format: 'woff2' }
  ]
});
const resolvedUser = Catalog.resolveReaderFont(user, 'user:quiet-serif');
assert.strictEqual(resolvedUser.fallback, false);
assert.strictEqual(resolvedUser.actual.sourceKind, 'user');
const resolvedMissing = Catalog.resolveReaderFont(user, 'user:gone');
assert.strictEqual(resolvedMissing.fallback, true);
assert.strictEqual(resolvedMissing.actual.fontId, 'builtin:default');
assert.throws(() => Catalog.createReaderFontCatalog({ entries: builtins.entries.slice(1) }), /requires builtin:default/);
assert.throws(() => Catalog.createReaderFontCatalog({ entries: [...builtins.entries, builtins.entries[0]] }), /duplicate reader fontId/);

console.log('Reader font catalog tests passed.');
