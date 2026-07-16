const fs = require('fs/promises');
const path = require('path');
const { writeJsonAtomic } = require('./atomic-write');
const { projectDir, sanitizePathSegment } = require('./library-paths');

function batchPath(dataRoot, projectId, batchId) {
  return path.join(projectDir(dataRoot, projectId), 'compendium', 'reader-batches', `${sanitizePathSegment(batchId, 'batch')}.json`);
}

async function readBatch(dataRoot, projectId, batchId) {
  try { return JSON.parse(await fs.readFile(batchPath(dataRoot, projectId, batchId), 'utf8')); } catch { return null; }
}

async function writeBatch(dataRoot, projectId, batch) {
  const target = batchPath(dataRoot, projectId, batch.batchId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeJsonAtomic(target, batch);
  return batch;
}

module.exports = { batchPath, readBatch, writeBatch };
