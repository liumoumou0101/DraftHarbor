const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '../src/desktop/shell/writer-generation-position.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const positionKey = 'draftharbor:nativeGenerationOutputPosition';

function eventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        },
        removeEventListener(type, callback) { if (listeners.has(type)) listeners.get(type).delete(callback); },
        dispatch(type, values = {}) {
            const event = { button: 0, pointerId: 1, clientX: 400, clientY: 400, target: this, preventDefault() {}, ...values };
            [...(listeners.get(type) || [])].forEach((callback) => callback(event));
        },
        listenerCount(type) { return (listeners.get(type) || new Set()).size; }
    };
}

function fixture(stored, storageUnavailable = false) {
    const storage = new Map(stored ? [[positionKey, JSON.stringify(stored)]] : []);
    const geometry = { width: 606, height: 1000, outputWidth: 520, outputHeight: 300 };
    const frames = [];
    const observers = [];
    const classes = new Set();
    const capturedPointers = new Set();
    const body = { getBoundingClientRect: () => ({ left: 100, top: 100, width: geometry.width, height: geometry.height, bottom: 100 + geometry.height }) };
    const output = {
        ...eventTarget(), hidden: false, dataset: {}, style: {},
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
        querySelector: () => null,
        getBoundingClientRect: () => ({ left: 100 + (Number.parseFloat(output.style.left) || 0), top: 100 + (Number.parseFloat(output.style.top) || 0), width: geometry.outputWidth, height: geometry.outputHeight }),
        setPointerCapture: (id) => capturedPointers.add(id),
        hasPointerCapture: (id) => capturedPointers.has(id),
        releasePointerCapture: (id) => capturedPointers.delete(id)
    };
    const window = {
        ...eventTarget(),
        localStorage: {
            getItem(name) { if (storageUnavailable) throw new Error('Storage unavailable'); return storage.get(name) || null; },
            setItem(name, value) { if (storageUnavailable) throw new Error('Storage unavailable'); storage.set(name, String(value)); },
            removeItem(name) { if (storageUnavailable) throw new Error('Storage unavailable'); storage.delete(name); }
        },
        requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; this.elements = []; observers.push(this); }
            observe(element) { this.elements.push(element); }
        }
    };
    const context = vm.createContext({ window, document: { querySelector: () => null }, nativeEditorElements: () => ({ generationOutput: output, editorBody: body }) });
    vm.runInContext(source, context, { filename: sourcePath });
    const flush = () => { while (frames.length) frames.shift()(); };
    const sync = (options) => window.syncNativeGenerationOutputPosition(options);
    const resize = (width, height = geometry.height) => {
        Object.assign(geometry, { width, height });
        window.dispatch('resize');
        flush();
    };
    const drag = (dx, dy, end = 'pointerup') => {
        output.dispatch('pointerdown');
        window.dispatch('pointermove', { clientX: 400 + dx, clientY: 400 + dy });
        window.dispatch(end, { clientX: 400 + dx, clientY: 400 + dy });
    };
    window.bindNativeGenerationOutputDrag();
    return { window, output, body, geometry, storage, capturedPointers, observers, flush, sync, resize, drag };
}

{
    const f = fixture();
    f.sync();
    assert.strictEqual(f.output.style.left, '74px');
    assert.strictEqual(f.storage.has(positionKey), false, 'render must not save an automatic position');
    f.resize(1597.609);
    assert.strictEqual(f.output.style.left, '1066px', 'maximizing should keep the default bubble against the current right edge');
    assert.strictEqual(f.storage.has(positionKey), false, 'resize must not turn the default position into a manual preference');
    f.output.dispatch('pointerdown');
    f.window.dispatch('pointerup');
    assert.strictEqual(f.storage.has(positionKey), false, 'clicking without moving must not create a manual preference');
    assert.strictEqual(f.capturedPointers.size, 0);
    assert.strictEqual(f.observers.length, 1);
    assert.deepStrictEqual(f.observers[0].elements, [f.body, f.output]);
    f.geometry.width = 1200;
    f.observers[0].callback();
    f.flush();
    assert.strictEqual(f.output.style.left, '668px', 'assistant divider changes must update the default position without a window resize');
    f.geometry.outputWidth = 320;
    f.observers[0].callback();
    f.flush();
    assert.strictEqual(f.output.style.left, '868px', 'collapsing reasoning must retain right alignment as the bubble gets narrower');
    f.window.bindNativeGenerationOutputDrag();
    assert.strictEqual(f.window.listenerCount('resize'), 1, 'rebinding must not duplicate handlers');
}

