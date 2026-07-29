const crypto = require('crypto');
const artifactStore = require('../storage/workflow-artifact-store');
const { projectDir } = require('../storage/library-paths');
const projectService = require('./project-service');
const compendiumService = require('./compendium-service');
const projectAssetQueryService = require('./project-asset-query-service');
const applicationService = require('./workflow-application-service');
const reviewService = require('./workflow-review-service');

const ALLOWED_UPDATE_FIELDS = applicationService.ALLOWED_CARD_FIELDS;

function clean(value, fallback = '') {
  return String(value === undefined || value === null ? fallback : value).trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function normalizeSelection(input, textLength) {
  if (!input || typeof input !== 'object') return null;
  const start = Number(input.start);
  const end = Number(input.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > textLength) {
    throw new Error('writer transfer selection must be a valid non-empty text range');
  }
  return { start, end };
}

function sourceReference(input = {}, runId = '') {
  return {
    sourceRunId: clean(input.sourceRunId || input.runId || runId),
    sourceArtifactId: clean(input.sourceArtifactId || input.artifactId),
    sourceRevisionId: clean(input.sourceRevisionId || input.revisionId)
  };
}

async function readTransferSource(projectPath, runId, sourceInput) {
  const source = sourceReference(sourceInput, runId);
  if (source.sourceRunId !== runId || !source.sourceArtifactId || !source.sourceRevisionId) {
    throw new Error('transfer source must identify an artifact revision from this run');
  }
  const [family, revision, content] = await Promise.all([
    artifactStore.readArtifactFamily(projectPath, runId, source.sourceArtifactId),
    artifactStore.readArtifactRevision(projectPath, runId, source.sourceArtifactId, source.sourceRevisionId),
    artifactStore.readArtifactContent(projectPath, runId, source.sourceArtifactId, source.sourceRevisionId)
  ]);
  if (!family || !revision) throw new Error(`transfer source revision not found: ${source.sourceRevisionId}`);
  if (revision.reviewState !== 'approved') throw new Error(`transfer source revision must be approved: ${revision.id}`);
  if (revision.freshness !== 'fresh') throw new Error(`transfer source revision is stale: ${revision.id}`);
  if (revision.payload.format !== 'text') throw new Error(`writer transfer source must contain text: ${revision.id}`);
  return { source, family, revision, content: String(content || '') };
}

async function assertNoBlockingReviewFindings(projectPath, runId) {
  const families = (await artifactStore.listArtifactFamilies(projectPath, runId))
    .filter((family) => family.nodeId === 'review'
      && family.artifactType && family.artifactType.id === 'draft-review');
  const blocking = [];
  for (const family of families) {
    const revisionId = family.revisionIds[family.revisionIds.length - 1];
    if (!revisionId) continue;
    const report = await artifactStore.readArtifactContent(projectPath, runId, family.id, revisionId);
    reviewService.blockingFindings(report).forEach((finding) => blocking.push({
      ...finding,
      artifactId: family.id,
      reviewRevisionId: revisionId
    }));
  }
  if (blocking.length) {
    const error = new Error(`质量门禁未通过：仍有 ${blocking.length} 项阻断问题，不能转入写作区`);
    error.code = 'WORKFLOW_QUALITY_GATE_BLOCKED';
    error.findings = blocking;
    throw error;
  }
  return { ok: true, blockingFindingCount: 0 };
}

async function previewWriterTransfer(options = {}) {
  const dataRoot = options.dataRoot;
  const projectId = clean(options.projectId);
  const runId = clean(options.runId);
  if (!dataRoot || !projectId || !runId) throw new Error('writer transfer dataRoot, projectId and runId are required');
  const opened = await projectService.openProject(dataRoot, projectId);
  const project = opened.project;
  const projectPath = projectDir(dataRoot, projectId);
  await assertNoBlockingReviewFindings(projectPath, runId);
  const inputs = Array.isArray(options.scenes) ? options.scenes : [];
  if (!inputs.length) throw new Error('writer transfer requires at least one scene');
  const scenes = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index] || {};
    const loaded = await readTransferSource(projectPath, runId, input.source || input);
    const selection = normalizeSelection(input.selection, loaded.content.length);
    const transferContent = selection ? loaded.content.slice(selection.start, selection.end) : loaded.content;
    const targetSceneId = clean(input.targetSceneId || input.sceneId, `workflow-scene-${index + 1}`);
    const existing = project.scenes.find((scene) => scene.id === targetSceneId);
    const mode = clean(input.mode, existing ? 'update' : 'create');
    if (!['create', 'update'].includes(mode)) throw new Error(`unsupported writer transfer mode: ${mode}`);
    if (mode === 'update' && !existing) throw new Error(`writer target scene not found: ${targetSceneId}`);
    if (mode === 'create' && existing) throw new Error(`writer target scene already exists: ${targetSceneId}`);
    const chapterId = clean(input.chapterId, existing && existing.chapterId);
    if (!chapterId) throw new Error(`writer transfer scene ${targetSceneId} requires chapterId`);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    scenes.push({
      mode,
      chapter: {
        id: chapterId,
        title: clean(input.chapterTitle, chapter && chapter.title || '工作流生成章节'),
        summary: clean(input.chapterSummary, chapter && chapter.summary)
      },
      scene: {
        id: targetSceneId,
        title: clean(input.title, existing && existing.title || loaded.family.title || `场景 ${index + 1}`),
        summary: clean(input.summary, loaded.revision.summary),
        tags: Array.isArray(input.tags) ? [...input.tags] : existing && existing.tags || [],
        povCharacter: clean(input.povCharacter, existing && existing.povCharacter),
        tense: clean(input.tense, existing && existing.tense),
        content: transferContent,
        expectedUpdatedAt: existing ? existing.updatedAt : ''
      },
      source: loaded.source,
      selection
    });
  }
  return {
    ok: true,
    projectId,
    runId,
    chapters: [...new Set(scenes.map((item) => item.chapter.id))].map((chapterId) => ({
      ...scenes.find((item) => item.chapter.id === chapterId).chapter,
      scenes: scenes.filter((item) => item.chapter.id === chapterId).map((item) => item.scene)
    })),
    scenes,
    counts: { scenes: scenes.length, creates: scenes.filter((item) => item.mode === 'create').length, updates: scenes.filter((item) => item.mode === 'update').length }
  };
}

