const crypto = require('crypto');
const artifactStore = require('../storage/workflow-artifact-store');
const runStore = require('../storage/workflow-run-store-v2');
const VariantSchema = require('../../src/core/workflow/workflow-variant-schema');
const RewriteSchema = require('../../src/core/workflow/workflow-rewrite-schema');
const paths = require('../storage/library-paths');

function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

async function requireRun(projectPath, runId) {
  const stored = await runStore.readWorkflowV2Run(projectPath, runId);
  if (!stored) throw new Error(`workflow variant run not found: ${runId}`);
  return stored;
}

async function writeManifest(options, manifestInput, reviewState = 'waiting_review', parentRevisionId = '') {
  const manifest = VariantSchema.createVariantManifest(manifestInput);
  const artifactId = `variant-manifest-${manifest.variantId}`;
  const revisionId = id(`${artifactId}-r`);
  const result = await artifactStore.writeArtifactRevision(options.projectPath, options.runId, {
    id: artifactId, projectId: options.projectId, runId: options.runId, nodeId: 'variant', artifactType: 'workflow-variant@1', title: `${manifest.label} · 版本清单`
  }, {
    id: revisionId, parentRevisionId, variantId: manifest.variantId, summary: `${manifest.items.length} 个场景`, reviewState,
    approvedAt: reviewState === 'approved' ? new Date().toISOString() : '', payload: { format: 'json' }
  }, manifest);
  return { ...result, manifest };
}

async function createTextVariant(options = {}) {
  const stored = await requireRun(options.projectPath, options.runId);
  const variantId = clean(options.variantId, id('variant'));
  const inputs = Array.isArray(options.items) ? options.items : [];
  if (!inputs.length) throw new Error('text variant requires items');
  const manifestItems = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index] || {};
    const family = await artifactStore.readArtifactFamily(options.projectPath, options.runId, input.artifactId);
    const parent = await artifactStore.readArtifactRevision(options.projectPath, options.runId, input.artifactId, input.parentRevisionId);
    if (!family || !parent || parent.payload.format !== 'text') throw new Error(`variant source text revision not found: ${input.artifactId}`);
    const text = clean(input.text);
    if (!text) throw new Error(`variant item ${index + 1} text is required`);
    const revision = await artifactStore.writeArtifactRevision(options.projectPath, options.runId, family, {
      id: id(`${variantId}-r`), parentRevisionId: parent.id, variantId, inputRevisionIds: parent.inputRevisionIds,
      providerSnapshot: options.providerSnapshot || {}, summary: clean(input.summary, `${clean(options.label, variantId)} · ${family.title}`),
      reviewState: 'waiting_review', payload: { format: 'text' }
    }, text);
    manifestItems.push({ scopeKey: clean(input.scopeKey, family.id), title: clean(input.title, family.title), targetSceneId: clean(input.targetSceneId), artifactId: family.id, revisionId: revision.revision.id });
  }
  const manifest = await writeManifest(options, {
    variantId, label: clean(options.label, variantId), runId: options.runId, templateId: stored.summary.templateId,
    nodeId: clean(options.nodeId, inputs[0].nodeId || 'draft'), parentVariantId: clean(options.parentVariantId, 'main'), items: manifestItems
  });
  return { ok: true, variant: manifest.manifest, manifestArtifact: { artifactId: manifest.family.id, revisionId: manifest.revision.id } };
}

