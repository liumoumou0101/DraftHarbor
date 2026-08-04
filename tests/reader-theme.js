const assert = require('assert');
const Theme = require('../src/core/document/reader-theme');

const builtins = Theme.builtInReaderThemes();
assert.strictEqual(builtins.length, 6);
assert.ok(builtins.every((theme) => theme.builtIn));
assert.ok(Theme.contrastRatio(builtins[0].tokens.text, builtins[0].tokens.page) >= 4.5);

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
