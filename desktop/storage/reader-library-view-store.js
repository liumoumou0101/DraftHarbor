const fs = require('fs/promises');

const View = require('../../src/core/document/reader-library-view');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

const STORE_SCHEMA_VERSION = 1;
const locks = new Map();

class ReaderLibraryViewConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderLibraryViewConflictError';
  }
}

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function timestamp(value, label) {
  const text = cleanString(value);
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function withLock(filePath, task) {
  const previous = locks.get(filePath) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const token = previous.then(() => gate);
  locks.set(filePath, token);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(filePath) === token) locks.delete(filePath);
  }
}

function normalizeRecord(input) {
  if (Number(input.schemaVersion) !== STORE_SCHEMA_VERSION || input.kind !== 'reader-library-view') {
    throw new Error('reader library view store schema is invalid');
  }
  return { updatedAt: timestamp(input.updatedAt, 'reader library view updatedAt'), view: View.createReaderLibraryView(input.view) };
}

async function readReaderLibraryView(dataRoot) {
  const stored = await readJsonOptional(paths.readerLibraryViewPath(dataRoot));
  return stored ? normalizeRecord(stored) : null;
}

async function writeReaderLibraryView(dataRoot, viewInput, options = {}) {
  const filePath = paths.readerLibraryViewPath(dataRoot);
  return withLock(filePath, async () => {
    const current = await readReaderLibraryView(dataRoot);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current && current.updatedAt)) {
      throw new ReaderLibraryViewConflictError('reader library view updatedAt does not match');
    }
    const record = {
      schemaVersion: STORE_SCHEMA_VERSION,
      kind: 'reader-library-view',
      updatedAt: timestamp(options.updatedAt || new Date().toISOString(), 'reader library view updatedAt'),
      view: View.createReaderLibraryView(viewInput)
    };
    await writeJsonAtomic(filePath, record);
    return normalizeRecord(record);
  });
}

module.exports = {
  STORE_SCHEMA_VERSION,
  ReaderLibraryViewConflictError,
  readReaderLibraryView,
  writeReaderLibraryView
};
