const fs = require('fs/promises');
const artifactStore = require('../storage/workflow-artifact-store');
const applicationStore = require('../storage/workflow-application-store');
const paths = require('../storage/library-paths');
const projectService = require('./project-service');
const compendiumService = require('./compendium-service');

const ALLOWED_CARD_FIELDS = new Set(['summary', 'tags', 'aliases', 'characterProfile']);

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
  return result;
}

function sourceRef(input = {}, runId) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    sourceRunId: cleanString(source.sourceRunId || source.runId || runId),
    sourceArtifactId: cleanString(source.sourceArtifactId || source.artifactId),
    sourceRevisionId: cleanString(source.sourceRevisionId || source.revisionId)
  };
}

function operationId(applicationId, index) {
  return `${applicationId}-operation-${index + 1}`;
}

function buildOperations(input = {}) {
  const applicationId = cleanString(input.applicationId);
  const runId = cleanString(input.runId);
  if (Array.isArray(input.operations) && input.operations.length) {
    return input.operations.map((operation, index) => ({
      ...clonePlain(operation),
      id: cleanString(operation.id, operationId(applicationId, index)),
      source: sourceRef(operation.source, runId)
    }));
  }
  const operations = [];
  const writer = input.writer && typeof input.writer === 'object' ? input.writer : {};
  for (const chapterInput of Array.isArray(writer.chapters) ? writer.chapters : []) {
    const chapterId = cleanString(chapterInput.id, `${applicationId}-chapter-${operations.length + 1}`);
    for (const sceneInput of Array.isArray(chapterInput.scenes) ? chapterInput.scenes : []) {
      operations.push({
        id: operationId(applicationId, operations.length),
        kind: 'writer.create-scene',
        target: { chapterId, sceneId: cleanString(sceneInput.id, `${applicationId}-scene-${operations.length + 1}`) },
        source: sourceRef(sceneInput.source, runId),
        data: { chapter: { id: chapterId, title: cleanString(chapterInput.title, '未命名章节'), summary: cleanString(chapterInput.summary) }, scene: clonePlain(sceneInput) }
      });
    }
  }
  const compendium = input.compendium && typeof input.compendium === 'object' ? input.compendium : {};
  for (const entry of Array.isArray(compendium.creates) ? compendium.creates : []) {
    operations.push({ id: operationId(applicationId, operations.length), kind: 'compendium.create', target: { entryId: cleanString(entry.id) }, source: sourceRef(entry.source, runId), data: { entry: clonePlain(entry) } });
  }
  for (const update of Array.isArray(compendium.updates) ? compendium.updates : []) {
    operations.push({ id: operationId(applicationId, operations.length), kind: 'compendium.update', target: { entryId: cleanString(update.entryId || update.id) }, source: sourceRef(update.source, runId), data: { patch: clonePlain(update.patch), expectedUpdatedAt: cleanString(update.expectedUpdatedAt) } });
  }
  return operations;
}

async function validateSource(projectPath, runId, source) {
  if (!source.sourceRunId || source.sourceRunId !== runId || !source.sourceArtifactId || !source.sourceRevisionId) {
    throw new Error('application operation requires a source artifact revision from this run');
  }
  const revision = await artifactStore.readArtifactRevision(projectPath, runId, source.sourceArtifactId, source.sourceRevisionId);
  if (!revision) throw new Error(`source revision not found: ${source.sourceRevisionId}`);
  if (revision.reviewState !== 'approved') throw new Error(`source revision must be approved: ${source.sourceRevisionId}`);
  if (revision.freshness !== 'fresh') throw new Error(`source revision is stale: ${source.sourceRevisionId}`);
  return revision;
}

