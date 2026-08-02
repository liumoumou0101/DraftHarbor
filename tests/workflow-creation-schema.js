const assert = require('assert');
const Creation = require('../src/core/workflow/workflow-creation-schema');

const brief = Creation.createCreationBrief({
  title: '潮汐档案',
  premise: '失忆潜水员在沉没城市中寻找自己的死亡记录。',
  genre: '科幻悬疑',
  targetWords: 180000,
  themes: ['记忆', '身份', '记忆'],
  mustInclude: ['深海城市']
});
assert.strictEqual(brief.kind, 'creation-brief');
assert.strictEqual(brief.targetLength, 180000);
assert.deepStrictEqual(brief.themes, ['记忆', '身份']);
assert.throws(() => Creation.createCreationBrief({ title: '空想' }), /premise or core idea/);

const blueprint = Creation.createStoryBlueprint({
  title: '回声方案',
  logline: '她必须找回死亡记录，才能证明现在的自己并非复制品。',
  centralConflict: {
    protagonistGoal: '找回记录',
    opposingForce: '封锁城市的管理 AI',
    stakes: '自我身份和整座城市的幸存者',
    dilemma: '公开真相会摧毁幸存者的共同记忆'
  },
  acts: [
    { title: '下潜', purpose: '进入沉城', turningPoint: '发现自己的墓碑' },
    { title: '回声', purpose: '追查记忆来源', turningPoint: '确认存在多个自己' }
  ],
  characterArcs: [{ character: '苏晚', start: '否认', change: '接受证据', end: '主动定义自己' }],
  worldRules: ['记忆可以备份，但不能无损复制']
});
assert.strictEqual(blueprint.centralConflict.opposingForce, '封锁城市的管理 AI');
assert.strictEqual(blueprint.acts.length, 2);
assert.throws(() => Creation.createStoryBlueprint({ logline: '缺少冲突' }), /complete central conflict/);

const compendium = Creation.createCompendiumDraftBundle({ cards: [
  {
    type: 'character', title: '苏晚', summary: '失忆潜水员', aliases: ['小晚'],
    characterProfile: { role: '主角', goal: '找回记录', motivation: '证明自己存在' }
  },
  { type: 'location', title: '潮汐城', summary: '周期性被海水淹没的城市' }
] }, { projectId: 'creation-project' });
assert.strictEqual(compendium.entries.length, 2);
assert.strictEqual(compendium.entries[0].characterProfile.role, '主角');
assert.strictEqual(compendium.entries[0].characterProfile.relationshipNotes, '');
assert.strictEqual(compendium.entries[1].characterProfile, undefined);
assert.throws(() => Creation.createCompendiumDraftBundle({ cards: [{ summary: '没有标题' }] }), /requires a title/);

const bundle = Creation.createCreationPackage({
  brief,
  blueprint,
  compendium,
  scenePlan: {
    scenes: [{
      title: '第一次下潜', goal: '进入潮汐城', conflict: '氧气泄漏',
      participants: ['苏晚'], emotionalStart: '克制', emotionalEnd: '恐惧',
      pace: 'fast', conflictIntensity: 82, informationDensity: 65, targetWords: 4200,
      mustInclude: ['墓碑'], fineOutline: ['穿过闸门', '发现墓碑']
    }]
  }
}, { projectId: 'creation-project' });
assert.strictEqual(bundle.kind, 'creation-package');
assert.strictEqual(bundle.scenePlan.scenes[0].pace, 'fast');
assert.strictEqual(bundle.scenePlan.scenes[0].conflictIntensity, 82);
assert.strictEqual(bundle.scenePlan.scenes[0].targetWords, 4200);
assert.deepStrictEqual(bundle.scenePlan.scenes[0].mustInclude, ['墓碑']);

const withChapters = Creation.createCreationPackage({
  brief,
  blueprint,
  compendium,
  scenePlan: {
    scenes: [{
      title: '第一次下潜',
      chapterKey: 'ch-open',
      chapterTitle: '下潜之前',
      chapterOrder: 1,
      chapterBreakBefore: true,
      goal: '进入潮汐城',
      conflict: '氧气泄漏',
      targetWords: 1000
    }]
  }
}, { projectId: 'creation-project' });
assert.strictEqual(withChapters.scenePlan.scenes[0].chapterKey, 'ch-open');
assert.strictEqual(withChapters.scenePlan.scenes[0].chapterTitle, '下潜之前');
assert.strictEqual(withChapters.scenePlan.scenes[0].chapterBreakBefore, true);

console.log('Workflow creation schema test passed.');
