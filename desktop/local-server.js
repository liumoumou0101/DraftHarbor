const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const projectService = require('./services/project-service');
const settingsService = require('./services/settings-service');
const compendiumService = require('./services/compendium-service');
let compendiumAgentService = null;
let createCompendiumAgentRunnerService = null;
let createCompendiumAgentQaService = null;
try {
  compendiumAgentService = require('./services/compendium-agent-service');
  ({ createCompendiumAgentRunnerService } = require('./services/compendium-agent-runner-service'));
  ({ createCompendiumAgentQaService } = require('./services/compendium-agent-qa-service'));
} catch (_) {
  // The compendium agent is an optional add-on. Core desktop features must boot without it.
}
const promptService = require('./services/prompt-service');
const workshopService = require('./services/workshop-service');
const projectMigrationService = require('./services/project-migration-service');
const workflowService = require('./services/workflow-service');
const workflowTransferService = require('./services/workflow-transfer-service');
const workflowGuidedService = require('./services/workflow-guided-service');
const workflowCreationGuidedService = require('./services/workflow-creation-guided-service');
const workflowRewriteGuidedService = require('./services/workflow-rewrite-guided-service');
const workflowVariantService = require('./services/workflow-variant-service');
const workflowTemplateService = require('./services/workflow-template-service');
const projectAssetQueryService = require('./services/project-asset-query-service');
const readerLibraryService = require('./services/reader-library-service');
const readerMigrationService = require('./services/reader-migration-service');
const { createReaderTransferService } = require('./services/reader-transfer-service');
const { createReaderWriterTransferService } = require('./services/reader-writer-transfer-service');
const { createReaderCompendiumTransferService } = require('./services/reader-compendium-transfer-service'); const { createReaderCompendiumExtractorService } = require('./services/reader-compendium-extractor-service'); const { createReaderWorkflowTransferService } = require('./services/reader-workflow-transfer-service');
const projectFileStore = require('./storage/project-file-store');
const readerDocumentStore = require('./storage/reader-document-store');
const readerStateStore = require('./storage/reader-state-store');
const readerTransferStore = require('./storage/reader-transfer-store');
const { projectDir, projectsRoot } = require('./storage/library-paths');
const { legacySnapshotToProject, projectToLegacySnapshot, projectToLibrarySummary } = require('./services/project-snapshot-adapter');
const { createImportExportController } = require('./controllers/import-export-controller');
const { createBackupController } = require('./controllers/backup-controller');
const { createGenerationController } = require('./controllers/generation-controller');
const { runtimeInfo, installLlamaCpp, pathExists, requestJson, downloadFile, runCommand } = require('./services/runtime-service');
const { createHttpTestServer } = require('./protocol/http-test-server');
const { serveStatic } = require('./services/static-file-service');
const { createController: createRuntimeController } = require('./controllers/runtime-controller');
const { createController: createSettingsController } = require('./controllers/settings-controller');
const { createController: createProjectController } = require('./controllers/project-controller');
const { createController: createKnowledgeController } = require('./controllers/knowledge-controller');
const { createController: createWorkshopController } = require('./controllers/workshop-controller');
const { createController: createWorkflowController } = require('./controllers/workflow-controller');
const { createController: createReaderController } = require('./controllers/reader-controller');
const { createController: createReaderWriterController } = require('./controllers/reader-writer-controller');

const HOST = '127.0.0.1';
const readerTransferService = createReaderTransferService({
  transferStore: readerTransferStore,
  readerStore: readerDocumentStore,
  projectStore: projectFileStore
});
function sanitizeFilename(value) {
  const safe = String(value || '')
    // Control characters are intentionally stripped from user-visible filenames.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ .]+$/g, '');
  return (safe.slice(0, 80) || 'project');
}

function projectFilename(project) {
  const projectId = String(project.id || '').trim();
  if (!projectId) {
    throw new Error('Project id is required');
  }
  return `${sanitizeFilename(project.name || 'project')}--${projectId}.json`;
}

function backupFilename(project, exportedAt) {
  const projectId = String(project.id || '').trim();
  if (!projectId) {
    throw new Error('Project id is required');
  }
  const timestamp = String(exportedAt || new Date().toISOString())
    .replace(/:/g, '-')
    .replace(/\./g, '-')
    .replace('+00:00', 'Z');
  return `${timestamp}--${sanitizeFilename(project.name || 'project')}--${sanitizeFilename(projectId)}.json`;
}

async function readSettings(dataRoot) {
  return settingsService.readSettings(dataRoot);
}

