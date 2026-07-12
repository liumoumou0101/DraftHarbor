const fsp = require('fs/promises');
const path = require('path');

function createBackupController(dependencies) {
  const {
    jsonResponse, backupRoot, listBackupFiles, readBackupSummary, findBackupFile,
    projectService, projectToLegacySnapshot, backupDiffSummary, readJsonPayload,
    uniqueRestoredProjectId, cloneBackupAsNewProjectSnapshot, createPreRestoreBackup,
    legacySnapshotToProject, snapshotHash, backupDir, backupFilename, sanitizeFilename,
    snapshotStats, writeJsonAtomic, pruneBackups, readSettings, writeSettings
  } = dependencies;

  return async function handleBackupApi(request, response, dataRoot, parsedUrl) {
  if (request.method === 'GET' && parsedUrl.pathname === '/api/list-backups') {
    const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
    if (!projectId) {
      jsonResponse(response, 400, { ok: false, error: 'Missing projectId' });
      return true;
    }
    const backups = [];
    for (const file of await listBackupFiles(dataRoot, projectId)) {
      backups.push(await readBackupSummary(dataRoot, file));
    }
    jsonResponse(response, 200, { ok: true, backups, backupLocation: await backupRoot(dataRoot) });
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/list-all-backups') {
    const backups = [];
    for (const file of await listBackupFiles(dataRoot)) {
      backups.push(await readBackupSummary(dataRoot, file));
    }
    jsonResponse(response, 200, { ok: true, backups, backupLocation: await backupRoot(dataRoot) });
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/get-backup') {
    const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
    const backupId = String(parsedUrl.searchParams.get('backupId') || '').trim();
    if (!projectId || !backupId) {
      jsonResponse(response, 400, { ok: false, error: 'Missing projectId or backupId' });
      return true;
    }
    if (path.basename(backupId) !== backupId) {
      jsonResponse(response, 400, { ok: false, error: 'Invalid backupId' });
      return true;
    }
    const file = await findBackupFile(dataRoot, projectId, backupId);
    if (!file) {
      jsonResponse(response, 404, { ok: false, error: 'Backup not found' });
      return true;
    }
    jsonResponse(response, 200, { ok: true, backup: JSON.parse(await fsp.readFile(file.filePath, 'utf8')) });
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/backup-diff') {
    try {
      const projectId = String(parsedUrl.searchParams.get('projectId') || '').trim();
      const backupId = String(parsedUrl.searchParams.get('backupId') || '').trim();
      if (!projectId || !backupId) throw new Error('Missing projectId or backupId');
      if (path.basename(backupId) !== backupId) throw new Error('Invalid backupId');
      const file = await findBackupFile(dataRoot, projectId, backupId);
      if (!file) throw new Error('Backup not found');
      const backup = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
      let currentSnapshot = null;
      try {
        const currentProject = await projectService.openProject(dataRoot, projectId);
        currentSnapshot = projectToLegacySnapshot(currentProject.project);
      } catch {
        currentSnapshot = null;
      }
      jsonResponse(response, 200, {
        ok: true,
        diff: backupDiffSummary(currentSnapshot, backup),
        hasCurrentProject: !!currentSnapshot
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/restore-backup') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const backupId = String(payload.backupId || '').trim();
      const mode = payload.mode === 'new-project' ? 'new-project' : 'replace';
      if (!projectId || !backupId) throw new Error('Missing projectId or backupId');
      if (path.basename(backupId) !== backupId) throw new Error('Invalid backupId');
      const file = await findBackupFile(dataRoot, projectId, backupId);
      if (!file) throw new Error('Backup not found');
      const backup = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
      let restoreSnapshot = backup;
      let preRestoreBackup = null;

      if (mode === 'new-project') {
        const nextId = await uniqueRestoredProjectId(dataRoot, backup.project && backup.project.id);
        restoreSnapshot = cloneBackupAsNewProjectSnapshot(backup, nextId);
      } else {
        try {
          preRestoreBackup = (await createPreRestoreBackup(dataRoot, projectId, `Before restoring ${backupId}`)).backup;
        } catch {
          preRestoreBackup = null;
        }
      }

      restoreSnapshot.filesystemSavedAt = new Date().toISOString();
      const normalizedProject = legacySnapshotToProject(restoreSnapshot);
      const saved = await projectService.saveProject(dataRoot, normalizedProject);
      jsonResponse(response, 200, {
        ok: true,
        mode,
        projectId: saved.project.id,
        projectPath: saved.projectPath,
        preRestoreBackup
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/restore-backup-scene') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const backupId = String(payload.backupId || '').trim();
      const sceneId = String(payload.sceneId || '').trim();
      if (!projectId || !backupId || !sceneId) throw new Error('Missing projectId, backupId, or sceneId');
      if (path.basename(backupId) !== backupId) throw new Error('Invalid backupId');
      const file = await findBackupFile(dataRoot, projectId, backupId);
      if (!file) throw new Error('Backup not found');
      const backup = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
      const backupScene = (backup.scenes || []).find((scene) => scene.id === sceneId);
      if (!backupScene) throw new Error('Scene not found in backup');
      const backupText = backup.sceneContents && backup.sceneContents[sceneId] !== undefined
        ? String(backup.sceneContents[sceneId] || '')
        : '';
      const preRestore = await createPreRestoreBackup(dataRoot, projectId, `Before restoring scene ${sceneId} from ${backupId}`);
      const project = preRestore.currentProject;
      let targetScene = (project.scenes || []).find((scene) => scene.id === sceneId);
      if (targetScene) {
        targetScene.title = backupScene.title || targetScene.title;
        targetScene.summary = backupScene.summary || targetScene.summary || '';
        targetScene.tags = Array.isArray(backupScene.tags) ? backupScene.tags : targetScene.tags || [];
        targetScene.povCharacter = backupScene.povCharacter || targetScene.povCharacter || '';
        targetScene.tense = backupScene.tense || targetScene.tense || '';
        targetScene.content = backupText;
        targetScene.updatedAt = new Date().toISOString();
      } else {
        const chapterId = (project.chapters || []).some((chapter) => chapter.id === backupScene.chapterId)
          ? backupScene.chapterId
          : (project.chapters && project.chapters[0] ? project.chapters[0].id : '');
        targetScene = {
          id: `${sceneId}-recovered-${Date.now()}`,
          chapterId,
          title: `${backupScene.title || 'Recovered Scene'} (Recovered)`,
          summary: backupScene.summary || '',
          content: backupText,
          order: (project.scenes || []).filter((scene) => scene.chapterId === chapterId).length,
          tags: Array.isArray(backupScene.tags) ? backupScene.tags : [],
          povCharacter: backupScene.povCharacter || '',
          tense: backupScene.tense || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        project.scenes = project.scenes || [];
        project.scenes.push(targetScene);
      }
      project.updatedAt = new Date().toISOString();
      const saved = await projectService.saveProject(dataRoot, project);
      jsonResponse(response, 200, {
        ok: true,
        projectId: saved.project.id,
        sceneId: targetScene.id,
        preRestoreBackup: preRestore.backup
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }


  if (request.method === 'POST' && parsedUrl.pathname === '/api/create-backup') {
    try {
      const payload = await readJsonPayload(request);
      const project = payload && payload.project;
      if (!project || typeof project !== 'object') {
        jsonResponse(response, 400, { ok: false, error: 'Missing project payload' });
        return true;
      }
      const projectId = String(project.id || '').trim();
      if (!projectId) {
        throw new Error('Project id is required');
      }
      const requestOptions = payload.backupRequest || {};
      const reason = requestOptions.reason || 'manual';
      const note = requestOptions.note || '';
      const retention = requestOptions.retention || { mode: 'count', count: 100 };
      const hash = snapshotHash(payload);
      const existing = await listBackupFiles(dataRoot, projectId);
      const latest = existing[0] ? await readBackupSummary(dataRoot, existing[0]) : null;
      if (reason === 'auto' && latest && latest.hash === hash) {
        jsonResponse(response, 200, {
          ok: true,
          skipped: true,
          backupCount: existing.length,
          backupLocation: await backupRoot(dataRoot),
          timestamp: new Date().toISOString()
        });
        return true;
      }
      const dir = await backupDir(dataRoot, projectId);
      const baseFilename = backupFilename(project, payload.exportedAt);
      const filename = `${baseFilename.slice(0, -5)}--${sanitizeFilename(reason)}.json`;
      const target = path.join(dir, filename);
      const stats = snapshotStats(payload);
      payload.localBackupSavedAt = new Date().toISOString();
      payload.localBackupVersion = 1;
      payload.backupMeta = {
        reason,
        note,
        hash,
        createdAt: payload.localBackupSavedAt,
        ...stats
      };
      await writeJsonAtomic(target, payload);
      await pruneBackups(dataRoot, projectId, retention);
      const backupCount = (await listBackupFiles(dataRoot, projectId)).length;
      jsonResponse(response, 200, {
        ok: true,
        backupId: filename,
        path: path.relative(await backupRoot(dataRoot), target).replace(/\\/g, '/'),
        timestamp: payload.localBackupSavedAt,
        backupCount,
        backupLocation: await backupRoot(dataRoot)
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/backup-location') {
    jsonResponse(response, 200, { ok: true, path: await backupRoot(dataRoot) });
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/backup-location') {
    try {
      const payload = await readJsonPayload(request);
      const settings = await readSettings(dataRoot);
      const nextPath = String(payload.path || '').trim();
      settings.backupLocation = nextPath ? path.resolve(nextPath) : '';
      await writeSettings(dataRoot, settings);
      await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
      jsonResponse(response, 200, { ok: true, path: await backupRoot(dataRoot) });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/cleanup-backups') {
    try {
      const payload = await readJsonPayload(request);
      const scope = payload.scope === 'all' ? 'all' : 'project';
      const projectId = scope === 'all' ? '' : String(payload.projectId || '').trim();
      if (scope === 'project' && !projectId) throw new Error('Missing projectId');
      const files = await listBackupFiles(dataRoot, projectId);
      for (const file of files) {
        await fsp.rm(file.filePath, { force: true });
      }
      jsonResponse(response, 200, { ok: true, deleted: files.length, backupCount: 0 });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/delete-backup') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const backupId = String(payload.backupId || '').trim();
      if (!projectId || !backupId) throw new Error('Missing projectId or backupId');
      if (path.basename(backupId) !== backupId) throw new Error('Invalid backupId');
      const target = await findBackupFile(dataRoot, projectId, backupId);
      if (target) await fsp.rm(target.filePath, { force: true });
      jsonResponse(response, 200, { ok: true, backupCount: (await listBackupFiles(dataRoot, projectId)).length });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/update-backup') {
    try {
      const payload = await readJsonPayload(request);
      const projectId = String(payload.projectId || '').trim();
      const backupId = String(payload.backupId || '').trim();
      if (!projectId || !backupId) throw new Error('Missing projectId or backupId');
      if (path.basename(backupId) !== backupId) throw new Error('Invalid backupId');
      const target = await findBackupFile(dataRoot, projectId, backupId);
      if (!target) throw new Error('Backup not found');
      const backup = JSON.parse(await fsp.readFile(target.filePath, 'utf8'));
      backup.backupMeta = { ...(backup.backupMeta || {}) };
      if (Object.prototype.hasOwnProperty.call(payload, 'pinned')) {
        backup.backupMeta.pinned = !!payload.pinned;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'note')) {
        backup.backupMeta.note = String(payload.note || '');
      }
      await writeJsonAtomic(target.filePath, backup);
      jsonResponse(response, 200, {
        ok: true,
        backup: await readBackupSummary(dataRoot, {
          root: target.root,
          filePath: target.filePath,
          name: path.basename(target.filePath),
          stats: await fsp.stat(target.filePath)
        })
      });
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message });
    }
    return true;
  }
    return false;
  };
}

module.exports = { createBackupController };
