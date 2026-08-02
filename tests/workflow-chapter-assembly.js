const assert = require('assert');
const Assembly = require('../src/core/workflow/workflow-chapter-assembly');
const Planning = require('../src/core/workflow/workflow-planning-schema');
const ProjectStats = require('../src/core/project/project-stats');

// Dual count helpers stay aligned with library authority.
const sample = '苏晚穿过闸门。Hello world.';
assert.strictEqual(Assembly.countBodyStats(sample), ProjectStats.countBodyStats(sample));
assert.strictEqual(Assembly.countRawCharacters(sample), ProjectStats.countRawCharacters(sample));
assert.ok(Assembly.countRawCharacters(sample) >= Assembly.countBodyStats(sample));

const plan = Planning.createScenePlan({
  scenes: [
    {
      id: 's1', title: '下潜', chapterKey: 'ch-1', chapterTitle: '潮水初临', chapterBreakBefore: true,
      goal: '进入沉城', conflict: '闸门', outcome: '发现墓碑', targetWords: 1000
    },
    {
      id: 's2', title: '墓碑', chapterKey: 'ch-1', chapterTitle: '潮水初临',
      goal: '读碑', conflict: '身份', outcome: '确认记录', targetWords: 1000
    },
    {
      id: 's3', title: '回声', chapterKey: 'ch-2', chapterTitle: '记忆回声', chapterBreakBefore: true,
      goal: '追查', conflict: 'AI', outcome: '线索', targetWords: 1000
    },
    {
      id: 's4', title: '裂隙', chapterKey: 'ch-2', chapterTitle: '记忆回声',
      goal: '深入', conflict: '追兵', outcome: '逃脱', targetWords: 1000
    },
    {
      id: 's5', title: '对质', chapterKey: 'ch-3', chapterTitle: '终局对质', chapterBreakBefore: true,
      goal: '对质', conflict: '真相', outcome: '抉择', targetWords: 1000
    },
    {
      id: 's6', title: '余波', chapterKey: 'ch-3', chapterTitle: '终局对质',
      goal: '收束', conflict: '代价', outcome: '开放', targetWords: 1000
    }
  ]
});
assert.strictEqual(plan.scenes[0].chapterKey, 'ch-1');
assert.strictEqual(plan.scenes[2].chapterBreakBefore, true);

function draft(id, sceneId, batchId, batchSequence, text, title) {
  return {
    id,
    nodeId: 'draft',
    title,
    artifactType: 'draft-batch@1',
    targetRef: { batchId, batchSequence, sceneId },
    revision: { id: `${id}-r1`, reviewState: 'approved' },
    content: text
  };
}

const drafts = [
  draft('d1', 's1', 'batch-0001', 1, '第一场正文甲。', '下潜'),
  draft('d2', 's2', 'batch-0001', 1, '第一场正文乙。', '墓碑'),
  draft('d3', 's3', 'batch-0001', 1, '第二场正文甲。', '回声'),
  draft('d4', 's4', 'batch-0002', 2, '第二场正文乙。', '裂隙'),
  draft('d5', 's5', 'batch-0002', 2, '第三场正文甲。', '对质'),
  draft('d6', 's6', 'batch-0002', 2, '第三场正文乙。', '余波')
];

const assembly = Assembly.buildChapterAssembly({
  runId: 'run-1',
  drafts,
  plans: [
    { nodeId: 'plan', targetRef: { batchId: 'batch-0001' }, content: { scenes: plan.scenes.slice(0, 3) }, revision: { id: 'p1', reviewState: 'approved' } },
    { nodeId: 'plan', targetRef: { batchId: 'batch-0002' }, content: { scenes: plan.scenes.slice(3) }, revision: { id: 'p2', reviewState: 'approved' } }
  ]
});

