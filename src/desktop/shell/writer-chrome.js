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

    function applyNativeWriterChrome() {
        const group = nativeWriterChromeGroup(nativeEditorState.assistantPanel);
        document.querySelectorAll('[data-native-panel-tab]').forEach((tab) => {
            tab.hidden = tab.dataset.nativePanelGroup !== group;
        });
        syncRewriteChip();
    }

    const renderNativeEditorUnwrapped = renderNativeEditor;
    renderNativeEditor = function renderNativeEditorWithChrome() {
        renderNativeEditorUnwrapped();
        applyNativeWriterChrome();
    };

    const renderNativeRewriteUnwrapped = renderNativeRewrite;
    renderNativeRewrite = function renderNativeRewriteWithChrome() {
        renderNativeRewriteUnwrapped();
        syncRewriteChip();
    };

    if (typeof closeNativeWriterPopovers !== 'function') {
        throw new Error('writer-chrome.js must load after writer-core.js (closeNativeWriterPopovers)');
    }

    const closeNativeWriterPopoversUnwrapped = closeNativeWriterPopovers;
    closeNativeWriterPopovers = function closeNativeWriterPopoversWithChrome(options = {}) {
        closeNativeWriterPopoversUnwrapped(options);
        if (options.keep !== 'more') hideNativeMoreMenu();
        if (options.keep !== 'outline') hideOutlineContextMenu();
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
        if (!menu) return [];
        return Array.from(menu.querySelectorAll('button')).filter((button) => !button.hidden && button.offsetParent);
    }

    function hideNativeMoreMenu(options = {}) {
        const menu = document.querySelector('[data-native-more-menu]');
        const btn = document.querySelector('[data-native-more-tools]');
        if (menu) menu.hidden = true;
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            if (options.restoreFocus) btn.focus({ preventScroll: true });
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
        const buttons = visibleMoreMenuButtons();
        if (!buttons.length) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
        }
        const current = buttons.indexOf(document.activeElement);
        if (event.key === 'Home') {
            buttons[0].focus({ preventScroll: true });
            return;
        }
        if (event.key === 'End') {
            buttons[buttons.length - 1].focus({ preventScroll: true });
            return;
        }
        if (event.key === 'ArrowDown') {
            const next = current < 0 ? 0 : (current + 1) % buttons.length;
            buttons[next].focus({ preventScroll: true });
            return;
        }
        if (event.key === 'ArrowUp') {
            const next = current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
            buttons[next].focus({ preventScroll: true });
        }
    }

    function bindNativeWriterChrome() {
        if (bindNativeWriterChrome.bound) return;
        bindNativeWriterChrome.bound = true;
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

    function hideOutlineContextMenu() {
        const menu = document.querySelector('[data-native-outline-menu]');
        if (menu) {
            menu.hidden = true;
            delete menu.dataset.nativeOutlineKind;
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
        if (kind === 'scene') {
            const scene = (snapshot.scenes || []).find((item) => item.id === id);
            if (!scene) return false;
            nativeEditorState.activeSceneId = scene.id;
            nativeEditorState.activeChapterId = scene.chapterId;
            nativeEditorState.expandedChapterIds.add(scene.chapterId);
            return true;
        }
        const chapter = (snapshot.chapters || []).find((item) => item.id === id);
        if (!chapter) return false;
        nativeEditorState.activeChapterId = chapter.id;
        nativeEditorState.expandedChapterIds.add(chapter.id);
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
        menu.dataset.nativeOutlineKind = kind;
        const bounds = outlineMoveBounds(kind);
        const up = menu.querySelector('[data-native-outline-action="move-up"]');
        const down = menu.querySelector('[data-native-outline-action="move-down"]');
        if (up) up.disabled = bounds.up;
        if (down) down.disabled = bounds.down;
        menu.hidden = false;
        positionOutlineContextMenu(event.clientX, event.clientY);
        const first = menu.querySelector('button:not([disabled])');
        if (first) first.focus({ preventScroll: true });
    }

    function bindNativeOutlineContextMenu() {
        const list = document.querySelector('[data-native-scene-list]');
        const menu = document.querySelector('[data-native-outline-menu]');
        if (!list || !menu || bindNativeOutlineContextMenu.bound) return;
        bindNativeOutlineContextMenu.bound = true;
        list.addEventListener('contextmenu', (event) => {
            const sceneNode = event.target && event.target.closest && event.target.closest('[data-native-scene-id]');
            const chapterNode = event.target && event.target.closest && event.target.closest('[data-native-chapter-id]');
            const kind = sceneNode ? 'scene' : (chapterNode ? 'chapter' : '');
            const id = sceneNode ? sceneNode.dataset.nativeSceneId : (chapterNode ? chapterNode.dataset.nativeChapterId : '');
            if (!kind || !id) return;
            event.preventDefault();
            event.stopPropagation();
            if (!selectOutlineTarget(kind, id)) return;
            showOutlineContextMenu(kind, event);
        });
        menu.addEventListener('click', (event) => {
            const button = event.target && event.target.closest && event.target.closest('[data-native-outline-action]');
            if (!button || button.disabled) return;
            const action = button.dataset.nativeOutlineAction;
            const kind = menu.dataset.nativeOutlineKind || 'scene';
            hideOutlineContextMenu();
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
