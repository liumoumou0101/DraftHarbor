    const viewTitles = {
        bookshelf: '书库',
        writer: '写作',
        reader: '阅读',
        compendium: '资料',
        workshop: '讨论',
        workflow: '工作流',
        recovery: '恢复中心',
        settings: '设置'
    };
    const projectLibraryState = {
        projects: [],
        projectSaveLocation: '',
        query: '',
        sort: 'recent',
        editingProject: null,
        editingCoverImage: ''
    };
    const READER_STORAGE_KEY = 'draftharbor:desktop:reader';
    const NATIVE_EDITOR_PREFS_STORAGE_KEY = 'draftharbor:desktop:nativeEditorPrefs';
    const EXPORT_OPTIONS_STORAGE_KEY = 'draftharbor:desktop:nativeExportOptions';
    const TTS_VOICE_KEY = 'draftharbor:ttsVoice';
    const TTS_SPEED_KEY = 'draftharbor:ttsSpeed';
    const DESKTOP_THEME_KEY = 'draftharbor:desktop:theme';
    const DESKTOP_THEMES = new Set(['morandi-ink', 'mist-library', 'ash-rose']);
    const readerState = {
        document: null,
        chapterIndex: 0,
        fontSize: 18,
        lineHeight: 1.8,
        theme: 'dark',
        fontFamily: 'system',
        fontId: 'builtin:default',
        fontCatalogVersion: 1,
        fontWeight: 400,
        bookSpine: 28,
        orphanLines: 2,
        widowLines: 2,
        appearanceProfileId: 'default',
        textWidth: 760,
        paragraphSpacing: 1.05,
        indent: true,
        scrollPositions: {},
        libraryDocuments: [],
        libraryIndexVersion: 0,
        libraryViewRecord: null,
        libraryView: null,
        libraryDetailDocumentId: '',
        reimportDocumentId: '',
        activeDocumentId: '',
        activeRevisionId: '',
        activeChapterId: '',
        documentMetadata: null,
        contents: [],
        currentChapter: null,
        apiMode: false,
        drawer: '',
        leftTab: 'library',
        controlsVisible: true,
        hudState: 'visible',
        hudPreviousState: 'visible',
        hudTimer: null,
        focusMode: false,
        drawerReturnFocus: null,
        layoutMode: 'flow',
        effectiveLayoutMode: 'flow',
        pageIndex: 0,
        pages: [],
        prefetchedPages: [],
        virtualWindow: { start: 0, end: 0 },
        layoutCache: new Map(),
        layoutRenderToken: 0,
        pendingPageDelta: 0,
        pageTurnFrame: null,
        anchorLocator: null,
        actualFontFamily: '',
        fontFallback: false,
        letterSpacing: 0,
        pageMargin: 48,
        paperMaterial: 'flat',
        paperShadow: true,
        paperVignette: true,
        textAlign: 'start',
        pageTransition: 'fade',
        reducedMotionOverride: undefined,
        preferenceScope: 'global',
        r: 0,
        preferenceRecord: null,
        globalPreferences: null,
        preferenceOverrides: {},
        appearanceProfiles: [],
        appearanceRecordUpdatedAt: '',
        appearanceStudioBaseline: null,
        searchQuery: '',
        searchResults: [],
        searchStatus: 'idle',
        searchRequestId: 0,
        searchAbortController: null,
        bookmarkResolutions: new Map(),
        annotations: [],
        annotationResolutions: new Map(),
        annotationRecordUpdatedAt: '',
        annotationSelection: null,
        historyItems: [],
        historyCursor: -1,
        historyRecordUpdatedAt: '',
        historyNavigating: false,
        revisionSnapshotPromise: null,
        revisionSnapshotKey: '',
        progressDragging: false,
        progressNavigationToken: 0,
        wheelTurnAccumulator: 0,
        pointerGesture: null,
        transferSelection: null,
        transferScope: 'chapter',
        transferChapterIds: [],
        transferBusy: false,
        transferLastEnvelopeId: '',
        statusBarMode: 'auto',
        statusBarFields: ['chapter', 'page', 'percent'],
        statusBarAutoHide: true,
        tts: {
            status: 'idle',
            settings: {
                schemaVersion: 1,
                voiceName: '',
                rate: 1,
                volume: 1,
                paragraphPauseMs: 350,
                autoAdvance: true,
                timerMinutes: 0,
                maxChunkChars: 240
            },
            chapterId: '',
            blockId: '',
            offset: 0,
            queueIndex: -1,
            queue: [],
            internalNavigation: false,
            errorCode: '',
            remainingSeconds: 0
        },
        hudMode: 'auto',
        keyboardPageTurn: true,
        pointerPageTurn: true,
        touchPageTurn: true
    };
    const nativeEditorState = {
        snapshot: null,
        activeSceneId: '',
        activeChapterId: '',
        projectSource: '',
        searchQuery: '',
        searchMatchIndex: -1,
        searchMatchPositions: [],
        assistantPanel: 'generate',
        // The writer opens with Copilot as a bottom dock so the main writing
        // surface keeps its width. A user-selected placement is restored by
        // shell-bootstrap and can still be toggled from the editor toolbar.
        assistantPlacement: 'bottom',
        typographyOpen: false,
        editorPrefs: {
            fontSize: 18,
            lineHeight: 1.9,
            textWidth: 760,
            paragraphSpacing: 0,
            fontFamily: 'system',
            wordGoal: 0
        },
        titleEditing: false,
        titleEditingOriginal: '',
        focusMode: false,
        outlineCollapsed: false,
        assistantCollapsed: false,
        expandedChapterIds: new Set(),
        dirty: false,
        autosaveTimer: null,
        isSaving: false,
        generation: {
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
            task: 'fiction-prose',
            genTask: 'continue'
        },
        rewrite: {
            preset: 'balanced-polish',
            instruction: '',
            rewriteTask: 'polish',
            savedPromptId: '',
            originalText: '',
            selectionStart: 0,
            selectionEnd: 0,
            regenerateUseContext: true
        },
        context: {
            compendiumIds: [],
            compendiumTags: [],
            chapterModes: {},
            sceneModes: {}
        },
        tts: {
            reading: false,
            rate: 1
        },
        historySceneFilter: false
    };
    const promptState = {
        prompts: [],
        selectedId: 'default-prose'
    };
    const summaryPromptState = {
        prompts: [],
        selectedId: 'auto'
    };
    const rewritePromptState = {
        prompts: [],
        selectedId: ''
    };
    const workshopState = {
        sessions: [],
        selectedId: '',
        input: '',
        generating: false,
        selectedAssistantMessageId: ''
    };
    const workflowState = {
        runs: [],
        selectedId: '',
        events: [],
        generating: false,
        generatedText: '',
        viewMode: 'guided',
        graphEditing: false,
        graphDraftRunId: '',
        graphDraft: null,
        graphSelectedNodeId: '',
        graphTemplateId: '',
        graphTemplateVersion: 0,
        graphTemplates: [],
        graphPendingConnection: null,
        selectedArtifactId: '',
        artifactViewMode: 'readable',
        artifactRewriteModel: 'inherit',
        artifactRewriteThinking: true,
        artifactRewriteBusy: false,
        artifactHistory: null,
        selectedDirectionIds: [],
        selectedRewriteSceneIds: [],
        creationBrief: null,
        creationBriefGenerating: false,
        creationBriefOpen: false,
        workflowModel: 'inherit',
        workflowThinking: true,
        variantComparison: null,
        variantSelections: {},
        pendingVariantId: '',
        pendingVariantApproved: false,
        lastGenerationError: '',
        lockDraft: {
            constraints: [],
            qualityTargets: {
                dialogueRatioEnabled: false,
                dialogueRatioMin: 0.25,
                dialogueRatioMax: 0.35,
                technicalRegisterMode: 'avoid',
                technicalRegisterLocked: false,
                planOutcomeLocked: false
            },
            sourceRunId: '',
            dirty: false
        },
        generationProgressDetail: {
            phase: 'idle',
            detail: '',
            current: 0,
            total: 0,
            characters: 0,
            cumulativeCharacters: 0,
            startedAt: 0
        },
        reasoning: {
            visible: false,
            dismissed: false,
            phase: 'idle',
            title: 'AI 思考过程',
            status: '',
            text: '',
            hasReasoning: false,
            batchHasReasoning: false
        },
        streamPreview: {
            visible: false,
            phase: 'idle',
            runId: '',
            title: '',
            status: '',
            text: '',
            current: 0,
            total: 0,
            cumulativeCharacters: 0,
            startedAt: 0,
            firstTokenAt: 0,
            lastTokenAt: 0,
            follow: true,
            collapsed: false,
            model: '',
            usageHint: null
        }
    };
    const recoveryState = {
        backups: [],
        backupLocation: '',
        query: '',
        filter: 'all',
        selected: null,
        selectedBackup: null,
        selectedDiff: null
    };
    const compendiumState = {
        entries: [],
        selectedId: '',
        query: '',
        type: '',
        loading: false,
        dirty: false
    };
    const settingsState = {
        settings: null,
        runtimeProvider: null,
        runtimeProviderProfiles: null,
        storageLocations: null,
        loading: false,
        loadPromise: null,
        saving: false,
        activeSection: 'provider'
    };
    const profileEditState = {
        editingId: '',
        editingProfile: null
    };
    const profileTestState = {};
    const WRITER_MODEL_KEY = 'draftharbor:desktop:writerModelOverride';
    const writerModelOverride = {
        profileId: 'inherit',
        model: 'inherit',
        customModel: '',
        thinking: false
    };
    const shellUiState = {
        railCollapsed: false
    };

    function normalizeDesktopTheme(theme) {
        theme = String(theme || 'morandi-ink');
        return DESKTOP_THEMES.has(theme) ? theme : 'morandi-ink';
    }

    function applyDesktopTheme(theme) {
        theme = normalizeDesktopTheme(theme);
        var root = document.getElementById('desktop-root');
        document.documentElement.dataset.desktopTheme = theme;
        if (root) root.dataset.desktopTheme = theme;
        try {
            localStorage.setItem(DESKTOP_THEME_KEY, theme);
        } catch (e) { /* ignore */ }
    }

    function loadDesktopTheme() {
        var theme = 'morandi-ink';
        try {
            theme = localStorage.getItem(DESKTOP_THEME_KEY) || 'morandi-ink';
        } catch (e) { /* ignore */ }
        return normalizeDesktopTheme(theme);
    }

    function applyDesktopThemeFromStorage() {
        applyDesktopTheme(loadDesktopTheme());
    }

    function getState() {
        return window.DraftHarborDesktopState;
    }

    function setView(view) {
        const state = getState();
        const nextView = state ? state.normalizeView(view) : 'bookshelf';
        const root = document.getElementById('desktop-root');
        if (!root) return;

        if (nextView !== 'reader' && typeof window.readerHudLeaveReader === 'function') window.readerHudLeaveReader();

        root.dataset.view = nextView;
        root.classList.toggle('is-rail-collapsed', shellUiState.railCollapsed);

        if (nextView === 'reader' && typeof window.readerHudShow === 'function') window.readerHudShow();

        document.querySelectorAll('[data-view-target]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.viewTarget === nextView);
        });

        document.querySelectorAll('[data-view-panel]').forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.viewPanel === nextView);
        });

        const title = document.getElementById('desktop-view-title');
        if (title) title.textContent = viewTitles[nextView] || '稿湾';
        const railToggle = document.querySelector('[data-toggle-rail]');
        if (railToggle) railToggle.textContent = shellUiState.railCollapsed ? '显示导航' : '隐藏导航';

        if (state) state.saveView(nextView);
        renderContextStrip();
        if (nextView === 'reader' && readerState.apiMode && typeof scheduleReaderReflow === 'function') {
            window.requestAnimationFrame(() => scheduleReaderReflow());
        }
        if (['writer', 'compendium', 'workflow'].includes(nextView) && typeof activateReaderTransferTarget === 'function') {
            activateReaderTransferTarget(nextView);
        }
    }

    function contextStripElements() {
        return {
            strip: document.querySelector('[data-context-strip]'),
            projectTitle: document.querySelector('[data-context-project-title]'),
            sceneTitle: document.querySelector('[data-context-scene-title]'),
            wordCount: document.querySelector('[data-context-word-count]'),
            compendiumSummary: document.querySelector('[data-context-compendium-summary]'),
            gotoWriter: document.querySelector('[data-context-goto-writer]'),
            gotoCompendium: document.querySelector('[data-context-goto-compendium]'),
            gotoWorkshop: document.querySelector('[data-context-goto-workshop]'),
            gotoBookshelf: document.querySelector('[data-context-goto-bookshelf]')
        };
    }

    function contextPolicyMode(entry) {
        if (entry && entry.alwaysInContext) return 'always';
        const policy = entry && entry.contextPolicy;
        const mode = policy && policy.mode;
        return ['disabled', 'manual', 'mention', 'auto', 'always'].includes(mode) ? mode : 'manual';
    }

    function contextPolicyLabel(entry) {
        return {
            always: '总是注入',
            auto: '条件注入',
            mention: '提及时注入',
            manual: '手动',
            disabled: '不自动注入'
        }[contextPolicyMode(entry)] || '手动';
    }

    function renderContextStrip() {
        const elements = contextStripElements();
        if (!elements.strip) return;
        const root = document.getElementById('desktop-root');
        const view = root && root.dataset.view ? root.dataset.view : 'bookshelf';
        const coreViews = new Set(['writer', 'compendium', 'workshop', 'workflow']);
        const projectId = currentProjectId();
        const scene = currentNativeScene();
        const content = scene ? nativeSceneContent(scene.id) : '';
        const entries = compendiumState.entries || [];
        const autoCount = entries.filter((entry) => !['manual', 'disabled'].includes(contextPolicyMode(entry))).length;

        elements.strip.hidden = !coreViews.has(view);
        if (elements.projectTitle) elements.projectTitle.textContent = projectId ? currentProjectName() : '未打开项目';
        if (elements.sceneTitle) elements.sceneTitle.textContent = scene ? `场景：${scene.title || '未命名场景'}` : (projectId ? '未选择场景' : '从书库打开项目');
        if (elements.wordCount) elements.wordCount.textContent = scene ? `${String(content || '').length} 字` : '';
        if (elements.compendiumSummary) {
            elements.compendiumSummary.textContent = projectId
                ? `资料 ${entries.length} 张${autoCount ? ` / 自动上下文 ${autoCount} 张` : ''}`
                : '请先打开项目';
        }
        if (elements.gotoBookshelf) elements.gotoBookshelf.hidden = !!projectId;
        [elements.gotoWriter, elements.gotoCompendium, elements.gotoWorkshop].forEach((button) => {
            if (button) button.disabled = !projectId;
        });
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
    }

    function formatDate(value) {
        if (!value) return '未知时间';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '未知时间';
        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function firstBookGlyph(name) {
        const text = String(name || '书').trim();
        return Array.from(text)[0] || '书';
    }

    function setProjectLibraryStatus(message, tone) {
        const status = document.querySelector('[data-project-library-status]');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone || 'info';
        status.hidden = !message;
    }

    function setProjectLibraryMeta(message) {
        const meta = document.querySelector('[data-project-library-meta]');
        if (meta) {
            meta.textContent = message || '';
            meta.title = message || '';
        }
    }

    function setProjectLibraryCount(message) {
        const count = document.querySelector('[data-project-library-count]');
        if (count) count.textContent = message || '—';
    }

    function setShelfStatus(message) {
        const status = document.querySelector('[data-project-library-meta-secondary]');
        if (!status) return;
        status.textContent = message || '';
        status.hidden = !message;
    }