assert.strictEqual(assembly.mode, 'narrative');
assert.strictEqual(assembly.chapters.length, 3);
assert.strictEqual(assembly.totals.sceneCount, 6);
assert.ok(assembly.chapters.every((chapter) => !/^第\s*\d+\s*批/.test(chapter.title)));
assert.strictEqual(assembly.chapters[0].title, '潮水初临');
assert.strictEqual(assembly.chapters[0].scenes.length, 2);
assert.strictEqual(assembly.chapters[1].scenes.length, 2);
assert.strictEqual(assembly.chapters[2].scenes.length, 2);

const transferScenes = Assembly.assemblyToTransferScenes(assembly);
assert.strictEqual(transferScenes.length, 6);
// Writer scene ids use draft artifact ids (globally unique), not colliding plan ids.
assert.strictEqual(transferScenes[0].sceneId, 'd1');
assert.strictEqual(transferScenes[0].chapterTitle, '潮水初临');
assert.ok(transferScenes[0].source.revisionId);

// Colliding plan sceneIds across batches still produce distinct writer scenes.
const collide = Assembly.buildChapterAssembly({
  runId: 'run-collide',
  drafts: [
    draft('draft-b1-s1', 'dive', 'batch-0001', 1, '一批一场。', '一批一场'),
    draft('draft-b1-s2', 'archive', 'batch-0001', 1, '一批二场。', '一批二场'),
    draft('draft-b2-s1', 'dive', 'batch-0002', 2, '二批一场。', '二批一场'),
    draft('draft-b2-s2', 'archive', 'batch-0002', 2, '二批二场。', '二批二场')
  ],
  plans: []
});
const collideScenes = Assembly.assemblyToTransferScenes(collide);
assert.strictEqual(collideScenes.length, 4);
assert.deepStrictEqual(
  collideScenes.map((scene) => scene.sceneId).sort(),
  ['draft-b1-s1', 'draft-b1-s2', 'draft-b2-s1', 'draft-b2-s2']
);

// Plan scene ids are only unique inside a batch. Chapter hints must not leak across batches.
const collideWithPlans = Assembly.buildChapterAssembly({
  runId: 'run-collide-plans',
  drafts: [
    draft('draft-plan-b1', 'same-id', 'batch-0001', 1, '一批正文。', '一批场景'),
    draft('draft-plan-b2', 'same-id', 'batch-0002', 2, '二批正文。', '二批场景')
  ],
  plans: [
    {
      targetRef: { batchId: 'batch-0001' },
      content: { scenes: [{ id: 'same-id', chapterKey: 'chapter-one', chapterTitle: '第一章', chapterBreakBefore: true }] }
    },
    {
      targetRef: { batchId: 'batch-0002' },
      content: { scenes: [{ id: 'same-id', chapterKey: 'chapter-two', chapterTitle: '第二章', chapterBreakBefore: true }] }
    }
  ]
});
assert.deepStrictEqual(collideWithPlans.chapters.map((chapter) => chapter.key), ['chapter-one', 'chapter-two']);
assert.deepStrictEqual(collideWithPlans.chapters.map((chapter) => chapter.scenes[0].batchId), ['batch-0001', 'batch-0002']);

// Explicit chapter/scene order is authoritative, and a forced break creates a distinct chapter
// even if the plan intentionally reuses the same narrative chapter key.
const orderedAndSplit = Assembly.buildChapterAssembly({
  runId: 'run-order-split',
  drafts: [
    draft('ordered-late', 'late', 'batch-0001', 1, '后。', '后场'),
    draft('ordered-first', 'first', 'batch-0001', 1, '先。', '先场'),
    draft('ordered-split', 'split', 'batch-0001', 1, '拆。', '拆分场')
  ],
  plans: [{
    targetRef: { batchId: 'batch-0001' },
    content: { scenes: [
      { id: 'late', order: 0, chapterKey: 'shared', chapterTitle: '共享章', chapterOrder: 1, sceneOrderInChapter: 2 },
      { id: 'first', order: 1, chapterKey: 'shared', chapterTitle: '共享章', chapterOrder: 1, sceneOrderInChapter: 1 },
      { id: 'split', order: 2, chapterKey: 'shared', chapterTitle: '共享章续', chapterOrder: 1, sceneOrderInChapter: 3, chapterBreakBefore: true }
    ] }
  }]
});
assert.strictEqual(orderedAndSplit.chapters.length, 2);
assert.deepStrictEqual(orderedAndSplit.chapters[0].scenes.map((scene) => scene.planSceneId), ['first', 'late']);
assert.strictEqual(orderedAndSplit.chapters[1].key, 'shared--2');
assert.deepStrictEqual(orderedAndSplit.chapters[1].scenes.map((scene) => scene.planSceneId), ['split']);

