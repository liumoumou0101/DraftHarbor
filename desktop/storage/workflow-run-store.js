const fs = require('fs/promises');
const path = require('path');

const { createPlaceholderWorkflowRun, createWorkflowEvent } = require('../../src/core/workflow/workflow-schema');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function listWorkflowRuns(projectPath) {
  const runs = await readJson(paths.workflowRunsPath(projectPath), []);
  return Array.isArray(runs) ? runs.map((run) => createPlaceholderWorkflowRun(run)) : [];
}

async function saveWorkflowRuns(projectPath, runs) {
  await fs.mkdir(paths.workflowsDir(projectPath), { recursive: true });
  const normalized = (Array.isArray(runs) ? runs : []).map((run) => createPlaceholderWorkflowRun(run));
  await writeJsonAtomic(paths.workflowRunsPath(projectPath), normalized);
  return normalized;
}

async function upsertWorkflowRun(projectPath, runInput) {
  const runs = await listWorkflowRuns(projectPath);
  const run = createPlaceholderWorkflowRun(runInput);
  const index = runs.findIndex((item) => item.id === run.id);
  if (index >= 0) {
    runs[index] = { ...runs[index], ...run, updatedAt: run.updatedAt || new Date().toISOString() };
  } else {
    runs.push(run);
  }
  await saveWorkflowRuns(projectPath, runs);
  return run;
}

async function appendWorkflowEvent(projectPath, runId, eventInput = {}) {
  const event = createWorkflowEvent({
    ...eventInput,
    runId,
  });
  await fs.mkdir(paths.workflowRunEventsDir(projectPath), { recursive: true });
  await fs.appendFile(paths.workflowRunEventsPath(projectPath, runId), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

async function listWorkflowEvents(projectPath, runId) {
  let text = '';
  try {
    text = await fs.readFile(paths.workflowRunEventsPath(projectPath, runId), 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = {
  listWorkflowRuns,
  saveWorkflowRuns,
  upsertWorkflowRun,
  appendWorkflowEvent,
  listWorkflowEvents
};
