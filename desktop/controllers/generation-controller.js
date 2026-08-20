const generationBridge = require('../services/generation-bridge-service');
const modelCatalogService = require('../services/model-catalog-service');

async function loadTrustedWorkflowPolicy(dataRoot, projectId, runId) {
  if (!projectId || !runId) return null;
  const loaders = [
    () => require('../services/workflow-guided-service').getGuidedRun(dataRoot, projectId, runId),
    () => require('../services/workflow-creation-guided-service').getCreationRun(dataRoot, projectId, runId),
    () => require('../services/workflow-rewrite-guided-service').getRewriteRun(dataRoot, projectId, runId)
  ];
  for (const load of loaders) {
    try {
      const details = await load();
      const policy = details && details.run && details.run.settings && details.run.settings.generationPolicy;
      const snapshot = policy && policy.snapshot && typeof policy.snapshot === 'object' ? policy.snapshot : {};
      const profileId = (policy && policy.providerProfileId && policy.providerProfileId !== 'inherit')
        ? policy.providerProfileId
        : (snapshot.profileId || '');
      return {
        profileId,
        provider: snapshot.provider || '',
        model: snapshot.model || '',
        enableThinking: snapshot.enableThinking,
        temperature: snapshot.temperature,
        maxTokens: snapshot.maxTokens,
        useProviderDefaults: snapshot.useProviderDefaults,
        globalPrompt: snapshot.globalPrompt,
        directiveStack: snapshot.directiveStack
      };
    } catch (error) {
      /* try the next workflow family */
    }
  }
  return null;
}