async function writeSettings(dataRoot, settings) {
  return settingsService.writeSettings(dataRoot, settings);
}

async function backupRoot(dataRoot) {
  const settings = await readSettings(dataRoot);
  return settingsService.backupRoot(dataRoot, settings);
}

async function projectSaveRoot(dataRoot) {
  const settings = await readSettings(dataRoot);
  return settingsService.projectSaveRoot(dataRoot, settings);
}

async function backupDir(dataRoot, projectId) {
  return path.join(await backupRoot(dataRoot), sanitizeFilename(projectId));
}

function legacyBackupRoot(dataRoot) {
  return path.join(dataRoot, 'project-backups');
}

async function backupSearchRoots(dataRoot) {
  const roots = [await backupRoot(dataRoot), legacyBackupRoot(dataRoot)];
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

async function findBackupFile(dataRoot, projectId, backupId) {
  for (const root of await backupSearchRoots(dataRoot)) {
    const filePath = path.join(root, sanitizeFilename(projectId), backupId);
    if (await pathExists(filePath)) {
      const stats = await fsp.stat(filePath);
      return { root, dir: path.dirname(filePath), filePath, name: backupId, stats };
    }
  }
  return null;
}

function jsonResponse(response, statusCode, payload, cors = false) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...(cors ? corsHeaders() : {})
  });
  response.end(body);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function readJsonPayload(request) {
  const body = await readBody(request);
  if (body.length === 0) {
    throw new Error('Request body is required');
  }
  return JSON.parse(body.toString('utf8'));
}

