const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const ReaderImport = require('../../src/core/document/reader-import');
const ReaderEpubAdapter = require('../../src/core/document/reader-epub-adapter');
const readerStore = require('../storage/reader-document-store');
const libraryPaths = require('../storage/library-paths');
const { writeFileAtomic } = require('../storage/atomic-write');

const DEFAULT_MAX_IMPORT_BYTES = 64 * 1024 * 1024;

function cleanString(value, fallback = '') {
  return String(value === undefined || value === null ? fallback : value).trim();
}

function formatFromFileName(fileName) {
  const extension = path.extname(cleanString(fileName)).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'md';
  if (extension === '.txt') return 'txt';
  if (extension === '.epub') return 'epub';
  throw new Error(`reader import file type is not supported: ${extension || '(none)'}`);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function createReaderLibraryService(dependencies = {}) {
  const store = dependencies.store || readerStore;
  const clock = dependencies.clock || (() => new Date().toISOString());
  const idFactory = dependencies.idFactory || ((kind) => `${kind}:${crypto.randomUUID()}`);
  const maxImportBytes = Number.isFinite(Number(dependencies.maxImportBytes))
    ? Math.max(1, Number(dependencies.maxImportBytes))
    : DEFAULT_MAX_IMPORT_BYTES;
  const drafts = new Map();

  function publicDraft(record) {
    return record ? record.draft : null;
  }

  function requireDraft(draftId) {
    const record = drafts.get(cleanString(draftId));
    if (!record) throw new Error(`reader import draft not found: ${cleanString(draftId) || '(empty)'}`);
    return record;
  }

  function rebuildDraft(record, input = {}) {
    const format = cleanString(input.format, record.format);
    if ((record.format === 'epub') !== (format === 'epub')) throw new Error('reader EPUB import format cannot be changed during retry');
    const title = input.title === undefined ? record.draft.title : input.title;
    const draft = ReaderImport.createReaderImportDraft({
      draftId: record.draft.draftId,
      sourceKind: record.sourceKind,
      format,
      originalFileName: record.originalFileName,
      bytes: record.sourceKind === 'local-text' ? record.bytes : undefined,
      parsed: format === 'epub' ? record.parsed : undefined,
      text: record.sourceKind === 'pasted-text' ? record.text : undefined,
      encoding: input.encoding || record.encoding || 'auto',
      title,
      createdAt: record.draft.createdAt
    });
    record.format = format;
    record.encoding = input.encoding || record.encoding || 'auto';
    record.draft = draft;
    return draft;
  }

  async function previewFileImport(input = {}) {
    const requestedPath = cleanString(input.filePath || input.path);
    if (!requestedPath || requestedPath.includes('\0')) throw new Error('reader import filePath is required');
    const resolvedPath = path.resolve(requestedPath);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) throw new Error('reader import source must be a regular file');
    if (stats.size > maxImportBytes) throw new Error(`reader import file exceeds ${maxImportBytes} bytes`);
    const originalFileName = path.basename(resolvedPath);
    const inferredFormat = formatFromFileName(originalFileName);
    const format = cleanString(input.format, inferredFormat);
    if (!['txt', 'md', 'epub'].includes(format)) throw new Error(`reader import format ${format} is not valid for local-text`);
    const bytes = await fs.readFile(resolvedPath);
    if (bytes.length > maxImportBytes) throw new Error(`reader import file exceeds ${maxImportBytes} bytes`);
    const parsed = format === 'epub'
      ? await ReaderEpubAdapter.parseEpub(bytes, { maxArchiveBytes: maxImportBytes, fileName: originalFileName })
      : undefined;
    const draftId = cleanString(input.draftId, idFactory('reader-import-draft'));
    const draft = ReaderImport.createReaderImportDraft({
      draftId,
      sourceKind: 'local-text',
      format,
      originalFileName,
      bytes,
      parsed,
      encoding: input.encoding || 'auto',
      title: input.title,
      createdAt: input.createdAt || clock()
    });
    drafts.set(draftId, {
      draft,
      sourceKind: 'local-text',
      format,
      encoding: input.encoding || 'auto',
      originalFileName,
      sourcePath: resolvedPath,
      bytes,
      parsed
    });
    return draft;
  }

  async function previewBytesImport(input = {}) {
    const originalFileName = cleanString(input.originalFileName || input.fileName);
    if (!originalFileName || originalFileName.includes('\0')) throw new Error('reader import originalFileName is required');
    const inferredFormat = formatFromFileName(originalFileName);
    const format = cleanString(input.format, inferredFormat);
    if (!['txt', 'md', 'epub'].includes(format)) throw new Error(`reader import format ${format} is not valid for local-text`);
    let bytes;
    if (typeof input.bytes === 'string') {
      const encoded = input.bytes.trim();
      if (!encoded || encoded.length > Math.ceil(maxImportBytes * 4 / 3) + 16 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        throw new Error('reader import bytes must be a valid base64 payload');
      }
      bytes = Buffer.from(encoded, 'base64');
    } else if (Buffer.isBuffer(input.bytes) || input.bytes instanceof Uint8Array || input.bytes instanceof ArrayBuffer || Array.isArray(input.bytes)) {
      bytes = Buffer.from(input.bytes);
    } else {
      throw new Error('reader import bytes are required');
    }
    if (bytes.length > maxImportBytes) throw new Error(`reader import file exceeds ${maxImportBytes} bytes`);
    const parsed = format === 'epub'
      ? await ReaderEpubAdapter.parseEpub(bytes, { maxArchiveBytes: maxImportBytes, fileName: originalFileName })
      : undefined;
    const draftId = cleanString(input.draftId, idFactory('reader-import-draft'));
    const draft = ReaderImport.createReaderImportDraft({
      draftId,
      sourceKind: 'local-text',
      format,
      originalFileName,
      bytes,
      parsed,
      encoding: input.encoding || 'auto',
      title: input.title,
      createdAt: input.createdAt || clock()
    });
    drafts.set(draftId, {
      draft,
      sourceKind: 'local-text',
      format,
      encoding: input.encoding || 'auto',
      originalFileName,
      sourcePath: '',
      bytes,
      parsed
    });
    return draft;
  }

  function previewPastedImport(input = {}) {
    const draftId = cleanString(input.draftId, idFactory('reader-import-draft'));
    const format = cleanString(input.format, 'plain');
    const text = String(input.text === undefined || input.text === null ? '' : input.text);
    if (Buffer.byteLength(text, 'utf8') > maxImportBytes) throw new Error(`reader pasted text exceeds ${maxImportBytes} bytes`);
    const draft = ReaderImport.createReaderImportDraft({
      draftId,
      sourceKind: 'pasted-text',
      format,
      text,
      title: input.title,
      createdAt: input.createdAt || clock()
    });
    drafts.set(draftId, {
      draft,
      sourceKind: 'pasted-text',
      format,
      encoding: 'unicode-text',
      originalFileName: '',
      text
    });
    return draft;
  }

  function retryImportDraft(draftId, input = {}) {
    return rebuildDraft(requireDraft(draftId), input);
  }

  function correctImportDraft(draftId, corrections = {}) {
    const record = requireDraft(draftId);
    record.draft = ReaderImport.applyReaderImportCorrections(record.draft, corrections);
    return record.draft;
  }

  function splitImportChapter(draftId, input = {}) {
    const record = requireDraft(draftId);
    record.draft = ReaderImport.splitReaderImportChapter(record.draft, input);
    return record.draft;
  }

  function mergeImportChapters(draftId, input = {}) {
    const record = requireDraft(draftId);
    record.draft = ReaderImport.mergeReaderImportChapters(record.draft, input);
    return record.draft;
  }

  async function copySource(record, dataRoot, documentId, revisionId) {
    if (record.sourceKind !== 'local-text') return '';
    const target = libraryPaths.readerDocumentSourceRevisionPath(dataRoot, documentId, revisionId, record.format);
    if (await exists(target)) throw new Error(`reader source copy already exists: ${revisionId}`);
    await writeFileAtomic(target, record.bytes);
    return target;
  }

  async function confirmImportDraft(dataRoot, draftId, input = {}) {
    const record = requireDraft(draftId);
    const timestamp = input.createdAt || clock();
    const requestedDocumentId = cleanString(input.documentId || input.reimportDocumentId);
    const existing = requestedDocumentId ? await store.readReaderDocumentMetadata(dataRoot, requestedDocumentId) : null;
    const documentId = requestedDocumentId || cleanString(idFactory('reader-document'));
    if (!documentId || documentId.startsWith('project:')) throw new Error('external reader documentId is invalid');
    if (requestedDocumentId && !existing && input.reimportDocumentId) {
      throw new Error(`reader document not found: ${requestedDocumentId}`);
    }
    if (existing && (existing.sourceKind !== record.sourceKind || existing.format !== record.format)) {
      throw new Error('reader reimport source kind and format must match the existing document');
    }
    const revisionId = cleanString(input.revisionId, idFactory('reader-revision'));
    const confirmed = ReaderImport.confirmReaderImportDraft(record.draft, {
      documentId,
      revisionId,
      parentRevisionId: existing ? existing.activeRevisionId : '',
      title: input.title,
      createdAt: timestamp,
      encodingConfirmed: input.encodingConfirmed
    }, { digest: store.sha256 });
    const documentDir = libraryPaths.readerDocumentDir(dataRoot, documentId);
    const documentDirExisted = await exists(documentDir);
    if (!existing && documentDirExisted) throw new Error(`reader document path is unavailable: ${documentId}`);
    let sourceCopy = '';
    try {
      sourceCopy = await copySource(record, dataRoot, documentId, revisionId);
      const committed = existing
        ? await store.appendReaderDocumentRevision(dataRoot, documentId, confirmed.revision, {
          expectedUpdatedAt: input.expectedUpdatedAt === undefined ? existing.updatedAt : input.expectedUpdatedAt,
          expectedIndexVersion: input.expectedIndexVersion
        })
        : await store.createReaderDocument(dataRoot, confirmed.document, {
          expectedIndexVersion: input.expectedIndexVersion
        });
      drafts.delete(record.draft.draftId);
      return {
        ok: true,
        draftId: record.draft.draftId,
        documentId,
        revisionId,
        reimported: !!existing,
        sourceCopied: !!sourceCopy,
        sourceCopy,
        metadata: committed.metadata,
        revision: committed.revision || confirmed.revision,
        index: committed.index
      };
    } catch (error) {
      if (sourceCopy) await fs.rm(sourceCopy, { force: true }).catch(() => {});
      if (!existing && !documentDirExisted) await fs.rm(documentDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  function getImportDraft(draftId) {
    return publicDraft(drafts.get(cleanString(draftId)));
  }

  function discardImportDraft(draftId) {
    return drafts.delete(cleanString(draftId));
  }

  function listImportDrafts() {
    return [...drafts.values()].map(publicDraft);
  }

  return {
    previewFileImport,
    previewBytesImport,
    previewPastedImport,
    retryImportDraft,
    correctImportDraft,
    splitImportChapter,
    mergeImportChapters,
    confirmImportDraft,
    getImportDraft,
    discardImportDraft,
    listImportDrafts
  };
}

const defaultService = createReaderLibraryService();

module.exports = {
  DEFAULT_MAX_IMPORT_BYTES,
  formatFromFileName,
  createReaderLibraryService,
  ...defaultService
};
