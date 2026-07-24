const fsp = require('fs/promises');

function createController(dependencies) {
  const { workflowService, workflowTransferService, workflowGuidedService, workflowCreationGuidedService, workflowRewriteGuidedService, workflowVariantService, workflowTemplateService, readerWorkflowTransferService, projectService, createPreRestoreBackup, readJsonPayload, jsonResponse } = dependencies;
  async function completeV2GuidedTransfer(payload, dataRoot) {
    const services = [workflowGuidedService, workflowCreationGuidedService, workflowRewriteGuidedService].filter(Boolean);
    let lastError = null;
    for (const service of services) {
      const complete = service.completeGuidedTransfer || service.completeCreationTransfer || service.completeRewriteTransfer;
      if (typeof complete !== 'function') continue;
      try {
        const result = await complete({ ...payload, dataRoot });
        if (result) return result;
      } catch (error) {
        lastError = error;
        if (!/guided run not found/i.test(String(error && error.message))) throw error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }
  async function restartV2GuidedNode(payload, dataRoot) {
    const restarters = [
      workflowGuidedService.restartGuidedNode,
      workflowCreationGuidedService && workflowCreationGuidedService.restartCreationNode,
      workflowRewriteGuidedService && workflowRewriteGuidedService.restartRewriteNode
    ].filter((item) => typeof item === 'function');
    let lastError = null;
    for (const restart of restarters) {
      try { return await restart({ ...payload, dataRoot }); }
      catch (error) {
        lastError = error;
        if (!/guided run not found/i.test(String(error && error.message))) throw error;
      }
    }
    if (lastError) throw lastError;
    throw new Error('guided workflow restart service unavailable');
  }
  async function resumeV2GuidedRun(payload, dataRoot) {
    const resumers = [
      workflowGuidedService.resumeGuidedRun,
      workflowCreationGuidedService && workflowCreationGuidedService.resumeCreationRun,
      workflowRewriteGuidedService && workflowRewriteGuidedService.resumeRewriteRun
    ].filter((item) => typeof item === 'function');
    let lastError = null;
    for (const resume of resumers) {
      try { return await resume({ ...payload, dataRoot }); }
      catch (error) {
        lastError = error;
        if (!/guided run not found/i.test(String(error && error.message))) throw error;
      }
    }
    if (lastError) throw lastError;
    throw new Error('guided workflow resume service unavailable');
  }
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, _integrations = {}) {

  if (readerWorkflowTransferService && request.method === 'POST' && parsedUrl.pathname.startsWith('/api/workflows/reader-transfer/')) {
    try {
      const action = parsedUrl.pathname.split('/').pop();
      if (!['preview', 'apply'].includes(action)) throw new Error('Reader workflow transfer route not found');
      const payload = await readJsonPayload(request);
      const result = await readerWorkflowTransferService[action](dataRoot, payload);
      jsonResponse(response, 200, action === 'preview' ? { ok: true, preview: result } : result);
    } catch (error) {
      const status = /changed|conflict/i.test(error.message || '') ? 409 : /not found/i.test(error.message || '') ? 404 : 400;
      jsonResponse(response, status, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/workflows') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      jsonResponse(response, 200, await workflowService.listRuns(dataRoot, projectId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowTemplateService && request.method === 'GET' && parsedUrl.pathname === '/api/workflows/v2/templates') {
    try {
      jsonResponse(response, 200, await workflowTemplateService.listTemplates(dataRoot));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowTemplateService && request.method === 'GET' && parsedUrl.pathname === '/api/workflows/v2/template') {
    try {
      jsonResponse(response, 200, await workflowTemplateService.getTemplate(
        dataRoot,
        parsedUrl.searchParams.get('templateId'),
        parsedUrl.searchParams.get('version')
      ));
    } catch (error) { jsonResponse(response, /not found/i.test(error.message) ? 404 : 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowTemplateService && request.method === 'GET' && parsedUrl.pathname === '/api/workflows/v2/template-versions') {
    try {
      jsonResponse(response, 200, await workflowTemplateService.listTemplateVersions(dataRoot, parsedUrl.searchParams.get('templateId')));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowTemplateService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/templates') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowTemplateService.saveTemplate(dataRoot, payload.template || payload));
    } catch (error) {
      jsonResponse(response, error.name === 'WorkflowTemplateValidationError' ? 400 : 500, { ok: false, error: error.message, errors: error.errors || [] });
    }
    return true;
  }

  if (workflowTemplateService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/delete-template') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowTemplateService.deleteTemplate(dataRoot, payload.templateId));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowTemplateService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/start-template') {
    try {
      const payload = await readJsonPayload(request);
      if (!String(payload.projectId || '').trim()) throw new Error('Missing projectId');
      const preRun = await createPreRestoreBackup(dataRoot, payload.projectId, 'Before starting custom workflow template', 'before-template-workflow');
      const result = await workflowTemplateService.startTemplate(dataRoot, payload);
      jsonResponse(response, 200, { ...result, preRunSnapshot: preRun.backup });
    } catch (error) {
      jsonResponse(response, error.name === 'WorkflowTemplateExecutionError' ? 400 : 500, { ok: false, error: error.message, errors: error.errors || [] });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/restart-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await restartV2GuidedNode(payload, dataRoot));
    } catch (error) { jsonResponse(response, 400, { ok: false, error: error.message }); }
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

  if (workflowVariantService && request.method === 'GET' && parsedUrl.pathname === '/api/workflows/v2/variants') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const runId = String(parsedUrl.searchParams.get('runId') || '').trim();
      await workflowVariantService.ensureMainVariant({ dataRoot, projectId, runId });
      jsonResponse(response, 200, await workflowVariantService.listVariants({ dataRoot, projectId, runId }));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowVariantService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/prepare-variant') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowVariantService.prepareAlternativeVariant({ ...payload, dataRoot }));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowVariantService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/complete-variant') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowVariantService.completeAlternativeVariant({ ...payload, dataRoot }));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowVariantService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/approve-variant') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowVariantService.approveVariant({ ...payload, dataRoot }));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowVariantService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/compare-variants') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowVariantService.compareVariants({ ...payload, dataRoot }));
    } catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }); }
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/workflows/v2/guided-run') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const runId = String(parsedUrl.searchParams.get('runId') || '').trim();
      jsonResponse(response, 200, await workflowGuidedService.getGuidedRun(dataRoot, projectId, runId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'GET' && parsedUrl.pathname === '/api/workflows/v2/creation-run') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const runId = String(parsedUrl.searchParams.get('runId') || '').trim();
      jsonResponse(response, 200, await workflowCreationGuidedService.getCreationRun(dataRoot, projectId, runId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/start-creation') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      if (!projectId) throw new Error('Missing projectId');
      const preRun = await createPreRestoreBackup(dataRoot, projectId, 'Before starting guided creation workflow', 'before-creation-workflow');
      const result = await workflowCreationGuidedService.startGuidedCreation({ ...payload, dataRoot, projectId });
      jsonResponse(response, 200, { ...result, preRunSnapshot: preRun.backup });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/resume-run') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await resumeV2GuidedRun(payload, dataRoot));
    } catch (error) { jsonResponse(response, 400, { ok: false, error: error.message }); }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/create-project-and-start-creation') {
    let created = null;
    try {
      const payload = await readJsonPayload(request);
      const brief = payload.brief && typeof payload.brief === 'object' ? payload.brief : {};
      const requested = payload.project && typeof payload.project === 'object' ? payload.project : {};
      const title = String(requested.title || brief.workingTitle || brief.premise || '').trim().slice(0, 120);
      if (!title) throw new Error('请填写暂定书名或核心创意，以便创建新项目');
      if (!projectService || typeof projectService.createProject !== 'function') throw new Error('Project service is unavailable');
      created = await projectService.createProject(dataRoot, {
        title,
        description: String(requested.description || brief.premise || '').trim(),
        status: String(requested.status || '构思中').trim() || '构思中'
      });
      const result = await workflowCreationGuidedService.startGuidedCreation({ ...payload, dataRoot, projectId: created.project.id });
      jsonResponse(response, 200, { ...result, projectId: created.project.id });
    } catch (error) {
      if (created && created.projectPath) {
        await fsp.rm(created.projectPath, { recursive: true, force: true }).catch(() => {});
      }
      jsonResponse(response, 500, { ok: false, error: error.message || 'Could not create project and start creation workflow' });
    }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/prepare-creation-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowCreationGuidedService.prepareCreationNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/complete-creation-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowCreationGuidedService.completeCreationNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/revise-creation-artifact') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowCreationGuidedService.reviseCreationArtifact({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/approve-creation-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowCreationGuidedService.approveCreationNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowCreationGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/cancel-creation') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowCreationGuidedService.cancelCreationRun({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowRewriteGuidedService && request.method === 'GET' && parsedUrl.pathname === '/api/workflows/v2/rewrite-run') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const runId = String(parsedUrl.searchParams.get('runId') || '').trim();
      jsonResponse(response, 200, await workflowRewriteGuidedService.getRewriteRun(dataRoot, projectId, runId));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowRewriteGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/start-rewrite') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      if (!projectId) throw new Error('Missing projectId');
      const preRun = await createPreRestoreBackup(dataRoot, projectId, 'Before starting guided rewrite workflow', 'before-rewrite-workflow');
      const result = await workflowRewriteGuidedService.startGuidedRewrite({ ...payload, dataRoot, projectId });
      jsonResponse(response, 200, { ...result, preRunSnapshot: preRun.backup });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowRewriteGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/prepare-rewrite-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowRewriteGuidedService.prepareRewriteNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowRewriteGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/complete-rewrite-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowRewriteGuidedService.completeRewriteNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowRewriteGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/revise-rewrite-artifact') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowRewriteGuidedService.reviseRewriteArtifact({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowRewriteGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/approve-rewrite-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowRewriteGuidedService.approveRewriteNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (workflowRewriteGuidedService && request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/cancel-rewrite') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowRewriteGuidedService.cancelRewriteRun({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/start-guided') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      if (!projectId) throw new Error('Missing projectId');
      const preRun = await createPreRestoreBackup(dataRoot, projectId, 'Before starting guided continuation workflow', 'before-guided-workflow');
      const result = await workflowGuidedService.startGuidedContinuation({ ...payload, dataRoot, projectId });
      jsonResponse(response, 200, { ...result, preRunSnapshot: preRun.backup });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/prepare-guided-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowGuidedService.prepareGuidedNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/complete-guided-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowGuidedService.completeGuidedNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/revise-guided-artifact') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowGuidedService.reviseArtifact({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/approve-guided-node') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowGuidedService.approveGuidedNode({ ...payload, dataRoot }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/cancel-guided') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowGuidedService.cancelGuidedRun({ ...payload, dataRoot }));
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

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/copy-legacy') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const legacyRunId = String(payload.legacyRunId || payload.runId || '').trim();
      if (!projectId || !legacyRunId) throw new Error('Missing projectId or legacyRunId');
      jsonResponse(response, 200, await workflowService.copyLegacyRun(dataRoot, projectId, legacyRunId, {
        targetRunId: String(payload.targetRunId || '').trim(),
        title: String(payload.title || '').trim()
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

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/preview-writer-transfer') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowTransferService.previewWriterTransfer({
        ...payload,
        dataRoot,
        projectId: String(payload.projectId || '').trim(),
        runId: String(payload.runId || '').trim()
      }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/apply-writer-transfer') {
    try {
      const payload = await readJsonPayload(request);
      const result = await workflowTransferService.applyWriterTransfer({
        ...payload,
        dataRoot,
        projectId: String(payload.projectId || '').trim(),
        runId: String(payload.runId || '').trim(),
        applicationId: String(payload.applicationId || '').trim()
      });
      const guided = result.ok ? await completeV2GuidedTransfer(payload, dataRoot) : null;
      jsonResponse(response, 200, { ...result, guidedRun: guided && guided.run });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/preview-compendium-suggestions') {
    try {
      const payload = await readJsonPayload(request);
      jsonResponse(response, 200, await workflowTransferService.previewCompendiumSuggestions({
        ...payload,
        dataRoot,
        projectId: String(payload.projectId || '').trim(),
        runId: String(payload.runId || '').trim()
      }));
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/workflows/v2/apply-compendium-suggestions') {
    try {
      const payload = await readJsonPayload(request);
      const result = await workflowTransferService.applyConfirmedCompendiumSuggestions({
        ...payload,
        dataRoot,
        projectId: String(payload.projectId || '').trim(),
        runId: String(payload.runId || '').trim(),
        applicationId: String(payload.applicationId || '').trim()
      });
      const guided = result.ok ? await completeV2GuidedTransfer(payload, dataRoot) : null;
      jsonResponse(response, 200, { ...result, guidedRun: guided && guided.run });
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
