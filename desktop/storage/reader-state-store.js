const fs = require('fs/promises');

const ReaderSchema = require('../../src/core/document/reader-document-schema');
const ReaderPreferences = require('../../src/core/document/reader-preferences');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

const READER_STATE_SCHEMA_VERSION = 1;
const locks = new Map();

class ReaderStateConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderStateConflictError';
  }
}

function cleanString(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function normalizeTimestamp(value, label) {
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

async function withStateLock(filePath, task) {
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

function normalizeStoredState(input = {}) {
  if (Number(input.schemaVersion) !== READER_STATE_SCHEMA_VERSION || input.kind !== 'reader-document-state') {
    throw new Error('reader state schema is invalid');
  }
  return ReaderSchema.createReaderDocumentState(input.state);
}

async function readReaderDocumentState(dataRoot, documentId) {
  const stored = await readJsonOptional(paths.readerDocumentStatePath(dataRoot, documentId));
  if (!stored) return null;
  const state = normalizeStoredState(stored);
  if (state.documentId !== cleanString(documentId)) throw new Error('reader state path identity does not match state');
  return state;
}

async function writeReaderDocumentState(dataRoot, stateInput, options = {}) {
  const state = ReaderSchema.createReaderDocumentState(stateInput);
  const statePath = paths.readerDocumentStatePath(dataRoot, state.documentId);
  return withStateLock(statePath, async () => {
    const current = await readReaderDocumentState(dataRoot, state.documentId);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current && current.updatedAt)) {
      throw new ReaderStateConflictError('reader state updatedAt does not match');
    }
    await writeJsonAtomic(statePath, {
      schemaVersion: READER_STATE_SCHEMA_VERSION,
      kind: 'reader-document-state',
      state
    });
    return state;
  });
}

function normalizeStoredPreferences(input = {}) {
  if (Number(input.schemaVersion) !== READER_STATE_SCHEMA_VERSION || input.kind !== 'reader-global-preferences') {
    throw new Error('reader preferences schema is invalid');
  }
  return {
    updatedAt: normalizeTimestamp(input.updatedAt, 'reader preferences updatedAt'),
    preferences: ReaderPreferences.migrateReaderPreferences(input.preferences)
  };
}

async function readReaderGlobalPreferences(dataRoot) {
  const stored = await readJsonOptional(paths.readerPreferencesPath(dataRoot));
  return stored ? normalizeStoredPreferences(stored) : null;
}

async function writeReaderGlobalPreferences(dataRoot, preferencesInput, options = {}) {
  const preferencesPath = paths.readerPreferencesPath(dataRoot);
  return withStateLock(preferencesPath, async () => {
    const current = await readReaderGlobalPreferences(dataRoot);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current && current.updatedAt)) {
      throw new ReaderStateConflictError('reader preferences updatedAt does not match');
    }
    const record = {
      schemaVersion: READER_STATE_SCHEMA_VERSION,
      kind: 'reader-global-preferences',
      updatedAt: normalizeTimestamp(options.updatedAt, 'reader preferences updatedAt'),
      preferences: ReaderPreferences.createReaderPreferencesV2(preferencesInput)
    };
    await writeJsonAtomic(preferencesPath, record);
    return normalizeStoredPreferences(record);
  });
}

module.exports = {
  READER_STATE_SCHEMA_VERSION,
  ReaderStateConflictError,
  readReaderDocumentState,
  writeReaderDocumentState,
  readReaderGlobalPreferences,
  writeReaderGlobalPreferences
};
