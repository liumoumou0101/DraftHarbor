function createController(dependencies) {
  const { settingsService, readSettings, projectSaveRoot, backupRoot, readJsonPayload, jsonResponse } = dependencies;
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, _integrations = {}) {

  if (request.method === 'GET' && parsedUrl.pathname === '/api/settings') {
    const settings = await readSettings(dataRoot);
    jsonResponse(response, 200, {
      ok: true,
      settings: settingsService.publicSettings(settings),
      runtimeProvider: settingsService.runtimeProviderConfig(settings),
      runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings),
      storageLocations: {
        projectSaveLocation: await projectSaveRoot(dataRoot),
        backupLocation: await backupRoot(dataRoot)
      }
    });
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/settings') {
    try {
      const payload = await readJsonPayload(request);
      const settings = await settingsService.updateSettings(dataRoot, payload.settings || payload);
      jsonResponse(response, 200, {
        ok: true,
        settings: settingsService.publicSettings(settings),
        runtimeProvider: settingsService.runtimeProviderConfig(settings),
        runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings),
        storageLocations: {
          projectSaveLocation: await projectSaveRoot(dataRoot),
          backupLocation: await backupRoot(dataRoot)
        }
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }


    return false;
  };
}

module.exports = { createController };
