const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const workflowService = require('../desktop/services/workflow-service');
const WorkflowEngine = require('../src/core/workflow/workflow-engine');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-workflow-engine-'));
  let servers = null;

  try {
    const created = await projectService.createProject(dataRoot, {
      id: 'workflow-engine-project',
      title: 'Workflow Engine Project',
      description: 'A test novel.'
    });
    const projectId = created.project.id;
    const run = WorkflowEngine.createNovelWorkflowRun({
      projectId,
      brief: 'A lighthouse city hides a weather machine.'
    });
    assert.strictEqual(run.status, 'waiting_user');
    assert.strictEqual(run.activeStepId, 'chapter-outline');
    assert.strictEqual(run.steps.find((step) => step.id === 'project-brief').status, 'completed');
    assert.strictEqual(run.steps.find((step) => step.id === 'chapter-outline').status, 'ready');

    const prompt = WorkflowEngine.buildStepPrompt(run, created.project, 'chapter-outline');
    assert.ok(prompt.asString().includes('lighthouse city'), 'outline prompt should include project brief');

    let nextRun = WorkflowEngine.completeGenerationStep(run, 'chapter-outline', 'Chapter 1: Storm Signal', prompt);
    assert.strictEqual(nextRun.steps.find((step) => step.id === 'chapter-outline').status, 'waiting_user');
    assert.ok(WorkflowEngine.latestArtifact(nextRun, 'chapter_outline').content.includes('Storm Signal'));
    nextRun = WorkflowEngine.approveStep(nextRun, 'chapter-outline');
    assert.strictEqual(nextRun.activeStepId, 'scene-draft');
    assert.strictEqual(nextRun.steps.find((step) => step.id === 'scene-draft').status, 'ready');

    const saved = await workflowService.startNovelWorkflow(dataRoot, projectId, {
      brief: 'A lighthouse city hides a weather machine.'
    });
    assert.ok(saved.ok);
    assert.strictEqual(saved.run.activeStepId, 'chapter-outline');

    const prepared = await workflowService.prepareStep(dataRoot, projectId, saved.run.id, 'chapter-outline');
    assert.ok(prepared.prompt.promptText.includes('weather machine'));

    const outlineDone = await workflowService.completeGenerationStep(dataRoot, projectId, saved.run.id, 'chapter-outline', {
      text: 'Chapter 1: Storm Signal',
      prompt: prepared.prompt
    });
    assert.strictEqual(outlineDone.run.status, 'waiting_user');
    const outlineApproved = await workflowService.approveStep(dataRoot, projectId, saved.run.id, 'chapter-outline');
    assert.strictEqual(outlineApproved.run.activeStepId, 'scene-draft');

    const scenePrepared = await workflowService.prepareStep(dataRoot, projectId, saved.run.id, 'scene-draft');
    const draftDone = await workflowService.completeGenerationStep(dataRoot, projectId, saved.run.id, 'scene-draft', {
      text: 'The beacon cracked awake above the flooded quay.',
      prompt: scenePrepared.prompt
    });
    assert.ok(WorkflowEngine.latestArtifact(draftDone.run, 'draft_text').content.includes('beacon'));
    const appliedDraft = await workflowService.applyArtifact(
      dataRoot,
      projectId,
      saved.run.id,
      WorkflowEngine.latestArtifact(draftDone.run, 'draft_text').id
    );
    assert.ok(appliedDraft.ok && appliedDraft.applyResult.applied, 'draft artifact should be applicable before final approval');
    assert.strictEqual(appliedDraft.run.status, 'waiting_user', 'partial artifact adoption should not complete the workflow');
    await workflowService.approveStep(dataRoot, projectId, saved.run.id, 'scene-draft');
    const finished = await workflowService.approveStep(dataRoot, projectId, saved.run.id, 'user-confirmation');
    assert.strictEqual(finished.run.status, 'completed');
    assert.ok(finished.applyResult.applied, 'final approval should apply draft to project');
    const updated = await projectService.openProject(dataRoot, projectId);
    assert.ok(updated.project.scenes.some((scene) => scene.content.includes('flooded quay')));
    assert.ok(
      updated.project.promptHistory.some((record) => record.task === 'workflow:scene-draft' && record.resultText.includes('flooded quay')),
      'workflow generation should be recorded in generation history'
    );

    const events = await workflowService.listEvents(dataRoot, projectId, saved.run.id);
    assert.ok(events.events.some((event) => event.type === 'run_created'));
    assert.ok(events.events.some((event) => event.type === 'artifact_applied'));
    assert.ok(events.events.some((event) => event.type === 'run_completed'));

    const cancellable = await workflowService.startNovelWorkflow(dataRoot, projectId, {
      brief: 'A cancelled workflow.'
    });
    const cancelled = await workflowService.cancelRun(dataRoot, projectId, cancellable.run.id, 'No longer needed.');
    assert.strictEqual(cancelled.run.status, 'cancelled');
    assert.ok(cancelled.run.steps.some((step) => step.status === 'cancelled'));

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async () => ''
    });

    const startResponse = await fetch(servers.appUrl + '/api/workflows/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        brief: 'API workflow brief.'
      })
    });
    const startBody = await startResponse.json();
    assert.ok(startResponse.ok && startBody.ok, 'workflow start API should return ok');
    assert.strictEqual(startBody.run.preRunSnapshot.reason, 'before-workflow');

    const backupsResponse = await fetch(`${servers.appUrl}/api/list-backups?projectId=${projectId}`);
    const backupsBody = await backupsResponse.json();
    assert.ok(
      backupsBody.backups.some((backup) => backup.reason === 'before-workflow'),
      'starting workflow should create a before-workflow backup'
    );

    const prepareResponse = await fetch(servers.appUrl + '/api/workflows/prepare-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, runId: startBody.run.id, stepId: 'chapter-outline' })
    });
    const prepareBody = await prepareResponse.json();
    assert.ok(prepareResponse.ok && prepareBody.ok);
    assert.ok(prepareBody.prompt.messages.length >= 2);

    const cancelResponse = await fetch(servers.appUrl + '/api/workflows/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, runId: startBody.run.id, reason: 'API cancellation test.' })
    });
    const cancelBody = await cancelResponse.json();
    assert.ok(cancelResponse.ok && cancelBody.ok, 'workflow cancel API should return ok');
    assert.strictEqual(cancelBody.run.status, 'cancelled');

    console.log('Workflow engine service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow engine service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
