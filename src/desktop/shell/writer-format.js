    function nativeManuscriptFormatApi() {
        return window.DraftHarborManuscriptFormat;
    }

    function syncNativeFormatButtons() {
        const editor = document.querySelector('[data-native-scene-editor]');
        const generation = nativeEditorState.generation || {};
        const blocked = !currentNativeScene()
            || !!(editor && editor.disabled)
            || !!generation.inProgress
            || !!(generation.text && generation.inlineBaseText);
        document.querySelectorAll('[data-native-format-manuscript]').forEach((button) => {
            button.disabled = blocked;
        });
    }

    function replaceNativeEditorRange(editor, start, end, nextText) {
        const value = editor.value || '';
        const from = Math.max(0, Math.min(value.length, start));
        const to = Math.max(from, Math.min(value.length, end));
        const expected = `${value.slice(0, from)}${nextText}${value.slice(to)}`;
        if (value === expected) return false;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(from, to);
        let applied = false;
        if (typeof document.execCommand === 'function') {
            applied = nextText === ''
                ? !!document.execCommand('delete')
                : !!document.execCommand('insertText', false, nextText);
        }
        if (!applied || editor.value !== expected) {
            editor.value = expected;
            const cursor = from + nextText.length;
            editor.selectionStart = cursor;
            editor.selectionEnd = cursor;
        }
        return true;
    }

    function nativeFormatSelectionBounds(editor) {
        const value = editor.value || '';
        let start = Number(editor.selectionStart) || 0;
        let end = Number(editor.selectionEnd) || 0;
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        if (end > start) {
            while (start > 0 && value[start - 1] !== '\n') start -= 1;
            while (end < value.length && value[end] !== '\n') end += 1;
            return { start, end, scoped: true };
        }
        return { start: 0, end: value.length, scoped: false };
    }

    function applyNativeManuscriptFormat() {
        const api = nativeManuscriptFormatApi();
        const editor = document.querySelector('[data-native-scene-editor]');
        if (!api || typeof api.formatManuscript !== 'function') {
            setNativeSaveStatus('排版模块未加载', 'error');
            return false;
        }
        if (!currentNativeScene() || !editor || editor.disabled) {
            setNativeSaveStatus('请先选择一个场景', 'error');
            return false;
        }
        const generation = nativeEditorState.generation || {};
        if (generation.inProgress) {
            setNativeSaveStatus('生成进行中，稍后再排版', 'warn');
            return false;
        }
        if (generation.text && generation.inlineBaseText) {
            setNativeSaveStatus('请先确认或撤回生成结果，再排版', 'warn');
            return false;
        }

        const bounds = nativeFormatSelectionBounds(editor);
        const source = (editor.value || '').slice(bounds.start, bounds.end);
        if (!String(source).trim()) {
            setNativeSaveStatus('没有可排版的正文', 'info');
            return false;
        }
        const result = api.formatManuscript(source);
        if (!result.changed) {
            setNativeSaveStatus('当前正文已是排版格式', 'info');
            return false;
        }
        if (!replaceNativeEditorRange(editor, bounds.start, bounds.end, result.text)) {
            setNativeSaveStatus('当前正文已是排版格式', 'info');
            return false;
        }
        const cursor = bounds.start + result.text.length;
        const restoreEditorFocus = () => {
            editor.focus({ preventScroll: true });
            editor.selectionStart = cursor;
            editor.selectionEnd = cursor;
        };
        restoreEditorFocus();
        window.requestAnimationFrame(restoreEditorFocus);
        markNativeDirty(bounds.scoped
            ? `已排版选区 ${result.paragraphCount} 段，未保存`
            : `已排版 ${result.paragraphCount} 段，未保存`);
        if (nativeEditorState.searchQuery && nativeEditorState.searchQuery.trim() && typeof updateNativeSearchMatchState === 'function') {
            updateNativeSearchMatchState();
        }
        if (typeof renderNativeRewrite === 'function') renderNativeRewrite();
        return true;
    }

    function bindNativeManuscriptFormat() {
        if (bindNativeManuscriptFormat.bound) return;
        bindNativeManuscriptFormat.bound = true;
        document.querySelectorAll('[data-native-format-manuscript]').forEach((button) => {
            button.addEventListener('click', () => {
                applyNativeManuscriptFormat();
            });
        });
        if (typeof renderNativeEditor === 'function') {
            const previous = renderNativeEditor;
            renderNativeEditor = function renderNativeEditorWithFormatButtons() {
                previous();
                syncNativeFormatButtons();
            };
        }
        syncNativeFormatButtons();
    }
