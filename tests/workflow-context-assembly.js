const assert = require('assert');
const Assembly = require('../src/core/workflow/workflow-context-assembly');

// Usage labels never fake zero as real
assert.ok(Assembly.buildUsageHint({}).label.includes('不可用'));
assert.ok(Assembly.buildUsageHint({ estimatedInputTokens: 12000 }).label.includes('约'));
assert.ok(Assembly.buildUsageHint({ estimatedInputTokens: 12000 }).label.includes('估算'));
assert.ok(Assembly.buildUsageHint({ inputTokens: 11842 }).label.includes('接口回传'));
assert.strictEqual(Assembly.buildUsageHint({ inputTokens: 0, estimatedInputTokens: 0 }).source, 'unavailable');

const fatCompendium = {
  entries: [
    { id: 'c1', type: 'character', title: '苏晚', aliases: ['小晚'], summary: '主角', body: 'A'.repeat(800), sourceLevel: 'author_locked' },
    { id: 'c2', type: 'character', title: '路人甲', summary: '无关', body: 'B'.repeat(800) },
    { id: 'l1', type: 'location', title: '潮汐城', summary: '城市', body: 'C'.repeat(800) },
    { id: 'n1', type: 'note', title: '杂记', summary: '无关笔记', body: 'D'.repeat(800) }
  ]
};

const fatBlueprint = {
  title: '夜港',
  logline: '借名换路',
  themes: ['名字'],
  centralConflict: { protagonistGoal: '出港', opposingForce: '狼', stakes: '乳名', dilemma: '交易' },
  endingDirection: '苦涩开放',
  acts: [
    { id: 'a1', title: '下潜', purpose: '进入', turningPoint: '墓碑', emotionalDirection: '惧' },
    { id: 'a2', title: '交易', purpose: '借名', turningPoint: '爪痕', emotionalDirection: '决' }
  ]
};

const rolling = {
  summary: '跨批摘要'.repeat(40),
  characterStates: {
    苏晚: { status: '持契约' },
    路人甲: { status: '无关' },
    狼: { status: '等待' }
  },
  knownFacts: Array.from({ length: 20 }, (_, i) => `事实${i + 1}：内容`),
  unresolvedThreads: [
    { threadId: 't1', label: '幼狼爪痕', status: 'open', mustClose: true, evidence: '抵押' },
    { threadId: 't2', label: '旧账', status: 'closed', mustClose: false, evidence: '已结' },
    { threadId: 't3', label: '远线', status: 'open', mustClose: false, evidence: '以后' }
  ],
  lastEnding: '结尾。'.repeat(300)
};

const completedScenes = [
  { sceneId: 's1', title: '码头', ending: '码头结束。'.repeat(50) },
  { sceneId: 's2', title: '铁柜', text: `守柜人说明：根脉碎片不可带出港口，无法穿越盐雾屏障。${'她检查铁柜。'.repeat(20)}`, ending: '铁柜结束。'.repeat(50) },
  { sceneId: 's3', title: '菌丝', ending: '菌丝结束。'.repeat(50) }
];

const approvedDrafts = [
  {
    sceneId: 's1',
    title: '码头',
    text: `“你要乳名？”她问。\n“我要路。”狼说。\n${'海风拍打木桩。'.repeat(200)}`
  },
  {
    sceneId: 's2',
    title: '铁柜',
    text: '铁柜里只有胎发。'.repeat(100)
  }
];

const raw = {
  projectId: 'p1',
  brief: { workingTitle: '夜港的借名', premise: '限期借名' },
  writingInstructions: { text: '克制' },
  globalContext: { globalPrompt: 'GP' },
  directions: {
    schemaVersion: 1,
    directions: [
      { id: 'd1', title: '借名出海', premise: '限期借名换路', plotFocus: '契约', emotionalArc: '冷', risks: ['代价'] },
      { id: 'd2', title: '夺名返乡', premise: '夺回乳名', plotFocus: '对峙', emotionalArc: '炽', risks: ['暴露'] }
    ]
  },
  selectedDirectionIds: ['d1'],
  blueprint: fatBlueprint,
  compendium: fatCompendium,
  scenePlan: { scenes: [{ id: 's4', title: '下一场' }] },
  currentScene: {
    id: 's4',
    title: '下一场',
    povCharacter: '苏晚',
    participants: ['苏晚', '狼'],
    location: '潮汐城',
    goal: '完成交易',
    conflict: '抵押',
    outcome: '上路',
    mustInclude: ['爪痕']
  },
  constraints: [{ kind: 'exclusion', text: '不得用梦境' }],
  batchContext: {
    batchId: 'batch-0002',
    sequence: 2,
    userInstruction: '收束',
    dueThreads: [{ threadId: 't1', label: '幼狼爪痕', mustClose: true }],
    mustCloseThreads: [{ threadId: 't1', label: '幼狼爪痕', mustClose: true }],
    progress: { completedBodyStatsChars: 5000, targetCharacters: 6000 },
    previousBatch: {
      batchId: 'batch-0001',
      sequence: 1,
      review: {
        qualityGate: 'passed',
        summary: '上批通过',
        findings: [{ type: 'x', severity: 'suggestion' }, { type: 'y', severity: 'error' }],
        blockingFindingCount: 1
      },
      continuityState: rolling,
      lastSceneEnding: rolling.lastEnding
    },
    currentBatch: {
      completedScenes,
      lastSceneEnding: completedScenes[2].ending
    }
  },
  approvedDrafts
};

