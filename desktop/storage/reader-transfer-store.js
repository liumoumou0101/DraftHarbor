const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const TransferSchema = require('../../src/core/document/reader-transfer-schema');
const { writeFileAtomic, writeJsonAtomic, cleanupAtomicTempFiles } = require('./atomic-write');
const paths = require('./library-paths');

const locks = new Map();

class ReaderTransferConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderTransferConflictError';
  }
}

class ReaderTransferCorruptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderTransferCorruptionError';
  }
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function withTransferLock(dataRoot, envelopeId, task) {
  const key = path.resolve(paths.readerTransferDir(dataRoot, envelopeId));
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const token = previous.then(() => gate);
  locks.set(key, token);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === token) locks.delete(key);
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readReaderTransfer(dataRoot, envelopeId) {
  const envelopePath = paths.readerTransferEnvelopePath(dataRoot, envelopeId);
  if (!(await exists(envelopePath))) return null;
  try {
    const [storedEnvelope, storedSnapshot, text] = await Promise.all([
      readJson(envelopePath),
      readJson(paths.readerTransferSnapshotMetadataPath(dataRoot, envelopeId)),
      fs.readFile(paths.readerTransferSnapshotTextPath(dataRoot, envelopeId), 'utf8')
    ]);
    const snapshotBundle = TransferSchema.createReaderTransferSnapshot(storedSnapshot, text, { digest: sha256 });
    const envelope = TransferSchema.createReaderTransferEnvelope(storedEnvelope, {
      digest: sha256,
      snapshot: snapshotBundle
    });
    if (envelope.envelopeId !== String(envelopeId || '').trim()) {
      throw new Error('reader transfer path identity does not match envelope');
    }
    return { envelope, snapshot: snapshotBundle.snapshot, text: snapshotBundle.text };
  } catch (error) {
    throw new ReaderTransferCorruptionError(`reader transfer ${String(envelopeId || '').trim()} is corrupt: ${error.message || error}`);
  }
}

