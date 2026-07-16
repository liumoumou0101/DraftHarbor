const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const workflowService = require('../desktop/services/workflow-service');
const legacyWorkflowStore = require('../desktop/storage/workflow-run-store');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const paths = require('../desktop/storage/library-paths');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-v2-compatibility-'));
  let servers = null;

  try {
    const created = await projectService.createProject(dataRoot, {
      id: 'workflow-compatibility-project',
      title: 'Workflow Compatibility Project'
    });
    const projectId = created.project.id;
    const projectPath = created.projectPath;
    const legacy = await legacyWorkflowStore.upsertWorkflowRun(projectPath, {
      id: 'legacy-run-1',
      projectId,
      title: '旧版续写流程',
      status: 'waiting_user',
      activeStepId: 'scene-draft',
      steps: [
        { id: 'outline', title: '提取大纲', kind: 'generation', status: 'completed' },
        { id: 'scene-draft', title: '生成正文', kind: 'generation', status: 'waiting_user' }
      ],
      artifacts: [{
        id: 'legacy-draft',
        type: 'draft_text',
        title: '旧版正文草稿',
        stepId: 'scene-draft',
        content: '旧版工作流生成的正文。',
        data: { appliedAt: '2026-07-14T01:00:00.000Z' }
      }]
    });
    await legacyWorkflowStore.appendWorkflowEvent(projectPath, legacy.id, {
      id: 'legacy-event-1',
      type: 'artifact_created',
      stepId: 'scene-draft',
      createdAt: '2026-07-14T01:00:00.000Z'
    });
    const legacyRunsPath = paths.workflowRunsPath(projectPath);
    const legacyEventsPath = paths.workflowRunEventsPath(projectPath, legacy.id);
    const legacyRunsBefore = await fs.readFile(legacyRunsPath, 'utf8');
    const legacyEventsBefore = await fs.readFile(legacyEventsPath, 'utf8');

    await workflowV2Store.createWorkflowV2Run(projectPath, {
      id: 'v2-existing',
      projectId,
      title: '已存在的新版运行',
      definition: {
        id: 'v2-definition',
        templateId: 'continuation',
        templateVersion: 1,
        title: '新版模板',
        nodes: [{ id: 'source', capabilityId: 'source.provide' }]
      }
    });

    const listed = await workflowService.listRuns(dataRoot, projectId);
    const listedLegacy = listed.runs.find((run) => run.id === legacy.id);
    const listedV2 = listed.runs.find((run) => run.id === 'v2-existing');
    assert.strictEqual(listedLegacy.storageVersion, 'legacy-0.1');
    assert.strictEqual(listedLegacy.copyToV2Available, true);
    assert.strictEqual(listedLegacy.readOnly, false);
    assert.strictEqual(listedV2.storageVersion, 'v2');
    assert.strictEqual(listedV2.readOnly, true);
    assert.deepStrictEqual(listedV2.steps, []);

    const legacyEvents = await workflowService.listEvents(dataRoot, projectId, legacy.id);
    assert.strictEqual(legacyEvents.events.length, 1);
    assert.strictEqual(legacyEvents.events[0].type, 'artifact_created');

    const copied = await workflowService.copyLegacyRun(dataRoot, projectId, legacy.id, {
      targetRunId: 'legacy-copy-v2',
      title: '旧版流程的新副本'
    });
    assert.strictEqual(copied.ok, true);
    assert.strictEqual(copied.run.storageVersion, 'v2');
    assert.strictEqual(copied.run.readOnly, true);
    assert.strictEqual(await fs.readFile(legacyRunsPath, 'utf8'), legacyRunsBefore, 'copy must not modify legacy run data');
    assert.strictEqual(await fs.readFile(legacyEventsPath, 'utf8'), legacyEventsBefore, 'copy must not modify legacy events');

    const copiedV2 = await workflowV2Store.readWorkflowV2Run(projectPath, 'legacy-copy-v2');
    assert.strictEqual(copiedV2.definitionSnapshot.definition.templateId, 'legacy-0.1-placeholder-copy');
    assert.strictEqual(copiedV2.definitionSnapshot.definition.nodes.length, 2);
    assert.strictEqual(copiedV2.state.nodeStates[1].executionState, 'waiting_user');
    const families = await artifactStore.listArtifactFamilies(projectPath, 'legacy-copy-v2');
    assert.strictEqual(families.length, 1);
    const revisionId = families[0].revisionIds[0];
    assert.strictEqual(
      await artifactStore.readArtifactContent(projectPath, 'legacy-copy-v2', families[0].id, revisionId),
      '旧版工作流生成的正文。'
    );
    assert.strictEqual((await workflowService.listEvents(dataRoot, projectId, 'legacy-copy-v2')).events[0].type, 'legacy_run_copied');

    await assert.rejects(
      () => workflowService.copyLegacyRun(dataRoot, projectId, legacy.id, { targetRunId: 'legacy-copy-v2' }),
      /already exists/
    );
    assert.strictEqual(await fs.readFile(legacyRunsPath, 'utf8'), legacyRunsBefore, 'failed copy must not modify legacy run data');
    assert.strictEqual(await fs.readFile(legacyEventsPath, 'utf8'), legacyEventsBefore, 'failed copy must not modify legacy events');
    await assert.rejects(
      () => workflowService.cancelRun(dataRoot, projectId, 'legacy-copy-v2', 'must not use legacy endpoint'),
      /read-only/
    );
    await assert.rejects(
      () => workflowService.appendEvent(dataRoot, projectId, 'legacy-copy-v2', { type: 'legacy_write' }),
      /cannot receive events/
    );

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async () => ''
    });
    const listResponse = await fetch(`${servers.appUrl}/api/workflows?projectId=${projectId}`);
    const listBody = await listResponse.json();
    assert.ok(listResponse.ok && listBody.ok);
    assert.ok(listBody.runs.some((run) => run.id === legacy.id && run.storageVersion === 'legacy-0.1'));
    assert.ok(listBody.runs.some((run) => run.id === 'legacy-copy-v2' && run.storageVersion === 'v2'));

    const apiCopyResponse = await fetch(`${servers.appUrl}/api/workflows/copy-legacy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, legacyRunId: legacy.id, targetRunId: 'legacy-copy-api' })
    });
    const apiCopyBody = await apiCopyResponse.json();
    assert.ok(apiCopyResponse.ok && apiCopyBody.ok);
    assert.strictEqual(apiCopyBody.run.id, 'legacy-copy-api');

    console.log('Workflow v2 compatibility test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow v2 compatibility test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
