const fs = require('fs/promises');
const path = require('path');

const { normalizeProject } = require('../../src/core/project/project-normalize');
const { projectStats } = require('../../src/core/project/project-stats');
const { writeFileAtomic, writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

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
  const {
    chapters,
    scenes,
    compendium,
    prompts,
    workshopSessions,
    workflowRuns,
    ...manifest
  } = project;
  return {
    ...manifest,
    chapterOrder: project.chapterOrder || (chapters || []).map((chapter) => chapter.id),
    sceneOrder: project.sceneOrder || (scenes || []).map((scene) => scene.id)
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

async function writeProject(projectPath, projectInput) {
  const project = normalizeProject(projectInput);
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

  await writeJsonAtomic(path.join(projectPath, 'compendium', 'entries.json'), project.compendium || []);
  await writeJsonAtomic(path.join(projectPath, 'prompts', 'prompts.json'), project.prompts || []);
  await writeJsonAtomic(path.join(projectPath, 'workshop', 'sessions.json'), project.workshopSessions || []);
  await writeJsonAtomic(path.join(projectPath, 'workflows', 'runs.json'), project.workflowRuns || []);

  return {
    project,
    projectPath
  };
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

async function readProject(projectPath) {
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

  return normalizeProject({
    ...manifest,
    chapters,
    scenes,
    compendium,
    prompts,
    workshopSessions,
    workflowRuns
  });
}

async function createProject(dataRoot, projectInput) {
  const project = normalizeProject(projectInput);
  const projectPath = paths.projectDir(dataRoot, project.id);
  if (await pathExists(projectPath)) {
    throw new Error(`Project already exists: ${project.id}`);
  }
  return writeProject(projectPath, project);
}

async function saveProject(dataRoot, projectInput) {
  const project = normalizeProject(projectInput);
  return writeProject(paths.projectDir(dataRoot, project.id), project);
}

async function openProject(dataRoot, projectId) {
  return readProject(paths.projectDir(dataRoot, projectId));
}

async function listProjects(dataRoot) {
  const root = paths.projectsRoot(dataRoot);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const summaries = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
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
  createProject,
  saveProject,
  openProject,
  listProjects,
  readProject,
  writeProject
};
