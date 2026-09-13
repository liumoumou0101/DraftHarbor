const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const { normalizeProject } = require('../../src/core/project/project-normalize');
const { projectStats } = require('../../src/core/project/project-stats');
const { writeFileAtomic, writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');
const { withProjectWriteLock } = require('./project-write-lock');

class ProjectConflictError extends Error {
  constructor(message = 'Project has changed; reload it before saving') {
    super(message);
    this.name = 'ProjectConflictError';
    this.statusCode = 409;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function revisionForWriter(project) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue({
    ...manifestFromProject(project), chapters: project.chapters, scenes: project.scenes
  }))).digest('hex');
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function manifestFromProject(project) {
  const manifest = { ...project };
  delete manifest.chapters;
  delete manifest.scenes;
  delete manifest.compendium;
  delete manifest.prompts;
  delete manifest.workshopSessions;
  delete manifest.workflowRuns;
  delete manifest.writerRevision;
  return {
    ...manifest,
    chapterOrder: project.chapterOrder || (project.chapters || []).map((chapter) => chapter.id),
    sceneOrder: project.sceneOrder || (project.scenes || []).map((scene) => scene.id)
  };
}

async function ensureProjectDirs(projectPath) {
  await fs.mkdir(paths.chaptersDir(projectPath), { recursive: true });
  await fs.mkdir(paths.scenesDir(projectPath), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'compendium'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'prompts'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'workshop'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'workflows', 'runs'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'backups'), { recursive: true });
}

async function pruneOwnedProjectFiles(directory, allowedNames) {
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isFile() && !allowedNames.has(entry.name)) await fs.rm(path.join(directory, entry.name), { force: true });
  }
}

async function writeProjectUnlocked(projectPath, projectInput, options) {
  const project = normalizeProject(projectInput);
  if (options.expectedWriterRevision !== undefined) {
    let current;
    try { current = await readProjectUnlocked(projectPath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (options.expectedWriterRevision !== (current ? current.writerRevision : '')) throw new ProjectConflictError();
  }
  const dedicated = [
    ['compendium', path.join(projectPath, 'compendium', 'entries.json')],
    ['prompts', path.join(projectPath, 'prompts', 'prompts.json')],
    ['workshopSessions', path.join(projectPath, 'workshop', 'sessions.json')]
  ];
  const dedicatedWrites = [];
  for (const [field, target] of dedicated) {
    if (options.replaceDedicatedStores === true) dedicatedWrites.push([target, project[field] || []]);
    else {
      try { project[field] = await readJson(target); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        dedicatedWrites.push([target, project[field] || []]);
      }
    }
  }
  await ensureProjectDirs(projectPath);
  await writeJsonAtomic(paths.manifestPath(projectPath), manifestFromProject(project));

  for (const chapter of project.chapters) {
    await writeJsonAtomic(paths.chapterPath(projectPath, chapter.id), chapter);
  }

  for (const scene of project.scenes) {
    const { content, ...meta } = scene;
    await writeJsonAtomic(paths.sceneMetaPath(projectPath, scene.id), meta);
    await writeFileAtomic(paths.sceneMarkdownPath(projectPath, scene.id), content || '', 'utf8');
  }

  await pruneOwnedProjectFiles(paths.chaptersDir(projectPath), new Set(project.chapters.map((chapter) => path.basename(paths.chapterPath(projectPath, chapter.id)))));
  await pruneOwnedProjectFiles(paths.scenesDir(projectPath), new Set(project.scenes.flatMap((scene) => [
    path.basename(paths.sceneMetaPath(projectPath, scene.id)),
    path.basename(paths.sceneMarkdownPath(projectPath, scene.id))
  ])));

  for (const [target, value] of dedicatedWrites) await writeJsonAtomic(target, value);
  // Workflow files are owned by their dedicated Store. A project-wide save may
  // carry an old in-memory workflowRuns snapshot, but must never overwrite it.

  project.writerRevision = revisionForWriter(project);
  return {
    project,
    writerRevision: project.writerRevision,
    projectPath
  };
}

async function writeProject(projectPath, projectInput, options = {}) {
  const effectiveOptions = { ...options };
  if (effectiveOptions.expectedWriterRevision === undefined && options.replaceDedicatedStores !== true && projectInput.writerRevision !== undefined) {
    effectiveOptions.expectedWriterRevision = projectInput.writerRevision;
  }
  return withProjectWriteLock(projectPath, () => writeProjectUnlocked(projectPath, projectInput, effectiveOptions));
}

async function readDirJsonFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'));
    const result = [];
    for (const file of files) {
      result.push(await readJson(path.join(dir, file.name)));
    }
    return result;
  } catch {
    return [];
  }
}

