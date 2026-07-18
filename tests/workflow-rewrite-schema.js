const assert = require('assert');
const Rewrite = require('../src/core/workflow/workflow-rewrite-schema');

const sourceSnapshot = { content: [
  { sceneId: 's1', title: '抵达', content: '林岚抵达钟楼。\n\n她发现地上的足迹。' },
  { sceneId: 's2', title: '密室', content: '暗门打开。\n\n林岚进入密室。' }
] };
const brief = Rewrite.createRewriteBrief({ instruction: '压缩开场并强化悬疑', targetLengthRatio: 0.8, preserve: ['怀表线索'] });
assert.strictEqual(brief.targetLengthRatio, 0.8);

const plan = Rewrite.createRewritePlan({ strategy: '加速进入冲突', units: [
  { id: 'arrival', sourceSceneIds: ['s1'], targetSceneId: 's1', objective: '更快发现足迹', operations: [{ operation: 'compress', text: '压缩环境描写', weight: 2 }], targetWords: 1200 },
  { id: 'room', sourceSceneId: 's2', targetSceneId: 's2', objective: '强化进入密室的代价', rules: [{ kind: 'expand', instruction: '增加机关冲突' }] }
] }, { sourceSnapshot, sourceRevisionId: 'source-r1' });
assert.strictEqual(plan.units[0].rules[0].kind, 'compress');
assert.strictEqual(plan.sourceRevisionId, 'source-r1');
assert.throws(() => Rewrite.createRewritePlan({ units: [{ sourceSceneId: 'outside', targetSceneId: 'outside' }] }, { sourceSnapshot }), /outside the source snapshot/);

const result = Rewrite.createRewriteUnitResult({ unitId: 'arrival', targetSceneId: 's1', text: '林岚冲进钟楼。\n\n足迹还很新。' });
const comparison = Rewrite.createRewriteBatchComparison(sourceSnapshot, [result]);
assert.strictEqual(comparison.comparisons[0].diff.counts.deleted, 2);
assert.strictEqual(comparison.comparisons[0].diff.counts.inserted, 2);
assert.ok(comparison.comparisons[0].diff.characterDelta < 0);
console.log('Workflow rewrite schema test passed.');
