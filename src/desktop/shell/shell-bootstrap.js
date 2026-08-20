    function init() {
        applyDesktopThemeFromStorage();
        try {
            const placement = window.localStorage.getItem('draftharbor:nativeAssistantPlacement');
            if (placement === 'bottom' || placement === 'right') nativeEditorState.assistantPlacement = placement;
            else nativeEditorState.assistantPlacement = window.innerWidth < 1400 ? 'right' : 'bottom';
        } catch (error) { /* ignore */ }
        loadWriterModelOverride();
        loadNativeEditorPrefs();
        loadExportOptions();
        bindNavigation();
        bindWindowControls();
        bindProjectLibrary();
        bindProjectCreator();
        bindProjectEditor();
        bindContextStrip();
        bindNativeEditor();
        bindNativeCompendiumExtraction();
        bindRecovery();
        bindReader();
        if (window.initializeReaderIllustrations) window.initializeReaderIllustrations();
        bindSettings();
         bindCompendium();
         if (typeof bindCompendiumAgent === 'function') bindCompendiumAgent();
         if (typeof bindCompendiumAgentQa === 'function') bindCompendiumAgentQa();
        bindCompendiumRewrite();
        bindCompendiumDraw();
        bindStyleGuard();
        bindWorkshop();
        bindWorkflow();
        if (typeof bindReaderTransferConsumers === 'function') bindReaderTransferConsumers();
        if (typeof bindReaderWriterTransfer === 'function') bindReaderWriterTransfer();
        if (typeof bindReaderCompendiumTransfer === 'function') bindReaderCompendiumTransfer();
        if (typeof bindReaderWorkflowTransfer === 'function') bindReaderWorkflowTransfer();
    }

    async function restoreDesktopSession() {
        const state = getState();
        const lastView = state ? state.loadInitialView() : 'bookshelf';
        const needsProject = state && typeof state.viewNeedsProject === 'function'
            ? state.viewNeedsProject(lastView)
            : (lastView === 'writer' || lastView === 'compendium' || lastView === 'workshop' || lastView === 'workflow');
        await loadProjectLibrary();
        loadRecoveryList();
        loadSettings();
        if (needsProject) {
            const lastId = typeof loadLastOpenedProjectId === 'function' ? loadLastOpenedProjectId() : '';
            const project = (projectLibraryState.projects || []).find((item) => item && item.id === lastId);
            if (project && project.health !== 'invalid' && typeof openDesktopProject === 'function') {
                try {
                    await openDesktopProject(project, { view: lastView });
                    renderContextStrip();
                    return;
                } catch (error) {
                    console.warn('Failed to restore last project:', error);
                }
            }
            setView('bookshelf');
        } else {
            setView(lastView);
        }
        renderCompendium();
        renderWorkshop();
        renderWorkflow();
        renderContextStrip();
    }

    async function startDesktopShell() {
        if (window.DraftHarborFragmentsReady) await window.DraftHarborFragmentsReady;
        init();
        await restoreDesktopSession();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startDesktopShell, { once: true });
    } else {
        startDesktopShell();
    }

    window.DraftHarborDesktopShell = {
        loadProjectLibrary,
        setView,
        toggleFullscreen,
        startNativeGeneration,
        loadSettings
    };
