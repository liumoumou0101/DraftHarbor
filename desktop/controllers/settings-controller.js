const modelCatalogService = require('../services/model-catalog-service');

function createController(dependencies) {
  const { settingsService, readSettings, projectSaveRoot, backupRoot, readJsonPayload, jsonResponse } = dependencies;

  async function catalogPayload(dataRoot, settings) {
    const hide = !!(settings.modelCatalogPreferences && settings.modelCatalogPreferences.hidePrivacyRiskModels);
    const catalogs = {};
    try {
      catalogs['opencode-zen'] = await modelCatalogService.loadCatalog(dataRoot, 'opencode-zen', { skipRefresh: true, hidePrivacyRiskModels: hide });
    } catch (error) { /* keep others */ }
    try {
      catalogs['opencode-go'] = await modelCatalogService.loadCatalog(dataRoot, 'opencode-go', { skipRefresh: true, hidePrivacyRiskModels: hide });
    } catch (error) { /* keep others */ }
    const current = ((settings.providerSettings || {}).provider === 'opencode-go') ? 'opencode-go' : 'opencode-zen';
    return { current: catalogs[current] || null, catalogs };
  }

  function kickoffStaleCatalogRefresh(dataRoot, catalogs, settings) {
    const hide = !!(settings.modelCatalogPreferences && settings.modelCatalogPreferences.hidePrivacyRiskModels);
    Object.keys(catalogs || {}).forEach((provider) => {
      const catalog = catalogs[provider];
      if (!catalog || !catalog.stale) return;
      modelCatalogService.loadCatalog(dataRoot, provider, { hidePrivacyRiskModels: hide }).catch(() => {});
    });
  }

  return async function handle(request, response, appRoot, dataRoot, parsedUrl, _integrations = {}) {

  if (request.method === 'GET' && parsedUrl.pathname === '/api/settings') {
    const settings = await readSettings(dataRoot);
    const catalogs = await catalogPayload(dataRoot, settings);
    kickoffStaleCatalogRefresh(dataRoot, catalogs.catalogs, settings);
    jsonResponse(response, 200, {
      ok: true,
      settings: settingsService.publicSettings(settings),
      runtimeProvider: settingsService.publicRuntimeProvider(settings),
      runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings),
      modelCatalog: catalogs.current,
      modelCatalogs: catalogs.catalogs,
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
      const catalogs = await catalogPayload(dataRoot, settings);
      jsonResponse(response, 200, {
        ok: true,
        settings: settingsService.publicSettings(settings),
        runtimeProvider: settingsService.publicRuntimeProvider(settings),
        runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings),
        modelCatalog: catalogs.current,
        modelCatalogs: catalogs.catalogs,
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