// batch-compat: no chapter fields → one chapter per batch, never “第 N 批”
const compat = Assembly.buildChapterAssembly({
  runId: 'run-2',
  drafts: [
    draft('x1', 'a1', 'batch-0001', 1, '甲。', '闸门'),
    draft('x2', 'a2', 'batch-0001', 1, '乙。', '碑文'),
    draft('x3', 'a3', 'batch-0002', 2, '丙。', '回声')
  ],
  plans: []
});
assert.strictEqual(compat.mode, 'batch-compat');
assert.strictEqual(compat.chapters.length, 2);
assert.ok(compat.chapters.every((chapter) => !/^第\s*\d+\s*批/.test(chapter.title)));

// Rename edit path
const renamed = Assembly.normalizeEditedAssembly({
  ...assembly,
  chapters: assembly.chapters.map((chapter, index) => ({
    ...chapter,
    title: index === 0 ? '第 1 批错误名' : chapter.title
  }))
});
assert.strictEqual(renamed.chapters[0].title, '第 1 章');

// Split / merge / move
const split = Assembly.splitChapterAfter(assembly, 0, 0);
assert.strictEqual(split.chapters.length, assembly.chapters.length + 1);
assert.strictEqual(split.chapters[0].scenes.length, 1);
const merged = Assembly.mergeChapterWithNeighbor(split, 0, 'next');
assert.strictEqual(merged.chapters.length, assembly.chapters.length);
const moved = Assembly.moveScene(assembly, 0, 0, 1, 0);
assert.ok(moved.chapters[1].scenes.some((scene) => scene.sceneId === assembly.chapters[0].scenes[0].sceneId));
const reordered = Assembly.moveChapter(assembly, 0, 2);
assert.strictEqual(reordered.chapters[2].key, assembly.chapters[0].key);
const renamed2 = Assembly.renameChapter(assembly, 0, '第 9 批别名');
assert.strictEqual(renamed2.chapters[0].title, '第 1 章');

// Client edits may change chapter structure, but the approved draft source set is authoritative.
const reconciled = Assembly.reconcileEditedAssembly(assembly, {
  ...assembly,
  chapters: assembly.chapters.map((chapter, index) => ({
    ...chapter,
    title: index === 0 ? '用户改名' : chapter.title
  }))
});
assert.strictEqual(reconciled.chapters[0].title, '用户改名');
assert.strictEqual(reconciled.totals.sceneCount, assembly.totals.sceneCount);
const omitted = JSON.parse(JSON.stringify(assembly));
omitted.chapters[0].scenes.shift();
assert.throws(() => Assembly.reconcileEditedAssembly(assembly, omitted), /each approved draft exactly once/);
const duplicated = JSON.parse(JSON.stringify(assembly));
duplicated.chapters[0].scenes.push({ ...duplicated.chapters[0].scenes[0] });
assert.throws(() => Assembly.reconcileEditedAssembly(assembly, duplicated), /duplicate draft source/);
const remapped = JSON.parse(JSON.stringify(assembly));
remapped.chapters[0].scenes[0].sceneId = 'client-forged-scene';
assert.throws(() => Assembly.reconcileEditedAssembly(assembly, remapped), /scene identity/);

console.log('workflow-chapter-assembly: ok');
