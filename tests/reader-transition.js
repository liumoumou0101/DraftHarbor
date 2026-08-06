const assert = require('assert');
const Transition = require('../src/core/document/reader-transition');

assert.deepStrictEqual(Transition.createReaderTransitionAdapter({ transition: 'fade', direction: -1 }), {
  schemaVersion: 1, requested: 'fade', transition: 'fade', durationMs: 180,
  experimental: false, reducedMotion: false, direction: 'previous', cssToken: 'fade'
});
assert.strictEqual(Transition.createReaderTransitionAdapter({ transition: 'cover' }).cssToken, 'cover');
assert.strictEqual(Transition.createReaderTransitionAdapter({ transition: 'slide', reducedMotion: true }).transition, 'none');
assert.strictEqual(Transition.createReaderTransitionAdapter({ transition: 'curl' }).experimental, false);
assert.strictEqual(Transition.createReaderTransitionAdapter({ transition: 'curl' }).transition, 'curl');
assert.strictEqual(Transition.createReaderTransitionAdapter({ transition: 'curl' }).durationMs, 620);
assert.strictEqual(Transition.normalizeTransition('unknown'), 'none');
console.log('Reader transition tests passed.');
