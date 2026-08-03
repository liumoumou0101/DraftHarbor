const assert = require('assert');
const Preferences = require('../src/core/document/reader-preferences');

const defaults = Preferences.createReaderPreferencesV2({});
assert.strictEqual(defaults.schemaVersion, 2);
assert.strictEqual(defaults.fontId, 'builtin:default');
assert.strictEqual(defaults.appearanceProfileId, 'default');

const migrated = Preferences.migrateReaderPreferences({
  schemaVersion: 1,
  fontFamilyId: 'serif',
  themeId: 'paper',
  fontSize: 23
});
assert.strictEqual(migrated.fontId, 'builtin:serif');
assert.strictEqual(migrated.fontFamilyId, 'serif');
assert.strictEqual(migrated.fontSize, 23);

const paper = Preferences.createReaderAppearanceProfile({ profileId: 'paper' });
assert.strictEqual(paper.preferences.themeId, 'paper');
assert.strictEqual(paper.preferences.fontId, 'builtin:serif');
assert.strictEqual(paper.builtIn, true);

const merged = Preferences.mergeReaderPreferenceLayers(
  { themeId: 'paper', fontSize: 20 },
  { themeId: 'sepia', lineHeight: 2 }
);
assert.strictEqual(merged.themeId, 'sepia');
assert.strictEqual(merged.fontSize, 20);
assert.strictEqual(merged.lineHeight, 2);
assert.throws(() => Preferences.createReaderPreferencesV2({ themeId: 'neon' }), /themeId is not supported/);
assert.throws(() => Preferences.createReaderAppearanceProfile({ profileId: 'custom' }), /profileId is not supported/);
assert.strictEqual(Preferences.builtInAppearanceProfiles().length, 3);

console.log('Reader preferences tests passed.');