async function writeJsonAtomic(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  await fsp.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fsp.rename(tempPath, filePath);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function snapshotHash(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  delete clone.backupRequest;
  delete clone.backupMeta;
  delete clone.localBackupSavedAt;
  delete clone.localBackupVersion;
  return crypto.createHash('sha256').update(stableStringify(clone)).digest('hex');
}

function snapshotStats(payload) {
  const sceneContents = payload.sceneContents || {};
  const wordCount = Object.values(sceneContents).reduce((total, text) => {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    return total + words.length;
  }, 0);
  return {
    chapterCount: Array.isArray(payload.chapters) ? payload.chapters.length : 0,
    sceneCount: Array.isArray(payload.scenes) ? payload.scenes.length : 0,
    wordCount
  };
}

function fileResponse(response, statusCode, payload, cors = false) {
  const body = Buffer.isBuffer(payload.body) ? payload.body : Buffer.from(String(payload.body || ''), 'utf8');
  const filename = String(payload.filename || 'download').replace(/[\r\n"]/g, '');
  const asciiFilename = sanitizeFilename(filename.replace(/[^\x20-\x7E]+/g, '_')) || 'download';
  const encodedFilename = encodeURIComponent(filename);
  response.writeHead(statusCode, {
    'Content-Type': payload.mimeType || 'application/octet-stream',
    'Content-Length': body.length,
    'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    ...(cors ? corsHeaders() : {})
  });
  response.end(body);
}

async function readProjectSummary(dataRoot, file) {
  let payload = {};
  let parseError = '';
  try {
    payload = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
  } catch (error) {
    parseError = error.message || 'Invalid JSON';
    payload = {};
  }

  const project = payload.project || {};
  const stats = snapshotStats(payload);
  const projectId = project.id ? String(project.id) : path.basename(file.name, '.json');
  const timestamp = payload.filesystemSavedAt || payload.exportedAt || project.modified || file.stats.mtime.toISOString();

  return {
    id: projectId,
    name: project.name ? String(project.name) : path.basename(file.name, '.json'),
    description: typeof project.description === 'string' ? project.description : '',
    status: typeof project.status === 'string' ? project.status : '',
    tags: Array.isArray(project.tags) ? project.tags.filter((tag) => typeof tag === 'string').slice(0, 20) : [],
    coverImage: typeof project.coverImage === 'string' ? project.coverImage : '',
    created: project.created || '',
    modified: project.modified || '',
    timestamp,
    absolutePath: file.filePath,
    path: path.relative(await projectSaveRoot(dataRoot), file.filePath).replace(/\\/g, '/'),
    filename: file.name,
    size: file.stats.size,
    chapterCount: stats.chapterCount,
    sceneCount: stats.sceneCount,
    wordCount: stats.wordCount,
    health: parseError ? 'invalid' : 'ok',
    healthMessage: parseError
  };
}

function normalizeProjectMetadata(payload) {
  const metadata = payload && typeof payload === 'object' ? payload : {};
  const name = String(metadata.name || '').trim();
  if (!name) {
    throw new Error('Project name is required');
  }

  const tags = Array.isArray(metadata.tags)
    ? metadata.tags
    : String(metadata.tags || '').split(',');

  return {
    name: name.slice(0, 120),
    description: String(metadata.description || '').trim().slice(0, 2000),
    status: String(metadata.status || '').trim().slice(0, 40),
    tags: tags
      .map((tag) => String(tag || '').trim())
      .filter(Boolean)
      .slice(0, 20),
    coverImage: String(metadata.coverImage || '').trim().slice(0, 4000000)
  };
}

async function listProjectFiles(dataRoot) {
  const root = await projectSaveRoot(dataRoot);
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
      const filePath = path.join(root, entry.name);
      files.push({ filePath, name: entry.name, stats: await fsp.stat(filePath) });
    }
    return files.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  } catch {
    return [];
  }
}

async function findProjectFile(dataRoot, projectId, filename) {
  const files = await listProjectFiles(dataRoot);
  const requestedFilename = filename ? path.basename(filename) : '';
  if (requestedFilename) {
    return files.find((file) => file.name === requestedFilename) || null;
  }

  const requestedProjectId = String(projectId || '').trim();
  if (!requestedProjectId) return null;

  for (const file of files) {
    try {
      const payload = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
      if (payload.project && String(payload.project.id) === requestedProjectId) return file;
    } catch {
      // Ignore unreadable files while looking for a matching project.
    }
  }
  return null;
}

async function readDirectoryProject(dataRoot, projectId) {
  const requestedProjectId = String(projectId || '').trim();
  if (!requestedProjectId) return null;
  try {
    return await projectFileStore.openProject(dataRoot, requestedProjectId);
  } catch {
    return null;
  }
}

async function listDirectoryProjectSummaries(dataRoot) {
  const summaries = [];
  for (const summary of await projectFileStore.listProjects(dataRoot)) {
    if (summary.health !== 'ok') {
      summaries.push({
        id: summary.id,
        name: summary.title,
        description: summary.description || '',
        status: summary.status || '',
        tags: summary.tags || [],
        coverImage: '',
        created: '',
        modified: summary.updatedAt || '',
        timestamp: summary.updatedAt || '',
        absolutePath: summary.projectPath,
        path: summary.projectPath,
        filename: '',
        source: 'project-directory',
        size: 0,
        chapterCount: 0,
        sceneCount: 0,
        wordCount: 0,
        health: summary.health,
        healthMessage: summary.healthMessage || ''
      });
      continue;
    }

    try {
      const project = await projectFileStore.openProject(dataRoot, summary.id);
      summaries.push(projectToLibrarySummary(project, summary.projectPath, projectsRoot(dataRoot)));
    } catch (error) {
      summaries.push({
        id: summary.id,
        name: summary.title || summary.id,
        description: '',
        status: '',
        tags: [],
        coverImage: '',
        created: '',
        modified: summary.updatedAt || '',
        timestamp: summary.updatedAt || '',
        absolutePath: summary.projectPath,
        path: summary.projectPath,
        filename: '',
        source: 'project-directory',
        size: 0,
        chapterCount: 0,
        sceneCount: 0,
        wordCount: 0,
        health: 'invalid',
        healthMessage: error.message || String(error)
      });
    }
  }
  return summaries;
}

function createProjectSnapshot(metadata) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const chapterId = `${id}-chapter-1`;
  const sceneId = `${id}-scene-1`;
  const project = {
    id,
    name: metadata.name,
    description: metadata.description || '',
    status: metadata.status || '',
    tags: metadata.tags || [],
    coverImage: metadata.coverImage || '',
    created: now,
    modified: now,
    updatedAt: Date.now()
  };

  return {
    version: '2.1-desktop',
    exportedAt: now,
    filesystemSavedAt: now,
    filesystemSaveVersion: 1,
    project,
    chapters: [{
      id: chapterId,
      projectId: id,
      title: '第一章',
      order: 0,
      created: now,
      modified: now,
      updatedAt: Date.now()
    }],
    scenes: [{
      id: sceneId,
      projectId: id,
      chapterId,
      title: '第一场',
      order: 0,
      created: now,
      modified: now,
      updatedAt: Date.now()
    }],
    sceneContents: {
      [sceneId]: ''
    },
    compendium: [],
    prompts: [],
    codex: [],
    promptHistory: [],
    workshopSessions: []
  };
}

