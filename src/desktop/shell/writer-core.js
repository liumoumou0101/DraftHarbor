    function nativeEditorElements() {
        return {
            root: document.querySelector('[data-native-writer]'),
            projectSource: document.querySelector('[data-native-project-source]'),
            projectTitle: document.querySelector('[data-native-project-title]'),
            projectMeta: document.querySelector('[data-native-project-meta]'),
            newProject: document.querySelector('[data-native-new-project]'),
            showBookshelf: document.querySelector('[data-native-show-bookshelf]'),
            search: document.querySelector('[data-native-search]'),
            replace: document.querySelector('[data-native-replace]'),
            replaceCurrent: document.querySelector('[data-native-replace-current]'),
            replaceAll: document.querySelector('[data-native-replace-all]'),
            searchStatus: document.querySelector('[data-native-search-status]'),
            searchPrev: document.querySelector('[data-native-search-prev]'),
            searchNext: document.querySelector('[data-native-search-next]'),
            sceneList: document.querySelector('[data-native-scene-list]'),
            chapterTitle: document.querySelector('[data-native-chapter-title]'),
            sceneTitle: document.querySelector('[data-native-scene-title]'),
            paperHeading: document.querySelector('[data-native-paper-heading]'),
            paperChapter: document.querySelector('[data-native-paper-chapter]'),
            paperTitle: document.querySelector('[data-native-paper-title]'),
            paperStats: document.querySelector('[data-native-paper-stats]'),
            paperPosition: document.querySelector('[data-native-paper-position]'),
            paperStatus: document.querySelector('[data-native-paper-status]'),
            editorBody: document.querySelector('.desktop-native-editor-body'),
            editor: document.querySelector('[data-native-scene-editor]'),
            contextMenu: document.querySelector('[data-native-context-menu]'),
            contextSelectionActions: document.querySelector('[data-native-context-selection-actions]'),
            contextViewSummary: document.querySelector('[data-native-context-action="view-summary"]'),
            summary: document.querySelector('[data-native-scene-summary]'),
            summaryLabel: document.querySelector('[data-native-summary-label]'),
            summaryStale: document.querySelector('[data-native-summary-stale]'),
            generateSceneSummary: document.querySelector('[data-native-generate-scene-summary]'),
            generateChapterSummary: document.querySelector('[data-native-generate-chapter-summary]'),
            summaryTemplate: document.querySelector('[data-native-summary-template]'),
            summaryDialog: document.querySelector('[data-native-summary-dialog]'),
            summaryDialogTitle: document.querySelector('[data-native-summary-dialog-title]'),
            summaryDialogMeta: document.querySelector('[data-native-summary-dialog-meta]'),
            summaryDialogContent: document.querySelector('[data-native-summary-dialog-content]'),
            summaryDialogCopy: document.querySelector('[data-native-summary-dialog-copy]'),
            summaryDialogEdit: document.querySelector('[data-native-summary-dialog-edit]'),
            summaryDialogClose: document.querySelector('[data-native-summary-dialog-close]'),
            tags: document.querySelector('[data-native-scene-tags]'),
            pov: document.querySelector('[data-native-scene-pov]'),
            tense: document.querySelector('[data-native-scene-tense]'),
            stats: document.querySelector('[data-native-editor-stats]'),
            sendToWorkshop: document.querySelector('[data-native-send-to-workshop]'),
            saveToCompendium: document.querySelector('[data-native-save-to-compendium]'),
            saveStatus: document.querySelector('[data-native-save-status]'),
            saveButton: document.querySelector('[data-native-save-scene]'),
            readAloud: document.querySelector('[data-native-read-aloud]'),
            stopReading: document.querySelector('[data-native-stop-reading]'),
            toggleOutline: document.querySelector('[data-native-toggle-outline]'),
            toggleAssistant: document.querySelector('[data-native-toggle-assistant]'),
            assistantPlacement: document.querySelector('[data-native-assistant-placement]'),
            toggleSpecials: document.querySelector('[data-native-toggle-specials]'),
            specials: document.querySelector('[data-native-specials]'),
            specialButtons: Array.from(document.querySelectorAll('[data-native-special-char]')),
            toggleTypography: document.querySelector('[data-native-toggle-typography]'),
            typography: document.querySelector('[data-native-typography]'),
            editorFontSize: document.querySelector('[data-native-editor-font-size]'),
            editorFontSizeValue: document.querySelector('[data-native-editor-font-size-value]'),
            editorLineHeight: document.querySelector('[data-native-editor-line-height]'),
            editorLineHeightValue: document.querySelector('[data-native-editor-line-height-value]'),
            editorTextWidth: document.querySelector('[data-native-editor-text-width]'),
            editorTextWidthValue: document.querySelector('[data-native-editor-text-width-value]'),
            editorParagraphSpacing: document.querySelector('[data-native-editor-paragraph-spacing]'),
            editorParagraphSpacingValue: document.querySelector('[data-native-editor-paragraph-spacing-value]'),
            editorFontFamily: document.querySelector('[data-native-editor-font-family]'),
            editorWordGoal: document.querySelector('[data-native-editor-word-goal]'),
            focusMode: document.querySelector('[data-native-focus-mode]'),
            addChapter: document.querySelector('[data-native-add-chapter]'),
            renameChapter: document.querySelector('[data-native-rename-chapter]'),
            deleteChapter: document.querySelector('[data-native-delete-chapter]'),
            addScene: document.querySelector('[data-native-add-scene]'),
            renameScene: document.querySelector('[data-native-rename-scene]'),
            deleteScene: document.querySelector('[data-native-delete-scene]'),
            moveSceneUp: document.querySelector('[data-native-move-scene-up]'),
            moveSceneDown: document.querySelector('[data-native-move-scene-down]'),
            exportMarkdown: document.querySelector('[data-native-export-md]'),
            exportText: document.querySelector('[data-native-export-txt]'),
            exportHtml: document.querySelector('[data-native-export-html]'),
            exportEpub: document.querySelector('[data-native-export-epub]'),
            exportPackage: document.querySelector('[data-native-export-package]'),
            exportIncludeSceneTitles: document.querySelector('[data-native-export-include-scene-titles]'),
            promptTemplate: document.querySelector('[data-native-prompt-template]'),
            managePrompts: document.querySelector('[data-native-manage-prompts]'),
            genTaskButtons: Array.from(document.querySelectorAll('[data-native-gen-task]')),
            beatInput: document.querySelector('[data-native-beat-input]'),
            insertMode: document.querySelector('[data-native-generation-insert-mode]'),
            previewPrompt: document.querySelector('[data-native-preview-prompt]'),
            generate: document.querySelector('[data-native-generate]'),
            cancelGeneration: document.querySelector('[data-native-cancel-generation]'),
            generationOutput: document.querySelector('[data-native-generation-output]'),
            generationOutputStatus: document.querySelector('[data-native-generation-output-status]'),
            generationResult: document.querySelector('[data-native-generation-result]'),
            reasoning: document.querySelector('[data-native-reasoning]'),
            reasoningText: document.querySelector('[data-native-reasoning-text]'),
            acceptGeneration: document.querySelector('[data-native-accept-generation]'),
            retryGeneration: document.querySelector('[data-native-retry-generation]'),
            discardGeneration: document.querySelector('[data-native-discard-generation]'),
            rewriteOriginalText: document.querySelector('[data-native-rewrite-original-text]'),
            rewritePreset: document.querySelector('[data-native-rewrite-preset]'),
            rewritePresetDescription: document.querySelector('[data-native-rewrite-preset-description]'),
            rewriteSavedPrompt: document.querySelector('[data-native-rewrite-saved-prompt]'),
            rewriteInstruction: document.querySelector('[data-native-rewrite-instruction]'),
            previewRewrite: document.querySelector('[data-native-preview-rewrite]'),
            startRewrite: document.querySelector('[data-native-start-rewrite]'),
            regenerateSelection: document.querySelector('[data-native-regenerate-selection]'),
            rewriteTaskButtons: Array.from(document.querySelectorAll('[data-native-rewrite-task]')),
            regenerateUseContext: document.querySelector('[data-native-regenerate-use-context]'),
            newCharacter: document.querySelector('[data-native-new-character]'),
            openCompendium: document.querySelector('[data-native-open-compendium]'),
            characterList: document.querySelector('[data-native-character-list]'),
            contextSummary: document.querySelector('[data-native-context-summary]'),
            contextCompendium: document.querySelector('[data-native-context-compendium]'),
            contextCompendiumTags: document.querySelector('[data-native-context-compendium-tags]'),
            contextChapters: document.querySelector('[data-native-context-chapters]'),
            contextScenes: document.querySelector('[data-native-context-scenes]'),
            promptDialog: document.querySelector('[data-native-prompt-dialog]'),
            promptPreview: document.querySelector('[data-native-prompt-preview]'),
            closePrompt: document.querySelector('[data-native-close-prompt]'),
            promptManagerDialog: document.querySelector('[data-prompt-manager-dialog]'),
            promptManagerForm: document.querySelector('[data-prompt-manager-form]'),
            promptManagerList: document.querySelector('[data-prompt-manager-list]'),
            promptManagerCount: document.querySelector('[data-prompt-manager-count]'),
            promptManagerStatus: document.querySelector('[data-prompt-manager-status]'),
            promptManagerTitle: document.querySelector('[data-prompt-manager-title]'),
            promptManagerCategory: document.querySelector('[data-prompt-manager-category]'),
            promptManagerSystem: document.querySelector('[data-prompt-manager-system]'),
            promptManagerContent: document.querySelector('[data-prompt-manager-content]'),
            promptManagerNew: document.querySelector('[data-prompt-manager-new]'),
            promptManagerDelete: document.querySelector('[data-prompt-manager-delete]'),
            promptManagerClose: document.querySelector('[data-prompt-manager-close]'),
            panelTabs: Array.from(document.querySelectorAll('[data-native-panel-tab]')),
            panels: Array.from(document.querySelectorAll('[data-native-panel]')),
            generationHistory: document.querySelector('[data-native-generation-history]'),
            historyToolbar: document.querySelector('[data-native-history-toolbar]'),
            copilotGreeting: document.querySelector('[data-native-copilot-greeting]'),
            copilotBrief: document.querySelector('[data-native-copilot-brief]'),
            copilotContextNote: document.querySelector('[data-native-copilot-context-note]'),
            copilotScene: document.querySelector('[data-native-copilot-scene]'),
            copilotChapter: document.querySelector('[data-native-copilot-chapter]'),
            copilotWords: document.querySelector('[data-native-copilot-words]'),
            copilotSuggestionButtons: Array.from(document.querySelectorAll('[data-native-copilot-suggestion]')),
            nameModal: document.querySelector('[data-native-name-modal]'),
            nameForm: document.querySelector('[data-native-name-form]'),
            nameKicker: document.querySelector('[data-native-name-kicker]'),
            nameTitle: document.querySelector('[data-native-name-title]'),
            nameLabel: document.querySelector('[data-native-name-label]'),
            nameInput: document.querySelector('[data-native-name-input]'),
            nameStatus: document.querySelector('[data-native-name-status]'),
            nameCancelButtons: Array.from(document.querySelectorAll('[data-native-name-cancel]')),
            modelControl: document.querySelector('[data-native-model-control]'),
            modelControlHint: document.querySelector('[data-native-model-control-hint]'),
            modelSelect: document.querySelector('[data-native-model-select]'),
            profileSelect: document.querySelector('[data-native-profile-select]'),
            customModelInput: document.querySelector('[data-native-custom-model]'),
            customModelGroup: document.querySelector('[data-native-custom-model-group]'),
            thinkingToggle: document.querySelector('[data-native-thinking-toggle]'),
            writerTemperature: document.querySelector('[data-native-temperature]'),
            writerMaxTokens: document.querySelector('[data-native-max-tokens]'),
            writerProviderDefaults: document.querySelector('[data-native-provider-defaults]'),
            writerSamplingHint: document.querySelector('[data-native-sampling-hint]')
        };
    }
    function nativeSceneContent(sceneId) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !snapshot.sceneContents) return '';
        return String(snapshot.sceneContents[sceneId] || '');
    }

    function setNativeSaveStatus(message, tone = 'info') {
        const { saveStatus, paperStatus } = nativeEditorElements();
        if (!saveStatus) return;
        saveStatus.textContent = message || '';
        saveStatus.dataset.tone = tone;
        if (paperStatus) {
            paperStatus.textContent = message || (currentNativeScene() ? '本地草稿' : '未选择场景');
            paperStatus.dataset.tone = tone;
        }
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    function loadNativeEditorPrefs() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(NATIVE_EDITOR_PREFS_STORAGE_KEY) || '{}');
            nativeEditorState.editorPrefs = {
                fontSize: clampNumber(saved.fontSize, 15, 24, nativeEditorState.editorPrefs.fontSize),
                lineHeight: clampNumber(saved.lineHeight, 1.45, 2.2, nativeEditorState.editorPrefs.lineHeight),
                textWidth: clampNumber(saved.textWidth, 620, 1040, nativeEditorState.editorPrefs.textWidth),
                paragraphSpacing: clampNumber(saved.paragraphSpacing, 0, 1.5, nativeEditorState.editorPrefs.paragraphSpacing),
                fontFamily: ['system', 'serif', 'yahei'].includes(saved.fontFamily) ? saved.fontFamily : nativeEditorState.editorPrefs.fontFamily,
                wordGoal: clampNumber(saved.wordGoal, 0, 999999, nativeEditorState.editorPrefs.wordGoal)
            };
        } catch (error) {
            nativeEditorState.editorPrefs = { fontSize: 18, lineHeight: 1.9, textWidth: 760, paragraphSpacing: 0, fontFamily: 'system', wordGoal: 0 };
        }
    }

    function saveNativeEditorPrefs() {
        try {
            window.localStorage.setItem(NATIVE_EDITOR_PREFS_STORAGE_KEY, JSON.stringify(nativeEditorState.editorPrefs));
        } catch (error) {
            /* ignore local preference persistence errors */
        }
    }

    function loadExportOptions() {
        try {
            const elements = nativeEditorElements();
            const saved = JSON.parse(window.localStorage.getItem(EXPORT_OPTIONS_STORAGE_KEY) || '{}');
            if (elements.exportIncludeSceneTitles) {
                elements.exportIncludeSceneTitles.checked = saved.includeSceneTitles !== false;
            }
        } catch (error) {
            /* ignore */
        }
    }

    function saveExportOptions() {
        try {
            const elements = nativeEditorElements();
            window.localStorage.setItem(EXPORT_OPTIONS_STORAGE_KEY, JSON.stringify({
                includeSceneTitles: elements.exportIncludeSceneTitles ? elements.exportIncludeSceneTitles.checked : true
            }));
        } catch (error) {
            /* ignore local preference persistence errors */
        }
    }

    function editorFontStack() {
        const family = nativeEditorState.editorPrefs.fontFamily;
        if (family === 'serif') {
            return '"SimSun", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif';
        }
        if (family === 'yahei') {
            return '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif';
        }
        return '"Microsoft YaHei", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    }

    function applyNativeEditorPrefs() {
        const elements = nativeEditorElements();
        const prefs = nativeEditorState.editorPrefs;
        if (elements.root) {
            elements.root.style.setProperty('--native-editor-font-size', `${prefs.fontSize}px`);
            elements.root.style.setProperty('--native-editor-line-height', String(prefs.lineHeight));
            elements.root.style.setProperty('--native-editor-text-width', `${prefs.textWidth}px`);
            elements.root.style.setProperty('--native-editor-paragraph-spacing', `${prefs.paragraphSpacing}em`);
            elements.root.style.setProperty('--native-editor-font-family', editorFontStack());
        }
        if (elements.editorFontSize) elements.editorFontSize.value = String(prefs.fontSize);
        if (elements.editorFontSizeValue) elements.editorFontSizeValue.textContent = String(prefs.fontSize);
        if (elements.editorLineHeight) elements.editorLineHeight.value = String(prefs.lineHeight);
        if (elements.editorLineHeightValue) elements.editorLineHeightValue.textContent = prefs.lineHeight.toFixed(2);
        if (elements.editorTextWidth) elements.editorTextWidth.value = String(prefs.textWidth);
        if (elements.editorTextWidthValue) elements.editorTextWidthValue.textContent = String(prefs.textWidth);
        if (elements.editorParagraphSpacing) elements.editorParagraphSpacing.value = String(prefs.paragraphSpacing);
        if (elements.editorParagraphSpacingValue) elements.editorParagraphSpacingValue.textContent = prefs.paragraphSpacing.toFixed(1);
        if (elements.editorFontFamily) elements.editorFontFamily.value = String(prefs.fontFamily);
        if (elements.editorWordGoal) {
            const goal = prefs.wordGoal || 0;
            if (elements.editorWordGoal.value !== String(goal)) elements.editorWordGoal.value = String(goal);
        }
        if (elements.typography) elements.typography.hidden = !nativeEditorState.typographyOpen;
        if (elements.toggleTypography) {
            elements.toggleTypography.setAttribute('aria-pressed', nativeEditorState.typographyOpen ? 'true' : 'false');
        }
        if (elements.toggleSpecials) {
            elements.toggleSpecials.setAttribute('aria-pressed', elements.specials && !elements.specials.hidden ? 'true' : 'false');
        }
    }

    function closeNativeWriterPopovers(options = {}) {
        const elements = nativeEditorElements();
        if (options.keep !== 'typography') {
            nativeEditorState.typographyOpen = false;
            if (elements.typography) elements.typography.hidden = true;
            if (elements.toggleTypography) elements.toggleTypography.setAttribute('aria-pressed', 'false');
        }
        if (options.keep !== 'specials') {
            if (elements.specials) elements.specials.hidden = true;
            if (elements.toggleSpecials) elements.toggleSpecials.setAttribute('aria-pressed', 'false');
        }
        if (options.keep !== 'context-menu' && elements.contextMenu) elements.contextMenu.hidden = true;
    }

    function countNativeWords(text) {
        const normalized = String(text || '').trim();
        if (!normalized) return 0;
        const cjk = normalized.match(/[\u3400-\u9fff]/g) || [];
        const words = normalized.replace(/[\u3400-\u9fff]/g, ' ')
            .split(/[\s,.;:!?()[\]{}"'，。！？、；：（）《》]+/)
            .filter(Boolean);
        return cjk.length + words.length;
    }

    function nativeSceneTags(scene) {
        if (!scene) return [];
        if (Array.isArray(scene.tags)) return scene.tags.filter(Boolean);
        if (typeof scene.tags === 'string') {
            return scene.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        }
        return [];
    }

    function nativeAvoidanceInstruction() {
        const snapshot = nativeEditorState.snapshot;
        const rules = [
            ...((settingsState.settings && settingsState.settings.globalStyleGuardRules) || []),
            ...(snapshot && Array.isArray(snapshot.styleGuardRules) ? snapshot.styleGuardRules : [])
        ];
        const api = window.DraftHarborAvoidanceRules;
        return api && typeof api.promptInstruction === 'function' ? api.promptInstruction(rules) : '';
    }

    function flushNativeEditorFields() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;

        snapshot.sceneContents = snapshot.sceneContents || {};
        if (elements.editor) {
            const nextContent = elements.editor.value;
            if (snapshot.sceneContents[scene.id] !== nextContent) markNativeSummaryStale(scene);
            snapshot.sceneContents[scene.id] = nextContent;
        }
        if (elements.summary) {
            const nextSummary = elements.summary.value.trim();
            if (nextSummary !== scene.summary) {
                scene.summary = nextSummary;
                scene.summaryUpdated = new Date().toISOString();
                scene.summarySource = 'manual';
                scene.summaryStale = false;
                markNativeChapterSummaryStale(scene.chapterId);
            }
        }
        renderNativeSummaryStaleState();
        if (elements.tags) scene.tags = elements.tags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        if (elements.pov) scene.povCharacter = elements.pov.value.trim();
        if (elements.tense) scene.tense = elements.tense.value;
    }

    function beginNativeSceneTitleEdit() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!elements.sceneTitle || !scene || nativeEditorState.titleEditing) return;
        nativeEditorState.titleEditing = true;
        nativeEditorState.titleEditingOriginal = scene.title || '';
        elements.sceneTitle.contentEditable = 'true';
        elements.sceneTitle.classList.add('is-editing');
        elements.sceneTitle.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(elements.sceneTitle);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function finishNativeSceneTitleEdit(options = {}) {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!elements.sceneTitle || !nativeEditorState.titleEditing) return;
        const nextTitle = options.cancel
            ? nativeEditorState.titleEditingOriginal
            : (elements.sceneTitle.textContent || '').trim();
        const finalTitle = nextTitle || nativeEditorState.titleEditingOriginal || '未命名场景';
        nativeEditorState.titleEditing = false;
        nativeEditorState.titleEditingOriginal = '';
        elements.sceneTitle.contentEditable = 'false';
        elements.sceneTitle.classList.remove('is-editing');
        if (!scene) {
            renderNativeEditor();
            return;
        }
        if (!options.cancel && finalTitle !== (scene.title || '')) {
            scene.title = finalTitle;
            markNativeDirty('标题未保存');
        }
        renderNativeEditor();
    }

    function updateNativeStats() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        const text = elements.editor ? elements.editor.value : '';
        const wordCount = countNativeWords(text);
        const goal = nativeEditorState.editorPrefs.wordGoal || 0;
        if (elements.stats) {
            if (scene && goal > 0) {
                elements.stats.textContent = `${formatNumber(wordCount)} / ${formatNumber(goal)} 字`;
                elements.stats.dataset.tone = wordCount >= goal ? 'goal-met' : '';
            } else if (scene) {
                elements.stats.textContent = `${formatNumber(wordCount)} 字`;
                delete elements.stats.dataset.tone;
            } else {
                elements.stats.textContent = '0 字';
                delete elements.stats.dataset.tone;
            }
        }
        if (elements.paperStats) {
            if (scene && goal > 0) {
                elements.paperStats.textContent = `${formatNumber(wordCount)} / ${formatNumber(goal)} 字`;
                elements.paperStats.dataset.tone = wordCount >= goal ? 'goal-met' : '';
            } else {
                elements.paperStats.textContent = scene ? `${formatNumber(wordCount)} 字` : '0 字';
                delete elements.paperStats.dataset.tone;
            }
        }
        if (elements.paperPosition) {
            const chapters = snapshot && Array.isArray(snapshot.chapters) ? snapshot.chapters : [];
            const scenes = snapshot && Array.isArray(snapshot.scenes) ? snapshot.scenes : [];
            const chapter = scene ? chapters.find((item) => item.id === scene.chapterId) : null;
            const chapterScenes = chapter ? scenes.filter((item) => item.chapterId === chapter.id) : [];
            const sceneIndex = scene ? chapterScenes.findIndex((item) => item.id === scene.id) : -1;
            elements.paperPosition.textContent = scene && sceneIndex >= 0
                ? `场景 ${sceneIndex + 1} / ${chapterScenes.length || 1}`
                : '未选择场景';
        }
    }

    function markNativeDirty(message = '未保存') {
        nativeEditorState.dirty = true;
        flushNativeEditorFields();
        updateNativeStats();
        setNativeSaveStatus(message, 'warn');
        scheduleNativeAutosave();
    }

    function markNativeChapterSummaryStale(chapterId) {
        const snapshot = nativeEditorState.snapshot;
        const chapter = snapshot && (snapshot.chapters || []).find((item) => item.id === chapterId);
        if (chapter && chapter.summary) chapter.summaryStale = true;
    }

    function markNativeSummaryStale(scene) {
        if (!scene) return;
        if (scene.summary) scene.summaryStale = true;
        markNativeChapterSummaryStale(scene.chapterId);
    }

    function renderNativeSummaryStaleState() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const stale = !!(scene && scene.summaryStale);
        if (elements.summaryLabel) elements.summaryLabel.textContent = stale ? '摘要（待更新）' : '摘要';
        if (elements.summaryStale) elements.summaryStale.hidden = !stale;
    }

    function scheduleNativeAutosave() {
        if (nativeEditorState.autosaveTimer) {
            window.clearTimeout(nativeEditorState.autosaveTimer);
        }
        nativeEditorState.autosaveTimer = window.setTimeout(() => {
            if (nativeEditorState.dirty && nativeEditorState.snapshot) {
                saveNativeScene({ reason: 'autosave' });
            }
        }, 1600);
    }

    function normalizeNativeOrders() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return;
        (snapshot.chapters || [])
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
            .forEach((chapter, index) => { chapter.order = index; });
        const chapterIds = new Set((snapshot.chapters || []).map((chapter) => chapter.id));
        (snapshot.scenes || []).forEach((scene) => {
            if (!chapterIds.has(scene.chapterId) && snapshot.chapters && snapshot.chapters[0]) {
                scene.chapterId = snapshot.chapters[0].id;
            }
        });
        (snapshot.chapters || []).forEach((chapter) => {
            (snapshot.scenes || [])
                .filter((scene) => scene.chapterId === chapter.id)
                .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
                .forEach((scene, index) => { scene.order = index; });
            chapter.sceneIds = (snapshot.scenes || [])
                .filter((scene) => scene.chapterId === chapter.id)
                .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
                .map((scene) => scene.id);
        });
        snapshot.chapterOrder = (snapshot.chapters || []).map((chapter) => chapter.id);
        snapshot.sceneOrder = (snapshot.chapters || []).flatMap((chapter) => chapter.sceneIds || []);
    }
    window.normalizeNativeOrders = normalizeNativeOrders;

    /** Outline label: 「第 N 章 · 章名」; keep if title already starts with 第…章. */
    function formatNativeChapterOutlineTitle(chapter, index) {
        const raw = String(chapter && chapter.title || '').trim() || `第 ${index + 1} 章`;
        if (/^第\s*[0-9一二三四五六七八九十百千零〇两]+章/.test(raw)) return raw;
        return `第 ${index + 1} 章 · ${raw}`;
    }

    function currentNativeScene() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return null;
        return (snapshot.scenes || []).find((scene) => scene.id === nativeEditorState.activeSceneId) || null;
    }

    function currentNativeChapter(scene) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !scene) return null;
        return (snapshot.chapters || []).find((chapter) => chapter.id === scene.chapterId) || null;
    }

    function setNativeToolbarButton(button, label, mark) {
        if (!button) return;
        const labelElement = button.querySelector('.desktop-native-tool-label');
        const markElement = button.querySelector('.desktop-native-tool-mark');
        if (labelElement) {
            labelElement.textContent = label;
        } else {
            button.textContent = label;
        }
        if (markElement && mark) markElement.textContent = mark;
    }

    function renderNativeEditor() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const project = snapshot && snapshot.project ? snapshot.project : null;
        if (!elements.root) return;
        elements.root.classList.toggle('is-focus-mode', nativeEditorState.focusMode);
        elements.root.classList.toggle('is-outline-collapsed', nativeEditorState.outlineCollapsed);
        elements.root.classList.toggle('is-assistant-collapsed', nativeEditorState.assistantCollapsed);
        elements.root.classList.toggle('is-assistant-bottom', nativeEditorState.assistantPlacement === 'bottom');
        applyNativeEditorPrefs();
        if (elements.assistantPlacement) {
            setNativeToolbarButton(elements.assistantPlacement, nativeEditorState.assistantPlacement === 'bottom' ? '辅助在右' : '辅助在下', nativeEditorState.assistantPlacement === 'bottom' ? '右' : '下');
            elements.assistantPlacement.setAttribute('aria-pressed', nativeEditorState.assistantPlacement === 'bottom' ? 'true' : 'false');
        }
        if (elements.focusMode) {
            setNativeToolbarButton(elements.focusMode, nativeEditorState.focusMode ? '退出专注' : '专注', nativeEditorState.focusMode ? '退' : '专');
            elements.focusMode.setAttribute('aria-pressed', nativeEditorState.focusMode ? 'true' : 'false');
        }
        if (elements.toggleOutline) {
            setNativeToolbarButton(elements.toggleOutline, nativeEditorState.outlineCollapsed ? '显示结构' : '隐藏结构', '纲');
            elements.toggleOutline.setAttribute('aria-pressed', nativeEditorState.outlineCollapsed ? 'true' : 'false');
        }
        if (elements.toggleAssistant) {
            setNativeToolbarButton(elements.toggleAssistant, nativeEditorState.assistantCollapsed ? '显示辅助' : '隐藏辅助', '助');
            elements.toggleAssistant.setAttribute('aria-pressed', nativeEditorState.assistantCollapsed ? 'true' : 'false');
        }
        elements.panelTabs.forEach((tab) => {
            tab.classList.toggle('is-active', tab.dataset.nativePanelTab === nativeEditorState.assistantPanel);
        });
        elements.panels.forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.nativePanel === nativeEditorState.assistantPanel);
        });

        if (!snapshot || !project) {
            if (elements.projectTitle) elements.projectTitle.textContent = '未打开项目';
            if (elements.projectMeta) elements.projectMeta.textContent = '从书架打开项目后开始编辑。';
            if (elements.projectSource) elements.projectSource.textContent = '项目';
            if (elements.search) {
                elements.search.value = '';
                elements.search.disabled = true;
            }
            if (elements.replace) {
                elements.replace.value = '';
                elements.replace.disabled = true;
            }
            if (elements.replaceCurrent) elements.replaceCurrent.disabled = true;
            if (elements.replaceAll) elements.replaceAll.disabled = true;
            if (elements.searchStatus) elements.searchStatus.textContent = '';
            if (elements.searchPrev) elements.searchPrev.disabled = true;
            if (elements.searchNext) elements.searchNext.disabled = true;
            if (elements.sceneList) elements.sceneList.replaceChildren();
            if (elements.chapterTitle) elements.chapterTitle.textContent = '场景编辑';
            if (elements.sceneTitle && !nativeEditorState.titleEditing) elements.sceneTitle.textContent = '选择一个场景';
            if (elements.editor) {
                elements.editor.value = '';
                elements.editor.disabled = true;
            }
            [elements.summary, elements.tags, elements.pov, elements.tense].forEach((field) => {
                if (!field) return;
                field.value = '';
                field.disabled = true;
            });
            if (elements.stats) {
                elements.stats.textContent = '0 字';
                delete elements.stats.dataset.tone;
            }
            if (elements.saveButton) elements.saveButton.disabled = true;
            [elements.sendToWorkshop, elements.saveToCompendium].forEach((button) => {
                if (!button) return;
                button.hidden = true;
                button.disabled = true;
            });
            if (elements.readAloud) {
                elements.readAloud.disabled = true;
                elements.readAloud.hidden = false;
            }
            if (elements.stopReading) elements.stopReading.hidden = true;
            if (elements.addChapter) elements.addChapter.disabled = true;
            if (elements.renameChapter) elements.renameChapter.disabled = true;
            if (elements.deleteChapter) elements.deleteChapter.disabled = true;
            if (elements.addScene) elements.addScene.disabled = true;
            if (elements.renameScene) elements.renameScene.disabled = true;
            if (elements.deleteScene) elements.deleteScene.disabled = true;
            if (elements.moveSceneUp) elements.moveSceneUp.disabled = true;
            if (elements.moveSceneDown) elements.moveSceneDown.disabled = true;
            if (elements.exportMarkdown) elements.exportMarkdown.disabled = true;
            if (elements.exportText) elements.exportText.disabled = true;
            if (elements.exportHtml) elements.exportHtml.disabled = true;
            if (elements.exportEpub) elements.exportEpub.disabled = true;
            if (elements.exportPackage) elements.exportPackage.disabled = true;
            if (elements.exportIncludeSceneTitles) elements.exportIncludeSceneTitles.disabled = true;
            if (elements.beatInput) {
                elements.beatInput.value = '';
                elements.beatInput.disabled = true;
            }
            if (elements.previewPrompt) elements.previewPrompt.disabled = true;
            if (elements.generate) elements.generate.disabled = true;
            setNativeSaveStatus('', 'info');
            renderNativeRewrite();
            renderNativeCharacters();
            renderNativeContext();
            renderNativeGeneration();
            return;
        }

        normalizeNativeOrders();
        const chapters = [...(snapshot.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        const scenes = [...(snapshot.scenes || [])];
        if (!nativeEditorState.activeSceneId && scenes[0]) nativeEditorState.activeSceneId = scenes[0].id;
        const activeScene = currentNativeScene();
        const activeSceneChapter = currentNativeChapter(activeScene);
        if (activeSceneChapter) nativeEditorState.activeChapterId = activeSceneChapter.id;
        if (!nativeEditorState.activeChapterId && chapters[0]) nativeEditorState.activeChapterId = chapters[0].id;
        const activeChapterId = nativeEditorState.activeChapterId;
        const activeChapter = currentNativeChapterByState();
        const query = nativeEditorState.searchQuery.trim().toLowerCase();

        // Default outline: expand active chapter (and first chapter if none active) so
        // hierarchy “第N章 · 章名 → 场景列表” is visible; other chapters stay collapsible.
        if (!nativeEditorState.expandedChapterIds) nativeEditorState.expandedChapterIds = new Set();
        if (!query && nativeEditorState.expandedChapterIds.size === 0 && activeChapterId) {
            nativeEditorState.expandedChapterIds.add(activeChapterId);
        }

        if (elements.projectTitle) elements.projectTitle.textContent = project.name || '未命名项目';
        if (elements.projectSource) elements.projectSource.textContent = nativeEditorState.projectSource === 'project-directory' ? '项目目录' : '旧快照';
        if (elements.projectMeta) {
            elements.projectMeta.textContent = `${scenes.length} 场 / ${chapters.length} 章`;
        }
        if (elements.search) {
            elements.search.disabled = false;
            if (elements.search.value !== nativeEditorState.searchQuery) elements.search.value = nativeEditorState.searchQuery;
        }
        if (elements.replace) elements.replace.disabled = false;
        if (elements.replaceCurrent) elements.replaceCurrent.disabled = !activeScene || !nativeEditorState.searchQuery;
        if (elements.replaceAll) elements.replaceAll.disabled = !nativeEditorState.searchQuery;

        if (elements.sceneList) {
            elements.sceneList.replaceChildren();
            chapters.forEach((chapter, chapterIndex) => {
                const chapterScenes = scenes
                    .filter((scene) => scene.chapterId === chapter.id)
                    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
                const visibleScenes = chapterScenes.filter((scene) => {
                    if (!query) return true;
                    const haystack = [
                        chapter.title,
                        scene.title,
                        scene.summary,
                        nativeSceneTags(scene).join(' '),
                        nativeSceneContent(scene.id)
                    ].join(' ').toLowerCase();
                    return haystack.includes(query);
                });
                if (query && !visibleScenes.length && !String(chapter.title || '').toLowerCase().includes(query)) {
                    return;
                }

                const chapterGroup = document.createElement('details');
                const chapterExpanded = !!query || nativeEditorState.expandedChapterIds.has(chapter.id);
                chapterGroup.className = 'desktop-native-chapter-group';
                chapterGroup.open = chapterExpanded;
                chapterGroup.classList.toggle('is-active', chapter.id === activeChapterId);

                const chapterLabel = document.createElement('summary');
                chapterLabel.className = 'desktop-native-chapter';
                chapterLabel.classList.toggle('is-active', chapter.id === activeChapterId);
                chapterLabel.dataset.nativeChapterId = chapter.id;
                chapterLabel.setAttribute('aria-expanded', String(chapterExpanded));
                chapterLabel.draggable = true;
                const chapterName = document.createElement('span');
                chapterName.textContent = formatNativeChapterOutlineTitle(chapter, chapterIndex);
                const chapterCount = document.createElement('span');
                chapterCount.className = 'desktop-native-chapter-count';
                chapterCount.textContent = `${chapterScenes.length} 场`;
                chapterLabel.append(chapterName, chapterCount);
                chapterLabel.addEventListener('click', (event) => {
                    event.preventDefault();
                    finishNativeSceneTitleEdit();
                    flushNativeEditorFields();
                    nativeEditorState.activeChapterId = chapter.id;
                    if (!query) {
                        if (chapterExpanded) nativeEditorState.expandedChapterIds.delete(chapter.id);
                        else nativeEditorState.expandedChapterIds.add(chapter.id);
                    }
                    if (!chapterScenes.some((scene) => scene.id === nativeEditorState.activeSceneId) && chapterScenes[0]) {
                        nativeEditorState.activeSceneId = chapterScenes[0].id;
                    }
                    renderNativeEditor();
                });
                chapterLabel.addEventListener('dragstart', (event) => {
                    event.dataTransfer.setData('text/plain', `chapter:${chapter.id}`);
                });
                chapterLabel.addEventListener('dragover', (event) => event.preventDefault());
                chapterLabel.addEventListener('drop', (event) => {
                    event.preventDefault();
                    const value = event.dataTransfer.getData('text/plain') || '';
                    if (!value.startsWith('chapter:')) return;
                    reorderNativeChapter(value.slice('chapter:'.length), chapter.id);
                });
                chapterGroup.appendChild(chapterLabel);

                visibleScenes.forEach((scene) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-native-scene';
                    button.classList.toggle('is-active', scene.id === nativeEditorState.activeSceneId);
                    button.dataset.nativeSceneId = scene.id;
                    button.draggable = true;
                    const title = document.createElement('span');
                    title.textContent = scene.title || '未命名场景';
                    const meta = document.createElement('small');
                    const wordCountLabel = `${formatNumber(countNativeWords(nativeSceneContent(scene.id)))} 字`;
                    const detailParts = [wordCountLabel];
                    if (scene.summary) detailParts.push('已有摘要');
                    if (nativeSceneTags(scene).length) detailParts.push(nativeSceneTags(scene).join('/'));
                    meta.textContent = wordCountLabel;
                    button.title = detailParts.join(' · ');
                    button.append(title, meta);
                    button.addEventListener('click', () => {
                        finishNativeSceneTitleEdit();
                        flushNativeEditorFields();
                        nativeEditorState.activeSceneId = scene.id;
                        nativeEditorState.activeChapterId = scene.chapterId;
                        nativeEditorState.expandedChapterIds.add(scene.chapterId);
                        renderNativeEditor();
                    });
                    button.addEventListener('dragstart', (event) => {
                        event.dataTransfer.setData('text/plain', `scene:${scene.id}`);
                    });
                    button.addEventListener('dragover', (event) => event.preventDefault());
                    button.addEventListener('drop', (event) => {
                        event.preventDefault();
                        const value = event.dataTransfer.getData('text/plain') || '';
                        if (!value.startsWith('scene:')) return;
                        reorderNativeScene(value.slice('scene:'.length), scene.id);
                    });
                    chapterGroup.appendChild(button);
                });
                elements.sceneList.appendChild(chapterGroup);
            });
        }

        const activeChapterIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === (activeChapter && activeChapter.id)));
        const activeChapterLabel = activeChapter
            ? formatNativeChapterOutlineTitle(activeChapter, activeChapterIndex)
            : '场景编辑';
        if (elements.chapterTitle) elements.chapterTitle.textContent = activeChapterLabel;
        if (elements.sceneTitle && !nativeEditorState.titleEditing) {
            elements.sceneTitle.textContent = activeScene ? (activeScene.title || '未命名场景') : '选择一个场景';
            elements.sceneTitle.contentEditable = 'false';
            elements.sceneTitle.classList.remove('is-editing');
        }
        if (elements.paperHeading) elements.paperHeading.hidden = !activeScene;
        if (elements.paperChapter) elements.paperChapter.textContent = activeChapterLabel;
        if (elements.paperTitle) elements.paperTitle.textContent = activeScene ? (activeScene.title || '未命名场景') : '选择一个场景';
        if (elements.editor) {
            elements.editor.disabled = !activeScene;
            elements.editor.value = activeScene ? nativeSceneContent(activeScene.id) : '';
        }
        if (query && activeScene) {
            updateNativeSearchMatchState();
        } else {
            nativeEditorState.searchMatchPositions = [];
            nativeEditorState.searchMatchIndex = -1;
            renderNativeSearchStatus();
        }
        if (elements.summary) {
            elements.summary.disabled = !activeScene;
            elements.summary.value = activeScene ? (activeScene.summary || '') : '';
        }
        if (elements.summaryTemplate) elements.summaryTemplate.disabled = !activeScene;
        renderNativeSummaryStaleState();
        if (elements.tags) {
            elements.tags.disabled = !activeScene;
            elements.tags.value = activeScene ? nativeSceneTags(activeScene).join(', ') : '';
        }
        if (elements.pov) {
            elements.pov.disabled = !activeScene;
            elements.pov.value = activeScene ? (activeScene.povCharacter || activeScene.pov || '') : '';
        }
        if (elements.tense) {
            elements.tense.disabled = !activeScene;
            elements.tense.value = activeScene ? (activeScene.tense || '') : '';
        }
        updateNativeStats();
        if (elements.saveButton) elements.saveButton.disabled = !activeScene;
        [elements.sendToWorkshop, elements.saveToCompendium].forEach((button) => {
            if (!button) return;
            button.hidden = !activeScene;
            button.disabled = !activeScene;
        });
        if (elements.readAloud) {
            elements.readAloud.disabled = !activeScene;
            elements.readAloud.hidden = nativeEditorState.tts.reading;
        }
        if (elements.stopReading) elements.stopReading.hidden = !nativeEditorState.tts.reading;
        if (elements.addChapter) elements.addChapter.disabled = false;
        if (elements.renameChapter) elements.renameChapter.disabled = !activeChapterId;
        if (elements.deleteChapter) elements.deleteChapter.disabled = !activeChapterId || chapters.length <= 1;
        if (elements.addScene) elements.addScene.disabled = !activeChapterId;
        if (elements.renameScene) elements.renameScene.disabled = !activeScene;
        if (elements.deleteScene) elements.deleteScene.disabled = !activeScene || scenes.length <= 1;
        const siblingScenes = activeScene ? scenes.filter((scene) => scene.chapterId === activeScene.chapterId) : [];
        const activeIndex = activeScene ? siblingScenes.findIndex((scene) => scene.id === activeScene.id) : -1;
        if (elements.moveSceneUp) elements.moveSceneUp.disabled = activeIndex <= 0;
        if (elements.moveSceneDown) elements.moveSceneDown.disabled = activeIndex < 0 || activeIndex >= siblingScenes.length - 1;
        if (elements.exportMarkdown) elements.exportMarkdown.disabled = !scenes.length;
        if (elements.exportText) elements.exportText.disabled = !scenes.length;
        if (elements.exportHtml) elements.exportHtml.disabled = !scenes.length;
        if (elements.exportEpub) elements.exportEpub.disabled = !scenes.length;
        if (elements.exportPackage) elements.exportPackage.disabled = !scenes.length;
        if (elements.exportIncludeSceneTitles) elements.exportIncludeSceneTitles.disabled = !scenes.length;
        if (elements.generateSceneSummary) elements.generateSceneSummary.disabled = !activeScene || nativeEditorState.generation.inProgress;
        if (elements.generateChapterSummary) elements.generateChapterSummary.disabled = !activeChapter || nativeEditorState.generation.inProgress;
        if (!nativeEditorState.dirty) setNativeSaveStatus('', 'info');
        if (elements.beatInput) elements.beatInput.disabled = !activeScene;
        renderNativeRewrite();
        renderNativeCharacters();
        renderNativeContext();
        renderWriterModelControl();
        renderNativeGeneration();
        renderContextStrip();
    }

    function loadNativeProjectEditor(snapshot, projectSummary = {}) {
        if (nativeEditorState.autosaveTimer) {
            window.clearTimeout(nativeEditorState.autosaveTimer);
            nativeEditorState.autosaveTimer = null;
        }
        nativeEditorState.snapshot = JSON.parse(JSON.stringify(snapshot || {}));
        const scenes = Array.isArray(snapshot && snapshot.scenes) ? snapshot.scenes : [];
        const chapters = Array.isArray(snapshot && snapshot.chapters) ? snapshot.chapters : [];
        const preferredScene = scenes.find((scene) => scene.id === snapshot.currentSceneId) || scenes[0] || null;
        nativeEditorState.activeSceneId = preferredScene ? preferredScene.id : '';
        nativeEditorState.activeChapterId = snapshot.currentChapterId || (preferredScene && preferredScene.chapterId) || (chapters[0] && chapters[0].id) || '';
        nativeEditorState.expandedChapterIds = new Set(nativeEditorState.activeChapterId ? [nativeEditorState.activeChapterId] : []);
        nativeEditorState.projectSource = projectSummary.source || 'legacy-snapshot';
        nativeEditorState.searchQuery = '';
        nativeEditorState.searchMatchIndex = -1;
        nativeEditorState.searchMatchPositions = [];
        loadNativeContextPrefs();
        nativeEditorState.dirty = false;
        nativeEditorState.isSaving = false;
        nativeEditorState.generation = {
            beat: '',
            text: '',
            reasoning: '',
            prompt: null,
            record: null,
            aiTaskRecord: null,
            aiTaskTargetKey: '',
            inProgress: false,
            abortController: null,
            lastAcceptedSceneId: '',
            inlineBaseText: '',
            insertionStart: 0,
            insertionEnd: 0,
            pendingSceneId: '',
            task: 'fiction-prose'
        };
        compendiumState.entries = Array.isArray(nativeEditorState.snapshot.compendium) ? nativeEditorState.snapshot.compendium : [];
        compendiumState.selectedId = compendiumState.entries[0] ? compendiumState.entries[0].id : '';
        compendiumState.query = '';
        compendiumState.type = '';
        compendiumState.dirty = false;
        promptState.prompts = Array.isArray(nativeEditorState.snapshot.prompts) ? nativeEditorState.snapshot.prompts : [];
        promptState.selectedId = promptState.prompts[0] ? promptState.prompts[0].id : 'default-prose';
        renderNativeEditor();
        renderCompendium();
    }

    async function saveNativeScene(options = {}) {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene || !elements.editor || nativeEditorState.isSaving) return;

        flushNativeEditorFields();
        normalizeNativeOrders();
        const now = new Date().toISOString();
        snapshot.filesystemSavedAt = now;
        snapshot.exportedAt = snapshot.exportedAt || now;
        if (snapshot.project) {
            snapshot.project.modified = now;
            snapshot.project.updatedAt = Date.now();
        }
        scene.modified = now;
        scene.updatedAt = Date.now();

        nativeEditorState.isSaving = true;
        setNativeSaveStatus(options.reason === 'autosave' ? '自动保存中...' : '保存中...', 'busy');
        if (elements.saveButton) elements.saveButton.disabled = true;
        try {
            const response = await fetch('/api/save-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            nativeEditorState.projectSource = result.source || nativeEditorState.projectSource;
            loadReaderFromProjectSnapshot(snapshot);
            await loadProjectLibrary();
            nativeEditorState.dirty = false;
            setNativeSaveStatus(options.reason === 'autosave' ? '已自动保存' : '已保存', 'ok');
        } catch (error) {
            console.error('Native editor save failed:', error);
            setNativeSaveStatus(`保存失败：${error.message || error}`, 'error');
        } finally {
            nativeEditorState.isSaving = false;
            if (elements.saveButton) elements.saveButton.disabled = false;
        }
    }

    function nativeId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function requestNativeName(options = {}) {
        const elements = nativeEditorElements();
        if (!elements.nameModal || !elements.nameForm || !elements.nameInput) {
            return Promise.resolve(window.prompt(options.title || '名称', options.defaultValue || '') || '');
        }
        return new Promise((resolve) => {
            let settled = false;
            const cleanup = () => {
                elements.nameForm.removeEventListener('submit', onSubmit);
                elements.nameCancelButtons.forEach((button) => button.removeEventListener('click', onCancel));
                elements.nameModal.hidden = true;
            };
            const settle = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(String(value || '').trim());
            };
            const onSubmit = (event) => {
                event.preventDefault();
                const value = elements.nameInput.value.trim();
                if (!value) {
                    if (elements.nameStatus) {
                        elements.nameStatus.textContent = '请输入名称。';
                        elements.nameStatus.dataset.tone = 'error';
                    }
                    elements.nameInput.focus();
                    return;
                }
                settle(value);
            };
            const onCancel = () => settle('');

            if (elements.nameKicker) elements.nameKicker.textContent = options.kicker || 'Writer';
            if (elements.nameTitle) elements.nameTitle.textContent = options.title || '命名';
            if (elements.nameLabel) elements.nameLabel.textContent = options.label || '名称';
            if (elements.nameStatus) elements.nameStatus.textContent = '';
            elements.nameInput.value = options.defaultValue || '';
            elements.nameForm.addEventListener('submit', onSubmit);
            elements.nameCancelButtons.forEach((button) => button.addEventListener('click', onCancel));
            elements.nameModal.hidden = false;
            window.setTimeout(() => {
                elements.nameInput.focus();
                elements.nameInput.select();
            }, 0);
        });
    }

    function activeChapterIdForNativeEditor() {
        if (nativeEditorState.activeChapterId) return nativeEditorState.activeChapterId;
        const scene = currentNativeScene();
        if (scene && scene.chapterId) return scene.chapterId;
        const snapshot = nativeEditorState.snapshot;
        return snapshot && snapshot.chapters && snapshot.chapters[0] ? snapshot.chapters[0].id : '';
    }

    async function addNativeChapter() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !snapshot.project) return;
        const chapterTitle = await requestNativeName({
            kicker: '章节',
            title: '新建章节',
            label: '章节名称',
            defaultValue: `第 ${(snapshot.chapters || []).length + 1} 章`
        });
        if (!chapterTitle) return;
        const now = new Date().toISOString();
        const chapterId = nativeId('chapter');
        const sceneId = nativeId('scene');
        snapshot.chapters = snapshot.chapters || [];
        snapshot.scenes = snapshot.scenes || [];
        snapshot.sceneContents = snapshot.sceneContents || {};
        snapshot.chapters.push({
            id: chapterId,
            projectId: snapshot.project.id,
            title: chapterTitle.trim(),
            order: snapshot.chapters.length,
            created: now,
            modified: now,
            updatedAt: Date.now()
        });
        snapshot.scenes.push({
            id: sceneId,
            projectId: snapshot.project.id,
            chapterId,
            title: '新场景',
            order: 0,
            created: now,
            modified: now,
            updatedAt: Date.now()
        });
        snapshot.sceneContents[sceneId] = '';
        nativeEditorState.activeSceneId = sceneId;
        nativeEditorState.activeChapterId = chapterId;
        nativeEditorState.expandedChapterIds.add(chapterId);
        renderNativeEditor();
        markNativeDirty();
    }

    async function addNativeScene() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !snapshot.project) return;
        const chapterId = activeChapterIdForNativeEditor();
        if (!chapterId) return;
        const sceneTitle = await requestNativeName({
            kicker: '场景',
            title: '新建场景',
            label: '场景名称',
            defaultValue: `场景 ${(snapshot.scenes || []).filter((scene) => scene.chapterId === chapterId).length + 1}`
        });
        if (!sceneTitle) return;
        const now = new Date().toISOString();
        const sceneId = nativeId('scene');
        const chapterScenes = (snapshot.scenes || []).filter((scene) => scene.chapterId === chapterId);
        snapshot.scenes = snapshot.scenes || [];
        snapshot.sceneContents = snapshot.sceneContents || {};
        snapshot.scenes.push({
            id: sceneId,
            projectId: snapshot.project.id,
            chapterId,
            title: sceneTitle.trim(),
            order: chapterScenes.length,
            created: now,
            modified: now,
            updatedAt: Date.now()
        });
        snapshot.sceneContents[sceneId] = '';
        nativeEditorState.activeSceneId = sceneId;
        nativeEditorState.activeChapterId = chapterId;
        nativeEditorState.expandedChapterIds.add(chapterId);
        renderNativeEditor();
        markNativeDirty();
    }

    function currentNativeChapterByState() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return null;
        const activeScene = currentNativeScene();
        const chapterId = nativeEditorState.activeChapterId || (activeScene && activeScene.chapterId);
        return (snapshot.chapters || []).find((chapter) => chapter.id === chapterId) || null;
    }

    async function renameNativeChapter() {
        const chapter = currentNativeChapterByState();
        if (!chapter) return;
        const nextTitle = await requestNativeName({
            kicker: '章节',
            title: '重命名章节',
            label: '章节名称',
            defaultValue: chapter.title || ''
        });
        if (!nextTitle || !nextTitle.trim()) return;
        chapter.title = nextTitle.trim();
        chapter.modified = new Date().toISOString();
        chapter.updatedAt = Date.now();
        renderNativeEditor();
        markNativeDirty();
    }

    function deleteNativeChapter() {
        const snapshot = nativeEditorState.snapshot;
        const chapter = currentNativeChapterByState();
        if (!snapshot || !chapter) return;
        if ((snapshot.chapters || []).length <= 1) {
            setNativeSaveStatus('至少保留一个章节', 'error');
            return;
        }
        const chapterScenes = (snapshot.scenes || []).filter((scene) => scene.chapterId === chapter.id);
        const message = chapterScenes.length
            ? `删除章节“${chapter.title || '未命名章节'}”及其中 ${chapterScenes.length} 个场景？`
            : `删除章节“${chapter.title || '未命名章节'}”？`;
        if (!window.confirm(message)) return;
        const deletedSceneIds = new Set(chapterScenes.map((scene) => scene.id));
        snapshot.chapters = (snapshot.chapters || []).filter((item) => item.id !== chapter.id);
        snapshot.scenes = (snapshot.scenes || []).filter((scene) => !deletedSceneIds.has(scene.id));
        if (snapshot.sceneContents) {
            deletedSceneIds.forEach((sceneId) => delete snapshot.sceneContents[sceneId]);
        }
        normalizeNativeOrders();
        const nextChapter = (snapshot.chapters || [])[0] || null;
        const nextScene = nextChapter ? (snapshot.scenes || []).find((scene) => scene.chapterId === nextChapter.id) : null;
        nativeEditorState.activeChapterId = nextChapter ? nextChapter.id : '';
        nativeEditorState.activeSceneId = nextScene ? nextScene.id : '';
        nativeEditorState.expandedChapterIds.delete(chapter.id);
        if (nextChapter) nativeEditorState.expandedChapterIds.add(nextChapter.id);
        renderNativeEditor();
        markNativeDirty();
    }

    async function renameNativeScene() {
        const scene = currentNativeScene();
        if (!scene) return;
        const nextTitle = await requestNativeName({
            kicker: '场景',
            title: '重命名场景',
            label: '场景名称',
            defaultValue: scene.title || ''
        });
        if (!nextTitle) return;
        scene.title = nextTitle.trim();
        scene.modified = new Date().toISOString();
        scene.updatedAt = Date.now();
        renderNativeEditor();
        markNativeDirty();
    }

    function deleteNativeScene() {
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;
        if ((snapshot.scenes || []).length <= 1) {
            setNativeSaveStatus('至少保留一个场景', 'error');
            return;
        }
        if (!window.confirm(`删除场景“${scene.title || '未命名场景'}”？`)) return;
        snapshot.scenes = (snapshot.scenes || []).filter((item) => item.id !== scene.id);
        if (snapshot.sceneContents) delete snapshot.sceneContents[scene.id];
        nativeEditorState.activeSceneId = snapshot.scenes[0] ? snapshot.scenes[0].id : '';
        nativeEditorState.activeChapterId = snapshot.scenes[0] ? snapshot.scenes[0].chapterId : activeChapterIdForNativeEditor();
        if (nativeEditorState.activeChapterId) nativeEditorState.expandedChapterIds.add(nativeEditorState.activeChapterId);
        normalizeNativeOrders();
        renderNativeEditor();
        markNativeDirty();
    }

    function moveNativeScene(direction) {
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;
        flushNativeEditorFields();
        const chapterScenes = (snapshot.scenes || [])
            .filter((item) => item.chapterId === scene.chapterId)
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const index = chapterScenes.findIndex((item) => item.id === scene.id);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= chapterScenes.length) return;
        const other = chapterScenes[nextIndex];
        const originalOrder = scene.order;
        scene.order = other.order;
        other.order = originalOrder;
        normalizeNativeOrders();
        renderNativeEditor();
        markNativeDirty();
    }

    function switchNativeScene(direction) {
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;
        flushNativeEditorFields();
        const orderedScenes = [...(snapshot.scenes || [])]
            .sort((a, b) => {
                const chapterA = (snapshot.chapters || []).find((chapter) => chapter.id === a.chapterId);
                const chapterB = (snapshot.chapters || []).find((chapter) => chapter.id === b.chapterId);
                const chapterOrder = (Number(chapterA && chapterA.order) || 0) - (Number(chapterB && chapterB.order) || 0);
                return chapterOrder || ((Number(a.order) || 0) - (Number(b.order) || 0));
            });
        const index = orderedScenes.findIndex((item) => item.id === scene.id);
        const next = orderedScenes[index + direction];
        if (!next) return;
        nativeEditorState.activeSceneId = next.id;
        nativeEditorState.activeChapterId = next.chapterId;
        nativeEditorState.expandedChapterIds.add(next.chapterId);
        renderNativeEditor();
    }

    function reorderNativeChapter(sourceId, targetId) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || sourceId === targetId) return;
        flushNativeEditorFields();
        const chapters = [...(snapshot.chapters || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const sourceIndex = chapters.findIndex((chapter) => chapter.id === sourceId);
        const targetIndex = chapters.findIndex((chapter) => chapter.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [source] = chapters.splice(sourceIndex, 1);
        chapters.splice(targetIndex, 0, source);
        chapters.forEach((chapter, index) => { chapter.order = index; });
        renderNativeEditor();
        markNativeDirty();
    }

    function reorderNativeScene(sourceId, targetId) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || sourceId === targetId) return;
        flushNativeEditorFields();
        const source = (snapshot.scenes || []).find((scene) => scene.id === sourceId);
        const target = (snapshot.scenes || []).find((scene) => scene.id === targetId);
        if (!source || !target || source.chapterId !== target.chapterId) return;
        const scenes = (snapshot.scenes || [])
            .filter((scene) => scene.chapterId === target.chapterId)
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const sourceIndex = scenes.findIndex((scene) => scene.id === sourceId);
        const targetIndex = scenes.findIndex((scene) => scene.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [item] = scenes.splice(sourceIndex, 1);
        scenes.splice(targetIndex, 0, item);
        scenes.forEach((scene, index) => { scene.order = index; });
        nativeEditorState.activeSceneId = sourceId;
        nativeEditorState.activeChapterId = target.chapterId;
        nativeEditorState.expandedChapterIds.add(target.chapterId);
        renderNativeEditor();
        markNativeDirty();
    }

    function escapeRegExp(text) {
        return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function nativeSceneMatches(query) {
        const editor = nativeEditorElements().editor;
        if (!editor || !query) return [];
        const text = editor.value || '';
        if (!text) return [];
        const pattern = new RegExp(escapeRegExp(query), 'gi');
        const matches = [];
        let match;
        while ((match = pattern.exec(text)) !== null) {
            matches.push({ start: match.index, end: match.index + match[0].length });
        }
        return matches;
    }

    function updateNativeSearchMatchState() {
        const elements = nativeEditorElements();
        const query = nativeEditorState.searchQuery.trim();
        const matches = query ? nativeSceneMatches(query) : [];
        nativeEditorState.searchMatchPositions = matches;
        nativeEditorState.searchMatchIndex = matches.length > 0 ? 0 : -1;
        renderNativeSearchStatus();
    }

    function renderNativeSearchStatus() {
        const elements = nativeEditorElements();
        const query = nativeEditorState.searchQuery.trim();
        const matches = nativeEditorState.searchMatchPositions;
        const count = matches.length;
        if (!query) {
            if (elements.searchStatus) elements.searchStatus.textContent = '';
            if (elements.searchPrev) elements.searchPrev.disabled = true;
            if (elements.searchNext) elements.searchNext.disabled = true;
            return;
        }
        if (count === 0) {
            if (elements.searchStatus) elements.searchStatus.textContent = '没有匹配项';
            if (elements.searchPrev) elements.searchPrev.disabled = true;
            if (elements.searchNext) elements.searchNext.disabled = true;
            return;
        }
        const idx = nativeEditorState.searchMatchIndex;
        if (elements.searchStatus) elements.searchStatus.textContent = `第 ${idx + 1}/${count} 个匹配`;
        if (elements.searchPrev) elements.searchPrev.disabled = count <= 1;
        if (elements.searchNext) elements.searchNext.disabled = count <= 1;
        selectNativeSearchMatch(idx);
    }

    function selectNativeSearchMatch(index) {
        const editor = nativeEditorElements().editor;
        const matches = nativeEditorState.searchMatchPositions;
        if (!editor || index < 0 || index >= matches.length) return;
        const match = matches[index];
        editor.focus();
        editor.setSelectionRange(match.start, match.end);
        const textBefore = editor.value.slice(0, match.start);
        const lines = textBefore.split('\n').length;
        const lineHeight = 20;
        editor.scrollTop = Math.max(0, (lines - 4) * lineHeight);
    }

    function navigateNativeSearchMatch(direction) {
        const matches = nativeEditorState.searchMatchPositions;
        if (!matches.length) return;
        let idx = nativeEditorState.searchMatchIndex + direction;
        if (idx < 0) idx = matches.length - 1;
        if (idx >= matches.length) idx = 0;
        nativeEditorState.searchMatchIndex = idx;
        renderNativeSearchStatus();
    }

    function replaceNativeText(scope) {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const query = nativeEditorState.searchQuery;
        if (!snapshot || !query) return;
        const replacement = elements.replace ? elements.replace.value : '';
        flushNativeEditorFields();
        const pattern = new RegExp(escapeRegExp(query), 'gi');
        const replaceScene = (scene) => {
            const current = nativeSceneContent(scene.id);
            const next = current.replace(pattern, replacement);
            if (next !== current) {
                snapshot.sceneContents = snapshot.sceneContents || {};
                snapshot.sceneContents[scene.id] = next;
                scene.modified = new Date().toISOString();
                scene.updatedAt = Date.now();
                return 1;
            }
            return 0;
        };
        let count = 0;
        if (scope === 'all') {
            (snapshot.scenes || []).forEach((scene) => { count += replaceScene(scene); });
        } else {
            const scene = currentNativeScene();
            if (!scene) return;
            const matches = nativeEditorState.searchMatchPositions;
            const matchIndex = nativeEditorState.searchMatchIndex;
            if (matches.length > 0 && matchIndex >= 0 && matchIndex < matches.length) {
                const match = matches[matchIndex];
                const current = nativeSceneContent(scene.id);
                if (match.start >= 0 && match.end <= current.length) {
                    const next = current.slice(0, match.start) + replacement + current.slice(match.end);
                    if (next !== current) {
                        snapshot.sceneContents = snapshot.sceneContents || {};
                        snapshot.sceneContents[scene.id] = next;
                        scene.modified = new Date().toISOString();
                        scene.updatedAt = Date.now();
                        count = 1;
                    }
                }
            } else {
                count += replaceScene(scene);
            }
        }
        if (!count) {
            setNativeSaveStatus('没有匹配项', 'info');
            return;
        }
        renderNativeEditor();
        markNativeDirty(`已替换 ${count} 处`);
    }
