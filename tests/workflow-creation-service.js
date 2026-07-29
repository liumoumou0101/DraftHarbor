const assert = require('assert');
const CreationService = require('../desktop/services/workflow-creation-service');

const brief = { title: '潮汐档案', premise: '失忆潜水员进入沉没城市寻找自己的死亡记录。', genre: '科幻悬疑' };
const directions = {
  directions: [
    { id: 'identity', title: '身份谜案', premise: '追查多个自己的来源。' },
    { id: 'city', title: '城市阴谋', premise: '揭露管理 AI 篡改集体记忆。' }
  ]
};
const blueprint = {
  title: '回声方案', logline: '她必须在城市再次沉没前证明自己不是复制品。',
  centralConflict: { protagonistGoal: '找回记录', opposingForce: '管理 AI', stakes: '所有幸存者的身份', dilemma: '真相会摧毁共同记忆' },
  acts: [{ title: '下潜', purpose: '进入沉城', turningPoint: '发现自己的墓碑' }]
};
const compendium = { cards: [
  { type: 'character', title: '苏晚', summary: '失忆潜水员', characterProfile: { role: '主角', goal: '找回记录' } },
  { type: 'location', title: '潮汐城', summary: '沉没城市' }
] };
const globalContext = {
  globalPrompt: 'GLOBAL-CONTEXT-SENTINEL',
  writingInstructions: { text: 'WRITING-INSTRUCTIONS-SENTINEL' }
};
function assertGlobalContext(prepared, label) {
  prepared.prompts.forEach((item) => {
    const payload = JSON.parse(item.prompt.messages[1].content);
    assert.strictEqual(payload.globalContext.globalPrompt, globalContext.globalPrompt, `${label} should receive frozen global prompt`);
    assert.strictEqual(payload.globalContext.writingInstructions.text, globalContext.writingInstructions.text, `${label} should receive writing instructions`);
  });
}

const directionPrompt = CreationService.prepareCreationStage('direction', { brief, ...globalContext, writingInstructions: globalContext.writingInstructions });
assert.strictEqual(directionPrompt.prompts.length, 1);
assert.ok(directionPrompt.prompts[0].prompt.messages[1].content.includes('潮汐档案'));
assertGlobalContext(directionPrompt, 'direction');

const normalizedDirections = CreationService.normalizeCreationOutput('direction', JSON.stringify(directions));
assert.strictEqual(normalizedDirections.directions.length, 2);

const blueprintPrompt = CreationService.prepareCreationStage('blueprint', { brief, directions, selectedDirectionIds: ['identity'], ...globalContext, writingInstructions: globalContext.writingInstructions });
assert.ok(blueprintPrompt.prompts[0].prompt.messages[0].content.includes('故事蓝图'));
assertGlobalContext(blueprintPrompt, 'blueprint');
assert.strictEqual(CreationService.normalizeCreationOutput('blueprint', blueprint).centralConflict.stakes, '所有幸存者的身份');

const compendiumPrompt = CreationService.prepareCreationStage('compendium', { brief, directions, selectedDirectionIds: ['identity'], blueprint, ...globalContext, writingInstructions: globalContext.writingInstructions });
assert.ok(compendiumPrompt.prompts[0].prompt.messages[0].content.includes('characterProfile'));
assertGlobalContext(compendiumPrompt, 'compendium');
const normalizedCards = CreationService.normalizeCreationOutput('compendium', compendium, { projectId: 'p1' });
assert.strictEqual(normalizedCards.entries[0].characterProfile.role, '主角');

const planPrompt = CreationService.prepareCreationStage('plan', { brief, directions, selectedDirectionIds: ['identity'], blueprint, compendium, projectId: 'p1', ...globalContext, writingInstructions: globalContext.writingInstructions });
assert.ok(planPrompt.prompts[0].prompt.messages[0].content.includes('conflictIntensity'));
assertGlobalContext(planPrompt, 'plan');
const scenePlan = CreationService.normalizeCreationOutput('plan', {
  scenes: [{ title: '第一次下潜', goal: '进入城市', pace: 'fast', conflictIntensity: 80, targetWords: 4000 }]
});
assert.strictEqual(scenePlan.scenes[0].conflictIntensity, 80);

const draftPrompts = CreationService.prepareCreationStage('draft', {
  brief, directions, selectedDirectionIds: ['identity'], blueprint, compendium, projectId: 'p1', scenePlan,
  ...globalContext, writingInstructions: globalContext.writingInstructions
});
assert.strictEqual(draftPrompts.prompts.length, 1);
assert.ok(draftPrompts.prompts[0].prompt.messages[1].content.includes('潮汐城'));
assert.ok(draftPrompts.prompts[0].prompt.messages[0].content.includes('currentScene.targetWords'));
assert.ok(draftPrompts.prompts[0].prompt.messages[0].content.includes('不得提前完成下一场景的核心转折'));
assert.ok(draftPrompts.prompts[0].prompt.messages[0].content.includes('正文绝不能提及'));
assertGlobalContext(draftPrompts, 'draft');
assert.strictEqual(CreationService.normalizeCreationOutput('draft', '潮水越过闸门。'), '潮水越过闸门。');
assert.throws(() => CreationService.normalizeCreationOutput('draft', '  '), /must not be empty/);

console.log('Workflow creation service test passed.');
