    function settingsElements() {
        return {
            form: document.querySelector('[data-settings-form]'),
            status: document.querySelector('[data-settings-status]'),
            mode: document.querySelector('[data-settings-mode]'),
            provider: document.querySelector('[data-settings-provider]'),
            endpoint: document.querySelector('[data-settings-endpoint]'),
            model: document.querySelector('[data-settings-model]'),
            apiKey: document.querySelector('[data-settings-api-key]'),
            temperature: document.querySelector('[data-settings-temperature]'),
            maxTokens: document.querySelector('[data-settings-max-tokens]'),
            providerDefaults: document.querySelector('[data-settings-provider-defaults]'),
            globalPromptEnabled: document.querySelector('[data-settings-global-prompt-enabled]'),
            globalPrompt: document.querySelector('[data-settings-global-prompt]'),
            workflowProfile: document.querySelector('[data-settings-workflow-profile]'),
            compendiumAgentEnabled: document.querySelector('[data-settings-compendium-agent-enabled]'),
            compendiumAgentProfile: document.querySelector('[data-settings-compendium-agent-profile]'),
            compendiumAgentMaxCards: document.querySelector('[data-settings-compendium-agent-max-cards]'),
            compendiumAgentApiProvider: document.querySelector('[data-settings-compendium-agent-api-provider]'),
            compendiumAgentApiEndpoint: document.querySelector('[data-settings-compendium-agent-api-endpoint]'),
            compendiumAgentApiModel: document.querySelector('[data-settings-compendium-agent-api-model]'),
            compendiumAgentApiKey: document.querySelector('[data-settings-compendium-agent-api-key]'),
            compendiumAgentApiSave: document.querySelector('[data-settings-compendium-agent-api-save]'),
            compendiumAgentApiTest: document.querySelector('[data-settings-compendium-agent-api-test]'),
            compendiumAgentApiStatus: document.querySelector('[data-settings-compendium-agent-api-status]'),
            test: document.querySelector('[data-settings-test]'),
            refresh: document.querySelector('[data-settings-refresh]'),
            ttsVoice: document.querySelector('[data-settings-tts-voice]'),
            ttsRate: document.querySelector('[data-settings-tts-rate]'),
            ttsRateValue: document.querySelector('[data-settings-tts-rate-value]'),
            ttsRefreshVoices: document.querySelector('[data-settings-tts-refresh-voices]'),
            theme: document.querySelector('[data-settings-theme]'),
            themeSave: document.querySelector('[data-settings-theme-save]'),
            profilesList: document.querySelector('[data-settings-profiles-list]'),
            profileEditor: document.querySelector('[data-settings-profile-editor]'),
            profileName: document.querySelector('[data-settings-profile-name]'),
            profileProvider: document.querySelector('[data-settings-profile-provider]'),
            profileEndpoint: document.querySelector('[data-settings-profile-endpoint]'),
            profileModel: document.querySelector('[data-settings-profile-model]'),
            profileApiKey: document.querySelector('[data-settings-profile-api-key]'),
            profileSave: document.querySelector('[data-settings-profile-save]'),
            profileCancel: document.querySelector('[data-settings-profile-cancel]'),
            profileDelete: document.querySelector('[data-settings-profile-delete]'),
            profileAdd: document.querySelector('[data-settings-profile-add]'),
            projectLocation: document.querySelector('[data-settings-project-location]'),
            backupLocation: document.querySelector('[data-settings-backup-location]'),
            openProjectLocation: document.querySelector('[data-settings-open-project-location]'),
            chooseProjectLocation: document.querySelector('[data-settings-choose-project-location]'),
            openBackupLocation: document.querySelector('[data-settings-open-backup-location]'),
            chooseBackupLocation: document.querySelector('[data-settings-choose-backup-location]')
        };
    }

    function normalizeDesktopSettings(settings) {
        if (window.DraftHarborSettingsSchema && typeof window.DraftHarborSettingsSchema.normalizeDesktopSettings === 'function') {
            return window.DraftHarborSettingsSchema.normalizeDesktopSettings(settings || {});
        }
        return settings || {};
    }

    function compendiumAgentFeatureAvailable() {
        return !!(window.DraftHarborCompendiumAgentPolicy && typeof window.DraftHarborCompendiumAgentPolicy.normalizeCompendiumAgentSettings === 'function');
    }

    function runtimeProviderConfig(extras = {}) {
        if (extras && extras.profileId && extras.profileId !== 'inherit'
            && window.DraftHarborSettingsSchema && typeof window.DraftHarborSettingsSchema.providerRuntimeConfig === 'function') {
            return window.DraftHarborSettingsSchema.providerRuntimeConfig(settingsWithRuntimeProfiles(), extras);
        }
        if (settingsState.runtimeProvider) {
            return {
                ...settingsState.runtimeProvider,
                ...extras
            };
        }
        if (window.DraftHarborSettingsSchema && typeof window.DraftHarborSettingsSchema.providerRuntimeConfig === 'function') {
            return window.DraftHarborSettingsSchema.providerRuntimeConfig(settingsState.settings || {}, extras);
        }
        return {
            mode: 'local',
            endpoint: 'http://localhost:8080',
            temperature: 0.8,
            maxTokens: 2000,
            ...extras
        };
    }

    function setSettingsStatus(message, tone = 'info') {
        const { status } = settingsElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function setCompendiumAgentApiStatus(message, tone = 'info') {
        const status = settingsElements().compendiumAgentApiStatus;
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function renderSettingsForm() {
        const elements = settingsElements();
        if (!elements.form) return;
        const settings = normalizeDesktopSettings(settingsState.settings);
        const provider = settings.providerSettings || {};
        const defaults = settings.generationDefaults || {};
        const local = settings.localModelSettings || {};
        const agent = settings.compendiumAgent || {};
        const workflow = settings.workflowGeneration || {};
        const agentAvailable = compendiumAgentFeatureAvailable();

        if (elements.mode) elements.mode.value = provider.mode || 'local';
        if (elements.provider) elements.provider.value = provider.provider || (provider.mode === 'local' ? 'lmstudio' : 'openai-compatible');
        if (elements.endpoint) elements.endpoint.value = provider.mode === 'local' ? (local.endpoint || provider.endpoint || '') : (provider.endpoint || '');
        if (elements.model) elements.model.value = provider.model || local.model || '';
        if (elements.apiKey) {
            elements.apiKey.value = '';
            elements.apiKey.placeholder = provider.hasApiKey ? '已保存密钥，留空表示保持不变' : 'API key';
            elements.apiKey.disabled = provider.mode === 'local';
        }
        if (elements.temperature) elements.temperature.value = defaults.temperature === undefined ? 0.8 : defaults.temperature;
        if (elements.maxTokens) elements.maxTokens.value = defaults.maxTokens || 300;
        if (elements.providerDefaults) elements.providerDefaults.checked = !!defaults.useProviderDefaults;
        if (elements.globalPromptEnabled) elements.globalPromptEnabled.checked = !!(settings.globalPrompt && settings.globalPrompt.enabled);
        if (elements.globalPrompt) elements.globalPrompt.value = settings.globalPrompt && settings.globalPrompt.content || '';
        if (elements.compendiumAgentMaxCards) elements.compendiumAgentMaxCards.value = agent.maxCardsPerRun || 30;
        if (elements.workflowProfile) {
            elements.workflowProfile.replaceChildren();
            const inherit = document.createElement('option'); inherit.value = 'inherit'; inherit.textContent = '继承默认写作连接（全局）'; elements.workflowProfile.appendChild(inherit);
            (settings.providerProfiles || []).filter((profile) => modelCatalog().isApiCompatibleProvider(profile.provider)).forEach((profile) => {
                const option = document.createElement('option'); option.value = profile.id; option.textContent = `${profile.name || profile.provider} · ${profile.model || '默认模型'}${profile.hasApiKey ? '' : ' · 缺少密钥'}`; elements.workflowProfile.appendChild(option);
            });
            elements.workflowProfile.value = workflow.providerProfileId || 'inherit';
        }
        if (elements.compendiumAgentProfile) {
            elements.compendiumAgentProfile.replaceChildren();
            const empty = document.createElement('option'); empty.value = ''; empty.textContent = '请选择专用 API 配置组'; elements.compendiumAgentProfile.appendChild(empty);
            (settings.providerProfiles || []).filter((profile) => modelCatalog().isApiCompatibleProvider(profile.provider)).forEach((profile) => {
                const option = document.createElement('option'); option.value = profile.id; option.textContent = `${profile.name || profile.provider} · ${profile.model || '默认模型'}${profile.hasApiKey ? '' : ' · 缺少密钥'}`; elements.compendiumAgentProfile.appendChild(option);
            });
            elements.compendiumAgentProfile.value = agent.providerProfileId || '';
        }
        document.querySelectorAll('[data-settings-cat-target="compendium-agent"], [data-settings-section="compendium-agent"]').forEach((element) => {
            element.hidden = !agentAvailable;
        });

        const isBusy = settingsState.loading || settingsState.saving;
        [elements.mode, elements.provider, elements.endpoint, elements.model, elements.apiKey, elements.temperature, elements.maxTokens, elements.providerDefaults, elements.globalPromptEnabled, elements.globalPrompt, elements.workflowProfile, elements.compendiumAgentEnabled, elements.compendiumAgentProfile, elements.compendiumAgentMaxCards, elements.compendiumAgentApiProvider, elements.compendiumAgentApiEndpoint, elements.compendiumAgentApiModel, elements.compendiumAgentApiKey, elements.compendiumAgentApiSave, elements.compendiumAgentApiTest, elements.test, elements.refresh, elements.theme, elements.themeSave].forEach((field) => {
            if (field) field.disabled = isBusy || (field === elements.apiKey && provider.mode === 'local');
        });
        renderCompendiumAgentApiEditor();
        renderSettingsProfiles();
        renderSettingsAppearance();
        renderSettingsStorage();
        renderSettingsCategorySummaries();
        setSettingsCategory(settingsState.activeSection);
    }

    function setSettingsCategory(target) {
        const allowed = new Set(['provider', 'profiles', 'generation', 'workflow', 'appearance', 'tts', 'storage']);
        if (compendiumAgentFeatureAvailable()) allowed.add('compendium-agent');
        const next = allowed.has(target) ? target : 'provider';
        settingsState.activeSection = next;
        document.querySelectorAll('[data-settings-cat-target]').forEach((button) => {
            const active = button.dataset.settingsCatTarget === next;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('[data-settings-section]').forEach((section) => {
            section.hidden = section.dataset.settingsSection !== next;
        });
        const globalActions = document.querySelector('.desktop-settings-global-actions');
        if (globalActions) globalActions.hidden = next === 'compendium-agent';
    }

    function settingsProviderLabel(provider) {
        const meta = modelCatalog().getProviderMetadata(provider || '');
        return meta && meta.label ? meta.label : String(provider || '未配置');
    }

    function renderSettingsCategorySummaries() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const provider = settings.providerSettings || {};
        const profiles = settings.providerProfiles || [];
        const defaults = settings.generationDefaults || {};
        const themeLabels = {
            'morandi-ink': '墨灰书房',
            'mist-library': '雾光书库',
            'ash-rose': '灰玫瑰工作室'
        };
        const summaries = {
            provider: `${provider.mode === 'api' ? '云端' : '本地'} · ${settingsProviderLabel(provider.provider)}`,
            profiles: `${provider.mode === 'api' ? '默认连接' : '本地默认'}${profiles.length ? ` · ${profiles.length} 个独立档案` : ''}`,
            generation: defaults.useProviderDefaults ? '跟随模型默认值' : `${defaults.temperature ?? 0.8} · ${formatNumber(defaults.maxTokens || 2000)} tokens`,
            workflow: (settings.workflowGeneration || {}).providerProfileId && (settings.workflowGeneration || {}).providerProfileId !== 'inherit'
                ? '专用配置组已选择' : '继承默认写作连接',
            'compendium-agent': settings.compendiumAgent && settings.compendiumAgent.enabled ? (settings.compendiumAgent.providerProfileId ? '专用配置组已选择' : '请选择配置组') : '未启用',
            appearance: themeLabels[(settings.appearance || {}).theme] || '墨灰书房',
            tts: settingsElements().ttsVoice && settingsElements().ttsVoice.value ? '已选择本机声音' : '本机语音',
            storage: settings.projectSaveLocation ? '自定义书库位置' : '默认本地书库'
        };
        Object.entries(summaries).forEach(([key, value]) => {
            const element = document.querySelector(`[data-settings-cat-summary="${key}"]`);
            if (element) element.textContent = value;
        });
    }

    function renderSettingsStorage() {
        const elements = settingsElements();
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const resolved = settingsState.storageLocations || {};
        const projectLocation = resolved.projectSaveLocation || settings.projectSaveLocation || projectLibraryState.projectSaveLocation || '默认：应用数据目录中的 projects';
        const backupLocation = resolved.backupLocation || settings.backupLocation || (projectLocation && !projectLocation.startsWith('默认：') ? `${projectLocation}\\backups` : '默认：作品书库中的 backups');
        if (elements.projectLocation) elements.projectLocation.textContent = projectLocation;
        if (elements.backupLocation) elements.backupLocation.textContent = backupLocation;
    }

    async function runSettingsStorageAction(endpoint, successMessage, reloadAfter = false) {
        setSettingsStatus('正在处理存储位置...', 'info');
        try {
            const response = await fetch(endpoint, { method: 'POST' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            if (result.canceled) {
                setSettingsStatus('已取消更改', 'info');
                return;
            }
            if (reloadAfter) {
                await loadSettings();
                await loadProjectLibrary();
                await loadRecoveryList();
            }
            setSettingsStatus(successMessage, 'ok');
            renderSettingsStorage();
            renderSettingsCategorySummaries();
        } catch (error) {
            setSettingsStatus(`操作失败：${error.message || error}`, 'error');
        }
    }

    function renderSettingsAppearance() {
        var settings = normalizeDesktopSettings(settingsState.settings);
        var appearance = settings.appearance || {};
        var theme = normalizeDesktopTheme(appearance.theme || 'morandi-ink');
        if (settingsElements().theme) settingsElements().theme.value = theme;
        document.querySelectorAll('[data-settings-theme-choice]').forEach(function (card) {
            card.classList.toggle('is-active', card.dataset.settingsThemeChoice === theme);
        });
    }

    function modelCatalog() {
        if (window.DraftHarborModelCatalog) return window.DraftHarborModelCatalog;
        return {
            getProviderModels: function () { return [{ id: '__custom__', label: '自定义模型...' }]; },
            getProviderMetadata: function (provider) { return { label: provider, defaultEndpoint: '', defaultModelHint: '' }; },
            isThinkingSupported: function () { return false; },
            isKnownDefaultEndpoint: function () { return false; },
            isKnownDefaultModelHint: function () { return false; },
            isApiCompatibleProvider: function (provider) {
                return ['deepseek', 'openai', 'openrouter', 'nanogpt', 'openai-compatible', 'custom'].indexOf(provider) >= 0;
            }
        };
    }

    function settingsWithRuntimeProfiles() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const runtimeProfiles = Array.isArray(settingsState.runtimeProviderProfiles)
            ? settingsState.runtimeProviderProfiles
            : [];
        if (!runtimeProfiles.length) return settings;
        const profileMap = new Map((settings.providerProfiles || []).map((profile) => [profile.id, { ...profile }]));
        runtimeProfiles.forEach((runtimeProfile) => {
            if (!runtimeProfile || !runtimeProfile.id) return;
            profileMap.set(runtimeProfile.id, {
                ...(profileMap.get(runtimeProfile.id) || {}),
                ...runtimeProfile,
                hasApiKey: !!(runtimeProfile.apiKey || runtimeProfile.hasApiKey)
            });
        });
        return {
            ...settings,
            providerProfiles: Array.from(profileMap.values())
        };
    }

    function renderSettingsProfiles() {
        const elements = settingsElements();
        if (!elements.profilesList) return;
        const settings = normalizeDesktopSettings(settingsState.settings);
        const profiles = settings.providerProfiles || [];
        elements.profilesList.replaceChildren();
        const defaultProvider = settings.providerSettings || {};
        const defaultItem = document.createElement('div');
        defaultItem.className = 'desktop-settings-profile-item';
        defaultItem.dataset.settingsDefaultWritingProfile = 'true';
        const defaultInfo = document.createElement('div');
        defaultInfo.className = 'desktop-settings-profile-info';
        const defaultName = document.createElement('strong');
        defaultName.textContent = '默认写作连接';
        const defaultMeta = document.createElement('span');
        let defaultEndpoint = defaultProvider.endpoint || '未设置接口地址';
        try { defaultEndpoint = defaultProvider.endpoint ? new URL(defaultProvider.endpoint).host : defaultEndpoint; } catch (error) { /* keep original */ }
        defaultMeta.textContent = `${defaultProvider.mode === 'api' ? settingsProviderLabel(defaultProvider.provider) : '本地模型'} · ${defaultProvider.model || '默认模型'} · ${defaultEndpoint}`;
        const defaultBadges = document.createElement('div');
        defaultBadges.className = 'desktop-settings-profile-badges';
        const defaultBadge = document.createElement('span');
        const defaultReady = defaultProvider.mode === 'local' || !!defaultProvider.hasApiKey;
        defaultBadge.dataset.tone = defaultReady ? 'ok' : 'warn';
        defaultBadge.textContent = defaultReady ? (defaultProvider.mode === 'local' ? '本地连接' : '密钥已保存') : '缺少密钥';
        const defaultUseBadge = document.createElement('span');
        defaultUseBadge.dataset.tone = 'info';
        defaultUseBadge.textContent = '写作默认';
        defaultBadges.append(defaultBadge, defaultUseBadge);
        defaultInfo.append(defaultName, defaultMeta, defaultBadges);
        const defaultActions = document.createElement('div');
        defaultActions.className = 'desktop-settings-profile-actions';
        const defaultEdit = document.createElement('button');
        defaultEdit.type = 'button';
        defaultEdit.className = 'desktop-secondary-action';
        defaultEdit.textContent = '编辑默认连接';
        defaultEdit.addEventListener('click', () => {
            setSettingsCategory('provider');
            setSettingsStatus('正在编辑默认写作连接', 'info');
        });
        defaultActions.appendChild(defaultEdit);
        defaultItem.append(defaultInfo, defaultActions);
        elements.profilesList.appendChild(defaultItem);
        if (!profiles.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-settings-profile-empty';
            empty.innerHTML = '<strong>还没有独立模型档案</strong><span>可以继续添加 DeepSeek、OpenAI 或其他兼容接口，在写作页手动切换。</span>';
            elements.profilesList.appendChild(empty);
        } else {
            profiles.forEach((profile) => {
                const item = document.createElement('div');
                item.className = 'desktop-settings-profile-item';
                const info = document.createElement('div');
                info.className = 'desktop-settings-profile-info';
                const name = document.createElement('strong');
                name.textContent = profile.name || profile.provider || 'API 配置组';
                const meta = document.createElement('span');
                let endpointLabel = profile.endpoint || '未设置接口地址';
                try { endpointLabel = profile.endpoint ? new URL(profile.endpoint).host : endpointLabel; } catch (error) { /* keep original */ }
                meta.textContent = `${settingsProviderLabel(profile.provider)} · ${profile.model || '默认模型'} · ${endpointLabel}`;
                const badges = document.createElement('div');
                badges.className = 'desktop-settings-profile-badges';
                const keyBadge = document.createElement('span');
                keyBadge.dataset.tone = profile.hasApiKey ? 'ok' : 'warn';
                keyBadge.textContent = profile.hasApiKey ? '密钥已保存' : '缺少密钥';
                const compatible = modelCatalog().isApiCompatibleProvider(profile.provider);
                const useBadge = document.createElement('span');
                useBadge.dataset.tone = compatible && profile.hasApiKey ? 'ok' : 'info';
                useBadge.textContent = compatible && profile.hasApiKey ? '可用于写作' : '暂不可用于写作';
                badges.append(keyBadge, useBadge);
                info.append(name, meta, badges);
                const testState = profileTestState[profile.id];
                if (testState) {
                    const status = document.createElement('span');
                    status.className = 'desktop-settings-profile-status';
                    status.dataset.tone = testState.tone || 'info';
                    status.textContent = testState.message || '';
                    info.appendChild(status);
                }
                const actions = document.createElement('div');
                actions.className = 'desktop-settings-profile-actions';
                const test = document.createElement('button');
                test.type = 'button';
                test.className = 'desktop-secondary-action';
                test.textContent = testState && testState.running ? '测试中...' : '测试';
                test.disabled = !!(testState && testState.running);
                test.addEventListener('click', () => testProviderProfile(profile.id));
                const edit = document.createElement('button');
                edit.type = 'button';
                edit.className = 'desktop-secondary-action';
                edit.textContent = '编辑';
                edit.addEventListener('click', () => openProviderProfileEditor(profile));
                actions.append(test, edit);
                item.append(info, actions);
                elements.profilesList.appendChild(item);
            });
        }
        if (elements.profileEditor) elements.profileEditor.hidden = !profileEditState.editingProfile;
        if (profileEditState.editingProfile) {
            const profile = profileEditState.editingProfile;
            if (elements.profileName) elements.profileName.value = profile.name || '';
            if (elements.profileProvider) elements.profileProvider.value = profile.provider || 'deepseek';
            if (elements.profileEndpoint) elements.profileEndpoint.value = profile.endpoint || '';
            if (elements.profileModel) elements.profileModel.value = profile.model || '';
            if (elements.profileApiKey) {
                elements.profileApiKey.value = '';
                elements.profileApiKey.placeholder = profile.hasApiKey ? '已保存密钥，留空表示保持现有密钥' : 'API Key';
            }
            if (elements.profileDelete) elements.profileDelete.hidden = !profileEditState.editingId;
        }
        renderSettingsCategorySummaries();
    }

    function profileDefaults(provider) {
        const meta = modelCatalog().getProviderMetadata(provider || 'deepseek');
        return {
            endpoint: meta.defaultEndpoint || '',
            model: meta.defaultModelHint || ''
        };
    }

    function selectedCompendiumAgentProfile() {
        const elements = settingsElements();
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const selectedId = elements.compendiumAgentProfile ? elements.compendiumAgentProfile.value : ((settings.compendiumAgent || {}).providerProfileId || '');
        return (settings.providerProfiles || []).find((profile) => profile.id === selectedId) || null;
    }

    function renderCompendiumAgentApiEditor() {
        const elements = settingsElements();
        if (!elements.compendiumAgentApiProvider) return;
        const profile = selectedCompendiumAgentProfile();
        const provider = (profile && profile.provider) || 'deepseek';
        const defaults = profileDefaults(provider);
        elements.compendiumAgentApiProvider.value = provider;
        if (elements.compendiumAgentApiEndpoint) elements.compendiumAgentApiEndpoint.value = (profile && profile.endpoint) || defaults.endpoint;
        if (elements.compendiumAgentApiModel) elements.compendiumAgentApiModel.value = (profile && profile.model) || (provider === 'deepseek' ? 'deepseek-v4-flash' : defaults.model);
        if (elements.compendiumAgentApiKey) {
            elements.compendiumAgentApiKey.value = '';
            elements.compendiumAgentApiKey.placeholder = profile && profile.hasApiKey ? '密钥已保存，留空表示保持不变' : 'API Key';
        }
        if (elements.compendiumAgentApiTest) elements.compendiumAgentApiTest.disabled = settingsState.loading || settingsState.saving || !profile || !profile.hasApiKey;
    }

    async function saveCompendiumAgentApiProfile() {
        const elements = settingsElements();
        const existing = selectedCompendiumAgentProfile();
        const provider = elements.compendiumAgentApiProvider ? elements.compendiumAgentApiProvider.value : 'deepseek';
        const endpoint = elements.compendiumAgentApiEndpoint ? elements.compendiumAgentApiEndpoint.value.trim() : '';
        const model = elements.compendiumAgentApiModel ? elements.compendiumAgentApiModel.value.trim() : '';
        const apiKey = elements.compendiumAgentApiKey ? elements.compendiumAgentApiKey.value.trim() : '';
        if (!endpoint) throw new Error('请填写 API Endpoint');
        if (!model) throw new Error('请填写模型名称');
        if (!apiKey && !(existing && existing.hasApiKey)) throw new Error('请填写 API Key');
        const profileId = (existing && existing.id) || `compendium-agent-${Date.now()}`;
        const profileResponse = await fetch('/api/settings/provider-profiles', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: { id: profileId, name: (existing && existing.name) || `资料库管家 · ${settingsProviderLabel(provider)}`, provider, endpoint, model, apiKey } })
        });
        const profileResult = await profileResponse.json().catch(() => ({}));
        if (!profileResponse.ok || !profileResult.ok) throw new Error(profileResult.error || `HTTP ${profileResponse.status}`);
        settingsState.settings = normalizeDesktopSettings(profileResult.settings || {});
        settingsState.runtimeProviderProfiles = profileResult.runtimeProviderProfiles || null;
        const current = normalizeDesktopSettings(settingsState.settings || {});
        const settingsResponse = await fetch('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { compendiumAgent: {
                ...(current.compendiumAgent || {}),
                enabled: true,
                providerProfileId: profileId,
                model: '',
                maxCardsPerRun: elements.compendiumAgentMaxCards ? Number(elements.compendiumAgentMaxCards.value) : 30
            } } })
        });
        const settingsResult = await settingsResponse.json().catch(() => ({}));
        if (!settingsResponse.ok || !settingsResult.ok) throw new Error(settingsResult.error || `HTTP ${settingsResponse.status}`);
        settingsState.settings = normalizeDesktopSettings(settingsResult.settings || {});
        settingsState.runtimeProviderProfiles = settingsResult.runtimeProviderProfiles || settingsState.runtimeProviderProfiles;
        setSettingsStatus('资料库管家专用 API 已保存并启用', 'ok');
        setCompendiumAgentApiStatus('已保存。资料库管家现在使用这组专用 API。', 'ok');
        renderSettingsForm();
        renderWriterModelControl();
    }

    async function testCompendiumAgentApiProfile() {
        const profile = selectedCompendiumAgentProfile();
        if (!profile) throw new Error('请先保存专用 API 配置');
        setSettingsStatus('正在测试资料库管家专用 API...', 'info');
        setCompendiumAgentApiStatus('正在发送最小测试请求…', 'info');
        const response = await fetch('/api/settings/test-provider-profile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: profile.id, live: true })
        });
        const result = await response.json().catch(() => ({}));
        const detail = result.result || result;
        if (!response.ok || !result.ok) throw new Error(detail.error || result.error || `HTTP ${response.status}`);
        const detailText = detail.statusCode ? `连接成功（HTTP ${detail.statusCode}）` : '连接成功';
        setSettingsStatus(`资料库管家专用 API ${detailText}`, 'ok');
        setCompendiumAgentApiStatus(detailText, 'ok');
    }

    function openProviderProfileEditor(profile) {
        const provider = (profile && profile.provider) || 'deepseek';
        const defaults = profileDefaults(provider);
        profileEditState.editingId = (profile && profile.id) || '';
        profileEditState.editingProfile = {
            id: (profile && profile.id) || '',
            name: (profile && profile.name) || '',
            provider,
            endpoint: (profile && profile.endpoint) || defaults.endpoint,
            model: (profile && profile.model) || defaults.model,
            hasApiKey: !!(profile && profile.hasApiKey)
        };
        renderSettingsProfiles();
    }

    function closeProviderProfileEditor() {
        profileEditState.editingId = '';
        profileEditState.editingProfile = null;
        renderSettingsProfiles();
    }

    async function saveProviderProfile() {
        const elements = settingsElements();
        const profile = {
            id: profileEditState.editingId || undefined,
            name: elements.profileName ? elements.profileName.value.trim() : '',
            provider: elements.profileProvider ? elements.profileProvider.value : 'deepseek',
            endpoint: elements.profileEndpoint ? elements.profileEndpoint.value.trim() : '',
            model: elements.profileModel ? elements.profileModel.value.trim() : '',
            apiKey: elements.profileApiKey ? elements.profileApiKey.value : ''
        };
        const response = await fetch('/api/settings/provider-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        settingsState.settings = normalizeDesktopSettings(result.settings || {});
        settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
        closeProviderProfileEditor();
        setSettingsStatus('配置组已保存', 'ok');
        renderWriterModelControl();
    }

    async function deleteProviderProfile() {
        if (!profileEditState.editingId) return;
        const response = await fetch('/api/settings/delete-provider-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: profileEditState.editingId })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        settingsState.settings = normalizeDesktopSettings(result.settings || {});
        settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
        closeProviderProfileEditor();
        setSettingsStatus('配置组已删除', 'ok');
        renderWriterModelControl();
    }

    async function testProviderProfile(profileId) {
        profileTestState[profileId] = { running: true, tone: 'info', message: '测试中...' };
        renderSettingsProfiles();
        try {
            const response = await fetch('/api/settings/test-provider-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profileId, live: false })
            });
            const result = await response.json().catch(() => ({}));
            const detail = result.result || result;
            profileTestState[profileId] = {
                running: false,
                tone: result.ok ? 'ok' : 'error',
                message: result.ok ? '配置可用' : (detail.error || result.error || '测试失败')
            };
        } catch (error) {
            profileTestState[profileId] = { running: false, tone: 'error', message: error.message || String(error) };
        }
        renderSettingsProfiles();
    }

    function getTtsVoices() {
        if (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function') {
            return window.speechSynthesis.getVoices();
        }
        return [];
    }

    function populateTtsVoiceSelect() {
        const elements = settingsElements();
        if (!elements.ttsVoice) return;
        const voices = getTtsVoices();
        const savedVoice = (function () {
            try { return window.localStorage.getItem(TTS_VOICE_KEY) || ''; } catch (e) { return ''; }
        })();
        elements.ttsVoice.replaceChildren();
        voices.forEach(function (voice) {
            var option = document.createElement('option');
            option.value = voice.name;
            option.textContent = voice.name + ' (' + (voice.lang || 'unknown') + ')';
            if (voice.name === savedVoice) option.selected = true;
            elements.ttsVoice.appendChild(option);
        });
        if (!voices.some(function (v) { return v.name === savedVoice; }) && savedVoice) {
            var option = document.createElement('option');
            option.value = savedVoice;
            option.textContent = savedVoice + ' (不可用)';
            option.selected = true;
            option.disabled = true;
            elements.ttsVoice.appendChild(option);
        }
        renderSettingsCategorySummaries();
    }

    function loadTtsPrefs() {
        var elements = settingsElements();
        try {
            var savedVoice = window.localStorage.getItem(TTS_VOICE_KEY) || '';
            var savedRate = Number(window.localStorage.getItem(TTS_SPEED_KEY) || '1');
            if (elements.ttsRate) {
                elements.ttsRate.value = String(Number.isFinite(savedRate) ? Math.min(2, Math.max(0.5, savedRate)) : 1);
            }
            if (elements.ttsRateValue) {
                elements.ttsRateValue.textContent = elements.ttsRate ? String(Number(elements.ttsRate.value).toFixed(1)) : '1.0';
            }
            populateTtsVoiceSelect();
        } catch (e) { /* ignore */ }
    }

    function saveTtsVoicePref(name) {
        try { window.localStorage.setItem(TTS_VOICE_KEY, String(name || '')); } catch (e) { /* ignore */ }
    }

    function saveTtsSpeedPref(rate) {
        try { window.localStorage.setItem(TTS_SPEED_KEY, String(rate)); } catch (e) { /* ignore */ }
    }

    function collectSettingsForm() {
        const elements = settingsElements();
        const current = normalizeDesktopSettings(settingsState.settings);
        const mode = elements.mode ? elements.mode.value : 'local';
        const endpoint = elements.endpoint ? elements.endpoint.value.trim() : '';
        const model = elements.model ? elements.model.value.trim() : '';
        var theme = normalizeDesktopTheme(elements.theme ? elements.theme.value : 'morandi-ink');
        return {
            providerSettings: {
                mode,
                provider: elements.provider ? elements.provider.value : (mode === 'local' ? 'lmstudio' : 'openai-compatible'),
                endpoint,
                model,
                apiKey: elements.apiKey ? elements.apiKey.value.trim() : ''
            },
            generationDefaults: {
                temperature: elements.temperature ? Number(elements.temperature.value) : 0.8,
                maxTokens: elements.maxTokens ? Number(elements.maxTokens.value) : 2000,
                useProviderDefaults: !!(elements.providerDefaults && elements.providerDefaults.checked)
            },
            globalPrompt: {
                enabled: !!(elements.globalPromptEnabled && elements.globalPromptEnabled.checked),
                content: elements.globalPrompt ? elements.globalPrompt.value.trim() : ''
            },
            workflowGeneration: {
                providerProfileId: elements.workflowProfile ? elements.workflowProfile.value : ((current.workflowGeneration || {}).providerProfileId || 'inherit')
            },
            compendiumAgent: {
                enabled: elements.compendiumAgentEnabled ? !!elements.compendiumAgentEnabled.checked : !!(current.compendiumAgent && current.compendiumAgent.enabled),
                providerProfileId: elements.compendiumAgentProfile ? elements.compendiumAgentProfile.value : '',
                model: (current.compendiumAgent && current.compendiumAgent.model) || '',
                maxCardsPerRun: elements.compendiumAgentMaxCards ? Number(elements.compendiumAgentMaxCards.value) : 30
            },
            localModelSettings: {
                ...(current.localModelSettings || {}),
                endpoint: mode === 'local' ? (endpoint || 'http://localhost:8080') : ((current.localModelSettings && current.localModelSettings.endpoint) || 'http://localhost:8080'),
                model: mode === 'local' ? model : ((current.localModelSettings && current.localModelSettings.model) || '')
            },
            appearance: {
                theme: theme
            }
        };
    }

    function refreshSettingsProviderDefaults() {
        const elements = settingsElements();
        if (!elements.mode || !elements.provider || !elements.endpoint || !elements.model) return;
        const mode = elements.mode.value;
        const provider = elements.provider.value;
        const endpoint = elements.endpoint.value.trim();
        const endpointLooksLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(endpoint);
        if (mode === 'api' && provider === 'deepseek' && (!endpoint || endpointLooksLocal)) {
            elements.endpoint.value = 'https://api.deepseek.com/chat/completions';
        }
        if (mode === 'api' && provider === 'deepseek' && !elements.model.value.trim()) {
            elements.model.value = 'deepseek-v4-pro';
        }
    }

    async function loadSettings() {
        if (settingsState.loading && settingsState.loadPromise) return settingsState.loadPromise;
        settingsState.loading = true;
        setSettingsStatus('正在读取设置...', 'info');
        renderSettingsForm();
        settingsState.loadPromise = (async () => {
            const response = await fetch('/api/settings', { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            settingsState.settings = normalizeDesktopSettings(result.settings || {});
            settingsState.runtimeProvider = result.runtimeProvider || runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
            settingsState.storageLocations = result.storageLocations || null;
            var appearance = normalizeDesktopSettings(settingsState.settings).appearance || {};
            applyDesktopTheme(appearance.theme || 'morandi-ink');
            setSettingsStatus('设置已读取', 'ok');
            return settingsState.settings;
        })();
        try {
            return await settingsState.loadPromise;
        } catch (error) {
            console.warn('Failed to load settings:', error);
            settingsState.settings = normalizeDesktopSettings();
            settingsState.runtimeProvider = runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = null;
            settingsState.storageLocations = null;
            setSettingsStatus(`读取设置失败：${error.message || error}`, 'error');
            return settingsState.settings;
        } finally {
            settingsState.loading = false;
            settingsState.loadPromise = null;
            renderSettingsForm();
            renderWriterModelControl();
            renderNativeGeneration();
        }
    }

    async function saveSettings(event) {
        if (event) event.preventDefault();
        const nextSettings = collectSettingsForm();
        settingsState.saving = true;
        setSettingsStatus('正在保存设置...', 'info');
        renderSettingsForm();
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: nextSettings })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            settingsState.settings = normalizeDesktopSettings(result.settings || {});
            settingsState.runtimeProvider = result.runtimeProvider || runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
            settingsState.storageLocations = result.storageLocations || settingsState.storageLocations;
            var appearance = normalizeDesktopSettings(settingsState.settings).appearance || {};
            applyDesktopTheme(appearance.theme || 'morandi-ink');
            setSettingsStatus('设置已保存', 'ok');
        } catch (error) {
            console.warn('Failed to save settings:', error);
            setSettingsStatus(`保存失败：${error.message || error}`, 'error');
        } finally {
            settingsState.saving = false;
            renderSettingsForm();
            renderWriterModelControl();
            renderNativeGeneration();
        }
    }

    async function saveWriterGenerationDefaults(patch) {
        const current = normalizeDesktopSettings(settingsState.settings || {});
        const defaults = {
            ...(current.generationDefaults || {}),
            ...(patch || {})
        };
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { generationDefaults: defaults } })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            settingsState.settings = normalizeDesktopSettings(result.settings || {});
            settingsState.runtimeProvider = result.runtimeProvider || runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
            renderSettingsForm();
            renderWriterModelControl();
            renderNativeGeneration();
            setNativeSaveStatus('生成参数已更新', 'ok');
        } catch (error) {
            console.warn('Failed to save writer generation defaults:', error);
            setNativeSaveStatus(`生成参数保存失败：${error.message || error}`, 'error');
            renderWriterModelControl();
        }
    }

    async function testSettingsProvider() {
        setSettingsStatus('正在检查配置...', 'info');
        try {
            const response = await fetch('/api/settings/test-provider', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // 密钥不会回显到页面；仅检查已保存配置，避免空输入覆盖有效密钥。
                body: JSON.stringify({ live: false })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            if (!result.ok) {
                throw new Error(result.result && result.result.error ? result.result.error : '配置不可用');
            }
            const checked = result.result && result.result.checked === 'configuration' ? '配置格式可用' : '连接可用';
            setSettingsStatus(checked, 'ok');
        } catch (error) {
            setSettingsStatus(`检查失败：${error.message || error}`, 'error');
        }
    }

    function bindSettings() {
        const elements = settingsElements();
        if (elements.form) elements.form.addEventListener('submit', saveSettings);
        if (elements.test) elements.test.addEventListener('click', testSettingsProvider);
        if (elements.refresh) elements.refresh.addEventListener('click', loadSettings);

        document.querySelectorAll('[data-settings-cat-target]').forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.settingsCatTarget;
                setSettingsCategory(target);
            });
        });

        [elements.mode, elements.provider].forEach((field) => {
            if (!field) return;
            field.addEventListener('change', () => {
                const current = normalizeDesktopSettings(settingsState.settings);
                const patch = collectSettingsForm();
                settingsState.settings = normalizeDesktopSettings({
                    ...current,
                    ...patch
                });
                renderSettingsForm();
                refreshSettingsProviderDefaults();
            });
        });
        if (elements.ttsVoice) {
            elements.ttsVoice.addEventListener('change', function () {
                saveTtsVoicePref(elements.ttsVoice.value);
            });
        }
        if (elements.ttsRate) {
            elements.ttsRate.addEventListener('input', function () {
                var rate = Number(elements.ttsRate.value);
                if (elements.ttsRateValue) elements.ttsRateValue.textContent = rate.toFixed(1);
                saveTtsSpeedPref(rate);
            });
        }
        if (elements.ttsRefreshVoices) {
            elements.ttsRefreshVoices.addEventListener('click', function () {
                populateTtsVoiceSelect();
            });
        }
        if (elements.openProjectLocation) elements.openProjectLocation.addEventListener('click', () => runSettingsStorageAction('/api/open-project-save-folder', '已打开作品书库'));
        if (elements.chooseProjectLocation) elements.chooseProjectLocation.addEventListener('click', () => runSettingsStorageAction('/api/choose-project-save-folder', '作品书库位置已更新', true));
        if (elements.openBackupLocation) elements.openBackupLocation.addEventListener('click', () => runSettingsStorageAction('/api/open-backup-folder', '已打开备份目录'));
        if (elements.chooseBackupLocation) elements.chooseBackupLocation.addEventListener('click', () => runSettingsStorageAction('/api/choose-backup-folder', '备份目录已更新', true));
        if (elements.theme) {
            elements.theme.addEventListener('change', function () {
                var current = normalizeDesktopSettings(settingsState.settings || {});
                var theme = normalizeDesktopTheme(elements.theme.value);
                settingsState.settings = normalizeDesktopSettings({
                    ...current,
                    appearance: {
                        ...(current.appearance || {}),
                        theme: theme
                    }
                });
                applyDesktopTheme(theme);
                renderSettingsAppearance();
            });
        }
        if (elements.themeSave) elements.themeSave.addEventListener('click', saveSettings);
        if (elements.profileAdd) elements.profileAdd.addEventListener('click', () => openProviderProfileEditor(null));
        if (elements.profileCancel) elements.profileCancel.addEventListener('click', closeProviderProfileEditor);
        if (elements.profileSave) {
            elements.profileSave.addEventListener('click', async () => {
                try {
                    await saveProviderProfile();
                } catch (error) {
                    setSettingsStatus(`配置组保存失败：${error.message || error}`, 'error');
                }
            });
        }
        if (elements.profileDelete) {
            elements.profileDelete.addEventListener('click', async () => {
                try {
                    await deleteProviderProfile();
                } catch (error) {
                    setSettingsStatus(`配置组删除失败：${error.message || error}`, 'error');
                }
            });
        }
        if (elements.profileProvider) {
            elements.profileProvider.addEventListener('change', () => {
                const provider = elements.profileProvider.value || 'deepseek';
                const defaults = profileDefaults(provider);
                if (elements.profileEndpoint && (!elements.profileEndpoint.value.trim() || modelCatalog().isKnownDefaultEndpoint(elements.profileEndpoint.value.trim()))) {
                    elements.profileEndpoint.value = defaults.endpoint;
                }
                if (elements.profileModel && (!elements.profileModel.value.trim() || modelCatalog().isKnownDefaultModelHint(elements.profileModel.value.trim()))) {
                    elements.profileModel.value = defaults.model;
                }
            });
        }
        if (elements.compendiumAgentProfile) elements.compendiumAgentProfile.addEventListener('change', renderCompendiumAgentApiEditor);
        if (elements.compendiumAgentApiProvider) {
            elements.compendiumAgentApiProvider.addEventListener('change', () => {
                const defaults = profileDefaults(elements.compendiumAgentApiProvider.value || 'deepseek');
                if (elements.compendiumAgentApiEndpoint) elements.compendiumAgentApiEndpoint.value = defaults.endpoint;
                if (elements.compendiumAgentApiModel) elements.compendiumAgentApiModel.value = elements.compendiumAgentApiProvider.value === 'deepseek' ? 'deepseek-v4-flash' : defaults.model;
            });
        }
        if (elements.compendiumAgentApiSave) {
            elements.compendiumAgentApiSave.addEventListener('click', async () => {
                try { await saveCompendiumAgentApiProfile(); }
                catch (error) {
                    const message = `保存失败：${error.message || error}`;
                    setSettingsStatus(`专用 API ${message}`, 'error');
                    setCompendiumAgentApiStatus(message, 'error');
                }
            });
        }
        if (elements.compendiumAgentApiTest) {
            elements.compendiumAgentApiTest.addEventListener('click', async () => {
                try { await testCompendiumAgentApiProfile(); }
                catch (error) {
                    const message = `连接失败：${error.message || error}`;
                    setSettingsStatus(`专用 API ${message}`, 'error');
                    setCompendiumAgentApiStatus(message, 'error');
                }
            });
        }
        document.querySelectorAll('[data-settings-theme-choice]').forEach(function (card) {
            card.addEventListener('click', function () {
                var current = normalizeDesktopSettings(settingsState.settings || {});
                var theme = normalizeDesktopTheme(card.dataset.settingsThemeChoice || 'morandi-ink');
                settingsState.settings = normalizeDesktopSettings({
                    ...current,
                    appearance: {
                        ...(current.appearance || {}),
                        theme: theme
                    }
                });
                if (elements.theme) elements.theme.value = theme;
                applyDesktopTheme(theme);
                renderSettingsAppearance();
            });
        });
        if (window.speechSynthesis) {
            window.speechSynthesis.addEventListener('voiceschanged', function () {
                populateTtsVoiceSelect();
            });
        }
        loadTtsPrefs();
        renderSettingsForm();
    }