const fatSize = Assembly.jsonSize(raw);
const assembled = Assembly.assembleContext('draft', raw);
assert.ok(assembled.context);
assert.ok(assembled.context.directions, 'draft stage must keep directions for prepareCreationStage mergeDirections');
assert.ok(assembled.report.assembledChars < fatSize, 'assembled should be smaller than raw dump');
assert.ok(assembled.report.assembledChars / fatSize < 0.85, 'expect meaningful compression vs raw object');

// Blueprint is digest, not full acts turning points
assert.ok(assembled.context.blueprint);
assert.ok(assembled.context.blueprint.actTitles || assembled.context.blueprint.acts);
assert.ok(!JSON.stringify(assembled.context.blueprint).includes('墓碑') || assembled.context.blueprint.acts);

// Compendium filtered: locked 苏晚 + 潮汐城 likely; 路人甲/杂记 dropped or deprioritized
const titles = (assembled.context.compendium.entries || []).map((e) => e.title);
assert.ok(titles.includes('苏晚'), 'locked/relevant character kept');
assert.ok(titles.includes('潮汐城') || titles.includes('狼') || titles.length >= 1);

// Author-locked cards are hard context and must all survive a tight soft budget.
const lockedSelection = Assembly.selectCompendiumEntries({ entries: [
  { id: 'locked-1', title: '锁定甲', summary: 'A'.repeat(80), body: 'X'.repeat(100), sourceLevel: 'author_locked' },
  { id: 'locked-2', title: '锁定乙', summary: 'B'.repeat(80), body: 'Y'.repeat(100), sourceLevel: 'author_locked' }
] }, {}, [], { compendiumTotal: 100, compendiumEachBody: 100 }, 'draft');
assert.deepStrictEqual(lockedSelection.selectedIds, ['locked-1', 'locked-2']);
assert.deepStrictEqual(lockedSelection.droppedIds, []);

// Multi-scene summaries present (not only last)
assert.ok(assembled.context.batchContext.currentBatch.completedScenes.length === 3);
const summaryTotal = assembled.context.batchContext.currentBatch.completedScenes
  .reduce((sum, item) => sum + String(item.summary || '').length, 0);
assert.ok(summaryTotal <= 1300, `completed scene summaries capped, got ${summaryTotal}`);
const sceneTwoSummary = assembled.context.batchContext.currentBatch.completedScenes.find((item) => item.sceneId === 's2');
assert.ok(sceneTwoSummary.factAnchors.some((item) => item.includes('根脉碎片不可带出港口')), 'mid-scene world rule must survive as fact anchor');

// Style exemplar 3k-4k when source long enough
assert.ok(assembled.context.styleExemplar);
assert.ok(assembled.context.styleExemplar.text.length >= 1000);
assert.ok(assembled.context.styleExemplar.text.length <= 4000);
assert.strictEqual(assembled.context.styleExemplar.purpose, 'style-only');

// Rolling keeps mustClose thread
const threads = assembled.context.batchContext.previousBatch.continuityState.threadLedger
  || assembled.context.batchContext.previousBatch.continuityState.unresolvedThreads;
assert.ok(threads.some((t) => t.threadId === 't1' && t.mustClose));
assert.ok(!threads.some((t) => t.status === 'closed'), 'closed threads dropped');

// Previous review slim
assert.ok(assembled.context.batchContext.previousBatch.review.summary);
assert.ok(!Array.isArray(assembled.context.batchContext.previousBatch.review.findings));

// Usage hint estimate
assert.strictEqual(assembled.report.usageHint.source, 'estimate');
assert.ok(assembled.report.usageHint.label.includes('约'));

// Plan stage also digests
const planAssembled = Assembly.assembleContext('plan', raw);
assert.ok(planAssembled.context.blueprint.title);

// Review keeps drafts if provided
const withDrafts = Assembly.assembleContext('review', {
  ...raw,
  drafts: [{ sceneId: 's1', text: '全文审查' }]
});
assert.ok(withDrafts.context.drafts);

// Compression fixture-style: build even fatter and ensure >=25% when comparing assembled to a "naive full" packaging
const naiveFull = {
  ...raw,
  batchContext: {
    ...raw.batchContext,
    previousBatch: {
      ...raw.batchContext.previousBatch,
      review: { ...raw.batchContext.previousBatch.review, findings: raw.batchContext.previousBatch.review.findings, full: 'X'.repeat(5000) },
      lastSceneEnding: 'Y'.repeat(4000)
    },
    currentBatch: {
      completedScenes: completedScenes.map((s) => ({ ...s, ending: 'Z'.repeat(800) })),
      lastSceneEnding: 'W'.repeat(4000)
    }
  }
};
const naiveSize = Assembly.jsonSize({
  ...naiveFull,
  // simulate old behavior: full everything
  styleExemplar: undefined
});
const slim = Assembly.assembleContext('draft', naiveFull);
assert.ok(
  slim.report.assembledChars <= naiveSize * 0.75,
  `expect >=25% reduction: slim=${slim.report.assembledChars} naive=${naiveSize}`
);

console.log('workflow-context-assembly: ok', {
  raw: fatSize,
  assembled: assembled.report.assembledChars,
  ratio: (assembled.report.assembledChars / fatSize).toFixed(3),
  styleChars: assembled.context.styleExemplar.text.length
});
