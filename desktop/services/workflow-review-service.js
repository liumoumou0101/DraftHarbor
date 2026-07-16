const artifactStore = require('../storage/workflow-artifact-store');

function clean(value) { return String(value || '').trim(); }
function sentences(text) { return clean(text).split(/[。！？.!?]+/).map((item) => item.trim()).filter((item) => item.length >= 8); }

function reviewDraft(input = {}) {
  const text = clean(input.text);
  const findings = [];
  const seen = new Set();
  for (const sentence of sentences(text)) {
    if (seen.has(sentence)) findings.push({ type: 'duplicate_content', severity: 'medium', text: sentence });
    seen.add(sentence);
  }
  for (const constraint of Array.isArray(input.constraints) ? input.constraints : []) {
    const value = clean(constraint.text);
    if (!value) continue;
    if (constraint.kind === 'exclusion' && text.includes(value)) findings.push({ type: 'constraint_violation', severity: constraint.enforcement === 'hard' ? 'high' : 'medium', constraintId: constraint.id, text: value });
    if (constraint.kind === 'direction' && constraint.enforcement === 'hard' && !text.includes(value)) findings.push({ type: 'direction_missing', severity: 'medium', constraintId: constraint.id, text: value });
  }
  const plan = input.scenePlan && Array.isArray(input.scenePlan.scenes) ? input.scenePlan.scenes : [];
  if (plan.length && !text) findings.push({ type: 'outline_mismatch', severity: 'high', text: '场景计划存在但正文为空' });
  return { schemaVersion: 1, kind: 'draft-review', findings, summary: findings.length ? `发现 ${findings.length} 项待处理问题` : '未发现自动审查问题' };
}

function compareDrafts(left, right) {
  const a = clean(left); const b = clean(right);
  return { schemaVersion: 1, kind: 'draft-comparison', leftLength: a.length, rightLength: b.length, same: a === b, sharedSentences: sentences(a).filter((item) => sentences(b).includes(item)), changed: a !== b };
}

async function createVariant(projectPath, runId, artifactId, parentRevisionId, input = {}) {
  const family = await artifactStore.readArtifactFamily(projectPath, runId, artifactId);
  const parent = await artifactStore.readArtifactRevision(projectPath, runId, artifactId, parentRevisionId);
  if (!family || !parent) throw new Error('parent draft revision not found');
  return artifactStore.writeArtifactRevision(projectPath, runId, family, { id: input.revisionId, parentRevisionId, variantId: input.variantId || 'alternative', inputRevisionIds: parent.inputRevisionIds, constraintSnapshotId: parent.constraintSnapshotId, summary: input.summary || '替代正文版本', payload: { format: 'text' } }, input.text);
}

async function writeReviewArtifact(projectPath, runId, input = {}) {
  return artifactStore.writeArtifactRevision(projectPath, runId, { id: input.artifactId, projectId: input.projectId, runId, nodeId: input.nodeId || 'review', artifactType: 'draft-review@1', title: '草稿审查报告' }, { id: input.revisionId, inputRevisionIds: input.inputRevisionIds, summary: input.content.summary, payload: { format: 'json' } }, input.content);
}

function detectStaleness(revision, currentInputRevisionIds = []) {
  const expected = new Set(revision.inputRevisionIds || []);
  const current = new Set(currentInputRevisionIds);
  return expected.size !== current.size || [...expected].some((id) => !current.has(id))
    ? 'stale'
    : 'fresh';
}

module.exports = { reviewDraft, compareDrafts, createVariant, writeReviewArtifact, detectStaleness };
