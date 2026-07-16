const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const projectStore = require('../desktop/storage/project-file-store');
const legacyWorkflowStore = require('../desktop/storage/workflow-run-store');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const chunkStore = require('../desktop/storage/workflow-chunk-store');
const applicationStore = require('../desktop/storage/workflow-application-store');
const eventStore = require('../desktop/storage/workflow-event-store-v2');
const paths = require('../desktop/storage/library-paths');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-v2-store-'));

  try {
    const created = await projectService.createProject(dataRoot, {
      id: 'workflow-v2-project',
      title: 'Workflow v2 Project'
    });
    const projectPath = created.projectPath;

    await legacyWorkflowStore.upsertWorkflowRun(projectPath, {
      id: 'legacy-run',
      projectId: created.project.id,
      title: 'Old placeholder run',
      steps: []
    });
    const legacyPath = paths.workflowRunsPath(projectPath);
    const legacyBeforeProjectSave = await fs.readFile(legacyPath, 'utf8');
    const opened = await projectStore.openProject(dataRoot, created.project.id);
    await projectService.saveProject(dataRoot, { ...opened, workflowRuns: [] });
    assert.strictEqual(
      await fs.readFile(legacyPath, 'utf8'),
      legacyBeforeProjectSave,
      'project-wide save must not overwrite workflow-owned legacy runs'
    );
    assert.strictEqual((await projectStore.openProject(dataRoot, created.project.id)).workflowRuns.length, 1);

    const createdRun = await workflowV2Store.createWorkflowV2Run(projectPath, {
      id: 'v2-run-1',
      projectId: created.project.id,
      title: '续写第一章',
      definition: {
        id: 'definition-1',
        templateId: 'continuation',
        templateVersion: 1,
        title: '续写模板实例',
        nodes: [{ id: 'source', capabilityId: 'source.provide' }]
      },
      state: {
        nodeStates: [{ nodeId: 'source', executionState: 'ready' }]
      },
      createdAt: '2026-07-14T00:00:00.000Z'
    });
    assert.strictEqual(createdRun.summary.id, 'v2-run-1');
    assert.strictEqual(createdRun.index.revision, 1);
    assert.strictEqual(createdRun.state.nodeStates[0].executionState, 'ready');

    const state = await workflowV2Store.writeWorkflowV2RunState(projectPath, 'v2-run-1', {
      status: 'running',
      activeNodeId: 'source'
    }, { expectedRevision: 1 });
    assert.strictEqual(state.revision, 2);
    assert.strictEqual((await workflowV2Store.getWorkflowV2RunSummary(projectPath, 'v2-run-1')).status, 'running');
    await assert.rejects(
      () => workflowV2Store.writeWorkflowV2RunState(projectPath, 'v2-run-1', {}, { expectedRevision: 1 }),
      /revision does not match/
    );

    const longText = `${'一段较长的正文内容。'.repeat(5000)}\n结尾。`;
    const artifactResult = await artifactStore.writeArtifactRevision(projectPath, 'v2-run-1', {
      id: 'artifact-1',
      projectId: created.project.id,
      runId: 'v2-run-1',
      nodeId: 'source',
      artifactType: 'draft-batch@1',
      title: '第一版正文'
    }, {
      id: 'revision-1',
      summary: '大段正文草稿',
      payload: { format: 'text' }
    }, longText);
    assert.strictEqual(artifactResult.revision.payload.byteLength, Buffer.byteLength(longText, 'utf8'));
    assert.ok(artifactResult.revision.payload.contentRef.endsWith('revision-1.txt'));
    assert.strictEqual(await artifactStore.readArtifactContent(projectPath, 'v2-run-1', 'artifact-1', 'revision-1'), longText);

    const secondRevision = await artifactStore.writeArtifactRevision(projectPath, 'v2-run-1', artifactResult.family, {
      id: 'revision-2',
      parentRevisionId: 'revision-1',
      variantId: 'alternative',
      payload: { format: 'text' }
    }, '另一条分支正文。');
    assert.deepStrictEqual(secondRevision.family.revisionIds, ['revision-1', 'revision-2']);
    await assert.rejects(
      () => artifactStore.writeArtifactRevision(projectPath, 'v2-run-1', artifactResult.family, {
        id: 'revision-1',
        payload: { format: 'text' }
      }, '不允许覆盖'),
      /immutable/
    );

    const chunkOne = await chunkStore.writeChunkCheckpoint(projectPath, 'v2-run-1', {
      id: 'chunk-1',
      nodeId: 'source',
      status: 'running',
      sequence: 1,
      content: '第一段区块正文'
    }, { expectedRevision: 0 });
    const chunkTwo = await chunkStore.writeChunkCheckpoint(projectPath, 'v2-run-1', {
      ...chunkOne,
      status: 'completed',
      content: '第一段区块正文（完成）'
    }, { expectedRevision: 1 });
    assert.strictEqual(chunkTwo.revision, 2);
    assert.strictEqual(await chunkStore.readChunkContent(projectPath, 'v2-run-1', 'chunk-1'), '第一段区块正文（完成）');
    assert.strictEqual(
      await artifactStore.readArtifactContent(projectPath, 'v2-run-1', 'artifact-1', 'revision-1'),
      longText,
      'updating a checkpoint must not rewrite other revision content'
    );

    const event = await eventStore.appendWorkflowV2Event(projectPath, 'v2-run-1', {
      id: 'event-1',
      type: 'chunk_completed',
      nodeId: 'source',
      payload: { chunkId: 'chunk-1' }
    });
    assert.strictEqual(event.type, 'chunk_completed');
    assert.strictEqual((await eventStore.listWorkflowV2Events(projectPath, 'v2-run-1')).length, 1);
    const application = await applicationStore.writeApplicationRecord(projectPath, 'v2-run-1', {
      applicationId: 'application-1',
      sourceRevisionIds: ['revision-1'],
      target: { type: 'writer_scene', sceneId: 'scene-1' }
    });
    assert.strictEqual(application.applicationId, 'application-1');

    const indexText = await fs.readFile(paths.workflowV2RunsPath(projectPath), 'utf8');
    assert.ok(!indexText.includes(longText.slice(0, 100)), 'runs index must not contain long artifact text');
    assert.ok(indexText.length < 4000, 'runs index should remain metadata-sized');
    await assert.rejects(
      () => workflowV2Store.upsertWorkflowV2RunSummary(projectPath, {
        ...createdRun.summary,
        status: 'completed'
      }, { expectedRevision: 0 }),
      (error) => error instanceof workflowV2Store.WorkflowV2ConflictError
    );

    await workflowV2Store.createWorkflowV2Run(projectPath, {
      id: 'v2-run-2',
      projectId: created.project.id,
      title: '第二条运行',
      definition: {
        id: 'definition-2',
        templateId: 'continuation',
        templateVersion: 1,
        title: '续写模板实例二',
        nodes: [{ id: 'source', capabilityId: 'source.provide' }]
      }
    });
    assert.strictEqual((await workflowV2Store.listWorkflowV2Runs(projectPath)).length, 2);

    const orphanTemp = path.join(paths.workflowV2RunDir(projectPath, 'v2-run-1'), `state.json.${crypto.randomUUID()}.tmp`);
    const nonAtomicTemp = path.join(paths.workflowV2RunDir(projectPath, 'v2-run-1'), 'keep.tmp');
    await fs.writeFile(orphanTemp, 'interrupted write', 'utf8');
    await fs.writeFile(nonAtomicTemp, 'keep me', 'utf8');
    const removed = await workflowV2Store.recoverWorkflowV2Store(projectPath);
    assert.ok(removed.includes(orphanTemp));
    await assert.rejects(() => fs.access(orphanTemp));
    await fs.access(nonAtomicTemp);

    const reopenedRun = await workflowV2Store.readWorkflowV2Run(projectPath, 'v2-run-1');
    assert.strictEqual(reopenedRun.summary.title, '续写第一章');
    assert.strictEqual(reopenedRun.state.revision, 2);
    assert.strictEqual((await artifactStore.listArtifactFamilies(projectPath, 'v2-run-1')).length, 1);
    assert.strictEqual((await chunkStore.listChunkCheckpoints(projectPath, 'v2-run-1')).length, 1);

    console.log('Workflow v2 store test passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow v2 store test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
