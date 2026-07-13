const fsp = require('fs/promises');
const path = require('path');

function createController(dependencies) {
  const { compendiumService, compendiumAgentService, compendiumAgentRunnerService, compendiumAgentQaService, promptService, readJsonPayload, jsonResponse, readSettings, createPreRestoreBackup } = dependencies;
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

  if (compendiumAgentService && request.method === 'GET' && parsedUrl.pathname === '/api/compendium-agent/snapshot') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const entryIds = String(parsedUrl.searchParams.get('entryIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
      const settings = await readSettings(dataRoot);
      jsonResponse(response, 200, await compendiumAgentService.readSnapshot(dataRoot, projectId, entryIds, settings.compendiumAgent));
    } catch (error) {
      jsonResponse(response, 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (compendiumAgentService && request.method === 'POST' && parsedUrl.pathname === '/api/compendium-agent/apply') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const settings = await readSettings(dataRoot);
      const result = await compendiumAgentService.applyOperations(dataRoot, projectId, payload.operations, {
        agentSettings: settings.compendiumAgent,
        beforeWrite: async () => createPreRestoreBackup(
          dataRoot,
          projectId,
          'Before applying compendium agent suggestions',
          'before-compendium-agent-apply'
        )
      });
      jsonResponse(response, 200, result);
    } catch (error) {
      jsonResponse(response, 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (compendiumAgentRunnerService && request.method === 'POST' && parsedUrl.pathname === '/api/compendium-agent/analyze') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const entryIds = Array.isArray(payload.entryIds) ? payload.entryIds : [];
      jsonResponse(response, 200, await compendiumAgentRunnerService.analyze(dataRoot, projectId, entryIds));
    } catch (error) {
      jsonResponse(response, 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (compendiumAgentQaService && request.method === 'POST' && parsedUrl.pathname === '/api/compendium-agent/ask') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await compendiumAgentQaService.ask(dataRoot, String(payload.projectId || '').trim(), payload.question));
    } catch (error) {
      jsonResponse(response, 400, { ok: false, error: error.message });
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
