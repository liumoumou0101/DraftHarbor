const path = require('path');

function sanitizePathSegment(value, fallback = 'item') {
  const safe = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ .]+$/g, '');
  return safe.slice(0, 80) || fallback;
}

function libraryRoot(dataRoot) {
  return path.join(dataRoot, 'DraftHarbor Library');
}

function projectsRoot(dataRoot) {
  return path.join(libraryRoot(dataRoot), 'projects');
}

function projectDir(dataRoot, projectId) {
  return path.join(projectsRoot(dataRoot), sanitizePathSegment(projectId, 'project'));
}

function manifestPath(projectPath) {
  return path.join(projectPath, 'manifest.json');
}

function chaptersDir(projectPath) {
  return path.join(projectPath, 'chapters');
}

function scenesDir(projectPath) {
  return path.join(projectPath, 'scenes');
}

function sceneMarkdownPath(projectPath, sceneId) {
  return path.join(scenesDir(projectPath), `${sanitizePathSegment(sceneId, 'scene')}.md`);
}

function sceneMetaPath(projectPath, sceneId) {
  return path.join(scenesDir(projectPath), `${sanitizePathSegment(sceneId, 'scene')}.meta.json`);
}

function chapterPath(projectPath, chapterId) {
  return path.join(chaptersDir(projectPath), `${sanitizePathSegment(chapterId, 'chapter')}.json`);
}

function workflowsDir(projectPath) {
  return path.join(projectPath, 'workflows');
}

function workflowRunsPath(projectPath) {
  return path.join(workflowsDir(projectPath), 'runs.json');
}

function workflowRunEventsDir(projectPath) {
  return path.join(workflowsDir(projectPath), 'runs');
}

function workflowRunEventsPath(projectPath, runId) {
  return path.join(workflowRunEventsDir(projectPath), `${sanitizePathSegment(runId, 'workflow')}.events.jsonl`);
}

module.exports = {
  sanitizePathSegment,
  libraryRoot,
  projectsRoot,
  projectDir,
  manifestPath,
  chaptersDir,
  scenesDir,
  sceneMarkdownPath,
  sceneMetaPath,
  chapterPath,
  workflowsDir,
  workflowRunsPath,
  workflowRunEventsDir,
  workflowRunEventsPath
};
