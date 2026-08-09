const assert = require('assert');
const Preferences = require('../src/core/document/reader-preferences');

const defaults = Preferences.createReaderPreferencesV2({});
assert.strictEqual(defaults.schemaVersion, 2);
assert.strictEqual(defaults.layoutMode, 'double-page');
assert.strictEqual(defaults.fontId, 'builtin:default');
assert.strictEqual(defaults.appearanceProfileId, 'default');
assert.strictEqual(defaults.statusBarMode, 'auto');
assert.deepStrictEqual(defaults.statusBarFields, ['chapter', 'page', 'percent']);
assert.strictEqual(defaults.statusBarAutoHide, true);
assert.strictEqual(defaults.keyboardPageTurn, true);
assert.strictEqual(Preferences.createReaderPreferencesV2({ pageTransition: 'cover' }).pageTransition, 'cover');
assert.strictEqual(Preferences.createReaderPreferencesV2({ themeId: 'user:quiet-night' }).themeId, 'user:quiet-night');

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
const userProfile = Preferences.createReaderAppearanceProfile({
  profileId: 'user:night-reading',
  name: '夜读',
  preferences: { themeId: 'dark', fontSize: 21, statusBarMode: 'hidden', touchPageTurn: false }
});
assert.strictEqual(userProfile.builtIn, false);
assert.strictEqual(userProfile.preferences.statusBarMode, 'hidden');
assert.strictEqual(userProfile.preferences.touchPageTurn, false);
const immutablePaper = Preferences.createReaderAppearanceProfile({ profileId: 'paper', preferences: { fontSize: 47 } });
assert.strictEqual(immutablePaper.preferences.fontSize, Preferences.PROFILE_PRESETS.paper.fontSize);

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