async function validateOperations(projectPath, project, entries, runId, operations) {
  const sceneIds = new Set((project.scenes || []).map((scene) => scene.id));
  const chapterIds = new Set((project.chapters || []).map((chapter) => chapter.id));
  const entryById = new Map((entries || []).map((entry) => [entry.id, entry]));
  const planned = [];
  for (const operationInput of operations) {
    const operation = clonePlain(operationInput);
    const revision = await validateSource(projectPath, runId, operation.source);
    if (operation.kind === 'writer.create-scene') {
      const chapterId = cleanString(operation.target && operation.target.chapterId);
      const sceneId = cleanString(operation.target && operation.target.sceneId);
      if (!chapterId || !sceneId) throw new Error(`writer create operation ${operation.id} requires chapterId and sceneId`);
      if (sceneIds.has(sceneId)) throw new Error(`writer scene already exists: ${sceneId}`);
      sceneIds.add(sceneId);
      chapterIds.add(chapterId);
      if (revision.payload.format !== 'text') throw new Error(`writer source revision must contain text: ${revision.id}`);
    } else if (operation.kind === 'writer.update-scene') {
      const scene = (project.scenes || []).find((item) => item.id === cleanString(operation.target && operation.target.sceneId));
      const expected = cleanString(operation.data && operation.data.expectedUpdatedAt);
      if (!scene || !expected || scene.updatedAt !== expected) throw new Error(`writer target version changed: ${operation.target && operation.target.sceneId}`);
      if (revision.payload.format !== 'text') throw new Error(`writer source revision must contain text: ${revision.id}`);
    } else if (operation.kind === 'compendium.create') {
      const entry = operation.data && operation.data.entry;
      if (!entry || !cleanString(entry.title)) throw new Error(`compendium create operation ${operation.id} requires entry title`);
      if (cleanString(entry.id) && entryById.has(cleanString(entry.id))) throw new Error(`compendium entry already exists: ${entry.id}`);
    } else if (operation.kind === 'compendium.update') {
      const entryId = cleanString(operation.target && operation.target.entryId);
      const existing = entryById.get(entryId);
      const expected = cleanString(operation.data && operation.data.expectedUpdatedAt);
      const patch = operation.data && operation.data.patch && typeof operation.data.patch === 'object' ? operation.data.patch : {};
      if (!existing || !expected || existing.updatedAt !== expected) throw new Error(`compendium target version changed: ${entryId}`);
      for (const key of Object.keys(patch)) if (!ALLOWED_CARD_FIELDS.has(key)) throw new Error(`compendium field is not allowed: ${key}`);
    } else {
      throw new Error(`unsupported workflow application operation: ${operation.kind}`);
    }
    planned.push(operation);
  }
  if (!planned.length) throw new Error('workflow application requires at least one operation');
  return planned;
}

function operationResult(operation, patch) {
  return { ...operation, ...patch, result: patch.result && typeof patch.result === 'object' ? patch.result : operation.result || {} };
}

async function applyOperation(dataRoot, projectPath, runId, operation) {
  const sourceContent = await artifactStore.readArtifactContent(projectPath, runId, operation.source.sourceArtifactId, operation.source.sourceRevisionId);
  if (operation.kind.startsWith('writer.')) {
    const opened = await projectService.openProject(dataRoot, operation.data.projectId);
    const project = opened.project;
    const now = new Date().toISOString();
    if (operation.kind === 'writer.create-scene') {
      const currentScene = project.scenes.find((item) => item.id === project.currentSceneId);
      const shouldActivateCreatedScene = !currentScene
        || (project.scenes.length === 1 && !String(currentScene.content || '').trim());
      const chapterData = operation.data.chapter || {};
      let chapter = project.chapters.find((item) => item.id === operation.target.chapterId);
      if (!chapter) {
        chapter = { id: operation.target.chapterId, title: cleanString(chapterData.title, '未命名章节'), summary: cleanString(chapterData.summary), order: project.chapters.length, sceneIds: [], createdAt: now, updatedAt: now };
        project.chapters.push(chapter);
      }
      const sceneData = operation.data.scene || {};
      project.scenes.push({
        id: operation.target.sceneId,
        chapterId: chapter.id,
        title: cleanString(sceneData.title, '未命名场景'),
        summary: cleanString(sceneData.summary),
        content: String(sourceContent || ''),
        tags: Array.isArray(sceneData.tags) ? sceneData.tags : [],
        povCharacter: cleanString(sceneData.povCharacter),
        tense: cleanString(sceneData.tense),
        order: chapter.sceneIds.length,
        ...operation.source,
        createdAt: now,
        updatedAt: now
      });
      chapter.sceneIds = [...(chapter.sceneIds || []), operation.target.sceneId];
      chapter.updatedAt = now;
      if (shouldActivateCreatedScene) project.currentSceneId = operation.target.sceneId;
    } else {
      const scene = project.scenes.find((item) => item.id === operation.target.sceneId);
      if (!scene) throw new Error(`writer target scene not found: ${operation.target.sceneId}`);
      scene.content = String(sourceContent || '');
      scene.sourceRunId = operation.source.sourceRunId;
      scene.sourceArtifactId = operation.source.sourceArtifactId;
      scene.sourceRevisionId = operation.source.sourceRevisionId;
      scene.updatedAt = now;
    }
    project.updatedAt = now;
    await projectService.saveProject(dataRoot, project);
    return { targetType: 'scene', targetId: operation.target.sceneId };
  }
  if (operation.kind === 'compendium.create') {
    const saved = await compendiumService.saveEntry(dataRoot, operation.data.projectId, operation.data.entry);
    return { targetType: 'compendium-entry', targetId: saved.entry.id };
  }
  const entries = await compendiumService.listEntries(dataRoot, operation.data.projectId);
  const existing = entries.entries.find((entry) => entry.id === operation.target.entryId);
  const saved = await compendiumService.saveEntry(dataRoot, operation.data.projectId, { ...existing, ...(operation.data.patch || {}) });
  return { targetType: 'compendium-entry', targetId: saved.entry.id };
}

async function createBackup(dataRoot, projectPath, runId, applicationId, projectId) {
  const project = (await projectService.openProject(dataRoot, projectId)).project;
  const snapshot = { schemaVersion: 1, applicationId, runId, projectId, createdAt: new Date().toISOString(), project: clonePlain(project) };
  await applicationStore.writeApplicationBackup(projectPath, runId, applicationId, snapshot);
  return { id: applicationId, path: 'applications/backups', createdAt: snapshot.createdAt };
}