async function approveTextVariant(options = {}) {
  const manifestFamily = await artifactStore.readArtifactFamily(options.projectPath, options.runId, `variant-manifest-${options.variantId}`);
  if (!manifestFamily) throw new Error(`variant manifest not found: ${options.variantId}`);
  const manifestRevisionId = manifestFamily.revisionIds[manifestFamily.revisionIds.length - 1];
  const manifest = await artifactStore.readArtifactContent(options.projectPath, options.runId, manifestFamily.id, manifestRevisionId);
  const approvedItems = [];
  for (const item of VariantSchema.createVariantManifest(manifest).items) {
    const parent = await artifactStore.readArtifactRevision(options.projectPath, options.runId, item.artifactId, item.revisionId);
    const family = await artifactStore.readArtifactFamily(options.projectPath, options.runId, item.artifactId);
    const content = await artifactStore.readArtifactContent(options.projectPath, options.runId, item.artifactId, item.revisionId);
    if (!parent || parent.reviewState !== 'waiting_review') throw new Error(`variant item is not waiting for review: ${item.revisionId}`);
    const approved = await artifactStore.writeArtifactRevision(options.projectPath, options.runId, family, {
      ...parent, id: id(`${options.variantId}-approved`), parentRevisionId: parent.id, reviewState: 'approved', approvedAt: new Date().toISOString(), payload: { format: 'text' }
    }, content);
    approvedItems.push({ ...item, revisionId: approved.revision.id });
  }
  const approvedManifest = await writeManifest(options, { ...manifest, items: approvedItems }, 'approved', manifestRevisionId);
  return { ok: true, variant: approvedManifest.manifest };
}

async function compareTextVariants(options = {}) {
  const manifests = [options.left, options.right].map(VariantSchema.createVariantManifest);
  const comparison = VariantSchema.compareVariantManifests(...manifests);
  const scopes = [];
  for (const scope of comparison.scopes) {
    let diff = null;
    if (scope.left && scope.right) {
      const [leftText, rightText] = await Promise.all([
        artifactStore.readArtifactContent(options.projectPath, options.runId, scope.left.artifactId, scope.left.revisionId),
        artifactStore.readArtifactContent(options.projectPath, options.runId, scope.right.artifactId, scope.right.revisionId)
      ]);
      diff = RewriteSchema.createRewriteDiff(leftText, rightText, { unitId: scope.scopeKey, targetSceneId: scope.right.targetSceneId || scope.left.targetSceneId });
    }
    scopes.push({ ...scope, diff });
  }
  return { ok: true, comparison: { ...comparison, scopes } };
}

function createTransferSelection(input, manifests) {
  const selection = VariantSchema.createVariantSelection(input, manifests);
  return selection.selections.map((item) => ({
    mode: item.targetSceneId ? 'update' : 'create', targetSceneId: item.targetSceneId,
    source: { runId: clean(input.runId), artifactId: item.artifactId, revisionId: item.revisionId }
  }));
}

function withProjectPath(options = {}) {
  return { ...options, projectPath: options.projectPath || paths.projectDir(options.dataRoot, options.projectId) };
}

async function latestApprovedRevision(projectPath, runId, family, variantId = '') {
  for (let index = family.revisionIds.length - 1; index >= 0; index -= 1) {
    const revision = await artifactStore.readArtifactRevision(projectPath, runId, family.id, family.revisionIds[index]);
    if (revision && revision.reviewState === 'approved' && (!variantId || revision.variantId === variantId)) return revision;
  }
  return null;
}

async function listVariants(options = {}) {
  const resolved = withProjectPath(options);
  await requireRun(resolved.projectPath, resolved.runId);
  const families = await artifactStore.listArtifactFamilies(resolved.projectPath, resolved.runId);
  const variants = [];
  for (const family of families.filter((item) => item.nodeId === 'variant' && `${item.artifactType.id}@${item.artifactType.version}` === 'workflow-variant@1')) {
    const revision = await latestApprovedRevision(resolved.projectPath, resolved.runId, family)
      || await artifactStore.readArtifactRevision(resolved.projectPath, resolved.runId, family.id, family.revisionIds[family.revisionIds.length - 1]);
    if (!revision) continue;
    const manifest = await artifactStore.readArtifactContent(resolved.projectPath, resolved.runId, family.id, revision.id);
    variants.push({ ...VariantSchema.createVariantManifest(manifest), reviewState: revision.reviewState, manifestArtifactId: family.id, manifestRevisionId: revision.id });
  }
  return { ok: true, variants };
}

