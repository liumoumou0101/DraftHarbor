const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const chunkStore = require('../desktop/storage/workflow-chunk-store');
const { runLongformGeneration } = require('../desktop/services/workflow-longform-service');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-longform-'));
  try {
    const created = await projectService.createProject(root, { id: 'longform-project', title: 'Longform' });
    const projectPath = created.projectPath;
    await runStore.createWorkflowV2Run(projectPath, { id: 'longform-run', projectId: created.project.id, definition: { id: 'longform-definition', templateId: 'continuation', templateVersion: 1, title: '长篇生成', nodes: [{ id: 'draft', capabilityId: 'draft.longform' }] } });
    const scenePlan = { scenes: [{ id: 's1', title: '抵达钟楼', fineOutline: ['发现足迹'] }, { id: 's2', title: '进入密室', fineOutline: ['找到钥匙'] }] };
    let calls = 0;
    const first = await runLongformGeneration({ projectPath, projectId: created.project.id, runId: 'longform-run', nodeId: 'draft', scenePlan, scenePlanRevisionId: 'plan-r1', constraintSnapshotId: 'locks-r1', generateChunk: async ({ chunk }) => { calls += 1; if (chunk.sceneId === 's2') throw new Error('simulated failure'); return { text: '钟楼场景正文。', rollingStatePatch: { locations: { hero: '钟楼' } } }; } });
    assert.strictEqual(first.status, 'failed');
    assert.strictEqual(calls, 2);
    assert.strictEqual((await chunkStore.readChunkCheckpoint(projectPath, 'longform-run', 'chunk-s1')).status, 'completed');

    const resumed = await runLongformGeneration({ projectPath, projectId: created.project.id, runId: 'longform-run', nodeId: 'draft', scenePlan, scenePlanRevisionId: 'plan-r1', constraintSnapshotId: 'locks-r1', generateChunk: async ({ chunk, rollingState }) => { calls += 1; assert.strictEqual(chunk.sceneId, 's2'); assert.strictEqual(rollingState.locations.hero, '钟楼'); return '密室场景正文。'; } });
    assert.ok(resumed.ok);
    assert.strictEqual(resumed.reusedCount, 1);
    assert.strictEqual(resumed.generatedCount, 1);
    assert.strictEqual(calls, 3, 'resume must not regenerate completed chunks');
    const reopened = await runLongformGeneration({ projectPath, projectId: created.project.id, runId: 'longform-run', nodeId: 'draft', scenePlan, scenePlanRevisionId: 'plan-r1', constraintSnapshotId: 'locks-r1', generateChunk: async () => { throw new Error('must not run'); } });
    assert.strictEqual(reopened.reusedCount, 2);

    await runStore.createWorkflowV2Run(projectPath, { id: 'cancel-run', projectId: created.project.id, definition: { id: 'cancel-definition', templateId: 'continuation', templateVersion: 1, title: '取消', nodes: [{ id: 'draft', capabilityId: 'draft.longform' }] } });
    const cancelled = await runLongformGeneration({ projectPath, projectId: created.project.id, runId: 'cancel-run', nodeId: 'draft', scenePlan, generateChunk: async () => 'unused', shouldCancel: async () => true });
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual((await chunkStore.readChunkCheckpoint(projectPath, 'cancel-run', 'chunk-s1')).status, 'cancelled');
    console.log('Workflow longform service test passed.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
