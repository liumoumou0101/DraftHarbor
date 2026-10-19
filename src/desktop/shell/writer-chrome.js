    if (typeof renderNativeEditor !== 'function') {
        throw new Error('writer-chrome.js must load after writer-core.js (renderNativeEditor)');
    }
    if (typeof renderNativeRewrite !== 'function') {
        throw new Error('writer-chrome.js must load after writer-prompts.js (renderNativeRewrite)');
    }

    function nativeWriterChromeGroup(panel) {
        const tab = document.querySelector(`[data-native-panel-tab="${panel || 'generate'}"]`);
        return (tab && tab.dataset.nativePanelGroup) || 'writing';
    }

    function syncRewriteChip() {
        const chip = document.querySelector('[data-native-open-rewrite]');
        const editor = document.querySelector('[data-native-scene-editor]');
        if (!chip) return;
        const start = editor ? Number(editor.selectionStart) : 0;
        const end = editor ? Number(editor.selectionEnd) : 0;
        const hasSelection = !!(editor && !editor.disabled && Number.isFinite(start) && Number.isFinite(end) && end > start);
        chip.hidden = !hasSelection;
        chip.classList.toggle('is-active-chip', hasSelection);
    }

    let nativeWriterChromePanel = null;

    function applyNativeWriterChrome() {
        const group = nativeWriterChromeGroup(nativeEditorState.assistantPanel);
        nativeEditorState.assistantPanelByGroup = nativeEditorState.assistantPanelByGroup || {};
        nativeEditorState.assistantPanelByGroup[group] = nativeEditorState.assistantPanel;
        document.querySelectorAll('[data-native-assistant-group]').forEach((tab) => {
            const selected = tab.dataset.nativeAssistantGroup === group;
            tab.classList.toggle('is-active', selected);
            tab.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        document.querySelectorAll('[data-native-panel-tab]').forEach((tab) => {
            tab.hidden = tab.dataset.nativePanelGroup !== group;
            const selected = tab.dataset.nativePanelTab === nativeEditorState.assistantPanel;
            tab.classList.toggle('is-active', selected);
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
            tab.tabIndex = selected && !tab.hidden ? 0 : -1;
        });
        document.querySelectorAll('[data-native-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.nativePanel !== nativeEditorState.assistantPanel;
            panel.classList.toggle('is-active', !panel.hidden);
        });
        nativeWriterChromePanel = nativeEditorState.assistantPanel;
        syncRewriteChip();
        if (typeof window.syncNativeSidebarResizeA11y === 'function') window.syncNativeSidebarResizeA11y();
    }

    const renderNativeEditorUnwrapped = renderNativeEditor;
    renderNativeEditor = function renderNativeEditorWithChrome() {
        renderNativeEditorUnwrapped();
        applyNativeWriterChrome();
    };

    const renderNativeRewriteUnwrapped = renderNativeRewrite;
    renderNativeRewrite = function renderNativeRewriteWithChrome() {
        renderNativeRewriteUnwrapped();
        if (nativeWriterChromePanel !== nativeEditorState.assistantPanel) applyNativeWriterChrome();
        else syncRewriteChip();
    };

    if (typeof closeNativeWriterPopovers !== 'function') {
        throw new Error('writer-chrome.js must load after writer-core.js (closeNativeWriterPopovers)');
    }

    const closeNativeWriterPopoversUnwrapped = closeNativeWriterPopovers;
    closeNativeWriterPopovers = function closeNativeWriterPopoversWithChrome(options = {}) {
        const contextMenu = document.querySelector('[data-native-context-menu]');
        const contextWasOpen = contextMenu && !contextMenu.hidden;
        closeNativeWriterPopoversUnwrapped(options);
        if (options.keep !== 'more') hideNativeMoreMenu(options);
        if (options.keep !== 'outline') hideOutlineContextMenu(options);
        if (options.keep !== 'context-menu' && typeof window.hideNativeEditorContextMenu === 'function') {
            window.hideNativeEditorContextMenu({ restoreFocus: options.restoreFocus && contextWasOpen });
        }
    };

    let savedEditorSelection = null;

    function snapshotEditorSelection() {
        const editor = document.querySelector('[data-native-scene-editor]');
        if (!editor) {
            savedEditorSelection = null;
            return;
        }
        savedEditorSelection = {
            start: Number(editor.selectionStart) || 0,
            end: Number(editor.selectionEnd) || 0
        };
    }

    function restoreEditorSelectionIfNeeded() {
        const editor = document.querySelector('[data-native-scene-editor]');
        if (!editor || !savedEditorSelection) return;
        if (savedEditorSelection.end > savedEditorSelection.start) {
            editor.setSelectionRange(savedEditorSelection.start, savedEditorSelection.end);
        }
    }

    function visibleMoreMenuButtons() {
        const menu = document.querySelector('[data-native-more-menu]');
        return window.nativeWriterMenuButtons(menu);
    }

    window.nativeWriterMenuButtons = function nativeWriterMenuButtons(menu) {
        if (!menu) return [];
        return Array.from(menu.querySelectorAll('button')).filter((button) => !button.disabled
            && !button.hidden && !button.closest('[hidden]') && button.offsetParent !== null);
    };

    window.onNativeWriterMenuKeydown = function onNativeWriterMenuKeydown(event, menu, close) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === 'Tab') {
            closeNativeWriterPopovers();
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = window.nativeWriterMenuButtons(menu);
        if (!buttons.length) return;
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : event.key === 'ArrowDown' ? (current + 1) % buttons.length
                : current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
        buttons[next].focus({ preventScroll: true });
    };

    function hideNativeMoreMenu(options = {}) {
        const menu = document.querySelector('[data-native-more-menu]');
        const wasOpen = menu && !menu.hidden;
        const btn = document.querySelector('[data-native-more-tools]');
        if (menu) menu.hidden = true;
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            if (options.restoreFocus && wasOpen) btn.focus({ preventScroll: true });
        }
    }

    function showNativeMoreMenu() {
        const menu = document.querySelector('[data-native-more-menu]');
        const btn = document.querySelector('[data-native-more-tools]');
        snapshotEditorSelection();
        closeNativeWriterPopovers({ keep: 'more' });
        if (menu) menu.hidden = false;
        if (btn) btn.setAttribute('aria-expanded', 'true');
        const first = visibleMoreMenuButtons()[0];
        if (first) first.focus({ preventScroll: true });
    }

    function onMoreMenuKeydown(event) {
        window.onNativeWriterMenuKeydown(event, document.querySelector('[data-native-more-menu]'),
            () => hideNativeMoreMenu({ restoreFocus: true }));
    }

    function bindNativeWriterChrome() {
        if (bindNativeWriterChrome.bound) return;
        bindNativeWriterChrome.bound = true;
        // Generation rendering is loaded after this script. Bind only once all
        // renderer scripts are ready, and sync a programmatic panel change
        // without rewriting the manuscript or measuring layout on every token.
        if (typeof renderNativeGeneration === 'function') {
            const renderGeneration = renderNativeGeneration;
            renderNativeGeneration = function renderNativeGenerationWithChrome() {
                const result = renderGeneration();
                if (nativeWriterChromePanel !== nativeEditorState.assistantPanel) applyNativeWriterChrome();
                return result;
            };
        }
        const btn = document.querySelector('[data-native-more-tools]');
        const menu = document.querySelector('[data-native-more-menu]');
        if (btn) {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const open = menu && !menu.hidden;
                if (open) hideNativeMoreMenu({ restoreFocus: true });
                else showNativeMoreMenu();
            });
        }
        if (menu) {
            menu.addEventListener('click', (event) => {
                const item = event.target && event.target.closest && event.target.closest('button');
                if (!item || item.hasAttribute('data-native-more-tools')) return;
                restoreEditorSelectionIfNeeded();
            }, true);
            menu.addEventListener('click', (event) => {
                const item = event.target && event.target.closest && event.target.closest('button');
                if (!item || item.hasAttribute('data-native-more-tools')) return;
                hideNativeMoreMenu({ restoreFocus: true });
            });
            menu.addEventListener('keydown', onMoreMenuKeydown);
        }
        bindNativeOutlineContextMenu();
    }

    let nativeOutlineMenuOrigin = null;

    function hideOutlineContextMenu(options = {}) {
        const menu = document.querySelector('[data-native-outline-menu]');
        const wasOpen = menu && !menu.hidden;
        if (menu) {
            menu.hidden = true;
            delete menu.dataset.nativeOutlineKind;
        }
        if (options.restoreFocus && wasOpen && nativeOutlineMenuOrigin) {
            const sceneId = nativeOutlineMenuOrigin.dataset.nativeSceneId;
            const chapterId = nativeOutlineMenuOrigin.dataset.nativeChapterId;
            const selector = sceneId ? '[data-native-scene-id]' : '[data-native-chapter-id]';
            const current = Array.from(document.querySelectorAll(selector)).find(node => sceneId
                ? node.dataset.nativeSceneId === sceneId : node.dataset.nativeChapterId === chapterId);
            const target = current || (nativeOutlineMenuOrigin.isConnected ? nativeOutlineMenuOrigin : null);
            if (target) target.focus({ preventScroll: true });
        }
    }

    function positionOutlineContextMenu(x, y) {
        const menu = document.querySelector('[data-native-outline-menu]');
        if (!menu) return;
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    }

    function outlineMoveBounds(kind) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return { up: true, down: true };
        if (kind === 'chapter') {
            const chapter = currentNativeChapterByState();
            const chapters = [...(snapshot.chapters || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
            const index = chapters.findIndex((item) => chapter && item.id === chapter.id);
            return { up: index <= 0, down: index < 0 || index >= chapters.length - 1 };
        }
        const scene = currentNativeScene();
        const scenes = (snapshot.scenes || [])
            .filter((item) => scene && item.chapterId === scene.chapterId)
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const index = scenes.findIndex((item) => scene && item.id === scene.id);
        return { up: index <= 0, down: index < 0 || index >= scenes.length - 1 };
    }

    function selectOutlineTarget(kind, id) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !id) return false;
        if (typeof nativeGenerationEditorLocked === 'function' && nativeGenerationEditorLocked()) return false;
        if (kind === 'scene') {
            const scene = (snapshot.scenes || []).find((item) => item.id === id);
            if (!scene) return false;
            if (typeof flushNativeEditorFields === 'function') flushNativeEditorFields();
            nativeEditorState.activeSceneId = scene.id;
            nativeEditorState.activeChapterId = scene.chapterId;
            nativeEditorState.expandedChapterIds.add(scene.chapterId);
            renderNativeEditor();
            return true;
        }
        const chapter = (snapshot.chapters || []).find((item) => item.id === id);
        if (!chapter) return false;
        if (typeof flushNativeEditorFields === 'function') flushNativeEditorFields();
        nativeEditorState.activeChapterId = chapter.id;
        nativeEditorState.expandedChapterIds.add(chapter.id);
        renderNativeEditor();
        return true;
    }

    function moveOutlineChapter(direction) {
        const snapshot = nativeEditorState.snapshot;
        const chapter = currentNativeChapterByState();
        if (!snapshot || !chapter || typeof reorderNativeChapter !== 'function') return;
        const chapters = [...(snapshot.chapters || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const index = chapters.findIndex((item) => item.id === chapter.id);
        const target = chapters[index + direction];
        if (!target) return;
        reorderNativeChapter(chapter.id, target.id);
    }

    function showOutlineContextMenu(kind, event) {
        const menu = document.querySelector('[data-native-outline-menu]');
        if (!menu) return;
        closeNativeWriterPopovers({ keep: 'outline' });
        nativeOutlineMenuOrigin = event.target && event.target.closest
            ? event.target.closest('[data-native-scene-id], [data-native-chapter-id]') : document.activeElement;
        menu.dataset.nativeOutlineKind = kind;
        const bounds = outlineMoveBounds(kind);
        const up = menu.querySelector('[data-native-outline-action="move-up"]');
        const down = menu.querySelector('[data-native-outline-action="move-down"]');
        if (up) up.disabled = bounds.up;
        if (down) down.disabled = bounds.down;
        menu.hidden = false;
        const rect = nativeOutlineMenuOrigin ? nativeOutlineMenuOrigin.getBoundingClientRect() : { left: 8, bottom: 8 };
        positionOutlineContextMenu(Number.isFinite(event.clientX) ? event.clientX : rect.left,
            Number.isFinite(event.clientY) ? event.clientY : rect.bottom);
        const first = window.nativeWriterMenuButtons(menu)[0];
        if (first) first.focus({ preventScroll: true });
    }

    function bindNativeOutlineContextMenu() {
        const list = document.querySelector('[data-native-scene-list]');
        const menu = document.querySelector('[data-native-outline-menu]');
        if (!list || !menu || bindNativeOutlineContextMenu.bound) return;
        bindNativeOutlineContextMenu.bound = true;
        const openFromOutline = (event) => {
            const sceneNode = event.target && event.target.closest && event.target.closest('[data-native-scene-id]');
            const chapterNode = event.target && event.target.closest && event.target.closest('[data-native-chapter-id]');
            const kind = sceneNode ? 'scene' : (chapterNode ? 'chapter' : '');
            const id = sceneNode ? sceneNode.dataset.nativeSceneId : (chapterNode ? chapterNode.dataset.nativeChapterId : '');
            if (!kind || !id) return;
            event.preventDefault();
            event.stopPropagation();
            if (!selectOutlineTarget(kind, id)) return;
            showOutlineContextMenu(kind, event);
        };
        list.addEventListener('contextmenu', openFromOutline);
        list.addEventListener('keydown', (event) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
            openFromOutline(event);
        });
        menu.addEventListener('keydown', (event) => window.onNativeWriterMenuKeydown(event, menu,
            () => hideOutlineContextMenu({ restoreFocus: true })));
        menu.addEventListener('click', (event) => {
            const button = event.target && event.target.closest && event.target.closest('[data-native-outline-action]');
            if (!button || button.disabled) return;
            const action = button.dataset.nativeOutlineAction;
            const kind = menu.dataset.nativeOutlineKind || 'scene';
            hideOutlineContextMenu({ restoreFocus: true });
            if (action === 'rename') {
                if (kind === 'chapter') renameNativeChapter();
                else renameNativeScene();
                return;
            }
            if (action === 'delete') {
                if (kind === 'chapter') deleteNativeChapter();
                else deleteNativeScene();
                return;
            }
            if (action === 'move-up') {
                if (kind === 'chapter') moveOutlineChapter(-1);
                else moveNativeScene(-1);
                return;
            }
            if (action === 'move-down') {
                if (kind === 'chapter') moveOutlineChapter(1);
                else moveNativeScene(1);
            }
        });
    }
