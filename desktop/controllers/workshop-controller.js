function createController(dependencies) {
  const { workshopService, workshopAgentService, projectService, projectToLegacySnapshot, readJsonPayload, jsonResponse } = dependencies;
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, _integrations = {}) {

  const agentRoute = parsedUrl.pathname.match(/^\/api\/workshop-agent\/(start|run|cancel|apply|undo)$/);
  if (agentRoute) {
    const action = agentRoute[1];
    if ((action === 'run' && request.method !== 'GET') || (action !== 'run' && request.method !== 'POST')) {
      jsonResponse(response, 405, { ok: false, error: '此讨论接口不支持该请求方式' });
      return true;
    }
    try {
      if (!workshopAgentService) {
        jsonResponse(response, 503, { ok: false, error: '项目讨论助手尚未就绪' });
        return true;
      }
      const payload = action === 'run' ? null : await readJsonPayload(request);
      if (action !== 'run' && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
        throw Object.assign(new Error('讨论请求必须是 JSON 对象'), { statusCode: 400 });
      }
      let result;
      if (action === 'start') {
        result = await workshopAgentService.start(dataRoot, {
          projectId: payload.projectId, sessionId: payload.sessionId,
          message: payload.message, currentSceneId: payload.currentSceneId
        });
      } else {
        const runId = action === 'run' ? parsedUrl.searchParams.get('runId') : payload.runId;
        if (typeof runId !== 'string' || !runId.trim()) throw Object.assign(new Error('缺少有效的讨论任务 ID'), { statusCode: 400 });
        // A caller can select a server-held run, but never supply edits or receipts.
        result = await workshopAgentService[action === 'run' ? 'getRun' : action](dataRoot, String(runId || ''));
      }
      if ((action === 'apply' || action === 'undo') && result.ok && result.run && projectService && projectToLegacySnapshot) {
        try {
          const opened = await projectService.openProject(dataRoot, result.run.projectId);
          result.projectSnapshot = projectToLegacySnapshot(opened.project);
        } catch (_error) {
          // The write already succeeded; the UI can retry its snapshot refresh.
          result.refreshError = '改动已保存，但项目视图刷新失败，请重新打开项目查看';
        }
      }
      jsonResponse(response, 200, result);
    } catch (error) {
      const status = Number(error.statusCode);
      let message = error.message || '项目讨论请求失败';
      if (status === 409 && !/[\u3400-\u9fff]/.test(message)) {
        message = action === 'undo' ? '项目内容或讨论已变化，无法安全撤销。请检查当前内容，后续编辑不会被覆盖。'
          : action === 'apply' ? '项目内容或讨论已变化，当前建议已过期。请重新提问生成新建议。'
            : '当前讨论已变化或不存在，请刷新讨论后重新提问。';
      }
      jsonResponse(response, status >= 400 && status <= 599 ? status : 500, { ok: false, error: message });
    }
    return true;
  }

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
