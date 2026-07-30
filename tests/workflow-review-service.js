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
assert.strictEqual(report.qualityGate, 'blocked');
assert.strictEqual(Review.normalizeReviewSeverity('major'), 'error');
assert.strictEqual(Review.normalizeReviewSeverity('轻微'), 'suggestion');
assert.strictEqual(Review.normalizeReviewSeverity('致命'), 'critical');

const softExclusion = Review.reviewDraft({
  text: '不要揭晓凶手。这是正常正文。',
  constraints: [{ id: 'soft-ex', kind: 'exclusion', text: '不要揭晓凶手', enforcement: 'soft' }]
});
assert.ok(softExclusion.findings.some((item) => item.type === 'constraint_violation' && item.enforcement === 'soft'));
assert.strictEqual(softExclusion.qualityGate, 'passed');

const directionLiteral = Review.reviewDraft({
  text: '她主动提出与狼交易，却没有复述完整约束句。',
  constraints: [{ id: 'dir-hard', kind: 'direction', text: '小红帽必须主动提出并完成一次与狼的危险交易', enforcement: 'hard' }]
});
assert.ok(directionLiteral.findings.some((item) => item.type === 'direction_literal_absent' && item.enforcement === 'soft'));
assert.ok(!directionLiteral.findings.some((item) => item.type === 'direction_missing'));
assert.strictEqual(directionLiteral.qualityGate, 'passed');

const techSoft = Review.reviewDraft({
  text: '契约的自动生成约束系统检测到了一个它无法归类的操作。',
  qualityTargets: { technicalRegisterMode: 'avoid', technicalRegisterLocked: false }
});
assert.ok(techSoft.findings.some((item) => item.type === 'technical_register_drift' && item.enforcement === 'soft'));
assert.strictEqual(techSoft.qualityGate, 'passed');
assert.ok(techSoft.metrics && typeof techSoft.metrics.batch.dialogueRatio === 'number');
const leakReport = Review.reviewDraft({
  text: '普通正文。',
  scenes: [{
    sceneId: 'scene-6-1',
    revisionId: 'draft-r6',
    text: '在场景 6-1 中，她按照 fineOutline 走进门内。下一批将揭晓真相。'
  }]
});
assert.strictEqual(leakReport.qualityGate, 'blocked');
assert.ok(leakReport.findings.some((item) => item.type === 'process_label_leak' && item.sceneId === 'scene-6-1'));
assert.ok(leakReport.findings.some((item) => item.type === 'prompt_metadata_leak'));
assert.ok(Review.processLeakFindings({ text: '根据计划要求，这里应输出 JSON 格式。' })
  .some((item) => item.type === 'prompt_instruction_leak'));
const boundaryReport = Review.reviewDraft({
  text: '边界测试。',
  scenes: [
    { sceneId: 'left', revisionId: 'left-r1', text: '雨水顺着红斗篷滴落在石阶上，她听见门后传来三次敲击。她握紧篮柄，没有立刻回答。' },
    { sceneId: 'right', revisionId: 'right-r1', text: '雨水顺着红斗篷滴落在石阶上，她听见门后传来三次敲击。她握紧篮柄，没有立刻回答。门终于打开了。' }
  ]
});
assert.ok(boundaryReport.findings.some((item) => item.type === 'scene_boundary_repetition' && item.relatedSceneId === 'left'));
assert.strictEqual(Review.processLeakFindings({ text: '这个场景很安静，狼没有出现。' }).length, 0);
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