async function uniqueFilePath(dir, filename) {
  let target = path.join(dir, filename);
  if (!(await pathExists(target))) return target;

  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let index = 2;
  while (await pathExists(target)) {
    target = path.join(dir, `${base}-${index}${ext}`);
    index += 1;
  }
  return target;
}

async function uniqueRestoredProjectId(dataRoot, baseId) {
  const cleanBase = sanitizeFilename(baseId || `recovered-${Date.now()}`) || `recovered-${Date.now()}`;
  let id = `${cleanBase}-recovered`;
  let index = 2;
  while (await pathExists(projectDir(dataRoot, id))) {
    id = `${cleanBase}-recovered-${index}`;
    index += 1;
  }
  return id;
}

function cloneBackupAsNewProjectSnapshot(backup, nextId) {
  const now = new Date().toISOString();
  const sourceProject = backup.project || {};
  const oldId = String(sourceProject.id || nextId);
  const chapterIdMap = new Map();
  const sceneIdMap = new Map();

  const chapters = (backup.chapters || []).map((chapter, index) => {
    const id = `chapter-${nextId}-${index + 1}`;
    chapterIdMap.set(chapter.id, id);
    return {
      ...chapter,
      id,
      projectId: nextId,
      created: chapter.created || now,
      modified: now,
      updatedAt: Date.now()
    };
  });

  const fallbackChapterId = chapters[0] ? chapters[0].id : `chapter-${nextId}-1`;
  const scenes = (backup.scenes || []).map((scene, index) => {
    const id = `scene-${nextId}-${index + 1}`;
    sceneIdMap.set(scene.id, id);
    return {
      ...scene,
      id,
      projectId: nextId,
      chapterId: chapterIdMap.get(scene.chapterId) || fallbackChapterId,
      created: scene.created || now,
      modified: now,
      updatedAt: Date.now()
    };
  });

  const sceneContents = {};
  for (const [oldSceneId, text] of Object.entries(backup.sceneContents || {})) {
    sceneContents[sceneIdMap.get(oldSceneId) || oldSceneId] = text;
  }

  return {
    ...backup,
    version: '3.0-restored-project',
    exportedAt: now,
    filesystemSavedAt: now,
    project: {
      ...sourceProject,
      id: nextId,
      name: `${sourceProject.name || sourceProject.title || oldId} (Recovered)`,
      title: `${sourceProject.title || sourceProject.name || oldId} (Recovered)`,
      created: now,
      modified: now,
      updatedAt: Date.now()
    },
    chapters,
    scenes,
    sceneContents,
    currentSceneId: scenes[0] ? scenes[0].id : '',
    backupRequest: undefined,
    backupMeta: undefined
  };
}

function backupDiffSummary(currentSnapshot, backup) {
  const currentContents = currentSnapshot && currentSnapshot.sceneContents ? currentSnapshot.sceneContents : {};
  const backupContents = backup && backup.sceneContents ? backup.sceneContents : {};
  const ids = new Set([...Object.keys(currentContents), ...Object.keys(backupContents)]);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  const scenes = [];
  for (const id of ids) {
    const currentText = currentContents[id];
    const backupText = backupContents[id];
    let status = 'unchanged';
    if (currentText === undefined) status = 'added';
    else if (backupText === undefined) status = 'removed';
    else if (String(currentText) !== String(backupText)) status = 'changed';
    if (status === 'added') added += 1;
    else if (status === 'removed') removed += 1;
    else if (status === 'changed') changed += 1;
    else unchanged += 1;
    scenes.push({
      id,
      status,
      currentLength: String(currentText || '').length,
      backupLength: String(backupText || '').length
    });
  }
  return { added, removed, changed, unchanged, scenes };
}

async function createPreRestoreBackup(dataRoot, projectId, note, reason = 'before-restore') {
  const currentProject = await projectService.openProject(dataRoot, projectId);
  const requestPayload = {
    ...projectToLegacySnapshot(currentProject.project),
    backupRequest: {
      reason,
      note,
      retention: { mode: 'count', count: 100 }
    }
  };
  const dir = await backupDir(dataRoot, projectId);
  await fsp.mkdir(dir, { recursive: true });
  const filename = `${backupFilename(requestPayload.project, requestPayload.exportedAt).slice(0, -5)}--${sanitizeFilename(reason)}.json`;
  const target = await uniqueFilePath(dir, filename);
  const stats = snapshotStats(requestPayload);
  requestPayload.localBackupSavedAt = new Date().toISOString();
  requestPayload.localBackupVersion = 1;
  requestPayload.backupMeta = {
    reason,
    note,
    hash: snapshotHash(requestPayload),
    createdAt: requestPayload.localBackupSavedAt,
    ...stats
  };
  await writeJsonAtomic(target, requestPayload);
  return {
    currentProject: currentProject.project,
    backup: {
      backupId: path.basename(target),
      path: path.relative(await backupRoot(dataRoot), target).replace(/\\/g, '/')
    }
  };
}

