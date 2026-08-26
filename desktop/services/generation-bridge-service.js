const ProviderStream = require('../../src/core/generation/provider-stream');
const SettingsSchema = require('../../src/core/settings/settings-schema');
const ModelCatalog = require('../../src/core/settings/model-catalog');

const SENSITIVE_KEY = /api[_-]?key|authorization|token|secret|password/i;
const HTML_MARKUP = /<\/?[a-z][\s\S]*>/i;

function providerError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'ProviderError';
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sanitizeMessage(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (HTML_MARKUP.test(text)) return '';
  if (SENSITIVE_KEY.test(text)) return '';
  return text.slice(0, 240);
}

function classifyHttpStatus(status, retryAfter, extras = {}) {
  const type = String(extras.providerType || extras.type || '').toLowerCase();
  const detail = String(extras.message || extras.detail || '');
  if (type.includes('credit') || /insufficient balance|manage your billing/i.test(detail)) {
    return { code: 'provider_quota', message: 'Zen 按量余额不足。若你买的是 Go 月卡，需要走 Go 接口，不能走现在的 Zen 按量地址。' };
  }
  if (type.includes('freeusagelimit') || type.includes('rate')) {
    return { code: 'provider_rate_limited', message: '免费额度或频率限制已用尽，请稍后再试。' };
  }
  if (type.includes('region')) {
    return { code: 'provider_region', message: '该模型有地区限制，需要在 OpenCode 控制台单独开启。' };
  }
  if (status === 401 || status === 403) {
    return { code: 'provider_auth', message: '认证失败或没有权限，请检查 API Key。' };
  }
  if (status === 402) {
    return { code: 'provider_quota', message: '余额不足或免费额度已用尽。' };
  }
  if (status === 429) {
    const hint = retryAfter ? `请约 ${retryAfter} 秒后重试。` : '请稍后重试。';
    return { code: 'provider_rate_limited', message: `请求过于频繁，${hint}` };
  }
  if (status >= 500) {
    return { code: `provider_http_${status}`, message: `AI Provider 暂时不可用（HTTP ${status}）。` };
  }
  if (status) {
    return { code: `provider_http_${status}`, message: `AI Provider 返回 HTTP ${status}。` };
  }
  return { code: 'provider_error', message: 'AI Provider 请求失败。' };
}

function publicProviderError(error) {
  const status = Number(error && error.status) || 0;
  const classified = status ? classifyHttpStatus(status, error && error.retryAfter, {
    providerType: error && error.providerType,
    message: error && error.message
  }) : null;
  const rawMessage = sanitizeMessage(error && error.message);
  const code = (error && error.code) || (classified && classified.code) || 'provider_error';
  const named = {
    unsupported_provider: '当前服务商尚未适配云端生成。请改用 OpenAI 兼容接口或自定义接口。',
    api_endpoint_required: '请先填写完整接口地址。自定义接口需要 Chat Completions 路径。',
    unsupported_transport: '该模型协议尚未适配，不能发起生成。',
    model_unavailable: '当前模型不可用，请重新选择。',
    model_offline: '当前模型已下线，请重新选择。',
    privacy_confirmation_required: '该模型可能将内容用于改进，请确认后再发送。',
    api_key_required: '请先保存 API Key。',
    workflow_profile_missing: '工作流绑定的模型配置已删除，请重新选择后再生成。',
    workflow_provider_changed: '工作流冻结的 Provider 已变更，已阻止发送以免串用密钥。',
    workflow_policy_missing: '找不到该工作流运行的冻结配置，已停止生成。',
    provider_empty_response: 'AI Provider 没有返回可用正文。',
    stream_first_response_timeout: 'AI Provider 在限定时间内没有返回任何数据。',
    stream_idle_timeout: 'AI Provider 已连续较长时间没有返回新数据。'
  };
  const message = named[code] || (classified && classified.message) || rawMessage || 'AI Provider 请求失败。';
  return {
    name: 'ProviderError',
    code,
    message: sanitizeMessage(message) || 'AI Provider 请求失败。',
    status: status || undefined,
    retryAfter: error && error.retryAfter ? String(error.retryAfter) : undefined
  };
}

function serializeSse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function clientAbortSignal(request) {
  if (request && request.signal) return request.signal;
  if (!request || typeof request.on !== 'function' || typeof AbortController === 'undefined') return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.on('aborted', abort);
  request.on('close', () => {
    if (!request.complete) abort();
  });
  return controller.signal;
}

