const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const Guided = require('../desktop/services/workflow-guided-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-guided-workflow-'));
  try {
    const created = await projectService.createProject(dataRoot, { id: 'guided-project', title: 'Guided' });
    const chapterId = created.project.chapters[0].id;
    const sceneId = created.project.scenes[0].id;
    await projectService.saveProject(dataRoot, {
      ...created.project,
      scenes: created.project.scenes.map((scene) => scene.id === sceneId
        ? { ...scene, content: '林岚在旧钟楼发现一枚停止转动的怀表。', summary: '发现怀表' }
        : scene)
    });

    const empty = await projectService.createProject(dataRoot, { id: 'empty-guided-project', title: '空正文' });
    await assert.rejects(
      () => Guided.startGuidedContinuation({ dataRoot, projectId: empty.project.id, runId: 'empty-run', scope: 'project' }),
      /续写来源没有正文内容/
    );
    const emptyRunsPath = path.join(empty.projectPath, 'workflows', 'v2', 'runs');
    const emptyRuns = await fs.readdir(emptyRunsPath).catch(() => []);
    assert.strictEqual(emptyRuns.length, 0, 'empty continuation must not leave an orphan run');

    const started = await Guided.startGuidedContinuation({
      dataRoot,
      projectId: created.project.id,
      runId: 'guided-run',
      scope: 'chapter',
      chapterId,
      brief: '续写钟楼谜案，保持悬疑感。',
      constraints: [{ id: 'no-supernatural', kind: 'exclusion', text: '不要引入超自然设定', enforcement: 'hard' }]
    });
    assert.ok(started.ok);
    let details = await Guided.getGuidedRun(dataRoot, created.project.id, 'guided-run');
    assert.strictEqual(details.run.activeNodeId, 'analysis');
    assert.strictEqual(details.run.steps.find((step) => step.id === 'source').status, 'completed');
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'source').content.characterCount > 0, true);

    const analysisPrepared = await Guided.prepareGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run' });
    assert.strictEqual(analysisPrepared.nodeId, 'analysis');
    assert.ok(JSON.stringify(analysisPrepared.prompts[0].prompt).includes('旧钟楼'));
    await Guided.completeGuidedNode({
      dataRoot, projectId: created.project.id, runId: 'guided-run',
      outputs: [JSON.stringify({ hierarchicalSummary: { projectSummary: '林岚调查钟楼' }, outline: ['发现怀表'], characterCandidates: [{ title: '林岚' }] })]
    });
    details = await Guided.getGuidedRun(dataRoot, created.project.id, 'guided-run');
    assert.strictEqual(details.run.steps.find((step) => step.id === 'analysis').status, 'waiting_user');
    await Guided.approveGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run' });
    details = await Guided.getGuidedRun(dataRoot, created.project.id, 'guided-run');
    assert.strictEqual(details.run.activeNodeId, 'direction');
    const approvedAnalysisRevisionId = details.run.artifacts.find((artifact) => artifact.nodeId === 'analysis').revision.id;
    details = await Guided.restartGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run', nodeId: 'analysis', reason: '测试上游重跑' });
    assert.strictEqual(details.run.activeNodeId, 'analysis');
    assert.strictEqual(details.run.steps.find((step) => step.id === 'direction').status, 'pending');
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'analysis').effectiveFreshness, 'stale');
    await Guided.completeGuidedNode({
      dataRoot, projectId: created.project.id, runId: 'guided-run',
      outputs: [JSON.stringify({ hierarchicalSummary: { projectSummary: '林岚重新调查钟楼' }, outline: ['发现怀表', '确认倒计时'], characterCandidates: [{ title: '林岚' }] })]
    });
    details = await Guided.getGuidedRun(dataRoot, created.project.id, 'guided-run');
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'analysis').revision.parentRevisionId, approvedAnalysisRevisionId);
    await Guided.approveGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run' });
    const directionPrepared = await Guided.prepareGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run' });
    assert.ok(JSON.stringify(directionPrepared.prompts[0].prompt).includes('不要引入超自然设定'));
    assert.ok(JSON.stringify(directionPrepared.prompts[0].prompt).includes('不得作为候选'));

    await Guided.completeGuidedNode({
      dataRoot, projectId: created.project.id, runId: 'guided-run',
      outputs: [JSON.stringify({ directions: [
        { id: 'clock', title: '怀表倒计时', premise: '怀表开始倒计时。', plotFocus: '钟楼', emotionalArc: '疑惑到恐惧', risks: [] },
        { id: 'letter', title: '密信', premise: '怀表内藏有密信。', plotFocus: '失踪案', emotionalArc: '希望到怀疑', risks: [] }
      ] })]
    });
    await Guided.approveGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run', selectedDirectionIds: ['clock'] });
    details = await Guided.getGuidedRun(dataRoot, created.project.id, 'guided-run');
    assert.deepStrictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'direction').content.selectedDirectionIds, ['clock']);

    const planOutput = JSON.stringify({ fineOutlineEnabled: true, scenes: [
      { id: 'scene-a', title: '午夜回响', povCharacter: '林岚', location: '旧钟楼', goal: '启动怀表', conflict: '齿轮反转', outcome: '暗门开启', emotionalBeat: '恐惧', fineOutline: ['登塔', '启动怀表'] },
      { id: 'scene-b', title: '暗门之后', povCharacter: '林岚', location: '密室', goal: '寻找线索', conflict: '脚步逼近', outcome: '取得密信', emotionalBeat: '紧张', fineOutline: ['进入密室', '取走密信'] }
    ] });
    await Guided.completeGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run', outputs: [planOutput] });
    details = await Guided.getGuidedRun(dataRoot, created.project.id, 'guided-run');
    const planArtifact = details.run.artifacts.find((artifact) => artifact.nodeId === 'plan');
    const revised = await Guided.reviseArtifact({
      dataRoot, projectId: created.project.id, runId: 'guided-run', artifactId: planArtifact.id,
      parentRevisionId: planArtifact.revision.id, content: planOutput, summary: '用户确认前修改'
    });
    assert.strictEqual(revised.artifact.revision.parentRevisionId, planArtifact.revision.id);
    await Guided.approveGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run' });

    const draftPrepared = await Guided.prepareGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run' });
    assert.strictEqual(draftPrepared.prompts.length, 2);
    await Guided.completeGuidedNode({
      dataRoot, projectId: created.project.id, runId: 'guided-run',
      outputs: ['午夜，林岚登上钟楼，怀表的秒针突然逆转。', '暗门开启后，密室深处传来逐渐逼近的脚步声。'],
      outputTitles: draftPrepared.prompts.map((prompt) => prompt.title)
    });
    await Guided.approveGuidedNode({ dataRoot, projectId: created.project.id, runId: 'guided-run' });
    details = await Guided.completeGuidedNode({
      dataRoot, projectId: created.project.id, runId: 'guided-run',
      outputs: [JSON.stringify({ summary: '存在一项动机问题', findings: [{ type: 'motivation_gap', severity: 'medium', sceneTitle: '暗门之后', evidence: '人物突然独自行动', suggestion: '补充决定过程' }] })]
    });
    assert.strictEqual(details.run.activeNodeId, 'transfer');
    assert.ok(details.run.artifacts.some((artifact) => artifact.nodeId === 'review' && artifact.content.findings.some((finding) => finding.source === 'ai-semantic-review')));

    details = await Guided.completeGuidedTransfer({ dataRoot, projectId: created.project.id, runId: 'guided-run', applicationId: 'test-transfer' });
    assert.strictEqual(details.run.status, 'completed');
    assert.strictEqual(details.run.activeNodeId, '');

    console.log('Workflow guided service test passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow guided service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