async function createReaderTransfer(dataRoot, input = {}) {
  const bundle = TransferSchema.createReaderTransferBundle(input, { digest: sha256 });
  return withTransferLock(dataRoot, bundle.envelope.envelopeId, async () => {
    const transferDir = paths.readerTransferDir(dataRoot, bundle.envelope.envelopeId);
    if (await exists(transferDir)) throw new ReaderTransferConflictError(`reader transfer already exists: ${bundle.envelope.envelopeId}`);
    try {
      await writeFileAtomic(paths.readerTransferSnapshotTextPath(dataRoot, bundle.envelope.envelopeId), bundle.text, 'utf8');
      await writeJsonAtomic(paths.readerTransferSnapshotMetadataPath(dataRoot, bundle.envelope.envelopeId), bundle.snapshot);
      await writeJsonAtomic(paths.readerTransferEnvelopePath(dataRoot, bundle.envelope.envelopeId), bundle.envelope);
      return await readReaderTransfer(dataRoot, bundle.envelope.envelopeId);
    } catch (error) {
      await fs.rm(transferDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
}

async function writeEnvelopeState(dataRoot, envelopeId, updater, options = {}) {
  return withTransferLock(dataRoot, envelopeId, async () => {
    const current = await readReaderTransfer(dataRoot, envelopeId);
    if (!current) throw new Error(`reader transfer not found: ${envelopeId}`);
    if (options.expectedUpdatedAt !== undefined && String(options.expectedUpdatedAt || '') !== current.envelope.updatedAt) {
      throw new ReaderTransferConflictError('reader transfer updatedAt does not match');
    }
    const next = updater(current.envelope);
    await writeJsonAtomic(paths.readerTransferEnvelopePath(dataRoot, envelopeId), next);
    return (await readReaderTransfer(dataRoot, envelopeId)).envelope;
  });
}

async function addReaderTransferConsumer(dataRoot, envelopeId, consumer, options = {}) {
  return writeEnvelopeState(dataRoot, envelopeId, (envelope) => (
    TransferSchema.addReaderTransferConsumer(envelope, consumer)
  ), options);
}

async function updateReaderTransferConsumer(dataRoot, envelopeId, consumerId, changes, options = {}) {
  return writeEnvelopeState(dataRoot, envelopeId, (envelope) => (
    TransferSchema.updateReaderTransferConsumer(envelope, consumerId, changes)
  ), options);
}

async function transitionReaderTransfer(dataRoot, envelopeId, lifecycle, options = {}) {
  return writeEnvelopeState(dataRoot, envelopeId, (envelope) => (
    TransferSchema.transitionReaderTransfer(envelope, lifecycle, { updatedAt: options.updatedAt })
  ), options);
}

async function listReaderTransfers(dataRoot) {
  let entries = [];
  try {
    entries = await fs.readdir(paths.readerTransfersDir(dataRoot), { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return { transfers: [], corruptTransferDirs: [] };
    throw error;
  }
  const transfers = [];
  const corruptTransferDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const envelopePath = path.join(paths.readerTransfersDir(dataRoot), entry.name, 'envelope.json');
    try {
      const stored = await readJson(envelopePath);
      const record = await readReaderTransfer(dataRoot, stored.envelopeId);
      if (!record || path.resolve(paths.readerTransferDir(dataRoot, record.envelope.envelopeId)) !== path.resolve(path.dirname(envelopePath))) {
        throw new Error('reader transfer directory identity does not match envelope');
      }
      transfers.push(record.envelope);
    } catch {
      corruptTransferDirs.push(path.resolve(path.dirname(envelopePath)));
    }
  }
  return {
    transfers: transfers.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    corruptTransferDirs
  };
}

async function deleteArchivedReaderTransfer(dataRoot, envelopeId) {
  return withTransferLock(dataRoot, envelopeId, async () => {
    const current = await readReaderTransfer(dataRoot, envelopeId);
    if (!current) return false;
    if (!TransferSchema.canDeleteArchivedReaderTransfer(current.envelope)) {
      throw new ReaderTransferConflictError('reader transfer is not safe to delete');
    }
    await fs.rm(paths.readerTransferDir(dataRoot, envelopeId), { recursive: true, force: true });
    return true;
  });
}

async function cleanupReaderTransferStore(dataRoot, options = {}) {
  const transferRoot = paths.readerTransfersDir(dataRoot);
  const removedTempFiles = await cleanupAtomicTempFiles(transferRoot);
  const removedIncompleteTransferDirs = [];
  const corruptTransferDirs = [];
  const removedArchivedTransferDirs = [];
  let entries = [];
  try {
    entries = await fs.readdir(transferRoot, { withFileTypes: true });
  } catch {
    return { removedTempFiles, removedIncompleteTransferDirs, corruptTransferDirs, removedArchivedTransferDirs };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transferDir = path.join(transferRoot, entry.name);
    const envelopePath = path.join(transferDir, 'envelope.json');
    if (!(await exists(envelopePath))) {
      await fs.rm(transferDir, { recursive: true, force: true });
      removedIncompleteTransferDirs.push(path.resolve(transferDir));
      continue;
    }
    try {
      const stored = await readJson(envelopePath);
      const record = await readReaderTransfer(dataRoot, stored.envelopeId);
      if (!record || path.resolve(paths.readerTransferDir(dataRoot, stored.envelopeId)) !== path.resolve(transferDir)) {
        throw new Error('reader transfer directory identity mismatch');
      }
      if (options.pruneArchived && TransferSchema.canDeleteArchivedReaderTransfer(record.envelope)) {
        await fs.rm(transferDir, { recursive: true, force: true });
        removedArchivedTransferDirs.push(path.resolve(transferDir));
      }
    } catch {
      corruptTransferDirs.push(path.resolve(transferDir));
    }
  }
  return { removedTempFiles, removedIncompleteTransferDirs, corruptTransferDirs, removedArchivedTransferDirs };
}

module.exports = {
  ReaderTransferConflictError,
  ReaderTransferCorruptionError,
  sha256,
  createReaderTransfer,
  readReaderTransfer,
  listReaderTransfers,
  addReaderTransferConsumer,
  updateReaderTransferConsumer,
  transitionReaderTransfer,
  deleteArchivedReaderTransfer,
  cleanupReaderTransferStore
};
