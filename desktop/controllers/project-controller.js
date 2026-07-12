const fsp = require('fs/promises');
const path = require('path');

function createController(dependencies) {
  const { readProjectSummary, listDirectoryProjectSummaries, listProjectFiles, readDirectoryProject, findProjectFile, projectSaveRoot, projectsRoot, projectDir, projectService, normalizeProjectMetadata, projectToLegacySnapshot, projectToLibrarySummary, legacySnapshotToProject, readJsonPayload, jsonResponse, readSettings, writeSettings, backupRoot, projectFilename, writeJsonAtomic, uniqueFilePath } = dependencies;
  return async function handle(request, response, appRoot, dataRoot, parsedUrl, integrations = {}) {

  if (request.method === 'GET' && parsedUrl.pathname === '/api/list-projects') {
    const projects = [];
    for (const file of await listProjectFiles(dataRoot)) {
      projects.push(await readProjectSummary(dataRoot, file));
    }
    projects.push(...await listDirectoryProjectSummaries(dataRoot));
    projects.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    jsonResponse(response, 200, { ok: true, projects, projectSaveLocation: await projectSaveRoot(dataRoot) });
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/get-project') {
    const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
    const filename = String(parsedUrl.searchParams.get('filename') || '').trim();
    const file = await findProjectFile(dataRoot, projectId, filename);
    if (!file) {
      const directoryProject = await readDirectoryProject(dataRoot, projectId);
      if (directoryProject) {
        jsonResponse(response, 200, {
          ok: true,
          project: projectToLegacySnapshot(directoryProject),
          summary: projectToLibrarySummary(directoryProject, projectDir(dataRoot, directoryProject.id), projectsRoot(dataRoot)),
          projectSaveLocation: await projectSaveRoot(dataRoot)
        });
        return true;
      }
      jsonResponse(response, 404, { ok: false, error: 'Project not found' });
      return true;
    }

    try {
      const project = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
      jsonResponse(response, 200, {
        ok: true,
        project,
        summary: await readProjectSummary(dataRoot, file),
        projectSaveLocation: await projectSaveRoot(dataRoot)
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message || 'Could not read project' });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/update-project-metadata') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const filename = String(payload.filename || '').trim();
      const file = await findProjectFile(dataRoot, projectId, filename);
      if (!file) {
        const directoryProject = await readDirectoryProject(dataRoot, projectId);
        if (directoryProject) {
          const metadata = normalizeProjectMetadata(payload.metadata || {});
          const updated = await projectService.updateProjectMetadata(dataRoot, projectId, metadata);
          const projectPath = projectDir(dataRoot, updated.project.id);
          jsonResponse(response, 200, {
            ok: true,
            project: projectToLegacySnapshot(updated.project),
            summary: projectToLibrarySummary(updated.project, projectPath, projectsRoot(dataRoot)),
            projectSaveLocation: await projectSaveRoot(dataRoot)
          });
          return true;
        }
        jsonResponse(response, 404, { ok: false, error: 'Project not found' });
        return true;
      }

      const snapshot = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
      if (!snapshot.project || typeof snapshot.project !== 'object') {
        throw new Error('Project snapshot is missing project metadata');
      }

      const metadata = normalizeProjectMetadata(payload.metadata || {});
      snapshot.project = {
        ...snapshot.project,
        ...metadata,
        modified: new Date().toISOString(),
        updatedAt: Date.now()
      };
      snapshot.filesystemSavedAt = new Date().toISOString();
      const saveVersion = Number(snapshot.filesystemSaveVersion || 1);
      snapshot.filesystemSaveVersion = Number.isFinite(saveVersion) ? Math.max(1, saveVersion) : 1;

      const projectsDir = await projectSaveRoot(dataRoot);
      const nextPath = path.join(projectsDir, projectFilename(snapshot.project));
      await writeJsonAtomic(nextPath, snapshot);
      if (nextPath !== file.filePath) {
        await fsp.rm(file.filePath, { force: true });
      }

      const nextFile = {
        filePath: nextPath,
        name: path.basename(nextPath),
        stats: await fsp.stat(nextPath)
      };
      jsonResponse(response, 200, {
        ok: true,
        project: snapshot,
        summary: await readProjectSummary(dataRoot, nextFile),
        projectSaveLocation: projectsDir
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message || 'Could not update project metadata' });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/create-project') {
    try {
      const payload = await readJsonPayload(request);
      const metadata = normalizeProjectMetadata(payload.metadata || {});
      const created = await projectService.createProject(dataRoot, {
        title: metadata.name,
        description: metadata.description,
        status: metadata.status,
        tags: metadata.tags,
        coverImage: metadata.coverImage
      });
      const snapshot = projectToLegacySnapshot(created.project);
      const projectPath = projectDir(dataRoot, created.project.id);
      jsonResponse(response, 200, {
        ok: true,
        project: snapshot,
        summary: projectToLibrarySummary(created.project, projectPath, projectsRoot(dataRoot)),
        projectSaveLocation: await projectSaveRoot(dataRoot)
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message || 'Could not create project' });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/remove-project-from-library') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const filename = String(payload.filename || '').trim();
      const file = await findProjectFile(dataRoot, projectId, filename);
      if (!file) {
        const directoryProject = await readDirectoryProject(dataRoot, projectId);
        if (directoryProject) {
          const removed = await projectService.removeProjectFromLibrary(dataRoot, projectId);
          jsonResponse(response, 200, { ok: true, removedPath: removed.removedPath });
          return true;
        }
        jsonResponse(response, 404, { ok: false, error: 'Project not found' });
        return true;
      }

      const removedDir = path.join(await projectSaveRoot(dataRoot), '.removed-projects');
      await fsp.mkdir(removedDir, { recursive: true });
      const target = await uniqueFilePath(removedDir, file.name);
      await fsp.rename(file.filePath, target);
      jsonResponse(response, 200, {
        ok: true,
        removed: true,
        path: target
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message || 'Could not remove project from library' });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/reveal-project-file') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const filename = String(payload.filename || '').trim();
      const file = await findProjectFile(dataRoot, projectId, filename);
      if (!file) {
        const directoryProject = await readDirectoryProject(dataRoot, projectId);
        if (directoryProject) {
          const target = await projectService.projectLocation(dataRoot, projectId);
          if (integrations.revealPath) {
            await integrations.revealPath(target);
            jsonResponse(response, 200, { ok: true, path: target });
          } else {
            jsonResponse(response, 501, { ok: false, error: 'Reveal is not available in this runtime' });
          }
          return true;
        }
        jsonResponse(response, 404, { ok: false, error: 'Project not found' });
        return true;
      }

      if (typeof integrations.revealPath === 'function') {
        const result = await integrations.revealPath(file.filePath);
        if (result) throw new Error(result);
      } else if (typeof integrations.openPath === 'function') {
        const result = await integrations.openPath(path.dirname(file.filePath));
        if (result) throw new Error(result);
      } else {
        throw new Error('Open folder is not available in this environment.');
      }

      jsonResponse(response, 200, { ok: true, path: file.filePath });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message || 'Could not reveal project file' });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/save-project') {
    try {
      const payload = await readJsonPayload(request);
      const project = payload && payload.project;
      if (!project || typeof project !== 'object') {
        jsonResponse(response, 400, { ok: false, error: 'Missing project payload' });
        return true;
      }
      const projectId = String(project.id || '').trim();
      if (!projectId) {
        jsonResponse(response, 400, { ok: false, error: 'Project id is required' });
        return true;
      }

      const projectsDir = await projectSaveRoot(dataRoot);
      await fsp.mkdir(projectsDir, { recursive: true });
      for (const entry of await fsp.readdir(projectsDir, { withFileTypes: true })) {
        const existingPath = path.join(projectsDir, entry.name);
        if (entry.isFile() && entry.name.endsWith(`--${projectId}.json`)) {
          await fsp.unlink(existingPath);
        }
      }
      payload.filesystemSavedAt = new Date().toISOString();
      payload.filesystemSaveVersion = 1;
      const normalizedProject = legacySnapshotToProject(payload);
      const saved = await projectService.saveProject(dataRoot, normalizedProject);
      const relativePath = path.relative(projectsRoot(dataRoot), saved.projectPath).replace(/\\/g, '/');
      jsonResponse(response, 200, {
        ok: true,
        path: relativePath,
        filename: '',
        source: 'project-directory',
        projectPath: saved.projectPath,
        projectSaveLocation: projectsDir
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }


  if (request.method === 'GET' && parsedUrl.pathname === '/api/project-save-location') {
    jsonResponse(response, 200, { ok: true, path: await projectSaveRoot(dataRoot) });
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/project-save-location') {
    try {
      const payload = await readJsonPayload(request);
      const settings = await readSettings(dataRoot);
      const nextPath = String(payload.path || '').trim();
      settings.projectSaveLocation = nextPath ? path.resolve(nextPath) : '';
      settings.backupLocation = '';
      await writeSettings(dataRoot, settings);
      await fsp.mkdir(await projectSaveRoot(dataRoot), { recursive: true });
      await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
      jsonResponse(response, 200, { ok: true, path: await projectSaveRoot(dataRoot) });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

    return false;
  };
}

module.exports = { createController };