async function readScenes(projectPath) {
  let metas = [];
  try {
    const entries = await fs.readdir(paths.scenesDir(projectPath), { withFileTypes: true });
    const metaFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.meta.json'));
    for (const file of metaFiles) {
      metas.push(await readJson(path.join(paths.scenesDir(projectPath), file.name)));
    }
  } catch {
    metas = [];
  }

  const scenes = [];
  for (const meta of metas) {
    let content = '';
    try {
      content = await fs.readFile(paths.sceneMarkdownPath(projectPath, meta.id), 'utf8');
    } catch {
      content = '';
    }
    scenes.push({ ...meta, content });
  }
  return scenes;
}

async function readProjectUnlocked(projectPath) {
  const manifest = await readJson(paths.manifestPath(projectPath));
  const chapters = await readDirJsonFiles(paths.chaptersDir(projectPath));
  const scenes = await readScenes(projectPath);
  let compendium = [];
  let prompts = [];
  let workshopSessions = [];
  let workflowRuns = [];

  try { compendium = await readJson(path.join(projectPath, 'compendium', 'entries.json')); } catch { compendium = []; }
  try { prompts = await readJson(path.join(projectPath, 'prompts', 'prompts.json')); } catch { prompts = []; }
  try { workshopSessions = await readJson(path.join(projectPath, 'workshop', 'sessions.json')); } catch { workshopSessions = []; }
  try { workflowRuns = await readJson(path.join(projectPath, 'workflows', 'runs.json')); } catch { workflowRuns = []; }

  const project = normalizeProject({
    ...manifest,
    chapters,
    scenes,
    compendium,
    prompts,
    workshopSessions,
    workflowRuns
  });
  project.writerRevision = revisionForWriter(project);
  return project;
}

async function readProject(projectPath) {
  return withProjectWriteLock(projectPath, () => readProjectUnlocked(projectPath));
}

async function createProject(dataRoot, projectInput) {
  const project = normalizeProject(projectInput);
  const projectPath = paths.projectDir(dataRoot, project.id);
  return withProjectWriteLock(projectPath, async () => {
    if (await pathExists(projectPath)) throw new Error(`Project already exists: ${project.id}`);
    return writeProjectUnlocked(projectPath, project, {});
  });
}

async function saveProject(dataRoot, projectInput, options = {}) {
  const project = normalizeProject(projectInput);
  return writeProject(paths.projectDir(dataRoot, project.id), { ...project, writerRevision: projectInput.writerRevision }, options);
}

async function openProject(dataRoot, projectId) {
  return readProject(paths.projectDir(dataRoot, projectId));
}

function isReservedProjectDirectory(name) {
  return name === 'backups' || name === '.removed-projects' || name.startsWith('.');
}

async function listProjects(dataRoot) {
  const root = paths.projectsRoot(dataRoot);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const summaries = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || isReservedProjectDirectory(entry.name)) continue;
      const projectPath = path.join(root, entry.name);
      const manifestFile = paths.manifestPath(projectPath);
      const stats = await fs.stat(projectPath);
      try {
        const project = await readProject(projectPath);
        summaries.push({
          id: project.id,
          title: project.title,
          description: project.description,
          status: project.status,
          tags: project.tags,
          updatedAt: project.updatedAt,
          projectPath,
          health: 'ok',
          ...projectStats(project)
        });
      } catch (error) {
        summaries.push({
          id: entry.name,
          title: entry.name,
          description: '',
          status: '',
          tags: [],
          updatedAt: stats.mtime.toISOString(),
          projectPath,
          health: await pathExists(manifestFile) ? 'invalid' : 'missing-manifest',
          healthMessage: error.message || String(error),
          chapterCount: 0,
          sceneCount: 0,
          wordCount: 0
        });
      }
    }
    return summaries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } catch {
    return [];
  }
}

module.exports = {
  ProjectConflictError,
  revisionForWriter,
  createProject,
  saveProject,
  openProject,
  listProjects,
  readProject,
  writeProject
};
