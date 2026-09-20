const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function control(properties = {}) {
    const listeners = {};
    return {
        ...properties,
        addEventListener(type, listener) { listeners[type] = listener; },
        dispatch(type) { listeners[type]?.({ currentTarget: this, target: this }); },
        setAttribute(name, value) { this[name] = value; }
    };
}

const tabs = [control({ dataset: { readerStudioTab: 'scheme' } }), control({ dataset: { readerStudioTab: 'typography' } })];
const sections = [control({ dataset: { readerStudioSection: 'scheme' } }), control({ dataset: { readerStudioSection: 'typography' } })];
const quickLayout = control({ value: '' });
const quickFamily = control({ value: '' });
const quickTheme = control({ value: '' });
const quickSize = control({ textContent: '' });
const quickMore = control();
const quickTools = control({ open: true });
let openedDrawer = '';

const singles = new Map([
    ['[data-reader-quick-theme]', quickTheme],
    ['[data-reader-quick-font-family]', quickFamily],
    ['[data-reader-quick-layout]', quickLayout],
    ['[data-reader-quick-font-size]', quickSize],
    ['[data-reader-quick-more]', quickMore],
    ['[data-reader-quick-tools]', quickTools]
]);
const document = {
    activeElement: null,
    querySelector: selector => singles.get(selector) || null,
    querySelectorAll(selector) {
        if (selector === '[data-reader-studio-tab]') return tabs;
        if (selector === '[data-reader-studio-section]') return sections;
        return [];
    }
};
const window = {
    DraftHarborReaderTheme: { resolveReaderThemeId: () => 'paper' },
    setReaderDrawer: drawer => { openedDrawer = drawer; }
};
window.window = window;
const context = vm.createContext({
    window, document, structuredClone,
    readerState: { theme: 'paper', fontSize: 18, controlSyncDepth: 0 }
});
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'desktop', 'shell', 'reader-appearance-studio.js'), 'utf8');
vm.runInContext(source, context, { filename: 'reader-appearance-studio.js' });
window.initializeReaderAppearanceStudio();

assert.strictEqual(tabs.find(tab => tab.dataset.readerStudioTab === 'typography')['aria-selected'], 'true',
    'the settings drawer opens on its high-value typography section by default');
assert.strictEqual(sections.find(section => section.dataset.readerStudioSection === 'typography').hidden, false);
assert.strictEqual(quickLayout.value, 'auto', 'missing layout preferences use responsive auto layout');

quickMore.dispatch('click');
assert.strictEqual(quickTools.open, false, 'More closes the quick-tools disclosure before opening settings');
assert.strictEqual(openedDrawer, 'right');

console.log('Reader appearance studio tests passed.');
