const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Hud = require('../src/core/document/reader-hud');

const shellDir = path.join(__dirname, '..', 'src', 'desktop', 'shell');

function inputFixture() {
    const state = {
        active: null,
        dialogOpen: false,
        menuOpen: false,
        selectionVisible: false,
        selectionText: ''
    };
    const listeners = {};
    const selectionToolbar = {};
    Object.defineProperty(selectionToolbar, 'hidden', { get: () => !state.selectionVisible });
    const document = {
        body: { tagName: 'BODY' },
        get activeElement() { return state.active || this.body; },
        querySelector(selector) {
            if (selector === 'dialog[open]') return state.dialogOpen ? {} : null;
            if (selector === '[data-reader-quick-tools][open]') return state.menuOpen ? {} : null;
            if (selector === '[data-reader-selection-toolbar]') return selectionToolbar;
            return null;
        },
        addEventListener(type, listener) { listeners[type] = listener; }
    };
    const context = vm.createContext({
        window: { getSelection: () => ({ toString: () => state.selectionText }) },
        document,
        readerState: {
            drawer: '', keyboardPageTurn: true, pointerPageTurn: true, touchPageTurn: true
        }
    });
    vm.runInContext(fs.readFileSync(path.join(shellDir, 'reader-input-coordinator.js'), 'utf8'), context, {
        filename: 'reader-input-coordinator.js'
    });
    return { context, state, listeners };
}

function element(tagName, options = {}) {
    return {
        tagName,
        isContentEditable: !!options.contentEditable,
        matches(selector) {
            if (selector.includes('[data-reader-page-prev]')) return !!options.pageButton;
            if (selector.includes('[data-reader-settings-toggle]')) return !!options.chromeButton;
            return false;
        },
        closest(selector) {
            if (selector === 'button, summary') return ['BUTTON', 'SUMMARY'].includes(tagName) ? this : null;
            if (selector === '[data-reader-quick-appearance]') return options.quickAppearance ? {} : null;
            if (selector.includes('[contenteditable]')) return options.contentEditable ? this : null;
            if (selector.includes('[role="menu"]')) return options.menuItem ? {} : null;
            return null;
        }
    };
}

{
    const fixture = inputFixture();
    const quickButton = element('BUTTON', { quickAppearance: true });
    let stopped = false;
    assert.strictEqual(typeof fixture.listeners.keydown, 'function',
        'the input coordinator binds quick-control activation protection');
    fixture.listeners.keydown({
        key: ' ', target: quickButton,
        stopImmediatePropagation: () => { stopped = true; }
    });
    assert.strictEqual(stopped, true, 'Space remains reserved for activating a focused quick control');
    stopped = false;
    fixture.listeners.keydown({
        key: 'ArrowRight', target: quickButton,
        stopImmediatePropagation: () => { stopped = true; }
    });
    assert.strictEqual(stopped, false, 'reader navigation keys continue to the global page-turn handler');
}

{
    const fixture = inputFixture();
    fixture.state.active = element('BUTTON', { quickAppearance: true });
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), true,
        'a focused quick appearance button must not swallow the next arrow/page navigation');
    assert.strictEqual(fixture.context.readerCanPageTurn('pointer'), true,
        'a focused quick appearance button must not disable edge or wheel paging');

    fixture.state.active = element('BUTTON');
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), false,
        'unrelated focused buttons retain their own keyboard behavior');

    fixture.state.active = element('INPUT');
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), false);
    fixture.state.active = element('DIV', { contentEditable: true });
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), false);
    fixture.state.active = element('DIV', { menuItem: true });
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), false);
}

{
    const fixture = inputFixture();
    fixture.state.active = element('BUTTON', { quickAppearance: true });
    fixture.state.menuOpen = true;
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), false,
        'an open quick-tools menu must suspend page turns');
    fixture.state.menuOpen = false;
    fixture.context.readerState.drawer = 'right';
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), false);
    fixture.context.readerState.drawer = '';
    fixture.state.selectionVisible = true;
    assert.strictEqual(fixture.context.readerCanPageTurn('keyboard'), false);
}

