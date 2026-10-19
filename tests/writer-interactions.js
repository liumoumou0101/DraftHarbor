const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the renderer's real event handlers with local DOM/storage/clipboard
// boundaries. No browser, Provider, project files, or user preferences are used.
function fixture(files = ['writer-overlays.js', 'writer-chrome.js', 'writer-bindings.js']) {
    const all = [];
    const listeners = new Map();
    const document = {
        activeElement: null,
        addEventListener: (name, fn) => listen(listeners, name, fn),
        removeEventListener: (name, fn) => unlisten(listeners, name, fn),
        querySelector: selector => all.find(node => node.matches(selector)) || null,
        querySelectorAll: selector => all.filter(node => node.matches(selector)),
        getElementById: id => all.find(node => node.id === id) || null,
        fire: (name, options) => fire(listeners, name, options)
    };
    function element(tag = 'button', attributes = {}, parent = null) {
        const attrs = new Map(Object.entries(attributes));
        const classes = new Set((attributes.class || '').split(' ').filter(Boolean));
        const events = new Map();
        const properties = new Map();
        const node = {
            tagName: tag.toUpperCase(), id: attributes.id || '', dataset: {}, parentElement: parent,
            hidden: false, disabled: false, readOnly: false, value: '', selectionStart: 0, selectionEnd: 0, tabIndex: 0,
            classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value), toggle(value, on) { if (on) classes.add(value); else classes.delete(value); } },
            style: { setProperty: (key, value) => properties.set(key, value), getPropertyValue: key => properties.get(key) || '', removeProperty: key => properties.delete(key) },
            setAttribute(key, value) { attrs.set(key, String(value)); }, getAttribute: key => attrs.get(key) ?? null,
            hasAttribute: key => attrs.has(key),
            matches(selector) {
                return selector.split(',').some(part => {
                    let value = part.trim();
                    const negative = [...value.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
                    value = value.replace(/:not\([^)]+\)/g, '');
                    if (negative.some(item => node.matches(item))) return false;
                    const name = value.match(/^[a-z]+/i);
                    if (name && node.tagName !== name[0].toUpperCase()) return false;
                    const className = value.match(/\.([\w-]+)/);
                    if (className && !classes.has(className[1])) return false;
                    return [...value.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, key, expected]) => {
                        if (key === 'disabled') return node.disabled;
                        if (key === 'hidden') return node.hidden;
                        if (key === 'open') return !!node.open;
                        const actual = key.startsWith('data-') ? node.dataset[dataKey(key)] : attrs.get(key);
                        return expected === undefined ? actual !== undefined : actual === expected;
                    });
                });
            },
            closest(selector) { return node.matches(selector) ? node : parent?.closest(selector) || null; },
            querySelector: selector => descendants().find(child => child.matches(selector)) || null,
            querySelectorAll: selector => descendants().filter(child => child.matches(selector)),
            contains(other) { return other === node || descendants().includes(other); },
            addEventListener: (name, fn) => listen(events, name, fn),
            removeEventListener: (name, fn) => unlisten(events, name, fn),
            fire: (name, options = {}) => fire(events, name, { target: node, ...options }),
            click() { return node.fire('click'); },
            focus() { document.activeElement = node; },
            select() { node.selectionStart = 0; node.selectionEnd = node.value.length; },
            setSelectionRange(start, end) { node.selectionStart = start; node.selectionEnd = end; },
            getBoundingClientRect: () => ({ x: 20, y: 20, left: 20, top: 20, right: 120, bottom: 60, width: 100, height: 40 }),
            get offsetParent() { return node.closest('[hidden]') ? null : parent || document; },
            isConnected: true
        };
        function descendants() { return all.filter(other => { for (let p = other.parentElement; p; p = p.parentElement) if (p === node) return true; return false; }); }
        for (const [key, value] of attrs) if (key.startsWith('data-')) node.dataset[dataKey(key)] = value;
        all.push(node);
        return node;
    }
    const desktop = element('main', { id: 'desktop-root', 'data-view': 'writer' });
    const root = element('section', { 'data-native-writer': '' }, desktop);
    root.getBoundingClientRect = () => ({ width: 1600, height: 900 });
    const editor = element('textarea', { 'data-native-scene-editor': '' }, root);
    editor.value = '尚未保存的完整正文';
    const sceneList = element('div', { 'data-native-scene-list': '' }, root);
    const sceneControl = element('button', { 'data-native-scene-id': 's' }, sceneList);
    const moreButton = element('button', { 'data-native-more-tools': '' }, root);
    const moreMenu = element('div', { 'data-native-more-menu': '' }, root); moreMenu.hidden = true;
    const outlineMenu = element('div', { 'data-native-outline-menu': '' }, root); outlineMenu.hidden = true;
    const contextMenu = element('div', { 'data-native-context-menu': '' }, root); contextMenu.hidden = true;
    for (const action of ['rename', 'move-up', 'move-down', 'delete']) element('button', { 'data-native-outline-action': action }, outlineMenu);
    for (const action of ['view-summary', 'format-manuscript', 'save']) element('button', { 'data-native-context-action': action }, contextMenu);
    for (const action of ['first', 'second']) element('button', { 'data-more-test': action }, moreMenu);
    const tabs = ['generate', 'rewrite', 'history', 'metadata'].map((key, index) => element('button', { 'data-native-panel-tab': key, 'data-native-panel-group': index < 3 ? 'writing' : 'document' }, root));
    const panels = tabs.map(tab => element('section', { 'data-native-panel': tab.dataset.nativePanelTab }, root));
    const groupTabs = ['writing', 'document'].map(group => element('button', { 'data-native-assistant-group': group }, root));
    const copy = element('button', { 'data-native-copy-unsaved-draft': '' }, root);
    const notice = element('div', { 'data-native-save-notice': '' }, root);
    const outline = element('aside', { class: 'desktop-native-outline' }, root);
    const assistant = element('aside', { class: 'desktop-native-assistant' }, root);
    outline.getBoundingClientRect = () => ({ width: Number.parseFloat(root.style.getPropertyValue('--native-outline-width')) || 240 });
    assistant.getBoundingClientRect = () => ({ width: Number.parseFloat(root.style.getPropertyValue('--native-assistant-width')) || 360, height: Number.parseFloat(root.style.getPropertyValue('--native-assistant-height')) || 300 });
    const outlineHandle = element('div', { 'data-native-resize-outline': '' }, root);
    const assistantHandle = element('div', { 'data-native-resize-assistant': '' }, root);
    const elements = { root, editor, contextMenu, sceneList, copyUnsavedDraft: copy, saveNotice: notice, panelTabs: tabs, assistantGroupTabs: groupTabs, panels, specialButtons: [] };
    const state = { snapshot: { project: { id: 'p' }, scenes: [{ id: 's', chapterId: 'c', summary: '摘要' }], chapters: [{ id: 'c' }] }, activeSceneId: 's', activeChapterId: 'c', generation: {}, rewrite: {}, expandedChapterIds: new Set(), assistantPanel: 'generate', searchQuery: '' };
    const storage = new Map();
    const calls = [], statuses = [], clipboard = [];
    const windowEvents = new Map();
    const window = {
        innerWidth: 1600, innerHeight: 900,
        addEventListener: (name, fn) => listen(windowEvents, name, fn),
        fire: (name, options) => fire(windowEvents, name, options),
        matchMedia: () => ({ matches: false }),
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
    };
    const context = vm.createContext({
        console, document, window, nativeEditorState: state, nativeEditorElements: () => elements,
        navigator: { clipboard: { writeText: async text => clipboard.push(text) } },
        renderNativeEditor() {}, renderNativeRewrite() {}, renderNativeGeneration() {},
        currentNativeScene: () => state.snapshot.scenes.find(scene => scene.id === state.activeSceneId),
        currentNativeChapterByState: () => state.snapshot.chapters.find(chapter => chapter.id === state.activeChapterId),
        closeNativeWriterPopovers(options = {}) { if (options.keep !== 'context-menu') contextMenu.hidden = true; },
        saveNativeScene: () => calls.push('save'), addNativeScene: () => calls.push('new'), switchNativeScene: direction => calls.push(direction),
        replaceNativeText: mode => calls.push(`replace-${mode}`), applyNativeManuscriptFormat: () => calls.push('format'),
        markNativeDirty: () => calls.push('dirty'), applyNativeAutoReplace: () => calls.push('auto-replace'),
        setNativeSaveStatus: (...status) => statuses.push(status),
        nativeGenerationEditorLocked: () => editor.readOnly
    });
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell', file), 'utf8'), context);
    return { context, document, window, element, desktop, root, editor, sceneList, sceneControl, moreButton, moreMenu, outlineMenu, contextMenu, tabs, groupTabs, panels, copy, notice, outlineHandle, assistantHandle, elements, state, storage, calls, statuses, clipboard };
}
function dataKey(key) { return key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()); }
function listen(map, key, fn) { if (!map.has(key)) map.set(key, []); map.get(key).push(fn); }
function unlisten(map, key, fn) { map.set(key, (map.get(key) || []).filter(item => item !== fn)); }
function fire(map, key, options = {}) {
    const event = { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, clientX: 30, clientY: 30, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...options };
    event.settled = Promise.all((map.get(key) || []).map(fn => fn(event)));
    return event;
}
function deferred() {
    let resolve;
    const promise = new Promise(finish => { resolve = finish; });
    return { promise, resolve };
}
function recoveryFixture() {
    const f = fixture();
    const reload = f.element('button', { 'data-native-reload-saved-draft': '' }, f.root);
    f.elements.reloadSavedDraft = reload;
    const original = f.state.snapshot;
    original.sceneContents = { s: '旧的已保存正文', another: '另一场景也须完整备份' };
    original.prompts = [{ id: 'prompt', content: '完整提示模板' }];
    original.compendium = [{ id: 'entry', body: '完整资料内容' }];
    f.state.saveError = '保存冲突'; f.state.dirty = true;
    const saved = { project: { id: 'p' }, scenes: [{ id: 's', chapterId: 'c' }], sceneContents: { s: '磁盘版本正文' }, chapters: [{ id: 'c' }] };
    const confirmations = [], operations = [], loaded = [];
    f.window.confirm = text => { confirmations.push(text); return true; };
    f.window.WorkshopAgent = { canLeave: () => true };
    f.context.flushNativeEditorFields = () => { f.state.snapshot.sceneContents[f.state.activeSceneId] = f.editor.value; };
    f.context.fetchProjectSnapshot = async project => {
        assert.strictEqual(project.id, 'p'); operations.push('fetch'); return saved;
    };
    f.context.navigator.clipboard.writeText = async text => { operations.push('backup'); f.clipboard.push(text); };
    f.context.loadNativeProjectEditor = snapshot => {
        operations.push('load'); loaded.push(snapshot); f.state.snapshot = structuredClone(snapshot); f.editor.value = snapshot.sceneContents.s;
        f.state.saveError = ''; f.state.dirty = false;
    };
    for (const name of ['loadReaderFromProjectSnapshot', 'loadCompendium', 'loadPrompts', 'loadRewritePrompts', 'loadSummaryPrompts', 'loadWorkshopSessions', 'loadWorkflowRuns']) {
        f.context[name] = async () => { operations.push(name); };
    }
    f.context.bindNativeEditor();
    return { ...f, reload, original, saved, confirmations, operations, loaded };
}
const cases = [
    ['writer shortcuts stay inactive on other pages and in open dialogs', () => {
        const f = fixture(); f.context.bindNativeEditor();
        f.desktop.dataset.view = 'settings';
        for (const options of [{ key: 's', ctrlKey: true }, { key: 'N', ctrlKey: true, shiftKey: true }, { key: 'ArrowDown', altKey: true }]) {
            assert.strictEqual(f.window.fire('keydown', options).defaultPrevented, false);
        }
        f.desktop.dataset.view = 'writer'; f.element('dialog', { open: '' }).open = true;
        for (const options of [{ key: 's', ctrlKey: true }, { key: 'N', ctrlKey: true, shiftKey: true }, { key: 'ArrowDown', altKey: true }]) {
            assert.strictEqual(f.window.fire('keydown', options).defaultPrevented, false);
        }
        assert.deepStrictEqual(f.calls, []);
    }],
    ['saving remains available in text fields while navigation preserves field keys', () => {
        const f = fixture(); f.context.bindNativeEditor(); f.editor.focus();
        assert.strictEqual(f.window.fire('keydown', { key: 's', ctrlKey: true, target: f.editor }).defaultPrevented, true);
        f.window.fire('keydown', { key: 'N', ctrlKey: true, shiftKey: true, target: f.editor });
        f.window.fire('keydown', { key: 'ArrowDown', altKey: true, target: f.editor });
        assert.deepStrictEqual(f.calls, ['save']);
        f.sceneControl.focus();
        f.window.fire('keydown', { key: 'N', ctrlKey: true, shiftKey: true, target: f.sceneControl });
        f.window.fire('keydown', { key: 'ArrowDown', altKey: true, target: f.sceneControl });
        assert.deepStrictEqual(f.calls, ['save', 'new', 1]);
    }],
    ['composition and handled key events do not start writer commands', () => {
        const f = fixture(); f.context.bindNativeEditor();
        f.window.fire('keydown', { key: 's', ctrlKey: true, isComposing: true });
        f.window.fire('keydown', { key: 's', ctrlKey: true, defaultPrevented: true });
        assert.deepStrictEqual(f.calls, []);
    }],
    ['sidebar keyboard resize clamps sizes, reports them, and resets preferences', () => {
        const f = fixture(['writer-sidebar-resize.js']); f.context.bindNativeSidebarResize();
        f.outlineHandle.fire('keydown', { key: 'ArrowRight' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-outline-width'), '260px');
        assert.strictEqual(f.outlineHandle.getAttribute('aria-valuenow'), '260');
        f.outlineHandle.fire('keydown', { key: 'Home' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-outline-width'), '210px');
        f.outlineHandle.fire('keydown', { key: 'End' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-outline-width'), '860px');
        f.outlineHandle.fire('keydown', { key: 'Enter' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-outline-width'), '');
        assert.strictEqual(JSON.parse(f.storage.get('draftharbor:nativeSidebarWidths')).outline, 0);
        f.assistantHandle.fire('keydown', { key: 'ArrowLeft' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-assistant-width'), '380px');
        assert.strictEqual(f.assistantHandle.getAttribute('aria-valuenow'), '380');
    }],
    ['bottom assistant uses height keys and updates separator orientation', () => {
        const f = fixture(['writer-sidebar-resize.js']); f.root.classList.add('is-assistant-bottom'); f.context.bindNativeSidebarResize();
        f.assistantHandle.fire('keydown', { key: 'ArrowUp' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-assistant-height'), '320px');
        assert.strictEqual(f.assistantHandle.getAttribute('aria-orientation'), 'horizontal');
        assert.strictEqual(f.assistantHandle.getAttribute('aria-valuenow'), '320');
        f.assistantHandle.fire('keydown', { key: 'Home' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-assistant-height'), '280px', 'minimum keeps the bottom generation controls visible');
        assert.strictEqual(f.assistantHandle.getAttribute('aria-valuemin'), '280');
        f.assistantHandle.fire('keydown', { key: 'End' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-assistant-height'), '620px');
        f.assistantHandle.fire('keydown', { key: 'Enter' });
        assert.strictEqual(f.root.style.getPropertyValue('--native-assistant-height'), '');
        assert.strictEqual(f.storage.has('draftharbor:nativeAssistantHeight'), false);
    }],
    ['automatic sidebar widths survive hidden and narrow to wide layout changes', () => {
        const f = fixture(['writer-sidebar-resize.js']);
        const outline = f.root.querySelector('.desktop-native-outline');
        const assistant = f.root.querySelector('.desktop-native-assistant');
        let measuredOutline = 0, measuredAssistant = 0;
        outline.getBoundingClientRect = () => ({ width: measuredOutline });
        assistant.getBoundingClientRect = () => ({ width: measuredAssistant, height: 300 });
        f.context.bindNativeSidebarResize();
        measuredOutline = 461; measuredAssistant = 461; f.window.innerWidth = 960;
        f.window.fire('resize');
        measuredOutline = 240; measuredAssistant = 360; f.window.innerWidth = 1280;
        f.window.fire('resize');
        assert.strictEqual(f.root.style.getPropertyValue('--native-outline-width'), '', 'automatic outline sizing must remain automatic');
        assert.strictEqual(f.root.style.getPropertyValue('--native-assistant-width'), '', 'automatic assistant sizing must remain automatic');
        assert.strictEqual(f.storage.has('draftharbor:nativeSidebarWidths'), false);
    }],
    ['keyboard resizing preserves the other sidebar automatic width intent', () => {
        const f = fixture(['writer-sidebar-resize.js']); f.context.bindNativeSidebarResize();
        f.outlineHandle.fire('keydown', { key: 'ArrowRight' });
        const saved = JSON.parse(f.storage.get('draftharbor:nativeSidebarWidths'));
        assert.strictEqual(saved.outline, 260); assert.strictEqual(saved.assistant, 0);
    }],
    ['editor menu skips disabled actions and restores the editor on Escape', () => {
        const f = fixture(); f.context.bindNativeEditor(); f.editor.focus();
        f.context.openNativeEditorContextMenu(50, 50);
        const buttons = f.contextMenu.querySelectorAll('button'); buttons[1].disabled = true;
        f.contextMenu.fire('keydown', { key: 'End' }); assert.ok(f.document.activeElement === buttons[2], 'End focuses last enabled action');
        f.contextMenu.fire('keydown', { key: 'ArrowUp' }); assert.ok(f.document.activeElement === buttons[0], 'Up skips disabled action');
        f.contextMenu.fire('keydown', { key: 'Home' }); assert.ok(f.document.activeElement === buttons[0], 'Home focuses first enabled action');
        f.contextMenu.fire('keydown', { key: 'ArrowDown' }); assert.ok(f.document.activeElement === buttons[2], 'Down skips disabled action');
        f.contextMenu.fire('keydown', { key: 'Escape' });
        assert.strictEqual(f.contextMenu.hidden, true); assert.ok(f.document.activeElement === f.editor, 'Escape restores editor focus');
    }],
    ['outline menu navigation returns focus to its scene control', () => {
        const f = fixture(); f.context.bindNativeEditor(); f.sceneControl.focus();
        f.sceneList.fire('contextmenu', { target: f.sceneControl });
        const buttons = f.outlineMenu.querySelectorAll('button');
        f.outlineMenu.fire('keydown', { key: 'End' }); assert.ok(f.document.activeElement === buttons[3], 'End focuses last outline action');
        f.outlineMenu.fire('keydown', { key: 'ArrowDown' }); assert.ok(f.document.activeElement === buttons[0], 'Down wraps to first outline action');
        f.document.fire('keydown', { key: 'Escape' });
        assert.strictEqual(f.outlineMenu.hidden, true); assert.ok(f.document.activeElement === f.sceneControl, 'Escape restores outline origin');
    }],
    ['menu actions restore editor focus before invoking their command', () => {
        const f = fixture(); f.context.bindNativeEditor();
        f.context.openNativeEditorContextMenu(50, 50);
        const save = f.contextMenu.querySelector('[data-native-context-action="save"]'); save.focus();
        f.document.fire('click', { target: save });
        assert.deepStrictEqual(f.calls, ['save']);
        assert.ok(f.document.activeElement === f.editor, 'action returns focus to the editor');
    }],
    ['outline menu can be opened from its focused control using the keyboard', () => {
        const f = fixture(); f.context.bindNativeEditor(); f.sceneControl.focus();
        assert.strictEqual(f.sceneList.fire('keydown', { key: 'F10', shiftKey: true, target: f.sceneControl }).defaultPrevented, true);
        assert.strictEqual(f.outlineMenu.hidden, false);
    }],
    ['opening another scene menu flushes the old editor before selecting its target', () => {
        const f = fixture(); f.context.bindNativeEditor();
        f.state.snapshot.sceneContents = { s: '已保存正文', other: '另一个场景正文' };
        f.state.snapshot.scenes.push({ id: 'other', chapterId: 'c' });
        const other = f.element('button', { 'data-native-scene-id': 'other' }, f.sceneList);
        f.context.flushNativeEditorFields = () => { f.state.snapshot.sceneContents[f.state.activeSceneId] = f.editor.value; };
        f.context.renderNativeEditor = () => { f.editor.value = f.state.snapshot.sceneContents[f.state.activeSceneId]; };
        f.sceneList.fire('contextmenu', { target: other });
        assert.strictEqual(f.state.snapshot.sceneContents.s, '尚未保存的完整正文');
        assert.strictEqual(f.state.snapshot.sceneContents.other, '另一个场景正文');
        assert.strictEqual(f.editor.value, '另一个场景正文');
    }],
    ['tabs activate with arrow keys and expose a single selected focus target', () => {
        const f = fixture(); f.context.bindNativeEditor();
        f.tabs[0].fire('keydown', { key: 'ArrowRight' });
        assert.strictEqual(f.state.assistantPanel, 'rewrite');
        assert.ok(f.document.activeElement === f.tabs[1], 'Arrow focuses activated tab');
        assert.strictEqual(f.tabs[1].getAttribute('aria-selected'), 'true');
        assert.strictEqual(f.tabs[1].tabIndex, 0); assert.strictEqual(f.tabs[0].tabIndex, -1);
        assert.strictEqual(f.panels[0].hidden, true); assert.strictEqual(f.panels[1].hidden, false);
        f.tabs[1].fire('keydown', { key: 'End' }); assert.strictEqual(f.state.assistantPanel, 'history');
        f.tabs[2].fire('keydown', { key: 'ArrowRight' }); assert.strictEqual(f.state.assistantPanel, 'generate');
    }],
    ['history retry activates the generate panel and updates tab and group state', async () => {
        const f = fixture(['writer-overlays.js', 'writer-chrome.js', 'writer-generation.js', 'writer-bindings.js']);
        f.context.settingsState = { runtimeProvider: {} };
        f.context.startNativeGeneration = async () => { f.context.renderNativeGeneration(); };
        f.context.bindNativeEditor(); f.tabs[2].click();
        assert.strictEqual(f.panels[0].hidden, true);
        await f.context.retryNativeHistoryRecord({ beat: '重试历史请求' });
        assert.strictEqual(f.panels[0].hidden, false, 'history retry reveals the composer');
        assert.strictEqual(f.panels[2].hidden, true); assert.strictEqual(f.tabs[0].getAttribute('aria-selected'), 'true');
        assert.strictEqual(f.tabs[0].tabIndex, 0); assert.strictEqual(f.tabs[2].tabIndex, -1);
        assert.strictEqual(f.panels[0].classList.contains('is-active'), true);
        assert.strictEqual(f.panels[2].classList.contains('is-active'), false);
        assert.strictEqual(f.state.assistantPanelByGroup.writing, 'generate');
        assert.strictEqual(f.groupTabs[0].getAttribute('aria-pressed'), 'true');
        assert.strictEqual(f.groupTabs[1].getAttribute('aria-pressed'), 'false');
    }],
    ['programmatic rewrite rendering updates panel visibility without replacing prose', () => {
        const f = fixture(); f.context.bindNativeEditor();
        f.tabs[3].click(); f.state.assistantPanel = 'rewrite'; f.context.renderNativeRewrite();
        assert.strictEqual(f.panels[1].hidden, false); assert.strictEqual(f.panels[3].hidden, true);
        assert.strictEqual(f.tabs[1].getAttribute('aria-selected'), 'true');
        assert.strictEqual(f.panels[1].classList.contains('is-active'), true);
        assert.strictEqual(f.editor.value, '尚未保存的完整正文');
    }],
    ['generation lock blocks mutation entry points and outline target changes', () => {
        const f = fixture(); f.elements.replaceCurrent = f.element(); f.elements.replaceAll = f.element(); f.context.bindNativeEditor();
        f.editor.readOnly = true;
        assert.strictEqual(f.editor.fire('beforeinput').defaultPrevented, true);
        f.editor.fire('input');
        f.elements.replaceCurrent.click(); f.elements.replaceAll.click();
        f.document.fire('click', { target: f.contextMenu.querySelector('[data-native-context-action="format-manuscript"]') });
        assert.deepStrictEqual(f.calls, []);
        const other = f.element('button', { 'data-native-scene-id': 'other' }, f.sceneList);
        f.state.snapshot.scenes.push({ id: 'other', chapterId: 'c' });
        f.sceneList.fire('contextmenu', { target: other }); assert.strictEqual(f.state.activeSceneId, 's');
    }],
    ['copy unsaved draft copies the complete editor without clearing the notice', async () => {
        const f = fixture(); f.context.bindNativeEditor();
        await f.copy.click().settled;
        assert.deepStrictEqual(f.clipboard, ['尚未保存的完整正文']); assert.strictEqual(f.notice.hidden, false);
        f.context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
        await f.copy.click().settled;
        assert.ok(f.document.activeElement === f.editor, 'clipboard fallback focuses the prose');
        assert.strictEqual(f.editor.selectionEnd, f.editor.value.length);
        assert.ok(f.statuses.at(-1)[0].includes('Ctrl+C'));
    }],
    ['recovery confirms and copies a complete project backup before loading disk', async () => {
        const f = recoveryFixture();
        await f.reload.click().settled;
        assert.strictEqual(f.confirmations.length, 1);
        assert.ok(f.confirmations[0].includes('JSON') && f.confirmations[0].includes('.json'));
        assert.deepStrictEqual(f.operations.slice(0, 3), ['fetch', 'backup', 'load']);
        assert.deepStrictEqual(JSON.parse(f.clipboard[0]), { ...f.original, sceneContents: { s: '尚未保存的完整正文', another: '另一场景也须完整备份' } });
        assert.strictEqual(f.loaded[0], f.saved); assert.strictEqual(f.editor.value, '磁盘版本正文');
        assert.ok(f.operations.includes('loadReaderFromProjectSnapshot') && f.operations.includes('loadCompendium') && f.operations.includes('loadPrompts'));
        assert.strictEqual(f.reload.disabled, false);
    }],
    ['recovery cancellation and Workshop leave rejection preserve the original draft', async () => {
        for (const reject of ['confirm', 'workshop']) {
            const f = recoveryFixture();
            if (reject === 'confirm') f.window.confirm = text => { f.confirmations.push(text); return false; };
            else f.window.WorkshopAgent.canLeave = () => false;
            await f.reload.click().settled;
            assert.strictEqual(f.state.snapshot, f.original); assert.strictEqual(f.editor.value, '尚未保存的完整正文');
            assert.deepStrictEqual(f.operations, []); assert.deepStrictEqual(f.clipboard, []);
            assert.strictEqual(f.confirmations.length, reject === 'confirm' ? 1 : 0);
        }
    }],
    ['failed backup leaves the manuscript intact with an actionable error', async () => {
        const f = recoveryFixture();
        f.context.navigator.clipboard.writeText = async () => { throw new Error('clipboard denied'); };
        await f.reload.click().settled;
        assert.strictEqual(f.state.snapshot, f.original); assert.strictEqual(f.editor.value, '尚未保存的完整正文');
        assert.deepStrictEqual(f.loaded, []); assert.strictEqual(f.state.dirty, true); assert.strictEqual(f.reload.disabled, false);
        assert.ok(f.statuses.length > 0, 'failed backup reports an error');
        assert.ok(f.statuses.at(-1)[0].includes('备份') && f.statuses.at(-1)[1] === 'error');
    }],
    ['recovery rejects edits and project changes while disk or clipboard awaits', async () => {
        for (const boundary of ['fetch', 'clipboard']) for (const change of ['editor', 'project']) {
            const f = recoveryFixture(), pending = deferred();
            if (boundary === 'fetch') f.context.fetchProjectSnapshot = () => { f.operations.push('fetch'); return pending.promise; };
            else f.context.navigator.clipboard.writeText = () => { f.operations.push('backup'); return pending.promise; };
            const clicked = f.reload.click().settled;
            // Let the fetch complete before editing during the clipboard wait.
            await new Promise(setImmediate);
            assert.strictEqual(f.confirmations.length, 1);
            assert.ok(f.operations.includes(boundary === 'fetch' ? 'fetch' : 'backup'), 'recovery must reach the awaited boundary');
            const nextSnapshot = change === 'project' ? { project: { id: 'q' }, scenes: [], sceneContents: {} } : f.original;
            if (change === 'project') f.state.snapshot = nextSnapshot;
            f.editor.value = '等待期间的新输入';
            pending.resolve(boundary === 'fetch' ? f.saved : undefined);
            await clicked;
            assert.strictEqual(f.state.snapshot, nextSnapshot); assert.strictEqual(f.editor.value, '等待期间的新输入');
            assert.deepStrictEqual(f.loaded, [], `${boundary}/${change} must not replace new work`);
            assert.strictEqual(f.reload.disabled, false);
        }
    }],
    ['recovery rejects a different disk project and serializes repeated clicks', async () => {
        const f = recoveryFixture(), pending = deferred();
        f.context.fetchProjectSnapshot = () => { f.operations.push('fetch'); return pending.promise; };
        const first = f.reload.click().settled, second = f.reload.click().settled;
        await second;
        pending.resolve({ ...f.saved, project: { id: 'other' } }); await first;
        assert.strictEqual(f.confirmations.length, 1); assert.deepStrictEqual(f.operations, ['fetch']);
        assert.strictEqual(f.state.snapshot, f.original); assert.deepStrictEqual(f.loaded, []);
    }],
    ['recovery preserves unsaved compendium forms that are not in the project backup', async () => {
        for (const boundary of ['before', 'clipboard']) {
            const f = recoveryFixture(), pending = deferred();
            f.context.compendiumState = { dirty: boundary === 'before' };
            if (boundary === 'clipboard') f.context.navigator.clipboard.writeText = () => pending.promise;
            const clicked = f.reload.click().settled;
            await new Promise(setImmediate);
            f.context.compendiumState.dirty = true; pending.resolve(); await clicked;
            assert.strictEqual(f.state.snapshot, f.original); assert.deepStrictEqual(f.loaded, []);
            assert.ok(f.statuses.at(-1)[0].includes('资料'), 'unbacked compendium edits need a specific explanation');
        }
    }],
    ['Workshop leave rejection after backup prevents disk replacement', async () => {
        const f = recoveryFixture(), pending = deferred();
        f.context.navigator.clipboard.writeText = () => pending.promise;
        const clicked = f.reload.click().settled;
        await new Promise(setImmediate);
        f.window.WorkshopAgent.canLeave = () => false; pending.resolve(); await clicked;
        assert.strictEqual(f.state.snapshot, f.original); assert.deepStrictEqual(f.loaded, []);
        assert.ok(f.statuses.at(-1)[0].includes('未载入'), 'a rejected recovery must not leave an in-progress message');
    }],
    ['recovery preserves title edits that are not yet represented in the snapshot', async () => {
        for (const boundary of ['before', 'clipboard']) {
            const f = recoveryFixture(), pending = deferred();
            f.state.titleEditing = boundary === 'before';
            if (boundary === 'clipboard') f.context.navigator.clipboard.writeText = () => pending.promise;
            const clicked = f.reload.click().settled; await new Promise(setImmediate);
            f.state.titleEditing = true; pending.resolve(); await clicked;
            assert.strictEqual(f.state.snapshot, f.original); assert.deepStrictEqual(f.loaded, []);
            assert.ok(f.statuses.at(-1)[0].includes('标题'));
        }
    }]
];
(async () => {
    let failed = 0;
    for (const [name, run] of cases) {
        try { await run(); console.log(`PASS ${name}`); }
        catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
    }
    if (failed) { process.exitCode = 1; console.error(`Writer interaction tests: ${failed}/${cases.length} failed.`); }
    else console.log(`Writer interaction tests passed (${cases.length} cases).`);
})();
