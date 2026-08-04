const fs = require('fs/promises');

const ReaderAnnotation = require('../../src/core/document/reader-annotation');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

const STORE_SCHEMA_VERSION = 1;
const locks = new Map();

class ReaderAnnotationConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderAnnotationConflictError';
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

function normalizeAnnotationRecord(input, expectedDocumentId) {
  if (Number(input.schemaVersion) !== STORE_SCHEMA_VERSION || input.kind !== 'reader-annotations') {
    throw new Error('reader annotation store schema is invalid');
  }
  const documentId = cleanString(input.documentId);
  if (!documentId || documentId !== cleanString(expectedDocumentId)) throw new Error('reader annotation path identity does not match record');
  const annotations = (Array.isArray(input.annotations) ? input.annotations : []).map(ReaderAnnotation.createReaderAnnotation);
  const ids = new Set();
  annotations.forEach((annotation) => {
    if (annotation.documentId !== documentId) throw new Error('reader annotation document identity does not match record');
    if (ids.has(annotation.annotationId)) throw new Error(`duplicate reader annotationId: ${annotation.annotationId}`);
    ids.add(annotation.annotationId);
  });
  return { documentId, updatedAt: timestamp(input.updatedAt, 'reader annotations updatedAt'), annotations };
}

async function readReaderAnnotations(dataRoot, documentId) {
  const normalizedDocumentId = cleanString(documentId);
  if (!normalizedDocumentId) throw new Error('reader documentId is required');
  const stored = await readJsonOptional(paths.readerDocumentAnnotationsPath(dataRoot, normalizedDocumentId));
  return stored ? normalizeAnnotationRecord(stored, normalizedDocumentId) : null;
}

async function writeReaderAnnotations(dataRoot, documentId, annotationsInput, options = {}) {
  const normalizedDocumentId = cleanString(documentId);
  if (!normalizedDocumentId) throw new Error('reader documentId is required');
  const filePath = paths.readerDocumentAnnotationsPath(dataRoot, normalizedDocumentId);
  return withLock(filePath, async () => {
    const current = await readReaderAnnotations(dataRoot, normalizedDocumentId);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current && current.updatedAt)) {
      throw new ReaderAnnotationConflictError('reader annotations updatedAt does not match');
    }
    const record = {
      schemaVersion: STORE_SCHEMA_VERSION,
      kind: 'reader-annotations',
      documentId: normalizedDocumentId,
      updatedAt: timestamp(options.updatedAt || new Date().toISOString(), 'reader annotations updatedAt'),
      annotations: Array.isArray(annotationsInput) ? annotationsInput : []
    };
    const normalized = normalizeAnnotationRecord(record, normalizedDocumentId);
    await writeJsonAtomic(filePath, { ...record, annotations: normalized.annotations });
    return normalized;
  });
}

async function upsertReaderAnnotation(dataRoot, annotationInput, options = {}) {
  const documentId = cleanString(annotationInput && annotationInput.documentId);
  if (!documentId) throw new Error('reader annotation documentId is required');
  const filePath = paths.readerDocumentAnnotationsPath(dataRoot, documentId);
  return withLock(filePath, async () => {
    const current = await readReaderAnnotations(dataRoot, documentId);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current && current.updatedAt)) {
      throw new ReaderAnnotationConflictError('reader annotations updatedAt does not match');
    }
    const now = options.updatedAt || new Date().toISOString();
    const existing = current && current.annotations.find((item) => item.annotationId === cleanString(annotationInput.annotationId || annotationInput.id));
    const annotation = ReaderAnnotation.createReaderAnnotation({
      ...existing,
      ...annotationInput,
      createdAt: annotationInput.createdAt || (existing && existing.createdAt) || now,
      updatedAt: annotationInput.updatedAt || now
    });
    const annotations = current
      ? [...current.annotations.filter((item) => item.annotationId !== annotation.annotationId), annotation]
      : [annotation];
    const record = {
      schemaVersion: STORE_SCHEMA_VERSION,
      kind: 'reader-annotations',
      documentId,
      updatedAt: timestamp(now, 'reader annotations updatedAt'),
      annotations
    };
    const normalized = normalizeAnnotationRecord(record, documentId);
    await writeJsonAtomic(filePath, { ...record, annotations: normalized.annotations });
    return normalized;
  });
}

async function deleteReaderAnnotation(dataRoot, documentId, annotationId, options = {}) {
  const normalizedDocumentId = cleanString(documentId);
  const filePath = paths.readerDocumentAnnotationsPath(dataRoot, normalizedDocumentId);
  return withLock(filePath, async () => {
    const current = await readReaderAnnotations(dataRoot, normalizedDocumentId);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current && current.updatedAt)) {
      throw new ReaderAnnotationConflictError('reader annotations updatedAt does not match');
    }
    if (!current || !current.annotations.some((item) => item.annotationId === cleanString(annotationId))) return { record: current, deleted: false };
    const now = options.updatedAt || new Date().toISOString();
    const stored = {
      schemaVersion: STORE_SCHEMA_VERSION,
      kind: 'reader-annotations',
      documentId: normalizedDocumentId,
      updatedAt: timestamp(now, 'reader annotations updatedAt'),
      annotations: current.annotations.filter((item) => item.annotationId !== cleanString(annotationId))
    };
    await writeJsonAtomic(filePath, stored);
    return { record: normalizeAnnotationRecord(stored, normalizedDocumentId), deleted: true };
  });
}

function normalizeHistoryRecord(input) {
  if (Number(input.schemaVersion) !== STORE_SCHEMA_VERSION || input.kind !== 'reader-position-history') {
    throw new Error('reader history store schema is invalid');
  }
  return {
    updatedAt: timestamp(input.updatedAt, 'reader history updatedAt'),
    history: ReaderAnnotation.createReaderPositionHistory(input.history)
  };
}

async function readReaderPositionHistory(dataRoot) {
  const stored = await readJsonOptional(paths.readerPositionHistoryPath(dataRoot));
  return stored ? normalizeHistoryRecord(stored) : null;
}

async function appendReaderPositionHistory(dataRoot, entry, options = {}) {
  const filePath = paths.readerPositionHistoryPath(dataRoot);
  return withLock(filePath, async () => {
    const current = await readReaderPositionHistory(dataRoot);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current && current.updatedAt)) {
      throw new ReaderAnnotationConflictError('reader history updatedAt does not match');
    }
    const history = ReaderAnnotation.appendReaderPositionHistory(current && current.history, entry);
    const record = {
      schemaVersion: STORE_SCHEMA_VERSION,
      kind: 'reader-position-history',
      updatedAt: timestamp(options.updatedAt || new Date().toISOString(), 'reader history updatedAt'),
      history
    };
    await writeJsonAtomic(filePath, record);
    return normalizeHistoryRecord(record);
  });
}

module.exports = {
  STORE_SCHEMA_VERSION,
  ReaderAnnotationConflictError,
  readReaderAnnotations,
  writeReaderAnnotations,
  upsertReaderAnnotation,
  deleteReaderAnnotation,
  readReaderPositionHistory,
  appendReaderPositionHistory
};
