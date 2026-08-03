const ReaderDocument = require('../../src/core/document/reader-document');

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
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
    ),
    chapters: revision.chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      title: chapter.title,
      order: chapter.order,
      sourceChapterId: chapter.sourceChapterId,
      blockCount: chapter.blocks.length,
      characterCount: chapter.blocks.reduce((sum, block) => sum + block.text.length, 0)
    }))
  };
}

function metadataFromProjection(document) {
  const revision = document.revisions[document.revisions.length - 1];
  const summary = revisionSummary(revision);
  return {
    schemaVersion: 1,
    kind: 'reader-project-document-metadata',
    documentSchemaVersion: document.schemaVersion,
    documentId: document.documentId,
    sourceKind: 'project',
    format: 'project',
    title: document.title,
    originalFileName: '',
    projectId: document.projectId,
    importedAt: document.importedAt,
    updatedAt: document.updatedAt,
    activeRevisionId: revision.revisionId,
    revisions: [summary],
    revisionCount: 1
  };
}

function createReaderProjectLibraryService({ projectService, digest } = {}) {
  if (!projectService || typeof projectService.openProject !== 'function' || typeof projectService.listProjects !== 'function') {
    throw new Error('reader project library requires projectService');
  }
  if (typeof digest !== 'function') throw new Error('reader project library requires digest');

  async function projectProjection(dataRoot, projectId) {
    const id = cleanString(projectId);
    if (!id || id.includes('/') || id.includes('\\')) throw new Error('reader projectId is invalid');
    const opened = await projectService.openProject(dataRoot, id);
    const project = opened && opened.project ? opened.project : opened;
    if (!project || cleanString(project.id) !== id) throw new Error('reader project not found');
    return ReaderDocument.projectToReaderDocumentV2(project, { digest });
  }

  async function listDocuments(dataRoot) {
    const result = await projectService.listProjects(dataRoot);
    const projects = Array.isArray(result && result.projects) ? result.projects : [];
    return projects.filter((project) => cleanString(project.id)).map((project) => ({
      documentId: `project:${project.id}`,
      sourceKind: 'project',
      format: 'project',
      title: cleanString(project.title, project.id) || project.id,
      originalFileName: '',
      projectId: project.id,
      importedAt: project.updatedAt || '',
      updatedAt: project.updatedAt || '',
      activeRevisionId: '',
      revisionCount: 1,
      chapterCount: Number(project.chapterCount) || 0,
      characterCount: Number(project.wordCount) || 0,
      source: 'project'
    }));
  }

  async function readMetadata(dataRoot, projectId) {
    return metadataFromProjection(await projectProjection(dataRoot, projectId));
  }

  async function readContents(dataRoot, projectId) {
    const document = await projectProjection(dataRoot, projectId);
    const revision = document.revisions[document.revisions.length - 1];
    return {
      revisionId: revision.revisionId,
      chapters: revision.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        title: chapter.title,
        order: chapter.order,
        sourceChapterId: chapter.sourceChapterId,
        blockCount: chapter.blocks.length,
        characterCount: chapter.blocks.reduce((sum, block) => sum + block.text.length, 0)
      }))
    };
  }

  async function readChapter(dataRoot, projectId, revisionId, chapterId) {
    const document = await projectProjection(dataRoot, projectId);
    const revision = document.revisions.find((item) => item.revisionId === cleanString(revisionId)) || document.revisions[0];
    const chapter = revision && revision.chapters.find((item) => item.chapterId === cleanString(chapterId));
    return chapter ? { revision, chapter } : null;
  }

  return { listDocuments, projectProjection, readMetadata, readContents, readChapter };
}

module.exports = { createReaderProjectLibraryService, metadataFromProjection, revisionSummary };
