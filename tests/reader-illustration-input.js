const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fixture() {
    const listeners = {};
    const turns = [];
    const state = { effectiveLayoutMode: 'illustrated', wheelTurnAccumulator: 0 };
    const content = { addEventListener: (type, callback) => { listeners[type] = callback; } };
    const context = vm.createContext({
        readerState: state,
        document: { activeElement: null, querySelector: () => null },
        window: { getSelection: () => '' },
        queueReaderPageTurn: delta => turns.push(delta)
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell/reader-input-coordinator.js'), 'utf8'), context);
    context.bindReaderContinuousInput(content);
    const target = illustrated => ({ closest: selector => illustrated && selector.includes('illustration') ? {} : null });
    const wheel = illustrated => ({ target: target(illustrated), deltaY: 120, preventDefault() { this.prevented = true; } });
    const pointer = (illustrated, x) => ({ target: target(illustrated), pointerType: 'touch', pointerId: 1, clientX: x, clientY: 200, preventDefault() {} });
    return { context, listeners, turns, state, wheel, pointer };
}

const f = fixture();
f.listeners.wheel(f.wheel(true));
assert.deepStrictEqual(f.turns, [], 'scrolling the illustration must not advance the text');
assert.strictEqual(f.state.wheelTurnAccumulator, 0, 'illustration wheel movement must not accumulate a later text turn');
f.listeners.pointerdown(f.pointer(true, 500));
f.listeners.pointerup(f.pointer(true, 300));
assert.deepStrictEqual(f.turns, [], 'swiping the illustration must not advance the text');
f.listeners.pointerdown(f.pointer(false, 500));
f.listeners.pointerup(f.pointer(true, 300));
assert.deepStrictEqual(f.turns, [], 'a gesture ending on illustration controls must not advance the text');
f.listeners.wheel(f.wheel(false));
assert.deepStrictEqual(f.turns, [1], 'text wheel navigation must still work');
f.listeners.pointerdown(f.pointer(false, 500));
f.listeners.pointerup(f.pointer(false, 300));
assert.deepStrictEqual(f.turns, [1, 1], 'text touch navigation must still work');

const queued = fixture();
const frames = [];
let dialogOpen = false;
let rendered = 0;
Object.assign(queued.state, { currentChapter: {}, r: 1, pageIndex: 0, pendingPageDelta: 0,
    pages: [{ segments: [] }, { segments: [] }], pageTurnFrame: null });
queued.context.window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
queued.context.window.DraftHarborReaderLayout = { locatorPositionForPage: () => null };
queued.context.document.querySelector = selector => selector === 'dialog[open]' && dialogOpen ? {} : null;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell/reader-reading.js'), 'utf8'), queued.context);
queued.context.renderReaderPages = () => { rendered += 1; return null; };
queued.context.animateReaderPageTurn = () => {};
queued.context.updateReaderWorkspaceProgress = () => {};
queued.context.queueReaderPageTurn(1, { source: 'keyboard' });
dialogOpen = true;
frames.shift()();
assert.strictEqual(queued.state.pageIndex, 0, 'opening the image viewer must suppress a previously queued text turn');
assert.strictEqual(rendered, 0, 'a queued text turn must not redraw underneath an open viewer');
console.log('Reader illustration input isolation tests passed.');
