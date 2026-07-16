const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const applicationStore = require('../desktop/storage/workflow-application-store');
const compendiumService = require('../desktop/services/compendium-service');
const { applyWorkflowApplication, restoreWorkflowApplication } = require('../desktop/services/workflow-application-service');

async function writeApprovedText(projectPath, projectId, runId, artifactId, revisionId, text) {
  await artifactStore.writeArtifactRevision(projectPath, runId, {
    id: artifactId,
    projectId,
    runId,
    nodeId: 'draft-node',
    artifactType: 'draft-batch@1',
    title: artifactId
  }, {
    id: revisionId,
    summary: revisionId,
    reviewState: 'approved',
    approvedAt: '2026-07-14T01:00:00.000Z',
    payload: { format: 'text' }
  }, text);
}

function source(runId, artifactId, revisionId) {
  return { runId, artifactId, revisionId };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-application-service-'));
  try {
    const created = await projectService.createProject(dataRoot, {
      id: 'workflow-application-project',
      title: 'Workflow Application Project'
    });
    const { project, projectPath } = created;
    const runId = 'workflow-application-run';
    await workflowV2Store.createWorkflowV2Run(projectPath, {
      id: runId,
      projectId: project.id,
      title: '写回运行',
      definition: { id: 'application-definition', templateId: 'continuation', templateVersion: 1, title: '写回定义', nodes: [{ id: 'draft-node', capabilityId: 'draft.batch' }] }
    });
    await writeApprovedText(projectPath, project.id, runId, 'draft-one', 'revision-one', '第一段工作流正文。');
    await writeApprovedText(projectPath, project.id, runId, 'draft-two', 'revision-two', '第二段工作流正文。');

    const applied = await applyWorkflowApplication({
      dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-create',
      writer: {
        chapters: [{
          id: 'new-chapter', title: '新章节',
          scenes: [{ id: 'new-scene', title: '新场景', summary: '来自工作流', source: source(runId, 'draft-one', 'revision-one') }]
        }]
      }
    });
    assert.ok(applied.ok);
    assert.strictEqual(applied.application.status, 'applied');
    assert.ok(applied.application.backup.id);
    const reopened = await projectService.openProject(dataRoot, project.id);
    const newScene = reopened.project.scenes.find((scene) => scene.id === 'new-scene');
    assert.strictEqual(newScene.content, '第一段工作流正文。');
    assert.strictEqual(newScene.sourceRunId, runId);
    assert.strictEqual(newScene.sourceArtifactId, 'draft-one');
    assert.strictEqual(newScene.sourceRevisionId, 'revision-one');
    assert.ok(reopened.project.chapters.find((chapter) => chapter.id === 'new-chapter').sceneIds.includes('new-scene'));
    const repeated = await applyWorkflowApplication({ dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-create' });
    assert.ok(repeated.idempotent);
    assert.strictEqual((await projectService.openProject(dataRoot, project.id)).project.scenes.filter((scene) => scene.id === 'new-scene').length, 1);

    const beforeInvalid = JSON.stringify(await projectService.openProject(dataRoot, project.id));
    const invalid = await assert.rejects(
      () => applyWorkflowApplication({
        dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-invalid',
        operations: [{
          kind: 'writer.update-scene', target: { sceneId: 'scene-1' },
          source: source(runId, 'draft-two', 'revision-two'), data: { expectedUpdatedAt: 'stale-version' }
        }]
      }),
      /target version changed/
    );
    assert.ok(invalid === undefined);
    assert.strictEqual(JSON.stringify(await projectService.openProject(dataRoot, project.id)), beforeInvalid, 'invalid batch must not change the project');

    const cardCreated = await applyWorkflowApplication({
      dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-card',
      compendium: { creates: [{ id: 'workflow-card', title: '工作流人物', type: 'character', summary: '由已确认产物建立', source: source(runId, 'draft-one', 'revision-one') }] }
    });
    assert.ok(cardCreated.ok);
    const card = (await compendiumService.listEntries(dataRoot, project.id)).entries.find((entry) => entry.id === 'workflow-card');
    assert.strictEqual(card.title, '工作流人物');
    const forbidden = await assert.rejects(
      () => applyWorkflowApplication({
        dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-card-forbidden',
        compendium: { updates: [{ entryId: card.id, expectedUpdatedAt: card.updatedAt, patch: { body: '不得直接覆盖正文' }, source: source(runId, 'draft-two', 'revision-two') }] }
      }),
      /field is not allowed/
    );
    assert.ok(forbidden === undefined);
    const cardUpdated = await applyWorkflowApplication({
      dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-card-update',
      compendium: { updates: [{ entryId: card.id, expectedUpdatedAt: card.updatedAt, patch: { summary: '仅更新允许字段', tags: ['workflow'] }, source: source(runId, 'draft-two', 'revision-two') }] }
    });
    assert.ok(cardUpdated.ok);
    assert.strictEqual((await compendiumService.listEntries(dataRoot, project.id)).entries.find((entry) => entry.id === card.id).summary, '仅更新允许字段');

    const partial = await applyWorkflowApplication({
      dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-partial',
      writer: { chapters: [{ id: 'partial-chapter', title: '部分写回', scenes: [
        { id: 'partial-scene-1', title: '第一场', source: source(runId, 'draft-one', 'revision-one') },
        { id: 'partial-scene-2', title: '第二场', source: source(runId, 'draft-two', 'revision-two') }
      ] }] },
      afterOperation: async (_operation, index) => { if (index === 0) throw new Error('simulated interruption'); }
    });
    assert.strictEqual(partial.ok, false);
    assert.strictEqual(partial.application.status, 'partial');
    assert.ok((await projectService.openProject(dataRoot, project.id)).project.scenes.some((scene) => scene.id === 'partial-scene-1'));
    const restored = await restoreWorkflowApplication({ dataRoot, projectPath, runId, applicationId: 'application-partial' });
    assert.ok(restored.ok);
    assert.strictEqual(restored.application.status, 'restored');
    const afterRestore = await projectService.openProject(dataRoot, project.id);
    assert.ok(!afterRestore.project.scenes.some((scene) => scene.id === 'partial-scene-1'));
    assert.ok(!afterRestore.project.scenes.some((scene) => scene.id === 'partial-scene-2'));
    const record = await applicationStore.readApplicationRecord(projectPath, runId, 'application-create');
    assert.strictEqual(record.operations[0].result.targetId, 'new-scene');
    assert.ok(await applicationStore.readApplicationBackup(projectPath, runId, 'application-create'));

    const resumable = await applyWorkflowApplication({
      dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-resume',
      writer: { chapters: [{ id: 'resume-chapter', title: '继续写回', scenes: [
        { id: 'resume-scene-1', title: '第一场', source: source(runId, 'draft-one', 'revision-one') },
        { id: 'resume-scene-2', title: '第二场', source: source(runId, 'draft-two', 'revision-two') }
      ] }] },
      afterOperation: async (_operation, index) => { if (index === 0) throw new Error('simulated interruption for resume'); }
    });
    assert.strictEqual(resumable.application.status, 'partial');
    const resumed = await applyWorkflowApplication({ dataRoot, projectPath, projectId: project.id, runId, applicationId: 'application-resume', resume: true });
    assert.ok(resumed.ok);
    assert.strictEqual(resumed.application.status, 'applied');
    assert.ok((await projectService.openProject(dataRoot, project.id)).project.scenes.some((scene) => scene.id === 'resume-scene-2'));

    console.log('Workflow application service test passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow application service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
