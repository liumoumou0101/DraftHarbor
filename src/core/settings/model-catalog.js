(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborModelCatalog = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
    var ZEN_CHAT_ENDPOINT = 'https://opencode.ai/zen/v1/chat/completions';
    var ZEN_RESPONSES_ENDPOINT = 'https://opencode.ai/zen/v1/responses';
    var ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';
    var GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
    var GO_CHAT_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
    var GO_RESPONSES_ENDPOINT = 'https://opencode.ai/zen/go/v1/responses';
    var GO_MODELS_URL = 'https://opencode.ai/zen/go/v1/models';
    var ZEN_HOST = 'opencode.ai';

    var CUSTOM_MODEL_OPTION = { id: '__custom__', label: '自定义模型...' };

    var DEEPSEEK_THINKING_DISABLED = Object.freeze(['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']);
    var THINKING_CONTROLS = Object.freeze(['none', 'toggle', 'toggle-adaptive', 'always-on', 'responses-effort']);

    function canonicalModelId(modelId) {
        var id = String(modelId || '').toLowerCase().trim();
        var slash = id.lastIndexOf('/');
        return slash >= 0 ? id.slice(slash + 1) : id;
    }

    function normalizeThinkingControl(value) {
        var raw = String(value || '').trim();
        if (raw === 'deepseek-thinking') return 'toggle';
        if (THINKING_CONTROLS.indexOf(raw) >= 0) return raw;
        return '';
    }

    function inferThinkingControl(modelId) {
        var id = canonicalModelId(modelId);
        if (!id) return 'none';
        if (id === 'minimax-m3' || id.indexOf('minimax-m3-') === 0) return 'toggle-adaptive';
        if (id.indexOf('minimax-m2') === 0) return 'always-on';
        if (id.indexOf('kimi-k2.7-code') === 0) return 'always-on';
        if (id === 'kimi-k3' || id.indexOf('kimi-k3-') === 0) return 'always-on';
        if (id.indexOf('kimi-k2.6') === 0 || id.indexOf('kimi-k2.5') === 0) return 'toggle';
        if (id.indexOf('glm-5.3') === 0) return 'always-on';
        if (id === 'glm-5' || id.indexOf('glm-5.') === 0 || id.indexOf('glm-5-') === 0) return 'toggle';
        if (id.indexOf('deepseek-v4') === 0 || id === 'deepseek-reasoner') return 'toggle';
        if (id.indexOf('longcat-') === 0) return 'always-on';
        if (id === 'hy3' || id.indexOf('hy3-') === 0) return 'always-on';
        if (id.indexOf('qwen3') === 0) return 'always-on';
        if (id.indexOf('gpt-5') === 0) return 'responses-effort';
        if (id.indexOf('muse-') === 0) return 'always-on';
        return 'none';
    }

    function inferOpencodeTransport(modelId) {
        var id = canonicalModelId(modelId);
        if (!id) return 'chat-completions';
        if (id.indexOf('qwen') === 0) return 'chat-completions';
        var guessed = inferTransportFromModelId(id);
        return guessed === 'unknown' ? 'chat-completions' : guessed;
    }

    function isThinkingToggleableControl(control) {
        return control === 'toggle' || control === 'toggle-adaptive' || control === 'responses-effort';
    }

    function thinkingControlForEntry(entry) {
        if (!entry) return 'none';
        var explicit = normalizeThinkingControl(entry.thinkingControl);
        if (explicit) return explicit;
        var inferred = inferThinkingControl(entry.id);
        if (inferred !== 'none') return inferred;
        if (entry.thinkingSupported) return 'toggle';
        return 'none';
    }

    function thinkingRequestPayload(control, enableThinking) {
        if (control === 'toggle') return { type: enableThinking ? 'enabled' : 'disabled' };
        if (control === 'toggle-adaptive') return { type: enableThinking ? 'adaptive' : 'disabled' };
        if (control === 'responses-effort') return enableThinking ? null : { effort: 'none' };
        return null;
    }

    function thinkingWillRun(provider, modelId, enableThinking, options) {
        var control = getThinkingControl(provider, modelId, options);
        if (control === 'always-on') return true;
        if (isThinkingToggleableControl(control)) return !!enableThinking;
        return false;
    }

    function getThinkingControl(provider, modelId, options) {
        var entry = options && options.entry ? options.entry : getProviderModelEntry(provider, modelId, options);
        if (entry) return thinkingControlForEntry(entry);
        var inferred = inferThinkingControl(modelId);
        if (inferred !== 'none') return inferred;
        if (String(provider || '') === 'deepseek') return 'toggle';
        return 'none';
    }

    function isThinkingAlwaysOn(provider, modelId, options) {
        return getThinkingControl(provider, modelId, options) === 'always-on';
    }

    function zenModel(entry) {
        var thinkingControl = thinkingControlForEntry(entry);
        return Object.freeze({
            id: entry.id,
            label: entry.label,
            transport: entry.transport || 'chat-completions',
            availability: entry.availability || 'builtin',
            compatibility: entry.compatibility || 'supported',
            thinkingSupported: isThinkingToggleableControl(thinkingControl),
            thinkingControl: thinkingControl,
            thinkingDisabledParams: Object.freeze(entry.thinkingDisabledParams || (thinkingControl !== 'none' ? DEEPSEEK_THINKING_DISABLED.slice() : [])),
            samplingPolicy: entry.samplingPolicy || 'standard',
            pricingClass: entry.pricingClass || 'unknown',
            privacyClass: entry.privacyClass || 'standard',
            deprecated: !!entry.deprecated,
            contextNote: entry.contextNote || ''
        });
    }

    var ZEN_BUILTIN_MODELS = Object.freeze([
        zenModel({
            id: 'deepseek-v4-pro',
            label: 'DeepSeek V4 Pro',
            thinkingSupported: true,
            pricingClass: 'paid',
            privacyClass: 'standard',
            contextNote: '深度推理'
        }),
        zenModel({
            id: 'deepseek-v4-flash',
            label: 'DeepSeek V4 Flash',
            thinkingSupported: true,
            pricingClass: 'paid',
            privacyClass: 'standard',
            contextNote: '快速响应'
        }),
        zenModel({
            id: 'minimax-m3',
            label: 'MiniMax M3',
            pricingClass: 'paid',
            privacyClass: 'standard'
        }),
        zenModel({
            id: 'minimax-m2.7',
            label: 'MiniMax M2.7',
            pricingClass: 'paid',
            privacyClass: 'standard'
        }),
        zenModel({
            id: 'glm-5.2',
            label: 'GLM 5.2',
            pricingClass: 'paid',
            privacyClass: 'standard'
        }),
        zenModel({
            id: 'glm-5.1',
            label: 'GLM 5.1',
            pricingClass: 'paid',
            privacyClass: 'standard'
        }),
        zenModel({
            id: 'kimi-k3',
            label: 'Kimi K3',
            pricingClass: 'paid',
            privacyClass: 'standard'
        }),
        zenModel({
            id: 'kimi-k2.7-code',
            label: 'Kimi K2.7 Code',
            pricingClass: 'paid',
            privacyClass: 'standard'
        }),
        zenModel({
            id: 'kimi-k2.6',
            label: 'Kimi K2.6',
            pricingClass: 'paid',
            privacyClass: 'standard'
        }),
        zenModel({
            id: 'big-pickle',
            label: 'Big Pickle',
            pricingClass: 'free',
            privacyClass: 'may-train',
            contextNote: '限时免费，可能用于改进模型'
        }),
        zenModel({
            id: 'deepseek-v4-flash-free',
            label: 'DeepSeek V4 Flash Free',
            thinkingSupported: true,
            pricingClass: 'free',
            privacyClass: 'may-train',
            contextNote: '免费额度，可能用于改进模型'
        }),
        zenModel({
            id: 'mimo-v2.5-free',
            label: 'MiMo V2.5 Free',
            pricingClass: 'free',
            privacyClass: 'may-train'
        }),
        zenModel({
            id: 'hy3-free',
            label: 'Hy3 Free',
            pricingClass: 'free',
            privacyClass: 'may-train'
        }),
        zenModel({
            id: 'laguna-s-2.1-free',
            label: 'Laguna S 2.1 Free',
            pricingClass: 'free',
            privacyClass: 'may-train'
        }),
        zenModel({
            id: 'nemotron-3-ultra-free',
            label: 'Nemotron 3 Ultra Free',
            pricingClass: 'free',
            privacyClass: 'may-train'
        }),
        zenModel({
            id: 'nemotron-3.5-lightning-free',
            label: 'Nemotron 3.5 Lightning Free',
            pricingClass: 'free',
            privacyClass: 'may-train'
        }),
        zenModel({ id: 'glm-5', label: 'GLM 5', pricingClass: 'paid' }),
        zenModel({ id: 'minimax-m2.5', label: 'MiniMax M2.5', pricingClass: 'paid' }),
        zenModel({ id: 'kimi-k2.5', label: 'Kimi K2.5', pricingClass: 'paid' }),
        zenModel({ id: 'qwen3.6-plus', label: 'Qwen3.6 Plus', pricingClass: 'paid' }),
        zenModel({ id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', pricingClass: 'paid' }),
        zenModel({ id: 'x-preview-f-free', label: 'Ox Alpha Free', pricingClass: 'free', privacyClass: 'may-train', contextNote: '限时免费' }),
        zenModel({ id: 'gpt-5.4', label: 'GPT 5.4', transport: 'responses', pricingClass: 'paid' }),
        zenModel({ id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna', transport: 'responses', pricingClass: 'paid' }),
        zenModel({ id: 'grok-4.5', label: 'Grok 4.5', transport: 'responses', thinkingControl: 'none', pricingClass: 'paid' }),
        zenModel({ id: 'grok-4.6', label: 'Grok 4.6', transport: 'responses', thinkingControl: 'none', pricingClass: 'paid' }),
        zenModel({ id: 'muse-spark-1.2', label: 'Muse Spark 1.2', transport: 'responses', pricingClass: 'paid' }),
        zenModel({ id: 'muse-spark-1.2-contributor-free', label: 'Muse Spark 1.2 Contributor Free', transport: 'responses', pricingClass: 'free', privacyClass: 'may-train' }),
        zenModel({ id: 'claude-opus-4-6', label: 'Claude Opus 4.6', transport: 'anthropic-messages', compatibility: 'unsupported-transport', pricingClass: 'paid', contextNote: '需 Anthropic Messages 协议' }),
        zenModel({ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', transport: 'anthropic-messages', compatibility: 'unsupported-transport', pricingClass: 'paid', contextNote: '需 Anthropic Messages 协议' }),
        zenModel({ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', transport: 'anthropic-messages', compatibility: 'unsupported-transport', pricingClass: 'paid', contextNote: '需 Anthropic Messages 协议' }),
        zenModel({ id: 'gemini-3-pro', label: 'Gemini 3 Pro', transport: 'google-generative', compatibility: 'unsupported-transport', pricingClass: 'paid', contextNote: '需 Google 原生协议' }),
        zenModel({ id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', transport: 'google-generative', compatibility: 'unsupported-transport', pricingClass: 'paid', contextNote: '需 Google 原生协议' })
    ]);

    var GO_BUILTIN_MODELS = Object.freeze([
        zenModel({ id: 'glm-5.2', label: 'GLM 5.2', pricingClass: 'paid' }),
        zenModel({ id: 'glm-5.3', label: 'GLM 5.3', pricingClass: 'paid' }),
        zenModel({ id: 'glm-5.1', label: 'GLM 5.1', pricingClass: 'paid' }),
        zenModel({ id: 'glm-5', label: 'GLM 5', pricingClass: 'paid' }),
        zenModel({ id: 'kimi-k3', label: 'Kimi K3', pricingClass: 'paid' }),
        zenModel({ id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', pricingClass: 'paid' }),
        zenModel({ id: 'kimi-k2.6', label: 'Kimi K2.6', pricingClass: 'paid' }),
        zenModel({ id: 'kimi-k2.5', label: 'Kimi K2.5', pricingClass: 'paid' }),
        zenModel({ id: 'minimax-m3', label: 'MiniMax M3', pricingClass: 'paid' }),
        zenModel({ id: 'minimax-m2.7', label: 'MiniMax M2.7', pricingClass: 'paid' }),
        zenModel({ id: 'minimax-m2.5', label: 'MiniMax M2.5', pricingClass: 'paid' }),
        zenModel({ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', thinkingSupported: true, pricingClass: 'paid', contextNote: 'Go 上可能需在控制台开启中国区托管' }),
        zenModel({ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', thinkingSupported: true, pricingClass: 'paid', contextNote: 'Go 上可能需在控制台开启中国区托管' }),
        zenModel({ id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Flash Vision Exp', thinkingSupported: true, pricingClass: 'paid' }),
        zenModel({ id: 'longcat-2.0', label: 'LongCat 2.0', pricingClass: 'paid' }),
        zenModel({ id: 'qwen3.8-max', label: 'Qwen3.8 Max', pricingClass: 'paid' }),
        zenModel({ id: 'qwen3.7-max', label: 'Qwen3.7 Max', pricingClass: 'paid' }),
        zenModel({ id: 'qwen3.7-plus', label: 'Qwen3.7 Plus', pricingClass: 'paid' }),
        zenModel({ id: 'qwen3.6-plus', label: 'Qwen3.6 Plus', pricingClass: 'paid' }),
        zenModel({ id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', pricingClass: 'paid' }),
        zenModel({ id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', pricingClass: 'paid' }),
        zenModel({ id: 'mimo-v2.5', label: 'MiMo V2.5', pricingClass: 'paid' }),
        zenModel({ id: 'mimo-v2-pro', label: 'MiMo V2 Pro', pricingClass: 'paid' }),
        zenModel({ id: 'mimo-v2-omni', label: 'MiMo V2 Omni', pricingClass: 'paid' }),
        zenModel({ id: 'hy3', label: 'Hy3', pricingClass: 'paid' }),
        zenModel({ id: 'hy3-preview', label: 'Hy3 Preview', pricingClass: 'paid' }),
        zenModel({ id: 'ox-alpha-free', label: 'Ox Alpha Free', pricingClass: 'free', privacyClass: 'may-train', contextNote: '限时免费' }),
        zenModel({ id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna', transport: 'responses', pricingClass: 'paid' }),
        zenModel({ id: 'grok-4.6', label: 'Grok 4.6', transport: 'responses', thinkingControl: 'none', pricingClass: 'paid' }),
        zenModel({ id: 'grok-4.5', label: 'Grok 4.5', transport: 'responses', thinkingControl: 'none', pricingClass: 'paid' }),
        zenModel({ id: 'muse-spark-1.2-contributor', label: 'Muse Spark 1.2 Contributor', transport: 'responses', privacyClass: 'may-train', pricingClass: 'paid', contextNote: '仅限部分地区' })
    ]);

    var PROVIDER_MODELS = Object.freeze({
        deepseek: Object.freeze([
            zenModel({ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', thinkingSupported: true, pricingClass: 'paid', contextNote: '1M 上下文，深度推理' }),
            zenModel({ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', thinkingSupported: true, pricingClass: 'paid', contextNote: '1M 上下文，快速响应' })
        ]),
        openai: Object.freeze([
            { id: 'gpt-4o', label: 'GPT-4o', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false }
        ]),
        openrouter: Object.freeze([
            { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false }
        ]),
        nanogpt: Object.freeze([
            { id: 'gpt-4o', label: 'GPT-4o', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false }
        ]),
        'openai-compatible': Object.freeze([
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini (compatible)', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false }
        ]),
        anthropic: Object.freeze([
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', transport: 'anthropic-messages', compatibility: 'supported', thinkingSupported: false },
            { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', transport: 'anthropic-messages', compatibility: 'supported', thinkingSupported: false },
            { id: 'claude-opus-5', label: 'Claude Opus 5', transport: 'anthropic-messages', compatibility: 'supported', thinkingSupported: false },
            { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', transport: 'anthropic-messages', compatibility: 'supported', thinkingSupported: false },
            { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', transport: 'anthropic-messages', compatibility: 'supported', thinkingSupported: false }
        ]),
        google: Object.freeze([
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false },
            { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', transport: 'chat-completions', compatibility: 'supported', thinkingSupported: false }
        ]),
        'opencode-zen': ZEN_BUILTIN_MODELS,
        'opencode-go': GO_BUILTIN_MODELS,
        custom: Object.freeze([])
    });

    var PROVIDER_METADATA = Object.freeze({
        deepseek: { label: 'DeepSeek', defaultEndpoint: 'https://api.deepseek.com/chat/completions', defaultBaseUrl: 'https://api.deepseek.com', defaultModelHint: 'deepseek-v4-pro', modelHint: '模型ID，如 deepseek-v4-pro / deepseek-v4-flash' },
        openai: { label: 'OpenAI', defaultEndpoint: 'https://api.openai.com/v1/chat/completions', defaultBaseUrl: 'https://api.openai.com/v1', defaultModelHint: 'gpt-4o-mini', modelHint: '模型ID，如 gpt-4o / gpt-4o-mini / gpt-4-turbo' },
        openrouter: { label: 'OpenRouter', defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModelHint: '', modelHint: '完整模型ID，如 openai/gpt-4o / anthropic/claude-sonnet-4-20250514' },
        nanogpt: { label: 'NanoGPT', defaultEndpoint: '', defaultBaseUrl: '', defaultModelHint: '', modelHint: '模型ID，由 NanoGPT 服务端决定' },
        'openai-compatible': {
            label: 'OpenAI 兼容接口',
            defaultEndpoint: '',
            defaultBaseUrl: '',
            defaultModelHint: 'gpt-4o-mini',
            modelHint: '按该服务商文档填写模型 ID',
            alwaysTypedModel: true,
            setupHint: '填写完整 Chat Completions 地址，例如 https://your-host/v1/chat/completions。模型名按该服务商文档手填。'
        },
        'opencode-zen': {
            label: 'OpenCode Zen',
            defaultEndpoint: ZEN_CHAT_ENDPOINT,
            defaultBaseUrl: ZEN_BASE_URL,
            defaultModelHint: '',
            modelHint: '选择稿湾已兼容的 Zen Chat Completions 模型',
            endpointReadonly: true,
            catalogPolicy: 'remote-with-cache',
            setupHint: 'OpenCode Zen 使用按量地址 https://opencode.ai/zen/v1，无需填写完整 Endpoint。'
        },
        'opencode-go': {
            label: 'OpenCode Go',
            defaultEndpoint: GO_CHAT_ENDPOINT,
            defaultBaseUrl: GO_BASE_URL,
            defaultModelHint: 'glm-5.2',
            modelHint: '选择 Go 月卡已兼容的 Chat Completions 模型',
            endpointReadonly: true,
            catalogPolicy: 'remote-with-cache',
            setupHint: 'OpenCode Go 使用月卡地址 https://opencode.ai/zen/go/v1，无需填写完整 Endpoint。'
        },
        custom: {
            label: '自定义接口',
            defaultEndpoint: '',
            defaultBaseUrl: '',
            defaultModelHint: '',
            modelHint: '手填模型 ID',
            alwaysTypedModel: true,
            setupHint: '任意 OpenAI 兼容服务。必须填写完整 /chat/completions 地址，并手填模型 ID。'
        },
        lmstudio: { label: 'LM Studio', defaultEndpoint: 'http://localhost:1234', defaultBaseUrl: 'http://localhost:1234', defaultModelHint: '', modelHint: '' },
        ollama: { label: 'Ollama', defaultEndpoint: 'http://localhost:11434', defaultBaseUrl: 'http://localhost:11434', defaultModelHint: '', modelHint: '' },
        anthropic: {
            label: 'Anthropic',
            defaultEndpoint: 'https://api.anthropic.com/v1/messages',
            defaultBaseUrl: 'https://api.anthropic.com',
            defaultModelHint: 'claude-sonnet-4-6',
            modelHint: '模型 ID，如 claude-sonnet-4-6 / claude-opus-5；也可手填最新 ID',
            transport: 'anthropic-messages',
            authStyle: 'anthropic-key',
            setupHint: '直连 Anthropic Messages。默认官方地址已填好，也可手填最新模型 ID。'
        },
        google: {
            label: 'Google Gemini',
            defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            defaultModelHint: 'gemini-2.5-flash',
            modelHint: '模型 ID，如 gemini-2.5-flash / gemini-2.5-pro；也可手填最新 ID',
            setupHint: '走 Google 官方 OpenAI 兼容接口。默认地址已填好，也可手填最新模型 ID。'
        }
    });

    var API_COMPATIBLE_PROVIDERS = Object.freeze([
        'deepseek', 'openai', 'openrouter', 'nanogpt', 'openai-compatible', 'opencode-zen', 'opencode-go', 'custom', 'anthropic', 'google'
    ]);

    var TRANSPORT_LABELS = Object.freeze({
        'chat-completions': 'Chat Completions',
        responses: 'Responses',
        'anthropic-messages': 'Anthropic Messages',
        'google-generative': 'Google 原生',
        unknown: '未知协议'
    });

    function cloneModel(entry) {
        if (!entry) return null;
        var thinkingControl = thinkingControlForEntry(entry);
        return {
            id: entry.id,
            label: entry.label || entry.id,
            transport: entry.transport || 'chat-completions',
            availability: entry.availability || 'builtin',
            compatibility: entry.compatibility || 'supported',
            thinkingSupported: isThinkingToggleableControl(thinkingControl),
            thinkingControl: thinkingControl,
            thinkingDisabledParams: (entry.thinkingDisabledParams && entry.thinkingDisabledParams.length
                ? entry.thinkingDisabledParams
                : (thinkingControl !== 'none' ? DEEPSEEK_THINKING_DISABLED : [])).slice(),
            samplingPolicy: entry.samplingPolicy || 'standard',
            pricingClass: entry.pricingClass || 'unknown',
            privacyClass: entry.privacyClass || 'standard',
            deprecated: !!entry.deprecated,
            contextNote: entry.contextNote || '',
            source: entry.source || 'builtin'
        };
    }

    function getProviderMetadata(provider) {
        return PROVIDER_METADATA[provider] || { label: provider, defaultEndpoint: '', defaultBaseUrl: '', defaultModelHint: '', modelHint: '' };
    }

    function getBuiltinProviderModels(provider) {
        var entries = PROVIDER_MODELS[provider];
        if (!entries) return [];
        return entries.map(cloneModel);
    }

    function getProviderModels(provider, options) {
        var catalog = options && options.catalog;
        var hidePrivacyRisk = !!(options && options.hidePrivacyRiskModels);
        var catalogModels = catalog && Array.isArray(catalog.models)
            ? catalog.models.filter(function (item) { return item && item.id && item.id !== '__custom__'; }).map(cloneModel)
            : [];
        var entries = catalogModels.length ? catalogModels : getBuiltinProviderModels(provider);
        if (hidePrivacyRisk) {
            entries = entries.filter(function (item) { return item.privacyClass !== 'may-train'; });
        }
        return entries.concat([CUSTOM_MODEL_OPTION]);
    }

    function getProviderModelEntry(provider, modelId, options) {
        var id = String(modelId || '');
        if (!id || id === '__custom__') return null;
        var entries = getProviderModels(provider, options);
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].id === id) return cloneModel(entries[i]);
        }
        return null;
    }

    function isThinkingSupported(provider, modelId, options) {
        return isThinkingToggleableControl(getThinkingControl(provider, modelId, options));
    }

    function isModelSelectable(entry, options) {
        if (!entry || entry.id === '__custom__') return false;
        if (entry.availability === 'offline' || entry.deprecated) return false;
        if (options && options.gateway === 'opencode') return isOpencodeGatewayCallable(entry);
        if (entry.compatibility !== 'supported') return false;
        var transport = entry.transport || 'chat-completions';
        return transport === 'chat-completions' || transport === 'anthropic-messages';
    }

    function isOpencodeGatewayCallable(entry) {
        if (!entry || entry.id === '__custom__') return true;
        if (entry.availability === 'offline' || entry.deprecated) return false;
        var transport = entry.transport || inferOpencodeTransport(entry.id);
        return transport === 'chat-completions' || transport === 'responses';
    }

    function modelOptionLabel(entry) {
        if (!entry) return '';
        var badges = [];
        if (entry.pricingClass === 'free') badges.push('免费');
        if (entry.pricingClass === 'paid') badges.push('付费');
        if (entry.privacyClass === 'may-train') badges.push('可能用于改进模型');
        if (entry.compatibility === 'unsupported-transport') badges.push('协议待适配');
        if (entry.compatibility === 'unreviewed') badges.push('待确认');
        if (entry.availability === 'offline') badges.push('已下线');
        var suffix = badges.length ? ' · ' + badges.join(' · ') : '';
        return (entry.label || entry.id) + suffix;
    }

    function modelGroup(entry) {
        if (!entry) return 'other';
        if (entry.availability === 'offline') return 'offline';
        if (!isModelSelectable(entry)) return 'pending';
        if (entry.pricingClass === 'free') return 'free';
        if (entry.pricingClass === 'paid') return 'paid';
        return 'other';
    }

    function isKnownDefaultEndpoint(endpoint) {
        if (!endpoint) return false;
        var trimmed = endpoint.trim();
        if (!trimmed) return false;
        var providers = Object.keys(PROVIDER_METADATA);
        for (var i = 0; i < providers.length; i++) {
            var meta = PROVIDER_METADATA[providers[i]];
            if (meta.defaultEndpoint && meta.defaultEndpoint === trimmed) return true;
            if (meta.defaultBaseUrl && meta.defaultBaseUrl === trimmed) return true;
        }
        return false;
    }

    function isKnownDefaultModelHint(model) {
        if (!model) return false;
        var trimmed = model.trim();
        if (!trimmed) return false;
        var providers = Object.keys(PROVIDER_METADATA);
        for (var i = 0; i < providers.length; i++) {
            var meta = PROVIDER_METADATA[providers[i]];
            if (meta.defaultModelHint && meta.defaultModelHint === trimmed) return true;
        }
        return false;
    }

    function isApiCompatibleProvider(provider) {
        return API_COMPATIBLE_PROVIDERS.indexOf(provider) >= 0;
    }

    function isOpencodeProvider(provider) {
        return provider === 'opencode-zen' || provider === 'opencode-go';
    }

    function getProviderTransport(provider) {
        return getProviderMetadata(provider).transport || 'chat-completions';
    }

    function getModelTransport(provider, modelId, options) {
        var entry = getProviderModelEntry(provider, modelId, options);
        if (entry && entry.transport) return entry.transport;
        if (isOpencodeProvider(provider)) return inferOpencodeTransport(modelId);
        return getProviderTransport(provider);
    }

    function isAnthropicMessagesProvider(provider) {
        return getProviderTransport(provider) === 'anthropic-messages';
    }

    function isTypedModelProvider(provider) {
        return !!getProviderMetadata(provider).alwaysTypedModel;
    }

    function providerSetupHint(provider, mode) {
        if (mode && mode !== 'api') return '';
        return getProviderMetadata(provider).setupHint || '';
    }

    function providerAuthHeaders(provider, apiKey) {
        var headers = { 'Content-Type': 'application/json' };
        var key = String(apiKey || '');
        if (isAnthropicMessagesProvider(provider)) {
            headers['x-api-key'] = key;
            headers['anthropic-version'] = '2023-06-01';
            return headers;
        }
        if (key) headers.Authorization = 'Bearer ' + key;
        return headers;
    }

    function buildLiveTestRequest(config) {
        var source = config && typeof config === 'object' ? config : {};
        var provider = String(source.provider || '');
        var model = defaultTestModel(provider, source.model);
        var body = isAnthropicMessagesProvider(provider)
            ? JSON.stringify({
                model: model,
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
                stream: false
            })
            : JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                stream: false
            });
        return {
            model: model,
            endpoint: resolveProviderEndpoint(provider, source.endpoint, source),
            headers: providerAuthHeaders(provider, source.apiKey),
            body: body
        };
    }

    function isOfficialZenUrl(value) {
        try {
            var parsed = new URL(String(value || ''));
            if (parsed.protocol !== 'https:' || parsed.hostname !== ZEN_HOST) return false;
            var path = parsed.pathname || '';
            return path.indexOf('/zen/v1') === 0 || path.indexOf('/zen/go/v1') === 0;
        } catch (error) {
            return false;
        }
    }

    function resolveOpencodeTransport(provider, options) {
        var source = options && typeof options === 'object' ? options : {};
        var modelId = source.model || source.aiModel || '';
        var entry = modelId ? getProviderModelEntry(provider, modelId, source) : null;
        if (entry && entry.transport) return entry.transport;
        return inferOpencodeTransport(modelId);
    }

    function resolveProviderEndpoint(provider, endpoint, options) {
        var allowTestEndpoint = !!(options && options.allowTestEndpoint);
        if (provider === 'opencode-zen' || provider === 'opencode-go') {
            if (allowTestEndpoint && endpoint) return String(endpoint);
            var transport = resolveOpencodeTransport(provider, options);
            if (transport === 'responses') {
                return provider === 'opencode-go' ? GO_RESPONSES_ENDPOINT : ZEN_RESPONSES_ENDPOINT;
            }
            return provider === 'opencode-go' ? GO_CHAT_ENDPOINT : ZEN_CHAT_ENDPOINT;
        }
        return String(endpoint || getProviderMetadata(provider).defaultEndpoint || '');
    }

    function resolveModelsUrl(provider) {
        if (provider === 'opencode-go') return GO_MODELS_URL;
        if (provider === 'opencode-zen') return ZEN_MODELS_URL;
        return '';
    }

    function defaultTestModel(provider, model) {
        var requested = String(model || '').trim();
        if (requested && requested !== 'model-check') return requested;
        if (provider === 'opencode-go') return 'glm-5.2';
        if (provider === 'opencode-zen') return 'big-pickle';
        var hint = getProviderMetadata(provider).defaultModelHint;
        if (hint) return hint;
        return 'model-check';
    }

    function inferTransportFromModelId(modelId) {
        var id = String(modelId || '').toLowerCase();
        if (!id) return 'unknown';
        if (id.indexOf('claude') >= 0 || id.indexOf('qwen') >= 0) return 'anthropic-messages';
        if (id.indexOf('gemini') >= 0) return 'google-generative';
        if (id.indexOf('gpt-') === 0 || id.indexOf('grok') >= 0 || id.indexOf('muse') >= 0) return 'responses';
        return 'unknown';
    }

    function humanizeModelId(modelId) {
        return String(modelId || '')
            .split(/[/_-]+/)
            .filter(Boolean)
            .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
            .join(' ');
    }

    function mergeZenCatalog(builtinModels, remoteIds, options) {
        var online = Array.isArray(remoteIds) ? remoteIds : null;
        var onlineSet = {};
        var result = [];
        var seen = {};
        var added = 0;
        var removed = 0;
        var changed = 0;
        if (online) {
            online.forEach(function (id) {
                var key = String(id || '').trim();
                if (key) onlineSet[key] = true;
            });
        }
        (builtinModels || []).forEach(function (entry) {
            var item = cloneModel(entry);
            item.source = 'builtin';
            if (online) {
                var wasOnline = item.availability !== 'offline';
                item.availability = onlineSet[item.id] ? 'online' : 'offline';
                if (wasOnline && item.availability === 'offline') removed += 1;
                if (!wasOnline && item.availability === 'online') changed += 1;
            }
            result.push(item);
            seen[item.id] = true;
        });
        if (online) {
            online.forEach(function (rawId) {
                var id = String(rawId || '').trim();
                if (!id || seen[id]) return;
                var transport = inferOpencodeTransport(id);
                result.push(cloneModel({
                    id: id,
                    label: humanizeModelId(id),
                    transport: transport,
                    availability: 'online',
                    compatibility: (transport === 'chat-completions' || transport === 'responses') ? 'supported' : 'unsupported-transport',
                    thinkingControl: inferThinkingControl(id),
                    pricingClass: 'unknown',
                    privacyClass: 'unknown',
                    source: 'remote',
                    contextNote: transport === 'chat-completions'
                        ? '在线目录新增，经 OpenCode Chat Completions 调用'
                        : (transport === 'responses'
                            ? '在线目录新增，经 OpenCode Responses 调用'
                            : '在线目录新增，协议待适配')
                }));
                seen[id] = true;
                added += 1;
            });
        }
        var hidePrivacyRisk = !!(options && options.hidePrivacyRiskModels);
        if (hidePrivacyRisk) {
            result = result.filter(function (item) { return item.privacyClass !== 'may-train'; });
        }
        return {
            models: result,
            diff: { added: added, removed: removed, changed: changed }
        };
    }

    function isFreeModel(entry) {
        return !!(entry && entry.pricingClass === 'free');
    }

    function requiresPrivacyConfirmation(entry) {
        return !!(entry && (entry.privacyClass === 'may-train' || entry.pricingClass === 'free'));
    }

    return {
        ZEN_BASE_URL: ZEN_BASE_URL,
        ZEN_CHAT_ENDPOINT: ZEN_CHAT_ENDPOINT,
        ZEN_RESPONSES_ENDPOINT: ZEN_RESPONSES_ENDPOINT,
        ZEN_MODELS_URL: ZEN_MODELS_URL,
        GO_BASE_URL: GO_BASE_URL,
        GO_CHAT_ENDPOINT: GO_CHAT_ENDPOINT,
        GO_RESPONSES_ENDPOINT: GO_RESPONSES_ENDPOINT,
        GO_MODELS_URL: GO_MODELS_URL,
        ZEN_HOST: ZEN_HOST,
        ZEN_BUILTIN_MODELS: ZEN_BUILTIN_MODELS,
        GO_BUILTIN_MODELS: GO_BUILTIN_MODELS,
        isOpencodeProvider: isOpencodeProvider,
        resolveModelsUrl: resolveModelsUrl,
        defaultTestModel: defaultTestModel,
        PROVIDER_MODELS: PROVIDER_MODELS,
        PROVIDER_METADATA: PROVIDER_METADATA,
        CUSTOM_MODEL_OPTION: CUSTOM_MODEL_OPTION,
        API_COMPATIBLE_PROVIDERS: API_COMPATIBLE_PROVIDERS,
        TRANSPORT_LABELS: TRANSPORT_LABELS,
        getProviderModels: getProviderModels,
        getBuiltinProviderModels: getBuiltinProviderModels,
        getProviderModelEntry: getProviderModelEntry,
        getProviderMetadata: getProviderMetadata,
        THINKING_CONTROLS: THINKING_CONTROLS,
        inferThinkingControl: inferThinkingControl,
        inferOpencodeTransport: inferOpencodeTransport,
        getThinkingControl: getThinkingControl,
        isThinkingAlwaysOn: isThinkingAlwaysOn,
        isThinkingSupported: isThinkingSupported,
        thinkingWillRun: thinkingWillRun,
        thinkingRequestPayload: thinkingRequestPayload,
        isModelSelectable: isModelSelectable,
        isOpencodeGatewayCallable: isOpencodeGatewayCallable,
        modelOptionLabel: modelOptionLabel,
        modelGroup: modelGroup,
        isKnownDefaultEndpoint: isKnownDefaultEndpoint,
        isKnownDefaultModelHint: isKnownDefaultModelHint,
        isApiCompatibleProvider: isApiCompatibleProvider,
        isOfficialZenUrl: isOfficialZenUrl,
        getProviderTransport: getProviderTransport,
        getModelTransport: getModelTransport,
        resolveOpencodeTransport: resolveOpencodeTransport,
        isAnthropicMessagesProvider: isAnthropicMessagesProvider,
        isTypedModelProvider: isTypedModelProvider,
        providerSetupHint: providerSetupHint,
        providerAuthHeaders: providerAuthHeaders,
        buildLiveTestRequest: buildLiveTestRequest,
        resolveProviderEndpoint: resolveProviderEndpoint,
        mergeZenCatalog: mergeZenCatalog,
        inferTransportFromModelId: inferTransportFromModelId,
        isFreeModel: isFreeModel,
        requiresPrivacyConfirmation: requiresPrivacyConfirmation,
        cloneModel: cloneModel
    };
});
