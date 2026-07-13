(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborSettingsSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var CompendiumAgentPolicy = null;
    try {
        if (typeof require === 'function') {
            CompendiumAgentPolicy = require('../knowledge/compendium-agent-policy');
        }
    } catch (e) {
        CompendiumAgentPolicy = (typeof DraftHarborCompendiumAgentPolicy !== 'undefined') ? DraftHarborCompendiumAgentPolicy : null;
    }
    const THEMES = Object.freeze(['morandi-ink', 'mist-library', 'ash-rose']);
    const DEFAULT_THEME = 'morandi-ink';
    const PROVIDER_MODES = Object.freeze(['local', 'api']);
    const PROVIDERS = Object.freeze([
        'lmstudio',
        'ollama',
        'openai',
        'openrouter',
        'anthropic',
        'google',
        'deepseek',
        'nanogpt',
        'openai-compatible',
        'custom'
    ]);
    const PROVIDER_DEFAULT_ENDPOINTS = Object.freeze({
        deepseek: 'https://api.deepseek.com/chat/completions',
        openai: 'https://api.openai.com/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions'
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
        return ['deepseek','openai','openrouter','nanogpt','openai-compatible','custom'].indexOf(provider) >= 0;
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

    function normalizeProviderSettings(input = {}) {
        const mode = PROVIDER_MODES.includes(input.mode || input.aiMode) ? (input.mode || input.aiMode) : 'local';
        const provider = PROVIDERS.includes(input.provider || input.aiProvider) ? (input.provider || input.aiProvider) : (mode === 'local' ? 'lmstudio' : 'openai-compatible');
        const defaultEndpoint = mode === 'local' ? 'http://localhost:8080' : (PROVIDER_DEFAULT_ENDPOINTS[provider] || '');
        const endpointInput = cleanString(input.endpoint || input.aiEndpoint || '');
        const shouldUseProviderDefaultEndpoint = mode === 'api'
            && !!PROVIDER_DEFAULT_ENDPOINTS[provider]
            && (!endpointInput || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(endpointInput));
        const defaultModel = provider === 'deepseek' ? 'deepseek-v4-pro' : '';
        return {
            mode,
            provider,
            apiKey: cleanString(input.apiKey || input.aiApiKey),
            model: cleanString(input.model || input.aiModel || defaultModel),
            endpoint: shouldUseProviderDefaultEndpoint ? defaultEndpoint : cleanString(endpointInput || defaultEndpoint),
            baseUrl: cleanString(input.baseUrl),
            organization: cleanString(input.organization),
            hasApiKey: !!input.hasApiKey || !!(input.apiKey || input.aiApiKey),
            updatedAt: input.updatedAt || ''
        };
    }

    function normalizeGenerationDefaults(input = {}) {
        return {
            temperature: finiteNumber(input.temperature, 0.8, 0, 2),
            maxTokens: Math.round(finiteNumber(input.maxTokens, 2000, 1, 200000)),
            useProviderDefaults: !!input.useProviderDefaults
        };
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
        return {
            id: profileId,
            name: cleanString(input.name || input.label) || provider,
            provider: provider,
            apiKey: cleanString(input.apiKey),
            model: cleanString(input.model),
            endpoint: shouldUseDefault ? defaultEndpoint : cleanString(endpointInput || defaultEndpoint),
            baseUrl: cleanString(input.baseUrl),
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

    function normalizeDesktopSettings(input = {}) {
        const providerInput = input.providerSettings || input.provider || input.ai || input;
        const generationInput = input.generationDefaults || input.generation || input;
        const localInput = input.localModelSettings || input.localModel || input;
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
            return {
                mode: 'api',
                provider: selectedProfile.provider,
                apiKey: selectedProfile.apiKey,
                model: extras.model || selectedProfile.model || provider.model,
                endpoint: selectedProfile.endpoint,
                baseUrl: selectedProfile.baseUrl,
                organization: selectedProfile.organization,
                temperature: defaults.temperature,
                maxTokens: defaults.maxTokens,
                useProviderDefaults: defaults.useProviderDefaults,
                profileId: selectedProfile.id,
                ...extras,
                profileId: selectedProfile.id
            };
        }
        var mode = provider.mode;
        return {
            mode,
            provider: provider.provider,
            apiKey: provider.apiKey,
            model: provider.model || local.model,
            endpoint: mode === 'local' ? (local.endpoint || provider.endpoint) : provider.endpoint,
            baseUrl: provider.baseUrl,
            organization: provider.organization,
            temperature: defaults.temperature,
            maxTokens: defaults.maxTokens,
            useProviderDefaults: defaults.useProviderDefaults,
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

    function providerProfileRuntimeConfigs(settingsInput = {}) {
        var settings = normalizeDesktopSettings(settingsInput);
        var profiles = settings.providerProfiles || [];
        ensureModelCatalog();
        return profiles.filter(function (profile) {
            return isApiCompatibleProvider(profile.provider);
        }).map(function (profile) {
            return {
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
            };
        });
    }

    return {
        THEMES,
        DEFAULT_THEME,
        PROVIDER_MODES,
        PROVIDERS,
        isApiCompatibleProvider,
        getProviderMetadata,
        isKnownDefaultEndpoint,
        isKnownDefaultModelHint,
        providerDefaultEndpoint,
        providerDefaultModel,
        normalizeProviderSettings,
        normalizeProviderProfile,
        normalizeGenerationDefaults,
        normalizeLocalModelSettings,
        normalizeAppearanceSettings,
        normalizeCompendiumAgentSettings,
        normalizeDesktopSettings,
        providerRuntimeConfig,
        publicSettings,
        providerProfileRuntimeConfigs
    };
});
