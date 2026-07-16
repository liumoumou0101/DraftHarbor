const crypto = require('crypto');
const path = require('path');

function sanitizePathSegment(value, fallback = 'item') {
  const safe = String(value || '')
    .split('')
    .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ .]+$/g, '');
  return safe.slice(0, 80) || fallback;
}

function libraryRoot(dataRoot) {
  return path.join(dataRoot, 'DraftHarbor Library');
}

function stableReaderPathSegment(value, fallback = 'reader-item') {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('reader path id is required');
  const readable = sanitizePathSegment(raw, fallback).slice(0, 48);
  const digest = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
  return `${readable}-${digest}`;
}

function readerDocumentsDir(dataRoot) {
  return path.join(libraryRoot(dataRoot), 'reader-documents');
}

function readerDocumentsIndexPath(dataRoot) {
  return path.join(readerDocumentsDir(dataRoot), 'index.json');
}

function readerPreferencesPath(dataRoot) {
  return path.join(readerDocumentsDir(dataRoot), 'preferences.json');
}

function readerMigrationPath(dataRoot) {
  return path.join(readerDocumentsDir(dataRoot), 'migration-v1.json');
}

function readerDocumentDir(dataRoot, documentId) {
  return path.join(readerDocumentsDir(dataRoot), stableReaderPathSegment(documentId, 'reader-document'));
}

function readerDocumentMetadataPath(dataRoot, documentId) {
  return path.join(readerDocumentDir(dataRoot, documentId), 'document.json');
}

function readerDocumentSourceDir(dataRoot, documentId) {
  return path.join(readerDocumentDir(dataRoot, documentId), 'source');
}

function readerDocumentSourceRevisionPath(dataRoot, documentId, revisionId, format = 'txt') {
  const extension = String(format || '').toLowerCase() === 'md' ? 'md' : 'txt';
  return path.join(
    readerDocumentSourceDir(dataRoot, documentId),
    `${stableReaderPathSegment(revisionId, 'reader-source')}.${extension}`
  );
}

function readerDocumentRevisionsDir(dataRoot, documentId) {
  return path.join(readerDocumentDir(dataRoot, documentId), 'revisions');
}

function readerDocumentRevisionDir(dataRoot, documentId, revisionId) {
  return path.join(readerDocumentRevisionsDir(dataRoot, documentId), stableReaderPathSegment(revisionId, 'reader-revision'));
}

function readerDocumentRevisionMetadataPath(dataRoot, documentId, revisionId) {
  return path.join(readerDocumentRevisionDir(dataRoot, documentId, revisionId), 'revision.json');
}

function readerDocumentRevisionChaptersDir(dataRoot, documentId, revisionId) {
  return path.join(readerDocumentRevisionDir(dataRoot, documentId, revisionId), 'chapters');
}

function readerDocumentRevisionChapterPath(dataRoot, documentId, revisionId, chapterId) {
  return path.join(
    readerDocumentRevisionChaptersDir(dataRoot, documentId, revisionId),
    `${stableReaderPathSegment(chapterId, 'reader-chapter')}.json`
  );
}

function readerProjectStatesDir(dataRoot) {
  return path.join(readerDocumentsDir(dataRoot), 'project-states');
}

function readerDocumentStatePath(dataRoot, documentId) {
  if (String(documentId || '').startsWith('project:')) {
    return path.join(readerProjectStatesDir(dataRoot), `${stableReaderPathSegment(documentId, 'reader-project')}.json`);
  }
  return path.join(readerDocumentDir(dataRoot, documentId), 'state.json');
}

function readerTransfersDir(dataRoot) {
  return path.join(libraryRoot(dataRoot), 'reader-transfers');
}

function readerTransferDir(dataRoot, envelopeId) {
  return path.join(readerTransfersDir(dataRoot), stableReaderPathSegment(envelopeId, 'reader-transfer'));
}

function readerTransferEnvelopePath(dataRoot, envelopeId) {
  return path.join(readerTransferDir(dataRoot, envelopeId), 'envelope.json');
}

function readerTransferSnapshotMetadataPath(dataRoot, envelopeId) {
  return path.join(readerTransferDir(dataRoot, envelopeId), 'snapshot.json');
}

function readerTransferSnapshotTextPath(dataRoot, envelopeId) {
  return path.join(readerTransferDir(dataRoot, envelopeId), 'snapshot.txt');
}

function projectsRoot(dataRoot) {
  return path.join(libraryRoot(dataRoot), 'projects');
}

