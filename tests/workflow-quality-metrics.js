const assert = require('assert');
const Quality = require('../src/core/workflow/workflow-quality-metrics');

const range = Quality.parseDialogueRatioRange('约 25%–35%，根据场景浮动');
assert.strictEqual(range.min, 0.25);
assert.strictEqual(range.max, 0.35);

const targetsOff = Quality.normalizeQualityTargets({
  dialogueRatio: '约 30%',
  dialogueRatioMin: 0.3,
  dialogueRatioMax: 0.35
});
assert.strictEqual(targetsOff.dialogueRatioEnabled, false);
assert.strictEqual(targetsOff.dialogueRatioMin, null);
assert.strictEqual(targetsOff.technicalRegisterMode, 'avoid');

const targetsOn = Quality.normalizeQualityTargets({
  dialogueRatioEnabled: true,
  dialogueRatio: '约 25%–35%'
});
assert.strictEqual(targetsOn.dialogueRatioEnabled, true);
assert.strictEqual(targetsOn.dialogueRatioMin, 0.25);
assert.strictEqual(targetsOn.dialogueRatioMax, 0.35);

const prose = [
  '小红帽握紧斗篷。',
  '“你想用名字换路？”狼问。',
  '“我可以用限期借名，”她说，“但不能交出乳名。”',
  '契约的自动生成约束系统检测到了一个它无法归类的操作。'
].join('');

const metrics = Quality.measureProseMetrics(prose, {
  dialogueRatioEnabled: true,
  dialogueRatioMin: 0.25,
  dialogueRatioMax: 0.35,
  technicalRegisterMode: 'avoid'
});
assert.ok(metrics.totalCharacters > 0);
assert.ok(metrics.dialogueRatio > 0.1);
assert.ok(metrics.technicalHits >= 1);

const softFindings = Quality.buildQualityFindings({
  text: prose,
  qualityTargets: {
    dialogueRatioEnabled: true,
    dialogueRatioMin: 0.9,
    dialogueRatioMax: 0.95,
    technicalRegisterMode: 'avoid',
    technicalRegisterLocked: false
  },
  sceneId: 's1'
});
assert.ok(softFindings.some((item) => item.type === 'dialogue_ratio_below_target' && item.enforcement === 'soft'));
assert.ok(softFindings.some((item) => item.type === 'technical_register_drift' && item.enforcement === 'soft'));
assert.ok(!softFindings.some((item) => Quality.isBlockingFinding(item)));

const hardTech = Quality.buildQualityFindings({
  text: prose,
  qualityTargets: {
    technicalRegisterMode: 'avoid',
    technicalRegisterLocked: true
  }
});
assert.ok(hardTech.some((item) => item.type === 'technical_register_drift' && Quality.isBlockingFinding(item)));

const offTech = Quality.buildQualityFindings({
  text: prose,
  qualityTargets: { technicalRegisterMode: 'off' }
});
assert.ok(!offTech.some((item) => item.type === 'technical_register_drift'));

const fulfillment = Quality.evaluatePlanFulfillment({
  scenePlan: {
    scenes: [
      { id: 's1', outcome: '打开隐藏门并看到母亲仍活着的证据', mustInclude: ['主动与狼交易'] }
    ]
  },
  sceneTexts: {
    s1: '小红帽拒绝了狼的条件，主动提出限期借名的交易。门仍未打开。'
  },
  semanticFulfillment: [
    {
      sceneId: 's1',
      field: 'mustInclude[0]',
      status: 'fulfilled',
      evidence: '主动提出限期借名交易'
    },
    {
      sceneId: 's1',
      field: 'outcome',
      status: 'deferred',
      deferredToSceneId: 's2',
      evidence: '开门与证据推迟到后场'
    }
  ]
});
assert.ok(fulfillment.some((item) => item.field.startsWith('mustInclude') && item.status === 'fulfilled'));
assert.ok(fulfillment.some((item) => item.field === 'outcome' && item.status === 'deferred'));

const softPlanFindings = Quality.planFulfillmentFindings(fulfillment, { planOutcomeLocked: false });
assert.ok(softPlanFindings.every((item) => !Quality.isBlockingFinding(item)));
const hardPlanFindings = Quality.planFulfillmentFindings(fulfillment, { planOutcomeLocked: true });
assert.ok(hardPlanFindings.some((item) => item.type === 'plan_outcome_unfulfilled' ? false : item.type === 'plan_outcome_deferred'));
// deferred stays soft even when locked
assert.ok(hardPlanFindings.filter((item) => item.type === 'plan_outcome_deferred').every((item) => item.enforcement === 'soft'));

const compiled = Quality.compileQualityConstraints({
  qualityTargets: {
    technicalRegisterMode: 'avoid',
    bannedTerms: ['精神失常']
  },
  mustAvoid: ['堆砌比喻']
}, [{ id: 'sg1', text: '避免现代网络用语', enabled: true }], { projectId: 'p1', runId: 'r1' });
assert.ok(compiled.constraints.some((item) => item.id === 'quality-technical-register' && item.enforcement === 'soft'));
assert.ok(compiled.constraints.some((item) => item.text === '精神失常'));
assert.ok(compiled.constraints.some((item) => item.text === '避免现代网络用语'));

const ledger = Quality.normalizeThreadLedger(
  { unresolvedThreads: ['幼狼爪痕'] },
  { unresolvedThreads: [{ label: '母亲仍活着的证据', status: 'open' }], summary: '跨批状态' },
  { qualityTargets: { foreshadowingThreads: [{ label: '红斗篷契约', mustClose: true }] } }
);
assert.strictEqual(ledger.schemaVersion, 2);
assert.ok(ledger.threadLedger.length >= 3);
assert.ok(ledger.unresolvedThreads.some((item) => item.label.includes('幼狼') || item.label.includes('爪痕')));

// Legacy blocking: error without enforcement still blocks
assert.strictEqual(Quality.isBlockingFinding({ severity: 'error' }), true);
assert.strictEqual(Quality.isBlockingFinding({ severity: 'error', enforcement: 'soft' }), false);
assert.strictEqual(Quality.isBlockingFinding({ severity: 'warning', enforcement: 'hard' }), false);

console.log('workflow-quality-metrics: ok');
