    function openNativeEditorContextMenu(x, y) {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!elements.contextMenu || !scene) return;
        const hasSelection = !!(elements.editor && elements.editor.selectionStart !== elements.editor.selectionEnd);
        if (elements.contextSelectionActions) elements.contextSelectionActions.hidden = !hasSelection;
        if (elements.contextViewSummary) elements.contextViewSummary.disabled = !String(scene.summary || '').trim();
        closeNativeWriterPopovers({ keep: 'context-menu' });
        elements.contextMenu.hidden = false;
        const rect = elements.contextMenu.getBoundingClientRect();
        elements.contextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
        elements.contextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
        const firstAction = elements.contextMenu.querySelector('button:not([disabled])');
        if (firstAction) firstAction.focus({ preventScroll: true });
    }

    function openNativeSummaryDialog(scope = 'scene') {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const chapter = currentNativeChapterByState();
        const isChapter = scope === 'chapter';
        const summary = isChapter ? String(chapter && chapter.summary || '').trim() : String(scene && scene.summary || '').trim();
        if (!summary) {
            setNativeSaveStatus(isChapter ? '当前章节还没有摘要' : '当前场景还没有摘要', 'info');
            return false;
        }
        if (elements.summaryDialogTitle) elements.summaryDialogTitle.textContent = isChapter ? `${chapter.title || '当前章节'}：章节摘要` : `${scene.title || '当前场景'}：场景摘要`;
        if (elements.summaryDialogMeta) elements.summaryDialogMeta.textContent = nativeEditorState.dirty ? '生成结果尚未保存' : '已保存到本地项目';
        if (elements.summaryDialogContent) elements.summaryDialogContent.value = summary;
        if (!elements.summaryDialog) return false;
        if (typeof elements.summaryDialog.showModal === 'function' && !elements.summaryDialog.open) elements.summaryDialog.showModal();
        else elements.summaryDialog.hidden = false;
        return true;
    }

    function closeNativeSummaryDialog() {
        const elements = nativeEditorElements();
        if (!elements.summaryDialog) return;
        if (typeof elements.summaryDialog.close === 'function' && elements.summaryDialog.open) elements.summaryDialog.close();
        else elements.summaryDialog.hidden = true;
    }

    async function copyNativeSummaryDialog() {
        const elements = nativeEditorElements();
        const text = elements.summaryDialogContent ? elements.summaryDialogContent.value.trim() : '';
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setNativeSaveStatus('摘要已复制', 'info');
        } catch (error) {
            if (elements.summaryDialogContent) {
                elements.summaryDialogContent.focus();
                elements.summaryDialogContent.select();
            }
            setNativeSaveStatus('无法自动复制，请按 Ctrl+C 复制', 'warn');
        }
    }

    function editNativeSummaryDialog() {
        nativeEditorState.assistantPanel = 'metadata';
        closeNativeSummaryDialog();
        renderNativeEditor();
        const elements = nativeEditorElements();
        if (elements.summary) elements.summary.focus();
    }