async function listBackupFiles(dataRoot, projectId = '') {
  const dirs = [];
  for (const root of await backupSearchRoots(dataRoot)) {
    if (projectId) {
      dirs.push({ root, dir: path.join(root, sanitizeFilename(projectId)) });
      continue;
    }
    try {
      const entries = await fsp.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) dirs.push({ root, dir: path.join(root, entry.name) });
      }
    } catch {
      // This backup root may not exist yet.
    }
  }

  const files = [];
  const seen = new Set();
  for (const { root, dir } of dirs) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const filePath = path.join(dir, entry.name);
          const key = path.resolve(filePath).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          files.push({ root, dir, filePath, name: entry.name, stats: await fsp.stat(filePath) });
        }
      }
    } catch {
      // No backups for this project yet.
    }
  }
  return files.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
}

async function readBackupSummary(dataRoot, file) {
  let payload = {};
  let parseError = '';
  try {
    payload = JSON.parse(await fsp.readFile(file.filePath, 'utf8'));
  } catch (error) {
    parseError = error.message || 'Invalid JSON';
    payload = {};
  }
  const meta = payload.backupMeta || {};
  const stats = snapshotStats(payload);
  const healthy = !parseError && !!(payload.project && payload.project.id) && Array.isArray(payload.chapters) && Array.isArray(payload.scenes) && !!payload.sceneContents;
  return {
    id: file.name,
    projectId: payload.project && payload.project.id ? String(payload.project.id) : '',
    projectName: payload.project && payload.project.name ? String(payload.project.name) : '',
    timestamp: meta.createdAt || file.stats.mtime.toISOString(),
    path: path.relative(file.root || await backupRoot(dataRoot), file.filePath).replace(/\\/g, '/'),
    size: file.stats.size,
    reason: meta.reason || 'manual',
    note: meta.note || '',
    pinned: !!meta.pinned,
    hash: meta.hash || '',
    chapterCount: meta.chapterCount || stats.chapterCount,
    sceneCount: meta.sceneCount || stats.sceneCount,
    wordCount: meta.wordCount || stats.wordCount,
    health: healthy ? 'ok' : 'invalid',
    healthMessage: healthy ? '' : (parseError || 'Backup is missing required project data')
  };
}

async function backupIsPinned(dataRoot, file) {
  try {
    const summary = await readBackupSummary(dataRoot, file);
    return !!summary.pinned;
  } catch {
    return false;
  }
}

async function pruneBackups(dataRoot, projectId, retention) {
  const mode = retention && retention.mode ? retention.mode : 'count';
  if (mode === 'all') return 0;

  const files = await listBackupFiles(dataRoot, projectId);
  const unpinnedFiles = [];
  for (const file of files) {
    if (!(await backupIsPinned(dataRoot, file))) {
      unpinnedFiles.push(file);
    }
  }

  let toDelete = [];
  if (mode === 'days') {
    const days = Math.max(1, Number(retention.days || 30));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    toDelete = unpinnedFiles.filter((file) => file.stats.mtimeMs < cutoff);
  } else {
    const count = Math.max(1, Number(retention && retention.count || 100));
    toDelete = unpinnedFiles.slice(count);
  }

  for (const file of toDelete) {
    await fsp.rm(file.filePath, { force: true });
  }
  return toDelete.length;
}


const handleImportExport = createImportExportController({
  migrationService: projectMigrationService,
  readJsonPayload,
  readBody,
  jsonResponse,
  fileResponse,
  projectToLegacySnapshot,
  projectToLibrarySummary,
  projectsRoot,
  projectSaveRoot
});

const handleBackupApi = createBackupController({
  jsonResponse, backupRoot, listBackupFiles, readBackupSummary, findBackupFile,
  projectService, projectToLegacySnapshot, backupDiffSummary, readJsonPayload,
  uniqueRestoredProjectId, cloneBackupAsNewProjectSnapshot, createPreRestoreBackup,
  legacySnapshotToProject, snapshotHash, backupDir, backupFilename, sanitizeFilename,
  snapshotStats, writeJsonAtomic, pruneBackups, readSettings, writeSettings
});

