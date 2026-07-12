const fsp = require('fs/promises');
const path = require('path');

function createController(dependencies) {
  const { compendiumService, promptService, readJsonPayload, jsonResponse } = dependencies;
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, integrations = {}) {

  if (request.method === 'GET' && parsedUrl.pathname === '/api/compendium') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const query = String(parsedUrl.searchParams.get('query') || '').trim();
      const type = String(parsedUrl.searchParams.get('type') || '').trim();
      jsonResponse(response, 200, await compendiumService.listEntries(dataRoot, projectId, { query, type }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/compendium') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      jsonResponse(response, 200, await compendiumService.saveEntry(dataRoot, projectId, payload.entry || payload));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/delete-compendium-entry') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const entryId = String(payload.entryId || '').trim();
      jsonResponse(response, 200, await compendiumService.deleteEntry(dataRoot, projectId, entryId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/prompts') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const category = String(parsedUrl.searchParams.get('category') || '').trim();
      const query = String(parsedUrl.searchParams.get('query') || '').trim();
      jsonResponse(response, 200, await promptService.listPrompts(dataRoot, projectId, { category, query }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/prompts') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      jsonResponse(response, 200, await promptService.savePrompt(dataRoot, projectId, payload.prompt || payload));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/delete-prompt') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const promptId = String(payload.promptId || '').trim();
      jsonResponse(response, 200, await promptService.deletePrompt(dataRoot, projectId, promptId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }


    return false;
  };
}

module.exports = { createController };
