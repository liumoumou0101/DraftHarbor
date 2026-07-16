const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const { writeFileAtomic, writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');
const { WorkflowV2ConflictError, readWorkflowV2RunState } = require('./workflow-run-store-v2');

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function nowIso(value = '') {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function createChunkCheckpoint(input = {}) {
  const now = nowIso(input.updatedAt || input.createdAt);
  return {
    schemaVersion: 1,
    id: cleanString(input.id),
    runId: cleanString(input.runId),
    nodeId: cleanString(input.nodeId),
    status: cleanString(input.status, 'pending') || 'pending',
    sequence: nonNegativeInteger(input.sequence, 0),
    revision: nonNegativeInteger(input.revision, 1),
    inputDigest: cleanString(input.inputDigest),
    outputRevisionId: cleanString(input.outputRevisionId),
    contentRef: cleanString(input.contentRef),
    contentDigest: cleanString(input.contentDigest),
    contentByteLength: nonNegativeInteger(input.contentByteLength, 0),
    error: input.error && typeof input.error === 'object'
      ? { code: cleanString(input.error.code), message: cleanString(input.error.message) }
      : null,
    createdAt: nowIso(input.createdAt || now),
    updatedAt: now
  };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readChunkCheckpoint(projectPath, runId, chunkId) {
  const stored = await readJson(paths.workflowV2ChunkPath(projectPath, runId, chunkId));
  return stored ? createChunkCheckpoint(stored) : null;
}

async function listChunkCheckpoints(projectPath, runId) {
  let entries = [];
  try {
    entries = await fs.readdir(paths.workflowV2ChunksDir(projectPath, runId), { withFileTypes: true });
  } catch {
    return [];
  }
  const chunks = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readChunkCheckpoint(projectPath, runId, path.basename(entry.name, '.json'))));
  return chunks.filter(Boolean).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

async function readChunkContent(projectPath, runId, chunkId) {
  try {
    return await fs.readFile(paths.workflowV2ChunkContentPath(projectPath, runId, chunkId), 'utf8');
  } catch {
    return null;
  }
}

async function writeChunkCheckpoint(projectPath, runId, input = {}, options = {}) {
  const id = cleanString(input.id || input.chunkId);
  const run = cleanString(runId || input.runId);
  if (!id) throw new Error('workflow chunk id is required');
  if (!run) throw new Error('workflow chunk runId is required');
  if (!await readWorkflowV2RunState(projectPath, run)) {
    throw new Error(`workflow v2 run state not found: ${run}`);
  }
  const current = await readChunkCheckpoint(projectPath, run, id);
  if (options.expectedRevision !== undefined && nonNegativeInteger(options.expectedRevision, -1) !== (current ? current.revision : 0)) {
    throw new WorkflowV2ConflictError('Workflow chunk revision does not match');
  }
  const hasContent = Object.prototype.hasOwnProperty.call(input, 'content');
  const content = hasContent ? String(input.content === undefined ? '' : input.content) : null;
  const contentPath = paths.workflowV2ChunkContentPath(projectPath, run, id);
  const runPath = paths.workflowV2RunDir(projectPath, run);
  const checkpoint = createChunkCheckpoint({
    ...(current || {}),
    ...input,
    id,
    runId: run,
    revision: (current ? current.revision : 0) + 1,
    contentRef: hasContent ? path.relative(runPath, contentPath).replace(/\\/g, '/') : (current ? current.contentRef : ''),
    contentDigest: hasContent
      ? `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`
      : (current ? current.contentDigest : ''),
    contentByteLength: hasContent ? Buffer.byteLength(content, 'utf8') : (current ? current.contentByteLength : 0),
    createdAt: current ? current.createdAt : input.createdAt,
    updatedAt: options.updatedAt || new Date().toISOString()
  });
  if (hasContent) await writeFileAtomic(contentPath, content, 'utf8');
  await writeJsonAtomic(paths.workflowV2ChunkPath(projectPath, run, id), checkpoint);
  return checkpoint;
}

module.exports = {
  createChunkCheckpoint,
  readChunkCheckpoint,
  listChunkCheckpoints,
  readChunkContent,
  writeChunkCheckpoint
};
