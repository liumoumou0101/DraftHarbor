const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const Rewrite = require('../desktop/services/workflow-rewrite-guided-service');
const Transfer = require('../desktop/services/workflow-transfer-service');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-rewrite-guided-'));
  let servers = null;
  try {
    const created = await projectService.createProject(dataRoot, { id: 'rewrite-guided-project', title: '大段重写测试' });
    await projectService.saveProject(dataRoot, {
      ...created.project,
      chapterOrder: ['chapter-1'], sceneOrder: ['s1', 's2'], currentSceneId: 's1',
      chapters: [{ ...created.project.chapters[0], id: 'chapter-1', title: '钟楼', sceneIds: ['s1', 's2'], order: 0 }],
      scenes: [
        { ...created.project.scenes[0], id: 's1', chapterId: 'chapter-1', title: '抵达', content: '雨下了很久。林岚终于抵达钟楼，并发现地上的足迹。', order: 0 },
        { ...created.project.scenes[0], id: 's2', chapterId: 'chapter-1', title: '密室', content: '暗门打开，林岚走进密室，看到一枚怀表。', order: 1 }
      ]
    });
    const base = { dataRoot, projectId: 'rewrite-guided-project', runId: 'rewrite-guided-run' };
    // Include writingInstructions: F-09.6H regression was latest(source) picking instructions over writer-source.
    const started = await Rewrite.startGuidedRewrite({
      ...base,
      scope: 'chapter',
      chapterId: 'chapter-1',
      brief: { instruction: '压缩开场并强化悬疑', preserve: ['怀表'] },
      writingInstructions: {
        text: '克制叙述',
        qualityTargets: { technicalRegisterMode: 'avoid', dialogueRatioEnabled: false }
      }
    });
    assert.ok(started.ok);
    let details = await Rewrite.getRewriteRun(dataRoot, base.projectId, base.runId);
    assert.strictEqual(details.run.activeNodeId, 'plan');
    const sourceSnapshot = Rewrite.sourceSnapshotArtifact(details.run.artifacts);
    const writing = Rewrite.writingInstructionsArtifact(details.run.artifacts);
    assert.ok(sourceSnapshot && sourceSnapshot.artifactType === 'writer-source@1');
    assert.strictEqual(sourceSnapshot.content.intent, 'rewrite');
    assert.ok(writing && writing.artifactType === 'workflow-writing-instructions@1');
    assert.notStrictEqual(sourceSnapshot.id, writing.id);

    let prepared = await Rewrite.prepareRewriteNode(base);
    assert.strictEqual(prepared.nodeId, 'plan');
    const plan = { strategy: '提速并增加机关阻力', units: [
      { id: 'arrival', sourceSceneId: 's1', targetSceneId: 's1', title: '抵达', objective: '尽快进入悬念', rules: [{ kind: 'compress', instruction: '压缩雨景' }], preserveFacts: ['发现足迹'] },
      { id: 'room', sourceSceneId: 's2', targetSceneId: 's2', title: '密室', objective: '增加进入代价', rules: [{ kind: 'expand', instruction: '增加机关' }], preserveFacts: ['发现怀表'] }
    ] };
    await Rewrite.completeRewriteNode({ ...base, outputs: [JSON.stringify(plan)] });
    await Rewrite.approveRewriteNode(base);

    prepared = await Rewrite.prepareRewriteNode(base);
    assert.strictEqual(prepared.nodeId, 'rewrite');
    assert.strictEqual(prepared.prompts.length, 2);
    await Rewrite.completeRewriteNode({ ...base, outputs: ['林岚冲进钟楼，湿漉的足迹通向暗门。', '齿轮机关落下，林岚避开后闯入密室，拾起怀表。'], outputTitles: prepared.prompts.map((item) => item.title) });
    await Rewrite.approveRewriteNode(base);

    prepared = await Rewrite.prepareRewriteNode(base);
    assert.strictEqual(prepared.nodeId, 'repair');
    assert.strictEqual(prepared.prompts.length, 2);
    await Rewrite.completeRewriteNode({ ...base, outputs: ['林岚冲进钟楼，湿漉的足迹一路通向暗门。', '循着足迹，林岚触发齿轮机关，避开后闯入密室并拾起怀表。'], outputTitles: prepared.prompts.map((item) => item.title) });
    details = await Rewrite.getRewriteRun(dataRoot, base.projectId, base.runId);
    const comparison = details.run.artifacts.find((artifact) => artifact.artifactType === 'rewrite-comparison@1');
    assert.strictEqual(comparison.content.comparisons.length, 2);
    assert.strictEqual(comparison.revision.reviewState, 'approved');
    await Rewrite.approveRewriteNode(base);

    prepared = await Rewrite.prepareRewriteNode(base);
    assert.strictEqual(prepared.nodeId, 'review');
    details = await Rewrite.completeRewriteNode({ ...base, outputs: [JSON.stringify({ summary: '重写符合计划', findings: [] })] });
    assert.strictEqual(details.run.activeNodeId, 'transfer');
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'review').content.comparisonSummary.length, 2);
    const repaired = details.run.artifacts.filter((artifact) => artifact.nodeId === 'repair' && artifact.artifactType === 'rewrite-text@1');
    const transferScenes = repaired.map((artifact, index) => ({
      mode: 'update', targetSceneId: index === 0 ? 's1' : 's2',
      source: { runId: base.runId, artifactId: artifact.id, revisionId: artifact.revision.id }
    }));
    const preview = await Transfer.previewWriterTransfer({ ...base, scenes: transferScenes });
    assert.strictEqual(preview.counts.updates, 2);
    await Transfer.applyWriterTransfer({ ...base, applicationId: 'rewrite-apply', scenes: transferScenes });
    details = await Rewrite.completeRewriteTransfer({ ...base, applicationId: 'rewrite-transfer' });
    assert.strictEqual(details.run.status, 'completed');
    const rewrittenProject = (await projectService.openProject(dataRoot, base.projectId)).project;
    assert.ok(rewrittenProject.scenes.find((scene) => scene.id === 's1').content.includes('足迹一路通向暗门'));

    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    const response = await fetch(`${servers.appUrl}/api/workflows/v2/start-rewrite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: base.projectId, runId: 'rewrite-http-run', scope: 'scene', sceneId: 's1', brief: { instruction: '强化场景冲突' } })
    });
    const body = await response.json();
    assert.strictEqual(body.ok, true, body.error);
    const getResponse = await fetch(`${servers.appUrl}/api/workflows/v2/rewrite-run?projectId=${base.projectId}&runId=rewrite-http-run`);
    const fetched = await getResponse.json();
    assert.strictEqual(fetched.run.templateId, 'rewrite-guided');
    const prepareResponse = await fetch(`${servers.appUrl}/api/workflows/v2/prepare-rewrite-node`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: base.projectId, runId: 'rewrite-http-run' })
    });
    assert.strictEqual((await prepareResponse.json()).nodeId, 'plan');
    console.log('Workflow rewrite guided service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => { console.error('Workflow rewrite guided service test failed:', error && error.stack ? error.stack : error); process.exit(1); });