{
    const f = fixture();
    f.resize(1200);
    f.drag(-300, 180);
    const manual = { version: 1, mode: 'manual', left: 368, top: 192 };
    assert.deepStrictEqual(JSON.parse(f.storage.get(positionKey)), manual, 'an actual drag must save a versioned manual position');
    assert.strictEqual(f.capturedPointers.size, 0);
    f.resize(606, 350);
    assert.strictEqual(f.output.style.left, '74px', 'manual position must clamp inside a narrower editor');
    assert.strictEqual(f.output.style.top, '38px', 'manual position must clamp above the bottom reserve');
    assert.deepStrictEqual(JSON.parse(f.storage.get(positionKey)), manual, 'temporary clamping must not overwrite the preferred manual position');
    f.resize(1200, 1000);
    assert.strictEqual(f.output.style.left, '368px');
    assert.strictEqual(f.output.style.top, '192px');
    const restored = fixture(manual);
    restored.resize(1200);
    assert.strictEqual(restored.output.style.left, '368px', 'a new session must restore a marked manual preference');
    assert.strictEqual(restored.output.style.top, '192px');
}

{
    const f = fixture({ version: 1, mode: 'manual', left: 74, top: 120 });
    f.resize(1597.609);
    assert.strictEqual(f.output.style.left, '74px');
    f.output.dispatch('dblclick');
    assert.strictEqual(f.output.style.left, '1066px', 'reset must ignore existing inline coordinates');
    assert.strictEqual(f.output.style.top, '12px');
    assert.strictEqual(f.storage.has(positionKey), false, 'reset must clear the manual preference');
    f.resize(1700);
    assert.strictEqual(f.output.style.left, '1168px', 'the reset position must remain automatic on future resizes');
    f.sync({ reset: true, persist: true });
    assert.strictEqual(f.storage.has(positionKey), false, 'the old persist option must not save an automatic position');
}

for (const legacy of [{ left: 74, top: 12 }, { version: 1, mode: 'automatic', left: 74, top: 12 }, { version: 1, mode: 'manual', left: '74', top: null }]) {
    const f = fixture(legacy);
    f.output.style.left = '74px';
    f.output.style.top = '120px';
    f.resize(1597.609);
    assert.strictEqual(f.output.style.left, '1066px', 'legacy or invalid preferences and stale inline coordinates must fall back to the current default');
    assert.strictEqual(f.output.style.top, '12px');
    f.resize(1700);
    assert.strictEqual(f.output.style.left, '1168px');
}

{
    const f = fixture();
    f.sync();
    f.drag(-30, 70, 'pointercancel');
    assert.strictEqual(f.capturedPointers.size, 0, 'pointercancel must release capture');
    assert.strictEqual(f.output.classList.contains('is-generation-output-dragging'), false);
    assert.strictEqual(f.window.listenerCount('pointermove'), 0);
    assert.strictEqual(f.window.listenerCount('pointerup'), 0);
    assert.strictEqual(f.window.listenerCount('pointercancel'), 0);
    assert.deepStrictEqual(JSON.parse(f.storage.get(positionKey)), { version: 1, mode: 'manual', left: 44, top: 82 });
    f.output.dispatch('pointerdown', { target: { closest: () => ({}) } });
    assert.strictEqual(f.capturedPointers.size, 0, 'interactive bubble contents must not start a drag');
}

{
    const f = fixture(undefined, true);
    f.sync();
    f.drag(-30, 70);
    f.resize(1200);
    assert.strictEqual(f.output.style.left, '44px', 'manual placement should remain usable in memory when storage is unavailable');
    f.sync({ reset: true });
    assert.strictEqual(f.output.style.left, '668px');
}

console.log('Writer generation position tests passed.');