async function applyWorkflowApplication(options = {}) {
  const dataRoot = options.dataRoot;
  const projectPath = options.projectPath;
  const runId = cleanString(options.runId);
  const projectId = cleanString(options.projectId);
  const applicationId = cleanString(options.applicationId);
  if (!dataRoot || !projectPath || !runId || !projectId || !applicationId) throw new Error('workflow application dataRoot, projectPath, runId, projectId and applicationId are required');
  const existing = await applicationStore.readApplicationRecord(projectPath, runId, applicationId);
  if (existing && !(options.resume === true && ['partial', 'failed'].includes(existing.status))) return { ok: existing.status === 'applied', idempotent: true, application: existing };

  let record = existing;
  if (!record) {
    const project = (await projectService.openProject(dataRoot, projectId)).project;
    const entries = (await compendiumService.listEntries(dataRoot, projectId)).entries;
    const operations = await validateOperations(projectPath, project, entries, runId, buildOperations({ ...options, applicationId, runId }));
    const normalizedOperations = operations.map((operation) => ({ ...operation, data: { ...(operation.data || {}), projectId } }));
    record = await applicationStore.writeApplicationRecord(projectPath, runId, {
      applicationId, runId, projectId,
      sourceRevisionIds: normalizedOperations.map((operation) => operation.source.sourceRevisionId),
      target: { module: 'writer-and-compendium' },
      operations: normalizedOperations,
      status: 'prepared'
    });
    const backup = await createBackup(dataRoot, projectPath, runId, applicationId, projectId);
    record = await applicationStore.updateApplicationRecord(projectPath, runId, applicationId, { backup, status: 'applying', error: null });
  } else {
    record = await applicationStore.updateApplicationRecord(projectPath, runId, applicationId, { status: 'applying', error: null });
  }

  let operations = record.operations.slice();
  try {
    for (let index = 0; index < operations.length; index += 1) {
      if (operations[index].status === 'applied') continue;
      const result = await applyOperation(dataRoot, projectPath, runId, operations[index]);
      operations[index] = operationResult(operations[index], { status: 'applied', error: null, result });
      record = await applicationStore.updateApplicationRecord(projectPath, runId, applicationId, { operations, status: 'applying' });
      if (typeof options.afterOperation === 'function') await options.afterOperation(operations[index], index);
    }
    record = await applicationStore.updateApplicationRecord(projectPath, runId, applicationId, { operations, status: 'applied', error: null });
    return { ok: true, idempotent: false, application: record };
  } catch (error) {
    const applied = operations.some((operation) => operation.status === 'applied');
    record = await applicationStore.updateApplicationRecord(projectPath, runId, applicationId, {
      operations,
      status: applied ? 'partial' : 'failed',
      error: { code: 'application_failed', message: error.message || String(error) }
    });
    return { ok: false, idempotent: false, application: record, error: record.error };
  }
}

async function restoreWorkflowApplication(options = {}) {
  const { dataRoot, projectPath } = options;
  const runId = cleanString(options.runId);
  const applicationId = cleanString(options.applicationId);
  const record = await applicationStore.readApplicationRecord(projectPath, runId, applicationId);
  if (!record) throw new Error(`workflow application record not found: ${applicationId}`);
  const backup = await applicationStore.readApplicationBackup(projectPath, runId, applicationId);
  if (!backup || !backup.project) throw new Error(`workflow application backup not found: ${applicationId}`);
  await projectService.saveProject(dataRoot, backup.project);
  const backupSceneIds = new Set((backup.project.scenes || []).map((scene) => scene.id));
  const backupChapterIds = new Set((backup.project.chapters || []).map((chapter) => chapter.id));
  for (const operation of record.operations || []) {
    if (operation.kind !== 'writer.create-scene' || operation.status !== 'applied') continue;
    const sceneId = cleanString(operation.target && operation.target.sceneId);
    if (sceneId && !backupSceneIds.has(sceneId)) {
      await fs.rm(paths.sceneMetaPath(projectPath, sceneId), { force: true });
      await fs.rm(paths.sceneMarkdownPath(projectPath, sceneId), { force: true });
    }
  }
  for (const operation of record.operations || []) {
    if (operation.kind !== 'writer.create-scene' || operation.status !== 'applied') continue;
    const chapterId = cleanString(operation.target && operation.target.chapterId);
    if (chapterId && !backupChapterIds.has(chapterId)) await fs.rm(paths.chapterPath(projectPath, chapterId), { force: true });
  }
  const restored = await applicationStore.updateApplicationRecord(projectPath, runId, applicationId, {
    status: 'restored',
    recovery: { restoredAt: new Date().toISOString(), backupId: record.backup && record.backup.id ? record.backup.id : applicationId },
    error: null
  });
  return { ok: true, application: restored };
}

module.exports = { applyWorkflowApplication, restoreWorkflowApplication, buildOperations, ALLOWED_CARD_FIELDS };
