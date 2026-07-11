const path = require('path');

const { projectStats } = require('../../src/core/project/project-stats');
const { normalizeProject } = require('../../src/core/project/project-normalize');

function timestampMs(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : Date.now();
}

function projectToLegacySnapshot(project) {
  const updatedAtMs = timestampMs(project.updatedAt);
  const legacyProject = {
    id: project.id,
    name: project.title,
    description: project.description || '',
    status: project.status || '',
    tags: Array.isArray(project.tags) ? project.tags : [],
    coverImage: project.coverImage || '',
    created: project.createdAt,
    modified: project.updatedAt,
    updatedAt: updatedAtMs
  };

  const chapters = (project.chapters || []).map((chapter) => ({
    id: chapter.id,
    projectId: project.id,
    title: chapter.title,
    summary: chapter.summary || '',
    order: chapter.order || 0,
    created: chapter.createdAt,
    modified: chapter.updatedAt,
    updatedAt: timestampMs(chapter.updatedAt)
  }));

  const scenes = (project.scenes || []).map((scene) => ({
    id: scene.id,
    projectId: project.id,
    chapterId: scene.chapterId,
    title: scene.title,
    summary: scene.summary || '',
    order: scene.order || 0,
    tags: Array.isArray(scene.tags) ? scene.tags : [],
    povCharacter: scene.povCharacter || scene.pov || '',
    tense: scene.tense || '',
    created: scene.createdAt,
    modified: scene.updatedAt,
    updatedAt: timestampMs(scene.updatedAt)
  }));

  const sceneContents = {};
  for (const scene of project.scenes || []) {
    sceneContents[scene.id] = scene.content || '';
  }

  return {
    version: '3.0-project-directory',
    exportedAt: new Date().toISOString(),
    filesystemSavedAt: project.updatedAt || new Date().toISOString(),
    filesystemSaveVersion: 1,
    project: legacyProject,
    chapters,
    scenes,
    sceneContents,
    compendium: project.compendium || [],
    prompts: project.prompts || [],
    codex: [],
    promptHistory: project.promptHistory || [],
    workshopSessions: project.workshopSessions || [],
    workflowRuns: project.workflowRuns || []
  };
}

function projectToLibrarySummary(project, projectPath, libraryRoot = '') {
  const stats = projectStats(project);
  return {
    id: project.id,
    name: project.title,
    description: project.description || '',
    status: project.status || '',
    tags: Array.isArray(project.tags) ? project.tags : [],
    coverImage: project.coverImage || '',
    created: project.createdAt || '',
    modified: project.updatedAt || '',
    timestamp: project.updatedAt || '',
    absolutePath: projectPath,
    path: libraryRoot ? path.relative(libraryRoot, projectPath).replace(/\\/g, '/') : projectPath,
    filename: '',
    source: 'project-directory',
    size: 0,
    chapterCount: stats.chapterCount,
    sceneCount: stats.sceneCount,
    wordCount: stats.wordCount,
    health: 'ok',
    healthMessage: ''
  };
}

function legacySnapshotToProject(snapshot) {
  const payload = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const sourceProject = payload.project && typeof payload.project === 'object' ? payload.project : {};
  return normalizeProject({
    id: sourceProject.id,
    title: sourceProject.title || sourceProject.name,
    description: sourceProject.description || '',
    status: sourceProject.status || '',
    tags: sourceProject.tags || [],
    coverImage: sourceProject.coverImage || '',
    createdAt: sourceProject.createdAt || sourceProject.created,
    updatedAt: sourceProject.updatedAt || sourceProject.modified || payload.filesystemSavedAt || payload.exportedAt,
    currentSceneId: sourceProject.currentSceneId || payload.currentSceneId,
    chapters: payload.chapters || [],
    scenes: (payload.scenes || []).map((scene) => ({
      ...scene,
      content: payload.sceneContents && payload.sceneContents[scene.id] !== undefined
        ? payload.sceneContents[scene.id]
        : scene.content
    })),
    compendium: payload.compendium || [],
    prompts: payload.prompts || [],
    promptHistory: payload.promptHistory || [],
    workshopSessions: payload.workshopSessions || [],
    workflowRuns: payload.workflowRuns || []
  });
}

module.exports = {
  projectToLegacySnapshot,
  projectToLibrarySummary,
  legacySnapshotToProject
};