function createGenerationController({ settingsService, readSettings, readJsonPayload, jsonResponse }) {
  return async function handleGenerationApi(request, response, dataRoot, parsedUrl) {
    const route = parsedUrl.pathname;
    try {
      if (request.method === 'POST' && route === '/api/generation/stream') {
        const payload = await readJsonPayload(request).catch(() => ({}));
        delete payload.apiKey;
        delete payload.allowTestEndpoint;
        delete payload.trustedPolicy;
        delete payload.catalog;
        if (payload.snapshot && typeof payload.snapshot === 'object') {
          delete payload.snapshot.apiKey;
          delete payload.snapshot.provider;
          delete payload.snapshot.endpoint;
          delete payload.snapshot.baseUrl;
          delete payload.snapshot.mode;
          delete payload.snapshot.organization;
        }
        const settings = await readSettings(dataRoot);
        const runId = String(payload.runId || '').trim();
        const projectId = String(payload.projectId || '').trim();
        payload.projectId = projectId;
        payload.runId = runId;
        if (runId) {
          payload.trustedPolicy = await loadTrustedWorkflowPolicy(dataRoot, projectId, runId);
        } else {
          delete payload.trustedPolicy;
        }
        const preview = settingsService.runtimeProviderConfig(settings, {
          profileId: (payload.trustedPolicy && payload.trustedPolicy.profileId) || payload.profileId || ''
        });
        const catalogProvider = (preview && modelCatalogService.ALLOWED_CATALOG_PROVIDERS.indexOf(preview.provider) >= 0)
          ? preview.provider
          : 'opencode-zen';
        const catalog = await modelCatalogService.loadCatalog(dataRoot, catalogProvider, {
          skipRefresh: true,
          hidePrivacyRiskModels: !!(settings.modelCatalogPreferences && settings.modelCatalogPreferences.hidePrivacyRiskModels)
        });
        payload.catalog = catalog;
        await generationBridge.writeGenerationSse(response, settings, payload, request);
        return true;
      }
      if (request.method === 'GET' && route === '/api/settings/model-catalog') {
        const settings = await readSettings(dataRoot);
        const provider = modelCatalogService.normalizeCatalogProvider(parsedUrl.searchParams && parsedUrl.searchParams.get('provider') || 'opencode-zen');
        const catalog = await modelCatalogService.loadCatalog(dataRoot, provider, {
          hidePrivacyRiskModels: !!(settings.modelCatalogPreferences && settings.modelCatalogPreferences.hidePrivacyRiskModels)
        });
        jsonResponse(response, 200, { ok: true, catalog });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/refresh-model-catalog') {
        const payload = await readJsonPayload(request).catch(() => ({}));
        const settings = await readSettings(dataRoot);
        const provider = modelCatalogService.normalizeCatalogProvider(payload.provider || 'opencode-zen');
        const catalog = await modelCatalogService.refreshRemoteCatalog(dataRoot, provider, {
          hidePrivacyRiskModels: !!(settings.modelCatalogPreferences && settings.modelCatalogPreferences.hidePrivacyRiskModels)
        });
        jsonResponse(response, 200, { ok: !catalog.refreshFailed, catalog });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/acknowledge-model-privacy') {
        const payload = await readJsonPayload(request).catch(() => ({}));
        const modelId = String(payload.modelId || '').trim();
        if (!modelId) { jsonResponse(response, 400, { ok: false, error: 'modelId is required' }); return true; }
        const current = await readSettings(dataRoot);
        const existing = ((current.modelCatalogPreferences || {}).acknowledgedPrivacyModels || []);
        const next = existing.includes(modelId) ? existing : existing.concat([modelId]);
        const settings = await settingsService.updateSettings(dataRoot, {
          modelCatalogPreferences: {
            ...(current.modelCatalogPreferences || {}),
            acknowledgedPrivacyModels: next
          }
        });
        jsonResponse(response, 200, {
          ok: true,
          settings: settingsService.publicSettings(settings),
          runtimeProvider: settingsService.publicRuntimeProvider(settings),
          runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings)
        });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/test-provider') {
        const payload = await readJsonPayload(request).catch(() => ({}));
        const stored = await readSettings(dataRoot);
        const incoming = payload.settings;
        const incomingKey = incoming && incoming.providerSettings && String(incoming.providerSettings.apiKey || '').trim();
        const settings = incoming
          ? Object.assign({}, stored, incoming, {
              providerSettings: Object.assign({}, stored.providerSettings || {}, incoming.providerSettings || {}, {
                apiKey: incomingKey || ((stored.providerSettings && stored.providerSettings.apiKey) || '')
              })
            })
          : stored;
        const live = payload.live !== false;
        const result = await settingsService.testProvider(settings, { live });
        jsonResponse(response, 200, { ok: result.ok, result });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/test-provider-profile') {
        const payload = await readJsonPayload(request).catch(() => ({}));
        const profileId = String(payload.profileId || '').trim();
        if (!profileId) { jsonResponse(response, 400, { ok: false, error: 'profileId is required' }); return true; }
        const result = await settingsService.testProviderProfile(dataRoot, profileId, { live: payload.live !== false });
        jsonResponse(response, 200, { ok: result.ok, result });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/provider-profiles') {
        const payload = await readJsonPayload(request);
        const settings = await settingsService.updateProviderProfile(dataRoot, payload.profile || payload);
        jsonResponse(response, 200, {
          ok: true,
          settings: settingsService.publicSettings(settings),
          runtimeProvider: settingsService.publicRuntimeProvider(settings),
          runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings)
        });
        return true;
      }
      if (request.method === 'POST' && route === '/api/settings/delete-provider-profile') {
        const payload = await readJsonPayload(request);
        const profileId = String(payload.profileId || '').trim();
        if (!profileId) throw new Error('profileId is required');
        const settings = await settingsService.deleteProviderProfile(dataRoot, profileId);
        jsonResponse(response, 200, {
          ok: true,
          settings: settingsService.publicSettings(settings),
          runtimeProvider: settingsService.publicRuntimeProvider(settings),
          runtimeProviderProfiles: settingsService.runtimeProviderProfiles(settings)
        });
        return true;
      }
    } catch (error) {
      if (!response.headersSent) {
        jsonResponse(response, 500, { ok: false, error: generationBridge.publicProviderError(error).message });
      }
      return true;
    }
    return false;
  };
}

module.exports = { createGenerationController };