function pickGenerationFields(payload = {}) {
  return {
    profileId: payload.profileId || '',
    model: payload.model,
    enableThinking: payload.enableThinking,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens,
    useProviderDefaults: payload.useProviderDefaults,
    includeUsage: payload.includeUsage,
    taskKind: payload.taskKind,
    workflowNodeId: payload.workflowNodeId,
    directiveStackMode: payload.directiveStackMode,
    frozenDirectiveStack: payload.frozenDirectiveStack,
    projectDirectiveStack: payload.projectDirectiveStack,
    sessionDirective: payload.sessionDirective,
    globalPrompt: payload.globalPrompt,
    firstResponseTimeoutMs: payload.firstResponseTimeoutMs,
    idleTimeoutMs: payload.idleTimeoutMs,
    confirmPrivacyRisk: !!payload.confirmPrivacyRisk,
    projectId: payload.projectId || '',
    runId: payload.runId || ''
  };
}

function trustedPolicyFromPayload(payload = {}) {
  const trusted = payload.trustedPolicy && typeof payload.trustedPolicy === 'object'
    ? payload.trustedPolicy
    : null;
  if (!trusted) return {};
  return {
    profileId: trusted.profileId || trusted.providerProfileId || '',
    provider: trusted.provider || '',
    model: trusted.model,
    enableThinking: trusted.enableThinking,
    temperature: trusted.temperature,
    maxTokens: trusted.maxTokens,
    useProviderDefaults: trusted.useProviderDefaults,
    globalPrompt: trusted.globalPrompt,
    directiveStack: trusted.directiveStack
  };
}

function findProviderProfile(settings, profileId) {
  const id = String(profileId || '').trim();
  if (!id || id === 'inherit') return null;
  return ((settings && settings.providerProfiles) || []).find((item) => item && item.id === id) || null;
}

function stampTrustedWorkflowPolicy(settingsInput, clientPolicy = {}) {
  const settings = SettingsSchema.normalizeDesktopSettings(settingsInput);
  const policy = clientPolicy && typeof clientPolicy === 'object' ? clientPolicy : {};
  const clientSnapshot = policy.snapshot && typeof policy.snapshot === 'object' ? policy.snapshot : {};
  const profileId = (policy.providerProfileId && policy.providerProfileId !== 'inherit')
    ? String(policy.providerProfileId)
    : (clientSnapshot.profileId || '');
  if (profileId && profileId !== 'inherit' && !findProviderProfile(settings, profileId)) {
    throw providerError('workflow_profile_missing', '工作流绑定的模型配置已删除，请重新选择后再生成。');
  }
  const config = SettingsSchema.providerRuntimeConfig(settings, {
    profileId,
    model: clientSnapshot.model || policy.model || '',
    enableThinking: clientSnapshot.enableThinking,
    temperature: clientSnapshot.temperature,
    maxTokens: clientSnapshot.maxTokens,
    useProviderDefaults: clientSnapshot.useProviderDefaults
  });
  const snapshot = {
      ...clientSnapshot,
      profileId: profileId || '',
      provider: config.provider,
      mode: config.mode,
      model: config.model || clientSnapshot.model || '',
      endpoint: '',
      baseUrl: '',
      organization: '',
      enableThinking: clientSnapshot.enableThinking,
      temperature: clientSnapshot.temperature !== undefined ? clientSnapshot.temperature : config.temperature,
      maxTokens: clientSnapshot.maxTokens !== undefined ? clientSnapshot.maxTokens : config.maxTokens,
      useProviderDefaults: clientSnapshot.useProviderDefaults !== undefined
        ? clientSnapshot.useProviderDefaults
        : config.useProviderDefaults,
      globalPrompt: clientSnapshot.globalPrompt !== undefined ? clientSnapshot.globalPrompt : config.globalPrompt,
      directiveStack: clientSnapshot.directiveStack
  };
  delete snapshot.apiKey;
  return {
    providerProfileId: profileId || 'inherit',
    snapshot
  };
}

async function stampLaunchGenerationPolicy(dataRoot, options = {}) {
  const settingsService = require('./settings-service');
  const settings = await settingsService.readSettings(dataRoot);
  return {
    ...options,
    generationPolicy: stampTrustedWorkflowPolicy(settings, options.generationPolicy || {})
  };
}

