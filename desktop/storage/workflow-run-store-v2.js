const fs = require('fs/promises');

const WorkflowDefinition = require('../../src/core/workflow/workflow-definition-schema');
const { writeJsonAtomic, cleanupAtomicTempFiles } = require('./atomic-write');
const paths = require('./library-paths');

const WORKFLOW_V2_SCHEMA_VERSION = 2;

class WorkflowV2ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowV2ConflictError';
  }
}

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
  return result;
}

function nowIso(value = '') {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createRunsIndex(input = {}) {
  const runs = Array.isArray(input.runs) ? input.runs.map(normalizeRunSummary) : [];
  return {
    schemaVersion: WORKFLOW_V2_SCHEMA_VERSION,
    revision: nonNegativeInteger(input.revision, 0),
    updatedAt: nowIso(input.updatedAt),
    runs
  };
}

function normalizeRunSummary(input = {}) {
  const now = nowIso(input.updatedAt || input.createdAt);
  return {
    id: cleanString(input.id),
    projectId: cleanString(input.projectId),
    templateId: cleanString(input.templateId),
    templateVersion: positiveInteger(input.templateVersion, 1),
    title: cleanString(input.title, '未命名工作流') || '未命名工作流',
    status: cleanString(input.status, 'pending') || 'pending',
    activeNodeId: cleanString(input.activeNodeId),
    definitionRef: cleanString(input.definitionRef),
    stateRef: cleanString(input.stateRef),
    createdAt: nowIso(input.createdAt || now),
    updatedAt: now
  };
}

function normalizeRunState(input = {}) {
  const nodeStates = Array.isArray(input.nodeStates)
    ? input.nodeStates.map(WorkflowDefinition.createWorkflowNodeState)
    : [];
  return {
    schemaVersion: WORKFLOW_V2_SCHEMA_VERSION,
    revision: positiveInteger(input.revision, 1),
    runId: cleanString(input.runId),
    status: cleanString(input.status, 'pending') || 'pending',
    activeNodeId: cleanString(input.activeNodeId),
    nodeStates,
    rollingStateRef: cleanString(input.rollingStateRef),
    error: input.error && typeof input.error === 'object'
      ? { code: cleanString(input.error.code), message: cleanString(input.error.message) }
      : null,
    startedAt: cleanString(input.startedAt),
    finishedAt: cleanString(input.finishedAt),
    updatedAt: nowIso(input.updatedAt)
  };
}

function requireRunId(runId) {
  const normalized = cleanString(runId);
  if (!normalized) throw new Error('workflow v2 runId is required');
  return normalized;
}

async function readRunsIndex(projectPath) {
  return createRunsIndex(await readJson(paths.workflowV2RunsPath(projectPath), {}));
}

async function writeRunsIndex(projectPath, indexInput, options = {}) {
  const current = await readRunsIndex(projectPath);
  if (options.expectedRevision !== undefined && nonNegativeInteger(options.expectedRevision, -1) !== current.revision) {
    throw new WorkflowV2ConflictError('Workflow v2 run summary revision does not match');
  }
  const index = createRunsIndex({
    ...indexInput,
    revision: current.revision + 1,
    updatedAt: options.updatedAt || new Date().toISOString()
  });
  const ids = new Set();
  for (const run of index.runs) {
    if (!run.id) throw new Error('workflow v2 run summary id is required');
    if (ids.has(run.id)) throw new Error(`duplicate workflow v2 run summary id: ${run.id}`);
    ids.add(run.id);
  }
  await writeJsonAtomic(paths.workflowV2RunsPath(projectPath), index);
  return index;
}

async function listWorkflowV2Runs(projectPath) {
  const index = await readRunsIndex(projectPath);
  return index.runs.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function getWorkflowV2RunSummary(projectPath, runId) {
  const id = requireRunId(runId);
  const index = await readRunsIndex(projectPath);
  return index.runs.find((run) => run.id === id) || null;
}

async function upsertWorkflowV2RunSummary(projectPath, input = {}, options = {}) {
  const summary = normalizeRunSummary(input);
  if (!summary.id) throw new Error('workflow v2 run summary id is required');
  const current = await readRunsIndex(projectPath);
  if (options.expectedRevision !== undefined && nonNegativeInteger(options.expectedRevision, -1) !== current.revision) {
    throw new WorkflowV2ConflictError('Workflow v2 run summary revision does not match');
  }
  const existing = current.runs.find((run) => run.id === summary.id);
  const nextSummary = normalizeRunSummary({
    ...(existing || {}),
    ...summary,
    createdAt: existing ? existing.createdAt : summary.createdAt,
    updatedAt: options.updatedAt || summary.updatedAt
  });
  const runs = existing
    ? current.runs.map((run) => run.id === summary.id ? nextSummary : run)
    : [...current.runs, nextSummary];
  const index = await writeRunsIndex(projectPath, { ...current, runs }, {
    expectedRevision: current.revision,
    updatedAt: nextSummary.updatedAt
  });
  return { summary: nextSummary, index };
}

async function createWorkflowV2Run(projectPath, input = {}) {
  const runId = requireRunId(input.id || input.runId);
  const existing = await getWorkflowV2RunSummary(projectPath, runId);
  if (existing) throw new Error(`workflow v2 run already exists: ${runId}`);
  const definitionInput = input.definitionSnapshot && input.definitionSnapshot.definition
    ? input.definitionSnapshot.definition
    : input.definition;
  const definitionSnapshot = WorkflowDefinition.createWorkflowDefinitionSnapshot(definitionInput, {
    capturedAt: input.capturedAt || input.createdAt
  });
  const now = nowIso(input.updatedAt || input.createdAt);
  const summary = normalizeRunSummary({
    id: runId,
    projectId: input.projectId,
    templateId: definitionSnapshot.templateId,
    templateVersion: definitionSnapshot.templateVersion,
    title: input.title || definitionSnapshot.definition.title,
    status: input.status || 'pending',
    activeNodeId: input.activeNodeId,
    definitionRef: 'definition.json',
    stateRef: 'state.json',
    createdAt: now,
    updatedAt: now
  });
  const state = normalizeRunState({
    ...(input.state || {}),
    runId,
    status: summary.status,
    activeNodeId: summary.activeNodeId,
    revision: 1,
    updatedAt: now
  });

  await writeJsonAtomic(paths.workflowV2RunDefinitionPath(projectPath, runId), definitionSnapshot);
  await writeJsonAtomic(paths.workflowV2RunStatePath(projectPath, runId), state);
  const saved = await upsertWorkflowV2RunSummary(projectPath, summary);
  return { ...saved, definitionSnapshot, state };
}

async function readWorkflowV2RunState(projectPath, runId) {
  const id = requireRunId(runId);
  const state = await readJson(paths.workflowV2RunStatePath(projectPath, id), null);
  return state ? normalizeRunState(state) : null;
}

async function writeWorkflowV2RunState(projectPath, runId, input = {}, options = {}) {
  const id = requireRunId(runId);
  const current = await readWorkflowV2RunState(projectPath, id);
  if (!current) throw new Error(`workflow v2 run state not found: ${id}`);
  if (options.expectedRevision !== undefined && positiveInteger(options.expectedRevision, -1) !== current.revision) {
    throw new WorkflowV2ConflictError('Workflow v2 run state revision does not match');
  }
  const state = normalizeRunState({
    ...current,
    ...clonePlain(input),
    runId: id,
    revision: current.revision + 1,
    updatedAt: options.updatedAt || new Date().toISOString()
  });
  await writeJsonAtomic(paths.workflowV2RunStatePath(projectPath, id), state);
  const summary = await getWorkflowV2RunSummary(projectPath, id);
  if (summary) {
    await upsertWorkflowV2RunSummary(projectPath, {
      ...summary,
      status: state.status,
      activeNodeId: state.activeNodeId,
      updatedAt: state.updatedAt
    }, { expectedRevision: options.expectedIndexRevision });
  }
  return state;
}

async function readWorkflowV2Run(projectPath, runId) {
  const id = requireRunId(runId);
  const summary = await getWorkflowV2RunSummary(projectPath, id);
  if (!summary) return null;
  const [definitionSnapshot, state] = await Promise.all([
    readJson(paths.workflowV2RunDefinitionPath(projectPath, id), null),
    readWorkflowV2RunState(projectPath, id)
  ]);
  return { summary, definitionSnapshot, state };
}

async function recoverWorkflowV2Store(projectPath) {
  if (!(await fileExists(paths.workflowV2Dir(projectPath)))) return [];
  return cleanupAtomicTempFiles(paths.workflowV2Dir(projectPath));
}

module.exports = {
  WORKFLOW_V2_SCHEMA_VERSION,
  WorkflowV2ConflictError,
  createRunsIndex,
  normalizeRunSummary,
  normalizeRunState,
  readRunsIndex,
  listWorkflowV2Runs,
  getWorkflowV2RunSummary,
  upsertWorkflowV2RunSummary,
  createWorkflowV2Run,
  readWorkflowV2RunState,
  writeWorkflowV2RunState,
  readWorkflowV2Run,
  recoverWorkflowV2Store
};
