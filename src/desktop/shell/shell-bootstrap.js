    function init() {
        applyDesktopThemeFromStorage();
        try {
            const placement = window.localStorage.getItem('draftharbor:nativeAssistantPlacement');
            if (placement === 'bottom' || placement === 'right') nativeEditorState.assistantPlacement = placement;
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
        const state = getState();
        setView(state ? state.loadInitialView() : 'bookshelf');
        loadProjectLibrary();
        loadRecoveryList();
        loadSettings();
        renderCompendium();
        renderWorkshop();
        renderWorkflow();
        renderContextStrip();
    }

    async function startDesktopShell() {
        if (window.DraftHarborFragmentsReady) await window.DraftHarborFragmentsReady;
        init();
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