function assertTrustedWorkflowBinding(settings, config, payload = {}) {
  if (!payload.trustedPolicy || typeof payload.trustedPolicy !== 'object') return;
  const trusted = trustedPolicyFromPayload(payload);
  if (trusted.profileId && trusted.profileId !== 'inherit' && !findProviderProfile(settings, trusted.profileId)) {
    throw providerError('workflow_profile_missing', '工作流绑定的模型配置已删除，请重新选择后再生成。');
  }
  if (trusted.provider && config.provider && trusted.provider !== config.provider) {
    throw providerError('workflow_provider_changed', '工作流冻结的 Provider 已变更，已阻止发送以免串用密钥。');
  }
}

function resolveGenerationRequest(settingsInput, payload = {}, options = {}) {
  const settings = SettingsSchema.normalizeDesktopSettings(settingsInput);
  const fields = pickGenerationFields(payload);
  if (fields.runId && !(payload.trustedPolicy && typeof payload.trustedPolicy === 'object')) {
    throw providerError('workflow_policy_missing', '找不到该工作流运行的冻结配置，已停止生成。');
  }
  const trusted = trustedPolicyFromPayload(payload);
  const extras = {
    profileId: trusted.profileId || fields.profileId || '',
    model: trusted.model || fields.model,
    enableThinking: trusted.enableThinking !== undefined ? trusted.enableThinking : fields.enableThinking,
    temperature: trusted.temperature !== undefined ? trusted.temperature : fields.temperature,
    maxTokens: trusted.maxTokens !== undefined ? trusted.maxTokens : fields.maxTokens,
    useProviderDefaults: trusted.useProviderDefaults !== undefined ? trusted.useProviderDefaults : fields.useProviderDefaults,
    includeUsage: fields.includeUsage,
    taskKind: fields.taskKind,
    workflowNodeId: fields.workflowNodeId,
    directiveStackMode: fields.directiveStackMode,
    frozenDirectiveStack: fields.frozenDirectiveStack || trusted.directiveStack,
    projectDirectiveStack: fields.projectDirectiveStack,
    sessionDirective: fields.sessionDirective,
    globalPrompt: fields.globalPrompt !== undefined ? fields.globalPrompt : trusted.globalPrompt,
    firstResponseTimeoutMs: fields.firstResponseTimeoutMs,
    idleTimeoutMs: fields.idleTimeoutMs,
    allowTestEndpoint: !!options.allowTestEndpoint
  };
  const config = SettingsSchema.providerRuntimeConfig(settings, extras);
  if (ModelCatalog.isOpencodeProvider(config.provider)) {
    config.endpoint = ModelCatalog.resolveProviderEndpoint(config.provider, '', extras);
    config.baseUrl = config.provider === 'opencode-go' ? ModelCatalog.GO_BASE_URL : ModelCatalog.ZEN_BASE_URL;
  }
  const catalog = payload.catalog || null;
  const entry = ModelCatalog.getProviderModelEntry(config.provider, config.model, { catalog });
  return { settings, config, entry, fields };
}

