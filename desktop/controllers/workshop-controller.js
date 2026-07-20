function createController(dependencies) {
  const { workshopService, readJsonPayload, jsonResponse } = dependencies;
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, _integrations = {}) {

  if (request.method === 'GET' && parsedUrl.pathname === '/api/workshop-sessions') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      jsonResponse(response, 200, await workshopService.listSessions(dataRoot, projectId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workshop-sessions') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      jsonResponse(response, 200, await workshopService.saveSession(dataRoot, projectId, payload.session || payload));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workshop-message') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const sessionId = String(payload.sessionId || '').trim();
      jsonResponse(response, 200, await workshopService.appendMessage(dataRoot, projectId, sessionId, payload.message || {}));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/delete-workshop-session') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const sessionId = String(payload.sessionId || '').trim();
      jsonResponse(response, 200, await workshopService.deleteSession(dataRoot, projectId, sessionId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }


    return false;
  };
}

module.exports = { createController };