async function ensureMainVariant(options = {}) {
  const resolved = withProjectPath(options);
  const listed = await listVariants(resolved);
  const existing = listed.variants.find((variant) => variant.variantId === 'main');
  if (existing) return { ok: true, variant: existing };
  const stored = await requireRun(resolved.projectPath, resolved.runId);
  const nodeId = stored.summary.templateId === 'rewrite-guided' ? 'repair' : 'draft';
  const families = (await artifactStore.listArtifactFamilies(resolved.projectPath, resolved.runId)).filter((family) => family.nodeId === nodeId && family.artifactType.id === (nodeId === 'repair' ? 'rewrite-text' : 'draft-batch'));
  if (!families.length) throw new Error('guided run has no approved text outputs for a main variant');
  let targetSceneIds = [];
  if (nodeId === 'repair') {
    const comparisonFamily = (await artifactStore.listArtifactFamilies(resolved.projectPath, resolved.runId)).find((family) => family.artifactType.id === 'rewrite-comparison');
    if (comparisonFamily) {
      const revisionId = comparisonFamily.revisionIds[comparisonFamily.revisionIds.length - 1];
      const comparison = await artifactStore.readArtifactContent(resolved.projectPath, resolved.runId, comparisonFamily.id, revisionId);
      targetSceneIds = (comparison && comparison.comparisons || []).map((item) => clean(item.result && item.result.targetSceneId));
    }
  }
  const items = [];
  for (let index = 0; index < families.length; index += 1) {
    const revision = await latestApprovedRevision(resolved.projectPath, resolved.runId, families[index], 'main');
    if (!revision) throw new Error(`main variant text is not approved: ${families[index].id}`);
    const targetSceneId = targetSceneIds[index] || '';
    items.push({ scopeKey: targetSceneId || families[index].id, title: families[index].title, targetSceneId, artifactId: families[index].id, revisionId: revision.id });
  }
  const written = await writeManifest(resolved, { variantId: 'main', label: '主版本', runId: resolved.runId, templateId: stored.summary.templateId, nodeId, items }, 'approved');
  return { ok: true, variant: written.manifest };
}

async function prepareAlternativeVariant(options = {}) {
  const resolved = withProjectPath(options);
  const main = await ensureMainVariant(resolved);
  const instruction = clean(options.instruction);
  if (!instruction) throw new Error('alternative variant requires an instruction');
  const prompts = [];
  for (const item of main.variant.items) {
    const content = await artifactStore.readArtifactContent(resolved.projectPath, resolved.runId, item.artifactId, item.revisionId);
    prompts.push({ id: item.scopeKey, title: item.title, source: item, prompt: { messages: [
      { role: 'system', content: '你是长篇小说改稿作者。只输出当前场景的完整替代版本正文，不解释，不输出标题。保留核心事实与连续性，并严格执行用户的新版本要求。' },
      { role: 'user', content: JSON.stringify({ instruction, sceneTitle: item.title, original: content }) }
    ] } });
  }
  return { ok: true, variantId: clean(options.variantId, id('variant')), label: clean(options.label, instruction.slice(0, 24)), baseVariant: main.variant, prompts };
}

async function completeAlternativeVariant(options = {}) {
  const resolved = withProjectPath(options);
  const prepared = await prepareAlternativeVariant({ ...resolved, variantId: options.variantId, label: options.label, instruction: options.instruction });
  if (!Array.isArray(options.outputs) || options.outputs.length !== prepared.prompts.length) throw new Error('alternative variant outputs must match prompts');
  return createTextVariant({
    ...resolved, variantId: prepared.variantId, label: prepared.label, parentVariantId: 'main', nodeId: prepared.baseVariant.nodeId,
    providerSnapshot: options.providerSnapshot,
    items: prepared.prompts.map((prompt, index) => ({ ...prompt.source, parentRevisionId: prompt.source.revisionId, text: options.outputs[index] }))
  });
}

async function approveVariant(options = {}) { return approveTextVariant(withProjectPath(options)); }
async function compareVariants(options = {}) {
  const resolved = withProjectPath(options);
  const listed = await listVariants(resolved);
  const left = listed.variants.find((variant) => variant.variantId === clean(options.leftVariantId));
  const right = listed.variants.find((variant) => variant.variantId === clean(options.rightVariantId));
  if (!left || !right) throw new Error('variant comparison requires two existing variants');
  return compareTextVariants({ ...resolved, left, right });
}

module.exports = {
  createTextVariant, approveTextVariant, compareTextVariants, createTransferSelection,
  listVariants, ensureMainVariant, prepareAlternativeVariant, completeAlternativeVariant, approveVariant, compareVariants
};
