    function bindNativeEditor() {
        const elements = nativeEditorElements();
        if (typeof bindNativeSidebarResize === 'function') bindNativeSidebarResize();
        if (typeof bindNativeGlobalPrompt === 'function') bindNativeGlobalPrompt();
        if (typeof bindNativeWriterChrome === 'function') bindNativeWriterChrome();
        if (typeof loadNativeContextBudgets === 'function') loadNativeContextBudgets();
        if (typeof window.bindNativeGenerationOutputDrag === 'function') window.bindNativeGenerationOutputDrag();
        if (typeof window.bindNativeGenerationLayer === 'function') window.bindNativeGenerationLayer();
        if (elements.saveButton) {
            elements.saveButton.addEventListener('click', () => {
                saveNativeScene();
            });
        }
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
                const assistantResizer = document.querySelector('[data-native-resize-assistant]');
                if (assistantResizer) assistantResizer.setAttribute('aria-orientation', nativeEditorState.assistantPlacement === 'bottom' ? 'horizontal' : 'vertical');
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
            if (target.closest('[data-native-typography], [data-native-specials], [data-native-toggle-typography], [data-native-toggle-specials], [data-native-more-menu], [data-native-more-tools], [data-native-outline-menu]')) return;
            closeNativeWriterPopovers();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
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
            closeNativeWriterPopovers();
            if (moreWasOpen && typeof hideNativeMoreMenu === 'function') hideNativeMoreMenu({ restoreFocus: true });
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
                nativeEditorState.assistantPanel = remembered || assistantGroupDefaults[group] || 'generate';
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
        if (elements.replaceCurrent) elements.replaceCurrent.addEventListener('click', () => replaceNativeText('current'));
        if (elements.replaceAll) elements.replaceAll.addEventListener('click', () => replaceNativeText('all'));
        if (elements.searchPrev) elements.searchPrev.addEventListener('click', () => navigateNativeSearchMatch(-1));
        if (elements.searchNext) elements.searchNext.addEventListener('click', () => navigateNativeSearchMatch(1));
        if (elements.editor) {
            elements.editor.addEventListener('input', () => {
                if (!nativeEditorState.snapshot || !nativeEditorState.activeSceneId) return;
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
        }
        if (elements.summaryDialogClose) elements.summaryDialogClose.addEventListener('click', closeNativeSummaryDialog);
        if (elements.summaryDialogCopy) elements.summaryDialogCopy.addEventListener('click', copyNativeSummaryDialog);
        if (elements.summaryDialogEdit) elements.summaryDialogEdit.addEventListener('click', editNativeSummaryDialog);
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
        if (elements.thinkingToggle) {
            elements.thinkingToggle.addEventListener('change', () => {
                writerModelOverride.thinking = !!elements.thinkingToggle.checked;
                saveWriterModelOverride();
                renderWriterModelControl();
            });
        }
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
        }
        if (elements.regenerateUseContext) {
            elements.regenerateUseContext.addEventListener('change', function () {
                nativeEditorState.rewrite.regenerateUseContext = elements.regenerateUseContext.checked !== false;
                if (typeof saveNativeContextBudgets === 'function') saveNativeContextBudgets();
                renderNativeRewrite();
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
                    startNativeRewrite();
                } else if (nativeEditorState.generation.task === 'regenerate-selection') {
                    startNativeRegenerateSelection();
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
                closeNativeWriterPopovers();
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
                } else if (key === 'regenerate-selection') {
                    startNativeRegenerateSelection();
                } else if (key === 'send-to-workshop') {
                    sendNativeSelectionToWorkshop();
                } else if (key === 'extract-compendium') {
                    openNativeCompendiumExtraction();
                } else if (key === 'generate-summary') {
                    generateNativeSummary('scene');
                } else if (key === 'view-summary') {
                    openNativeSummaryDialog('scene');
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
            if (!nativeEditorState.snapshot) return;
            const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
            if (isSave) {
                event.preventDefault();
                saveNativeScene();
            }
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
            if (!nativeEditorState.dirty) return;
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
