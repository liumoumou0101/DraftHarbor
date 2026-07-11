const fs = require('fs/promises');
const path = require('path');

const { createProject: createProjectModel } = require('../../src/core/project/project-schema');
const projectStore = require('../storage/project-file-store');
const { projectDir, projectsRoot, sanitizePathSegment } = require('../storage/library-paths');

async function createProject(dataRoot, input = {}) {
  const project = createProjectModel(input);
  const result = await projectStore.createProject(dataRoot, project);
  return {
    ok: true,
    project: result.project,
    projectPath: result.projectPath
  };
}

async function saveProject(dataRoot, project) {
  const result = await projectStore.saveProject(dataRoot, project);
  return {
    ok: true,
    project: result.project,
    projectPath: result.projectPath
  };
}

async function openProject(dataRoot, projectId) {
  return {
    ok: true,
    project: await projectStore.openProject(dataRoot, projectId)
  };
}

async function listProjects(dataRoot) {
  return {
    ok: true,
    projects: await projectStore.listProjects(dataRoot)
  };
}

async function updateProjectMetadata(dataRoot, projectId, metadata = {}) {
  const current = await projectStore.openProject(dataRoot, projectId);
  const now = new Date().toISOString();
  const updated = {
    ...current,
    title: String(metadata.name || metadata.title || current.title || 'Untitled Project').trim() || 'Untitled Project',
    description: String(metadata.description || ''),
    status: String(metadata.status || ''),
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    coverImage: String(metadata.coverImage || ''),
    updatedAt: now
  };
  const result = await projectStore.saveProject(dataRoot, updated);
  return {
    ok: true,
    project: result.project,
    projectPath: result.projectPath
  };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueRemovedPath(root, projectId) {
  const base = sanitizePathSegment(projectId, 'project');
  let target = path.join(root, base);
  let index = 2;
  while (await pathExists(target)) {
    target = path.join(root, `${base}-${index}`);
    index += 1;
  }
  return target;
}

async function removeProjectFromLibrary(dataRoot, projectId) {
  const source = projectDir(dataRoot, projectId);
  if (!(await pathExists(source))) {
    throw new Error('Project not found');
  }

  const removedRoot = path.join(projectsRoot(dataRoot), '.removed-projects');
  await fs.mkdir(removedRoot, { recursive: true });
  const target = await uniqueRemovedPath(removedRoot, projectId);
  await fs.rename(source, target);

  return {
    ok: true,
    removedPath: target
  };
}

async function projectLocation(dataRoot, projectId) {
  const target = projectDir(dataRoot, projectId);
  if (!(await pathExists(target))) {
    throw new Error('Project not found');
  }
  return target;
}

module.exports = {
  createProject,
  saveProject,
  openProject,
  listProjects,
  updateProjectMetadata,
  removeProjectFromLibrary,
  projectLocation
};