const handleGenerationApi = createGenerationController({ settingsService, readSettings, readJsonPayload, jsonResponse });

const handleRuntimeApi = createRuntimeController({ runtimeInfo, installLlamaCpp, readJsonPayload, jsonResponse });
const handleSettingsApi = createSettingsController({ settingsService, readSettings, writeSettings, projectSaveRoot, backupRoot, readJsonPayload, jsonResponse });
const handleProjectApi = createProjectController({
  readProjectSummary, listDirectoryProjectSummaries, listProjectFiles, readDirectoryProject,
  findProjectFile, projectSaveRoot, projectsRoot, projectDir, projectService,
  normalizeProjectMetadata, projectToLegacySnapshot, projectToLibrarySummary,
  legacySnapshotToProject, readJsonPayload, jsonResponse, readSettings, writeSettings,
  backupRoot, projectFilename, writeJsonAtomic, uniqueFilePath
});
const compendiumAgentRunnerService = compendiumAgentService && createCompendiumAgentRunnerService
  ? createCompendiumAgentRunnerService({ settingsService, compendiumAgentService })
  : null;
const compendiumAgentQaService = compendiumAgentService && createCompendiumAgentQaService
  ? createCompendiumAgentQaService({ settingsService, compendiumAgentService })
  : null;
const readerCompendiumTransferService = createReaderCompendiumTransferService({ readerTransferService, compendiumService, projectService, extractor: createReaderCompendiumExtractorService({ settingsService }), createBackup: createPreRestoreBackup });
const handleKnowledgeApi = createKnowledgeController({
  compendiumService, compendiumAgentService, compendiumAgentRunnerService, compendiumAgentQaService, readerCompendiumTransferService, projectAssetQueryService, promptService, readJsonPayload, jsonResponse,
  readSettings, createPreRestoreBackup
});
const handleWorkshopApi = createWorkshopController({ workshopService, readJsonPayload, jsonResponse });
const readerWorkflowTransferService = createReaderWorkflowTransferService({ readerTransferService, projectService, workflowGuidedService, workflowRewriteGuidedService }); const handleWorkflowApi = createWorkflowController({ workflowService, workflowTransferService, workflowGuidedService, workflowCreationGuidedService, workflowRewriteGuidedService, workflowVariantService, workflowTemplateService, readerWorkflowTransferService, createPreRestoreBackup, readJsonPayload, jsonResponse });
const handleReaderApi = createReaderController({
  readerStore: readerDocumentStore,
  readerStateStore,
  readerLibraryService,
  readerMigrationService,
  readerTransferService,
  readJsonPayload,
  jsonResponse
});
const readerWriterTransferService = createReaderWriterTransferService({ readerTransferService, projectService, createBackup: createPreRestoreBackup });
const handleReaderWriterApi = createReaderWriterController({ readerWriterTransferService, readJsonPayload, jsonResponse });

async function handleAppApi(request, response, appRoot, dataRoot, parsedUrl, integrations = {}) {
  if (await handleBackupApi(request, response, dataRoot, parsedUrl)) return true;
  if (await handleGenerationApi(request, response, dataRoot, parsedUrl)) return true;
  if (await handleRuntimeApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;
  if (await handleSettingsApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;
  if (await handleImportExport(request, response, dataRoot, parsedUrl)) return true;
  if (await handleProjectApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;
  if (await handleKnowledgeApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;
  if (await handleWorkshopApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;
  if (await handleWorkflowApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;
  if (await handleReaderWriterApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;
  if (await handleReaderApi(request, response, appRoot, dataRoot, parsedUrl, integrations)) return true;

  return false;
}

const { handleUpdaterApi } = require('./controllers/update-controller').createUpdateController({
  runCommand,
  requestJson,
  downloadFile,
  writeJsonAtomic,
  pathExists,
  jsonResponse,
  corsHeaders
});

const { createDesktopProtocolHandler } = require('./protocol/protocol-router').createProtocolRouter({
  backupRoot,
  projectSaveRoot,
  readSettings,
  writeSettings,
  handleAppApi,
  handleUpdaterApi
});

const { startDesktopServers } = createHttpTestServer({
  projectSaveRoot, backupRoot, readJsonPayload, readSettings, writeSettings, jsonResponse,
  handleAppApi, serveStatic, handleUpdaterApi
});


module.exports = {
  startDesktopServers,
  createDesktopProtocolHandler
};
