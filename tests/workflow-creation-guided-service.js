const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const eventStore = require('../desktop/storage/workflow-event-store-v2');
const { startDesktopServers } = require('../desktop/local-server');

const GLOBAL_PROMPT_SENTINEL = 'WORKFLOW-GLOBAL-PROMPT-SENTINEL';
const WRITING_INSTRUCTION_SENTINEL = '使用克制的第三人称限知';
function assertPreparedGlobalContext(prepared, label) {
  prepared.prompts.forEach((item) => {
    const payload = JSON.parse(item.prompt.messages[1].content);
    assert.strictEqual(payload.globalContext.globalPrompt, GLOBAL_PROMPT_SENTINEL, `${label} should receive frozen global prompt`);
    assert.ok(payload.globalContext.writingInstructions.text.includes(WRITING_INSTRUCTION_SENTINEL), `${label} should receive writing instructions`);
  });
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-creation-guided-'));
  let servers = null;
  try {
    const created = await projectService.createProject(dataRoot, { id: 'creation-guided-project', title: '从零创作测试' });
    const base = { dataRoot, projectId: created.project.id, runId: 'creation-guided-run' };
    const started = await Creation.startGuidedCreation({
      ...base,
      brief: { title: '潮汐档案', premise: '失忆潜水员寻找自己的死亡记录。', genre: '科幻悬疑', targetWords: 180000 },
      writingInstructions: {
        text: `${WRITING_INSTRUCTION_SENTINEL}，减少解释性旁白。`,
        dialogueRatio: '约 30%',
        mustAvoid: ['连续堆砌比喻']
      },
      generationPolicy: {
        providerProfileId: 'inherit',
        snapshot: { globalPrompt: GLOBAL_PROMPT_SENTINEL }
      },
      constraints: [{ kind: 'exclusion', text: '不要用梦境解释一切', enforcement: 'hard', weight: 5 }]
    });
    assert.ok(started.ok);
    let details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    assert.strictEqual(details.run.activeNodeId, 'direction');
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.artifactType === 'creation-brief@1').revision.reviewState, 'approved');
    const initialInstructions = details.run.artifacts.find((artifact) => artifact.artifactType === 'workflow-writing-instructions@1');
    assert.ok(initialInstructions);
    assert.strictEqual(initialInstructions.content.dialogueRatio, '约 30%');
    assert.strictEqual(details.run.batches[0].writingInstructionRef.revisionId, initialInstructions.revision.id);
    assert.strictEqual(details.run.activeBatchId, 'batch-0001');
    assert.strictEqual(details.run.batches.length, 1);
    assert.strictEqual(details.run.batches[0].status, 'planning');
    assert.strictEqual(details.run.batches[0].legacy, false);
    assert.strictEqual(details.run.generationProgress.targetCharacters, 180000);
    assert.ok(!details.run.artifacts.some((artifact) => artifact.artifactType === 'generation-batch@1'), 'internal batch manifests must not pollute editable artifacts');
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
    assertPreparedGlobalContext(prepared, 'direction');
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(directions)] });
    const selectedDirectionIds = ['identity'];
    await Creation.approveCreationNode({ ...base, selectedDirectionIds });

    details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    assert.deepStrictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'direction').content.selectedDirectionIds, selectedDirectionIds);
    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'blueprint');
    assertPreparedGlobalContext(prepared, 'blueprint');
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
    assertPreparedGlobalContext(prepared, 'compendium');
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
      { id: 'dive', title: '第一次下潜', goal: '进入城市', conflict: '氧气泄漏', outcome: '穿过闸门', mustInclude: ['记住盐印规则'], pace: 'fast', conflictIntensity: 82, targetWords: 4000, fineOutline: ['穿过闸门', '发现墓碑'] },
      { id: 'archive', title: '死亡档案', goal: '读取记录', conflict: 'AI 封锁', outcome: '取得死亡记录', mustInclude: ['藏好副本'], pace: 'medium', conflictIntensity: 68, targetWords: 3800, fineOutline: ['潜入档案馆', '读取记录'] }
    ] };
    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'plan');
    assertPreparedGlobalContext(prepared, 'plan');
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(plan)] });
    details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'plan').targetRef.batchId, 'batch-0001');
    await Creation.approveCreationNode(base);

    prepared = await Creation.prepareCreationNode({ ...base, selectedDirectionIds });
    assert.strictEqual(prepared.nodeId, 'draft');
    assert.strictEqual(prepared.prompts.length, 1);
    assert.strictEqual(prepared.remainingCount, 2);
    assertPreparedGlobalContext(prepared, 'draft');
    assert.ok(prepared.contextReport, 'F-09.6J draft prepare should expose contextReport');
    assert.ok(prepared.usageHint && prepared.usageHint.label, 'F-09.6J draft prepare should expose usageHint label');
    assert.ok(prepared.usageHint.source === 'estimate' || prepared.usageHint.source === 'provider' || prepared.usageHint.source === 'unavailable');
    assert.ok(!String(prepared.usageHint.label).includes('0 tokens（接口'), 'must not fake zero provider tokens');
    assert.ok(prepared.contextReport.assembledChars <= prepared.contextReport.rawChars, 'assembled context should not exceed raw dump');
    const firstDraftPayload = JSON.parse(prepared.prompts[0].prompt.messages[1].content);
    assert.ok(firstDraftPayload.selectedDirection, 'draft prepare must merge directions into selectedDirection (assembly keeps directions)');
    await Creation.completeCreationNode({
      ...base,
      outputs: ['守门人说，盐印不得离开港区，否则会立刻碎裂。苏晚记住规则，穿过灌满海水的闸门。'],
      outputIndexes: [prepared.prompts[0].outputIndex],
      outputTitles: [prepared.prompts[0].title],
      partial: true
    });
    prepared = await Creation.prepareCreationNode({ ...base, selectedDirectionIds });
    assert.strictEqual(prepared.prompts.length, 1);
    assert.strictEqual(prepared.remainingCount, 1);
    assert.strictEqual(prepared.prompts[0].outputIndex, 1);
    const secondDraftPayload = JSON.parse(prepared.prompts[0].prompt.messages[1].content);
    assert.ok(secondDraftPayload.batchContext.currentBatch.lastSceneEnding.includes('闸门'));
    assert.ok(secondDraftPayload.batchContext.currentBatch.completedScenes[0].factAnchors.some((item) => item.includes('盐印不得离开港区')));
    assert.ok(secondDraftPayload.selectedDirection, 'second draft scene must still merge selectedDirection');
    await Creation.completeCreationNode({
      ...base,
      outputs: ['档案馆里保存着她的死亡记录。场景 6-1 的计划要求已经完成。'],
      outputIndexes: [prepared.prompts[0].outputIndex],
      outputTitles: [prepared.prompts[0].title]
    });
    details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    const firstBatchDrafts = details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft');
    assert.deepStrictEqual(firstBatchDrafts.map((artifact) => artifact.targetRef.batchId), ['batch-0001', 'batch-0001']);
    assert.deepStrictEqual(firstBatchDrafts.map((artifact) => artifact.targetRef.sceneId), ['dive', 'archive']);
    assert.deepStrictEqual(firstBatchDrafts.map((artifact) => artifact.title), ['第一次下潜', '死亡档案']);
    assert.strictEqual(details.run.batches[0].batchCharacters, '守门人说，盐印不得离开港区，否则会立刻碎裂。苏晚记住规则，穿过灌满海水的闸门。'.length + '档案馆里保存着她的死亡记录。场景 6-1 的计划要求已经完成。'.length);
    await Creation.approveCreationNode(base);

    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'review');
    assertPreparedGlobalContext(prepared, 'review');
    const reviewPayload = JSON.parse(prepared.prompts[0].prompt.messages[1].content);
    assert.ok(reviewPayload.drafts.every((draft) => draft.sceneId && draft.revisionId));
    assert.ok(reviewPayload.reviewRequirements.planFulfillmentChecklist.length >= 2);
    details = await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify({ summary: '需要补强动机', findings: [{ type: 'motivation_gap', severity: 'medium', sceneTitle: '死亡档案', evidence: '直接冒险', suggestion: '补充选择过程' }, { type: 'constraint', severity: 'pass', sceneTitle: '死亡档案', evidence: '约束通过', suggestion: '无' }] })] });
    assert.strictEqual(details.run.activeNodeId, 'transfer');
    assert.ok(details.run.artifacts.find((artifact) => artifact.nodeId === 'review').content.findings.some((finding) => finding.source === 'ai-semantic-review'));
    assert.ok(!details.run.artifacts.find((artifact) => artifact.nodeId === 'review').content.findings.some((finding) => finding.severity === 'pass'));
    assert.strictEqual(details.run.artifacts.find((artifact) => artifact.nodeId === 'review').targetRef.batchId, 'batch-0001');
    assert.strictEqual(details.run.batches[0].status, 'waiting_decision');
    assert.ok(details.run.batches[0].rollingStateRef.artifactId);

    let nextPreview = await Creation.previewNextCreationBatch(base);
    assert.strictEqual(nextPreview.qualityGateBlocked, true);
    const approvedFirstBatchDrafts = details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft');
    const preservedDiveRevisionId = approvedFirstBatchDrafts.find((artifact) => artifact.targetRef.sceneId === 'dive').revision.id;
    const originalArchive = approvedFirstBatchDrafts.find((artifact) => artifact.targetRef.sceneId === 'archive');
    details = await Creation.restartCreationNode({
      ...base,
      nodeId: 'draft',
      sceneIds: ['archive'],
      userInstruction: '删除创作过程标签，从已经取得死亡记录的事实继续。'
    });
    assert.strictEqual(details.run.activeNodeId, 'draft');
    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.prompts[0].outputIndex, 1, 'targeted repair should prepare only the invalidated scene');
    const repairPayload = JSON.parse(prepared.prompts[0].prompt.messages[1].content);
    assert.ok(repairPayload.batchContext.repairReview.findings.some((finding) => finding.type === 'process_label_leak'));
    await Creation.completeCreationNode({
      ...base,
      outputs: ['档案馆里保存着她的死亡记录，她把副本藏进潜水服内层。'],
      outputIndexes: [prepared.prompts[0].outputIndex],
      outputTitles: [prepared.prompts[0].title]
    });
    await Creation.approveCreationNode(base);
    await Creation.completeCreationNode({
      ...base,
      outputs: [JSON.stringify({
        summary: '过程标签已清理',
        findings: [{ type: 'motivation_gap', severity: 'medium', sceneId: 'archive', evidence: '仍可补强', suggestion: '后续推进' }],
        continuityState: {
          summary: '过程标签已清理，副本已入内层。',
          lastEnding: '档案馆里保存着她的死亡记录，她把副本藏进潜水服内层。',
          characterStates: { 苏晚: { status: '持副本' } },
          knownFacts: ['死亡记录已取出'],
          unresolvedThreads: [
            { threadId: 'death-record-copy', label: '死亡记录副本', status: 'open', mustClose: true, evidence: '藏进潜水服内层' }
          ]
        }
      })]
    });
    details = await Creation.getCreationRun(dataRoot, created.project.id, base.runId);
    assert.strictEqual(
      details.run.artifacts.find((artifact) => artifact.nodeId === 'draft' && artifact.targetRef.sceneId === 'dive').revision.id,
      preservedDiveRevisionId,
      'targeted repair must preserve unaffected scene revisions'
    );
    const repairedArchive = details.run.artifacts.find((artifact) => artifact.nodeId === 'draft' && artifact.targetRef.sceneId === 'archive');
    assert.notStrictEqual(repairedArchive.revision.id, originalArchive.revision.id);
    const archiveHistory = await Creation.getCreationArtifactHistory({ ...base, artifactId: repairedArchive.id });
    assert.ok(archiveHistory.revisions.length >= 4, 'targeted repair must preserve generated, approved and repaired revisions in history');
    nextPreview = await Creation.previewNextCreationBatch(base);
    assert.strictEqual(nextPreview.qualityGateBlocked, false);
    assert.strictEqual(nextPreview.nextBatch.batchId, 'batch-0002');
    assert.strictEqual(nextPreview.requiresMajorAcknowledgement, false);
    const revisedInstructions = await Creation.reviseCreationArtifact({
      ...base,
      artifactId: initialInstructions.id,
      parentRevisionId: initialInstructions.revision.id,
      content: JSON.stringify({
        ...initialInstructions.content,
        text: '使用克制的第三人称限知，下一批进一步减少解释性旁白。'
      }),
      summary: '调整下一批写作要求'
    });
    details = await Creation.continueCreationBatch({ ...base, userInstruction: '下一批增加主角主动选择，并减少解释。' });
    assert.deepStrictEqual(details.run.batches.map((batch) => batch.batchId), ['batch-0001', 'batch-0002']);
    assert.strictEqual(details.run.activeNodeId, 'plan');
    assert.strictEqual(details.run.activeBatchId, 'batch-0002');
    assert.strictEqual(details.run.batches[0].terminationReason, 'continued');
    assert.strictEqual(details.run.batches[1].userInstruction, '下一批增加主角主动选择，并减少解释。');
    assert.strictEqual(details.run.batches[0].writingInstructionRef.revisionId, initialInstructions.revision.id);
    assert.strictEqual(details.run.batches[1].writingInstructionRef.revisionId, revisedInstructions.artifact.revision.id);
    assert.strictEqual(details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft').length, 2, 'creating a new batch must preserve prior draft artifacts');
    await assert.rejects(() => Creation.writeCreationBatch({
      ...base,
      batch: {
        batchId: 'batch-duplicate-sequence',
        sequence: 2,
        status: 'planning',
        targetCharacters: 180000,
        cumulativeCharacters: details.run.batches[0].cumulativeCharacters
      }
    }), /duplicate generation batch sequence/);
    await assert.rejects(() => Creation.writeCreationBatch({
      ...base,
      batch: {
        ...details.run.batches[1],
        status: 'drafting',
        planRef: { artifactId: 'missing-plan', revisionId: 'missing-revision' }
      }
    }), /artifact ref not found/);

    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.nodeId, 'plan');
    assert.ok(prepared.contextReport, 'F-09.6J plan prepare should expose contextReport');
    assert.ok(prepared.usageHint && prepared.usageHint.label);
    const secondPlanPayload = JSON.parse(prepared.prompts[0].prompt.messages[1].content);
    assert.strictEqual(secondPlanPayload.batchContext.sequence, 2);
    assert.strictEqual(secondPlanPayload.batchContext.userInstruction, '下一批增加主角主动选择，并减少解释。');
    // lastSceneEnding may be emptied when identical to rolling lastEnding (dedupe); continuity must still keep the ending.
    const prevBatch = secondPlanPayload.batchContext.previousBatch;
    const endingBlob = [
      prevBatch.lastSceneEnding || '',
      (prevBatch.continuityState && prevBatch.continuityState.lastEnding) || '',
      (prevBatch.continuityState && prevBatch.continuityState.summary) || ''
    ].join('\n');
    assert.ok(endingBlob.includes('死亡记录'), 'cross-batch continuity keeps ending via rolling or lastSceneEnding');
    assert.ok(prevBatch.continuityState.summary);
    const due = secondPlanPayload.batchContext.dueThreads || [];
    const mustClose = secondPlanPayload.batchContext.mustCloseThreads || [];
    const openThreads = (prevBatch.continuityState.unresolvedThreads || prevBatch.continuityState.threadLedger || []);
    assert.ok(
      due.some((item) => String(item.threadId || item).includes('death-record'))
        || mustClose.some((item) => String(item.threadId || item).includes('death-record'))
        || openThreads.some((item) => String(item.threadId || '').includes('death-record')),
      'due/mustClose threads from previous rolling must survive assembly'
    );
    assert.ok(secondPlanPayload.writingInstructions.text.includes('第三人称限知'));
    assert.ok(prepared.prompts[0].prompt.messages[0].content.includes('第 2 批'));
    const secondPlan = { scenes: [
      { id: 'choice', title: '主动选择', goal: '主动公开部分真相', conflict: '同伴反对', targetWords: 3200, fineOutline: ['拒绝撤退', '公开证据'] }
    ] };
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(secondPlan)] });
    await Creation.approveCreationNode(base);
    prepared = await Creation.prepareCreationNode(base);
    assert.strictEqual(prepared.prompts.length, 1);
    await Creation.completeCreationNode({ ...base, outputs: ['苏晚拒绝撤退，亲手公开了第一份证据。'], outputTitles: ['主动选择'] });
    await Creation.approveCreationNode(base);
    details = await Creation.completeCreationNode({
      ...base,
      outputs: [JSON.stringify({
        summary: '主角已经开始主动行动，但后果需要立即兑现。',
        findings: [{ type: 'consequence_gap', severity: 'major', sceneTitle: '主动选择', evidence: '证据公开后尚未受阻', suggestion: '下一批立即呈现代价' }]
      })]
    });
    assert.strictEqual(details.run.activeNodeId, 'transfer');
    assert.strictEqual(details.run.batches[1].status, 'waiting_decision');
    nextPreview = await Creation.previewNextCreationBatch(base);
    assert.strictEqual(nextPreview.qualityGateBlocked, true);
    assert.strictEqual(nextPreview.blockingFindingCount, 1);
    await assert.rejects(() => Creation.continueCreationBatch({ ...base, acknowledgeMajor: true }), /质量门禁未通过/);
    await assert.rejects(() => Creation.completeCreationTransfer(base), /质量门禁未通过/);
    const gateEvents = await eventStore.listWorkflowV2Events(created.projectPath, base.runId);
    assert.ok(gateEvents.some((event) => event.type === 'creation_quality_gate_blocked'
      && event.payload.blockingFindingCount === 1));
    details = await Creation.restartCreationNode({ ...base, nodeId: 'draft', reason: '修复阻断问题' });
    assert.strictEqual(details.run.activeNodeId, 'draft');
    prepared = await Creation.prepareCreationNode(base);
    await Creation.completeCreationNode({ ...base, outputs: ['苏晚拒绝撤退，公开证据后立刻遭到城市断电封锁。'], outputTitles: ['主动选择'] });
    await Creation.approveCreationNode(base);
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify({ summary: '修复后通过', findings: [] })] });
    nextPreview = await Creation.previewNextCreationBatch(base);
    assert.strictEqual(nextPreview.qualityGateBlocked, false);
    details = await Creation.continueCreationBatch({
      ...base,
      userInstruction: '承接审查意见，立刻呈现公开证据的代价。'
    });
    assert.strictEqual(details.run.activeBatchId, 'batch-0003');
    assert.strictEqual(details.run.batches[1].terminationReason, 'continued');

    const thirdPlan = { scenes: [
      { id: 'cost', title: '公开的代价', goal: '保护证人', conflict: '管理 AI 封锁城市', targetWords: 3000, fineOutline: ['城市断电', '转移证人'] }
    ] };
    prepared = await Creation.prepareCreationNode(base);
    const thirdPlanPayload = JSON.parse(prepared.prompts[0].prompt.messages[1].content);
    assert.strictEqual(thirdPlanPayload.batchContext.sequence, 3);
    assert.strictEqual(thirdPlanPayload.batchContext.previousBatch.review.qualityGate, 'passed');
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify(thirdPlan)] });
    await Creation.approveCreationNode(base);
    await Creation.completeCreationNode({ ...base, outputs: ['城市骤然断电，苏晚带着证人潜入旧排水管。'], outputTitles: ['公开的代价'] });
    await Creation.approveCreationNode(base);
    await Creation.completeCreationNode({ ...base, outputs: [JSON.stringify({ summary: '连续性通过', findings: [] })] });

    const assemblyPreview = await Creation.previewChapterAssembly(base);
    assert.ok(assemblyPreview.ok);
    assert.ok(assemblyPreview.assembly.chapters.length >= 1);
    assert.ok(assemblyPreview.assembly.chapters.every((chapter) => !/^第\s*\d+\s*批/.test(chapter.title)));
    assert.ok(assemblyPreview.scenes.length >= 4);
    assert.ok(assemblyPreview.scenes.every((scene) => scene.sceneId && scene.chapterId && scene.source && scene.source.revisionId));
    assert.ok(assemblyPreview.progress.completedBodyStatsChars > 0 || assemblyPreview.progress.completedCharacters > 0);
    const renamedAssembly = JSON.parse(JSON.stringify(assemblyPreview.assembly));
    renamedAssembly.chapters[0].title = '服务端校验后的章名';
    const renamedPreview = await Creation.previewChapterAssembly({ ...base, assembly: renamedAssembly });
    assert.strictEqual(renamedPreview.assembly.chapters[0].title, '服务端校验后的章名');
    const incompleteAssembly = JSON.parse(JSON.stringify(assemblyPreview.assembly));
    incompleteAssembly.chapters[0].scenes.shift();
    await assert.rejects(
      () => Creation.previewChapterAssembly({ ...base, assembly: incompleteAssembly }),
      /each approved draft exactly once/
    );
    const Transfer = require('../desktop/services/workflow-transfer-service');
    const transferApply = await Transfer.applyWriterTransfer({
      ...base,
      applicationId: 'creation-assembly-transfer',
      scenes: assemblyPreview.scenes
    });
    assert.strictEqual(transferApply.ok, true);
    const afterTransfer = await projectService.openProject(dataRoot, created.project.id);
    assert.ok(afterTransfer.project.scenes.filter((scene) => scene.sourceRunId).length >= 4);
    assert.ok(afterTransfer.project.chapters.every((chapter) => !/^第\s*\d+\s*批/.test(chapter.title)));

    details = await Creation.completeCreationTransfer({ ...base, applicationId: 'creation-transfer' });
    assert.strictEqual(details.run.status, 'completed');
    assert.strictEqual(details.run.activeNodeId, '');
    assert.deepStrictEqual(details.run.batches.map((batch) => batch.status), ['completed', 'completed', 'completed']);
    assert.deepStrictEqual(details.run.batches.map((batch) => batch.terminationReason), ['continued', 'continued', 'user_stopped']);
    assert.strictEqual(
      details.run.generationProgress.completedCharacters,
      details.run.batches.reduce((sum, batch) => sum + batch.batchCharacters, 0)
    );
    assert.ok(details.run.generationProgress.completedBodyStatsChars > 0);
    assert.strictEqual(details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft').length, 4);

    const instructionRun = { dataRoot, projectId: created.project.id, runId: 'creation-instruction-current-run' };
    await Creation.startGuidedCreation({
      ...instructionRun,
      brief: { title: '指令切换测试', premise: '测试当前批次指令切换。', targetWords: 30000 },
      writingInstructions: { text: '保持简洁。' }
    });
    let instructionDetails = await Creation.getCreationRun(dataRoot, created.project.id, instructionRun.runId);
    const instructionArtifact = instructionDetails.run.artifacts.find((artifact) => artifact.artifactType === 'workflow-writing-instructions@1');
    const changedInstruction = await Creation.reviseCreationArtifact({
      ...instructionRun,
      artifactId: instructionArtifact.id,
      parentRevisionId: instructionArtifact.revision.id,
      content: JSON.stringify({ ...instructionArtifact.content, text: '保持简洁，并增加动作表达。' })
    });
    instructionDetails = await Creation.applyWritingInstructionsToCurrentBatch(instructionRun);
    assert.strictEqual(
      instructionDetails.run.batches[0].writingInstructionRef.revisionId,
      changedInstruction.artifact.revision.id,
      'an explicitly applied instruction revision should become the current batch baseline'
    );

    const legacy = Creation.decorateCreationRun({
      status: 'in_progress',
      artifacts: [{
        id: 'legacy-brief',
        nodeId: 'brief',
        content: { targetLength: 90000 },
        revision: { id: 'legacy-brief-r1' }
      }]
    }, []);
    assert.strictEqual(legacy.batches[0].legacy, true);
    assert.strictEqual(legacy.batches[0].batchId, 'batch-0001');
    assert.strictEqual(legacy.generationProgress.targetCharacters, 90000);
    const damaged = Creation.decorateCreationRun({
      status: 'in_progress',
      artifacts: [{
        id: 'legacy-brief',
        nodeId: 'brief',
        content: { targetLength: 90000 },
        revision: { id: 'legacy-brief-r1' }
      }]
    }, [{
      id: 'damaged-batch',
      artifactType: 'generation-batch@1',
      revision: { id: 'damaged-r1' },
      content: { batchId: 'damaged', status: 'reviewing' }
    }]);
    assert.strictEqual(damaged.batches[0].legacy, true);
    assert.ok(damaged.batchWarnings.length);

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
