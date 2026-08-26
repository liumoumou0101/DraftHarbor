const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers, createDesktopProtocolHandler } = require('../desktop/local-server');
const settingsService = require('../desktop/services/settings-service');
const generationBridge = require('../desktop/services/generation-bridge-service');

async function readSse(response) {
  const text = await response.text();
  return text.split(/\n/).map((line) => line.trim()).filter((line) => line.startsWith('data:')).map((line) => {
    try { return JSON.parse(line.slice(5).trim()); } catch (error) { return null; }
  }).filter(Boolean);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-gen-bridge-'));
  const originalStub = globalThis.__draftHarborGenerationStub;
  let servers = null;
  const seen = [];

  globalThis.__draftHarborGenerationStub = async function (prompt, onToken, config) {
    seen.push({ prompt, config: { ...config } });
    if (config && config.apiKey && typeof onToken === 'function') {
      onToken('secret-check', { type: 'content' });
    }
    if (typeof onToken === 'function') {
      onToken('hello', { type: 'content' });
      onToken('', { type: 'finish', finishReason: 'stop' });
    }
  };

  try {
    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-zen',
        apiKey: 'zen-secret-key-should-not-leak',
        model: 'deepseek-v4-flash'
      }
    });

    const resolved = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'deepseek-v4-flash',
      apiKey: 'client-forged-key',
      snapshot: { endpoint: 'https://evil.example/v1/chat/completions', apiKey: 'snapshot-key', provider: 'openai' }
    });
    assert.strictEqual(resolved.config.apiKey, 'zen-secret-key-should-not-leak');
    assert.strictEqual(resolved.config.provider, 'opencode-zen');
    assert.strictEqual(resolved.config.endpoint, 'https://opencode.ai/zen/v1/chat/completions');

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'deepseek',
        apiKey: 'ds-secret-must-stay-on-deepseek',
        model: 'deepseek-v4-flash'
      }
    });
    const hijack = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'deepseek-v4-flash',
      snapshot: { provider: 'opencode-zen', endpoint: 'https://opencode.ai/zen/v1/chat/completions' }
    });
    assert.strictEqual(hijack.config.provider, 'deepseek', 'client snapshot must not retarget a disk key to another provider');
    assert.notStrictEqual(hijack.config.endpoint, 'https://opencode.ai/zen/v1/chat/completions');
    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-zen',
        apiKey: 'zen-secret-key-should-not-leak',
        model: 'deepseek-v4-flash'
      }
    });
    assert.strictEqual(require('../src/core/settings/model-catalog').resolveProviderEndpoint('opencode-go'), 'https://opencode.ai/zen/go/v1/chat/completions');
    assert.ok(!JSON.stringify(generationBridge.publicProviderError(new Error('Authorization: Bearer zen-secret-key-should-not-leak'))).includes('zen-secret-key-should-not-leak'));
    const leaked = generationBridge.publicProviderError(Object.assign(new Error('API key zen-secret-key-should-not-leak was rejected'), {
      status: 401,
      providerType: 'auth'
    }));
    assert.ok(!JSON.stringify(leaked).includes('zen-secret-key-should-not-leak'), '401 errors must not echo the API key');
    assert.ok(leaked.message.includes('认证') || leaked.message.includes('权限'));

    const unknown = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'totally-unknown-model-id'
    });
    const allowedUnknown = generationBridge.assertCloudRequestAllowed(unknown, { model: 'totally-unknown-model-id' });
    assert.strictEqual(allowedUnknown.model, 'totally-unknown-model-id', 'OpenCode 应允许手填模型 ID');

    const luna = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'gpt-5.6-luna'
    });
    const allowedLuna = generationBridge.assertCloudRequestAllowed(luna, { model: 'gpt-5.6-luna' });
    assert.strictEqual(allowedLuna.endpoint, 'https://opencode.ai/zen/v1/responses');

    const claude = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'claude-opus-4-6'
    });
    assert.throws(
      () => generationBridge.assertCloudRequestAllowed(claude, { model: 'claude-opus-4-6' }),
      /协议尚未适配/,
      'OpenCode Claude 在 Messages 适配完成前不能调用'
    );

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'anthropic',
        apiKey: 'sk-ant-disk',
        model: 'claude-sonnet-4-6'
      }
    });
    const anthropicResolved = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'claude-sonnet-4-6'
    });
    const allowedAnthropic = generationBridge.assertCloudRequestAllowed(anthropicResolved, { model: 'claude-sonnet-4-6' });
    assert.strictEqual(allowedAnthropic.provider, 'anthropic');
    assert.ok(String(allowedAnthropic.endpoint).includes('/v1/messages'));

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'google',
        apiKey: 'gem-disk',
        model: 'gemini-2.5-flash'
      }
    });
    const googleResolved = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'gemini-2.5-flash'
    });
    const allowedGoogle = generationBridge.assertCloudRequestAllowed(googleResolved, { model: 'gemini-2.5-flash' });
    assert.strictEqual(allowedGoogle.provider, 'google');
    assert.ok(String(allowedGoogle.endpoint).includes('generativelanguage.googleapis.com'));

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'custom',
        endpoint: 'https://gateway.example/v1/chat/completions',
        apiKey: 'custom-disk',
        model: 'vendor-special-model'
      }
    });
    const customResolved = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'vendor-special-model'
    });
    const allowedCustom = generationBridge.assertCloudRequestAllowed(customResolved, { model: 'vendor-special-model' });
    assert.strictEqual(allowedCustom.provider, 'custom');
    assert.strictEqual(allowedCustom.model, 'vendor-special-model');

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'custom',
        endpoint: '',
        apiKey: 'custom-disk',
        model: 'vendor-special-model'
      }
    });
    const missingEndpoint = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'vendor-special-model'
    });
    assert.throws(
      () => generationBridge.assertCloudRequestAllowed(missingEndpoint, { model: 'vendor-special-model' }),
      (error) => error && error.code === 'api_endpoint_required'
    );

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-zen',
        apiKey: 'zen-secret-key-should-not-leak',
        model: 'deepseek-v4-flash'
      }
    });

    const privacy = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'big-pickle'
    });
    assert.throws(
      () => generationBridge.assertCloudRequestAllowed(privacy, { model: 'big-pickle' }),
      (error) => error && error.code === 'privacy_confirmation_required'
    );
    const confirmed = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'big-pickle',
      confirmPrivacyRisk: true
    });
    const allowed = generationBridge.assertCloudRequestAllowed(confirmed, { model: 'big-pickle', confirmPrivacyRisk: true });
    assert.strictEqual(allowed.model, 'big-pickle');

    const stamped = generationBridge.stampTrustedWorkflowPolicy(await settingsService.readSettings(dataRoot), {
      providerProfileId: 'inherit',
      snapshot: { provider: 'opencode-zen', endpoint: 'https://evil.example/v1', apiKey: 'should-not-persist', model: 'deepseek-v4-flash' }
    });
    assert.strictEqual(stamped.snapshot.provider, 'opencode-zen');
    assert.strictEqual(stamped.snapshot.endpoint, '');
    assert.ok(!stamped.snapshot.apiKey);

    const frozenOk = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'deepseek-v4-flash',
      trustedPolicy: { profileId: '', provider: 'opencode-zen', model: 'deepseek-v4-flash' }
    });
    assert.strictEqual(
      generationBridge.assertCloudRequestAllowed(frozenOk, {
        model: 'deepseek-v4-flash',
        trustedPolicy: { provider: 'opencode-zen', model: 'deepseek-v4-flash' }
      }).provider,
      'opencode-zen'
    );

    const rematch = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'deepseek-v4-flash',
      trustedPolicy: { provider: 'deepseek', model: 'deepseek-v4-flash' }
    });
    assert.throws(
      () => generationBridge.assertCloudRequestAllowed(rematch, {
        model: 'deepseek-v4-flash',
        trustedPolicy: { provider: 'deepseek', model: 'deepseek-v4-flash' }
      }),
      (error) => error && error.code === 'workflow_provider_changed'
    );

    const missingProfile = generationBridge.resolveGenerationRequest(await settingsService.readSettings(dataRoot), {
      model: 'deepseek-v4-flash',
      trustedPolicy: { profileId: 'deleted-profile', provider: 'opencode-zen', model: 'deepseek-v4-flash' }
    });
    assert.throws(
      () => generationBridge.assertCloudRequestAllowed(missingProfile, {
        model: 'deepseek-v4-flash',
        trustedPolicy: { profileId: 'deleted-profile', provider: 'opencode-zen' }
      }),
      (error) => error && error.code === 'workflow_profile_missing'
    );

    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
    const settingsBody = await (await fetch(servers.appUrl + '/api/settings')).json();
    assert.strictEqual(settingsBody.runtimeProvider.apiKey, '', 'runtimeProvider must not return the API key');
    assert.ok(!JSON.stringify(settingsBody).includes('zen-secret-key-should-not-leak'), 'settings payload must not contain the test key');

    const streamResponse = await fetch(servers.appUrl + '/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        apiKey: 'renderer-forged-key',
        prompt: { messages: [{ role: 'user', content: 'ping' }] }
      })
    });
    assert.strictEqual(streamResponse.ok, true, 'generation stream should return 200');
    const events = await readSse(streamResponse);
    assert.ok(events.some((event) => event.type === 'content' && event.token === 'hello'));
    assert.ok(events.some((event) => event.type === 'done'));
    assert.strictEqual(seen[0].config.apiKey, 'zen-secret-key-should-not-leak');
    assert.notStrictEqual(seen[0].config.apiKey, 'renderer-forged-key');
    assert.ok(!JSON.stringify(events).includes('zen-secret-key-should-not-leak'));

    const rejected = await fetch(servers.appUrl + '/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'big-pickle',
        prompt: { messages: [{ role: 'user', content: 'private novel' }] }
      })
    });
    const rejectedEvents = await readSse(rejected);
    assert.ok(rejectedEvents.some((event) => event.type === 'error' && event.error && event.error.code === 'privacy_confirmation_required'));

    const unknownRes = await fetch(servers.appUrl + '/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'totally-unknown-model-id',
        prompt: { messages: [{ role: 'user', content: 'should not send' }] }
      })
    });
    const unknownEvents = await readSse(unknownRes);
    assert.ok(!unknownEvents.some((event) => event.type === 'error' && event.error && event.error.code === 'model_unavailable'), 'OpenCode 应允许手填模型 ID');
    assert.ok(unknownEvents.some((event) => event.type === 'done' || event.type === 'token' || event.type === 'content'), 'hand-typed OpenCode models should reach the generator');

    const beforeHijack = seen.length;
    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'deepseek',
        apiKey: 'ds-secret-must-stay-on-deepseek',
        model: 'deepseek-v4-flash',
        endpoint: 'https://api.deepseek.com/chat/completions'
      }
    });
    await fetch(servers.appUrl + '/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        snapshot: { provider: 'opencode-zen', endpoint: 'https://opencode.ai/zen/v1/chat/completions' },
        prompt: { messages: [{ role: 'user', content: 'hijack' }] }
      })
    });
    const hijacked = seen[seen.length - 1];
    assert.ok(seen.length > beforeHijack, 'hijack attempt should still resolve a disk-backed connection');
    assert.strictEqual(hijacked.config.provider, 'deepseek');
    assert.ok(!String(hijacked.config.endpoint || '').includes('opencode.ai'), 'DeepSeek disk key must not be sent to OpenCode');
    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-zen',
        apiKey: 'zen-secret-key-should-not-leak',
        model: 'deepseek-v4-flash'
      }
    });

    const missingPolicy = await fetch(servers.appUrl + '/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'missing-project',
        runId: 'missing-run',
        model: 'deepseek-v4-flash',
        prompt: { messages: [{ role: 'user', content: 'should not send' }] }
      })
    });
    const missingPolicyEvents = await readSse(missingPolicy);
    assert.ok(missingPolicyEvents.some((event) => event.type === 'error' && event.error && event.error.code === 'workflow_policy_missing'), 'explicit runId without a disk policy must fail');

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: 'PROFILE_DISK_KEY',
        model: 'deepseek-chat'
      }
    });
    const rebind = await fetch(servers.appUrl + '/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          providerSettings: {
            mode: 'api',
            provider: 'openai-compatible',
            endpoint: 'https://evil.example/v1/chat/completions',
            apiKey: '',
            model: 'stolen-model'
          }
        }
      })
    });
    assert.strictEqual((await rebind.json()).ok, true);
    assert.strictEqual((await settingsService.readSettings(dataRoot)).providerSettings.apiKey, '');
    const beforeRebindStream = seen.length;
    const reboundStream = await fetch(servers.appUrl + '/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'stolen-model',
        prompt: { messages: [{ role: 'user', content: 'rebind' }] }
      })
    });
    const reboundEvents = await readSse(reboundStream);
    assert.ok(reboundEvents.some((event) => event.type === 'error' && event.error && event.error.code === 'api_key_required'), 'rebinding an endpoint with a blank key must require a new key');
    assert.strictEqual(seen.length, beforeRebindStream, 'old DeepSeek key must not be sent after a provider/endpoint rebind');
    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-zen',
        apiKey: 'zen-secret-key-should-not-leak',
        model: 'deepseek-v4-flash'
      }
    });

    const traverse = await fetch(servers.appUrl + '/api/settings/refresh-model-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: '../../outside' })
    });
    assert.ok(traverse.status >= 400 || (await traverse.json().catch(() => ({}))).ok === false, 'catalog refresh must reject path-like provider ids');

    const handler = await createDesktopProtocolHandler({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      chooseBackupFolder: null,
      chooseProjectSaveFolder: null,
      openPath: null,
      revealPath: null
    });
    const protoRes = await handler(new Request('draftharbor://app/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        prompt: { messages: [{ role: 'user', content: 'protocol' }] }
      })
    }));
    assert.strictEqual(protoRes.status, 200);
    const protoEvents = await readSse(protoRes);
    assert.ok(protoEvents.some((event) => event.type === 'content'));

    const cancelController = new AbortController();
    globalThis.__draftHarborGenerationStub = async function (_prompt, onToken, config) {
      await new Promise((_, reject) => {
        const signal = config.signal;
        if (signal) {
          if (signal.aborted) reject(signal.reason || new Error('aborted'));
          else signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }
        setTimeout(() => onToken && onToken('late', { type: 'content' }), 200);
      });
    };
    const cancelPromise = fetch(servers.appUrl + '/api/generation/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        prompt: { messages: [{ role: 'user', content: 'cancel' }] }
      }),
      signal: cancelController.signal
    });
    setTimeout(() => cancelController.abort(), 20);
    await assert.rejects(cancelPromise, (error) => error && error.name === 'AbortError');

    console.log('generation-bridge tests passed.');
  } finally {
    globalThis.__draftHarborGenerationStub = originalStub;
    if (servers && typeof servers.close === 'function') servers.close();
  }
})().catch((error) => {
  console.error('generation-bridge tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
