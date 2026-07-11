const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const workflowService = require('../desktop/services/workflow-service');
const workflowStore = require('../desktop/storage/workflow-run-store');
const paths = require('../desktop/storage/library-paths');
const WorkflowSchema = require('../src/core/workflow/workflow-schema');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-workflow-store-'));

  try {
    await projectService.createProject(dataRoot, {
      id: 'workflow-project',
      title: 'Workflow Project',
      createdAt: '2026-06-27T00:00:00.000Z'
    });

    const saved = await workflowService.saveRun(dataRoot, 'workflow-project', {
      id: 'run-1',
      title: 'Placeholder Run',
      status: 'waiting_user',
      preRunSnapshot: { backupId: 'before-workflow.json', reason: 'before-workflow' },
      steps: [{ id: 'step-1', title: 'Confirm outline', kind: 'manual', status: 'pending' }],
      artifacts: [{ id: 'artifact-1', type: 'chapter_outline', title: 'Outline', content: 'Chapter beats' }]
    });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.run.id, 'run-1');
    assert.strictEqual(saved.run.projectId, 'workflow-project');
    assert.strictEqual(saved.run.status, 'waiting_user');
    assert.strictEqual(saved.run.preRunSnapshot.backupId, 'before-workflow.json');
    assert.strictEqual(saved.run.steps[0].requiresUserApproval, true);
    assert.strictEqual(saved.run.artifacts[0].type, 'chapter_outline');

    const listed = await workflowService.listRuns(dataRoot, 'workflow-project');
    assert.strictEqual(listed.runs.length, 1);
    assert.strictEqual(listed.runs[0].title, 'Placeholder Run');

    const event = await workflowService.appendEvent(dataRoot, 'workflow-project', 'run-1', {
      type: 'step_started',
      payload: { stepId: 'step-1' },
      createdAt: '2026-06-27T01:00:00.000Z'
    });
    assert.strictEqual(event.ok, true);
    assert.strictEqual(event.event.type, 'step_started');

    const events = await workflowService.listEvents(dataRoot, 'workflow-project', 'run-1');
    assert.strictEqual(events.events.length, 1);
    assert.strictEqual(events.events[0].payload.stepId, 'step-1');
    assert.strictEqual(events.events[0].runId, 'run-1');

    const template = WorkflowSchema.createNovelDraftingPlaceholderTemplate();
    assert.strictEqual(template.id, 'novel-drafting-placeholder');
    assert.strictEqual(template.steps.length, 4);
    assert.deepStrictEqual(
      template.steps.map((step) => step.id),
      ['project-brief', 'chapter-outline', 'scene-draft', 'user-confirmation']
    );
    assert.ok(template.steps.every((step) => step.requiresUserApproval), 'placeholder workflow should stay semi-automatic');

    const projectPath = paths.projectDir(dataRoot, 'workflow-project');
    await fs.access(paths.workflowRunsPath(projectPath));
    await fs.access(paths.workflowRunEventsPath(projectPath, 'run-1'));

    const directRuns = await workflowStore.listWorkflowRuns(projectPath);
    assert.strictEqual(directRuns[0].status, 'waiting_user');

    console.log('Workflow store test passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow store test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
