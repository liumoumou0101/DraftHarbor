    function settingsElements() {
        return {
            form: document.querySelector('[data-settings-form]'),
            status: document.querySelector('[data-settings-status]'),
            mode: document.querySelector('[data-settings-mode]'),
            provider: document.querySelector('[data-settings-provider]'),
            endpoint: document.querySelector('[data-settings-endpoint]'),
            model: document.querySelector('[data-settings-model]'),
            modelPick: document.querySelector('[data-settings-model-pick]'),
            profileModelPick: document.querySelector('[data-settings-profile-model-pick]'),
            agentModelPick: document.querySelector('[data-settings-compendium-agent-model-pick]'),
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
            writeTestStatus: document.querySelector('[data-settings-write-test-status]'),
            refresh: document.querySelector('[data-settings-refresh]'),
            zenHint: document.querySelector('[data-settings-zen-hint]'),
            catalogPanel: document.querySelector('[data-settings-catalog-panel]'),
            catalogStatus: document.querySelector('[data-settings-catalog-status]'),
            refreshCatalog: document.querySelector('[data-settings-refresh-catalog]'),
            hidePrivacyModels: document.querySelector('[data-settings-hide-privacy-models]'),
            modelOptions: document.querySelector('[data-settings-model-options]'),
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
            maxTokens: 8000,
            ...extras
        };
    }

    function setSettingsStatus(message, tone = 'info') {
        const { status } = settingsElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function setWritingTestStatus(message, tone = 'info') {
        const status = settingsElements().writeTestStatus;
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
        const catalog = modelCatalog();
        const isOpencode = catalog.isOpencodeProvider
            ? catalog.isOpencodeProvider(provider.provider)
            : (provider.provider === 'opencode-zen' || provider.provider === 'opencode-go');
        const opencodeMeta = isOpencode ? catalog.getProviderMetadata(provider.provider) : null;
        if (elements.endpoint) {
            elements.endpoint.value = provider.mode === 'local'
                ? (local.endpoint || provider.endpoint || '')
                : (isOpencode ? ((opencodeMeta && opencodeMeta.defaultBaseUrl) || provider.baseUrl || '') : (provider.endpoint || ''));
            elements.endpoint.readOnly = isOpencode && provider.mode === 'api';
        }
        if (elements.zenHint) {
            const hint = catalog.providerSetupHint
                ? catalog.providerSetupHint(provider.provider, provider.mode)
                : ((isOpencode && provider.mode === 'api')
                    ? (provider.provider === 'opencode-go'
                        ? 'OpenCode Go 使用月卡地址 https://opencode.ai/zen/go/v1，无需填写完整 Endpoint。'
                        : 'OpenCode Zen 使用按量地址 https://opencode.ai/zen/v1，无需填写完整 Endpoint。')
                    : '');
            elements.zenHint.hidden = !hint;
            if (hint) elements.zenHint.textContent = hint;
        }
        if (elements.catalogPanel) elements.catalogPanel.hidden = !(isOpencode && provider.mode === 'api');
        if (elements.hidePrivacyModels) {
            elements.hidePrivacyModels.checked = !!(settings.modelCatalogPreferences && settings.modelCatalogPreferences.hidePrivacyRiskModels);
        }
        renderSettingsModelOptions(provider.provider);
        renderSettingsCatalogStatus();
        if (elements.model) elements.model.value = provider.model || local.model || '';
        if (elements.apiKey) {
            elements.apiKey.value = '';
            elements.apiKey.placeholder = provider.hasApiKey ? '已保存密钥，留空表示保持不变' : 'API key';
            elements.apiKey.disabled = provider.mode === 'local';
        }
        if (elements.temperature) elements.temperature.value = defaults.temperature === undefined ? 0.8 : defaults.temperature;
        if (elements.maxTokens) elements.maxTokens.value = defaults.maxTokens || 8000;
        if (elements.providerDefaults) elements.providerDefaults.checked = !!defaults.useProviderDefaults;
        if (elements.globalPromptEnabled) elements.globalPromptEnabled.checked = !!(settings.globalPrompt && settings.globalPrompt.enabled);
        if (elements.globalPrompt) elements.globalPrompt.value = settings.globalPrompt && settings.globalPrompt.content || '';
        if (elements.compendiumAgentMaxCards) elements.compendiumAgentMaxCards.value = agent.maxCardsPerRun || 30;
        fillSettingsProfileSelects();
        if (elements.workflowProfile) elements.workflowProfile.value = workflow.providerProfileId || 'inherit';
        if (elements.compendiumAgentProfile) elements.compendiumAgentProfile.value = agent.providerProfileId || '';
        document.querySelectorAll('[data-settings-cat-target="compendium-agent"], [data-settings-section="compendium-agent"]').forEach((element) => {
            element.hidden = !agentAvailable;
        });

        const isBusy = settingsState.loading || settingsState.saving;
        const saveGeneration = document.querySelector('[data-settings-save-generation]');
        [elements.mode, elements.provider, elements.endpoint, elements.model, elements.apiKey, elements.temperature, elements.maxTokens, elements.providerDefaults, elements.globalPromptEnabled, elements.globalPrompt, elements.workflowProfile, elements.compendiumAgentEnabled, elements.compendiumAgentProfile, elements.compendiumAgentMaxCards, elements.compendiumAgentApiProvider, elements.compendiumAgentApiEndpoint, elements.compendiumAgentApiModel, elements.compendiumAgentApiKey, elements.compendiumAgentApiSave, elements.compendiumAgentApiTest, elements.test, elements.refresh, elements.theme, elements.themeSave, saveGeneration].forEach((field) => {
            if (field) field.disabled = isBusy || (field === elements.apiKey && provider.mode === 'local');
        });
        renderCompendiumAgentApiEditor();
        renderSettingsProfiles();
        renderSettingsAppearance();
        renderSettingsStorage();
        renderSettingsCategorySummaries();
        setSettingsCategory(settingsState.activeSection);
    }

    function isSettingsAiSection(target) {
        return target === 'provider' || target === 'profiles' || target === 'workflow' || target === 'compendium-agent';
    }

    function settingsHeadingCopy(target) {
        const titles = {
            provider: ['配置组', '上面是写作默认，下面是可选用的接口档案。'],
            profiles: ['配置组', '上面是写作默认，下面是可选用的接口档案。'],
            workflow: ['工作流', '可继承写作默认，或改用下面某个档案。'],
            'compendium-agent': ['资料库管家', '管家不继承写作模型，也不能读取正文。'],
            generation: ['生成参数', '只影响写作任务的温度、长度和全局指令。'],
            appearance: ['外观', '点选即预览并保存到本机。'],
            tts: ['朗读', '使用 Windows 本机语音，改动立即保存。'],
            storage: ['存储与维护', '作品和备份都留在本机。']
        };
        return titles[target] || titles.provider;
    }

    function setSettingsCategory(target) {
        const allowed = new Set(['provider', 'profiles', 'generation', 'workflow', 'appearance', 'tts', 'storage']);
        if (compendiumAgentFeatureAvailable()) allowed.add('compendium-agent');
        const next = allowed.has(target) ? target : 'profiles';
        const changed = settingsState.activeSection !== next;
        settingsState.activeSection = next;
        const connectionsPage = next === 'provider' || next === 'profiles';
        const navTarget = connectionsPage ? 'profiles' : next;
        const aiPage = isSettingsAiSection(next);
        document.querySelectorAll('[data-settings-cat-target]').forEach((button) => {
            const active = button.dataset.settingsCatTarget === navTarget;
            button.classList.remove('is-active');
            button.setAttribute('aria-selected', String(active));
            if (active) button.classList.add('is-active');
            else if (document.activeElement === button) button.blur();
        });
        const aiGroup = document.querySelector('[data-settings-ai-group]');
        if (aiGroup) {
            aiGroup.classList.remove('is-active');
            if (aiPage) aiGroup.classList.add('is-active');
        }
        document.querySelectorAll('[data-settings-section]').forEach((section) => {
            const id = section.dataset.settingsSection;
            if (id === 'compendium-agent' && !compendiumAgentFeatureAvailable()) {
                section.hidden = true;
                return;
            }
            section.hidden = connectionsPage ? (id !== 'provider' && id !== 'profiles') : id !== next;
        });
        const globalActions = document.querySelector('.desktop-settings-global-actions');
        if (globalActions) globalActions.hidden = true;
        const heading = document.querySelector('[data-settings-heading]');
        const note = document.querySelector('[data-settings-heading-note]');
        const copy = settingsHeadingCopy(next);
        if (heading) heading.textContent = copy[0];
        if (note) note.textContent = copy[1];
        if (next === 'workflow' || next === 'compendium-agent' || connectionsPage) fillSettingsProfileSelects();
        const focused = document.querySelector(`[data-settings-section="${connectionsPage ? 'provider' : next}"]`);
        if (changed && focused && typeof focused.scrollIntoView === 'function') {
            focused.scrollIntoView({ block: 'start' });
        }
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
        const themeLabels = (window.DraftHarborSettingsSchema && window.DraftHarborSettingsSchema.THEME_LABELS) || {
            'morandi-ink': '墨灰书房',
            'mist-library': '雾光书库',
            'ash-rose': '灰玫瑰工作室',
            'night-paper': '夜纸护眼',
            'harbor-dusk': '湾暮灯金',
            'xuan-paper': '素宣'
        };
        const summaries = {
            provider: `${provider.mode === 'api' ? '云端' : '本地'} · ${settingsProviderLabel(provider.provider)}`,
            profiles: `${provider.mode === 'api' ? settingsProviderLabel(provider.provider) : '本地'}${profiles.length ? ` · ${profiles.length} 个档案` : ''}`,
            generation: defaults.useProviderDefaults ? '跟随模型默认值' : `${defaults.temperature ?? 0.8} · ${formatNumber(defaults.maxTokens || 8000)} tokens`,
            workflow: (settings.workflowGeneration || {}).providerProfileId && (settings.workflowGeneration || {}).providerProfileId !== 'inherit'
                ? '已选用配置组' : '继承写作默认',
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
                return ['deepseek', 'openai', 'openrouter', 'opencode-zen', 'opencode-go', 'nanogpt', 'openai-compatible', 'custom', 'anthropic', 'google'].indexOf(provider) >= 0;
            },
            isTypedModelProvider: function (provider) {
                return provider === 'custom' || provider === 'openai-compatible';
            },
            providerSetupHint: function () { return ''; }
        };
    }

    function currentModelCatalog(provider) {
        const catalogs = settingsState.modelCatalogs || {};
        if (provider && catalogs[provider]) return catalogs[provider];
        if (settingsState.modelCatalog && (!provider || settingsState.modelCatalog.provider === provider)) {
            return settingsState.modelCatalog;
        }
        return provider ? null : (settingsState.modelCatalog || null);
    }

    function catalogModelsForProvider(provider) {
        const catalog = modelCatalog();
        const hidePrivacy = !!(normalizeDesktopSettings(settingsState.settings || {}).modelCatalogPreferences || {}).hidePrivacyRiskModels;
        return catalog.getProviderModels(provider, {
            catalog: (provider === 'opencode-zen' || provider === 'opencode-go') ? currentModelCatalog(provider) : null,
            hidePrivacyRiskModels: hidePrivacy
        }).filter((item) => item && item.id && item.id !== '__custom__');
    }

    function fillModelCatalogSelect(select, provider, currentValue) {
        if (!select) return 0;
        const catalog = modelCatalog();
        const models = catalogModelsForProvider(provider);
        const current = String(currentValue || '').trim();
        select.replaceChildren();
        const prompt = document.createElement('option');
        prompt.value = '';
        prompt.textContent = models.length ? '从目录选择模型' : '当前服务商无目录，请手填模型名';
        select.appendChild(prompt);
        const groups = { free: '免费已兼容', paid: '付费已兼容', other: '其他已兼容', pending: '协议未接入', offline: '已下线' };
        Object.keys(groups).forEach((key) => {
            const items = models.filter((item) => (catalog.modelGroup ? catalog.modelGroup(item) : 'other') === key);
            if (!items.length) return;
            const group = document.createElement('optgroup');
            group.label = groups[key];
            items.forEach((item) => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = catalog.modelOptionLabel ? catalog.modelOptionLabel(item) : (item.label || item.id);
                const enabled = catalog.isOpencodeProvider && catalog.isOpencodeProvider(provider)
                    ? catalog.isOpencodeGatewayCallable(item)
                    : !(catalog.isModelSelectable && !catalog.isModelSelectable(item));
                if (!enabled) option.disabled = true;
                group.appendChild(option);
            });
            select.appendChild(group);
        });
        const custom = document.createElement('option');
        custom.value = '__custom__';
        custom.textContent = '手填模型 ID';
        select.appendChild(custom);
        const match = models.some((item) => item.id === current);
        select.value = match ? current : (current ? '__custom__' : '');
        if (select.value !== (match ? current : (current ? '__custom__' : ''))) select.value = '';
        return models.length;
    }

    function renderSettingsModelOptions(provider) {
        const elements = settingsElements();
        const models = catalogModelsForProvider(provider);
        if (elements.modelOptions) {
            elements.modelOptions.replaceChildren();
            models.forEach((item) => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = modelCatalog().modelOptionLabel ? modelCatalog().modelOptionLabel(item) : (item.label || item.id);
                elements.modelOptions.appendChild(option);
            });
        }
        fillModelCatalogSelect(elements.modelPick, provider, elements.model ? elements.model.value : '');
        if (elements.model && elements.modelPick) {
            elements.model.hidden = shouldHideModelInput(provider, elements.modelPick);
        }
    }

    function shouldHideModelInput(provider, pick) {
        const catalog = modelCatalog();
        if (catalog.isOpencodeProvider && catalog.isOpencodeProvider(provider)) return false;
        if (catalog.isTypedModelProvider && catalog.isTypedModelProvider(provider)) return false;
        const picked = pick && pick.value;
        return !!(picked && picked !== '__custom__');
    }

    function selectedModelFromPick(pick, input) {
        if (pick && pick.value && pick.value !== '__custom__') return pick.value.trim();
        return input ? String(input.value || '').trim() : '';
    }

    function profileOptionLabel(profile) {
        const name = profile.name || profile.provider || '配置组';
        const provider = settingsProviderLabel(profile.provider);
        const model = profile.model || '默认模型';
        const key = profile.hasApiKey ? '' : ' · 缺少密钥';
        return `${name} · ${provider} · ${model}${key}`;
    }

    function fillSettingsProfileSelects() {
        const elements = settingsElements();
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const profiles = (settings.providerProfiles || []).filter((profile) => modelCatalog().isApiCompatibleProvider(profile.provider));
        if (elements.workflowProfile) {
            const current = elements.workflowProfile.value || (settings.workflowGeneration || {}).providerProfileId || 'inherit';
            elements.workflowProfile.replaceChildren();
            const inherit = document.createElement('option');
            inherit.value = 'inherit';
            inherit.textContent = '继承默认写作连接（全局）';
            elements.workflowProfile.appendChild(inherit);
            profiles.forEach((profile) => {
                const option = document.createElement('option');
                option.value = profile.id;
                option.textContent = profileOptionLabel(profile);
                elements.workflowProfile.appendChild(option);
            });
            elements.workflowProfile.value = current;
            if (!elements.workflowProfile.value) elements.workflowProfile.value = 'inherit';
        }
        if (elements.compendiumAgentProfile) {
            const current = elements.compendiumAgentProfile.value || ((settings.compendiumAgent || {}).providerProfileId || '');
            elements.compendiumAgentProfile.replaceChildren();
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '请选择专用 API 配置组';
            elements.compendiumAgentProfile.appendChild(empty);
            profiles.forEach((profile) => {
                const option = document.createElement('option');
                option.value = profile.id;
                option.textContent = profileOptionLabel(profile);
                elements.compendiumAgentProfile.appendChild(option);
            });
            elements.compendiumAgentProfile.value = current;
            if (!elements.compendiumAgentProfile.value) elements.compendiumAgentProfile.value = '';
        }
    }

    function captureProfileEditorDraft() {
        if (!profileEditState.editingProfile) return;
        const elements = settingsElements();
        profileEditState.editingProfile = Object.assign({}, profileEditState.editingProfile, {
            name: elements.profileName ? elements.profileName.value.trim() : profileEditState.editingProfile.name,
            provider: elements.profileProvider ? elements.profileProvider.value : profileEditState.editingProfile.provider,
            endpoint: elements.profileEndpoint ? elements.profileEndpoint.value.trim() : profileEditState.editingProfile.endpoint,
            model: selectedModelFromPick(elements.profileModelPick, elements.profileModel) || profileEditState.editingProfile.model
        });
    }

    function renderSettingsCatalogStatus() {
        const status = settingsElements().catalogStatus;
        if (!status) return;
        const provider = settingsElements().provider ? settingsElements().provider.value : '';
        const catalog = currentModelCatalog(provider) || currentModelCatalog();
        if (!catalog) {
            status.textContent = '模型目录使用安装包内置清单。';
            return;
        }
        const updated = catalog.fetchedAt ? new Date(catalog.fetchedAt).toLocaleString() : '尚未成功联网';
        const source = catalog.source === 'builtin' ? '内置清单' : '在线目录缓存';
        const diff = catalog.diff || {};
        const parts = [`上次更新：${updated}`, `来源：${source}`];
        if (diff.added || diff.removed || diff.changed) {
            parts.push(`新增 ${diff.added || 0} / 下线 ${diff.removed || 0} / 状态变化 ${diff.changed || 0}`);
        }
        if (catalog.lastError) parts.push(`最近刷新失败：${catalog.lastError}`);
        status.textContent = parts.join(' · ');
    }

    function refreshStaleModelCatalogs() {
        const catalogs = settingsState.modelCatalogs || {};
        ['opencode-zen', 'opencode-go'].forEach((provider) => {
            const catalog = catalogs[provider];
            if (!catalog || !catalog.stale) return;
            fetch('/api/settings/refresh-model-catalog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider })
            }).then((response) => response.json().catch(() => ({}))).then((result) => {
                if (!result || !result.catalog) return;
                settingsState.modelCatalogs = Object.assign({}, settingsState.modelCatalogs || {}, {
                    [provider]: result.catalog
                });
                const current = ((normalizeDesktopSettings(settingsState.settings || {}).providerSettings || {}).provider) || '';
                if (current === provider) {
                    settingsState.modelCatalog = result.catalog;
                    renderSettingsModelOptions(provider);
                    renderSettingsCatalogStatus();
                    if (typeof renderWriterModelControl === 'function') renderWriterModelControl();
                }
            }).catch(() => {});
        });
    }

    async function refreshSettingsModelCatalog() {
        setSettingsStatus('正在更新模型列表...', 'info');
        const provider = (settingsElements().provider && settingsElements().provider.value)
            || ((normalizeDesktopSettings(settingsState.settings || {}).providerSettings || {}).provider)
            || 'opencode-go';
        const response = await fetch('/api/settings/refresh-model-catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: provider === 'opencode-zen' ? 'opencode-zen' : 'opencode-go' })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.catalog) throw new Error(result.error || `HTTP ${response.status}`);
        settingsState.modelCatalog = result.catalog;
        settingsState.modelCatalogs = Object.assign({}, settingsState.modelCatalogs || {}, {
            [result.catalog.provider || provider]: result.catalog
        });
        renderSettingsModelOptions(result.catalog.provider || provider);
        renderSettingsCatalogStatus();
        renderWriterModelControl();
        const catalog = result.catalog;
        const diff = catalog.diff || {};
        setSettingsStatus(catalog.refreshFailed
            ? `模型列表更新失败，已保留上次缓存：${catalog.lastError || '网络错误'}`
            : `模型列表已更新：新增 ${diff.added || 0}，下线 ${diff.removed || 0}，状态变化 ${diff.changed || 0}`, catalog.refreshFailed ? 'error' : 'ok');
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

    function renderSettingsProfiles(options = {}) {
        const elements = settingsElements();
        if (!elements.profilesList) return;
        const settings = normalizeDesktopSettings(settingsState.settings);
        const profiles = settings.providerProfiles || [];
        if (!options.skipDraftCapture && elements.profileEditor && !elements.profileEditor.hidden && profileEditState.editingProfile) {
            captureProfileEditorDraft();
        }
        if (elements.profileEditor && elements.profilesList.contains(elements.profileEditor)) {
            elements.profilesList.after(elements.profileEditor);
        }
        elements.profilesList.replaceChildren();
        const workflowId = ((settings.workflowGeneration || {}).providerProfileId || '');
        const agentId = ((settings.compendiumAgent || {}).providerProfileId || '');
        if (!profiles.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-settings-profile-empty';
            empty.innerHTML = '<strong>还没有独立模型档案</strong><span>可以继续添加 DeepSeek、OpenAI 或其他兼容接口，在写作页手动切换。</span>';
            elements.profilesList.appendChild(empty);
        } else {
            profiles.forEach((profile) => {
                const item = document.createElement('div');
                item.className = 'desktop-settings-profile-item';
                item.dataset.profileId = profile.id || '';
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
                useBadge.textContent = compatible && profile.hasApiKey ? '可被选用' : '暂不可用';
                badges.append(keyBadge, useBadge);
                if (profile.id && profile.id === workflowId) {
                    const used = document.createElement('span');
                    used.dataset.tone = 'ok';
                    used.textContent = '工作流在用';
                    badges.appendChild(used);
                }
                if (profile.id && profile.id === agentId) {
                    const used = document.createElement('span');
                    used.dataset.tone = 'ok';
                    used.textContent = '管家在用';
                    badges.appendChild(used);
                }
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
            fillModelCatalogSelect(elements.profileModelPick, profile.provider || 'deepseek', profile.model || '');
            if (elements.profileModel && elements.profileModelPick) {
                elements.profileModel.hidden = shouldHideModelInput(profile.provider || 'deepseek', elements.profileModelPick);
            }
            if (elements.profileApiKey) {
                elements.profileApiKey.value = '';
                elements.profileApiKey.placeholder = profile.hasApiKey ? '已保存密钥，留空表示保持现有密钥' : 'API Key';
            }
            if (elements.profileDelete) elements.profileDelete.hidden = !profileEditState.editingId;
            const row = profileEditState.editingId
                ? Array.from(elements.profilesList.querySelectorAll('[data-profile-id]')).find((el) => el.dataset.profileId === profileEditState.editingId)
                : null;
            if (row) {
                row.classList.add('is-editing');
                row.after(elements.profileEditor);
            } else {
                elements.profilesList.prepend(elements.profileEditor);
            }
        } else if (elements.profileEditor && elements.profilesList) {
            elements.profilesList.after(elements.profileEditor);
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
        fillModelCatalogSelect(elements.agentModelPick, provider, elements.compendiumAgentApiModel ? elements.compendiumAgentApiModel.value : '');
        if (elements.compendiumAgentApiModel && elements.agentModelPick) {
            elements.compendiumAgentApiModel.hidden = shouldHideModelInput(provider, elements.agentModelPick);
        }
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
        const model = selectedModelFromPick(elements.agentModelPick, elements.compendiumAgentApiModel);
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
        renderSettingsProfiles({ skipDraftCapture: true });
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
            model: selectedModelFromPick(elements.profileModelPick, elements.profileModel),
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
        fillSettingsProfileSelects();
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
                body: JSON.stringify({ profileId, live: true })
            });
            const result = await response.json().catch(() => ({}));
            const detail = result.result || result;
            profileTestState[profileId] = {
                running: false,
                tone: result.ok ? 'ok' : 'error',
                message: result.ok
                    ? `连接可用${detail.model ? ' · ' + detail.model : ''}${detail.statusCode ? ' · HTTP ' + detail.statusCode : ''}`
                    : ((detail.error || result.error || '测试失败') + (detail.statusCode ? `（HTTP ${detail.statusCode}）` : ''))
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
        const model = selectedModelFromPick(elements.modelPick, elements.model);
        var theme = normalizeDesktopTheme(elements.theme ? elements.theme.value : 'morandi-ink');
        return {
            providerSettings: {
                mode,
                provider: elements.provider ? elements.provider.value : (mode === 'local' ? 'lmstudio' : 'openai-compatible'),
                endpoint,
                model,
                apiKey: elements.apiKey ? elements.apiKey.value.trim() : ''
            },
            modelCatalogPreferences: {
                ...((current.modelCatalogPreferences) || {}),
                hidePrivacyRiskModels: !!(elements.hidePrivacyModels && elements.hidePrivacyModels.checked)
            },
            generationDefaults: {
                temperature: elements.temperature ? Number(elements.temperature.value) : 0.8,
                maxTokens: elements.maxTokens ? Number(elements.maxTokens.value) : 8000,
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

    function refreshSettingsProviderDefaults(options = {}) {
        const elements = settingsElements();
        if (!elements.mode || !elements.provider || !elements.endpoint || !elements.model) return;
        const mode = elements.mode.value;
        const provider = elements.provider.value;
        const catalog = modelCatalog();
        const meta = catalog.getProviderMetadata(provider) || {};
        const endpoint = elements.endpoint.value.trim();
        const endpointLooksLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(endpoint);
        const known = catalog.isKnownDefaultEndpoint && catalog.isKnownDefaultEndpoint(endpoint);
        if (mode === 'api' && meta.endpointReadonly) {
            elements.endpoint.value = meta.defaultBaseUrl || meta.defaultEndpoint || '';
            elements.endpoint.readOnly = true;
        } else {
            elements.endpoint.readOnly = false;
            if (mode === 'api' && (!endpoint || endpointLooksLocal || (options.providerChanged && known))) {
                elements.endpoint.value = meta.defaultEndpoint || '';
            }
        }
        if (options.providerChanged && mode === 'api') {
            const fallback = meta.defaultModelHint || (catalog.defaultTestModel && catalog.defaultTestModel(provider, '')) || '';
            if (fallback) elements.model.value = fallback;
        } else if (mode === 'api' && meta.defaultModelHint && !elements.model.value.trim()) {
            elements.model.value = meta.defaultModelHint;
        }
        renderSettingsModelOptions(provider);
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
            settingsState.modelCatalog = result.modelCatalog || settingsState.modelCatalog || null;
            settingsState.modelCatalogs = result.modelCatalogs || settingsState.modelCatalogs || null;
            settingsState.storageLocations = result.storageLocations || null;
            var appearance = normalizeDesktopSettings(settingsState.settings).appearance || {};
            applyDesktopTheme(appearance.theme || 'morandi-ink');
            setSettingsStatus('设置已读取', 'ok');
            refreshStaleModelCatalogs();
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
            settingsState.modelCatalog = result.modelCatalog || settingsState.modelCatalog || null;
            settingsState.modelCatalogs = result.modelCatalogs || settingsState.modelCatalogs || null;
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
        setSettingsStatus('正在检查写作连接...', 'info');
        setWritingTestStatus('正在向当前表单里的服务商发测试请求…', 'info');
        try {
            const response = await fetch('/api/settings/test-provider', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ live: true, settings: collectSettingsForm() })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            if (!result.ok) {
                const detail = result.result || {};
                const who = detail.provider ? `${detail.provider} ` : '';
                throw new Error((detail.error || result.error || '配置不可用') + (detail.statusCode ? `（${who}HTTP ${detail.statusCode}）` : ''));
            }
            const detail = result.result || {};
            const who = detail.provider ? `（${detail.provider}${detail.model ? ' · ' + detail.model : ''}）` : '';
            const checked = detail.checked === 'configuration'
                ? `配置格式可用${who}`
                : (detail.statusCode ? `连接可用${who} · HTTP ${detail.statusCode}` : `连接可用${who}`);
            setSettingsStatus(checked, 'ok');
            setWritingTestStatus(checked, 'ok');
            const providerSelect = settingsElements().provider;
            if (providerSelect && (providerSelect.value === 'opencode-zen' || providerSelect.value === 'opencode-go')) {
                try { await refreshSettingsModelCatalog(); } catch (_catalogError) { /* keep connection result */ }
            }
        } catch (error) {
            const raw = String(error.message || error);
            const friendly = /api key is required/i.test(raw) ? '请先填写密钥，或先保存写作连接再测试。' : raw;
            const message = `检查失败：${friendly}`;
            setSettingsStatus(message, 'error');
            setWritingTestStatus(message, 'error');
        }
    }

    function bindSettings() {
        const elements = settingsElements();
        if (elements.form) elements.form.addEventListener('submit', saveSettings);
        const saveGeneration = document.querySelector('[data-settings-save-generation]');
        if (saveGeneration) saveGeneration.addEventListener('click', () => saveSettings());
        if (elements.test) elements.test.addEventListener('click', testSettingsProvider);
        if (elements.refresh) elements.refresh.addEventListener('click', loadSettings);
        if (elements.refreshCatalog) {
            elements.refreshCatalog.addEventListener('click', async () => {
                try { await refreshSettingsModelCatalog(); }
                catch (error) { setSettingsStatus(`更新模型列表失败：${error.message || error}`, 'error'); }
            });
        }

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
                const previousProvider = (current.providerSettings || {}).provider;
                const patch = collectSettingsForm();
                settingsState.settings = normalizeDesktopSettings({
                    ...current,
                    ...patch
                });
                renderSettingsForm();
                refreshSettingsProviderDefaults({
                    providerChanged: field === elements.provider && elements.provider.value !== previousProvider
                });
            });
        });
        if (elements.modelPick) {
            elements.modelPick.addEventListener('change', () => {
                if (!elements.model) return;
                if (elements.modelPick.value && elements.modelPick.value !== '__custom__') {
                    elements.model.value = elements.modelPick.value;
                } else if (elements.modelPick.value === '__custom__') {
                    elements.model.focus();
                }
                elements.model.hidden = shouldHideModelInput(elements.provider ? elements.provider.value : '', elements.modelPick);
            });
        }
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
                saveSettings();
            });
        }
        if (elements.themeSave) elements.themeSave.addEventListener('click', saveSettings);
        if (elements.workflowProfile) {
            elements.workflowProfile.addEventListener('change', () => {
                saveSettings();
            });
        }
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
                if (elements.profileModel) {
                    if (!elements.profileModel.value.trim() || modelCatalog().isKnownDefaultModelHint(elements.profileModel.value.trim())) {
                        elements.profileModel.value = defaults.model;
                    }
                    fillModelCatalogSelect(elements.profileModelPick, provider, elements.profileModel.value);
                    elements.profileModel.hidden = shouldHideModelInput(provider, elements.profileModelPick);
                }
            });
        }
        if (elements.profileModelPick) {
            elements.profileModelPick.addEventListener('change', () => {
                if (!elements.profileModel) return;
                if (elements.profileModelPick.value && elements.profileModelPick.value !== '__custom__') {
                    elements.profileModel.value = elements.profileModelPick.value;
                }
                elements.profileModel.hidden = shouldHideModelInput(elements.profileProvider ? elements.profileProvider.value : '', elements.profileModelPick);
                captureProfileEditorDraft();
            });
        }
        if (elements.compendiumAgentProfile) elements.compendiumAgentProfile.addEventListener('change', renderCompendiumAgentApiEditor);
        if (elements.compendiumAgentApiProvider) {
            elements.compendiumAgentApiProvider.addEventListener('change', () => {
                const provider = elements.compendiumAgentApiProvider.value || 'deepseek';
                const defaults = profileDefaults(provider);
                if (elements.compendiumAgentApiEndpoint) elements.compendiumAgentApiEndpoint.value = defaults.endpoint;
                if (elements.compendiumAgentApiModel) {
                    elements.compendiumAgentApiModel.value = provider === 'deepseek' ? 'deepseek-v4-flash' : defaults.model;
                    fillModelCatalogSelect(elements.agentModelPick, provider, elements.compendiumAgentApiModel.value);
                    elements.compendiumAgentApiModel.hidden = shouldHideModelInput(provider, elements.agentModelPick);
                }
            });
        }
        if (elements.agentModelPick) {
            elements.agentModelPick.addEventListener('change', () => {
                if (!elements.compendiumAgentApiModel) return;
                if (elements.agentModelPick.value && elements.agentModelPick.value !== '__custom__') {
                    elements.compendiumAgentApiModel.value = elements.agentModelPick.value;
                }
                elements.compendiumAgentApiModel.hidden = shouldHideModelInput(elements.compendiumAgentApiProvider ? elements.compendiumAgentApiProvider.value : '', elements.agentModelPick);
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
                saveSettings();
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
