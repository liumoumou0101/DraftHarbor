const fs = require('fs/promises');

const ApplicationSchema = require('../../src/core/workflow/workflow-application-schema');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');
const { readWorkflowV2RunState } = require('./workflow-run-store-v2');

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function createApplicationRecord(input = {}) {
  return ApplicationSchema.createWorkflowApplicationRecord(input);
}

async function readApplicationRecord(projectPath, runId, applicationId) {
  const stored = await readJson(paths.workflowV2ApplicationPath(projectPath, runId, applicationId));
  return stored ? createApplicationRecord(stored) : null;
}

async function writeApplicationRecord(projectPath, runId, input = {}) {
  const record = createApplicationRecord({ ...input, runId });
  if (!record.applicationId) throw new Error('workflow applicationId is required');
  if (!record.runId) throw new Error('workflow application runId is required');
  if (!await readWorkflowV2RunState(projectPath, record.runId)) {
    throw new Error(`workflow v2 run state not found: ${record.runId}`);
  }
  const existing = await readApplicationRecord(projectPath, record.runId, record.applicationId);
  if (existing) return existing;
  if (!existing) await writeJsonAtomic(paths.workflowV2ApplicationPath(projectPath, record.runId, record.applicationId), record);
  return existing || record;
}

async function updateApplicationRecord(projectPath, runId, applicationId, patch = {}) {
  const existing = await readApplicationRecord(projectPath, runId, applicationId);
  if (!existing) throw new Error(`workflow application record not found: ${applicationId}`);
  const next = createApplicationRecord({
    ...existing,
    ...patch,
    applicationId: existing.applicationId,
    runId: existing.runId,
    projectId: existing.projectId,
    sourceRevisionIds: existing.sourceRevisionIds,
    target: existing.target,
    revision: existing.revision + 1,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  });
  await writeJsonAtomic(paths.workflowV2ApplicationPath(projectPath, existing.runId, existing.applicationId), next);
  return next;
}

async function writeApplicationBackup(projectPath, runId, applicationId, snapshot) {
  const existing = await readApplicationRecord(projectPath, runId, applicationId);
  if (!existing) throw new Error(`workflow application record not found: ${applicationId}`);
  const filePath = paths.workflowV2ApplicationBackupPath(projectPath, runId, applicationId);
  const stored = await readJson(filePath);
  if (stored) return stored;
  await writeJsonAtomic(filePath, snapshot);
  return snapshot;
}

async function readApplicationBackup(projectPath, runId, applicationId) {
  return readJson(paths.workflowV2ApplicationBackupPath(projectPath, runId, applicationId));
}

module.exports = {
  createApplicationRecord,
  readApplicationRecord,
  writeApplicationRecord,
  updateApplicationRecord,
  writeApplicationBackup,
  readApplicationBackup
};
