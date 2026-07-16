const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const ReaderSchema = require('../../src/core/document/reader-document-schema');
const { writeJsonAtomic, cleanupAtomicTempFiles } = require('./atomic-write');
const paths = require('./library-paths');

const READER_INDEX_SCHEMA_VERSION = 1;
const READER_METADATA_SCHEMA_VERSION = 1;
const locks = new Map();

class ReaderStoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderStoreConflictError';
  }
}

class ReaderStoreCorruptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderStoreCorruptionError';
  }
}

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeTimestamp(value, label) {
  const text = cleanString(value);
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonOptional(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function withReaderLock(dataRoot, task) {
  const key = path.resolve(paths.readerDocumentsDir(dataRoot));
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

function createEmptyIndex() {
  return { schemaVersion: READER_INDEX_SCHEMA_VERSION, version: 0, updatedAt: '', documents: [] };
}

function normalizeDocumentSummary(input = {}) {
  const documentId = cleanString(input.documentId);
  if (!documentId) throw new ReaderStoreCorruptionError('reader document summary documentId is required');
  return {
    documentId,
    sourceKind: cleanString(input.sourceKind),
    format: cleanString(input.format),
    title: cleanString(input.title, '未命名文档') || '未命名文档',
    originalFileName: cleanString(input.originalFileName),
    activeRevisionId: cleanString(input.activeRevisionId),
    revisionCount: nonNegativeInteger(input.revisionCount),
    importedAt: normalizeTimestamp(input.importedAt, 'reader document summary importedAt'),
    updatedAt: normalizeTimestamp(input.updatedAt, 'reader document summary updatedAt')
  };
}

function normalizeIndex(input = {}) {
  if (Number(input.schemaVersion) !== READER_INDEX_SCHEMA_VERSION) {
    throw new ReaderStoreCorruptionError(`reader index schemaVersion must be ${READER_INDEX_SCHEMA_VERSION}`);
  }
  const documents = (Array.isArray(input.documents) ? input.documents : []).map(normalizeDocumentSummary);
  const ids = new Set();
  for (const document of documents) {
    if (ids.has(document.documentId)) throw new ReaderStoreCorruptionError(`duplicate reader index documentId: ${document.documentId}`);
    ids.add(document.documentId);
  }
  return {
    schemaVersion: READER_INDEX_SCHEMA_VERSION,
    version: nonNegativeInteger(input.version),
    updatedAt: input.updatedAt ? normalizeTimestamp(input.updatedAt, 'reader index updatedAt') : '',
    documents: documents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  };
}

async function readReaderDocumentIndex(dataRoot) {
  const stored = await readJsonOptional(paths.readerDocumentsIndexPath(dataRoot));
  return stored ? normalizeIndex(stored) : createEmptyIndex();
}

function revisionSummary(revision) {
  return {
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    contentDigest: revision.contentDigest,
    structureDigest: revision.structureDigest,
    createdAt: revision.createdAt,
    encoding: revision.encoding,
    lineEnding: revision.lineEnding,
    parserVersion: revision.parserVersion,
    chapterCount: revision.chapters.length,
    characterCount: revision.chapters.reduce(
      (total, chapter) => total + chapter.blocks.reduce((sum, block) => sum + block.text.length, 0),
      0
    )
  };
}

function chapterSummary(chapter) {
  return {
    chapterId: chapter.chapterId,
    title: chapter.title,
    order: chapter.order,
    sourceChapterId: chapter.sourceChapterId,
    blockCount: chapter.blocks.length,
    characterCount: chapter.blocks.reduce((sum, block) => sum + block.text.length, 0)
  };
}

function documentMetadataFromDocument(document) {
  return {
    schemaVersion: READER_METADATA_SCHEMA_VERSION,
    kind: 'reader-document-metadata',
    documentSchemaVersion: ReaderSchema.DOCUMENT_SCHEMA_VERSION,
    documentId: document.documentId,
    sourceKind: document.sourceKind,
    format: document.format,
    title: document.title,
    originalFileName: document.originalFileName,
    projectId: document.projectId,
    importedAt: document.importedAt,
    updatedAt: document.updatedAt,
    activeRevisionId: document.activeRevisionId,
    revisions: document.revisions.map(revisionSummary)
  };
}

function normalizeRevisionSummary(input = {}) {
  const revisionId = cleanString(input.revisionId);
  if (!revisionId) throw new ReaderStoreCorruptionError('reader revision summary revisionId is required');
  return {
    revisionId,
    parentRevisionId: cleanString(input.parentRevisionId),
    contentDigest: cleanString(input.contentDigest),
    structureDigest: cleanString(input.structureDigest),
    createdAt: normalizeTimestamp(input.createdAt, 'reader revision summary createdAt'),
    encoding: cleanString(input.encoding),
    lineEnding: cleanString(input.lineEnding, 'lf') || 'lf',
    parserVersion: cleanString(input.parserVersion),
    chapterCount: nonNegativeInteger(input.chapterCount),
    characterCount: nonNegativeInteger(input.characterCount)
  };
}

function normalizeDocumentMetadata(input = {}) {
  if (Number(input.schemaVersion) !== READER_METADATA_SCHEMA_VERSION || input.kind !== 'reader-document-metadata') {
    throw new ReaderStoreCorruptionError('reader document metadata schema is invalid');
  }
  if (Number(input.documentSchemaVersion) !== ReaderSchema.DOCUMENT_SCHEMA_VERSION) {
    throw new ReaderStoreCorruptionError(`reader document schemaVersion must be ${ReaderSchema.DOCUMENT_SCHEMA_VERSION}`);
  }
  const documentId = cleanString(input.documentId);
  if (!documentId) throw new ReaderStoreCorruptionError('reader document metadata documentId is required');
  if (!['local-text', 'pasted-text'].includes(input.sourceKind)) {
    throw new ReaderStoreCorruptionError(`reader document store cannot own sourceKind ${cleanString(input.sourceKind)}`);
  }
  const revisions = (Array.isArray(input.revisions) ? input.revisions : []).map(normalizeRevisionSummary);
  const ids = new Set();
  for (const revision of revisions) {
    if (ids.has(revision.revisionId)) throw new ReaderStoreCorruptionError(`duplicate reader revision summary: ${revision.revisionId}`);
    ids.add(revision.revisionId);
  }
  const activeRevisionId = cleanString(input.activeRevisionId);
  if (!ids.has(activeRevisionId)) throw new ReaderStoreCorruptionError(`active reader revision not found: ${activeRevisionId}`);
  return {
    schemaVersion: READER_METADATA_SCHEMA_VERSION,
    kind: 'reader-document-metadata',
    documentSchemaVersion: Number(input.documentSchemaVersion),
    documentId,
    sourceKind: input.sourceKind,
    format: cleanString(input.format),
    title: cleanString(input.title, '未命名文档') || '未命名文档',
    originalFileName: cleanString(input.originalFileName),
    projectId: '',
    importedAt: normalizeTimestamp(input.importedAt, 'reader document metadata importedAt'),
    updatedAt: normalizeTimestamp(input.updatedAt, 'reader document metadata updatedAt'),
    activeRevisionId,
    revisions
  };
}

function metadataSummary(metadataInput) {
  const metadata = normalizeDocumentMetadata(metadataInput);
  return normalizeDocumentSummary({
    ...metadata,
    revisionCount: metadata.revisions.length
  });
}

function revisionMetadata(revision) {
  return {
    schemaVersion: READER_METADATA_SCHEMA_VERSION,
    kind: 'reader-revision-metadata',
    revisionSchemaVersion: ReaderSchema.REVISION_SCHEMA_VERSION,
    ...revisionSummary(revision),
    chapters: revision.chapters.map(chapterSummary)
  };
}

function normalizeRevisionMetadata(input = {}) {
  if (Number(input.schemaVersion) !== READER_METADATA_SCHEMA_VERSION || input.kind !== 'reader-revision-metadata') {
    throw new ReaderStoreCorruptionError('reader revision metadata schema is invalid');
  }
  if (Number(input.revisionSchemaVersion) !== ReaderSchema.REVISION_SCHEMA_VERSION) {
    throw new ReaderStoreCorruptionError(`reader revision schemaVersion must be ${ReaderSchema.REVISION_SCHEMA_VERSION}`);
  }
  const summary = normalizeRevisionSummary(input);
  const chapters = (Array.isArray(input.chapters) ? input.chapters : []).map((chapter) => ({
    chapterId: cleanString(chapter.chapterId),
    title: cleanString(chapter.title),
    order: nonNegativeInteger(chapter.order),
    sourceChapterId: cleanString(chapter.sourceChapterId),
    blockCount: nonNegativeInteger(chapter.blockCount),
    characterCount: nonNegativeInteger(chapter.characterCount)
  }));
  if (chapters.some((chapter) => !chapter.chapterId)) throw new ReaderStoreCorruptionError('reader revision chapter summary id is required');
  if (summary.chapterCount !== chapters.length) throw new ReaderStoreCorruptionError('reader revision chapter count does not match metadata');
  return {
    schemaVersion: READER_METADATA_SCHEMA_VERSION,
    kind: 'reader-revision-metadata',
    revisionSchemaVersion: Number(input.revisionSchemaVersion),
    ...summary,
    chapters
  };
}

async function readReaderDocumentMetadata(dataRoot, documentId) {
  const metadata = await readJsonOptional(paths.readerDocumentMetadataPath(dataRoot, documentId));
  if (!metadata) return null;
  const normalized = normalizeDocumentMetadata(metadata);
  if (normalized.documentId !== cleanString(documentId)) throw new ReaderStoreCorruptionError('reader document path identity does not match metadata');
  return normalized;
}

async function writeReaderRevisionFiles(dataRoot, documentId, revision) {
  const metadataPath = paths.readerDocumentRevisionMetadataPath(dataRoot, documentId, revision.revisionId);
  if (await pathExists(metadataPath)) throw new Error(`reader revision is immutable and already exists: ${revision.revisionId}`);
  await fs.mkdir(paths.readerDocumentRevisionChaptersDir(dataRoot, documentId, revision.revisionId), { recursive: true });
  for (const chapter of revision.chapters) {
    await writeJsonAtomic(
      paths.readerDocumentRevisionChapterPath(dataRoot, documentId, revision.revisionId, chapter.chapterId),
      chapter
    );
  }
  await writeJsonAtomic(metadataPath, revisionMetadata(revision));
}

function assertExpectedIndexVersion(index, expectedVersion) {
  if (expectedVersion === undefined) return;
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== index.version) {
    throw new ReaderStoreConflictError('reader index version does not match');
  }
}

function assertExpectedDocumentVersion(metadata, expectedUpdatedAt) {
  if (expectedUpdatedAt === undefined) return;
  if (cleanString(expectedUpdatedAt) !== metadata.updatedAt) {
    throw new ReaderStoreConflictError('reader document updatedAt does not match');
  }
}

async function writeNextIndex(dataRoot, current, summary, updatedAt) {
  const documents = current.documents.some((item) => item.documentId === summary.documentId)
    ? current.documents.map((item) => item.documentId === summary.documentId ? summary : item)
    : [...current.documents, summary];
  const index = normalizeIndex({
    schemaVersion: READER_INDEX_SCHEMA_VERSION,
    version: current.version + 1,
    updatedAt,
    documents
  });
  await writeJsonAtomic(paths.readerDocumentsIndexPath(dataRoot), index);
  return index;
}

async function createReaderDocument(dataRoot, documentInput, options = {}) {
  return withReaderLock(dataRoot, async () => {
    const index = await readReaderDocumentIndex(dataRoot);
    assertExpectedIndexVersion(index, options.expectedIndexVersion);
    const document = ReaderSchema.createReaderDocument(documentInput, { digest: sha256 });
    if (document.sourceKind === 'project') throw new Error('project reader documents are derived and must not be written to the Reader Store');
    if (!document.revisions.length) throw new Error('stored reader document requires at least one revision');
    if (await pathExists(paths.readerDocumentMetadataPath(dataRoot, document.documentId))) {
      throw new Error(`reader document already exists: ${document.documentId}`);
    }
    const seen = new Set();
    for (const revision of document.revisions) {
      if (revision.parentRevisionId && !seen.has(revision.parentRevisionId)) {
        throw new Error(`reader parent revision must be committed first: ${revision.parentRevisionId}`);
      }
      await writeReaderRevisionFiles(dataRoot, document.documentId, revision);
      seen.add(revision.revisionId);
    }
    const metadata = documentMetadataFromDocument(document);
    await writeJsonAtomic(paths.readerDocumentMetadataPath(dataRoot, document.documentId), metadata);
    const nextIndex = await writeNextIndex(dataRoot, index, metadataSummary(metadata), metadata.updatedAt);
    return { metadata: normalizeDocumentMetadata(metadata), index: nextIndex };
  });
}

async function appendReaderDocumentRevision(dataRoot, documentId, revisionInput, options = {}) {
  return withReaderLock(dataRoot, async () => {
    const metadata = await readReaderDocumentMetadata(dataRoot, documentId);
    if (!metadata) throw new Error(`reader document not found: ${cleanString(documentId)}`);
    assertExpectedDocumentVersion(metadata, options.expectedUpdatedAt);
    const index = await readReaderDocumentIndex(dataRoot);
    assertExpectedIndexVersion(index, options.expectedIndexVersion);
    const revision = ReaderSchema.createReaderDocumentRevision({
      ...revisionInput,
      parentRevisionId: cleanString(revisionInput.parentRevisionId, metadata.activeRevisionId)
    }, { digest: sha256 });
    if (metadata.revisions.some((item) => item.revisionId === revision.revisionId)) {
      throw new Error(`reader revision is immutable and already exists: ${revision.revisionId}`);
    }
    if (revision.parentRevisionId && !metadata.revisions.some((item) => item.revisionId === revision.parentRevisionId)) {
      throw new Error(`reader parent revision not found: ${revision.parentRevisionId}`);
    }
    await writeReaderRevisionFiles(dataRoot, metadata.documentId, revision);
    const nextMetadata = {
      ...metadata,
      activeRevisionId: revision.revisionId,
      updatedAt: revision.createdAt,
      revisions: [...metadata.revisions, revisionSummary(revision)]
    };
    await writeJsonAtomic(paths.readerDocumentMetadataPath(dataRoot, metadata.documentId), nextMetadata);
    const nextIndex = await writeNextIndex(dataRoot, index, metadataSummary(nextMetadata), nextMetadata.updatedAt);
    return { metadata: normalizeDocumentMetadata(nextMetadata), revision, index: nextIndex };
  });
}

async function updateReaderDocumentMetadata(dataRoot, documentId, patch = {}, options = {}) {
  return withReaderLock(dataRoot, async () => {
    const metadata = await readReaderDocumentMetadata(dataRoot, documentId);
    if (!metadata) throw new Error(`reader document not found: ${cleanString(documentId)}`);
    assertExpectedDocumentVersion(metadata, options.expectedUpdatedAt);
    const index = await readReaderDocumentIndex(dataRoot);
    assertExpectedIndexVersion(index, options.expectedIndexVersion);
    const updatedAt = normalizeTimestamp(options.updatedAt || patch.updatedAt, 'reader document metadata updatedAt');
    const nextMetadata = normalizeDocumentMetadata({
      ...metadata,
      title: patch.title === undefined ? metadata.title : patch.title,
      originalFileName: patch.originalFileName === undefined ? metadata.originalFileName : patch.originalFileName,
      updatedAt
    });
    await writeJsonAtomic(paths.readerDocumentMetadataPath(dataRoot, metadata.documentId), nextMetadata);
    const nextIndex = await writeNextIndex(dataRoot, index, metadataSummary(nextMetadata), nextMetadata.updatedAt);
    return { metadata: nextMetadata, index: nextIndex };
  });
}

async function readReaderDocumentRevision(dataRoot, documentId, revisionId) {
  const metadataInput = await readJsonOptional(paths.readerDocumentRevisionMetadataPath(dataRoot, documentId, revisionId));
  if (!metadataInput) return null;
  const metadata = normalizeRevisionMetadata(metadataInput);
  if (metadata.revisionId !== cleanString(revisionId)) throw new ReaderStoreCorruptionError('reader revision path identity does not match metadata');
  const chapters = [];
  for (const summary of metadata.chapters) {
    const chapterInput = await readJson(paths.readerDocumentRevisionChapterPath(dataRoot, documentId, revisionId, summary.chapterId));
    const chapter = ReaderSchema.createReaderChapter(chapterInput, { index: summary.order });
    if (chapter.chapterId !== summary.chapterId || chapter.blocks.length !== summary.blockCount) {
      throw new ReaderStoreCorruptionError(`reader chapter metadata does not match: ${summary.chapterId}`);
    }
    chapters.push(chapter);
  }
  try {
    return ReaderSchema.createReaderDocumentRevision({
      schemaVersion: metadata.revisionSchemaVersion,
      revisionId: metadata.revisionId,
      parentRevisionId: metadata.parentRevisionId,
      contentDigest: metadata.contentDigest,
      structureDigest: metadata.structureDigest,
      createdAt: metadata.createdAt,
      encoding: metadata.encoding,
      lineEnding: metadata.lineEnding,
      parserVersion: metadata.parserVersion,
      chapters
    }, { digest: sha256 });
  } catch (error) {
    throw new ReaderStoreCorruptionError(`reader revision integrity check failed: ${error.message || error}`);
  }
}

async function readReaderDocumentChapter(dataRoot, documentId, revisionId, chapterId) {
  const metadataInput = await readJsonOptional(paths.readerDocumentRevisionMetadataPath(dataRoot, documentId, revisionId));
  if (!metadataInput) return null;
  const metadata = normalizeRevisionMetadata(metadataInput);
  if (metadata.revisionId !== cleanString(revisionId)) throw new ReaderStoreCorruptionError('reader revision path identity does not match metadata');
  const summary = metadata.chapters.find((chapter) => chapter.chapterId === cleanString(chapterId));
  if (!summary) return null;
  const chapterInput = await readJson(paths.readerDocumentRevisionChapterPath(dataRoot, documentId, revisionId, summary.chapterId));
  const chapter = ReaderSchema.createReaderChapter(chapterInput, { index: summary.order });
  const characterCount = chapter.blocks.reduce((total, block) => total + block.text.length, 0);
  if (chapter.chapterId !== summary.chapterId || chapter.blocks.length !== summary.blockCount || characterCount !== summary.characterCount) {
    throw new ReaderStoreCorruptionError(`reader chapter metadata does not match: ${summary.chapterId}`);
  }
  for (const block of chapter.blocks) {
    if (block.textDigest !== sha256(block.text)) {
      throw new ReaderStoreCorruptionError(`reader chapter block digest does not match: ${block.blockId}`);
    }
  }
  return {
    revision: {
      revisionId: metadata.revisionId,
      contentDigest: metadata.contentDigest,
      structureDigest: metadata.structureDigest,
      createdAt: metadata.createdAt
    },
    chapter
  };
}

async function readReaderDocumentContents(dataRoot, documentId, revisionId) {
  const metadataInput = await readJsonOptional(paths.readerDocumentRevisionMetadataPath(dataRoot, documentId, revisionId));
  if (!metadataInput) return null;
  const metadata = normalizeRevisionMetadata(metadataInput);
  if (metadata.revisionId !== cleanString(revisionId)) {
    throw new ReaderStoreCorruptionError('reader revision path identity does not match metadata');
  }
  return metadata;
}

async function readReaderDocument(dataRoot, documentId) {
  const metadata = await readReaderDocumentMetadata(dataRoot, documentId);
  if (!metadata) return null;
  const candidates = [
    metadata.activeRevisionId,
    ...metadata.revisions.map((revision) => revision.revisionId).reverse().filter((id) => id !== metadata.activeRevisionId)
  ];
  const failures = [];
  for (const revisionId of candidates) {
    try {
      const revision = await readReaderDocumentRevision(dataRoot, metadata.documentId, revisionId);
      if (!revision) throw new ReaderStoreCorruptionError(`reader revision file is missing: ${revisionId}`);
      return {
        metadata,
        revision,
        recovery: revisionId === metadata.activeRevisionId ? null : {
          status: 'recovered',
          failedRevisionId: metadata.activeRevisionId,
          recoveredRevisionId: revisionId,
          failures
        }
      };
    } catch (error) {
      failures.push({ revisionId, message: error.message || String(error) });
    }
  }
  throw new ReaderStoreCorruptionError(`reader document has no readable revision: ${metadata.documentId}`);
}

async function listReaderDocuments(dataRoot) {
  const index = await readReaderDocumentIndex(dataRoot);
  return { index, documents: index.documents.slice() };
}

async function rebuildReaderDocumentIndex(dataRoot, options = {}) {
  return withReaderLock(dataRoot, async () => {
    const root = paths.readerDocumentsDir(dataRoot);
    let entries = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
    const documents = [];
    const skipped = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'project-states') continue;
      const metadataPath = path.join(root, entry.name, 'document.json');
      try {
        const metadata = normalizeDocumentMetadata(await readJson(metadataPath));
        documents.push(metadataSummary(metadata));
      } catch (error) {
        skipped.push({ directory: entry.name, message: error.message || String(error) });
      }
    }
    const previous = await readJsonOptional(paths.readerDocumentsIndexPath(dataRoot)).catch(() => null);
    const previousVersion = previous && Number.isInteger(Number(previous.version)) ? Number(previous.version) : 0;
    const updatedAt = normalizeTimestamp(options.updatedAt || new Date().toISOString(), 'reader index rebuild updatedAt');
    const index = normalizeIndex({
      schemaVersion: READER_INDEX_SCHEMA_VERSION,
      version: previousVersion + 1,
      updatedAt,
      documents
    });
    await writeJsonAtomic(paths.readerDocumentsIndexPath(dataRoot), index);
    return { index, skipped };
  });
}

