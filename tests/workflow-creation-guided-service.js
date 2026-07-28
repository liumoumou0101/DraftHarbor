const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const eventStore = require('../desktop/storage/workflow-event-store-v2');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-creation-guided-'));
  let servers = null;
  try {
    const created = await projectService.createProject(dataRoot, { id: 'creation-guided-project', title: '从零创作测试' });
    const base = { dataRoot, projectId: created.project.id, runId: 'creation-guided-run' };
    const started = await Creation.startGuidedCreation({
      ...base,
      brief: { title: '潮汐档案', premise: '失忆潜水员寻找自己的死亡记录。', genre: '科幻悬疑', targetWords: 180000 },
      constraints: [{ kind: 'exclusion', text: '不要用梦境解释一切', enforcement: 'hard', weight: 5 }]
    });
    assert.ok(started.ok);
    let details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    assert.strictEqual(details.run.activeNodeId, 'direction');
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'brief').revision.reviewState, 'approved');
    await Creation.completeCreationNode({
      ...base,
      generationFailure: {
        code: 'json_repair_output_limit',
        message: 'JSON truncated',
        repairAttempted: true,
        outputs: [{ promptId: 'creation-directions', characters: 2306, tail: '"unfinished', finishReason: 'length' }]
      }
    });
    const diagnosticEvents = await eventStore.listWorkflowV2Events(created.projectPath, base.runId);
    const failureEvent = diagnosticEvents.find((event) => event.type === 'guided_node_generation_failed');
    assert.ok(failureEvent, 'generation failures should be persisted as workflow diagnostics');
    assert.strictEqual(failureEvent.payload.outputs[0].finishReason, 'length');
    assert.strictEqual(failureEvent.payload.outputs[0].characters, 2306);

    const directions = { directions: [
      { id: 'identity', title: '身份谜案', premise: '追查多个自己的来源。' },
      { id: 'city', title: '城市阴谋', premise: '揭露 AI 篡改集体记忆。' }
    ] };
    let prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'direction');
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(directions)] });
    const selectedDirectionIds = ['identity'];
    await Creation.approveCreationNode({ ...base, selectedDirectionIds });

    details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    assert.deepStrictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'direction').content.selectedDirectionIds, selectedDirectionIds);
    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'blueprint');
    const blueprint = {
      title: '回声方案', logline: '她必须证明自己不是复制品。',
      centralConflict: { protagonistGoal: '找回记录', opposingForce: '管理 AI', stakes: '幸存者身份', dilemma: '真相会摧毁共同记忆' },
      acts: [{ title: '下潜', purpose: '进入沉城', turningPoint: '发现自己的墓碑' }]
    };
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(blueprint)] });
    const blueprintBeforeCancel = (await Creation.getCreationRun(dataRoot, created.project.id, base.runId))
      .run.artifacts.find((artifact) => artifact.nodeId === 'blueprint');
    details = await Creation.cancelCreationRun(base);
    assert.strictEqual(details.run.status, 'cancelled');
    assert.strictEqual(details.run.activeNodeId, '');
    details = await Creation.resumeCreationRun(base);
    assert.strictEqual(details.run.status, 'in_progress');
    assert.strictEqual(details.run.activeNodeId, 'blueprint');
    assert.strictEqual(details.run.steps.find((step) => step.id === 'blueprint').status, 'waiting_user');
    assert.strictEqual(
      details.run.artifacts.find((artifact) => artifact.nodeId === 'blueprint').revision.id,
      blueprintBeforeCancel.revision.id,
      'resuming must preserve the generated artifact revision'
    );
    await Creation.approveCreationNode(base);

    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'compendium');
    assert.strictEqual(prepared.prompts.length, 2, 'compendium generation should be split into character and world batches');
    const cards = { cards: [
      { type: 'character', title: '苏晚', summary: '失忆潜水员', characterProfile: { role: '主角', goal: '找回记录', motivation: '证明存在' } },
      { type: 'location', title: '潮汐城', summary: '周期性被海水淹没的城市' }
    ] };
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(cards)] });
    details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    const cardArtifact = details.run.artifacts.find((artifact) => artifact.nodeId === 'compendium');
    const revised = await Creation.reviseCreationArtifact({
      ...base, artifactId: cardArtifact.id, parentRevisionId: cardArtifact.revision.id,
      content: JSON.stringify({ cards: cards.cards.map((card) => card.title === '苏晚' ? { ...card, aliases: ['小晚'] } : card) }),
      summary: '补充人物别名'
    });
    assert.strictEqual(revised.artifact.revision.parentRevisionId, cardArtifact.revision.id);
    await Creation.approveCreationNode(base);

    const plan = { scenes: [
      { id: 'dive', title: '第一次下潜', goal: '进入城市', conflict: '氧气泄漏', pace: 'fast', conflictIntensity: 82, targetWords: 4000, fineOutline: ['穿过闸门', '发现墓碑'] },
      { id: 'archive', title: '死亡档案', goal: '读取记录', conflict: 'AI 封锁', pace: 'medium', conflictIntensity: 68, targetWords: 3800, fineOutline: ['潜入档案馆', '读取记录'] }
    ] };
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(plan)] });
    await Creation.approveCreationNode(base);

    prepared = await Creation.prepareCreationNode({ ...base, selectedDirectionIds });
    assert.strictEqual(prepared.nodeId, 'draft');
    assert.strictEqual(prepared.prompts.length, 2);
    await Creation.completeCreationNode({ ...base, outputs: ['苏晚穿过灌满海水的闸门。', '档案馆里保存着她的死亡记录。'], outputTitles: prepared.prompts.map((prompt) => prompt.title) });
    await Creation.approveCreationNode(base);

    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'review');
    details = await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify({ summary: '需要补强动机', findings: [{ type: 'motivation_gap', severity: 'medium', sceneTitle: '死亡档案', evidence: '直接冒险', suggestion: '补充选择过程' }, { type: 'constraint', severity: 'pass', sceneTitle: '死亡档案', evidence: '约束通过', suggestion: '无' }] })] });
    assert.strictEqual(details.run.activeNodeId, 'transfer');
    assert.ok(details.run.artifacts.find((artifact) => artifact.nodeId === 'review').content.findings.some((finding) => finding.source === 'ai-semantic-review'));
    assert.ok(!details.run.artifacts.find((artifact) => artifact.nodeId === 'review').content.findings.some((finding) => finding.severity === 'pass'));

    details = await Creation.completeCreationTransfer({ ...base, applicationId: 'creation-transfer' });
    assert.strictEqual(details.run.status, 'completed');
    assert.strictEqual(details.run.activeNodeId, '');

    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    const startResponse = await fetch(`${servers.appUrl}/api/workflows/v2/start-creation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: created.project.id, runId: 'creation-http-run', brief: { title: '接口新作', premise: '一名邮差向不存在的城市送信。' } })
    });
    const httpStarted = await startResponse.json();
    assert.strictEqual(httpStarted.ok, true, httpStarted.error);
    const runResponse = await fetch(`${servers.appUrl}/api/workflows/v2/creation-run?projectId=${created.project.id}&runId=creation-http-run`);
    const httpRun = await runResponse.json();
    assert.strictEqual(httpRun.run.activeNodeId, 'direction');
    const prepareResponse = await fetch(`${servers.appUrl}/api/workflows/v2/prepare-creation-node`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: created.project.id, runId: 'creation-http-run' })
    });
    const httpPrepared = await prepareResponse.json();
    assert.strictEqual(httpPrepared.nodeId, 'direction');

    console.log('Workflow creation guided service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow creation guided service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
