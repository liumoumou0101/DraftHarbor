const assert = require('assert');
const Theme = require('../src/core/document/reader-theme');

const builtins = Theme.builtInReaderThemes();
assert.strictEqual(builtins.length, 4);
assert.deepStrictEqual(builtins.map((theme) => theme.themeId), ['paper', 'lamp', 'ink', 'oled']);
assert.ok(builtins.every((theme) => theme.builtIn));
assert.ok(builtins.every((theme) => Theme.contrastRatio(theme.tokens.text, theme.tokens.page) >= 4.5));
assert.ok(builtins.every((theme) => Theme.contrastRatio(theme.tokens.accentText, theme.tokens.accent) >= 4.5));
assert.strictEqual(Theme.resolveReaderThemeId('dark'), 'ink');
assert.strictEqual(Theme.resolveReaderThemeId('sepia'), 'lamp');
assert.strictEqual(Theme.resolveReaderThemeId('white'), 'paper');
assert.strictEqual(Theme.createReaderTheme({ themeId: 'dark' }).canonicalId, 'ink');
assert.strictEqual(Theme.createReaderTheme({ themeId: 'paper' }).name, '书页');

const custom = Theme.createReaderTheme({
  themeId: 'user:quiet-night',
  name: 'Quiet Night',
  tokens: {
    environment: '#111111', page: '#202020', text: '#f0f0f0', mutedText: '#b0b0b0',
    control: '#303030', controlText: '#ffffff', material: '#252525', effect: '#000000'
  }
});
assert.strictEqual(custom.builtIn, false);
assert.throws(() => Theme.createReaderTheme({ themeId: 'user:bad', tokens: { ...custom.tokens, text: '#222222' } }), /contrast/);
assert.throws(() => Theme.createReaderTheme({ themeId: 'user:css', tokens: { ...custom.tokens, page: 'url(https://example.com)' } }), /hex color/);
assert.throws(() => Theme.createReaderTheme({ themeId: '../outside', tokens: custom.tokens }), /themeId is invalid/);

console.log('Reader theme tests passed.');
