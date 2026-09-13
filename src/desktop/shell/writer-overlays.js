    const nativeSummarySaveState = { pending: null, dialog: null, noteIds: new WeakMap() };

    function openNativeEditorContextMenu(x, y) {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!elements.contextMenu || !scene) return;
        if (typeof rememberNativeRewriteSelection === 'function') rememberNativeRewriteSelection();
        const hasSelection = !!(elements.editor && elements.editor.selectionStart !== elements.editor.selectionEnd)
            || (nativeEditorState.rewrite.selectionEnd > nativeEditorState.rewrite.selectionStart);
        if (elements.contextSelectionActions) elements.contextSelectionActions.hidden = !hasSelection;
        if (elements.contextViewSummary) elements.contextViewSummary.disabled = !String(scene.summary || '').trim();
        closeNativeWriterPopovers({ keep: 'context-menu' });
        elements.contextMenu.hidden = false;
        const rect = elements.contextMenu.getBoundingClientRect();
        elements.contextMenu.style.left = `${Math.max(8, Math.min(x + 2, window.innerWidth - rect.width - 8))}px`;
        elements.contextMenu.style.top = `${Math.max(8, Math.min(y + 2, window.innerHeight - rect.height - 8))}px`;
        const firstAction = elements.contextMenu.querySelector('button:not([disabled])');
        if (firstAction) firstAction.focus({ preventScroll: true });
    }

    function nativeSummaryDialogScope() {
        const dialog = nativeEditorElements().summaryDialog;
        return dialog && dialog.dataset.nativeSummaryScope === 'chapter' ? 'chapter' : 'scene';
    }

    function nativeSummaryNoteTag(scope) {
        return scope === 'chapter' ? 'chapter-summary' : 'scene-summary';
    }

    function isDefaultSceneTitle(title, index) {
        const value = String(title || '').trim();
        return !value || /^场景\s*\d+$/.test(value) || value === `场景 ${index}` || value === `第 ${index} 场`;
    }

    function isDefaultChapterTitle(title, index) {
        const value = String(title || '').trim();
        return !value || new RegExp(`^第\\s*${index}\\s*章$`).test(value);
    }

    function nativeSummaryCardTitle(scope, scene, chapter) {
        const snapshot = nativeEditorState.snapshot;
        const chapters = [...(snapshot && snapshot.chapters || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const chapterIndex = Math.max(1, chapters.findIndex((item) => chapter && item.id === chapter.id) + 1);
        const chapterHeading = `第 ${chapterIndex} 章`;
        if (scope === 'chapter') {
            const title = String(chapter && chapter.title || '').trim();
            if (title && !isDefaultChapterTitle(title, chapterIndex)) return `${chapterHeading} · ${title}`;
            return chapterHeading;
        }
        const scenes = (snapshot && snapshot.scenes || [])
            .filter((item) => chapter && item.chapterId === chapter.id)
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const sceneIndex = Math.max(1, scenes.findIndex((item) => scene && item.id === scene.id) + 1);
        const sceneHeading = `${chapterHeading} · 第 ${sceneIndex} 场`;
        const title = String(scene && scene.title || '').trim();
        if (title && !isDefaultSceneTitle(title, sceneIndex)) return `${sceneHeading} · ${title}`;
        return sceneHeading;
    }

    function findLinkedSummaryNote(scope, target) {
        const snapshot = nativeEditorState.snapshot;
        const fromSnapshot = snapshot && Array.isArray(snapshot.compendium) ? snapshot.compendium : [];
        const fromState = typeof compendiumState !== 'undefined' && Array.isArray(compendiumState.entries) ? compendiumState.entries : [];
        const entries = fromSnapshot.length ? fromSnapshot : fromState;
        if (!target || !target.id) return null;
        const tag = nativeSummaryNoteTag(scope);
        return entries.find((entry) => {
            if (!entry || entry.type !== 'note') return false;
            const tags = Array.isArray(entry.tags) ? entry.tags : [];
            if (!tags.includes(tag)) return false;
            const refs = Array.isArray(entry.sourceReferences) ? entry.sourceReferences : [];
            if (scope === 'chapter') return refs.some((ref) => ref && ref.chapterId === target.id);
            return refs.some((ref) => ref && ref.sceneId === target.id)
                || (Array.isArray(entry.relatedSceneIds) && entry.relatedSceneIds.includes(target.id));
        }) || null;
    }

    function buildNativeSummaryNote(scope, text) {
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        const chapter = currentNativeChapterByState();
        const target = scope === 'chapter' ? chapter : scene;
        const projectId = snapshot && snapshot.project ? snapshot.project.id : '';
        const schema = window.DraftHarborCompendiumSchema;
        if (!snapshot || !target || !projectId || !schema || typeof schema.createCompendiumEntry !== 'function') return null;

        const existing = findLinkedSummaryNote(scope, target);
        let noteIds = nativeSummarySaveState.noteIds.get(snapshot);
        if (!noteIds) { noteIds = new Map(); nativeSummarySaveState.noteIds.set(snapshot, noteIds); }
        const key = `${scope}:${target.id}`;
        const title = nativeSummaryCardTitle(scope, scene, chapter);
        const tag = nativeSummaryNoteTag(scope);
        const aliases = [title, chapter && chapter.title, scene && scene.title].filter(Boolean);
        const entry = schema.createCompendiumEntry({
            ...(existing || {}),
            id: existing ? existing.id : noteIds.get(key),
            projectId,
            type: 'note',
            title,
            summary: String(text || '').slice(0, 140),
            body: text,
            tags: [tag, '摘要'],
            aliases,
            relatedSceneIds: scope === 'scene' && scene ? [scene.id] : [],
            sourceReferences: [{
                kind: 'summary',
                sceneId: scope === 'scene' && scene ? scene.id : '',
                chapterId: chapter ? chapter.id : '',
                excerpt: String(text || '').slice(0, 180)
            }],
            contextPolicy: { mode: 'mention' },
            alwaysInContext: false
        });
        noteIds.set(key, entry.id);
        return { ...entry, expectedUpdatedAt: existing && existing.updatedAt || '' };
    }

    function flushNativeSummaryDialogFields() {
        const elements = nativeEditorElements();
        const text = elements.summaryDialogContent ? elements.summaryDialogContent.value.trim() : '';
        const scope = nativeSummaryDialogScope();
        if (!text) return '';
        if (scope === 'chapter') {
            const chapter = currentNativeChapterByState();
            if (!chapter) return '';
            chapter.summary = text;
            chapter.summaryUpdated = new Date().toISOString();
            if (!chapter.summarySource) chapter.summarySource = 'manual';
            chapter.summaryStale = false;
            return text;
        }
        const scene = currentNativeScene();
        if (!scene) return '';
        scene.summary = text;
        scene.summaryUpdated = new Date().toISOString();
        if (!scene.summarySource) scene.summarySource = 'manual';
        scene.summaryStale = false;
        if (elements.summary) elements.summary.value = text;
        return text;
    }

    function syncNativeSummaryDialogMeta() {
        const elements = nativeEditorElements();
        if (!elements.summaryDialogMeta) return;
        elements.summaryDialogMeta.textContent = nativeEditorState.dirty ? '生成结果尚未保存' : '已保存到本地项目';
    }

    function openNativeSummaryDialog(scope = 'scene') {
        if (nativeSummarySaveState.pending) return false;
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const chapter = currentNativeChapterByState();
        const isChapter = scope === 'chapter';
        const summary = isChapter ? String(chapter && chapter.summary || '').trim() : String(scene && scene.summary || '').trim();
        if (!summary) {
            setNativeSaveStatus(isChapter ? '当前章节还没有摘要' : '当前场景还没有摘要', 'info');
            return false;
        }
        if (elements.summaryDialog) elements.summaryDialog.dataset.nativeSummaryScope = isChapter ? 'chapter' : 'scene';
        if (elements.summaryDialogTitle) elements.summaryDialogTitle.textContent = isChapter ? `${chapter.title || '当前章节'}：章节摘要` : `${scene.title || '当前场景'}：场景摘要`;
        if (elements.summaryDialogContent) elements.summaryDialogContent.value = summary;
        nativeSummarySaveState.dialog = { snapshot: nativeEditorState.snapshot, scope: isChapter ? 'chapter' : 'scene', targetId: (isChapter ? chapter : scene).id };
        syncNativeSummaryDialogMeta();
        if (!elements.summaryDialog) return false;
        if (!elements.summaryDialog.dataset.summarySaveGuard) {
            elements.summaryDialog.dataset.summarySaveGuard = 'true';
            elements.summaryDialog.addEventListener('cancel', event => { if (nativeSummarySaveState.pending) event.preventDefault(); });
        }
        if (typeof elements.summaryDialog.showModal === 'function' && !elements.summaryDialog.open) elements.summaryDialog.showModal();
        else elements.summaryDialog.hidden = false;
        const saveButton = document.querySelector('[data-native-summary-dialog-save]');
        if (saveButton) saveButton.focus({ preventScroll: true });
        return true;
    }

    async function saveNativeSummaryDialog() {
        if (nativeSummarySaveState.pending || nativeEditorState.isSaving) return false;
        const captured = nativeSummarySaveState.dialog;
        const scope = nativeSummaryDialogScope();
        const target = scope === 'chapter' ? currentNativeChapterByState() : currentNativeScene();
        if (!captured || captured.snapshot !== nativeEditorState.snapshot || captured.scope !== scope || captured.targetId !== target?.id) {
            setNativeSaveStatus('当前作品或摘要目标已改变，请重新打开摘要后保存。', 'error');
            return false;
        }
        const text = flushNativeSummaryDialogFields();
        if (!text) {
            setNativeSaveStatus('没有可保存的摘要', 'error');
            return false;
        }
        const elements = nativeEditorElements();
        const note = buildNativeSummaryNote(scope, text);
        if (!note) { setNativeSaveStatus('无法准备摘要资料卡，请重新打开项目后重试。', 'error'); return false; }
        const isCurrent = () => captured.snapshot === nativeEditorState.snapshot && nativeSummarySaveState.dialog === captured;
        const buttons = elements.summaryDialog ? Array.from(elements.summaryDialog.querySelectorAll('button')) : [];
        const controls = [...buttons, elements.summaryDialogContent].filter(Boolean).map(control => ({ control, disabled: control.disabled }));
        nativeSummarySaveState.pending = captured;
        controls.forEach(({ control }) => { control.disabled = true; });
        if (elements.summaryDialogMeta) elements.summaryDialogMeta.textContent = '正在保存摘要…';
        let summarySaved = false;
        try {
            markNativeDirty(scope === 'chapter' ? '章节摘要待保存' : '场景摘要待保存');
            summarySaved = await saveNativeScene() === true;
            if (!summarySaved || !isCurrent()) {
                if (isCurrent() && elements.summaryDialogMeta) elements.summaryDialogMeta.textContent = '摘要未保存，请重试；资料卡未写入';
                return false;
            }
            const response = await fetch('/api/compendium', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: note.projectId, entry: note })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok || !result.entry) throw new Error(result.error || `HTTP ${response.status}`);
            if (!isCurrent()) return false;
            window.acceptCompendiumSavedEntry(result.entry, { projectId: note.projectId, snapshot: captured.snapshot, entryId: '', version: -1 });
            if (elements.summaryDialogMeta) elements.summaryDialogMeta.textContent = '摘要和资料卡已保存';
            const label = scope === 'chapter' ? '章节摘要' : '场景摘要';
            setNativeSaveStatus(`${label}已保存，并写入资料库${nativeEditorState.dirty ? '；后续修改尚未保存' : ''}`, nativeEditorState.dirty ? 'warn' : 'ok');
            return true;
        } catch (error) {
            if (isCurrent()) {
                if (elements.summaryDialogMeta) elements.summaryDialogMeta.textContent = summarySaved ? '摘要已保存；资料卡未保存，可重试' : '摘要保存失败，可重试';
                setNativeSaveStatus(summarySaved ? `摘要已保存，资料卡保存失败：${error.message || error}。请重试；若提示版本冲突，请先刷新资料。` : `摘要保存失败：${error.message || error}`, 'error');
            }
            return false;
        } finally {
            if (nativeSummarySaveState.pending === captured) nativeSummarySaveState.pending = null;
            // Restore the same DOM controls even when another project was opened;
            // the late response never replaces that project's cards or metadata.
            controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
        }
    }

    function closeNativeSummaryDialog() {
        if (nativeSummarySaveState.pending) return;
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
