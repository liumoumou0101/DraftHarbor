const fs = require('fs/promises');
const path = require('path');
const { normalizeProject } = require('../../src/core/project/project-normalize');
const CompendiumSchema = require('../../src/core/knowledge/compendium-schema');
const WorkshopSchema = require('../../src/core/workshop/workshop-schema');
const { revisionForWriter } = require('./project-file-store');
const { withProjectWriteLock } = require('./project-write-lock');
const paths = require('./library-paths');

function boundaryError(message, statusCode = 400) {
  return Object.assign(new Error(message), { name: 'WorkshopProjectBoundaryError', statusCode });
}

function safeIdentifier(value, label) {
  if (typeof value !== 'string' || !value || value !== paths.sanitizePathSegment(value)
      || value.startsWith('.')) throw boundaryError(`${label} is invalid`);
  return value;
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

// This is the Agent's file boundary, not a general project loader. Never follow
// links, even to another project inside this library, and read only tool inputs.
async function checkedPath(projectPath, projectReal, target, optional = false) {
  if (!inside(projectPath, target)) throw boundaryError('Agent file must belong to the current project');
  const relative = path.relative(projectPath, target);
  let cursor = projectPath;
  for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) cursor = path.join(cursor, segment);
    let stat;
    try { stat = await fs.lstat(cursor); } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw boundaryError('Agent project files cannot be symbolic links or junctions');
    if (!stat.isFile() && !stat.isDirectory()) throw boundaryError('Agent project inputs must be regular files or directories');
  }
  if (!inside(projectReal, await fs.realpath(target))) throw boundaryError('Agent file resolves outside the current project');
  return target;
}

async function jsonFile(projectPath, projectReal, target, fallback) {
  if (!await checkedPath(projectPath, projectReal, target, fallback !== undefined)) return fallback;
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

function objectArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw boundaryError(`${label} file is invalid`);
  }
  return value;
}

async function readWorkshopProjectContext(dataRoot, { projectId, sessionId } = {}) {
  safeIdentifier(projectId, 'projectId');
  safeIdentifier(sessionId, 'sessionId');
  const projectPath = paths.projectDir(dataRoot, projectId);
  return withProjectWriteLock(projectPath, async () => {
    if ((await fs.lstat(projectPath)).isSymbolicLink()) throw boundaryError('Agent project directory cannot be a symbolic link or junction');
    const libraryReal = await fs.realpath(paths.projectsRoot(dataRoot));
    const projectReal = await fs.realpath(projectPath);
    if (!inside(libraryReal, projectReal) || libraryReal === projectReal) throw boundaryError('Agent project must belong to the current library');
    const manifest = await jsonFile(projectPath, projectReal, paths.manifestPath(projectPath));
    if (!manifest || manifest.id !== projectId) throw boundaryError('project identity does not match its directory');

    const chapterDirectory = paths.chaptersDir(projectPath);
    await checkedPath(projectPath, projectReal, chapterDirectory);
    const chapters = [];
    for (const item of await fs.readdir(chapterDirectory, { withFileTypes: true })) {
      if (!item.name.toLowerCase().endsWith('.json')) continue;
      const chapter = await jsonFile(projectPath, projectReal, path.join(chapterDirectory, item.name));
      safeIdentifier(chapter && chapter.id, 'chapterId');
      if (path.basename(paths.chapterPath(projectPath, chapter.id)) !== item.name) throw boundaryError('chapter identity does not match its file');
      chapters.push(chapter);
    }
    if (!chapters.length) throw boundaryError('project has no readable chapters');

    const sceneDirectory = paths.scenesDir(projectPath);
    await checkedPath(projectPath, projectReal, sceneDirectory);
    const scenes = [];
    for (const item of await fs.readdir(sceneDirectory, { withFileTypes: true })) {
      if (!item.name.toLowerCase().endsWith('.meta.json')) continue;
      const meta = await jsonFile(projectPath, projectReal, path.join(sceneDirectory, item.name));
      safeIdentifier(meta && meta.id, 'sceneId');
      if (path.basename(paths.sceneMetaPath(projectPath, meta.id)) !== item.name) throw boundaryError('scene identity does not match its file');
      const markdownPath = paths.sceneMarkdownPath(projectPath, meta.id);
      await checkedPath(projectPath, projectReal, markdownPath);
      scenes.push({ ...meta, content: await fs.readFile(markdownPath, 'utf8') });
    }

    const rawEntries = objectArray(await jsonFile(projectPath, projectReal, path.join(projectPath, 'compendium', 'entries.json'), []), 'compendium');
    if (rawEntries.some((entry) => entry.projectId && entry.projectId !== projectId)) throw boundaryError('compendium entry belongs to another project');
    const entries = CompendiumSchema.normalizeCompendiumEntries(rawEntries, projectId);
    const rawSessions = objectArray(await jsonFile(projectPath, projectReal, path.join(projectPath, 'workshop', 'sessions.json'), []), 'workshop');
    if (rawSessions.some((session) => session.projectId && session.projectId !== projectId)) throw boundaryError('discussion session belongs to another project');
    const sessions = WorkshopSchema.normalizeWorkshopSessions(rawSessions, projectId);
    const session = sessions.find((item) => item.id === sessionId && item.projectId === projectId);
    if (!session) throw boundaryError('discussion session does not exist in the current project', 409);
    const project = normalizeProject({ ...manifest, chapters, scenes, compendium: entries, workshopSessions: sessions });
    project.writerRevision = revisionForWriter(project);
    return { projectPath, project, entries, session };
  });
}

// Full-project backups use the ordinary project loader, which also reads these
// dedicated stores. They are not Agent context, but must not be a link bypass
// when an apply requests a regular backup for the recovery UI.
async function assertWorkshopBackupSources(projectPath) {
  const projectReal = await fs.realpath(projectPath);
  for (const relative of ['prompts/prompts.json', 'workflows/runs.json']) {
    await checkedPath(projectPath, projectReal, path.join(projectPath, relative), true);
  }
}

module.exports = { readWorkshopProjectContext, assertWorkshopBackupSources };
