function createGenerationController({ settingsService, readSettings, readJsonPayload, jsonResponse }) {
  return async function handleGenerationApi(request, response, dataRoot, parsedUrl) {
    const route = parsedUrl.pathname;
    try {
      if (request.method === 'POST' && route === '/api/settings/test-provider') {
        const payload = await readJsonPayload(request).catch(() => ({}));
        const settings = payload.settings || await readSettings(dataRoot);
        const result = await settingsService.testProvider(settings, { live: !!payload.live });
        jsonResponse(response, 200, { ok: result.ok, result });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/test-provider-profile') {
        const payload = await readJsonPayload(request).catch(() => ({}));
        const profileId = String(payload.profileId || '').trim();
        if (!profileId) { jsonResponse(response, 400, { ok: false, error: 'profileId is required' }); return true; }
        const result = await settingsService.testProviderProfile(dataRoot, profileId, { live: !!payload.live });
        jsonResponse(response, 200, { ok: result.ok, result });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/provider-profiles') {
        const payload = await readJsonPayload(request);
        const settings = await settingsService.updateProviderProfile(dataRoot, payload.profile || payload);
        jsonResponse(response, 200, { ok: true, settings: settingsService.publicSettings(settings), runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings) });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/delete-provider-profile') {
        const payload = await readJsonPayload(request);
        const profileId = String(payload.profileId || '').trim();
        if (!profileId) throw new Error('profileId is required');
        const settings = await settingsService.deleteProviderProfile(dataRoot, profileId);
        jsonResponse(response, 200, { ok: true, settings: settingsService.publicSettings(settings), runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings) });
        return true;
      }
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
      return true;
    }
    return false;
  };
}

module.exports = { createGenerationController };
