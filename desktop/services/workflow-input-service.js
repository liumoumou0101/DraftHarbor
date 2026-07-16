const crypto = require('crypto');

const InputSchema = require('../../src/core/workflow/workflow-input-schema');
const projectService = require('./project-service');
const artifactStore = require('../storage/workflow-artifact-store');

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function orderedScenes(project) {
  const chapterOrder = new Map((project.chapters || []).map((chapter, index) => [chapter.id, index]));
  return (project.scenes || []).slice().sort((left, right) => {
    const chapterDiff = (chapterOrder.get(left.chapterId) || 0) - (chapterOrder.get(right.chapterId) || 0);
    return chapterDiff || (Number(left.order) || 0) - (Number(right.order) || 0);
  });
}

function sourceEntries(project, request) {
  const scenes = orderedScenes(project);
  if (request.scope === 'selection') {
    const scene = scenes.find((item) => item.id === request.sceneId);
    if (!scene) throw new Error(`writer source scene not found: ${request.sceneId}`);
    const text = String(scene.content || '');
    const start = Math.max(0, Math.min(text.length, request.selection.start));
    const end = Math.max(start, Math.min(text.length, request.selection.end));
    if (start === end) throw new Error('writer selection must not be empty');
    return [{ sceneId: scene.id, chapterId: scene.chapterId, title: scene.title, range: { start, end }, content: text.slice(start, end), updatedAt: scene.updatedAt }];
  }
  if (request.scope === 'scene') {
    const scene = scenes.find((item) => item.id === request.sceneId);
    if (!scene) throw new Error(`writer source scene not found: ${request.sceneId}`);
    return [{ sceneId: scene.id, chapterId: scene.chapterId, title: scene.title, content: String(scene.content || ''), updatedAt: scene.updatedAt }];
  }
  const selected = request.scope === 'chapter'
    ? scenes.filter((scene) => scene.chapterId === request.chapterId)
    : scenes;
  if (!selected.length) throw new Error(`writer source ${request.scope} has no scenes`);
  return selected.map((scene) => ({ sceneId: scene.id, chapterId: scene.chapterId, title: scene.title, content: String(scene.content || ''), updatedAt: scene.updatedAt }));
}

function createSnapshot(project, requestInput) {
  const request = InputSchema.normalizeWriterSourceRequest(requestInput);
  const entries = sourceEntries(project, request);
  const sourceReferences = entries.map(({ content, ...entry }) => ({ ...entry, contentDigest: digest(content), characterCount: content.length }));
  const content = entries.map((entry) => ({ sceneId: entry.sceneId, chapterId: entry.chapterId, title: entry.title, range: entry.range, content: entry.content }));
  const canonical = JSON.stringify({ scope: request.scope, intent: request.intent, sourceReferences, content });
  return {
    schemaVersion: 1,
    kind: 'writer-source',
    scope: request.scope,
    intent: request.intent,
    label: request.label,
    metadata: request.metadata,
    sourceReferences,
    sourceDigest: digest(canonical),
    characterCount: content.reduce((total, entry) => total + entry.content.length, 0),
    content
  };
}

async function createWriterSourceSnapshot(options = {}) {
  const { dataRoot, projectPath } = options;
  const runId = cleanString(options.runId);
  const projectId = cleanString(options.projectId);
  if (!dataRoot || !projectPath || !runId || !projectId) throw new Error('writer source dataRoot, projectPath, runId and projectId are required');
  const project = (await projectService.openProject(dataRoot, projectId)).project;
  const snapshot = createSnapshot(project, options);
  const artifactId = cleanString(options.artifactId) || `writer-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const revisionId = cleanString(options.revisionId) || `writer-input-revision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artifact = await artifactStore.writeArtifactRevision(projectPath, runId, {
    id: artifactId, projectId, runId, nodeId: cleanString(options.nodeId, 'writer-source'), artifactType: 'writer-source@1',
    title: cleanString(options.title, snapshot.label || '写作来源快照'),
    targetRef: { scope: snapshot.scope, intent: snapshot.intent, sourceReferences: snapshot.sourceReferences.map((reference) => ({ sceneId: reference.sceneId, chapterId: reference.chapterId, title: reference.title, range: reference.range, updatedAt: reference.updatedAt })) }
  }, {
    id: revisionId, parentRevisionId: cleanString(options.parentRevisionId), inputDigest: snapshot.sourceDigest,
    summary: `${snapshot.scope} · ${snapshot.intent} · ${snapshot.sourceReferences.length} 个场景`,
    payload: { format: 'json' }
  }, snapshot);
  return { ok: true, snapshot, artifact };
}

function readerSections(transfer) {
  let cursor = 0;
  return (transfer.snapshot.sections || []).map((section, index) => {
    const heading = transfer.snapshot.sections.length > 1 ? `# ${section.title}\n\n` : '';
    let text = '';
    if (Number.isInteger(section.textStart) && Number.isInteger(section.textEnd)) text = transfer.text.slice(section.textStart, section.textEnd);
    else {
      if (heading && transfer.text.slice(cursor, cursor + heading.length) === heading) cursor += heading.length;
      text = transfer.text.slice(cursor, cursor + Number(section.characterCount || 0)); cursor += text.length + 2;
    }
    return { sectionId: section.sectionId, title: section.title || `来源片段 ${index + 1}`, chapterId: section.chapterId || '', sceneId: section.sceneId || '', content: text };
  });
}

