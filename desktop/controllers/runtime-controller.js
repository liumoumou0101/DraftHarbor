const fsp = require('fs/promises');
const path = require('path');

function createController(dependencies) {
  const { runtimeInfo, installLlamaCpp, readJsonPayload, jsonResponse } = dependencies;
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, integrations = {}) {

  if (request.method === 'GET' && parsedUrl.pathname === '/api/health') {
    jsonResponse(response, 200, { ok: true, service: 'draftharbor-desktop-server', timestamp: new Date().toISOString() });
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/runtime-info') {
    jsonResponse(response, 200, await runtimeInfo(dataRoot));
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/install-llama') {
    try {
      const payload = await readJsonPayload(request);
      const variant = String((payload && payload.variant) || 'cpu').trim().toLowerCase();
      jsonResponse(response, 200, await installLlamaCpp(dataRoot, variant));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/shutdown') {
    jsonResponse(response, 200, {
      ok: true,
      message: 'DraftHarbor is shutting down. Restart the application to apply runtime changes.'
    });
    return true;
  }



    return false;
  };
}

module.exports = { createController };
