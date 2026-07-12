function createImportExportController(dependencies) {
  const {
    migrationService, readJsonPayload, readBody, jsonResponse, fileResponse,
    projectToLegacySnapshot, projectToLibrarySummary, projectsRoot, projectSaveRoot
  } = dependencies;

  return async function handleImportExport(request, response, dataRoot, parsedUrl) {
    const route = parsedUrl.pathname;
    try {
      if (request.method === 'GET' && route === '/api/export-project-document') {
        const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
        const format = String(parsedUrl.searchParams.get('format') || 'markdown').trim();
        const includeSceneTitles = parsedUrl.searchParams.get('includeSceneTitles');
        if (!projectId) throw new Error('Missing projectId');
        const options = includeSceneTitles !== null ? { includeSceneTitles: includeSceneTitles !== 'false' } : {};
        const exported = await migrationService.exportProjectDocument(dataRoot, projectId, format, options);
        fileResponse(response, 200, { filename: exported.filename, mimeType: exported.mimeType, body: exported.body || exported.text });
        return true;
      }
      if (request.method === 'GET' && route === '/api/export-project-package') {
        const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
        if (!projectId) throw new Error('Missing projectId');
        const exported = await migrationService.exportProjectPackage(dataRoot, projectId);
        fileResponse(response, 200, { filename: exported.filename, mimeType: exported.mimeType, body: exported.buffer });
        return true;
      }
      if (request.method === 'POST' && route === '/api/import-project-snapshot') {
        const payload = await readJsonPayload(request);
        const imported = await migrationService.importLegacySnapshot(dataRoot, payload.snapshot || payload, { keepId: !!payload.keepId });
        await respondWithImportedProject(response, dataRoot, imported);
        return true;
      }
      if (request.method === 'POST' && route === '/api/import-project-package') {
        const body = await readBody(request);
        if (!body.length) throw new Error('Package body is required');
        const imported = await migrationService.importProjectPackage(dataRoot, body, { keepId: parsedUrl.searchParams.get('keepId') === '1' });
        await respondWithImportedProject(response, dataRoot, imported);
        return true;
      }
      if (request.method === 'POST' && route === '/api/import-writingway1') {
        const payload = await readJsonPayload(request);
        const imported = await migrationService.importWritingway1Files(dataRoot, payload.files || [], { name: payload.name });
        await respondWithImportedProject(response, dataRoot, imported, { chapterCount: imported.chapterCount, sceneCount: imported.sceneCount });
        return true;
      }
    } catch (error) {
      const fallback = route.includes('export') ? 'Could not export project' : 'Could not import project';
      jsonResponse(response, 500, { ok: false, error: error.message || fallback });
      return true;
    }
    return false;
  };

  async function respondWithImportedProject(response, dataRoot, imported, extra = {}) {
    jsonResponse(response, 200, {
      ok: true, importedFrom: imported.importedFrom, ...extra,
      project: projectToLegacySnapshot(imported.project),
      summary: projectToLibrarySummary(imported.project, imported.projectPath, projectsRoot(dataRoot)),
      projectSaveLocation: await projectSaveRoot(dataRoot)
    });
  }
}

module.exports = { createImportExportController };