function workflowTemplatesDir(dataRoot) {
  return path.join(libraryRoot(dataRoot), 'workflow-templates');
}

function workflowTemplatePath(dataRoot, templateId) {
  return path.join(workflowTemplatesDir(dataRoot), `${sanitizePathSegment(templateId, 'workflow-template')}.json`);
}

function workflowTemplateVersionsDir(dataRoot, templateId) {
  return path.join(workflowTemplatesDir(dataRoot), '.versions', sanitizePathSegment(templateId, 'workflow-template'));
}

function workflowTemplateVersionPath(dataRoot, templateId, version) {
  const safeVersion = Math.max(1, Number.parseInt(version, 10) || 1);
  return path.join(workflowTemplateVersionsDir(dataRoot, templateId), `v${safeVersion}.json`);
}

function projectDir(dataRoot, projectId) {
  return path.join(projectsRoot(dataRoot), sanitizePathSegment(projectId, 'project'));
}

function manifestPath(projectPath) {
  return path.join(projectPath, 'manifest.json');
}

function chaptersDir(projectPath) {
  return path.join(projectPath, 'chapters');
}

function scenesDir(projectPath) {
  return path.join(projectPath, 'scenes');
}

function sceneMarkdownPath(projectPath, sceneId) {
  return path.join(scenesDir(projectPath), `${sanitizePathSegment(sceneId, 'scene')}.md`);
}

function sceneMetaPath(projectPath, sceneId) {
  return path.join(scenesDir(projectPath), `${sanitizePathSegment(sceneId, 'scene')}.meta.json`);
}

function chapterPath(projectPath, chapterId) {
  return path.join(chaptersDir(projectPath), `${sanitizePathSegment(chapterId, 'chapter')}.json`);
}

function workflowsDir(projectPath) {
  return path.join(projectPath, 'workflows');
}

function workflowRunsPath(projectPath) {
  return path.join(workflowsDir(projectPath), 'runs.json');
}

function workflowRunEventsDir(projectPath) {
  return path.join(workflowsDir(projectPath), 'runs');
}

function workflowRunEventsPath(projectPath, runId) {
  return path.join(workflowRunEventsDir(projectPath), `${sanitizePathSegment(runId, 'workflow')}.events.jsonl`);
}

function workflowV2Dir(projectPath) {
  return path.join(workflowsDir(projectPath), 'v2');
}

function workflowV2RunsPath(projectPath) {
  return path.join(workflowV2Dir(projectPath), 'runs.json');
}

function workflowV2RunsDir(projectPath) {
  return path.join(workflowV2Dir(projectPath), 'runs');
}

function workflowV2RunDir(projectPath, runId) {
  return path.join(workflowV2RunsDir(projectPath), sanitizePathSegment(runId, 'workflow-run'));
}

function workflowV2RunDefinitionPath(projectPath, runId) {
  return path.join(workflowV2RunDir(projectPath, runId), 'definition.json');
}

function workflowV2RunStatePath(projectPath, runId) {
  return path.join(workflowV2RunDir(projectPath, runId), 'state.json');
}

function workflowV2ArtifactsDir(projectPath, runId) {
  return path.join(workflowV2RunDir(projectPath, runId), 'artifacts');
}

function workflowV2ArtifactDir(projectPath, runId, artifactId) {
  return path.join(workflowV2ArtifactsDir(projectPath, runId), sanitizePathSegment(artifactId, 'artifact'));
}

function workflowV2ArtifactFamilyPath(projectPath, runId, artifactId) {
  return path.join(workflowV2ArtifactDir(projectPath, runId, artifactId), 'artifact.json');
}

function workflowV2ArtifactRevisionsDir(projectPath, runId, artifactId) {
  return path.join(workflowV2ArtifactDir(projectPath, runId, artifactId), 'revisions');
}

function workflowV2ArtifactRevisionPath(projectPath, runId, artifactId, revisionId) {
  return path.join(
    workflowV2ArtifactRevisionsDir(projectPath, runId, artifactId),
    `${sanitizePathSegment(revisionId, 'revision')}.json`
  );
}

function workflowV2ArtifactContentDir(projectPath, runId, artifactId) {
  return path.join(workflowV2ArtifactDir(projectPath, runId, artifactId), 'content');
}

function workflowV2ArtifactContentPath(projectPath, runId, artifactId, revisionId, format = 'text') {
  const extension = format === 'json' ? 'json' : 'txt';
  return path.join(
    workflowV2ArtifactContentDir(projectPath, runId, artifactId),
    `${sanitizePathSegment(revisionId, 'revision')}.${extension}`
  );
}

