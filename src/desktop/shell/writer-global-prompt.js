    function nativeGlobalPromptElements() {
        return {
            open: document.querySelector('[data-native-manage-global-prompt]'),
            dialog: document.querySelector('[data-native-global-prompt-dialog]'),
            form: document.querySelector('[data-native-global-prompt-form]'),
            enabled: document.querySelector('[data-native-global-prompt-enabled]'),
            content: document.querySelector('[data-native-global-prompt-content]'),
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
        if (elements.enabled) elements.enabled.checked = !!globalPrompt.enabled;
        if (elements.content) elements.content.value = globalPrompt.content || '';
        if (elements.status) elements.status.textContent = globalPrompt.enabled ? '当前已启用，会作为所有 AI 请求的首条 system 指令发送。' : '当前未启用，保存并开启后才会发送。';
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
        if (globalPrompt.enabled && !globalPrompt.content) {
            if (elements.status) elements.status.textContent = '启用前请填写全局前缀内容。';
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
            closeNativeGlobalPromptDialog();
            setNativeSaveStatus(globalPrompt.enabled ? '全局写作前缀已启用' : '全局写作前缀已关闭', 'ok');
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
