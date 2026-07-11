const assert = require('assert');

const AITaskContract = require('../src/core/generation/ai-task-contract');

assert.deepStrictEqual(AITaskContract.DOMAINS, ['prose', 'compendium', 'summary', 'style-guard']);
assert.ok(AITaskContract.ACTIONS.includes('rewrite'));
assert.ok(AITaskContract.OUTPUT_CONTRACTS.includes('field-patch'));

const input = {
    id: ' task-1 ',
    projectId: ' project-1 ',
    domain: 'prose',
    action: 'rewrite',
    target: { type: 'scene', sceneId: 'scene-1', selection: { start: 3, end: 12 } },
    scope: 'selection',
    presetId: ' balanced-polish ',
    instruction: ' Keep the meaning. ',
    contextReferences: [{ type: 'scene', id: 'scene-0' }],
    providerProfileId: ' profile-1 ',
    model: ' model-1 ',
    outputContract: 'text',
    activeAvoidanceRuleIds: ['rule-1', 'rule-1', '', ' rule-2 '],
    beforeSnapshot: { text: 'Original text' }
};

const task = AITaskContract.createAITask(input);
assert.strictEqual(task.id, 'task-1');
assert.strictEqual(task.projectId, 'project-1');
assert.strictEqual(task.presetId, 'balanced-polish');
assert.strictEqual(task.instruction, 'Keep the meaning.');
assert.deepStrictEqual(task.activeAvoidanceRuleIds, ['rule-1', 'rule-2']);
assert.strictEqual(task.status, 'draft');
assert.ok(task.createdAt);
assert.notStrictEqual(task.target, input.target, 'target must be cloned');
assert.notStrictEqual(task.beforeSnapshot, input.beforeSnapshot, 'before snapshot must be cloned');
assert.strictEqual(input.id, ' task-1 ', 'normalization must not mutate the input');
assert.strictEqual(
    AITaskContract.taskTargetKey(task),
    'project-1:prose:scene:scene-1',
    'target key should identify the project, domain, target type, and target id'
);

const cardTask = AITaskContract.createAITask({
    projectId: 'project-1',
    domain: 'compendium',
    action: 'rewrite',
    target: { type: 'entry', entryId: 'entry-1' },
    scope: 'fields',
    outputContract: 'field-patch'
});
assert.strictEqual(cardTask.domain, 'compendium');
assert.strictEqual(cardTask.outputContract, 'field-patch');

const drawTask = AITaskContract.createAITask({
    projectId: 'project-1',
    domain: 'compendium',
    action: 'draw',
    target: { type: 'project', projectId: 'project-1' },
    scope: 'project',
    outputContract: 'card-drafts'
});
assert.strictEqual(drawTask.action, 'draw');

const invalidDrawOutput = AITaskContract.validateAITask({
    projectId: 'project-1',
    domain: 'compendium',
    action: 'draw',
    target: { type: 'project', projectId: 'project-1' },
    scope: 'project',
    outputContract: 'field-patch'
});
assert.strictEqual(invalidDrawOutput.ok, false);
assert.ok(invalidDrawOutput.errors.includes('output field-patch is not supported for compendium/draw'));

const invalid = AITaskContract.validateAITask({
    projectId: '',
    domain: 'prose',
    action: 'draw',
    target: {},
    scope: 'selection',
    outputContract: 'field-patch',
    status: 'mystery'
});
assert.strictEqual(invalid.ok, false);
assert.ok(invalid.errors.includes('projectId is required'));
assert.ok(invalid.errors.includes('target is required'));
assert.ok(invalid.errors.includes('action draw is not supported for domain prose'));
assert.ok(invalid.errors.includes('output field-patch is not supported for domain prose'));
assert.ok(invalid.errors.includes('unsupported status: mystery'));

assert.throws(
    () => AITaskContract.createAITask({ domain: 'unknown' }),
    (error) => error && error.name === 'AITaskValidationError' && error.errors.length > 0
);

console.log('AI task contract tests passed.');