function workflowV2ChunksDir(projectPath, runId) {
  return path.join(workflowV2RunDir(projectPath, runId), 'chunks');
}

function workflowV2ChunkPath(projectPath, runId, chunkId) {
  return path.join(workflowV2ChunksDir(projectPath, runId), `${sanitizePathSegment(chunkId, 'chunk')}.json`);
}

function workflowV2ChunkContentPath(projectPath, runId, chunkId) {
  return path.join(workflowV2ChunksDir(projectPath, runId), `${sanitizePathSegment(chunkId, 'chunk')}.txt`);
}

function workflowV2EventsDir(projectPath, runId) {
  return path.join(workflowV2RunDir(projectPath, runId), 'events');
}

function workflowV2EventPath(projectPath, runId, eventId) {
  return path.join(workflowV2EventsDir(projectPath, runId), `${sanitizePathSegment(eventId, 'event')}.json`);
}

function workflowV2ApplicationsDir(projectPath, runId) {
  return path.join(workflowV2RunDir(projectPath, runId), 'applications');
}

function workflowV2ApplicationPath(projectPath, runId, applicationId) {
  return path.join(
    workflowV2ApplicationsDir(projectPath, runId),
    `${sanitizePathSegment(applicationId, 'application')}.json`
  );
}

function workflowV2ApplicationBackupsDir(projectPath, runId) {
  return path.join(workflowV2ApplicationsDir(projectPath, runId), 'backups');
}

function workflowV2ApplicationBackupPath(projectPath, runId, applicationId) {
  return path.join(
    workflowV2ApplicationBackupsDir(projectPath, runId),
    `${sanitizePathSegment(applicationId, 'application')}.json`
  );
}

function workflowV2GenerationHistoryDir(projectPath, runId) {
  return path.join(workflowV2RunDir(projectPath, runId), 'generation-history');
}

function workflowV2GenerationHistoryPath(projectPath, runId, historyId) {
  return path.join(
    workflowV2GenerationHistoryDir(projectPath, runId),
    `${sanitizePathSegment(historyId, 'generation-history')}.json`
  );
}

module.exports = {
  sanitizePathSegment,
  stableReaderPathSegment,
  libraryRoot,
  readerDocumentsDir,
  readerDocumentsIndexPath,
  readerPreferencesPath,
  readerMigrationPath,
  readerDocumentDir,
  readerDocumentMetadataPath,
  readerDocumentSourceDir,
  readerDocumentSourceRevisionPath,
  readerDocumentRevisionsDir,
  readerDocumentRevisionDir,
  readerDocumentRevisionMetadataPath,
  readerDocumentRevisionChaptersDir,
  readerDocumentRevisionChapterPath,
  readerProjectStatesDir,
  readerDocumentStatePath,
  readerTransfersDir,
  readerTransferDir,
  readerTransferEnvelopePath,
  readerTransferSnapshotMetadataPath,
  readerTransferSnapshotTextPath,
  projectsRoot,
  workflowTemplatesDir,
  workflowTemplatePath,
  workflowTemplateVersionsDir,
  workflowTemplateVersionPath,
  projectDir,
  manifestPath,
  chaptersDir,
  scenesDir,
  sceneMarkdownPath,
  sceneMetaPath,
  chapterPath,
  workflowsDir,
  workflowRunsPath,
  workflowRunEventsDir,
  workflowRunEventsPath,
  workflowV2Dir,
  workflowV2RunsPath,
  workflowV2RunsDir,
  workflowV2RunDir,
  workflowV2RunDefinitionPath,
  workflowV2RunStatePath,
  workflowV2ArtifactsDir,
  workflowV2ArtifactDir,
  workflowV2ArtifactFamilyPath,
  workflowV2ArtifactRevisionsDir,
  workflowV2ArtifactRevisionPath,
  workflowV2ArtifactContentDir,
  workflowV2ArtifactContentPath,
  workflowV2ChunksDir,
  workflowV2ChunkPath,
  workflowV2ChunkContentPath,
  workflowV2EventsDir,
  workflowV2EventPath,
  workflowV2ApplicationsDir,
  workflowV2ApplicationPath,
  workflowV2ApplicationBackupsDir,
  workflowV2ApplicationBackupPath,
  workflowV2GenerationHistoryDir,
  workflowV2GenerationHistoryPath
};
