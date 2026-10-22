(function () {
    'use strict';

    const STORAGE_KEY = 'draftharbor:writerDesk:v1';
    const TOOL_PANELS = ['characters', 'context', 'metadata', 'structure', 'search', 'history'];
    const state = { enabled: true, night: false, reduceMotion: false, mode: 'write', tool: 'overview', lastPanel: null };
    const movedPanels = [];
    const foldedControls = [];
    let root = null;
    let bound = false;
    let referenceSignature = '';

    function find(selector) { return root && root.querySelector(selector); }
    function all(selector) { return root ? Array.from(root.querySelectorAll(selector)) : []; }
    function setText(selector, value) {
        const node = find(selector);
        if (node && node.textContent !== value) node.textContent = value;
    }
    function loadPreferences() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {};
            state.enabled = saved.enabled !== false;
            state.night = saved.night === true;
            state.reduceMotion = typeof saved.reduceMotion === 'boolean' ? saved.reduceMotion
                : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_error) { /* Defaults remain usable if storage is unavailable. */ }
    }
    function savePreferences() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: state.enabled, night: state.night, reduceMotion: state.reduceMotion }));
        } catch (_error) { /* Appearance is still applied for this session. */ }
    }

    function rememberPosition(node) {
        const marker = document.createComment('writer desk original position');
        node.parentNode.insertBefore(marker, node);
        return { node, marker };
    }
    function restorePosition(item) { item.marker.parentNode.insertBefore(item.node, item.marker.nextSibling); }
    function prepareLayout() {
        ['generate', 'rewrite'].forEach(name => {
            const panel = find(`[data-native-panel="${name}"]`);
            if (panel) movedPanels.push(rememberPosition(panel));
        });
        [
            { parent: '.desktop-native-generation', selectors: ['.desktop-native-copilot-brief', '.desktop-native-copilot-context', '.desktop-native-copilot-suggestions'], title: '上下文与灵感', className: 'writer-desk-generation-details' },
            { parent: '.desktop-native-rewrite', selectors: ['.desktop-native-rewrite-tools'], title: '改写预设与已保存提示词', className: 'writer-desk-rewrite-details' }
        ].forEach(config => {
            const parent = find(config.parent);
            if (!parent) return;
            const items = config.selectors.map(selector => parent.querySelector(selector)).filter(Boolean).map(rememberPosition);
            if (!items.length) return;
            const details = document.createElement('details');
            details.className = `writer-desk-advanced ${config.className}`;
            const summary = document.createElement('summary');
            summary.textContent = config.title;
            details.appendChild(summary);
            parent.appendChild(details);
            foldedControls.push({ details, items });
        });
    }
    function applyLayout() {
        if (!root) return;
        const dock = find('[data-native-desk-dock]');
        root.classList.toggle('is-literary-desk', state.enabled);
        root.classList.toggle('is-desk-night', state.night);
        root.classList.toggle('is-desk-reduced-motion', state.reduceMotion);
        // Relocation happens only when the layout changes, never during input or streaming.
        movedPanels.forEach(item => {
            if (state.enabled && item.node.parentNode !== dock) dock.appendChild(item.node);
            else if (!state.enabled && item.node.parentNode !== item.marker.parentNode) restorePosition(item);
        });
        foldedControls.forEach(group => {
            group.details.hidden = !state.enabled;
            group.items.forEach(item => {
                if (state.enabled && item.node.parentNode !== group.details) group.details.appendChild(item.node);
                else if (!state.enabled && item.node.parentNode !== item.marker.parentNode) restorePosition(item);
            });
        });
        if (dock) dock.hidden = !state.enabled;
        for (const selector of ['[data-native-desk-modes]', '[data-native-desk-sidebar-toolbar]']) {
            const node = find(selector);
            if (node) node.hidden = !state.enabled;
        }
        for (const selector of ['.desktop-native-assistant-header', '.desktop-native-assistant-group-tabs', '.desktop-native-assistant-tabs', '[data-native-resize-assistant]', '[data-native-assistant-placement]']) {
            const node = find(selector);
            if (node) node.hidden = state.enabled;
        }
        const layoutButton = find('[data-native-desk-layout]');
        if (layoutButton) {
            layoutButton.textContent = state.enabled ? '经典布局' : '文学书桌';
            layoutButton.setAttribute('aria-pressed', String(state.enabled));
        }
        syncPresentation();
        syncAppearanceControls();
        syncOverview();
    }

    function syncPresentation() {
        if (!bound || !root) return;
        const panel = nativeEditorState.assistantPanel;
        if (panel !== state.lastPanel) {
            if (panel === 'rewrite') state.mode = 'revise';
            else if (panel === 'generate') state.mode = nativeEditorState.generation.genTask === 'beat' ? 'conceive' : 'write';
            else if (TOOL_PANELS.includes(panel)) state.tool = panel;
            state.lastPanel = panel;
        }
        const overview = find('[data-native-desk-overview]');
        if (overview) overview.hidden = !state.enabled || state.tool !== 'overview';
        if (!state.enabled) return;
        const composerPanel = state.mode === 'revise' ? 'rewrite' : 'generate';
        const output = find('[data-native-generation-output]');
        const hasResult = !!output && !output.hidden;
        root.classList.toggle('has-desk-result', hasResult);
        if (!hasResult) root.classList.remove('is-desk-composer-expanded');
        const composerToggle = find('[data-native-desk-composer-toggle]');
        if (composerToggle) {
            composerToggle.hidden = !hasResult;
            const expanded = root.classList.contains('is-desk-composer-expanded');
            composerToggle.setAttribute('aria-expanded', String(expanded));
            composerToggle.textContent = expanded ? '收起要求' : '调整要求';
        }
        all('[data-native-panel]').forEach(node => {
            const name = node.dataset.nativePanel;
            const visible = name === composerPanel || name === state.tool;
            node.hidden = !visible;
            node.classList.toggle('is-active', visible);
        });
        all('[data-native-desk-mode]').forEach(button => {
            const active = button.dataset.nativeDeskMode === state.mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        const picker = find('[data-native-desk-tool]');
        if (picker && picker.value !== state.tool) picker.value = state.tool;
        const exit = find('[data-native-desk-focus-exit]');
        if (exit) exit.hidden = !nativeEditorState.focusMode;
        root.dataset.deskMode = state.mode;
        const titles = { write: ['把故事往前写', '从这一刻，写下下一段。'], conceive: ['这一场，接下来发生什么', '用具体的剧情方向，写出下一拍。'], revise: ['让文字更贴近你的心意', '在正文中选一段，再写下修订要求。'] };
        setText('[data-native-desk-dock-title]', titles[state.mode][0]);
        setText('[data-native-desk-dock-hint]', titles[state.mode][1]);
    }

    function syncOverview() {
        if (!bound || !state.enabled) return;
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        const chapter = scene && snapshot && (snapshot.chapters || []).find(item => item.id === scene.chapterId);
        setText('[data-native-desk-scene-title]', scene ? (scene.title || '未命名场景') : '选择一个场景');
        const pov = scene && (scene.povCharacter || scene.pov);
        const meta = [chapter && chapter.title, pov ? `视角 · ${pov}` : '', scene && scene.tense ? (scene.tense === 'past' ? '过去时' : '现在时') : ''].filter(Boolean).join(' / ');
        setText('[data-native-desk-scene-meta]', meta);
        setText('[data-native-desk-scene-summary]', scene ? (scene.summary || '还没有场景摘要。记下这一场发生的事，让下一场有迹可循。') : '打开场景后，在这里查看摘要和叙事视角。');
        const entries = snapshot ? (compendiumState.entries || snapshot.compendium || []) : [];
        const ids = new Set((nativeEditorState.context && nativeEditorState.context.compendiumIds) || []);
        const selected = entries.filter(entry => ids.has(entry.id) || entry.alwaysInContext || entry.contextPolicy && entry.contextPolicy.mode === 'always');
        const displayed = (selected.length ? selected : entries).slice(0, 3);
        setText('[data-native-desk-reference-note]', selected.length ? `已选与常驻资料 ${selected.length} 项 · 完整引用见「管理引用」` : entries.length ? '项目资料速览 · 引用状态见「管理引用」' : '人物、地点和设定，都可以放在手边。');
        const signature = JSON.stringify([snapshot && snapshot.project && snapshot.project.id, selected.length, displayed.map(entry => [entry.id, entry.title, entry.type, entry.summary, entry.body, entry.content])]);
        if (signature === referenceSignature) return;
        referenceSignature = signature;
        const host = find('[data-native-desk-references]');
        if (!host) return;
        host.replaceChildren();
        displayed.forEach(entry => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'writer-desk-reference-card';
            card.dataset.nativeDeskReference = entry.id;
            const title = document.createElement('strong');
            title.textContent = entry.title || '未命名资料';
            const excerpt = document.createElement('span');
            excerpt.textContent = String(entry.summary || entry.body || entry.content || '').replace(/\s+/g, ' ').slice(0, 110) || '打开资料卡查看内容';
            card.append(title, excerpt);
            card.addEventListener('click', () => {
                if (snapshot !== nativeEditorState.snapshot) return;
                if (typeof window.openCompendiumPeek === 'function') window.openCompendiumPeek(entry.id, { trigger: card, source: 'writer' });
                else openTool('context');
            });
            host.appendChild(card);
        });
    }

    function openTool(tool) {
        if (tool !== 'overview' && !TOOL_PANELS.includes(tool)) return;
        state.tool = tool;
        nativeEditorState.assistantCollapsed = false;
        root.classList.remove('is-assistant-collapsed');
        if (tool !== 'overview') {
            nativeEditorState.assistantPanel = tool;
            if (tool === 'metadata' && typeof loadSummaryPrompts === 'function') loadSummaryPrompts();
        } else {
            // Keep the native route aligned with the visible composer. A later
            // native "edit summary" route can then reopen the metadata drawer.
            nativeEditorState.assistantPanel = state.mode === 'revise' ? 'rewrite' : 'generate';
        }
        state.lastPanel = nativeEditorState.assistantPanel;
        applyNativeWriterChrome();
        syncPresentation();
        syncOverview();
    }
    function selectMode(mode) {
        if (!['write', 'conceive', 'revise'].includes(mode)) return;
        state.mode = mode;
        nativeEditorState.assistantPanel = mode === 'revise' ? 'rewrite' : 'generate';
        nativeEditorState.assistantPanelByGroup = nativeEditorState.assistantPanelByGroup || {};
        nativeEditorState.assistantPanelByGroup.writing = nativeEditorState.assistantPanel;
        state.lastPanel = nativeEditorState.assistantPanel;
        if (mode === 'revise') {
            // The native capture retains the original scene/snapshot guards.
            if (typeof rememberNativeRewriteSelection === 'function') rememberNativeRewriteSelection();
            renderNativeRewrite();
        } else {
            const task = find(`[data-native-gen-task="${mode === 'conceive' ? 'beat' : 'continue'}"]`);
            if (task) task.click();
        }
        applyNativeWriterChrome();
        syncPresentation();
        if (typeof window.syncNativeWriterRevisionRange === 'function') window.syncNativeWriterRevisionRange();
    }

    function syncAppearanceControls() {
        const prefs = nativeEditorState.editorPrefs;
        const size = find('[data-native-desk-font-size]');
        if (size) {
            // Older explicit sizes stay intact until the author changes them.
            size.min = String(Math.min(18, prefs.fontSize));
            size.value = String(prefs.fontSize);
        }
        setText('[data-native-desk-font-size-value]', `${prefs.fontSize} px`);
        const family = find('[data-native-desk-font-family]');
        if (family) family.value = prefs.fontFamily;
        const night = find('[data-native-desk-night]');
        if (night) night.checked = state.night;
        const motion = find('[data-native-desk-reduce-motion]');
        if (motion) motion.checked = state.reduceMotion;
    }

    window.bindNativeWriterDesk = function bindNativeWriterDesk() {
        if (bound) return;
        root = document.querySelector('[data-native-writer]');
        if (!root) return;
        bound = true;
        loadPreferences();
        prepareLayout();
        // Keep native programmatic routes (context menu, transfers, history)
        // visible without rerendering or replacing the manuscript input.
        const originalChrome = applyNativeWriterChrome;
        applyNativeWriterChrome = function applyNativeWriterChromeWithDesk() {
            const result = originalChrome();
            syncPresentation();
            return result;
        };
        const originalRender = renderNativeEditor;
        renderNativeEditor = function renderNativeEditorWithDesk() {
            const result = originalRender();
            syncPresentation();
            syncOverview();
            return result;
        };
        const originalContext = renderNativeContext;
        renderNativeContext = function renderNativeContextWithDesk() {
            const result = originalContext();
            syncOverview();
            return result;
        };
        const originalGeneration = renderNativeGeneration;
        renderNativeGeneration = function renderNativeGenerationWithDesk() {
            const result = originalGeneration.apply(this, arguments);
            syncPresentation();
            return result;
        };
        all('[data-native-desk-mode]').forEach(button => button.addEventListener('click', () => selectMode(button.dataset.nativeDeskMode)));
        all('[data-native-desk-open-tool]').forEach(button => button.addEventListener('click', () => openTool(button.dataset.nativeDeskOpenTool)));
        find('[data-native-desk-tool]').addEventListener('change', event => openTool(event.target.value));
        find('[data-native-desk-composer-toggle]').addEventListener('click', () => {
            root.classList.toggle('is-desk-composer-expanded');
            syncPresentation();
        });
        find('[data-native-desk-layout]').addEventListener('click', () => {
            state.enabled = !state.enabled;
            savePreferences();
            applyLayout();
            applyNativeWriterChrome();
            if (typeof window.syncNativeWriterRevisionRange === 'function') window.syncNativeWriterRevisionRange();
        });
        find('[data-native-desk-focus-exit]').addEventListener('click', () => {
            const nativeButton = find('[data-native-focus-mode]');
            if (nativeEditorState.focusMode && nativeButton) nativeButton.click();
        });
        const appearance = find('[data-native-desk-appearance]');
        find('[data-native-desk-appearance-toggle]').addEventListener('click', () => {
            syncAppearanceControls();
            if (!appearance.open) appearance.showModal();
        });
        find('[data-native-desk-appearance-close]').addEventListener('click', () => appearance.close());
        appearance.addEventListener('close', () => find('[data-native-desk-appearance-toggle]').focus({ preventScroll: true }));
        find('[data-native-desk-font-size]').addEventListener('input', event => {
            nativeEditorState.editorPrefs.fontSize = clampNumber(event.target.value, 18, 32, 24);
            saveNativeEditorPrefs();
            applyNativeEditorPrefs();
            syncAppearanceControls();
            if (typeof window.syncNativeWriterRevisionRange === 'function') window.syncNativeWriterRevisionRange();
        });
        find('[data-native-desk-font-family]').addEventListener('change', event => {
            nativeEditorState.editorPrefs.fontFamily = event.target.value;
            saveNativeEditorPrefs();
            applyNativeEditorPrefs();
            if (typeof window.syncNativeWriterRevisionRange === 'function') window.syncNativeWriterRevisionRange();
        });
        [['[data-native-desk-night]', 'night'], ['[data-native-desk-reduce-motion]', 'reduceMotion']].forEach(([selector, key]) => {
            find(selector).addEventListener('change', event => {
                state[key] = event.target.checked;
                savePreferences();
                root.classList.toggle('is-desk-night', state.night);
                root.classList.toggle('is-desk-reduced-motion', state.reduceMotion);
            });
        });
        root.addEventListener('click', event => {
            if (state.enabled && event.target.closest('[data-native-gen-task]')) {
                state.mode = nativeEditorState.generation.genTask === 'beat' ? 'conceive' : 'write';
                syncPresentation();
            }
        });
        root.addEventListener('input', event => {
            if (event.target.matches('[data-native-scene-summary], [data-native-scene-pov], [data-native-scene-tags]')) syncOverview();
        });
        root.addEventListener('change', event => {
            if (event.target.matches('[data-native-scene-tense], [data-native-compendium-reference]')) syncOverview();
        });
        applyLayout();
    };
})();
