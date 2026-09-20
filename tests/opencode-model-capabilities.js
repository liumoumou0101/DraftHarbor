const assert = require('node:assert/strict');
const { test } = require('node:test');
const Catalog = require('../src/core/settings/model-catalog');

test('MiniMax and Qwen use callable Messages endpoints with gateway identity and Messages authentication', () => {
  for (const provider of ['opencode-go', 'opencode-zen']) {
    for (const model of ['minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'qwen3.6-plus', 'qwen3.8-flash']) {
      assert.equal(Catalog.getModelTransport(provider, model), 'anthropic-messages', model);
      const endpoint = provider === 'opencode-go' ? 'https://opencode.ai/zen/go/v1/messages' : 'https://opencode.ai/zen/v1/messages';
      assert.equal(Catalog.resolveProviderEndpoint(provider, '', { model }), endpoint);
      const headers = Catalog.providerAuthHeaders(provider, 'test-key', 'fixture-session', { model });
      assert.equal(headers['x-api-key'], 'test-key');
      assert.equal(headers['anthropic-version'], '2023-06-01');
      assert.equal(headers.Authorization, undefined);
      assert.match(headers['User-Agent'], /^DraftHarbor\//);
      assert.equal(headers['x-opencode-session'], Catalog.providerAuthHeaders(provider, 'test-key', 'fixture-session')['x-opencode-session']);
      assert.equal(Catalog.isOpencodeGatewayCallable({ id: model, transport: 'anthropic-messages', compatibility: 'supported' }), true);
    }
  }
  assert.equal(Catalog.isOpencodeGatewayCallable(Catalog.getProviderModelEntry('opencode-zen', 'claude-opus-4-6')), false);
  assert.equal(Catalog.providerAuthHeaders('opencode-go', 'test-key', 'fixture-session', { transport: 'responses' }).Authorization, 'Bearer test-key');
});

test('Go capability controls expose audited toggles without offering unsupported GLM and Grok switches', () => {
  for (const model of ['mimo-v2.5', 'mimo-v2.5-pro', 'longcat-2.0', 'hy3', 'hy4-preview', 'deepseek-flash', 'qwen3.8-flash']) {
    assert.equal(Catalog.isThinkingSupported('opencode-go', model), true, model);
    assert.equal(Catalog.thinkingWillRun('opencode-go', model, false), false, model);
  }
  for (const model of ['glm-5.1', 'glm-5.2', 'grok-4.6']) {
    assert.equal(Catalog.isThinkingSupported('opencode-go', model), false, model);
    assert.equal(Catalog.thinkingWillRun('opencode-go', model, false), true, model);
  }
  assert.equal(Catalog.isThinkingSupported('opencode-zen', 'glm-5.2'), true);
  assert.equal(Catalog.getThinkingControl('opencode-go', 'omen-alpha'), 'none');
});

test('thinking fields preserve provider and protocol-specific off contracts', () => {
  assert.equal(typeof Catalog.getThinkingRequestFields, 'function');
  const fixtures = [
    ['opencode-go', 'minimax-m3', true, {}, { thinking: { type: 'adaptive' } }],
    ['opencode-go', 'minimax-m3', false, {}, { thinking: { type: 'disabled' } }],
    ['opencode-go', 'qwen3.8-max', true, {}, { thinking: { type: 'enabled', budget_tokens: 1024 } }],
    ['opencode-go', 'qwen3.8-max', false, {}, { thinking: { type: 'disabled' } }],
    ['opencode-go', 'qwen3.8-max', false, { transport: 'chat-completions' }, { enable_thinking: false }],
    ['opencode-go', 'qwen3.8-max', true, { transport: 'chat-completions' }, { enable_thinking: true }],
    ['opencode-go', 'hy3', false, {}, { reasoning_effort: 'none' }],
    ['opencode-go', 'hy4-preview', true, {}, { reasoning_effort: 'high' }],
    ['opencode-go', 'deepseek-v4-flash', false, {}, { reasoning_effort: 'none' }],
    ['opencode-go', 'deepseek-v4-flash', true, {}, { thinking: { type: 'enabled' } }],
    ['opencode-zen', 'deepseek-v4-flash', false, {}, { thinking: { type: 'disabled' } }],
    ['opencode-go', 'mimo-v2.5-pro', false, {}, { thinking: { type: 'disabled' } }],
    ['opencode-go', 'mimo-v2.5', false, {}, { reasoning_effort: 'none' }],
    ['opencode-go', 'mimo-v2.5', true, {}, { reasoning_effort: 'high' }],
    ['opencode-go', 'deepseek-flash', false, {}, { thinking: { type: 'disabled' } }],
    ['opencode-go', 'glm-5.2', false, {}, {}],
    ['opencode-go', 'grok-4.6', false, {}, {}],
    ['opencode-go', 'gpt-5.6-luna', false, {}, { reasoning: { effort: 'none' } }],
    ['opencode-go', 'minimax-m2.7', false, {}, {}],
    ['opencode-go', 'omen-alpha', true, {}, {}]
  ];
  for (const [provider, model, enabled, options, expected] of fixtures) {
    assert.deepEqual(Catalog.getThinkingRequestFields(provider, model, enabled, options), expected, `${provider}/${model}/${enabled}`);
  }
});

test('catalog connection requests match Responses and Messages wire contracts', () => {
  for (const model of ['gpt-5.6-luna', 'grok-4.6', 'muse-spark-1.3-contributor']) {
    const request = Catalog.buildLiveTestRequest({ provider: 'opencode-go', model, apiKey: 'test-key', enableThinking: false });
    const body = JSON.parse(request.body);
    assert.equal(request.endpoint, 'https://opencode.ai/zen/go/v1/responses');
    assert.deepEqual(body.input, [{ role: 'user', content: 'ping' }]);
    assert.ok(body.max_output_tokens > 0);
    assert.equal(body.messages, undefined);
    assert.equal(body.max_tokens, undefined);
  }
  const request = Catalog.buildLiveTestRequest({ provider: 'opencode-go', model: 'qwen3.8-max', apiKey: 'test-key', enableThinking: true });
  const body = JSON.parse(request.body);
  assert.equal(request.endpoint, 'https://opencode.ai/zen/go/v1/messages');
  assert.equal(request.headers['x-api-key'], 'test-key');
  assert.equal(body.thinking.type, 'enabled');
  assert.ok(body.max_tokens > body.thinking.budget_tokens);
});

test('online audited model additions have metadata and temporary unavailability does not remove models', () => {
  for (const model of ['glm-5.3-flash', 'qwen3.8-flash', 'hy4-preview', 'deepseek-flash', 'deepseek-v4.1-flash', 'muse-spark-1.3-contributor', 'omen-alpha']) {
    assert.ok(Catalog.getProviderModelEntry('opencode-go', model), model);
  }
  for (const model of ['kimi-k2.5', 'glm-5', 'qwen3.5-plus', 'mimo-v2-pro', 'mimo-v2-omni', 'hy3-preview', 'grok-4.5']) {
    const entry = Catalog.getProviderModelEntry('opencode-go', model);
    assert.notEqual(entry.availability, 'offline', model);
    assert.equal(Catalog.isOpencodeGatewayCallable(entry), true, model);
  }
});

test('remote Qwen catalog additions are Messages callable', () => {
  const entry = Catalog.mergeZenCatalog([], ['qwen3.8-flash']).models[0];
  assert.equal(entry.transport, 'anthropic-messages');
  assert.equal(entry.compatibility, 'supported');
  assert.equal(Catalog.isOpencodeGatewayCallable(entry), true);
});

test('all 37 audited Go IDs preserve their model identity and expected request protocol', () => {
  const groups = [
    [['minimax-m3'], 'anthropic-messages', { thinking: { type: 'disabled' } }, { thinking: { type: 'adaptive' } }],
    [['minimax-m2.7', 'minimax-m2.5'], 'anthropic-messages', {}, {}],
    [['qwen3.7-max', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus'], 'anthropic-messages', { thinking: { type: 'disabled' } }, { thinking: { type: 'enabled', budget_tokens: 1024 } }],
    [['kimi-k3', 'kimi-k2.7-code', 'glm-5.2', 'glm-5.3-flash', 'glm-5.3', 'glm-5.1', 'mimo-v2-pro', 'mimo-v2-omni', 'omen-alpha'], 'chat-completions', {}, {}],
    [['kimi-k2.6', 'longcat-2.0', 'kimi-k2.5', 'glm-5', 'deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4.1-flash', 'deepseek-v4-flash-vision-exp', 'mimo-v2.5-pro'], 'chat-completions', { thinking: { type: 'disabled' } }, { thinking: { type: 'enabled' } }],
    [['deepseek-v4-flash'], 'chat-completions', { reasoning_effort: 'none' }, { thinking: { type: 'enabled' } }],
    [['hy4-preview', 'hy3', 'hy3-preview', 'mimo-v2.5'], 'chat-completions', { reasoning_effort: 'none' }, { reasoning_effort: 'high' }],
    [['gpt-5.6-luna'], 'responses', { reasoning: { effort: 'none' } }, {}],
    [['grok-4.5', 'grok-4.6', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'], 'responses', {}, {}]
  ];
  let count = 0;
  for (const [models, transport, offFields, onFields] of groups) {
    for (const model of models) {
      count += 1;
      assert.equal(Catalog.getModelTransport('opencode-go', model), transport, model);
      assert.deepEqual(Catalog.getThinkingRequestFields('opencode-go', model, false), offFields, model);
      assert.deepEqual(Catalog.getThinkingRequestFields('opencode-go', model, true), onFields, model);
      assert.equal(JSON.parse(Catalog.buildLiveTestRequest({ provider: 'opencode-go', model }).body).model, model);
    }
  }
  assert.equal(count, 37);
});

test('direct providers keep native authentication and transport, without Go-only reasoning overrides', () => {
  assert.equal(Catalog.getModelTransport('custom', 'minimax-m3'), 'chat-completions');
  assert.equal(Catalog.getModelTransport('anthropic', 'claude-sonnet-4-6'), 'anthropic-messages');
  assert.equal(Catalog.getModelTransport('deepseek', 'deepseek-v4-flash'), 'chat-completions');
  assert.deepEqual(Catalog.getThinkingRequestFields('deepseek', 'deepseek-v4-flash', false), { thinking: { type: 'disabled' } });
  assert.deepEqual(Catalog.getThinkingRequestFields('custom', 'glm-5.2', false), { thinking: { type: 'disabled' } });
  for (const provider of ['opencode-zen', 'custom']) {
    assert.deepEqual(Catalog.getThinkingRequestFields(provider, 'mimo-v2.5', false), { thinking: { type: 'disabled' } });
    assert.deepEqual(Catalog.getThinkingRequestFields(provider, 'mimo-v2.5', true), { thinking: { type: 'enabled' } });
  }
  assert.deepEqual(Catalog.getThinkingRequestFields('opencode-go', 'mimo-v2.5-pro', false), { thinking: { type: 'disabled' } });
  assert.deepEqual(Catalog.getThinkingRequestFields('opencode-go', 'mimo-v2.5-pro', true), { thinking: { type: 'enabled' } });
  const native = Catalog.providerAuthHeaders('anthropic', 'test-key');
  assert.equal(native['x-api-key'], 'test-key');
  assert.equal(native['x-opencode-session'], undefined);
  const compatible = Catalog.providerAuthHeaders('custom', 'test-key', '', { model: 'minimax-m3' });
  assert.equal(compatible.Authorization, 'Bearer test-key');
  assert.equal(compatible['x-api-key'], undefined);
});
