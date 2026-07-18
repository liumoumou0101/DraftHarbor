const assert = require('assert');
const ConstraintSchema = require('../src/core/workflow/workflow-constraint-schema');

const authorFact = ConstraintSchema.createCreativeConstraint({
  id: 'author-fact',
  projectId: 'project-1',
  kind: 'fact',
  text: '主角不知道密室的位置',
  sourceLevel: 'author_locked',
  enforcement: 'soft',
  weight: 5
});
assert.strictEqual(authorFact.enforcement, 'hard');
assert.strictEqual(ConstraintSchema.validateCreativeConstraint(authorFact).ok, true);

const inferredFact = ConstraintSchema.createCreativeConstraint({
  id: 'ai-fact',
  projectId: 'project-1',
  kind: 'fact',
  text: '管家可能认识来访者',
  sourceLevel: 'ai_inference',
  enforcement: 'hard'
});
assert.strictEqual(inferredFact.enforcement, 'soft');

const constraints = [
  authorFact,
  inferredFact,
  { id: 'project-lock', projectId: 'project-1', kind: 'direction', text: '强化悬疑', scope: 'project' },
  { id: 'workflow-lock', projectId: 'project-1', runId: 'run-1', kind: 'direction', text: '本轮突出追逐', scope: 'workflow' },
  { id: 'node-lock', projectId: 'project-1', runId: 'run-1', nodeId: 'draft', kind: 'exclusion', text: '不要揭晓凶手', scope: 'node' },
  { id: 'other-node', projectId: 'project-1', runId: 'run-1', nodeId: 'outline', kind: 'direction', text: '只属于其他节点', scope: 'node' },
  { id: 'disabled', projectId: 'project-1', kind: 'direction', text: '已停用', enabled: false }
];
const resolved = ConstraintSchema.resolveConstraints(constraints, {
  projectId: 'project-1',
  runId: 'run-1',
  nodeId: 'draft'
});
assert.deepStrictEqual(
  new Set(resolved.map((constraint) => constraint.id)),
  new Set(['author-fact', 'ai-fact', 'project-lock', 'workflow-lock', 'node-lock'])
);
assert.strictEqual(resolved[0].id, 'author-fact');
assert.ok(
  ConstraintSchema.constraintPrecedence(constraints[4])
    > ConstraintSchema.constraintPrecedence(constraints[2])
);

const conflicts = ConstraintSchema.detectConstraintConflicts([
  { id: 'want', projectId: 'project-1', kind: 'direction', text: '出现时间旅行' },
  { id: 'avoid', projectId: 'project-1', kind: 'exclusion', text: '  出现时间旅行  ' },
  { id: 'different', projectId: 'project-1', kind: 'exclusion', text: '不要倒叙' }
]);
assert.strictEqual(conflicts.length, 1);
assert.deepStrictEqual(conflicts[0].constraintIds, ['want', 'avoid']);

const snapshot = ConstraintSchema.createConstraintSnapshot(constraints, {
  projectId: 'project-1',
  runId: 'run-1',
  nodeId: 'draft'
}, {
  id: 'snapshot-1',
  digest: 'sha256:constraints',
  capturedAt: '2026-07-14T02:00:00.000Z'
});
assert.strictEqual(snapshot.id, 'snapshot-1');
assert.strictEqual(snapshot.constraints.length, 5);
assert.ok(!snapshot.constraints.some((constraint) => constraint.id === 'disabled'));
assert.strictEqual(snapshot.capturedAt, '2026-07-14T02:00:00.000Z');

const invalidNodeScope = ConstraintSchema.validateCreativeConstraint({
  projectId: 'project-1',
  kind: 'direction',
  text: '有效内容',
  scope: 'node'
});
assert.strictEqual(invalidNodeScope.ok, false);
assert.ok(invalidNodeScope.errors.includes('node constraint runId is required'));
assert.ok(invalidNodeScope.errors.includes('node constraint nodeId is required'));

console.log('Workflow constraint schema test passed.');
