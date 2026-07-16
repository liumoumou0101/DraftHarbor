const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const Review = require('../desktop/services/workflow-review-service');

const report = Review.reviewDraft({ text: '不要揭晓凶手。重复的长句子需要检查。重复的长句子需要检查。', constraints: [{ id: 'no-reveal', kind: 'exclusion', text: '不要揭晓凶手', enforcement: 'hard' }] });
assert.ok(report.findings.some((item) => item.type === 'constraint_violation'));
assert.ok(report.findings.some((item) => item.type === 'duplicate_content'));
assert.strictEqual(Review.detectStaleness({ inputRevisionIds: ['input-1'] }, ['input-2']), 'stale');
assert.strictEqual(Review.detectStaleness({ inputRevisionIds: ['input-1', 'input-2'] }, ['input-1']), 'stale');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-review-'));
  try {
    const created = await projectService.createProject(root, { id: 'review-project', title: 'Review' });
    await runStore.createWorkflowV2Run(created.projectPath, { id: 'review-run', projectId: created.project.id, definition: { id: 'review-definition', templateId: 'continuation', templateVersion: 1, title: '审查', nodes: [{ id: 'draft', capabilityId: 'draft.longform' }] } });
    await artifactStore.writeArtifactRevision(created.projectPath, 'review-run', { id: 'draft', projectId: created.project.id, runId: 'review-run', nodeId: 'draft', artifactType: 'draft-batch@1', title: '正文' }, { id: 'draft-r1', inputRevisionIds: ['input-1'], payload: { format: 'text' } }, '第一版正文。');
    const variant = await Review.createVariant(created.projectPath, 'review-run', 'draft', 'draft-r1', { revisionId: 'draft-r2', variantId: 'alternative', text: '替代版正文。' });
    assert.strictEqual(variant.revision.parentRevisionId, 'draft-r1');
    assert.strictEqual(variant.revision.variantId, 'alternative');
    assert.strictEqual(Review.compareDrafts('第一版正文。', '替代版正文。').changed, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  console.log('Workflow review service test passed.');
})().catch((error) => { console.error(error); process.exit(1); });