function assertCloudRequestAllowed(resolved, payload = {}) {
  const { settings, config, entry, fields } = resolved;
  if (config.mode !== 'api') {
    throw providerError('local_generation_not_bridged', '本地模型请继续使用本地生成路径。');
  }
  if (!SettingsSchema.isApiCompatibleProvider(config.provider)) {
    throw providerError('unsupported_provider', '当前服务商尚未适配云端生成。请改用 OpenAI 兼容接口或自定义接口。');
  }
  if (!String(config.endpoint || '').trim()) {
    throw providerError('api_endpoint_required', '请先填写完整接口地址。自定义接口需要 Chat Completions 路径。');
  }
  if (!config.apiKey) throw providerError('api_key_required', '请先保存 API Key。');
  if (ModelCatalog.isOpencodeProvider(config.provider) && !ModelCatalog.isOfficialZenUrl(config.endpoint)) {
    throw providerError('invalid_endpoint', 'OpenCode 只能使用官方地址。');
  }
  if (ModelCatalog.isOpencodeProvider(config.provider)) {
    if (!String(config.model || '').trim()) {
      throw providerError('model_unavailable', '请先填写或选择模型。');
    }
    if (entry && !ModelCatalog.isOpencodeGatewayCallable(entry)) {
      if (entry.availability === 'offline') {
        throw providerError('model_offline', '当前模型已下线，请重新选择或手填其他模型 ID。');
      }
      if (entry.compatibility === 'unsupported-transport') {
        throw providerError('unsupported_transport', '该模型协议尚未适配，不能发起生成。');
      }
      throw providerError('model_unavailable', '当前模型不可用，请重新选择或手填其他模型 ID。');
    }
  } else {
    if (!String(config.model || '').trim()) {
      throw providerError('model_unavailable', '请先填写或选择模型。');
    }
    if (entry && !ModelCatalog.isModelSelectable(entry) && entry.availability === 'offline') {
      throw providerError('model_offline', '当前模型已下线，请重新选择。');
    }
    if (entry && entry.compatibility && entry.compatibility !== 'supported' && entry.id !== '__custom__') {
      throw providerError('unsupported_transport', '该模型协议尚未适配，不能发起生成。');
    }
  }
  if (entry && ModelCatalog.requiresPrivacyConfirmation(entry)) {
    const acknowledged = ((settings.modelCatalogPreferences || {}).acknowledgedPrivacyModels || []);
    if (!acknowledged.includes(entry.id) && !fields.confirmPrivacyRisk && !payload.confirmPrivacyRisk) {
      throw providerError('privacy_confirmation_required', '该模型可能将内容用于改进，请确认后再发送。');
    }
  }
  assertTrustedWorkflowBinding(settings, config, payload);
  if (payload.apiKey || (payload.snapshot && payload.snapshot.apiKey)) {
    // Ignore client-supplied secrets; never copy them onto the resolved config.
  }
  return config;
}

async function streamResolvedGeneration(resolved, payload, onToken, signal) {
  const config = assertCloudRequestAllowed(resolved, payload);
  const prompt = payload.prompt;
  if (!prompt) throw providerError('invalid_prompt', '生成请求缺少 Prompt。');
  await ProviderStream.streamGeneration(prompt, onToken, { ...config, signal });
}

function writeSseHeaders(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });
}

async function writeGenerationSse(response, settingsInput, payload, request) {
  const abortSignal = clientAbortSignal(request);
  writeSseHeaders(response);
  const writeEvent = (event) => {
    if (response.writableEnded) return;
    response.write(serializeSse(event));
  };
  try {
    const resolved = resolveGenerationRequest(settingsInput, payload);
    await streamResolvedGeneration(resolved, payload, (token, meta) => {
      const type = meta && meta.type ? meta.type : 'content';
      writeEvent({ type, token: token || '', meta: meta || { type } });
    }, abortSignal);
    writeEvent({ type: 'done' });
    if (!response.writableEnded) response.end();
  } catch (error) {
    if (error && (error.name === 'AbortError' || (abortSignal && abortSignal.aborted))) {
      writeEvent({ type: 'error', error: { name: 'AbortError', code: 'aborted', message: '生成已取消' } });
    } else {
      writeEvent({ type: 'error', error: publicProviderError(error) });
    }
    if (!response.writableEnded) response.end();
  }
}

function createFetchStreamResponse(settingsInput, payload, signal) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const writeEvent = (event) => {
        controller.enqueue(encoder.encode(serializeSse(event)));
      };
      try {
        const resolved = resolveGenerationRequest(settingsInput, payload);
        await streamResolvedGeneration(resolved, payload, (token, meta) => {
          const type = meta && meta.type ? meta.type : 'content';
          writeEvent({ type, token: token || '', meta: meta || { type } });
        }, signal);
        writeEvent({ type: 'done' });
        controller.close();
      } catch (error) {
        if (error && (error.name === 'AbortError' || (signal && signal.aborted))) {
          writeEvent({ type: 'error', error: { name: 'AbortError', code: 'aborted', message: '生成已取消' } });
        } else {
          writeEvent({ type: 'error', error: publicProviderError(error) });
        }
        controller.close();
      }
    },
    cancel() {}
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

module.exports = {
  publicProviderError,
  classifyHttpStatus,
  resolveGenerationRequest,
  assertCloudRequestAllowed,
  stampTrustedWorkflowPolicy,
  stampLaunchGenerationPolicy,
  streamResolvedGeneration,
  writeGenerationSse,
  createFetchStreamResponse
};
