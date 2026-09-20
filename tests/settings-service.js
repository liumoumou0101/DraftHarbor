const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const { startDesktopServers } = require('../desktop/local-server');
const settingsService = require('../desktop/services/settings-service');
const SettingsSchema = require('../src/core/settings/settings-schema');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-settings-test-'));
  let servers = null;
  let providerServer = null;

  try {
    const normalized = SettingsSchema.normalizeDesktopSettings({
      providerSettings: {
        mode: 'api',
        provider: 'openai-compatible',
        endpoint: 'https://example.test/v1/chat/completions',
        apiKey: 'secret',
        model: 'test-model'
      },
      generationDefaults: {
        temperature: 1.1,
        maxTokens: 1234
      }
    });
    assert.strictEqual(normalized.providerSettings.mode, 'api');
    assert.strictEqual(normalized.providerSettings.hasApiKey, true);
    assert.strictEqual(normalized.generationDefaults.maxTokens, 1234);
    assert.strictEqual(SettingsSchema.DEFAULT_MAX_TOKENS, 8000, 'new installs should default to an 8000-token output ceiling');
    assert.strictEqual(SettingsSchema.THINKING_OUTPUT_FLOOR, 8000, 'thinking mode should keep at least 8000 output tokens');
    assert.strictEqual(SettingsSchema.normalizeGenerationDefaults({}).maxTokens, 8000, 'missing maxTokens should fall back to 8000');
    assert.deepStrictEqual(SettingsSchema.thinkingOutputQuota(2000, true), { requested: 2000, effective: 8000, raised: true });
    assert.deepStrictEqual(SettingsSchema.thinkingOutputQuota(8000, true), { requested: 8000, effective: 8000, raised: false });
    assert.ok(SettingsSchema.thinkingOutputQuotaHint(2000, true).includes('8000'));
    assert.strictEqual(SettingsSchema.thinkingOutputQuotaHint(8000, true), '');
    assert.strictEqual(SettingsSchema.thinkingOutputQuotaHint(2000, false), '');
    assert.ok(Array.isArray(normalized.providerProfiles), 'providerProfiles should be an array');
    assert.strictEqual(normalized.providerProfiles.length, 0, 'should default to empty profiles');
    assert.strictEqual(normalized.workflowGeneration.providerProfileId, 'inherit', 'workflow should inherit the default writing connection by default');
    assert.strictEqual(normalized.appearance.theme, 'morandi-ink', 'default desktop theme should be Morandi Ink');
    assert.strictEqual(
      SettingsSchema.normalizeDesktopSettings({ appearance: { theme: 'loud-neon' } }).appearance.theme,
      'morandi-ink',
      'unknown desktop themes should fall back to Morandi Ink'
    );
    assert.strictEqual(
      SettingsSchema.normalizeDesktopSettings({ appearance: { theme: 'harbor-dusk' } }).appearance.theme,
      'harbor-dusk',
      'new desktop themes should be accepted'
    );
    assert.deepStrictEqual(
      [...SettingsSchema.THEMES],
      ['morandi-ink', 'mist-library', 'ash-rose', 'night-paper', 'harbor-dusk', 'xuan-paper'],
      'desktop theme catalog should include night, day, rose, dark paper, harbor, and xuan'
    );

    const saved = await settingsService.writeSettings(dataRoot, normalized);
    assert.strictEqual(saved.providerSettings.model, 'test-model');

    const updated = await settingsService.updateSettings(dataRoot, {
      providerSettings: { model: 'second-model', apiKey: '' },
      generationDefaults: { maxTokens: 777 }
    });
    assert.strictEqual(updated.providerSettings.model, 'second-model');
    assert.strictEqual(updated.providerSettings.apiKey, 'secret', 'blank apiKey should preserve existing secret');
    assert.strictEqual(SettingsSchema.canRetainStoredApiKey(
      { provider: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions' },
      { provider: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions/' }
    ), true);
    assert.strictEqual(SettingsSchema.canRetainStoredApiKey(
      { provider: 'opencode-zen' },
      { provider: 'opencode-go' }
    ), true, 'Zen and Go may share one OpenCode key');
    assert.strictEqual(SettingsSchema.canRetainStoredApiKey(
      { provider: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions' },
      { provider: 'openai-compatible', endpoint: 'https://evil.example/v1/chat/completions' }
    ), false);
    const workflowConfigured = await settingsService.updateSettings(dataRoot, { workflowGeneration: { providerProfileId: 'workflow-profile' } });
    assert.strictEqual(workflowConfigured.workflowGeneration.providerProfileId, 'workflow-profile', 'workflow provider selection should persist separately from the default writing connection');
    assert.strictEqual(updated.generationDefaults.maxTokens, 777);

    const migratedPrompt = await settingsService.updateSettings(dataRoot, {
      globalPrompt: { enabled: true, content: 'MIGRATED-DIRECTIVE' }
    });
    assert.strictEqual(migratedPrompt.directiveStack.userGlobal.content, 'MIGRATED-DIRECTIVE');
    const migratedScopes = [...migratedPrompt.directiveStack.userGlobal.scopes];
    const partialPrompt = await settingsService.updateSettings(dataRoot, {
      globalPrompt: { content: 'UPDATED-DIRECTIVE' }
    });
    assert.strictEqual(partialPrompt.directiveStack.userGlobal.content, 'UPDATED-DIRECTIVE');
    assert.strictEqual(partialPrompt.directiveStack.userGlobal.enabled, true);
    assert.deepStrictEqual(partialPrompt.directiveStack.userGlobal.scopes, migratedScopes, 'legacy partial patch must preserve scopes');
    const scopedPatch = await settingsService.updateSettings(dataRoot, {
      directiveStack: { userGlobal: { enabled: false } }
    });
    assert.strictEqual(scopedPatch.globalPrompt.enabled, false, 'legacy mirror should follow directive stack');
    assert.strictEqual(scopedPatch.globalPrompt.content, 'UPDATED-DIRECTIVE');

    const publicSettings = settingsService.publicSettings(updated);
    assert.strictEqual(publicSettings.providerSettings.apiKey, '');
    assert.strictEqual(publicSettings.providerSettings.hasApiKey, true);

    const check = await settingsService.testProvider(updated, { live: false });
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.checked, 'configuration');

    const protocolSettings = SettingsSchema.normalizeDesktopSettings({
      providerSettings: {
        mode: 'api',
        provider: 'opencode-go',
        apiKey: 'protocol-key',
        model: 'glm-5.2'
      },
      providerProfiles: [{
        id: 'responses-profile',
        name: 'Responses profile',
        provider: 'opencode-go',
        apiKey: 'profile-key',
        model: 'gpt-5.6-luna'
      }]
    });
    const inheritedRuntime = SettingsSchema.providerRuntimeConfig(protocolSettings, { model: undefined });
    assert.strictEqual(inheritedRuntime.model, 'glm-5.2', 'undefined extras.model must not erase the stored model');
    assert.ok(inheritedRuntime.endpoint.endsWith('/chat/completions'), 'the inherited stored model must select its chat endpoint');
    const profiledRuntime = SettingsSchema.providerRuntimeConfig(protocolSettings, { profileId: 'responses-profile', model: undefined });
    assert.strictEqual(profiledRuntime.model, 'gpt-5.6-luna', 'undefined extras.model must not erase a profile model');
    assert.ok(profiledRuntime.endpoint.endsWith('/responses'), 'the effective profile model must select the Responses endpoint');
    const explicitRuntime = SettingsSchema.providerRuntimeConfig(protocolSettings, { profileId: 'responses-profile', model: 'glm-5.2' });
    assert.strictEqual(explicitRuntime.model, 'glm-5.2', 'an explicit model must override the profile model');
    assert.ok(explicitRuntime.endpoint.endsWith('/chat/completions'), 'an explicit model override must also update the endpoint protocol');
    const taskRuntime = SettingsSchema.providerRuntimeConfig(protocolSettings, {
      model: undefined,
      temperature: 0.25,
      maxTokens: 345,
      useProviderDefaults: true,
      globalPrompt: 'task-specific prompt'
    });
    assert.strictEqual(taskRuntime.model, 'glm-5.2');
    assert.strictEqual(taskRuntime.temperature, 0.25, 'defined task temperature must override generation defaults');
    assert.strictEqual(taskRuntime.maxTokens, 345, 'defined task maxTokens must override generation defaults');
    assert.strictEqual(taskRuntime.useProviderDefaults, true, 'defined task provider-default preference must survive');
    assert.strictEqual(taskRuntime.globalPrompt, 'task-specific prompt', 'defined task global prompt must survive');

    assert.strictEqual(typeof settingsService.validateLiveResponse, 'function', 'live response validation should be reusable and directly testable');
    assert.strictEqual(settingsService.validateLiveResponse(JSON.stringify({
      choices: [{ message: { content: 'partial' }, finish_reason: 'content_filter' }]
    }), 'chat-completions').ok, false, 'Chat content_filter must not count as a successful connection test');
    assert.strictEqual(settingsService.validateLiveResponse(JSON.stringify({
      choices: [{ message: { content: 'partial', tool_calls: [{ id: 'call-1' }] }, finish_reason: 'tool_calls' }]
    }), 'chat-completions').ok, false, 'Chat tool_calls must not count as a successful connection test');
    assert.strictEqual(settingsService.validateLiveResponse(JSON.stringify({
      content: [{ type: 'text', text: 'partial' }], stop_reason: 'tool_use'
    }), 'anthropic-messages').ok, false, 'Messages tool_use must not count as a successful connection test');
    assert.strictEqual(settingsService.validateLiveResponse(JSON.stringify({
      content: [{ type: 'text', text: 'partial' }], stop_reason: 'refusal'
    }), 'anthropic-messages').ok, false, 'Messages refusal must not count as a successful connection test');
    assert.strictEqual(settingsService.validateLiveResponse(JSON.stringify({
      content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn'
    }), 'anthropic-messages').ok, true, 'Messages end_turn with visible text should pass');
    assert.strictEqual(settingsService.validateLiveResponse(JSON.stringify({
      status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }]
    }), 'responses').ok, true, 'Responses completed status with visible text should pass');
    const failedResponses = settingsService.validateLiveResponse(JSON.stringify({
      status: 'failed',
      output_text: 'partial',
      error: { message: 'Model is unavailable.', type: 'invalid_request_error', code: 'model_unavailable' }
    }), 'responses');
    assert.strictEqual(failedResponses.ok, false, 'Responses failed status must override partial visible content');
    assert.ok(failedResponses.error.includes('Model is unavailable'), 'HTTP 200 error details should be preserved safely');
    const sensitiveResponsesError = settingsService.validateLiveResponse(JSON.stringify({
      status: 'failed',
      output_text: 'partial',
      error: { message: 'API key local-secret-value rejected', type: 'auth_error' }
    }), 'responses');
    assert.ok(!sensitiveResponsesError.error.includes('local-secret-value'), 'HTTP 200 error details must not expose credentials');

    const providerRequests = [];
    providerServer = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const body = JSON.parse(rawBody || '{}');
        providerRequests.push({ url: request.url, headers: request.headers, body, rawBody });
        response.setHeader('Content-Type', 'application/json');
        if (request.url === '/reason-only') {
          response.end(JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'private reasoning' }, finish_reason: 'stop' }] }));
          return;
        }
        if (request.url === '/truncated') {
          response.end(JSON.stringify({ choices: [{ message: { content: 'O' }, finish_reason: 'length' }] }));
          return;
        }
        if (request.url === '/long-reasoning') {
          const serialized = JSON.stringify({ choices: [{ message: { reasoning_content: 'r'.repeat(4096), content: 'OK' }, finish_reason: 'stop' }] });
          response.write(serialized.slice(0, 3000));
          setImmediate(() => response.end(serialized.slice(3000)));
          return;
        }
        if (request.url === '/unavailable') {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: { message: 'Model is unavailable.', type: 'invalid_request_error', code: 'model_unavailable' } }));
          return;
        }
        if (request.url === '/quota') {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: { message: 'Request rejected.', type: 'invalid_request_error', code: 'insufficient_quota' } }));
          return;
        }
        if (request.url === '/echo-key') {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: { message: 'Request rejected for local-only-key', type: 'invalid_request_error' } }));
          return;
        }
        response.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }));
      });
    });
    await new Promise((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
    const providerPort = providerServer.address().port;
    const localProviderSettings = (pathname) => ({
      providerSettings: {
        mode: 'api',
        provider: 'openai-compatible',
        endpoint: `http://127.0.0.1:${providerPort}${pathname}`,
        apiKey: 'local-only-key',
        model: 'local-probe-model'
      },
      generationDefaults: { maxTokens: 1024, temperature: 0.2, useProviderDefaults: false }
    });
    const liveSuccess = await settingsService.testProvider(localProviderSettings('/success'), { live: true });
    assert.strictEqual(liveSuccess.ok, true, 'a completed response with visible content should pass the live test');
    assert.deepStrictEqual(providerRequests[0].body.messages, [{ role: 'user', content: 'Reply with OK.' }], 'connection tests should use the production request builder with the standard probe prompt');
    assert.strictEqual(providerRequests[0].body.max_tokens, 1024, 'connection tests should use the configured reasonable output budget');
    assert.strictEqual(providerRequests[0].body.stream, false, 'connection tests should request a non-streaming response');
    const unicodeProviderSettings = localProviderSettings('/content-length');
    unicodeProviderSettings.providerSettings.model = '模型-测试';
    const unicodeLength = await settingsService.testProvider(unicodeProviderSettings, { live: true });
    assert.strictEqual(unicodeLength.ok, true);
    const unicodeRequest = providerRequests.find((item) => item.url === '/content-length');
    assert.strictEqual(
      Number(unicodeRequest.headers['content-length']),
      Buffer.byteLength(unicodeRequest.rawBody, 'utf8'),
      'connection tests should send the exact UTF-8 Content-Length'
    );
    assert.strictEqual(unicodeRequest.headers['transfer-encoding'], undefined, 'connection tests should not fall back to chunked request bodies');
    const reasonOnly = await settingsService.testProvider(localProviderSettings('/reason-only'), { live: true });
    assert.strictEqual(reasonOnly.ok, false, 'reasoning without visible content must not pass the live test');
    const truncated = await settingsService.testProvider(localProviderSettings('/truncated'), { live: true });
    assert.strictEqual(truncated.ok, false, 'a truncated response must not pass the live test');
    const longReasoning = await settingsService.testProvider(localProviderSettings('/long-reasoning'), { live: true });
    assert.strictEqual(longReasoning.ok, true, 'visible content after a long reasoning field should still be validated');
    const unavailable = await settingsService.testProvider(localProviderSettings('/unavailable'), { live: true });
    assert.strictEqual(unavailable.ok, false);
    assert.ok(unavailable.error.includes('Model is unavailable'), 'safe upstream 400 details should survive connection testing');
    assert.ok(!JSON.stringify(unavailable).includes('local-only-key'), 'connection test results must not expose the API key');
    const quota = await settingsService.testProvider(localProviderSettings('/quota'), { live: true });
    assert.strictEqual(quota.ok, false);
    assert.ok(quota.error.includes('余额'), 'connection tests should classify quota errors from error.code');
    const echoedKey = await settingsService.testProvider(localProviderSettings('/echo-key'), { live: true });
    assert.ok(!JSON.stringify(echoedKey).includes('local-only-key'), 'connection tests must remove the exact configured key from HTTP error details');

    // Profile tests
    const profile1 = await settingsService.updateProviderProfile(dataRoot, {
      name: 'My DeepSeek',
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: 'ds-secret-1'
    });
    assert.ok(profile1.providerProfiles && profile1.providerProfiles.length >= 1, 'should have at least 1 profile');
    var dsProfile = profile1.providerProfiles.find(function (p) { return p.provider === 'deepseek'; });
    assert.ok(dsProfile, 'should find deepseek profile');
    assert.strictEqual(dsProfile.apiKey, 'ds-secret-1');
    assert.strictEqual(dsProfile.hasApiKey, true);

    var profile2 = await settingsService.updateProviderProfile(dataRoot, {
      name: 'My OpenAI',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'oa-secret-2'
    });
    assert.strictEqual(profile2.providerProfiles.length, 2, 'should have 2 profiles');

    var updatedDs = await settingsService.updateProviderProfile(dataRoot, {
      id: dsProfile.id,
      name: 'My DeepSeek Updated',
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: ''
    });
    var updatedDsProfile = updatedDs.providerProfiles.find(function (p) { return p.id === dsProfile.id; });
    assert.strictEqual(updatedDsProfile.apiKey, 'ds-secret-1', 'blank apiKey should preserve profile secret');
    assert.strictEqual(updatedDsProfile.name, 'My DeepSeek Updated');

    var reboundProfile = await settingsService.updateProviderProfile(dataRoot, {
      id: dsProfile.id,
      name: 'My DeepSeek Updated',
      provider: 'openai-compatible',
      endpoint: 'https://evil.example/v1/chat/completions',
      apiKey: ''
    });
    var reboundDsProfile = reboundProfile.providerProfiles.find(function (p) { return p.id === dsProfile.id; });
    assert.strictEqual(reboundDsProfile.apiKey, '', 'changing profile provider/endpoint must drop the stored key');
    assert.strictEqual(reboundDsProfile.hasApiKey, false);

    var restoredDs = await settingsService.updateProviderProfile(dataRoot, {
      id: dsProfile.id,
      name: 'My DeepSeek Updated',
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: 'ds-secret-1'
    });
    dsProfile = restoredDs.providerProfiles.find(function (p) { return p.id === dsProfile.id; });
    assert.strictEqual(dsProfile.apiKey, 'ds-secret-1');

    var publicAll = settingsService.publicSettings(updatedDs);
    var pubDs = publicAll.providerProfiles.find(function (p) { return p.id === dsProfile.id; });
    assert.strictEqual(pubDs.apiKey, '', 'public profile should not expose apiKey');
    assert.strictEqual(pubDs.hasApiKey, true, 'public profile should have hasApiKey true');

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot
    });

    const getResponse = await fetch(servers.appUrl + '/api/settings');
    const getBody = await getResponse.json();
    assert.ok(getResponse.ok && getBody.ok, 'GET /api/settings should return ok');
    assert.strictEqual(getBody.settings.providerSettings.apiKey, '', 'settings API should not expose raw API key');
    assert.strictEqual(getBody.settings.providerSettings.hasApiKey, true);
    assert.strictEqual(getBody.runtimeProvider.apiKey, '', 'runtimeProvider must not expose the API key');
    assert.ok(getBody.runtimeProvider.hasApiKey, 'runtimeProvider should still report hasApiKey');
    assert.ok(Array.isArray(getBody.settings.providerProfiles), 'API should return providerProfiles array');
    var apiProfiles = getBody.settings.providerProfiles;
    var apiDs = apiProfiles.find(function (p) { return p.id === dsProfile.id; });
    assert.ok(apiDs, 'API should include the deepseek profile');
    assert.strictEqual(apiDs.apiKey, '', 'API should not expose profile apiKey');
    assert.strictEqual(apiDs.hasApiKey, true);
    assert.ok(Array.isArray(getBody.runtimeProviderProfiles), 'GET /api/settings should return runtimeProviderProfiles array');
    assert.strictEqual(getBody.storageLocations.projectSaveLocation, path.join(dataRoot, 'projects'), 'GET /api/settings should resolve the effective project library');
    assert.strictEqual(getBody.storageLocations.backupLocation, path.join(dataRoot, 'projects', 'backups'), 'GET /api/settings should resolve the effective backup folder');
    var rtDs = getBody.runtimeProviderProfiles.find(function (p) { return p.id === dsProfile.id; });
    assert.ok(rtDs, 'runtimeProviderProfiles should include the deepseek profile');
    assert.strictEqual(rtDs.apiKey, '', 'runtimeProviderProfiles must not expose real profile apiKey');
    assert.strictEqual(rtDs.hasApiKey, true);
    assert.ok(!JSON.stringify(getBody).includes('ds-secret-1'), 'settings API JSON must not contain the saved test key');

    const postResponse = await fetch(servers.appUrl + '/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          providerSettings: {
            mode: 'local',
            provider: 'lmstudio',
            endpoint: 'http://localhost:8080',
            model: 'local-test'
          },
          generationDefaults: {
            temperature: 0.65,
            maxTokens: 512,
            useProviderDefaults: false
          },
          appearance: {
            theme: 'ash-rose'
          }
        }
      })
    });
    const postBody = await postResponse.json();
    assert.ok(postResponse.ok && postBody.ok, 'POST /api/settings should return ok');
    assert.strictEqual(postBody.runtimeProvider.mode, 'local');
    assert.strictEqual(postBody.runtimeProvider.endpoint, 'http://localhost:8080');
    assert.strictEqual(postBody.runtimeProvider.maxTokens, 512);
    assert.strictEqual(postBody.settings.appearance.theme, 'ash-rose', 'POST /api/settings should preserve appearance theme');
    assert.strictEqual(postBody.storageLocations.projectSaveLocation, path.join(dataRoot, 'projects'), 'POST /api/settings should keep returning the effective project library');
    assert.strictEqual(postBody.storageLocations.backupLocation, path.join(dataRoot, 'projects', 'backups'), 'POST /api/settings should keep returning the effective backup folder');

    const testResponse = await fetch(servers.appUrl + '/api/settings/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ live: false })
    });
    const testBody = await testResponse.json();
    assert.ok(testResponse.ok && testBody.ok, 'provider configuration test should pass for local defaults');

    await settingsService.updateSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: 'stored-deepseek-key',
        model: 'deepseek-chat'
      }
    });
    const sameBindingTestResponse = await fetch(servers.appUrl + '/api/settings/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        live: false,
        settings: {
          providerSettings: {
            mode: 'api',
            provider: 'deepseek',
            endpoint: 'https://api.deepseek.com/chat/completions/',
            apiKey: '',
            model: 'deepseek-chat'
          }
        }
      })
    });
    const sameBindingTestBody = await sameBindingTestResponse.json();
    assert.strictEqual(sameBindingTestBody.ok, true, 'testing the same normalized binding may retain the stored key');
    const reboundTestResponse = await fetch(servers.appUrl + '/api/settings/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        live: false,
        settings: {
          providerSettings: {
            mode: 'api',
            provider: 'openai-compatible',
            endpoint: 'https://untrusted.invalid/v1/chat/completions',
            apiKey: '',
            model: 'foreign-model'
          }
        }
      })
    });
    const reboundTestBody = await reboundTestResponse.json();
    assert.strictEqual(reboundTestBody.ok, false, 'testing an unsaved rebound endpoint with a blank key must not inherit the stored key');
    assert.ok(/API key is required/i.test(reboundTestBody.result.error), 'the rebound test should require a key before any network request');

    // Test deleting a profile
    var delResponse = await fetch(servers.appUrl + '/api/settings/delete-provider-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: dsProfile.id })
    });
    var delBody = await delResponse.json();
    assert.ok(delResponse.ok && delBody.ok, 'delete profile should succeed');
    assert.strictEqual(delBody.settings.providerProfiles.length, 1, 'should have 1 profile remaining');
    assert.ok(Array.isArray(delBody.runtimeProviderProfiles), 'delete response should have runtimeProviderProfiles');
    assert.strictEqual(delBody.runtimeProviderProfiles.length, 1, 'delete runtimeProviderProfiles should have 1 profile');
    assert.strictEqual(delBody.runtimeProviderProfiles[0].apiKey, '', 'remaining profile must not expose apiKey in runtimeProviderProfiles');
    assert.strictEqual(delBody.runtimeProviderProfiles[0].hasApiKey, true, 'remaining profile should still report hasApiKey');

    // Phase 33: test-provider-profile endpoint tests
    var remainingProfile = delBody.runtimeProviderProfiles[0];
    assert.ok(remainingProfile, 'should have remaining profile for test-provider-profile');

    var profileTestRes = await fetch(servers.appUrl + '/api/settings/test-provider-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: remainingProfile.id, live: false })
    });
    var profileTestBody = await profileTestRes.json();
    assert.ok(profileTestRes.ok, 'test-provider-profile should return HTTP 200');
    assert.ok(profileTestBody.ok, 'test-provider-profile should be ok for OpenAI profile with key');
    assert.strictEqual(profileTestBody.result.checked, 'configuration', 'should check configuration when live=false');
    assert.strictEqual(profileTestBody.result.provider, 'openai', 'should report provider');

    var missingRes = await fetch(servers.appUrl + '/api/settings/test-provider-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: '', live: false })
    });
    var missingBody = await missingRes.json();
    assert.strictEqual(missingRes.status, 400, 'empty profileId should return 400');
    assert.strictEqual(missingBody.ok, false, 'empty profileId should fail');

    var notFoundRes = await fetch(servers.appUrl + '/api/settings/test-provider-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'nonexistent-id', live: false })
    });
    var notFoundBody = await notFoundRes.json();
    assert.strictEqual(notFoundBody.ok, false, 'nonexistent profileId should fail');

    // Verify public settings still hide profile keys
    var pubSettingsRes = await fetch(servers.appUrl + '/api/settings');
    var pubSettingsBody = await pubSettingsRes.json();
    assert.strictEqual(pubSettingsBody.settings.appearance.theme, 'ash-rose', 'GET /api/settings should preserve appearance theme');
    assert.ok(Array.isArray(pubSettingsBody.settings.providerProfiles), 'public settings should have providerProfiles');
    var pubRemainingProfile = pubSettingsBody.settings.providerProfiles.find(function (p) { return p.id === remainingProfile.id; });
    if (pubRemainingProfile) {
      assert.strictEqual(pubRemainingProfile.apiKey, '', 'public profile should not expose apiKey after test-provider-profile');
      assert.strictEqual(pubRemainingProfile.hasApiKey, true, 'public profile should have hasApiKey true');
    }

    await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: 'PROFILE_DISK_KEY',
        model: 'deepseek-v4-flash'
      }
    });
    const rebindGlobal = await fetch(servers.appUrl + '/api/settings', {
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
    const rebindGlobalBody = await rebindGlobal.json();
    assert.ok(rebindGlobal.ok && rebindGlobalBody.ok, 'rebinding settings should still return 200');
    assert.strictEqual(rebindGlobalBody.settings.providerSettings.hasApiKey, false, 'public settings must not claim a key after provider/endpoint change');
    const reboundGlobal = await settingsService.readSettings(dataRoot);
    assert.strictEqual(reboundGlobal.providerSettings.apiKey, '', 'blank key must not follow a DeepSeek config to an arbitrary endpoint');
    assert.ok(String(reboundGlobal.providerSettings.endpoint).includes('evil.example'));

    const zenSaved = await settingsService.writeSettings(dataRoot, {
      providerSettings: {
        mode: 'api',
        provider: 'opencode-zen',
        apiKey: 'OPENCODE_SHARED_KEY',
        model: 'deepseek-v4-flash'
      }
    });
    const zenToGo = await settingsService.updateSettings(dataRoot, {
      providerSettings: { provider: 'opencode-go', apiKey: '', model: 'glm-5.2' }
    });
    assert.strictEqual(zenSaved.providerSettings.apiKey, 'OPENCODE_SHARED_KEY');
    assert.strictEqual(zenToGo.providerSettings.provider, 'opencode-go');
    assert.strictEqual(zenToGo.providerSettings.apiKey, 'OPENCODE_SHARED_KEY', 'Zen to Go may keep the same OpenCode key');

    const profileCreated = await settingsService.updateProviderProfile(dataRoot, {
      name: 'rebind-profile',
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: 'PROFILE_DISK_KEY'
    });
    const createdProfile = profileCreated.providerProfiles.find(function (item) { return item.name === 'rebind-profile'; });
    const rebindProfile = await fetch(servers.appUrl + '/api/settings/provider-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: {
          id: createdProfile.id,
          name: 'rebind-profile',
          provider: 'openai-compatible',
          endpoint: 'https://evil.example/v1/chat/completions',
          apiKey: ''
        }
      })
    });
    const rebindProfileBody = await rebindProfile.json();
    assert.ok(rebindProfile.ok && rebindProfileBody.ok, 'rebinding a profile should still return 200');
    const storedProfile = (await settingsService.readSettings(dataRoot)).providerProfiles.find(function (item) {
      return item.id === createdProfile.id;
    });
    assert.strictEqual(storedProfile.apiKey, '', 'blank profile key must not follow a DeepSeek profile to an arbitrary endpoint');

    console.log('Settings service test passed.');
  } finally {
    if (servers) servers.close();
    if (providerServer) providerServer.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Settings service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
