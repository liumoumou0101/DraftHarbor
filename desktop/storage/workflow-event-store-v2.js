const fs = require('fs/promises');

const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');
const { readWorkflowV2RunState } = require('./workflow-run-store-v2');

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function nowIso(value = '') {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
  return result;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function createWorkflowV2Event(input = {}) {
  return {
    schemaVersion: 1,
    id: cleanString(input.id),
    runId: cleanString(input.runId),
    type: cleanString(input.type, 'workflow_event') || 'workflow_event',
    nodeId: cleanString(input.nodeId),
    artifactId: cleanString(input.artifactId),
    payload: input.payload && typeof input.payload === 'object' ? clonePlain(input.payload) : {},
    createdAt: nowIso(input.createdAt)
  };
}

async function readWorkflowV2Event(projectPath, runId, eventId) {
  const stored = await readJson(paths.workflowV2EventPath(projectPath, runId, eventId));
  return stored ? createWorkflowV2Event(stored) : null;
}

async function appendWorkflowV2Event(projectPath, runId, input = {}) {
  const event = createWorkflowV2Event({ ...input, runId });
  if (!event.id) throw new Error('workflow v2 event id is required');
  if (!event.runId) throw new Error('workflow v2 event runId is required');
  if (!await readWorkflowV2RunState(projectPath, event.runId)) {
    throw new Error(`workflow v2 run state not found: ${event.runId}`);
  }
  const existing = await readWorkflowV2Event(projectPath, event.runId, event.id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
    throw new Error(`workflow v2 event is immutable: ${event.id}`);
  }
  if (!existing) await writeJsonAtomic(paths.workflowV2EventPath(projectPath, event.runId, event.id), event);
  return existing || event;
}

async function listWorkflowV2Events(projectPath, runId) {
  let entries = [];
  try {
    entries = await fs.readdir(paths.workflowV2EventsDir(projectPath, runId), { withFileTypes: true });
  } catch {
    return [];
  }
  const events = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readWorkflowV2Event(projectPath, runId, entry.name.slice(0, -5))));
  return events.filter(Boolean).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

module.exports = {
  createWorkflowV2Event,
  readWorkflowV2Event,
  appendWorkflowV2Event,
  listWorkflowV2Events
};
