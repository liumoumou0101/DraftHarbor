const projectStore = require('../storage/project-file-store');
const legacyWorkflowStore = require('../storage/workflow-run-store');
const workflowV2Store = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const { projectDir } = require('../storage/library-paths');

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function normalizeState(value, fallback) {
  return cleanString(value, fallback) || fallback;
}

function copySourceReferences(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object').map((item) => ({ ...item }))
    : [];
}

function sourceReferenceKey(reference) {
  return JSON.stringify(reference);
}

function uniqueReferences(references) {
  const seen = new Set();
  return references.filter((reference) => {
    const key = sourceReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createAsset(input = {}) {
  return {
    id: cleanString(input.id),
    projectId: cleanString(input.projectId),
    assetType: cleanString(input.assetType),
    subtype: cleanString(input.subtype),
    title: cleanString(input.title, '未命名资产') || '未命名资产',
    summary: cleanString(input.summary),
    reviewState: normalizeState(input.reviewState, 'approved'),
    freshness: normalizeState(input.freshness, 'fresh'),
    applicationState: normalizeState(input.applicationState, 'unapplied'),
    archiveState: normalizeState(input.archiveState, 'active'),
    sourceReferences: uniqueReferences(copySourceReferences(input.sourceReferences)),
    schemaVersion: Number.isInteger(Number(input.schemaVersion)) ? Number(input.schemaVersion) : 1,
    revisionId: cleanString(input.revisionId),
    parentRevisionId: cleanString(input.parentRevisionId),
    variantId: cleanString(input.variantId),
    inputDigest: cleanString(input.inputDigest),
    originModule: cleanString(input.originModule),
    locator: input.locator && typeof input.locator === 'object' ? { ...input.locator } : {},
    isFormalFact: input.isFormalFact === true,
    isAuthoritativeManuscript: input.isAuthoritativeManuscript === true,
    updatedAt: cleanString(input.updatedAt),
    createdAt: cleanString(input.createdAt)
  };
}

function manuscriptAssetSummaries(project) {
  const chaptersById = new Map((project.chapters || []).map((chapter) => [chapter.id, chapter]));
  return (project.scenes || []).map((scene) => {
    const chapter = chaptersById.get(scene.chapterId);
    return createAsset({
      id: `writer:scene:${scene.id}`,
      projectId: project.id,
      assetType: 'manuscript',
      subtype: 'scene',
      title: scene.title,
      summary: scene.summary,
      reviewState: 'approved',
      freshness: 'fresh',
      applicationState: 'applied',
      archiveState: 'active',
      sourceReferences: [{ chapterId: scene.chapterId, sceneId: scene.id }],
      originModule: 'writer',
      locator: {
        module: 'writer',
        projectId: project.id,
        chapterId: scene.chapterId,
        sceneId: scene.id,
        chapterTitle: chapter ? chapter.title : ''
      },
      isFormalFact: false,
      isAuthoritativeManuscript: true,
      updatedAt: scene.updatedAt,
      createdAt: scene.createdAt
    });
  });
}

function compendiumAssetSummaries(project) {
  return (project.compendium || []).map((entry) => createAsset({
    id: `compendium:${entry.id}`,
    projectId: project.id,
    assetType: 'compendium_card',
    subtype: entry.type,
    title: entry.title,
    summary: entry.summary,
    reviewState: 'approved',
    freshness: 'fresh',
    applicationState: 'applied',
    archiveState: 'active',
    sourceReferences: [
      ...(entry.relatedSceneIds || []).map((sceneId) => ({ sceneId })),
      ...copySourceReferences(entry.sourceReferences)
    ],
    originModule: 'compendium',
    locator: { module: 'compendium', projectId: project.id, entryId: entry.id },
    isFormalFact: true,
    isAuthoritativeManuscript: false,
    updatedAt: entry.updatedAt,
    createdAt: entry.createdAt
  }));
}

function workflowAssetType(typeId) {
  const type = cleanString(typeId).toLowerCase();
  if (type.includes('outline') || type.includes('plan')) return 'planning_artifact';
  if (type.includes('draft') || type.includes('rewrite')) return 'workflow_draft';
  if (type.includes('report') || type.includes('analysis')) return 'analysis_artifact';
  return 'workflow_artifact';
}

async function v2WorkflowAssetSummaries(projectPath, projectId) {
  const runs = await workflowV2Store.listWorkflowV2Runs(projectPath);
  const assets = [];
  for (const run of runs) {
    const families = await artifactStore.listArtifactFamilies(projectPath, run.id);
    for (const family of families) {
      for (const revisionId of family.revisionIds || []) {
        const revision = await artifactStore.readArtifactRevision(projectPath, run.id, family.id, revisionId);
        if (!revision) continue;
        assets.push(createAsset({
          id: `workflow:v2:${run.id}:${family.id}:${revision.id}`,
          projectId,
          assetType: workflowAssetType(family.artifactType && family.artifactType.id),
          subtype: family.artifactType ? `${family.artifactType.id}@${family.artifactType.version}` : '',
          title: family.title,
          summary: revision.summary,
          reviewState: revision.reviewState,
          freshness: revision.freshness,
          applicationState: revision.applicationState,
          archiveState: revision.archiveState,
          sourceReferences: [
            ...(revision.inputRevisionIds || []).map((inputRevisionId) => ({ revisionId: inputRevisionId })),
            ...(family.targetRef && Object.keys(family.targetRef).length ? [family.targetRef] : [])
          ],
          schemaVersion: revision.schemaVersion,
          revisionId: revision.id,
          parentRevisionId: revision.parentRevisionId,
          variantId: revision.variantId,
          inputDigest: revision.inputDigest,
          originModule: 'workflow',
          locator: {
            module: 'workflow',
            storageVersion: 'v2',
            projectId,
            runId: run.id,
            artifactId: family.id,
            revisionId: revision.id
          },
          isFormalFact: false,
          isAuthoritativeManuscript: false,
          updatedAt: revision.updatedAt,
          createdAt: revision.createdAt
        }));
      }
    }
  }
  return assets;
}

async function legacyWorkflowAssetSummaries(projectPath, projectId) {
  const runs = await legacyWorkflowStore.listWorkflowRuns(projectPath);
  const assets = [];
  for (const run of runs) {
    for (const artifact of run.artifacts || []) {
      const appliedAt = artifact.data && artifact.data.appliedAt;
      assets.push(createAsset({
        id: `workflow:legacy:${run.id}:${artifact.id}`,
        projectId,
        assetType: workflowAssetType(artifact.type),
        subtype: cleanString(artifact.type),
        title: artifact.title,
        summary: cleanString(artifact.data && artifact.data.summary),
        reviewState: appliedAt ? 'approved' : 'draft',
        freshness: 'fresh',
        applicationState: appliedAt ? 'applied' : 'unapplied',
        archiveState: 'active',
        sourceReferences: [{ runId: run.id, stepId: artifact.stepId, sceneId: artifact.sceneId, chapterId: artifact.chapterId }],
        originModule: 'workflow',
        locator: {
          module: 'workflow',
          storageVersion: 'legacy-0.1',
          projectId,
          runId: run.id,
          artifactId: artifact.id
        },
        isFormalFact: false,
        isAuthoritativeManuscript: false,
        updatedAt: artifact.updatedAt || run.updatedAt,
        createdAt: artifact.createdAt || run.createdAt
      }));
    }
  }
  return assets;
}

function optionValues(value) {
  if (Array.isArray(value)) return value.map((item) => cleanString(item)).filter(Boolean);
  const item = cleanString(value);
  return item ? item.split(',').map((part) => part.trim()).filter(Boolean) : [];
}

function assetMatches(asset, options = {}) {
  if (!options.includeArchived && asset.archiveState === 'archived') return false;
  const assetTypes = optionValues(options.assetType || options.assetTypes);
  const origins = optionValues(options.originModule || options.originModules);
  const reviewStates = optionValues(options.reviewState || options.reviewStates);
  const freshnessStates = optionValues(options.freshness || options.freshnessStates);
  const applicationStates = optionValues(options.applicationState || options.applicationStates);
  if (assetTypes.length && !assetTypes.includes(asset.assetType)) return false;
  if (origins.length && !origins.includes(asset.originModule)) return false;
  if (reviewStates.length && !reviewStates.includes(asset.reviewState)) return false;
  if (freshnessStates.length && !freshnessStates.includes(asset.freshness)) return false;
  if (applicationStates.length && !applicationStates.includes(asset.applicationState)) return false;
  const query = cleanString(options.query).toLowerCase();
  if (!query) return true;
  const haystack = [asset.title, asset.summary, asset.assetType, asset.subtype, asset.originModule]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

function summarizeCounts(assets) {
  return assets.reduce((counts, asset) => {
    counts[asset.originModule] = (counts[asset.originModule] || 0) + 1;
    return counts;
  }, {});
}

async function listProjectAssets(dataRoot, projectId, options = {}) {
  const project = await projectStore.openProject(dataRoot, projectId);
  const projectPath = projectDir(dataRoot, project.id);
  const [v2Assets, legacyAssets] = await Promise.all([
    v2WorkflowAssetSummaries(projectPath, project.id),
    legacyWorkflowAssetSummaries(projectPath, project.id)
  ]);
  const allAssets = [
    ...manuscriptAssetSummaries(project),
    ...compendiumAssetSummaries(project),
    ...legacyAssets,
    ...v2Assets
  ];
  const unique = [];
  const ids = new Set();
  for (const asset of allAssets) {
    if (!asset.id || ids.has(asset.id)) continue;
    ids.add(asset.id);
    unique.push(asset);
  }
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 500));
  const assets = unique
    .filter((asset) => assetMatches(asset, options))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')) || left.id.localeCompare(right.id))
    .slice(0, limit);
  return {
    ok: true,
    projectId: project.id,
    assets,
    counts: summarizeCounts(assets),
    total: assets.length
  };
}

module.exports = {
  createAsset,
  manuscriptAssetSummaries,
  compendiumAssetSummaries,
  v2WorkflowAssetSummaries,
  legacyWorkflowAssetSummaries,
  assetMatches,
  listProjectAssets
};
