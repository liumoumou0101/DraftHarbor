const assert = require('assert');
const Hud = require('../src/core/document/reader-hud');

const initial = Hud.createReaderHudState();
assert.strictEqual(initial.state, 'visible');
assert.strictEqual(Hud.transitionReaderHud(initial, 'idle').state, 'idle');
assert.strictEqual(Hud.transitionReaderHud(initial, 'hide').state, 'hidden');
assert.strictEqual(Hud.transitionReaderHud(initial, 'hide', { panelOpen: true }).state, 'visible');

const panel = Hud.transitionReaderHud(initial, 'open-panel');
assert.strictEqual(panel.state, 'panel-open');
assert.strictEqual(panel.previousState, 'visible');
assert.strictEqual(Hud.transitionReaderHud(panel, 'close-panel').state, 'visible');

const selection = Hud.transitionReaderHud(Hud.createReaderHudState({ state: 'hidden' }), 'selection-start');
assert.strictEqual(selection.state, 'selection-active');
assert.strictEqual(Hud.transitionReaderHud(selection, 'selection-end').state, 'visible');
assert.strictEqual(Hud.transitionReaderHud(selection, 'hide', { selectionActive: true }).state, 'selection-active');
assert.strictEqual(Hud.transitionReaderHud(initial, 'leave-reader').state, 'hidden');
assert.strictEqual(Hud.canAutoHide({ dialogOpen: true }), false);
assert.strictEqual(Hud.canAutoHide({}), true);

console.log('Reader HUD tests passed.');