async function cleanupReaderDocumentStore(dataRoot) {
  const root = paths.readerDocumentsDir(dataRoot);
  const removedTempFiles = await cleanupAtomicTempFiles(root);
  const removedTransferTempFiles = await cleanupAtomicTempFiles(paths.readerTransfersDir(dataRoot));
  const removedOrphanRevisionDirs = [];
  const removedOrphanSourceFiles = [];
  const removedIncompleteDocumentDirs = [];
  const corruptDocumentDirs = [];
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'project-states') continue;
    const documentDir = path.join(root, entry.name);
    let metadata;
    try {
      metadata = normalizeDocumentMetadata(await readJson(path.join(documentDir, 'document.json')));
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        corruptDocumentDirs.push(documentDir);
        continue;
      }
      const resolved = path.resolve(documentDir);
      if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
        throw new Error('refusing to remove incomplete reader document outside the Reader Store root');
      }
      await fs.rm(resolved, { recursive: true, force: true });
      removedIncompleteDocumentDirs.push(resolved);
      continue;
    }
    const revisionsDir = path.join(documentDir, 'revisions');
    const referencedDirs = new Set(metadata.revisions.map((revision) => (
      path.resolve(paths.readerDocumentRevisionDir(dataRoot, metadata.documentId, revision.revisionId))
    )));
    let revisionEntries = [];
    try {
      revisionEntries = await fs.readdir(revisionsDir, { withFileTypes: true });
    } catch {
      revisionEntries = [];
    }
    for (const revisionEntry of revisionEntries) {
      if (!revisionEntry.isDirectory()) continue;
      const revisionDir = path.join(revisionsDir, revisionEntry.name);
      const resolved = path.resolve(revisionDir);
      if (!referencedDirs.has(resolved)) {
        if (!resolved.startsWith(`${path.resolve(revisionsDir)}${path.sep}`)) {
          throw new Error('refusing to remove reader revision outside the document root');
        }
        await fs.rm(resolved, { recursive: true, force: true });
        removedOrphanRevisionDirs.push(resolved);
      }
    }
    const sourceDir = paths.readerDocumentSourceDir(dataRoot, metadata.documentId);
    const referencedSourceFiles = new Set(metadata.revisions.map((revision) => (
      path.resolve(paths.readerDocumentSourceRevisionPath(
        dataRoot,
        metadata.documentId,
        revision.revisionId,
        metadata.format
      ))
    )));
    let sourceEntries = [];
    try {
      sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });
    } catch {
      sourceEntries = [];
    }
    for (const sourceEntry of sourceEntries) {
      if (!sourceEntry.isFile() || !/\.(txt|md)$/i.test(sourceEntry.name)) continue;
      const resolved = path.resolve(sourceDir, sourceEntry.name);
      if (referencedSourceFiles.has(resolved)) continue;
      if (!resolved.startsWith(`${path.resolve(sourceDir)}${path.sep}`)) {
        throw new Error('refusing to remove reader source outside the document root');
      }
      await fs.rm(resolved, { force: true });
      removedOrphanSourceFiles.push(resolved);
    }
  }
  return {
    removedTempFiles: [...removedTempFiles, ...removedTransferTempFiles],
    removedOrphanRevisionDirs,
    removedOrphanSourceFiles,
    removedIncompleteDocumentDirs,
    corruptDocumentDirs
  };
}

module.exports = {
  READER_INDEX_SCHEMA_VERSION,
  READER_METADATA_SCHEMA_VERSION,
  ReaderStoreConflictError,
  ReaderStoreCorruptionError,
  sha256,
  readReaderDocumentIndex,
  listReaderDocuments,
  readReaderDocumentMetadata,
  readReaderDocumentContents,
  readReaderDocumentRevision,
  readReaderDocumentChapter,
  readReaderDocument,
  createReaderDocument,
  appendReaderDocumentRevision,
  updateReaderDocumentMetadata,
  rebuildReaderDocumentIndex,
  cleanupReaderDocumentStore
};