async function createReaderTransferSourceSnapshot(options = {}) {
  const { projectPath, transfer } = options;
  const projectId = cleanString(options.projectId); const runId = cleanString(options.runId);
  if (!projectPath || !projectId || !runId || !transfer || !transfer.envelope) throw new Error('reader workflow source dependencies are required');
  const isProject = transfer.envelope.sourceKind === 'project';
  const entries = readerSections(transfer);
  const content = entries.map((entry) => isProject ? {
    sceneId: entry.sceneId || ((transfer.envelope.sourceLocators || []).find((locator) => locator.projectRef && (!entry.chapterId || locator.projectRef.chapterId === entry.chapterId)) || {}).projectRef?.sceneId || '',
    chapterId: entry.chapterId, title: entry.title, content: entry.content
  } : { sourceId: entry.sectionId, title: entry.title, content: entry.content });
  const sourceReferences = entries.map((entry) => ({
    envelopeId: transfer.envelope.envelopeId, documentId: transfer.envelope.documentId, revisionId: transfer.envelope.revisionId,
    sectionId: entry.sectionId, chapterId: entry.chapterId, sceneId: entry.sceneId,
    locator: (transfer.envelope.sourceLocators || []).find((locator) => !entry.chapterId || locator.chapterId === entry.chapterId) || null,
    contentDigest: digest(entry.content), characterCount: entry.content.length
  }));
  const snapshot = {
    schemaVersion: 1, kind: isProject ? 'writer-source' : 'reader-source', scope: transfer.envelope.scope,
    intent: cleanString(options.intent, 'continue'), label: cleanString(options.label, transfer.snapshot.sourceTitle),
    metadata: { readerEnvelopeId: transfer.envelope.envelopeId, sourceKind: transfer.envelope.sourceKind, freshness: transfer.freshness, readerLocators: transfer.envelope.sourceLocators || [], sourceUnits: transfer.snapshot.sourceUnits || [] },
    sourceReferences, sourceDigest: digest(JSON.stringify({ envelopeId: transfer.envelope.envelopeId, sourceReferences, content })),
    characterCount: content.reduce((sum, entry) => sum + entry.content.length, 0), content
  };
  const artifactId = cleanString(options.artifactId, isProject ? 'writer-source' : 'reader-source');
  const revisionId = cleanString(options.revisionId);
  if (!revisionId) throw new Error('reader workflow source revisionId is required');
  const artifact = await artifactStore.writeArtifactRevision(projectPath, runId, {
    id: artifactId, projectId, runId, nodeId: 'source', artifactType: isProject ? 'writer-source@1' : 'reader-source@1',
    title: snapshot.label || 'Reader 来源快照', targetRef: { envelopeId: transfer.envelope.envelopeId, sourceKind: transfer.envelope.sourceKind, sourceReferences, readerLocators: transfer.envelope.sourceLocators || [] }
  }, {
    id: revisionId, inputDigest: snapshot.sourceDigest, summary: `${snapshot.scope} · ${snapshot.characterCount} 字符`,
    reviewState: 'approved', approvedAt: cleanString(options.createdAt) || new Date().toISOString(), payload: { format: 'json' }
  }, snapshot);
  return { ok: true, snapshot, artifact };
}

async function readWriterSourceSnapshot(projectPath, runId, artifactId, revisionId) {
  const revision = await artifactStore.readArtifactRevision(projectPath, runId, artifactId, revisionId);
  const snapshot = await artifactStore.readArtifactContent(projectPath, runId, artifactId, revisionId);
  if (!revision || !snapshot || snapshot.kind !== 'writer-source') throw new Error('writer source snapshot not found');
  return { revision, snapshot };
}

async function checkWriterSourceSnapshotFreshness(options = {}) {
  const { dataRoot, projectPath } = options;
  const runId = cleanString(options.runId);
  const projectId = cleanString(options.projectId);
  const stored = await readWriterSourceSnapshot(projectPath, runId, options.artifactId, options.revisionId);
  const project = (await projectService.openProject(dataRoot, projectId)).project;
  const first = stored.snapshot.sourceReferences[0] || {};
  const current = createSnapshot(project, {
    scope: stored.snapshot.scope,
    intent: stored.snapshot.intent,
    sceneId: first.sceneId,
    chapterId: first.chapterId,
    selection: first.range,
    label: stored.snapshot.label,
    metadata: stored.snapshot.metadata
  });
  return {
    ok: true,
    freshness: current.sourceDigest === stored.snapshot.sourceDigest ? 'fresh' : 'stale',
    sourceDigest: stored.snapshot.sourceDigest,
    currentDigest: current.sourceDigest,
    snapshot: stored.snapshot
  };
}

module.exports = { createSnapshot, createWriterSourceSnapshot, createReaderTransferSourceSnapshot, readWriterSourceSnapshot, checkWriterSourceSnapshotFreshness, readerSections };
