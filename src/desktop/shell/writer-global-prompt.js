    function nativeGlobalPromptElements() {
        return {
            open: document.querySelector('[data-native-manage-global-prompt]'),
            dialog: document.querySelector('[data-native-global-prompt-dialog]'),
            form: document.querySelector('[data-native-global-prompt-form]'),
            enabled: document.querySelector('[data-native-global-prompt-enabled]'),
            content: document.querySelector('[data-native-global-prompt-content]'),
            projectEnabled: document.querySelector('[data-native-project-directive-enabled]'),
            projectContent: document.querySelector('[data-native-project-directive-content]'),
            status: document.querySelector('[data-native-global-prompt-status]'),
            cancel: document.querySelector('[data-native-global-prompt-cancel]')
        };
    }

    function closeNativeGlobalPromptDialog() {
        const { dialog } = nativeGlobalPromptElements();
        if (!dialog) return;
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        else dialog.hidden = true;
    }

    async function openNativeGlobalPromptDialog() {
        if (settingsState.loading && settingsState.loadPromise) await settingsState.loadPromise.catch(() => null);
        else if (!settingsState.settings) await loadSettings();
        const elements = nativeGlobalPromptElements();
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const globalPrompt = settings.globalPrompt || {};
        const projectLayers = nativeEditorState.snapshot && nativeEditorState.snapshot.directiveStack
            && Array.isArray(nativeEditorState.snapshot.directiveStack.layers)
            ? nativeEditorState.snapshot.directiveStack.layers : [];
        const projectDirective = projectLayers.find((layer) => layer && layer.id === 'project_main') || {};
        if (elements.enabled) elements.enabled.checked = !!globalPrompt.enabled;
        if (elements.content) elements.content.value = globalPrompt.content || '';
        if (elements.projectEnabled) elements.projectEnabled.checked = !!projectDirective.enabled;
        if (elements.projectContent) elements.projectContent.value = projectDirective.content || '';
        if (elements.status) elements.status.textContent = globalPrompt.enabled
            ? '当前已启用，仅注入正文、改写、Workshop 和工作流正文类任务；JSON、摘要、Agent 与 Reader 默认隔离。'
            : '当前未启用，保存并开启后才会发送。';
        if (!elements.dialog) return;
        if (typeof elements.dialog.showModal === 'function' && !elements.dialog.open) elements.dialog.showModal();
        else elements.dialog.hidden = false;
    }

    async function saveNativeGlobalPrompt(event) {
        if (event) event.preventDefault();
        const elements = nativeGlobalPromptElements();
        const globalPrompt = {
            enabled: !!(elements.enabled && elements.enabled.checked),
            content: elements.content ? elements.content.value.trim() : ''
        };
        const projectDirective = {
            id: 'project_main',
            title: '本作品',
            enabled: !!(elements.projectEnabled && elements.projectEnabled.checked),
            content: elements.projectContent ? elements.projectContent.value.trim() : '',
            scopes: ['writer-prose', 'writer-rewrite', 'workshop-chat', 'workflow-draft', 'workflow-rewrite', 'workflow-repair'],
            source: 'project'
        };
        if (globalPrompt.enabled && !globalPrompt.content) {
            if (elements.status) elements.status.textContent = '启用前请填写用户全局创作指令。';
            return;
        }
        if (projectDirective.enabled && !projectDirective.content) {
            if (elements.status) elements.status.textContent = '启用项目前请填写项目指令内容。';
            return;
        }
        if (elements.status) elements.status.textContent = '正在保存...';
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { globalPrompt } })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            settingsState.settings = normalizeDesktopSettings(result.settings || {});
            settingsState.runtimeProvider = result.runtimeProvider || runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || settingsState.runtimeProviderProfiles;
            if (nativeEditorState.snapshot) {
                nativeEditorState.snapshot.directiveStack = {
                    schemaVersion: 1,
                    layers: projectDirective.content || projectDirective.enabled ? [projectDirective] : []
                };
                nativeEditorState.dirty = true;
                await saveNativeScene({ reason: 'directive-stack' });
            }
            closeNativeGlobalPromptDialog();
            setNativeSaveStatus(globalPrompt.enabled ? '用户全局创作指令已启用' : '用户全局创作指令已关闭', 'ok');
        } catch (error) {
            if (elements.status) elements.status.textContent = `保存失败：${error.message || error}`;
        }
    }

    function bindNativeGlobalPrompt() {
        const elements = nativeGlobalPromptElements();
        if (elements.open) elements.open.addEventListener('click', openNativeGlobalPromptDialog);
        if (elements.form) elements.form.addEventListener('submit', saveNativeGlobalPrompt);
        if (elements.cancel) elements.cancel.addEventListener('click', closeNativeGlobalPromptDialog);
        if (elements.dialog) elements.dialog.addEventListener('click', (event) => {
            if (event.target === elements.dialog) closeNativeGlobalPromptDialog();
        });
    }
