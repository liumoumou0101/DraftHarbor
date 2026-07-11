const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');
const settingsService = require('../desktop/services/settings-service');
const SettingsSchema = require('../src/core/settings/settings-schema');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-settings-test-'));
  let servers = null;

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
    assert.ok(Array.isArray(normalized.providerProfiles), 'providerProfiles should be an array');
    assert.strictEqual(normalized.providerProfiles.length, 0, 'should default to empty profiles');
    assert.strictEqual(normalized.appearance.theme, 'morandi-ink', 'default desktop theme should be Morandi Ink');
    assert.strictEqual(
      SettingsSchema.normalizeDesktopSettings({ appearance: { theme: 'loud-neon' } }).appearance.theme,
      'morandi-ink',
      'unknown desktop themes should fall back to Morandi Ink'
    );

    const saved = await settingsService.writeSettings(dataRoot, normalized);
    assert.strictEqual(saved.providerSettings.model, 'test-model');

    const updated = await settingsService.updateSettings(dataRoot, {
      providerSettings: { model: 'second-model', apiKey: '' },
      generationDefaults: { maxTokens: 777 }
    });
    assert.strictEqual(updated.providerSettings.model, 'second-model');
    assert.strictEqual(updated.providerSettings.apiKey, 'secret', 'blank apiKey should preserve existing secret');
    assert.strictEqual(updated.generationDefaults.maxTokens, 777);

    const publicSettings = settingsService.publicSettings(updated);
    assert.strictEqual(publicSettings.providerSettings.apiKey, '');
    assert.strictEqual(publicSettings.providerSettings.hasApiKey, true);

    const check = await settingsService.testProvider(updated, { live: false });
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.checked, 'configuration');

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
    assert.strictEqual(rtDs.apiKey, 'ds-secret-1', 'runtimeProviderProfiles should expose real profile apiKey');
    assert.strictEqual(rtDs.hasApiKey, true);

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
    assert.strictEqual(delBody.runtimeProviderProfiles[0].apiKey, 'oa-secret-2', 'remaining profile should have real apiKey in runtimeProviderProfiles');

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

    console.log('Settings service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Settings service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
