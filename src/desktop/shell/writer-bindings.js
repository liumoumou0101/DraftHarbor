    /* global compendiumEditorSession compendiumRewriteState compendiumExtractionState compendiumDrawState compendiumAgentState renderNativeContextSummary */
    function nativeWriterShortcutsAvailable(event) {
        const root = document.getElementById('desktop-root');
        return !!(root && root.dataset.view === 'writer'
            && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229
            && !document.querySelector('dialog[open]'));
    }

    function nativeWriterEditorLocked() {
        if (typeof nativeGenerationEditorLocked === 'function') return nativeGenerationEditorLocked();
        const editor = nativeEditorElements().editor;
        return !!(editor && editor.readOnly);
    }

    async function copyNativeUnsavedDraft() {
        const editor = nativeEditorElements().editor;
        if (!editor) return;
        try {
            await navigator.clipboard.writeText(editor.value || '');
            setNativeSaveStatus('当前完整草稿已复制；保存问题仍需处理', 'info');
        } catch (_) {
            editor.focus({ preventScroll: true });
            editor.select();
            setNativeSaveStatus('无法自动复制，已选中当前正文，请按 Ctrl+C 复制并另存草稿。', 'warn');
        }
    }

    let nativeDraftRecoveryBusy = false;

    async function reloadNativeSavedDraft() {
        if (nativeDraftRecoveryBusy) return false;
        const sourceSnapshot = nativeEditorState.snapshot;
        const projectId = sourceSnapshot && sourceSnapshot.project && sourceSnapshot.project.id;
        if (!projectId) return false;
        const button = nativeEditorElements().reloadSavedDraft;
        const wasDisabled = button && button.disabled;
        let loadedSnapshot = null;
        let phase = '准备备份';
        const blockedReason = () => {
            if (nativeEditorState.isSaving || (nativeEditorState.generation && nativeEditorState.generation.inProgress)) return '保存或生成仍在进行，请等待结束后重试。';
            if (typeof compendiumState !== 'undefined' && compendiumState.dirty) return '资料表单有未保存修改，无法完整备份；请先保存或另行备份资料。';
            if (nativeEditorState.titleEditing) return '标题仍在编辑，请先完成标题编辑后重试。';
            return '';
        };
        nativeDraftRecoveryBusy = true;
        if (button) button.disabled = true;
        try {
            if (blockedReason()) {
                setNativeSaveStatus(`${blockedReason()}当前草稿已保留，未载入磁盘版本。`, 'warn');
                return false;
            }
            if (window.WorkshopAgent && !window.WorkshopAgent.canLeave()) return false;
            if (!window.confirm('将完整当前作品草稿以 JSON 复制到剪贴板，可粘贴保存为 .json 后导入恢复；然后载入磁盘版本。\n\n请在完成后立即粘贴保存这份备份。是否继续？')) return false;
            if (nativeEditorState.snapshot !== sourceSnapshot) return false;
            flushNativeEditorFields();
            const capturedContent = JSON.stringify(sourceSnapshot);
            const backup = JSON.stringify(sourceSnapshot, null, 2);
            const source = nativeEditorState.projectSource;
            const unchanged = () => {
                if (nativeEditorState.snapshot !== sourceSnapshot) return false;
                flushNativeEditorFields();
                return JSON.stringify(sourceSnapshot) === capturedContent;
            };
            const reportChanged = () => {
                if (nativeEditorState.snapshot === sourceSnapshot) {
                    setNativeSaveStatus('备份期间草稿有新修改，已保留当前输入，未载入磁盘版本。请重新点击“备份并重新载入”。', 'warn');
                }
            };
            phase = '读取磁盘版本';
            setNativeSaveStatus('正在读取磁盘版本，当前草稿仍保留…', 'info');
            const savedSnapshot = await fetchProjectSnapshot({ id: projectId });
            if (!unchanged()) { reportChanged(); return false; }
            if (blockedReason()) {
                setNativeSaveStatus(`${blockedReason()}当前草稿已保留，未载入磁盘版本。`, 'warn');
                return false;
            }
            if (!savedSnapshot || !savedSnapshot.project || savedSnapshot.project.id !== projectId) {
                throw new Error('返回的作品与当前作品不一致，请核对后重试');
            }
            phase = '复制完整作品备份';
            setNativeSaveStatus('正在把完整作品备份复制到剪贴板，当前草稿仍保留…', 'info');
            await navigator.clipboard.writeText(backup);
            if (window.WorkshopAgent && !window.WorkshopAgent.canLeave()) {
                if (nativeEditorState.snapshot === sourceSnapshot) setNativeSaveStatus('备份已复制，但讨论任务仍需处理，未载入磁盘版本。当前草稿已保留。', 'warn');
                return false;
            }
            if (!unchanged()) { reportChanged(); return false; }
            if (blockedReason()) {
                setNativeSaveStatus(`${blockedReason()}备份已复制，但未载入磁盘版本。当前草稿已保留。`, 'warn');
                return false;
            }
            loadNativeProjectEditor(savedSnapshot, { id: projectId, source });
            loadedSnapshot = nativeEditorState.snapshot;
            if (loadedSnapshot === sourceSnapshot || loadedSnapshot?.project?.id !== projectId) return false;
            phase = '刷新辅助资料';
            for (const refresh of [() => loadReaderFromProjectSnapshot(loadedSnapshot), loadCompendium, loadPrompts, loadRewritePrompts, loadSummaryPrompts]) {
                if (nativeEditorState.snapshot !== loadedSnapshot) return false;
                await refresh();
            }
            if (nativeEditorState.snapshot !== loadedSnapshot) return false;
            setNativeSaveStatus(`磁盘版本已重新载入；完整旧草稿已在剪贴板，请立即粘贴保存为 .json${nativeEditorState.dirty ? '；新输入尚未保存' : ''}。`, nativeEditorState.dirty ? 'warn' : 'info');
            return true;
        } catch (error) {
            if (nativeEditorState.snapshot === (loadedSnapshot || sourceSnapshot)) {
                setNativeSaveStatus(loadedSnapshot
                    ? `磁盘版本已载入，但${phase}失败：${error.message || error}。旧草稿备份仍在剪贴板，请先粘贴保存为 .json。`
                    : `${phase}失败：${error.message || error}。当前草稿已保留，未载入磁盘版本。请保留草稿后重试。`, 'error');
            }
            return false;
        } finally {
            nativeDraftRecoveryBusy = false;
            if (button) button.disabled = wasDisabled;
        }
    }

    function bindNativeEditor() {
        const elements = nativeEditorElements();
        if (typeof bindNativeSidebarResize === 'function') bindNativeSidebarResize();
        if (typeof bindNativeGlobalPrompt === 'function') bindNativeGlobalPrompt();
        if (typeof bindNativeWriterChrome === 'function') bindNativeWriterChrome();
        if (typeof bindNativeManuscriptFormat === 'function') bindNativeManuscriptFormat();
        if (typeof loadNativeContextBudgets === 'function') loadNativeContextBudgets();
        if (typeof window.bindNativeGenerationOutputDrag === 'function') window.bindNativeGenerationOutputDrag();
        if (typeof window.bindNativeGenerationLayer === 'function') window.bindNativeGenerationLayer();
        if (elements.saveButton) {
            elements.saveButton.addEventListener('click', () => {
                saveNativeScene();
            });
        }
        if (elements.copyUnsavedDraft) elements.copyUnsavedDraft.addEventListener('click', copyNativeUnsavedDraft);
        if (elements.reloadSavedDraft) elements.reloadSavedDraft.addEventListener('click', reloadNativeSavedDraft);
        if (elements.sendToWorkshop) elements.sendToWorkshop.addEventListener('click', sendNativeSelectionToWorkshop);
        if (elements.saveToCompendium) elements.saveToCompendium.addEventListener('click', openNativeCompendiumExtraction);
        if (elements.readAloud) elements.readAloud.addEventListener('click', readNativeSceneAloud);
        if (elements.stopReading) elements.stopReading.addEventListener('click', stopNativeReading);
        if (elements.toggleOutline) {
            elements.toggleOutline.addEventListener('click', () => {
                nativeEditorState.outlineCollapsed = !nativeEditorState.outlineCollapsed;
                renderNativeEditor();
            });
        }
        if (elements.toggleAssistant) {
            elements.toggleAssistant.addEventListener('click', () => {
                nativeEditorState.assistantCollapsed = !nativeEditorState.assistantCollapsed;
                renderNativeEditor();
            });
        }
        if (elements.assistantPlacement) {
            elements.assistantPlacement.addEventListener('click', () => {
                nativeEditorState.assistantPlacement = nativeEditorState.assistantPlacement === 'bottom' ? 'right' : 'bottom';
                try { window.localStorage.setItem('draftharbor:nativeAssistantPlacement', nativeEditorState.assistantPlacement); } catch (error) { /* ignore */ }
                renderNativeEditor();
            });
        }
        if (elements.toggleSpecials) {
            elements.toggleSpecials.addEventListener('click', () => {
                const shouldOpen = elements.specials ? elements.specials.hidden : false;
                closeNativeWriterPopovers({ keep: 'specials' });
                if (elements.specials) elements.specials.hidden = !shouldOpen;
                elements.toggleSpecials.setAttribute('aria-pressed', shouldOpen ? 'true' : 'false');
            });
        }
        if (elements.toggleTypography) {
            elements.toggleTypography.addEventListener('click', () => {
                const shouldOpen = !nativeEditorState.typographyOpen;
                closeNativeWriterPopovers({ keep: 'typography' });
                nativeEditorState.typographyOpen = shouldOpen;
                renderNativeEditor();
            });
        }
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!target || !target.closest) return;
            if (target.closest('[data-native-typography], [data-native-specials], [data-native-toggle-typography], [data-native-toggle-specials], [data-native-more-menu], [data-native-more-tools], [data-native-outline-menu], [data-native-context-menu]')) return;
            closeNativeWriterPopovers();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !nativeWriterShortcutsAvailable(event)) return;
            const elements = nativeEditorElements();
            const moreMenu = document.querySelector('[data-native-more-menu]');
            const outlineMenu = document.querySelector('[data-native-outline-menu]');
            const moreWasOpen = moreMenu && !moreMenu.hidden;
            const outlineWasOpen = outlineMenu && !outlineMenu.hidden;
            const hasOpenPopover = (elements.typography && !elements.typography.hidden)
                || (elements.specials && !elements.specials.hidden)
                || (elements.contextMenu && !elements.contextMenu.hidden)
                || moreWasOpen
                || outlineWasOpen;
            if (!hasOpenPopover) return;
            event.preventDefault();
            closeNativeWriterPopovers({ restoreFocus: true });
        });
        [
            ['editorFontSize', 'fontSize'],
            ['editorLineHeight', 'lineHeight'],
            ['editorTextWidth', 'textWidth'],
            ['editorParagraphSpacing', 'paragraphSpacing']
        ].forEach(([elementKey, prefKey]) => {
            const field = elements[elementKey];
            if (!field) return;
            field.addEventListener('input', () => {
                const limits = {
                    fontSize: [15, 24, 18],
                    lineHeight: [1.45, 2.2, 1.9],
                    textWidth: [620, 1040, 760],
                    paragraphSpacing: [0, 1.5, 0]
                }[prefKey];
                nativeEditorState.editorPrefs[prefKey] = clampNumber(field.value, limits[0], limits[1], limits[2]);
                saveNativeEditorPrefs();
                applyNativeEditorPrefs();
            });
        });
        if (elements.editorFontFamily) {
            elements.editorFontFamily.addEventListener('change', () => {
                nativeEditorState.editorPrefs.fontFamily = elements.editorFontFamily.value || 'system';
                saveNativeEditorPrefs();
                applyNativeEditorPrefs();
            });
        }
        if (elements.editorWordGoal) {
            elements.editorWordGoal.addEventListener('input', () => {
                nativeEditorState.editorPrefs.wordGoal = clampNumber(elements.editorWordGoal.value, 0, 999999, 0);
                saveNativeEditorPrefs();
                updateNativeStats();
            });
        }
        elements.specialButtons.forEach((button) => {
            button.addEventListener('click', () => {
                if (nativeWriterEditorLocked()) return;
                insertNativeSpecialChar(button.dataset.nativeSpecialChar || button.textContent || '');
                if (elements.specials) elements.specials.hidden = true;
            });
        });
        if (elements.sceneTitle) {
            elements.sceneTitle.addEventListener('dblclick', beginNativeSceneTitleEdit);
            elements.sceneTitle.addEventListener('keydown', (event) => {
                if (!currentNativeScene()) return;
                if (!nativeEditorState.titleEditing && (event.key === 'Enter' || event.key === 'F2')) {
                    event.preventDefault();
                    beginNativeSceneTitleEdit();
                    return;
                }
                if (nativeEditorState.titleEditing && event.key === 'Enter') {
                    event.preventDefault();
                    finishNativeSceneTitleEdit();
                }
                if (nativeEditorState.titleEditing && event.key === 'Escape') {
                    event.preventDefault();
                    finishNativeSceneTitleEdit({ cancel: true });
                }
            });
            elements.sceneTitle.addEventListener('blur', () => {
                if (nativeEditorState.titleEditing) finishNativeSceneTitleEdit();
            });
        }
        if (elements.focusMode) {
            elements.focusMode.addEventListener('click', () => {
                nativeEditorState.focusMode = !nativeEditorState.focusMode;
                renderNativeEditor();
                if (elements.editor && nativeEditorState.focusMode) elements.editor.focus();
            });
        }
        elements.panelTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const panel = tab.dataset.nativePanelTab || 'generate';
                const group = tab.dataset.nativePanelGroup || 'writing';
                nativeEditorState.assistantPanel = panel;
                nativeEditorState.assistantPanelByGroup = nativeEditorState.assistantPanelByGroup || {};
                nativeEditorState.assistantPanelByGroup[group] = panel;
                renderNativeEditor();
                if (nativeEditorState.assistantPanel === 'metadata' && typeof loadSummaryPrompts === 'function') {
                    loadSummaryPrompts();
                }
            });
            tab.addEventListener('keydown', (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.isComposing) return;
                const tabs = elements.panelTabs.filter(item => !item.hidden && !item.disabled
                    && item.dataset.nativePanelGroup === tab.dataset.nativePanelGroup);
                const index = tabs.indexOf(tab);
                if (index < 0) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next].click();
                tabs[next].focus({ preventScroll: true });
            });
        });
        const assistantGroupDefaults = {
            writing: 'generate',
            context: 'characters',
            document: 'metadata'
        };
        elements.assistantGroupTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const group = tab.dataset.nativeAssistantGroup || 'writing';
                const remembered = nativeEditorState.assistantPanelByGroup && nativeEditorState.assistantPanelByGroup[group];
                const rememberedTab = elements.panelTabs.find(item => item.dataset.nativePanelTab === remembered);
                nativeEditorState.assistantPanel = rememberedTab && rememberedTab.dataset.nativePanelGroup === group
                    ? remembered : assistantGroupDefaults[group] || 'generate';
                renderNativeEditor();
                if (nativeEditorState.assistantPanel === 'metadata' && typeof loadSummaryPrompts === 'function') {
                    loadSummaryPrompts();
                }
            });
        });
        const rewriteChip = document.querySelector('[data-native-open-rewrite]');
        if (rewriteChip) {
            rewriteChip.addEventListener('click', () => {
                if (typeof restoreNativeRewriteSelection === 'function') restoreNativeRewriteSelection();
                nativeEditorState.assistantPanel = 'rewrite';
                nativeEditorState.assistantPanelByGroup = nativeEditorState.assistantPanelByGroup || {};
                nativeEditorState.assistantPanelByGroup.writing = 'rewrite';
                renderNativeEditor();
            });
        }
        if (elements.search) {
            elements.search.addEventListener('input', () => {
                nativeEditorState.searchQuery = elements.search.value;
                renderNativeEditor();
            });
        }
        if (elements.replaceCurrent) elements.replaceCurrent.addEventListener('click', () => { if (!nativeWriterEditorLocked()) replaceNativeText('current'); });
        if (elements.replaceAll) elements.replaceAll.addEventListener('click', () => { if (!nativeWriterEditorLocked()) replaceNativeText('all'); });
        if (elements.searchPrev) elements.searchPrev.addEventListener('click', () => navigateNativeSearchMatch(-1));
        if (elements.searchNext) elements.searchNext.addEventListener('click', () => navigateNativeSearchMatch(1));
        if (elements.editor) {
            elements.editor.addEventListener('beforeinput', (event) => {
                if (nativeWriterEditorLocked()) event.preventDefault();
            });
            elements.editor.addEventListener('input', () => {
                if (!nativeEditorState.snapshot || !nativeEditorState.activeSceneId) return;
                if (nativeWriterEditorLocked()) return;
                applyNativeAutoReplace();
                markNativeDirty();
                if (nativeEditorState.searchQuery.trim()) updateNativeSearchMatchState();
                if (typeof window.syncNativeGenerationLayer === 'function') window.syncNativeGenerationLayer();
            });
            ['select', 'mouseup', 'keyup'].forEach((eventName) => {
                elements.editor.addEventListener(eventName, renderNativeRewrite);
            });
            elements.editor.addEventListener('contextmenu', (event) => {
                if (!currentNativeScene()) return;
                event.preventDefault();
                openNativeEditorContextMenu(event.clientX, event.clientY);
            });
            elements.editor.addEventListener('keydown', (event) => {
                if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                if (!currentNativeScene()) return;
                event.preventDefault();
                const rect = elements.editor.getBoundingClientRect();
                openNativeEditorContextMenu(rect.left + 20, rect.top + 20);
            });
        }
        if (elements.contextMenu && typeof window.onNativeWriterMenuKeydown === 'function') {
            elements.contextMenu.addEventListener('keydown', (event) => window.onNativeWriterMenuKeydown(event, elements.contextMenu,
                () => closeNativeWriterPopovers({ restoreFocus: true })));
        }
        if (elements.summaryDialogClose) elements.summaryDialogClose.addEventListener('click', closeNativeSummaryDialog);
        if (elements.summaryDialogCopy) elements.summaryDialogCopy.addEventListener('click', copyNativeSummaryDialog);
        if (elements.summaryDialogEdit) elements.summaryDialogEdit.addEventListener('click', editNativeSummaryDialog);
        const summaryDialogSave = document.querySelector('[data-native-summary-dialog-save]');
        if (summaryDialogSave) summaryDialogSave.addEventListener('click', () => { saveNativeSummaryDialog(); });
        if (elements.summaryDialog) elements.summaryDialog.addEventListener('click', (event) => {
            if (event.target === elements.summaryDialog) closeNativeSummaryDialog();
        });
        [elements.summary, elements.tags, elements.pov, elements.tense].forEach((field) => {
            if (!field) return;
            field.addEventListener('input', () => {
                if (!nativeEditorState.snapshot || !nativeEditorState.activeSceneId) return;
                markNativeDirty();
            });
            field.addEventListener('change', () => {
                if (!nativeEditorState.snapshot || !nativeEditorState.activeSceneId) return;
                markNativeDirty();
            });
        });
        if (elements.newProject) {
            elements.newProject.addEventListener('click', () => {
                openProjectCreator();
            });
        }
        if (elements.showBookshelf) {
            elements.showBookshelf.addEventListener('click', () => {
                setView('bookshelf');
            });
        }
        if (elements.addChapter) elements.addChapter.addEventListener('click', addNativeChapter);
        if (elements.renameChapter) elements.renameChapter.addEventListener('click', renameNativeChapter);
        if (elements.deleteChapter) elements.deleteChapter.addEventListener('click', deleteNativeChapter);
        if (elements.addScene) elements.addScene.addEventListener('click', addNativeScene);
        if (elements.renameScene) elements.renameScene.addEventListener('click', renameNativeScene);
        if (elements.deleteScene) elements.deleteScene.addEventListener('click', deleteNativeScene);
        if (elements.moveSceneUp) elements.moveSceneUp.addEventListener('click', () => moveNativeScene(-1));
        if (elements.moveSceneDown) elements.moveSceneDown.addEventListener('click', () => moveNativeScene(1));
        if (elements.exportMarkdown) elements.exportMarkdown.addEventListener('click', () => window.downloadNativeExport('markdown'));
        if (elements.exportText) elements.exportText.addEventListener('click', () => window.downloadNativeExport('text'));
        if (elements.exportHtml) elements.exportHtml.addEventListener('click', () => window.downloadNativeExport('html'));
        if (elements.exportEpub) elements.exportEpub.addEventListener('click', () => window.downloadNativeExport('epub'));
        if (elements.exportPackage) elements.exportPackage.addEventListener('click', downloadNativeProjectPackage);
        if (elements.exportIncludeSceneTitles) elements.exportIncludeSceneTitles.addEventListener('change', saveExportOptions);
        if (elements.beatInput) {
            elements.beatInput.addEventListener('input', () => {
                nativeEditorState.generation.beat = elements.beatInput.value;
                if (typeof autosizeNativeBeatInput === 'function') autosizeNativeBeatInput();
                renderNativeGeneration();
                renderNativeContextSummary();
            });
            elements.beatInput.addEventListener('focus', () => {
                if (typeof syncNativeComposerExpansion === 'function') syncNativeComposerExpansion(true);
            });
            elements.beatInput.addEventListener('blur', () => {
                if (typeof syncNativeComposerExpansion === 'function') syncNativeComposerExpansion(false);
            });
            elements.beatInput.addEventListener('keydown', (event) => {
                if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
                event.preventDefault();
                if (nativeEditorState.generation.inProgress) return;
                if (nativeEditorState.generation.genTask === 'summary') generateNativeSummary('scene');
                else startNativeGeneration();
            });
            window.addEventListener('resize', () => {
                if (typeof autosizeNativeBeatInput === 'function') autosizeNativeBeatInput();
            });
        }
        if (elements.modelSelect) {
            elements.modelSelect.addEventListener('change', () => {
                writerModelOverride.model = elements.modelSelect.value || 'inherit';
                if (writerModelOverride.model !== '__custom__') writerModelOverride.customModel = '';
                writerModelOverride.thinking = false;
                saveWriterModelOverride();
                renderWriterModelControl();
            });
        }
        if (elements.profileSelect) {
            elements.profileSelect.addEventListener('change', () => {
                writerModelOverride.profileId = elements.profileSelect.value || 'inherit';
                writerModelOverride.model = 'inherit';
                writerModelOverride.customModel = '';
                writerModelOverride.thinking = false;
                saveWriterModelOverride();
                renderWriterModelControl();
                renderNativeGeneration();
            });
        }
        if (elements.customModelInput) {
            elements.customModelInput.addEventListener('input', () => {
                writerModelOverride.customModel = elements.customModelInput.value.trim();
                saveWriterModelOverride();
                renderWriterModelControl();
            });
        }
        document.addEventListener('change', (event) => {
            const toggle = event.target && event.target.closest ? event.target.closest('[data-native-thinking-toggle]') : null;
            if (!toggle) return;
            writerModelOverride.thinking = !!toggle.checked;
            saveWriterModelOverride();
            renderWriterModelControl();
        });
        document.addEventListener('click', (event) => {
            const openSettings = event.target && event.target.closest ? event.target.closest('[data-native-open-writer-settings]') : null;
            if (openSettings) {
                const dialog = nativeEditorElements().writerSettingsDialog;
                if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
                return;
            }
            const closeSettings = event.target && event.target.closest ? event.target.closest('[data-native-close-writer-settings]') : null;
            if (closeSettings) {
                const dialog = nativeEditorElements().writerSettingsDialog;
                if (dialog && typeof dialog.close === 'function' && dialog.open) dialog.close();
            }
        });
        if (elements.closePrompt) {
            elements.closePrompt.addEventListener('click', () => {
                if (elements.promptDialog && typeof elements.promptDialog.close === 'function') elements.promptDialog.close();
            });
        }
        if (elements.promptTemplate) {
            elements.promptTemplate.addEventListener('change', () => {
                promptState.selectedId = elements.promptTemplate.value || 'default-prose';
                renderPromptManager();
            });
        }
        if (elements.managePrompts) {
            elements.managePrompts.addEventListener('click', () => {
                renderPromptManager();
                if (elements.promptManagerDialog && typeof elements.promptManagerDialog.showModal === 'function') {
                    elements.promptManagerDialog.showModal();
                }
            });
        }
        if (elements.promptManagerForm) elements.promptManagerForm.addEventListener('submit', savePromptTemplate);
        if (elements.promptManagerList) {
            elements.promptManagerList.addEventListener('click', (event) => {
                const target = event.target && event.target.closest ? event.target.closest('[data-prompt-manager-select]') : null;
                if (!target) return;
                promptState.selectedId = target.dataset.promptManagerSelect || 'default-prose';
                if (elements.promptTemplate && elements.promptTemplate.querySelector(`option[value="${CSS.escape(promptState.selectedId)}"]`)) {
                    elements.promptTemplate.value = promptState.selectedId;
                }
                renderPromptManager();
            });
        }
        if (elements.promptManagerNew) elements.promptManagerNew.addEventListener('click', newPromptTemplate);
        if (elements.promptManagerDelete) elements.promptManagerDelete.addEventListener('click', deletePromptTemplate);
        if (elements.promptManagerClose) {
            elements.promptManagerClose.addEventListener('click', () => {
                if (elements.promptManagerDialog && typeof elements.promptManagerDialog.close === 'function') elements.promptManagerDialog.close();
            });
        }
        if (elements.rewritePreset) {
            elements.rewritePreset.addEventListener('change', () => {
                nativeEditorState.rewrite.preset = elements.rewritePreset.value || 'polish';
                nativeEditorState.rewrite.savedPromptId = '';
                nativeEditorState.rewrite.instruction = '';
                nativeEditorState.rewrite.instruction = rewriteInstructionText();
                if (elements.rewriteInstruction) elements.rewriteInstruction.value = nativeEditorState.rewrite.instruction;
                renderNativeRewrite();
            });
        }
        if (elements.rewriteSavedPrompt) {
            elements.rewriteSavedPrompt.addEventListener('change', function () {
                var selectedId = elements.rewriteSavedPrompt.value || '';
                nativeEditorState.rewrite.savedPromptId = selectedId;
                if (selectedId) {
                    var selected = rewritePromptState.prompts.find(function (p) { return p.id === selectedId; });
                    if (selected && selected.content) {
                        nativeEditorState.rewrite.preset = 'custom';
                        nativeEditorState.rewrite.instruction = selected.content;
                        if (elements.rewritePreset) elements.rewritePreset.value = 'custom';
                        if (elements.rewriteInstruction) elements.rewriteInstruction.value = selected.content;
                    }
                }
                renderNativeRewrite();
            });
        }
        if (elements.rewriteInstruction) {
            elements.rewriteInstruction.addEventListener('input', () => {
                nativeEditorState.rewrite.instruction = elements.rewriteInstruction.value || '';
                nativeEditorState.rewrite.savedPromptId = '';
                nativeEditorState.rewrite.preset = 'custom';
                if (elements.rewritePreset) elements.rewritePreset.value = 'custom';
                renderNativeRewrite();
            });
            elements.rewriteInstruction.addEventListener('focus', () => {
                if (typeof syncNativeComposerExpansion === 'function') syncNativeComposerExpansion(true);
            });
            elements.rewriteInstruction.addEventListener('blur', () => {
                if (typeof syncNativeComposerExpansion === 'function') syncNativeComposerExpansion(false);
            });
            elements.rewriteInstruction.addEventListener('keydown', (event) => {
                if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
                event.preventDefault();
                if (nativeEditorState.generation.inProgress) return;
                startNativeRewrite();
            });
        }
        if (elements.regenerateUseContext) {
            elements.regenerateUseContext.addEventListener('change', function () {
                nativeEditorState.rewrite.regenerateUseContext = elements.regenerateUseContext.checked !== false;
                if (typeof saveNativeContextBudgets === 'function') saveNativeContextBudgets();
                renderNativeRewrite();
            });
        }
        if (elements.regenerateInstruction) {
            elements.regenerateInstruction.addEventListener('input', () => {
                nativeEditorState.rewrite.regenerateInstruction = elements.regenerateInstruction.value;
            });
        }
        const rewriteContextChars = document.querySelector('[data-native-rewrite-context-chars]');
        if (rewriteContextChars) {
            rewriteContextChars.addEventListener('change', function () {
                nativeEditorState.rewrite.rewriteContextChars = Number(rewriteContextChars.value);
                if (typeof saveNativeContextBudgets === 'function') saveNativeContextBudgets();
                renderNativeRewrite();
            });
        }
        const regenerateContextChars = document.querySelector('[data-native-regenerate-context-chars]');
        if (regenerateContextChars) {
            regenerateContextChars.addEventListener('change', function () {
                nativeEditorState.rewrite.regenerateContextChars = Number(regenerateContextChars.value);
                if (typeof saveNativeContextBudgets === 'function') saveNativeContextBudgets();
                renderNativeRewrite();
            });
        }
        if (elements.writerTemperature) {
            elements.writerTemperature.addEventListener('change', function () {
                saveWriterGenerationDefaults({ temperature: Number(elements.writerTemperature.value || 0.8) });
            });
        }
        if (elements.writerMaxTokens) {
            elements.writerMaxTokens.addEventListener('change', function () {
                saveWriterGenerationDefaults({ maxTokens: Number(elements.writerMaxTokens.value || 8000) });
            });
        }
        if (elements.writerProviderDefaults) {
            elements.writerProviderDefaults.addEventListener('change', function () {
                saveWriterGenerationDefaults({ useProviderDefaults: !!elements.writerProviderDefaults.checked });
            });
        }
        if (elements.lengthHint) {
            elements.lengthHint.addEventListener('change', function () {
                const hint = elements.lengthHint.value || 'natural';
                nativeEditorState.generation.lengthHint = hint;
                saveWriterGenerationDefaults({ lengthHint: hint });
            });
        }
        if (elements.previewRewrite) elements.previewRewrite.addEventListener('click', showNativeRewritePreview);
        if (elements.startRewrite) elements.startRewrite.addEventListener('click', startNativeRewrite);
        if (elements.regenerateSelection) elements.regenerateSelection.addEventListener('click', startNativeRegenerateSelection);
        if (elements.genTaskButtons && elements.genTaskButtons.length) {
            elements.genTaskButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    nativeEditorState.generation.genTask = btn.getAttribute('data-native-gen-task') || 'continue';
                    renderNativeGeneration();
                });
            });
        }
        if (elements.copilotSuggestionButtons && elements.copilotSuggestionButtons.length) {
            elements.copilotSuggestionButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    nativeEditorState.generation.genTask = 'beat';
                    nativeEditorState.generation.beat = btn.getAttribute('data-native-copilot-suggestion') || '';
                    if (elements.beatInput) elements.beatInput.value = nativeEditorState.generation.beat;
                    renderNativeGeneration();
                    if (elements.beatInput) elements.beatInput.focus();
                });
            });
        }
        if (elements.rewriteTaskButtons && elements.rewriteTaskButtons.length) {
            const rewriteTaskPresetMap = {
                polish: 'balanced-polish',
                expand: 'expand',
                shorten: 'tighten',
                style: 'literary'
            };
            elements.rewriteTaskButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const task = btn.getAttribute('data-native-rewrite-task') || 'polish';
                    nativeEditorState.rewrite.rewriteTask = task;
                    nativeEditorState.rewrite.preset = rewriteTaskPresetMap[task] || 'balanced-polish';
                    nativeEditorState.rewrite.savedPromptId = '';
                    nativeEditorState.rewrite.instruction = '';
                    nativeEditorState.rewrite.instruction = rewriteInstructionText();
                    if (elements.rewriteInstruction) elements.rewriteInstruction.value = nativeEditorState.rewrite.instruction;
                    renderNativeRewrite();
                });
            });
        }
        if (elements.generateSceneSummary) elements.generateSceneSummary.addEventListener('click', () => generateNativeSummary('scene'));
        if (elements.generateChapterSummary) elements.generateChapterSummary.addEventListener('click', () => generateNativeSummary('chapter'));
        if (elements.summaryTemplate) {
            elements.summaryTemplate.addEventListener('change', () => {
                summaryPromptState.selectedId = elements.summaryTemplate.value || 'auto';
                renderSummaryPromptTemplates();
            });
        }
        if (elements.newCharacter) {
            elements.newCharacter.addEventListener('click', async () => {
                compendiumState.type = 'character';
                await createCompendiumEntry('character');
                nativeEditorState.assistantPanel = 'characters';
                renderNativeEditor();
            });
        }
        if (elements.openCompendium) {
            elements.openCompendium.addEventListener('click', () => {
                compendiumState.type = 'character';
                setView('compendium');
                renderCompendium();
            });
        }
        document.addEventListener('click', (event) => {
            const target = event.target && event.target.closest ? event.target.closest('[data-native-generate],[data-native-preview-prompt],[data-native-cancel-generation],[data-native-accept-generation],[data-native-retry-generation],[data-native-discard-generation]') : null;
            if (!target) return;
            if (target.dataset.nativeGenerate !== undefined) {
                if (nativeEditorState.generation.genTask === 'summary') {
                    generateNativeSummary('scene');
                } else {
                    startNativeGeneration();
                }
            }
            if (target.dataset.nativePreviewPrompt !== undefined) showNativePromptPreview();
            if (target.dataset.nativeCancelGeneration !== undefined) cancelNativeGeneration();
            if (target.dataset.nativeAcceptGeneration !== undefined) {
                if (nativeEditorState.generation.task === 'rewrite' || nativeEditorState.generation.task === 'regenerate-selection') {
                    acceptNativeRewrite();
                } else {
                    acceptNativeGeneration();
                }
            }
            if (target.dataset.nativeRetryGeneration !== undefined) {
                if (nativeEditorState.generation.task === 'rewrite') {
                    startNativeRewrite({ retry: true });
                } else if (nativeEditorState.generation.task === 'regenerate-selection') {
                    startNativeRegenerateSelection({ retry: true });
                } else if (nativeEditorState.generation.task === 'summary') {
                    generateNativeSummary(nativeEditorState.generation.summaryScope || 'scene');
                } else if (nativeEditorState.generation.genTask === 'summary') {
                    generateNativeSummary('scene');
                } else {
                    startNativeGeneration();
                }
            }
            if (target.dataset.nativeDiscardGeneration !== undefined) discardNativeGeneration();
        });
        document.addEventListener('click', (event) => {
            const action = event.target && event.target.closest ? event.target.closest('[data-native-context-action]') : null;
            if (action) {
                const key = action.dataset.nativeContextAction;
                if (key === 'format-manuscript' && nativeWriterEditorLocked()) return;
                closeNativeWriterPopovers({ restoreFocus: true });
                if (key === 'regenerate-selection') {
                    openNativeRegenerateSettings();
                    return;
                }
                if (typeof restoreNativeRewriteSelection === 'function') restoreNativeRewriteSelection();
                if (key === 'rewrite-selection') {
                    nativeEditorState.assistantPanel = 'rewrite';
                    nativeEditorState.assistantPanelByGroup = nativeEditorState.assistantPanelByGroup || {};
                    nativeEditorState.assistantPanelByGroup.writing = 'rewrite';
                    nativeEditorState.rewrite.rewriteTask = 'polish';
                    nativeEditorState.rewrite.preset = 'balanced-polish';
                    nativeEditorState.rewrite.savedPromptId = '';
                    nativeEditorState.rewrite.instruction = '';
                    nativeEditorState.rewrite.instruction = rewriteInstructionText();
                    if (typeof flushNativeEditorFields === 'function') flushNativeEditorFields();
                    renderNativeEditor();
                    if (typeof restoreNativeRewriteSelection === 'function') restoreNativeRewriteSelection();
                    renderNativeRewrite();
                } else if (key === 'send-to-workshop') {
                    sendNativeSelectionToWorkshop();
                } else if (key === 'extract-compendium') {
                    openNativeCompendiumExtraction();
                } else if (key === 'generate-summary') {
                    generateNativeSummary('scene');
                } else if (key === 'view-summary') {
                    openNativeSummaryDialog('scene');
                } else if (key === 'format-manuscript') {
                    applyNativeManuscriptFormat();
                } else if (key === 'save') {
                    saveNativeScene();
                } else if (key === 'read-aloud') {
                    readNativeSceneAloud();
                }
                return;
            }
            const menu = nativeEditorElements().contextMenu;
            if (menu && !menu.hidden && !(event.target && event.target.closest && event.target.closest('[data-native-context-menu]'))) closeNativeWriterPopovers();
        });
        window.addEventListener('keydown', (event) => {
            if (!nativeEditorState.snapshot || !nativeWriterShortcutsAvailable(event)) return;
            const isSave = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's';
            if (isSave) {
                event.preventDefault();
                saveNativeScene();
                return;
            }
            const target = event.target && event.target.closest ? event.target : document.activeElement;
            if (target && target.closest && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
            if (nativeWriterEditorLocked()) return;
            const isNewScene = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n';
            if (isNewScene) {
                event.preventDefault();
                addNativeScene();
            }
            if (event.altKey && event.key === 'ArrowUp') {
                event.preventDefault();
                switchNativeScene(-1);
            }
            if (event.altKey && event.key === 'ArrowDown') {
                event.preventDefault();
                switchNativeScene(1);
            }
        });
        window.addEventListener('beforeunload', (event) => {
            const compendiumDirty = typeof compendiumState !== 'undefined' && compendiumState.dirty;
            const compendiumWriting = (typeof compendiumEditorSession !== 'undefined'
                && (compendiumEditorSession.saves.size || compendiumEditorSession.creating || compendiumEditorSession.deleting))
                || (typeof compendiumRewriteState !== 'undefined' && compendiumRewriteState.saving)
                || (typeof compendiumExtractionState !== 'undefined' && compendiumExtractionState.saving)
                || (typeof compendiumDrawState !== 'undefined' && compendiumDrawState.saving)
                || (typeof compendiumAgentState !== 'undefined' && compendiumAgentState.applying);
            if (!nativeEditorState.dirty && !nativeEditorState.isSaving && !compendiumDirty && !compendiumWriting) return;
            event.preventDefault();
            event.returnValue = '';
        });
        renderNativeEditor();
    }

    function bindContextStrip() {
        const elements = contextStripElements();
        if (elements.gotoWriter) elements.gotoWriter.addEventListener('click', () => setView('writer'));
        if (elements.gotoCompendium) elements.gotoCompendium.addEventListener('click', () => {
            setView('compendium');
            renderCompendium();
        });
        if (elements.gotoWorkshop) elements.gotoWorkshop.addEventListener('click', async () => {
            if (currentProjectId() && !selectedWorkshopSession()) {
                await createWorkshopSession();
            }
            setView('workshop');
            renderWorkshop();
        });
        if (elements.gotoBookshelf) elements.gotoBookshelf.addEventListener('click', () => setView('bookshelf'));
    }
