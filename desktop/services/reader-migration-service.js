const fs = require('fs/promises');

const ReaderLocator = require('../../src/core/document/reader-locator');
const ReaderPreferences = require('../../src/core/document/reader-preferences');
const { projectToReaderDocumentV2 } = require('../../src/core/document/reader-document');
const projectServiceDefault = require('./project-service');
const readerLibraryDefault = require('./reader-library-service');
const readerStoreDefault = require('../storage/reader-document-store');
const readerStateStoreDefault = require('../storage/reader-state-store');
const paths = require('../storage/library-paths');
const { writeJsonAtomic } = require('../storage/atomic-write');

const MIGRATION_SCHEMA_VERSION = 1;

function cleanString(value, fallback = '') {
  return String(value === undefined || value === null ? fallback : value).trim();
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function parseLegacyState(input) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input === 'string') {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('legacy reader state must be an object');
    return parsed;
  }
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('legacy reader state must be an object');
  return input;
}

function legacyPreferences(legacy = {}) {
  const fontMap = { serif: 'serif', yahei: 'sans-serif', system: 'system', sans: 'sans-serif', kai: 'kai' };
  const theme = ['dark', 'paper', 'sepia'].includes(cleanString(legacy.theme)) ? cleanString(legacy.theme) : 'dark';
  return ReaderPreferences.createReaderPreferencesV2({
    layoutMode: 'double-page',
    pageTransition: 'fade',
    themeId: theme,
    fontFamilyId: fontMap[cleanString(legacy.fontFamily)] || 'system',
    fontSize: clamp(legacy.fontSize, 12, 48, 18),
    lineHeight: clamp(legacy.lineHeight, 1.2, 3, 1.8),
    paragraphSpacing: clamp(legacy.paragraphSpacing, 0, 3, 1.05),
    indent: legacy.indent !== false
  });
}

function legacyChapterRatio(legacy, chapterIndex) {
  const document = legacy.document || {};
  const chapter = Array.isArray(document.chapters) ? document.chapters[chapterIndex] || {} : {};
  const documentKey = document.source === 'project'
    ? `project:${document.projectId || document.title || ''}`
    : `file:${document.fileName || document.title || ''}`;
  const key = `${documentKey}:${chapter.id || chapterIndex}`;
  return clamp(legacy.scrollPositions && legacy.scrollPositions[key], 0, 1, 0);
}

function approximateLocator(documentId, projectId, revision, legacy) {
  const chapters = revision.chapters || [];
  if (!chapters.length) return null;
  const legacyIndex = Math.floor(clamp(legacy.chapterIndex, 0, Math.max(0, chapters.length - 1), 0));
  const legacyChapter = legacy.document && Array.isArray(legacy.document.chapters)
    ? legacy.document.chapters[legacyIndex]
    : null;
  const chapter = chapters.find((item) => legacyChapter && item.chapterId === legacyChapter.id) || chapters[legacyIndex] || chapters[0];
  const blocks = chapter.blocks.filter((block) => block.text.length > 0);
  if (!blocks.length) return null;
  const ratio = legacyChapterRatio(legacy, legacyIndex);
  const total = blocks.reduce((sum, block) => sum + block.text.length, 0);
  let remaining = Math.floor(total * ratio);
  let target = blocks[blocks.length - 1];
  let offset = target.text.length;
  for (const block of blocks) {
    if (remaining <= block.text.length) {
      target = block;
      offset = remaining;
      break;
    }
    remaining -= block.text.length;
  }
  return ReaderLocator.locatorFromBlockPosition({
    documentId,
    projectId,
    chapterId: chapter.chapterId,
    blockId: target.blockId,
    offset
  }, revision);
}

function legacyExternalChapters(document = {}) {
  return (Array.isArray(document.chapters) ? document.chapters : []).map((chapter, chapterIndex) => {
    const blocks = String(chapter.content || '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, blockIndex) => ({
        blockId: `legacy-${chapterIndex + 1}-block-${blockIndex + 1}`,
        type: 'paragraph',
        text,
        order: blockIndex
      }));
    return {
      chapterId: `legacy-chapter-${chapterIndex + 1}`,
      title: cleanString(chapter.title, `第 ${chapterIndex + 1} 章`) || `第 ${chapterIndex + 1} 章`,
      order: chapterIndex,
      sourceChapterId: '',
      blocks
    };
  });
}

