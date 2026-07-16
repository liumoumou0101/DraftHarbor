const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const VariantService = require('../desktop/services/workflow-variant-service');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-variant-'));
  let servers = null;
  try {
    const created = await projectService.createProject(dataRoot, { id: 'variant-project', title: '版本测试' });
    const projectPath = created.projectPath;
    await runStore.createWorkflowV2Run(projectPath, { id: 'variant-run', projectId: created.project.id, definition: { id: 'variant-definition', templateId: 'rewrite-guided', templateVersion: 1, title: '版本', nodes: [{ id: 'repair', capabilityId: 'rewrite.repair' }] } });
    for (const [index, text] of ['钟楼初版正文。', '密室初版正文。'].entries()) {
      await artifactStore.writeArtifactRevision(projectPath, 'variant-run', {
        id: `scene-${index + 1}`, projectId: created.project.id, runId: 'variant-run', nodeId: 'repair', artifactType: 'rewrite-text@1', title: `场景 ${index + 1}`
      }, { id: `main-r${index + 1}`, variantId: 'main', reviewState: 'approved', approvedAt: new Date().toISOString(), payload: { format: 'text' } }, text);
    }
    const createdVariant = await VariantService.createTextVariant({
      projectPath, projectId: created.project.id, runId: 'variant-run', variantId: 'conflict', label: '强化冲突版', nodeId: 'repair',
      items: [
        { scopeKey: 's1', targetSceneId: 's1', artifactId: 'scene-1', parentRevisionId: 'main-r1', text: '钟楼强化冲突后的正文。' },
        { scopeKey: 's2', targetSceneId: 's2', artifactId: 'scene-2', parentRevisionId: 'main-r2', text: '密室强化冲突后的正文。' }
      ]
    });
    assert.strictEqual(createdVariant.variant.items.length, 2);
    assert.ok(createdVariant.variant.items.every((item) => item.revisionId.includes('conflict-r')));
    const approved = await VariantService.approveTextVariant({ projectPath, projectId: created.project.id, runId: 'variant-run', variantId: 'conflict' });
    assert.strictEqual(approved.variant.items.length, 2);
    assert.ok((await artifactStore.readArtifactRevision(projectPath, 'variant-run', 'scene-1', approved.variant.items[0].revisionId)).reviewState === 'approved');
    const main = { variantId: 'main', label: '初版', runId: 'variant-run', templateId: 'rewrite-guided', nodeId: 'repair', items: [
      { scopeKey: 's1', targetSceneId: 's1', artifactId: 'scene-1', revisionId: 'main-r1' },
      { scopeKey: 's2', targetSceneId: 's2', artifactId: 'scene-2', revisionId: 'main-r2' }
    ] };
    const compared = await VariantService.compareTextVariants({ projectPath, runId: 'variant-run', left: main, right: approved.variant });
    assert.strictEqual(compared.comparison.scopes.length, 2);
    assert.ok(compared.comparison.scopes.every((scope) => scope.diff.counts.inserted > 0));
    const mixed = VariantService.createTransferSelection({ runId: 'variant-run', selections: [{ scopeKey: 's1', variantId: 'conflict' }, { scopeKey: 's2', variantId: 'main' }] }, [main, approved.variant]);
    assert.strictEqual(mixed[0].source.revisionId, approved.variant.items[0].revisionId);
    assert.strictEqual(mixed[1].source.revisionId, 'main-r2');
    const capturedMain = await VariantService.ensureMainVariant({ dataRoot, projectId: created.project.id, runId: 'variant-run' });
    assert.deepStrictEqual(capturedMain.variant.items.map((item) => item.revisionId), ['main-r1', 'main-r2']);
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    const listResponse = await fetch(`${servers.appUrl}/api/workflows/v2/variants?projectId=${created.project.id}&runId=variant-run`);
    assert.ok((await listResponse.json()).variants.some((variant) => variant.variantId === 'main'));
    const prepareResponse = await fetch(`${servers.appUrl}/api/workflows/v2/prepare-variant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: created.project.id, runId: 'variant-run', variantId: 'api-alt', label: 'API 替代版', instruction: '强化倒计时压力' }) });
    const prepared = await prepareResponse.json();
    assert.strictEqual(prepared.prompts.length, 2);
    const completeResponse = await fetch(`${servers.appUrl}/api/workflows/v2/complete-variant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: created.project.id, runId: 'variant-run', variantId: prepared.variantId, label: prepared.label, instruction: '强化倒计时压力', outputs: ['API 钟楼替代正文。', 'API 密室替代正文。'] }) });
    assert.strictEqual((await completeResponse.json()).ok, true);
    const approveResponse = await fetch(`${servers.appUrl}/api/workflows/v2/approve-variant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: created.project.id, runId: 'variant-run', variantId: 'api-alt' }) });
    assert.strictEqual((await approveResponse.json()).ok, true);
    const compareResponse = await fetch(`${servers.appUrl}/api/workflows/v2/compare-variants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: created.project.id, runId: 'variant-run', leftVariantId: 'main', rightVariantId: 'api-alt' }) });
    assert.strictEqual((await compareResponse.json()).comparison.scopes.length, 2);
    console.log('Workflow variant service test passed.');
  } finally { if (servers) servers.close(); await fs.rm(dataRoot, { recursive: true, force: true }); }
})().catch((error) => { console.error('Workflow variant service test failed:', error && error.stack ? error.stack : error); process.exit(1); });