{
    let summaryFocused = false;
    let contentFocused = false;
    const summary = { focus: () => { summaryFocused = true; } };
    const content = { focus: () => { contentFocused = true; } };
    const quickTools = {
        open: true,
        querySelector: selector => selector === 'summary' ? summary : null
    };
    const shell = {
        dataset: {},
        contains: () => false,
        querySelector(selector) {
            if (selector === '[data-reader-quick-tools][open]') return quickTools.open ? quickTools : null;
            if (selector === 'dialog[open]') return null;
            if (selector === '[data-reader-selection-toolbar]:not([hidden])') return null;
            if (selector === '[data-reader-content]') return content;
            return null;
        }
    };
    const document = {
        activeElement: null,
        getElementById: () => ({ dataset: { view: 'reader' } }),
        querySelector: selector => selector === '[data-reader-shell]' ? shell : null,
        addEventListener: () => {},
        fullscreenElement: null,
        documentElement: {}
    };
    const window = {
        getSelection: () => ({ removeAllRanges: () => {} }),
        clearTimeout: () => {},
        setTimeout: () => 1
    };
    window.window = window;
    const readerState = { drawer: '', focusMode: false, hudState: 'visible', hudPreviousState: 'visible' };
    const setReaderDrawer = drawer => { readerState.drawer = drawer; };
    const context = vm.createContext({
        window, document, setReaderDrawer,
        readerState,
        MutationObserver: class { observe() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(shellDir, 'reader-hud.js'), 'utf8'), context, { filename: 'reader-hud.js' });
    assert.strictEqual(window.readerHudHandleEscape(), true);
    assert.strictEqual(quickTools.open, false, 'Escape closes the quick-tools disclosure first');
    assert.strictEqual(summaryFocused, true, 'closing quick tools restores focus to its summary');

    quickTools.open = true;
    window.readerHudToggleFocusMode();
    assert.strictEqual(quickTools.open, false,
        'entering focus mode closes quick tools before their hidden open state can block paging');
    assert.strictEqual(contentFocused, true, 'focus mode moves focus into the reading surface');
    assert.strictEqual(readerState.focusMode, true);
    window.readerHudHandleEscape();
    assert.strictEqual(readerState.focusMode, false,
        'the first Escape after entering focus mode exits focus instead of closing hidden quick tools');

    quickTools.open = true;
    readerState.drawer = 'right';
    window.readerHudNotifyPanel(true);
    assert.strictEqual(quickTools.open, false, 'opening a Reader drawer closes quick tools centrally');
    window.readerHudHandleEscape();
    assert.strictEqual(readerState.drawer, '',
        'the first Escape after opening a drawer closes the drawer, not background quick tools');

    quickTools.open = true;
    window.readerHudLeaveReader();
    assert.strictEqual(quickTools.open, false, 'leaving Reader clears an open quick-tools disclosure');
}

{
    const shellListeners = {};
    const documentListeners = {};
    const scheduled = new Map();
    let nextTimer = 0;
    const menuControl = {};
    const quickTools = { open: false, contains: target => target === menuControl };
    const content = { contains: target => target === content, focus: () => {} };
    const chromeButton = {};
    const shell = {
        dataset: {},
        contains: target => target === content || target === chromeButton,
        getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
        addEventListener: (type, listener) => { shellListeners[type] = listener; },
        querySelector(selector) {
            if (selector === '[data-reader-content]') return content;
            if (selector === '[data-reader-quick-tools][open]') return quickTools.open ? quickTools : null;
            return null;
        }
    };
    const root = { dataset: { view: 'reader' } };
    const document = {
        activeElement: chromeButton,
        hidden: false,
        fullscreenElement: null,
        documentElement: {},
        getElementById: () => root,
        querySelector: selector => selector === '[data-reader-shell]' ? shell : null,
        addEventListener: (type, listener) => { documentListeners[type] = listener; }
    };
    const window = {
        DraftHarborReaderHud: Hud,
        getSelection: () => ({ removeAllRanges: () => {} }),
        clearTimeout: timer => { scheduled.delete(timer); },
        setTimeout(callback) { const timer = ++nextTimer; scheduled.set(timer, callback); return timer; }
    };
    window.window = window;
    const readerState = {
        apiMode: true, drawer: '', focusMode: false, hudMode: 'auto',
        hudState: 'visible', hudPreviousState: 'visible', transferSelection: null
    };
    const context = vm.createContext({
        window, document, readerState,
        MutationObserver: class { observe() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(shellDir, 'reader-hud.js'), 'utf8'), context, { filename: 'reader-hud.js' });
    window.initializeReaderHud();
    assert.strictEqual(scheduled.size, 1);
    const blockedIdleCallback = scheduled.values().next().value;
    scheduled.clear();
    blockedIdleCallback();
    assert.strictEqual(readerState.hudState, 'visible', 'focused chrome rejects the pending idle transition');
    assert.strictEqual(scheduled.size, 0, 'a rejected idle transition leaves no timer running');

    document.activeElement = content;
    shellListeners.focusin({ target: content });
    assert.strictEqual(scheduled.size, 1,
        'returning focus to reading content restarts auto-hide without requiring pointer motion');
    const idleCallback = scheduled.values().next().value;
    scheduled.clear();
    idleCallback();
    assert.strictEqual(readerState.hudState, 'idle', 'the restarted timer eventually idles the HUD');

    assert.strictEqual(typeof shellListeners.click, 'function',
        'the HUD binds a shell-level quick-tools outside-click handler');
    quickTools.open = true;
    let prevented = false;
    let stopped = false;
    shellListeners.click({
        target: content,
        preventDefault: () => { prevented = true; },
        stopImmediatePropagation: () => { stopped = true; }
    });
    assert.strictEqual(quickTools.open, false, 'clicking reading content dismisses quick tools');
    assert.ok(prevented && stopped, 'the dismissal click cannot also trigger page navigation');

    quickTools.open = true;
    shellListeners.click({
        target: menuControl,
        preventDefault: () => { throw new Error('menu interaction must not be prevented'); },
        stopImmediatePropagation: () => { throw new Error('menu interaction must not be stopped'); }
    });
    assert.strictEqual(quickTools.open, true, 'clicking a quick-tools control keeps the disclosure open');

    quickTools.open = true;
    prevented = false;
    shellListeners.click({
        target: chromeButton,
        preventDefault: () => { prevented = true; },
        stopImmediatePropagation: () => {}
    });
    assert.strictEqual(quickTools.open, false, 'clicking other Reader chrome dismisses quick tools');
    assert.strictEqual(prevented, false, 'other chrome controls continue their intended action after dismissal');
}

console.log('Reader input and HUD regression tests passed.');
