const fsp = require('fs/promises');
const path = require('path');

function createController(dependencies) {
  const { workflowService, createPreRestoreBackup, readJsonPayload, jsonResponse } = dependencies;
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, integrations = {}) {

  if (request.method === 'GET' && parsedUrl.pathname === '/api/workflows') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      jsonResponse(response, 200, await workflowService.listRuns(dataRoot, projectId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/workflow-events') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const runId = String(parsedUrl.searchParams.get('runId') || '').trim();
      jsonResponse(response, 200, await workflowService.listEvents(dataRoot, projectId, runId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/start') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      if (!projectId) throw new Error('Missing projectId');
      const preRun = await createPreRestoreBackup(dataRoot, projectId, 'Before starting semi-automatic workflow', 'before-workflow');
      jsonResponse(response, 200, await workflowService.startNovelWorkflow(dataRoot, projectId, {
        title: payload.title,
        brief: payload.brief,
        preRunSnapshot: {
          backupId: preRun.backup.backupId,
          path: preRun.backup.path,
          reason: 'before-workflow',
          createdAt: new Date().toISOString()
        }
      }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/prepare-step') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowService.prepareStep(
        dataRoot,
        String(payload.projectId || '').trim(),
        String(payload.runId || '').trim(),
        String(payload.stepId || '').trim()
      ));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/complete-generation') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowService.completeGenerationStep(
        dataRoot,
        String(payload.projectId || '').trim(),
        String(payload.runId || '').trim(),
        String(payload.stepId || '').trim(),
        payload.result || payload
      ));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/approve-step') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowService.approveStep(
        dataRoot,
        String(payload.projectId || '').trim(),
        String(payload.runId || '').trim(),
        String(payload.stepId || '').trim()
      ));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/reject-step') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowService.rejectStep(
        dataRoot,
        String(payload.projectId || '').trim(),
        String(payload.runId || '').trim(),
        String(payload.stepId || '').trim(),
        String(payload.reason || '').trim()
      ));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/apply-artifact') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowService.applyArtifact(
        dataRoot,
        String(payload.projectId || '').trim(),
        String(payload.runId || '').trim(),
        String(payload.artifactId || '').trim()
      ));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/cancel') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowService.cancelRun(
        dataRoot,
        String(payload.projectId || '').trim(),
        String(payload.runId || '').trim(),
        String(payload.reason || '').trim()
      ));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }


    return false;
  };
}

module.exports = { createController };
