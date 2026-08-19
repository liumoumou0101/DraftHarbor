(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborSettingsSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var InstructionStack = null;
    try {
        if (typeof require === 'function') {
            InstructionStack = require('../generation/instruction-stack');
        }
    } catch (e) {
        InstructionStack = typeof globalThis !== 'undefined' ? globalThis.DraftHarborInstructionStack : null;
    }
    var CompendiumAgentPolicy = null;
    try {
        if (typeof require === 'function') {
            CompendiumAgentPolicy = require('../knowledge/compendium-agent-policy');
        }
    } catch (e) {
        CompendiumAgentPolicy = (typeof DraftHarborCompendiumAgentPolicy !== 'undefined') ? DraftHarborCompendiumAgentPolicy : null;
    }
    const THEMES = Object.freeze([
        'morandi-ink',
        'mist-library',
        'ash-rose',
        'night-paper',
        'harbor-dusk',
        'xuan-paper'
    ]);
    const LIGHT_THEMES = Object.freeze(['mist-library', 'xuan-paper']);
    const DEFAULT_THEME = 'morandi-ink';
    const THEME_LABELS = Object.freeze({
        'morandi-ink': '墨灰书房',
        'mist-library': '雾光书库',
        'ash-rose': '灰玫瑰工作室',
        'night-paper': '夜纸护眼',
        'harbor-dusk': '湾暮灯金',
        'xuan-paper': '素宣'
    });
    const PROVIDER_MODES = Object.freeze(['local', 'api']);
    const PROVIDERS = Object.freeze([
        'lmstudio',
        'ollama',
        'openai',
        'openrouter',
        'anthropic',
        'google',
        'deepseek',
        'opencode-zen',
        'opencode-go',
        'nanogpt',
        'openai-compatible',
        'custom'
    ]);
    const PROVIDER_DEFAULT_ENDPOINTS = Object.freeze({
        deepseek: 'https://api.deepseek.com/chat/completions',
        openai: 'https://api.openai.com/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        'opencode-zen': 'https://opencode.ai/zen/v1/chat/completions',
        'opencode-go': 'https://opencode.ai/zen/go/v1/chat/completions'
    });
    const PROVIDER_DEFAULT_BASE_URLS = Object.freeze({
        'opencode-zen': 'https://opencode.ai/zen/v1',
        'opencode-go': 'https://opencode.ai/zen/go/v1'
    });
    const PROVIDER_DEFAULT_MODELS = Object.freeze({
        deepseek: 'deepseek-v4-pro',
        openai: 'gpt-4o-mini'
    });
    function getProviderMetadata(provider) {
        ensureModelCatalog();
        if (ModelCatalog && typeof ModelCatalog.getProviderMetadata === 'function') {
            return ModelCatalog.getProviderMetadata(provider);
        }
        return { label: provider, defaultEndpoint: PROVIDER_DEFAULT_ENDPOINTS[provider] || '', defaultModelHint: PROVIDER_DEFAULT_MODELS[provider] || '', modelHint: '' };
    }
    function isKnownDefaultEndpoint(endpoint) {
        ensureModelCatalog();
        if (ModelCatalog && typeof ModelCatalog.isKnownDefaultEndpoint === 'function') {
            return ModelCatalog.isKnownDefaultEndpoint(endpoint);
        }
        if (!endpoint) return false;
        var trimmed = endpoint.trim();
        if (!trimmed) return false;
        var keys = Object.keys(PROVIDER_DEFAULT_ENDPOINTS);
        for (var i = 0; i < keys.length; i++) {
            if (PROVIDER_DEFAULT_ENDPOINTS[keys[i]] === trimmed) return true;
        }
        return false;
    }
    function isKnownDefaultModelHint(model) {
        ensureModelCatalog();
        if (ModelCatalog && typeof ModelCatalog.isKnownDefaultModelHint === 'function') {
            return ModelCatalog.isKnownDefaultModelHint(model);
        }
        if (!model) return false;
        var trimmed = model.trim();
        if (!trimmed) return false;
        var keys = Object.keys(PROVIDER_DEFAULT_MODELS);
        for (var i = 0; i < keys.length; i++) {
            if (PROVIDER_DEFAULT_MODELS[keys[i]] === trimmed) return true;
        }
        return false;
    }
    function providerDefaultEndpoint(provider) {
        return PROVIDER_DEFAULT_ENDPOINTS[provider] || '';
    }
    function providerDefaultBaseUrl(provider) {
        if (ModelCatalog && typeof ModelCatalog.getProviderMetadata === 'function') {
            var meta = ModelCatalog.getProviderMetadata(provider);
            if (meta && meta.defaultBaseUrl) return meta.defaultBaseUrl;
        }
        return PROVIDER_DEFAULT_BASE_URLS[provider] || '';
    }
    function providerDefaultModel(provider) {
        return PROVIDER_DEFAULT_MODELS[provider] || '';
    }
    var ModelCatalog = null;
    try {
        if (typeof require === 'function') {
            ModelCatalog = require('./model-catalog');
        }
    } catch (e) {
        ModelCatalog = (typeof DraftHarborModelCatalog !== 'undefined') ? DraftHarborModelCatalog : null;
    }

    function ensureModelCatalog() {
        if (!ModelCatalog && typeof DraftHarborModelCatalog !== 'undefined') {
            ModelCatalog = DraftHarborModelCatalog;
        }
    }

    function isApiCompatibleProvider(provider) {
        if (ModelCatalog && typeof ModelCatalog.isApiCompatibleProvider === 'function') {
            return ModelCatalog.isApiCompatibleProvider(provider);
        }
        return ['deepseek','openai','openrouter','opencode-zen','opencode-go','nanogpt','openai-compatible','custom'].indexOf(provider) >= 0;
    }

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function finiteNumber(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, number));
    }

    function comparableProviderBinding(input) {
        const normalized = normalizeProviderSettings(input || {});
        var endpoint = String(normalized.endpoint || '').trim();
        if (ModelCatalog && typeof ModelCatalog.resolveProviderEndpoint === 'function'
            && typeof ModelCatalog.isOpencodeProvider === 'function'
            && ModelCatalog.isOpencodeProvider(normalized.provider)) {
            endpoint = ModelCatalog.resolveProviderEndpoint(normalized.provider, endpoint, {});
        }
        return {
            provider: String(normalized.provider || ''),
            endpoint: endpoint.replace(/\/+$/, '').toLowerCase()
        };
    }

    function canRetainStoredApiKey(currentInput, nextInput) {
        const current = comparableProviderBinding(currentInput);
        const next = comparableProviderBinding(nextInput);
        if (!current.provider || !next.provider) return false;
        if (ModelCatalog && typeof ModelCatalog.isOpencodeProvider === 'function'
            && ModelCatalog.isOpencodeProvider(current.provider)
            && ModelCatalog.isOpencodeProvider(next.provider)) {
            return true;
        }
        return current.provider === next.provider && current.endpoint === next.endpoint;
    }

    function normalizeProviderSettings(input = {}) {
        const mode = PROVIDER_MODES.includes(input.mode || input.aiMode) ? (input.mode || input.aiMode) : 'local';
        const provider = PROVIDERS.includes(input.provider || input.aiProvider) ? (input.provider || input.aiProvider) : (mode === 'local' ? 'lmstudio' : 'openai-compatible');
        const defaultEndpoint = mode === 'local' ? 'http://localhost:8080' : (PROVIDER_DEFAULT_ENDPOINTS[provider] || '');
        const endpointInput = cleanString(input.endpoint || input.aiEndpoint || '');
        const shouldUseProviderDefaultEndpoint = mode === 'api'
            && !!PROVIDER_DEFAULT_ENDPOINTS[provider]
            && (!endpointInput || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(endpointInput));
        const defaultModel = provider === 'deepseek' ? 'deepseek-v4-pro' : '';
        const defaultBaseUrl = providerDefaultBaseUrl(provider);
        const isOpencode = provider === 'opencode-zen' || provider === 'opencode-go';
        const endpoint = isOpencode
            ? (PROVIDER_DEFAULT_ENDPOINTS[provider] || defaultEndpoint)
            : (shouldUseProviderDefaultEndpoint ? defaultEndpoint : cleanString(endpointInput || defaultEndpoint));
        return {
            mode,
            provider,
            apiKey: cleanString(input.apiKey || input.aiApiKey),
            model: cleanString(input.model || input.aiModel || defaultModel),
            endpoint,
            baseUrl: isOpencode ? (defaultBaseUrl || cleanString(input.baseUrl)) : cleanString(input.baseUrl),
            organization: cleanString(input.organization),
            hasApiKey: !!input.hasApiKey || !!(input.apiKey || input.aiApiKey),
            updatedAt: input.updatedAt || ''
        };
    }

    function normalizeLengthHint(value) {
        var raw = String(value == null ? '' : value).trim().toLowerCase();
        if (raw === 'brief' || raw === 'short' || raw === 'tight') return 'brief';
        if (raw === 'expanded' || raw === 'long' || raw === 'open') return 'expanded';
        return 'natural';
    }

    const DEFAULT_MAX_TOKENS = 8000;
    const THINKING_OUTPUT_FLOOR = 8000;

    function normalizeGenerationDefaults(input = {}) {
        return {
            temperature: finiteNumber(input.temperature, 0.8, 0, 2),
            maxTokens: Math.round(finiteNumber(input.maxTokens, DEFAULT_MAX_TOKENS, 1, 200000)),
            useProviderDefaults: !!input.useProviderDefaults,
            lengthHint: normalizeLengthHint(input.lengthHint)
        };
    }

    function thinkingOutputQuota(maxTokens, enableThinking) {
        const requested = Math.round(finiteNumber(maxTokens, DEFAULT_MAX_TOKENS, 1, 200000));
        if (!enableThinking || requested >= THINKING_OUTPUT_FLOOR) {
            return { requested: requested, effective: requested, raised: false };
        }
        return { requested: requested, effective: THINKING_OUTPUT_FLOOR, raised: true };
    }

    function thinkingOutputQuotaHint(maxTokens, enableThinking) {
        const quota = thinkingOutputQuota(maxTokens, enableThinking);
        if (!quota.raised) return '';
        return '思考会占用输出额度，当前 ' + quota.requested + ' 偏低，正文可能写到一半被截断。本次将按 ' + quota.effective + ' 发送。';
    }

    function normalizeLocalModelSettings(input = {}) {
        return {
            endpoint: cleanString(input.endpoint || input.aiEndpoint || 'http://localhost:8080'),
            model: cleanString(input.model || input.aiModel),
            autoStart: !!input.autoStart,
            llamaVariant: cleanString(input.llamaVariant || 'cpu')
        };
    }

    function normalizeProviderProfile(input = {}) {
        var profileId = cleanString(input.id || input.profileId);
        if (!profileId) profileId = String(Date.now());
        var provider = PROVIDERS.includes(input.provider) ? input.provider : 'openai-compatible';
        var defaultEndpoint = PROVIDER_DEFAULT_ENDPOINTS[provider] || '';
        var endpointInput = cleanString(input.endpoint || '');
        var shouldUseDefault = !!PROVIDER_DEFAULT_ENDPOINTS[provider]
            && (!endpointInput || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(endpointInput));
        const defaultBaseUrl = providerDefaultBaseUrl(provider);
        const isOpencode = provider === 'opencode-zen' || provider === 'opencode-go';
        const endpoint = isOpencode
            ? (PROVIDER_DEFAULT_ENDPOINTS[provider] || defaultEndpoint)
            : (shouldUseDefault ? defaultEndpoint : cleanString(endpointInput || defaultEndpoint));
        return {
            id: profileId,
            name: cleanString(input.name || input.label) || provider,
            provider: provider,
            apiKey: cleanString(input.apiKey),
            model: cleanString(input.model),
            endpoint,
            baseUrl: isOpencode ? (defaultBaseUrl || cleanString(input.baseUrl)) : cleanString(input.baseUrl),
            organization: cleanString(input.organization),
            hasApiKey: !!input.hasApiKey || !!input.apiKey,
            updatedAt: input.updatedAt || ''
        };
    }

    function normalizeAppearanceSettings(input = {}) {
        const theme = THEMES.includes(input.theme) ? input.theme : DEFAULT_THEME;
        return {
            theme,
            followSystem: !!input.followSystem
        };
    }

    function normalizeCompendiumAgentSettings(input = {}) {
        if (!CompendiumAgentPolicy && typeof DraftHarborCompendiumAgentPolicy !== 'undefined') {
            CompendiumAgentPolicy = DraftHarborCompendiumAgentPolicy;
        }
        if (CompendiumAgentPolicy && typeof CompendiumAgentPolicy.normalizeCompendiumAgentSettings === 'function') {
            return CompendiumAgentPolicy.normalizeCompendiumAgentSettings(input);
        }
        return {
            enabled: false,
            providerProfileId: '',
            model: '',
            cardBodyAccess: 'read-only',
            maxCardsPerRun: 30
        };
    }

    function normalizeGlobalPrompt(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        return {
            enabled: !!source.enabled,
            content: cleanString(source.content || source.prefix || '')
        };
    }

    function normalizeWorkflowGeneration(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        return {
            providerProfileId: cleanString(source.providerProfileId || source.profileId, 'inherit') || 'inherit'
        };
    }

    function normalizeModelCatalogPreferences(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const acknowledged = Array.isArray(source.acknowledgedPrivacyModels)
            ? source.acknowledgedPrivacyModels.map(function (id) { return cleanString(id); }).filter(Boolean)
            : [];
        return {
            hidePrivacyRiskModels: !!source.hidePrivacyRiskModels,
            acknowledgedPrivacyModels: acknowledged
        };
    }

    function normalizeDesktopSettings(input = {}) {
        const providerInput = input.providerSettings || input.provider || input.ai || input;
        const generationInput = input.generationDefaults || input.generation || input;
        const localInput = input.localModelSettings || input.localModel || input;
        const legacyGlobalPrompt = normalizeGlobalPrompt(input.globalPrompt || input.globalPromptPrefix || {});
        const directiveStack = InstructionStack && typeof InstructionStack.normalizeDirectiveStackSettings === 'function'
            ? InstructionStack.normalizeDirectiveStackSettings(input.directiveStack || {}, legacyGlobalPrompt)
            : {
                schemaVersion: 1,
                mode: 'parity',
                userGlobal: {
                    id: 'user_global',
                    title: '用户全局创作指令',
                    enabled: legacyGlobalPrompt.enabled,
                    content: legacyGlobalPrompt.content,
                    scopes: [],
                    source: 'migrated_globalPrompt'
                }
            };
        const globalPrompt = InstructionStack && typeof InstructionStack.legacyGlobalPromptFromUserGlobal === 'function'
            ? InstructionStack.legacyGlobalPromptFromUserGlobal(directiveStack)
            : legacyGlobalPrompt;
        return {
            version: 1,
            projectSaveLocation: cleanString(input.projectSaveLocation),
            backupLocation: cleanString(input.backupLocation),
            providerSettings: normalizeProviderSettings(providerInput),
            providerProfiles: Array.isArray(input.providerProfiles) ? input.providerProfiles.map(normalizeProviderProfile) : [],
            generationDefaults: normalizeGenerationDefaults(generationInput),
            localModelSettings: normalizeLocalModelSettings(localInput),
            appearance: normalizeAppearanceSettings(input.appearance || input.appearanceSettings || {}),
            compendiumAgent: normalizeCompendiumAgentSettings(input.compendiumAgent),
            workflowGeneration: normalizeWorkflowGeneration(input.workflowGeneration),
            modelCatalogPreferences: normalizeModelCatalogPreferences(input.modelCatalogPreferences),
            globalPrompt,
            directiveStack,
            globalStyleGuardRules: Array.isArray(input.globalStyleGuardRules) ? input.globalStyleGuardRules : [],
            updatedAt: input.updatedAt || ''
        };
    }

    function providerRuntimeConfig(settingsInput = {}, extras = {}) {
        var settings = normalizeDesktopSettings(settingsInput);
        var profiles = settings.providerProfiles || [];
        var profileId = extras.profileId;
        var selectedProfile = null;
        if (profileId && profileId !== 'inherit') {
            for (var i = 0; i < profiles.length; i++) {
                if (profiles[i].id === profileId) {
                    selectedProfile = profiles[i];
                    break;
                }
            }
        }
        var provider = settings.providerSettings;
        var defaults = settings.generationDefaults;
        var local = settings.localModelSettings;
        if (selectedProfile) {
            var selectedEndpoint = selectedProfile.endpoint;
            var selectedBaseUrl = selectedProfile.baseUrl;
            if (ModelCatalog && typeof ModelCatalog.isOpencodeProvider === 'function' && ModelCatalog.isOpencodeProvider(selectedProfile.provider)) {
                selectedEndpoint = ModelCatalog.resolveProviderEndpoint(selectedProfile.provider, selectedProfile.endpoint, extras);
                selectedBaseUrl = selectedProfile.provider === 'opencode-go' ? ModelCatalog.GO_BASE_URL : ModelCatalog.ZEN_BASE_URL;
            }
            return {
                mode: 'api',
                provider: selectedProfile.provider,
                apiKey: selectedProfile.apiKey,
                model: extras.model || selectedProfile.model || provider.model,
                endpoint: selectedEndpoint,
                baseUrl: selectedBaseUrl,
                temperature: defaults.temperature,
                maxTokens: defaults.maxTokens,
                useProviderDefaults: defaults.useProviderDefaults,
                globalPrompt: settings.globalPrompt.enabled ? settings.globalPrompt.content : '',
                directiveStack: settings.directiveStack,
                directiveStackMode: settings.directiveStack.mode,
                ...extras,
                profileId: selectedProfile.id
            };
        }
        var mode = provider.mode;
        var resolvedEndpoint = mode === 'local' ? (local.endpoint || provider.endpoint) : provider.endpoint;
        var resolvedBaseUrl = provider.baseUrl;
        if (mode === 'api' && ModelCatalog && typeof ModelCatalog.isOpencodeProvider === 'function' && ModelCatalog.isOpencodeProvider(provider.provider)) {
            resolvedEndpoint = ModelCatalog.resolveProviderEndpoint(provider.provider, provider.endpoint, extras);
            resolvedBaseUrl = provider.provider === 'opencode-go' ? ModelCatalog.GO_BASE_URL : ModelCatalog.ZEN_BASE_URL;
        }
        return {
            mode,
            provider: provider.provider,
            apiKey: provider.apiKey,
            model: provider.model || local.model,
            endpoint: resolvedEndpoint,
            baseUrl: resolvedBaseUrl,
            organization: provider.organization,
            temperature: defaults.temperature,
            maxTokens: defaults.maxTokens,
            useProviderDefaults: defaults.useProviderDefaults,
            globalPrompt: settings.globalPrompt.enabled ? settings.globalPrompt.content : '',
            directiveStack: settings.directiveStack,
            directiveStackMode: settings.directiveStack.mode,
            ...extras
        };
    }

    function publicSettings(settingsInput = {}) {
        var settings = normalizeDesktopSettings(settingsInput);
        return {
            ...settings,
            providerSettings: {
                ...settings.providerSettings,
                hasApiKey: !!settings.providerSettings.apiKey,
                apiKey: ''
            },
            providerProfiles: (settings.providerProfiles || []).map(function (profile) {
                return {
                    ...profile,
                    hasApiKey: !!profile.apiKey,
                    apiKey: ''
                };
            })
        };
    }

    function publicRuntimeConfig(config = {}) {
        var source = config && typeof config === 'object' ? config : {};
        return {
            ...source,
            hasApiKey: !!source.hasApiKey || !!source.apiKey,
            apiKey: ''
        };
    }

    function providerProfileRuntimeConfigs(settingsInput = {}) {
        var settings = normalizeDesktopSettings(settingsInput);
        var profiles = settings.providerProfiles || [];
        ensureModelCatalog();
        return profiles.filter(function (profile) {
            return isApiCompatibleProvider(profile.provider);
        }).map(function (profile) {
            return publicRuntimeConfig({
                id: profile.id,
                name: profile.name,
                provider: profile.provider,
                apiKey: profile.apiKey,
                model: profile.model,
                endpoint: profile.endpoint,
                baseUrl: profile.baseUrl,
                organization: profile.organization,
                hasApiKey: !!profile.apiKey,
                updatedAt: profile.updatedAt
            });
        });
    }

    return {
        THEMES,
        LIGHT_THEMES,
        THEME_LABELS,
        DEFAULT_THEME,
        PROVIDER_MODES,
        PROVIDERS,
        DEFAULT_MAX_TOKENS,
        THINKING_OUTPUT_FLOOR,
        thinkingOutputQuota,
        thinkingOutputQuotaHint,
        isApiCompatibleProvider,
        getProviderMetadata,
        isKnownDefaultEndpoint,
        isKnownDefaultModelHint,
        providerDefaultEndpoint,
        providerDefaultBaseUrl,
        providerDefaultModel,
        normalizeModelCatalogPreferences,
        normalizeProviderSettings,
        comparableProviderBinding,
        canRetainStoredApiKey,
        normalizeProviderProfile,
        normalizeGenerationDefaults,
        normalizeLocalModelSettings,
        normalizeAppearanceSettings,
        normalizeCompendiumAgentSettings,
        normalizeGlobalPrompt,
        normalizeDirectiveStackSettings: InstructionStack && InstructionStack.normalizeDirectiveStackSettings,
        mergeDirectiveStackSettings: InstructionStack && InstructionStack.mergeDirectiveStackSettings,
        normalizeDesktopSettings,
        normalizeWorkflowGeneration,
        providerRuntimeConfig,
        publicRuntimeConfig,
        publicSettings,
        providerProfileRuntimeConfigs
    };
});