async function materializeTransferSource(projectPath, projectId, runId, item) {
  if (!item.selection) return item.source;
  const digest = crypto.createHash('sha256')
    .update(`${item.source.sourceRevisionId}:${item.selection.start}:${item.selection.end}:${item.scene.content}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  const artifactId = `transfer-excerpt-${item.source.sourceArtifactId}`;
  const revisionId = `transfer-excerpt-${digest}`;
  await artifactStore.writeArtifactRevision(projectPath, runId, {
    id: artifactId,
    projectId,
    runId,
    nodeId: 'transfer',
    artifactType: 'draft-excerpt@1',
    title: `${item.scene.title}（精修片段）`
  }, {
    id: revisionId,
    inputRevisionIds: [item.source.sourceRevisionId],
    summary: item.scene.summary,
    reviewState: 'approved',
    approvedAt: new Date().toISOString(),
    payload: { format: 'text' }
  }, item.scene.content);
  return sourceReference({ runId, artifactId, revisionId }, runId);
}

async function applyWriterTransfer(options = {}) {
  const preview = await previewWriterTransfer(options);
  const projectPath = projectDir(options.dataRoot, preview.projectId);
  const operations = [];
  for (let index = 0; index < preview.scenes.length; index += 1) {
    const item = preview.scenes[index];
    const source = await materializeTransferSource(projectPath, preview.projectId, preview.runId, item);
    operations.push({
      id: `${clean(options.applicationId)}-writer-${index + 1}`,
      kind: item.mode === 'update' ? 'writer.update-scene' : 'writer.create-scene',
      target: { chapterId: item.chapter.id, sceneId: item.scene.id },
      source,
      data: item.mode === 'update'
        ? { expectedUpdatedAt: item.scene.expectedUpdatedAt }
        : { chapter: item.chapter, scene: { ...item.scene, content: undefined } }
    });
  }
  return applicationService.applyWorkflowApplication({
    ...options,
    projectPath,
    projectId: preview.projectId,
    runId: preview.runId,
    operations
  });
}

function candidateNames(value = {}) {
  return [value.title, ...(Array.isArray(value.aliases) ? value.aliases : [])]
    .map((item) => clean(item).toLocaleLowerCase('zh-CN'))
    .filter(Boolean);
}

function createCompendiumSuggestions(candidates = [], existingEntries = [], defaultSource = {}) {
  const existing = Array.isArray(existingEntries) ? existingEntries : [];
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const draft = clone(candidate.draft || candidate.entry || candidate);
    const names = new Set(candidateNames(draft));
    const matched = existing.find((entry) => entry.id === clean(candidate.matchedEntryId)
      || candidateNames(entry).some((name) => names.has(name)));
    const source = sourceReference(candidate.source || defaultSource, defaultSource.sourceRunId || defaultSource.runId);
    if (!clean(draft.title)) return null;
    if (!matched) {
      return {
        id: clean(candidate.id, `compendium-suggestion-${index + 1}`),
        kind: 'create',
        requiresConfirmation: true,
        source,
        entry: { ...draft, id: clean(draft.id), title: clean(draft.title) }
      };
    }
    const patch = {};
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (draft[field] !== undefined) patch[field] = clone(draft[field]);
    }
    return {
      id: clean(candidate.id, `compendium-suggestion-${index + 1}`),
      kind: 'update',
      requiresConfirmation: true,
      source,
      target: { entryId: matched.id, expectedUpdatedAt: matched.updatedAt },
      patch
    };
  }).filter(Boolean);
}

async function previewCompendiumSuggestions(options = {}) {
  const listed = await compendiumService.listEntries(options.dataRoot, clean(options.projectId));
  const suggestions = createCompendiumSuggestions(options.candidates, listed.entries, {
    ...(options.source || {}),
    sourceRunId: clean(options.runId)
  });
  return { ok: true, projectId: clean(options.projectId), runId: clean(options.runId), suggestions, confirmed: false };
}

async function applyConfirmedCompendiumSuggestions(options = {}) {
  const confirmedIds = new Set((Array.isArray(options.confirmedSuggestionIds) ? options.confirmedSuggestionIds : []).map(clean));
  if (!confirmedIds.size) throw new Error('compendium suggestions require explicit confirmation');
  const preview = await previewCompendiumSuggestions(options);
  const selected = preview.suggestions.filter((suggestion) => confirmedIds.has(suggestion.id));
  if (!selected.length) throw new Error('no confirmed compendium suggestions were found');
  const operations = selected.map((suggestion, index) => suggestion.kind === 'create' ? {
    id: `${clean(options.applicationId)}-compendium-${index + 1}`,
    kind: 'compendium.create', target: { entryId: suggestion.entry.id }, source: suggestion.source, data: { entry: suggestion.entry }
  } : {
    id: `${clean(options.applicationId)}-compendium-${index + 1}`,
    kind: 'compendium.update', target: { entryId: suggestion.target.entryId }, source: suggestion.source,
    data: { patch: suggestion.patch, expectedUpdatedAt: suggestion.target.expectedUpdatedAt }
  });
  return applicationService.applyWorkflowApplication({
    ...options,
    projectPath: projectDir(options.dataRoot, clean(options.projectId)),
    operations
  });
}

async function locateWorkflowAssets(dataRoot, projectId, options = {}) {
  return projectAssetQueryService.listProjectAssets(dataRoot, projectId, { ...options, originModule: 'workflow' });
}

module.exports = {
  sourceReference,
  readTransferSource,
  assertNoBlockingReviewFindings,
  normalizeSelection,
  materializeTransferSource,
  previewWriterTransfer,
  applyWriterTransfer,
  createCompendiumSuggestions,
  previewCompendiumSuggestions,
  applyConfirmedCompendiumSuggestions,
  locateWorkflowAssets
};
