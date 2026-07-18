const assert = require('assert');
const RewriteService = require('../desktop/services/workflow-rewrite-service');

const sourceSnapshot = { content: [
  { sceneId: 's1', title: '抵达', content: '林岚抵达钟楼。' },
  { sceneId: 's2', title: '密室', content: '林岚进入密室。' }
] };
const brief = { instruction: '强化悬疑并压缩冗余' };
const planInput = { strategy: '提速', units: [
  { id: 'u1', sourceSceneId: 's1', targetSceneId: 's1', objective: '快速入场', rules: [{ kind: 'compress', instruction: '删去天气' }] },
  { id: 'u2', sourceSceneId: 's2', targetSceneId: 's2', objective: '增强危机', rules: [{ kind: 'expand', instruction: '增加机关' }] }
] };

const preparedPlan = RewriteService.prepareRewriteStage('plan', { brief, sourceSnapshot });
assert.ok(preparedPlan.prompts[0].prompt.messages[0].content.includes('preserve|delete|compress'));
const plan = RewriteService.normalizeRewriteOutput('plan', planInput, { sourceSnapshot, sourceRevisionId: 'r1' });
const preparedRewrite = RewriteService.prepareRewriteStage('rewrite', { brief, sourceSnapshot, plan });
assert.strictEqual(preparedRewrite.prompts.length, 2);
assert.ok(preparedRewrite.prompts[0].prompt.messages[1].content.includes('林岚抵达钟楼'));
const outputs = ['林岚冲进钟楼。', '机关落下，林岚翻进密室。'];
const preparedRepair = RewriteService.prepareRewriteStage('repair', { brief, sourceSnapshot, plan, rewrites: RewriteService.buildRewriteResults(plan, outputs, { sourceSnapshot }) });
assert.strictEqual(preparedRepair.prompts.length, 2);
assert.ok(preparedRepair.prompts[1].prompt.messages[1].content.includes('林岚冲进钟楼'));
const comparison = RewriteService.buildComparison(sourceSnapshot, plan, outputs, { sourceSnapshot, repairApplied: true });
assert.strictEqual(comparison.comparisons.length, 2);
assert.strictEqual(comparison.comparisons[0].result.repairApplied, true);
assert.throws(() => RewriteService.buildRewriteResults(plan, ['only one'], { sourceSnapshot }), /must match/);
console.log('Workflow rewrite service test passed.');