function externalSummary(document = {}) {
  const chapters = legacyExternalChapters(document);
  return {
    title: cleanString(document.title, '旧阅读文档') || '旧阅读文档',
    fileName: cleanString(document.fileName),
    chapterCount: chapters.length,
    characterCount: chapters.reduce((total, chapter) => total + chapter.blocks.reduce((sum, block) => sum + block.text.length, 0), 0)
  };
}

function createReaderMigrationService(dependencies = {}) {
  const projectService = dependencies.projectService || projectServiceDefault;
  const readerLibrary = dependencies.readerLibrary || readerLibraryDefault;
  const readerStore = dependencies.readerStore || readerStoreDefault;
  const stateStore = dependencies.stateStore || readerStateStoreDefault;
  const clock = dependencies.clock || (() => new Date().toISOString());
  const writeRecord = dependencies.writeRecord || writeJsonAtomic;

  async function readMigrationRecord(dataRoot) {
    try {
      const record = JSON.parse(await fs.readFile(paths.readerMigrationPath(dataRoot), 'utf8'));
      if (Number(record.schemaVersion) !== MIGRATION_SCHEMA_VERSION) throw new Error('reader migration schema is invalid');
      return record;
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function saveMigrationRecord(dataRoot, input) {
    const record = {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      kind: 'reader-legacy-migration',
      ...input,
      updatedAt: input.updatedAt || clock()
    };
    await writeRecord(paths.readerMigrationPath(dataRoot), record);
    return record;
  }

  async function writePositionState(dataRoot, documentId, revision, legacy, projectId = '') {
    const locator = approximateLocator(documentId, projectId, revision, legacy);
    const state = await stateStore.writeReaderDocumentState(dataRoot, {
      documentId,
      positionLocator: locator,
      updatedAt: clock(),
      preferenceOverrides: {
        migrationResolution: locator ? 'approximate' : 'unresolved',
        legacyChapterIndex: Math.floor(clamp(legacy.chapterIndex, 0, Number.MAX_SAFE_INTEGER, 0)),
        legacyScrollRatio: legacyChapterRatio(legacy, Math.floor(clamp(legacy.chapterIndex, 0, Number.MAX_SAFE_INTEGER, 0)))
      },
      bookmarks: []
    });
    const reopened = await stateStore.readReaderDocumentState(dataRoot, documentId);
    if (!reopened || reopened.updatedAt !== state.updatedAt) throw new Error('migrated reader state could not be reopened');
    return reopened;
  }

  async function migrateProject(dataRoot, legacy) {
    const projectId = cleanString(legacy.document && legacy.document.projectId);
    if (!projectId) throw new Error('legacy project reader state is missing projectId');
    const opened = await projectService.openProject(dataRoot, projectId);
    const project = opened && opened.project ? opened.project : opened;
    const document = projectToReaderDocumentV2(project, { digest: readerStore.sha256 });
    const revision = document.revisions.find((item) => item.revisionId === document.activeRevisionId);
    const state = await writePositionState(dataRoot, document.documentId, revision, legacy, projectId);
    return { documentId: document.documentId, revisionId: revision.revisionId, state };
  }

  async function migrateExternal(dataRoot, legacy, fingerprint) {
    const document = legacy.document || {};
    const chapters = legacyExternalChapters(document);
    const text = chapters.flatMap((chapter) => chapter.blocks.map((block) => block.text)).join('\n\n');
    const draftId = `legacy-reader-draft:${fingerprint}`;
    readerLibrary.previewPastedImport({
      draftId,
      format: 'plain',
      title: cleanString(document.title, '旧阅读文档'),
      text,
      createdAt: clock()
    });
    readerLibrary.correctImportDraft(draftId, { title: document.title, chapters });
    const documentId = `legacy-reader:${fingerprint}`;
    const revisionId = `legacy-reader-revision:${fingerprint}`;
    const existing = await readerStore.readReaderDocumentMetadata(dataRoot, documentId);
    if (!existing || !existing.revisions.some((revision) => revision.revisionId === revisionId)) {
      await readerLibrary.confirmImportDraft(dataRoot, draftId, {
        documentId,
        revisionId,
        createdAt: clock()
      });
    } else {
      readerLibrary.discardImportDraft(draftId);
    }
    const reopened = await readerStore.readReaderDocument(dataRoot, documentId);
    if (!reopened || reopened.metadata.activeRevisionId !== revisionId) throw new Error('migrated external reader document could not be reopened');
    const state = await writePositionState(dataRoot, documentId, reopened.revision, legacy);
    return { documentId, revisionId, state };
  }

  async function migrateLegacyReaderState(dataRoot, legacyInput, options = {}) {
    const current = await readMigrationRecord(dataRoot);
    if (current && current.status === 'complete') {
      return { ...current, alreadyMigrated: true, canClearLegacyState: current.verified === true };
    }
    let legacy;
    try {
      legacy = parseLegacyState(legacyInput);
    } catch (error) {
      const failed = await saveMigrationRecord(dataRoot, {
        status: 'failed',
        verified: false,
        reason: 'invalid-legacy-json',
        error: error.message
      });
      return { ...failed, canClearLegacyState: false };
    }
    if (!legacy || !Object.keys(legacy).length) {
      const complete = await saveMigrationRecord(dataRoot, { status: 'complete', verified: true, reason: 'no-data' });
      return { ...complete, canClearLegacyState: true };
    }
    try {
      await stateStore.writeReaderGlobalPreferences(dataRoot, legacyPreferences(legacy), { updatedAt: clock() });
      const document = legacy.document && typeof legacy.document === 'object' ? legacy.document : null;
      if (!document || !Array.isArray(document.chapters)) {
        const complete = await saveMigrationRecord(dataRoot, { status: 'complete', verified: true, reason: 'preferences-only' });
        return { ...complete, canClearLegacyState: true };
      }
      if (document.source === 'project') {
        const migrated = await migrateProject(dataRoot, legacy);
        const complete = await saveMigrationRecord(dataRoot, {
          status: 'complete', verified: true, reason: 'project-state-migrated', ...migrated
        });
        return { ...complete, canClearLegacyState: true };
      }
      const summary = externalSummary(document);
      const fingerprint = readerStore.sha256(JSON.stringify({ document, chapterIndex: legacy.chapterIndex, scrollPositions: legacy.scrollPositions }))
        .replace(/^sha256:/, '').slice(0, 32);
      const action = cleanString(options.externalAction);
      if (action === 'abandon') {
        const complete = await saveMigrationRecord(dataRoot, {
          status: 'complete', verified: true, reason: 'external-abandoned', externalSummary: summary
        });
        return { ...complete, canClearLegacyState: true };
      }
      if (action !== 'confirm') {
        const pending = await saveMigrationRecord(dataRoot, {
          status: 'pending-external', verified: false, reason: 'external-confirmation-required', externalSummary: summary
        });
        return { ...pending, canClearLegacyState: false };
      }
      const migrated = await migrateExternal(dataRoot, legacy, fingerprint);
      const complete = await saveMigrationRecord(dataRoot, {
        status: 'complete', verified: true, reason: 'external-imported', externalSummary: summary, ...migrated
      });
      return { ...complete, canClearLegacyState: true };
    } catch (error) {
      const failed = await saveMigrationRecord(dataRoot, {
        status: 'failed', verified: false, reason: 'migration-failed', error: error.message
      });
      return { ...failed, canClearLegacyState: false };
    }
  }

  return { readMigrationRecord, migrateLegacyReaderState };
}

const defaultService = createReaderMigrationService();

module.exports = {
  MIGRATION_SCHEMA_VERSION,
  parseLegacyState,
  legacyPreferences,
  approximateLocator,
  externalSummary,
  createReaderMigrationService,
  ...defaultService
};
