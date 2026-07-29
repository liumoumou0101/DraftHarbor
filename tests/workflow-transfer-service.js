const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const Transfer = require('../desktop/services/workflow-transfer-service');
const { startDesktopServers } = require('../desktop/local-server');

async function writeText(projectPath, projectId, runId, artifactId, revisionId, text, extra = {}) {
  await artifactStore.writeArtifactRevision(projectPath, runId, {
    id: artifactId,
    projectId,
    runId,
    nodeId: 'draft',
    artifactType: 'draft-batch@1',
    title: extra.title || artifactId
  }, {
    id: revisionId,
    summary: extra.summary || revisionId,
    reviewState: extra.reviewState || 'approved',
    approvedAt: extra.reviewState === 'draft' ? '' : '2026-07-14T04:00:00.000Z',
    freshness: extra.freshness || 'fresh',
    payload: { format: 'text' }
  }, text);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-transfer-'));
  let servers = null;
  try {
    const created = await projectService.createProject(dataRoot, { id: 'transfer-project', title: 'Transfer' });
    const { project, projectPath } = created;
    const runId = 'transfer-run';
    await workflowV2Store.createWorkflowV2Run(projectPath, {
      id: runId,
      projectId: project.id,
      definition: { id: 'transfer-definition', templateId: 'continuation', templateVersion: 1, title: '转写', nodes: [{ id: 'draft', capabilityId: 'draft.batch' }] }
    });
    await writeText(projectPath, project.id, runId, 'draft-one', 'draft-r1', '第一场工作流正文。', { title: '第一场', summary: '开场摘要' });
    await writeText(projectPath, project.id, runId, 'draft-two', 'draft-r2', '第二版工作流正文。');
    await writeText(projectPath, project.id, runId, 'draft-stale', 'draft-stale-r1', '过期正文。', { freshness: 'stale' });

    const sceneInput = {
      sceneId: 'workflow-scene-1',
      chapterId: 'workflow-chapter-1',
      chapterTitle: '工作流章节',
      title: '转入写作区的场景',
      source: { runId, artifactId: 'draft-one', revisionId: 'draft-r1' }
    };
    const preview = await Transfer.previewWriterTransfer({ dataRoot, projectId: project.id, runId, scenes: [sceneInput] });
    assert.strictEqual(preview.counts.creates, 1);
    assert.strictEqual(preview.chapters[0].scenes[0].content, '第一场工作流正文。');
    assert.strictEqual((await projectService.openProject(dataRoot, project.id)).project.scenes.some((scene) => scene.id === 'workflow-scene-1'), false, 'preview must not write');

    const applied = await Transfer.applyWriterTransfer({
      dataRoot, projectId: project.id, runId, applicationId: 'writer-transfer-create', scenes: [sceneInput]
    });
    assert.ok(applied.ok);
    let opened = await projectService.openProject(dataRoot, project.id);
    let scene = opened.project.scenes.find((item) => item.id === 'workflow-scene-1');
    assert.strictEqual(scene.content, '第一场工作流正文。');
    assert.strictEqual(scene.sourceRevisionId, 'draft-r1');
    assert.strictEqual(opened.project.currentSceneId, 'workflow-scene-1', 'first transfer into an empty project should open the generated scene');

    const updatePreview = await Transfer.previewWriterTransfer({
      dataRoot, projectId: project.id, runId, scenes: [{
        mode: 'update', targetSceneId: scene.id, chapterId: scene.chapterId,
        source: { runId, artifactId: 'draft-two', revisionId: 'draft-r2' }
      }]
    });
    assert.strictEqual(updatePreview.counts.updates, 1);
    const updated = await Transfer.applyWriterTransfer({
      dataRoot, projectId: project.id, runId, applicationId: 'writer-transfer-update', scenes: [{
        mode: 'update', targetSceneId: scene.id, chapterId: scene.chapterId,
        source: { runId, artifactId: 'draft-two', revisionId: 'draft-r2' }
      }]
    });
    assert.ok(updated.ok);
    opened = await projectService.openProject(dataRoot, project.id);
    scene = opened.project.scenes.find((item) => item.id === 'workflow-scene-1');
    assert.strictEqual(scene.content, '第二版工作流正文。');
    assert.strictEqual(scene.sourceRevisionId, 'draft-r2');

    const excerptText = '第一场工作流正文。';
    const excerptStart = excerptText.indexOf('工作流');
    const excerptApplied = await Transfer.applyWriterTransfer({
      dataRoot, projectId: project.id, runId, applicationId: 'writer-transfer-excerpt', scenes: [{
        sceneId: 'excerpt-scene', chapterId: 'workflow-chapter-1', title: '精修片段',
        selection: { start: excerptStart, end: excerptStart + '工作流'.length },
        source: { runId, artifactId: 'draft-one', revisionId: 'draft-r1' }
      }]
    });
    assert.ok(excerptApplied.ok);
    const excerptScene = (await projectService.openProject(dataRoot, project.id)).project.scenes.find((item) => item.id === 'excerpt-scene');
    assert.strictEqual(excerptScene.content, '工作流');
    assert.ok(excerptScene.sourceArtifactId.startsWith('transfer-excerpt-'));
    assert.notStrictEqual(excerptScene.sourceRevisionId, 'draft-r1');

    await assert.rejects(() => Transfer.previewWriterTransfer({
      dataRoot, projectId: project.id, runId, scenes: [{ sceneId: 'stale-scene', chapterId: 'stale-chapter', source: { runId, artifactId: 'draft-stale', revisionId: 'draft-stale-r1' } }]
    }), /is stale/);

    const existing = (await compendiumService.saveEntry(dataRoot, project.id, {
      id: 'lin-card', type: 'character', title: '林岚', summary: '原摘要', tags: ['旧标签']
    })).entry;
    const candidates = [
      {
        id: 'suggest-update', matchedEntryId: existing.id,
        draft: { title: '林岚', summary: '新摘要', tags: ['调查员'], body: '禁止通过更新建议覆盖正文' },
        source: { runId, artifactId: 'draft-one', revisionId: 'draft-r1' }
      },
      {
        id: 'suggest-create',
        draft: { id: 'tower-card', type: 'location', title: '旧钟楼', summary: '新地点' },
        source: { runId, artifactId: 'draft-one', revisionId: 'draft-r1' }
      }
    ];
    const suggestionPreview = await Transfer.previewCompendiumSuggestions({ dataRoot, projectId: project.id, runId, candidates });
    assert.strictEqual(suggestionPreview.confirmed, false);
    assert.strictEqual(suggestionPreview.suggestions.length, 2);
    assert.ok(!Object.prototype.hasOwnProperty.call(suggestionPreview.suggestions[0].patch, 'body'));
    assert.strictEqual((await compendiumService.listEntries(dataRoot, project.id)).entries.length, 1, 'suggestion preview must not write');
    await assert.rejects(() => Transfer.applyConfirmedCompendiumSuggestions({
      dataRoot, projectId: project.id, runId, applicationId: 'no-confirmation', candidates
    }), /explicit confirmation/);

    const suggestionApply = await Transfer.applyConfirmedCompendiumSuggestions({
      dataRoot, projectId: project.id, runId, applicationId: 'confirmed-suggestions', candidates,
      confirmedSuggestionIds: ['suggest-update', 'suggest-create']
    });
    assert.ok(suggestionApply.ok);
    const entries = (await compendiumService.listEntries(dataRoot, project.id)).entries;
    assert.strictEqual(entries.find((entry) => entry.id === existing.id).summary, '新摘要');
    assert.strictEqual(entries.find((entry) => entry.id === existing.id).body, '', 'restricted update must preserve body');
    assert.ok(entries.some((entry) => entry.id === 'tower-card'));
    assert.ok(suggestionApply.application.operations.every((operation) => operation.result.targetId));

    const located = await Transfer.locateWorkflowAssets(dataRoot, project.id, { query: '第一场' });
    assert.ok(located.assets.some((asset) => asset.revisionId === 'draft-r1'));
    assert.ok(located.assets.every((asset) => asset.originModule === 'workflow'));

    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    const apiResponse = await fetch(`${servers.appUrl}/api/workflows/v2/preview-writer-transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        runId,
        scenes: [{
          sceneId: 'api-preview-scene', chapterId: 'api-preview-chapter',
          source: { runId, artifactId: 'draft-one', revisionId: 'draft-r1' }
        }]
      })
    });
    const apiPreview = await apiResponse.json();
    assert.ok(apiResponse.ok && apiPreview.ok);
    assert.strictEqual(apiPreview.scenes[0].scene.content, '第一场工作流正文。');
    assert.strictEqual((await projectService.openProject(dataRoot, project.id)).project.scenes.some((item) => item.id === 'api-preview-scene'), false);

    await artifactStore.writeArtifactRevision(projectPath, runId, {
      id: 'blocking-review',
      projectId: project.id,
      runId,
      nodeId: 'review',
      artifactType: 'draft-review@1',
      title: '阻断审查'
    }, {
      id: 'blocking-review-r1',
      reviewState: 'approved',
      approvedAt: '2026-07-29T00:00:00.000Z',
      payload: { format: 'json' }
    }, {
      kind: 'draft-review',
      qualityGate: 'blocked',
      findings: [{ type: 'process_label_leak', severity: 'major', evidence: '场景 6-1' }]
    });
    await assert.rejects(() => Transfer.previewWriterTransfer({
      dataRoot,
      projectId: project.id,
      runId,
      scenes: [sceneInput]
    }), (error) => error.code === 'WORKFLOW_QUALITY_GATE_BLOCKED' && /不能转入写作区/.test(error.message));

    console.log('Workflow transfer service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow transfer service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
