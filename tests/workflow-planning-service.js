const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Planning = require('../src/core/workflow/workflow-planning-schema');
const planningService = require('../desktop/services/workflow-planning-service');
const projectService = require('../desktop/services/project-service');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');

const directions = Planning.createDirectionSet({ directions: [
  { id: 'mystery', title: '追查钟楼', premise: '主角调查钟楼失踪案。', emotionalArc: '疑惑到恐惧' },
  { id: 'escape', title: '逃离旧港', premise: '主角被迫逃离旧港。', emotionalArc: '紧张到决绝' }
] });
assert.strictEqual(directions.directions.length, 2);
assert.deepStrictEqual(Planning.mergeDirections(directions, ['mystery', 'escape']).sourceDirectionIds, ['mystery', 'escape']);
assert.throws(() => Planning.createDirectionSet({ directions: [{ premise: '只有一个' }] }), /2 to 4/);
const compiled = Planning.compileConstraintPrompt([
  { id: 'want', projectId: 'p1', kind: 'direction', text: '出现钟楼', weight: 4 },
  { id: 'avoid', projectId: 'p1', kind: 'exclusion', text: '出现钟楼', weight: 5 }
], { projectId: 'p1' });
assert.strictEqual(compiled.snapshot.conflicts.length, 1);
assert.ok(compiled.promptText.includes('权重5'));
assert.deepStrictEqual(Planning.createScenePlan({ fineOutlineEnabled: false, scenes: [{ title: '抵达' }] }).scenes[0].fineOutline, []);

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-planning-'));
  try {
    const created = await projectService.createProject(root, { id: 'planning-project', title: 'Planning' });
    await workflowV2Store.createWorkflowV2Run(created.projectPath, { id: 'planning-run', projectId: created.project.id, definition: { id: 'planning-definition', templateId: 'continuation', templateVersion: 1, title: '策划', nodes: [{ id: 'planning', capabilityId: 'planning.scene-plan' }] } });
    const first = await planningService.createOrReuseScenePlan({ projectPath: created.projectPath, runId: 'planning-run', projectId: created.project.id, artifactId: 'scene-plan', revisionId: 'plan-r1', reviewState: 'approved', approvedAt: '2026-07-14T03:00:00.000Z', plan: { scenes: [{ title: '抵达钟楼', fineOutline: ['发现足迹', '听见钟声'] }] } });
    assert.strictEqual(first.reused, false);
    const reused = await planningService.createOrReuseScenePlan({ projectPath: created.projectPath, runId: 'planning-run', projectId: created.project.id, artifactId: 'other', revisionId: 'other-r1', plan: { scenes: [{ title: '不应创建' }] } });
    assert.strictEqual(reused.reused, true);
    assert.strictEqual(reused.content.scenes[0].title, '抵达钟楼');
    const generated = await planningService.generatePlanningArtifact({ projectPath: created.projectPath, runId: 'planning-run', projectId: created.project.id, artifactId: 'directions', revisionId: 'directions-r1', taskId: 'direction-task', kind: 'direction-set', streamGeneration: async (_prompt, onToken) => onToken('{"directions":[{"title":"A","premise":"追查钟楼"},{"title":"B","premise":"逃离旧港"}]}') });
    assert.ok(generated.ok);
    assert.strictEqual(generated.content.directions.length, 2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  console.log('Workflow planning service test passed.');
})().catch((error) => { console.error(error); process.exit(1); });
