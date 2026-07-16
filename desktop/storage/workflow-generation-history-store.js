const fs = require('fs/promises');

const ArtifactSchema = require('../../src/core/workflow/workflow-artifact-schema');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
  return result;
}

function createWorkflowGenerationHistoryRecord(input = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: cleanString(input.id) || `workflow-generation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: cleanString(input.runId),
    nodeId: cleanString(input.nodeId),
    taskId: cleanString(input.taskId),
    capabilityId: cleanString(input.capabilityId),
    capabilityVersion: Number.isInteger(Number(input.capabilityVersion)) ? Number(input.capabilityVersion) : 1,
    outputArtifactType: input.outputArtifactType && typeof input.outputArtifactType === 'object'
      ? { id: cleanString(input.outputArtifactType.id), version: Number(input.outputArtifactType.version) || 1 }
      : { id: '', version: 1 },
    status: cleanString(input.status, 'succeeded') || 'succeeded',
    providerSnapshot: ArtifactSchema.normalizeProviderSnapshot(input.providerSnapshot),
    artifactRef: input.artifactRef && typeof input.artifactRef === 'object' ? clonePlain(input.artifactRef) : {},
    resultDigest: cleanString(input.resultDigest),
    error: input.error && typeof input.error === 'object'
      ? { code: cleanString(input.error.code), message: cleanString(input.error.message) }
      : null,
    startedAt: cleanString(input.startedAt),
    finishedAt: cleanString(input.finishedAt),
    createdAt: cleanString(input.createdAt) || now
  };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeWorkflowGenerationHistoryRecord(projectPath, runId, input = {}) {
  const record = createWorkflowGenerationHistoryRecord({ ...input, runId });
  if (!record.runId || !record.id) throw new Error('workflow generation history runId and id are required');
  const filePath = paths.workflowV2GenerationHistoryPath(projectPath, record.runId, record.id);
  const existing = await readJson(filePath);
  if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
    throw new Error(`workflow generation history record is immutable: ${record.id}`);
  }
  if (!existing) await writeJsonAtomic(filePath, record);
  return existing || record;
}

async function listWorkflowGenerationHistory(projectPath, runId) {
  let entries = [];
  try {
    entries = await fs.readdir(paths.workflowV2GenerationHistoryDir(projectPath, runId), { withFileTypes: true });
  } catch {
    return [];
  }
  const records = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJson(paths.workflowV2GenerationHistoryPath(projectPath, runId, entry.name.slice(0, -5)))));
  return records.filter(Boolean).map(createWorkflowGenerationHistoryRecord)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

module.exports = {
  createWorkflowGenerationHistoryRecord,
  writeWorkflowGenerationHistoryRecord,
  listWorkflowGenerationHistory
};
