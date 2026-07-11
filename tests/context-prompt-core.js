const assert = require('assert');
const ContextResolver = require('../src/core/context/context-resolver');
const PromptTemplateSchema = require('../src/core/prompt/prompt-template-schema');
const PromptBuilder = require('../src/core/generation/prompt-builder');

const project = {
  id: 'ctx-project',
  currentSceneId: 's2',
  compendium: [
    { id: 'ada', title: 'Ada', aliases: ['Navigator'], type: 'character', body: 'Ada maps storms.', tags: ['pilot'], alwaysInContext: false },
    { id: 'city', title: 'Brass City', type: 'location', body: 'A city of bells.', tags: ['city'], alwaysInContext: true },
    { id: 'sailor', title: 'Old Sailor', type: 'character', body: 'Knows every tide.', tags: ['crew'], alwaysInContext: false },
    { id: 'guild', title: 'Cartography Guild', type: 'lore', body: 'Masters of maps.', tags: ['art'], alwaysInContext: false }
  ],
  scenes: [
    { id: 's1', chapterId: 'c1', title: 'Harbor', summary: 'Ada found the first map.' },
    { id: 's2', chapterId: 'c1', title: 'Bridge', summary: 'Current scene.' },
    { id: 's3', chapterId: 'c1', title: 'Storm Gate', summary: 'The gate opens during storms.' }
  ],
  sceneContents: {
    s3: 'The gate opens during storms.'
  }
};

const context = ContextResolver.resolveContext({
  project,
  beat: '让 @[Navigator] 前往 #[Storm Gate]。',
  selection: {
    currentSceneId: 's2',
    maxChars: 1000
  }
});

assert.ok(context.compendiumEntries.some((entry) => entry.id === 'ada'), 'mention alias should include compendium entry');
assert.ok(context.compendiumEntries.some((entry) => entry.id === 'city'), 'alwaysInContext should include compendium entry');
assert.ok(context.sceneSummaries.some((scene) => scene.id === 's1'), 'previous scene summary should be included');
assert.ok(context.sceneSummaries.some((scene) => scene.id === 's3'), 'scene mention should include referenced scene');

const template = PromptTemplateSchema.createPromptTemplate({
  category: 'prose',
  title: 'Atmospheric prose',
  systemContent: 'Write with quiet precision.',
  content: 'Use concrete sensory detail.'
});
assert.strictEqual(template.category, 'prose');

const prompt = PromptBuilder.buildFictionPrompt({
  beat: '继续写。',
  sceneContext: 'Existing scene.',
  options: {
    systemPrompt: template.systemContent,
    prosePrompt: template.content,
    compendiumEntries: context.compendiumEntries,
    sceneSummaries: context.sceneSummaries
  }
});

const rendered = prompt.asString();
assert.ok(rendered.includes('Write with quiet precision.'), 'system template should be used');
assert.ok(rendered.includes('Use concrete sensory detail.'), 'user template should be used');
assert.ok(rendered.includes('Ada maps storms.'), 'resolved compendium should be included');
assert.ok(rendered.includes('Storm Gate'), 'resolved scene should be included');

// Test 2: Plain tag in beat text includes matching compendium entry
const context2 = ContextResolver.resolveContext({
  project,
  beat: 'The pilot must navigate the storm.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context2.compendiumEntries.some((entry) => entry.id === 'ada'), 'plain tag in beat text should include matching compendium entry');

// Test 3: Plain tag in current scene content includes matching compendium entry
const projectWithSceneContent = {
  ...project,
  sceneContents: { ...project.sceneContents, s2: 'The crew prepares for departure.' }
};
const context3 = ContextResolver.resolveContext({
  project: projectWithSceneContent,
  beat: 'Write the next part.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context3.compendiumEntries.some((entry) => entry.id === 'sailor'), 'plain tag in current scene content should include matching compendium entry');

// Test 4: ASCII boundary - short tag should not match partial in longer word
const context4 = ContextResolver.resolveContext({
  project,
  beat: 'The Cartography Guild is famous.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(!context4.compendiumEntries.some((entry) => entry.id === 'guild'), 'partial ASCII tag match (art in Cartography) should not include unrelated entry');

// Test 5: @[Title] mention still resolves when there is no plain tag match
const context5 = ContextResolver.resolveContext({
  project,
  beat: 'Use @[Ada] knowledge.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context5.compendiumEntries.some((entry) => entry.id === 'ada'), '@[Title] mention should resolve by title');

// Test 6: disabled mode prevents automatic injection
const projectWithDisabled = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'sailor' ? { ...entry, contextPolicy: { mode: 'disabled' } } : entry
  )
};
const context6 = ContextResolver.resolveContext({
  project: projectWithDisabled,
  beat: 'The crew member is speaking.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(!context6.compendiumEntries.some((entry) => entry.id === 'sailor'), 'disabled mode should prevent tag-based automatic injection');

// Test 7: manual entry id selection still includes a disabled entry
const context7 = ContextResolver.resolveContext({
  project: projectWithDisabled,
  beat: '',
  selection: { currentSceneId: 's2', maxChars: 2000, compendiumIds: ['sailor'] }
});
assert.ok(context7.compendiumEntries.some((entry) => entry.id === 'sailor'), 'manual selection by id should include disabled entry');

// Test 8: mention mode injects on @[Title]
const projectWithMention = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'sailor' ? { ...entry, contextPolicy: { mode: 'mention' }, alwaysInContext: false } : entry
  )
};
const context8 = ContextResolver.resolveContext({
  project: projectWithMention,
  beat: '@[Old Sailor] knows the way.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context8.compendiumEntries.some((entry) => entry.id === 'sailor'), 'mention mode should include on @[Title]');

// Test 9: mention mode with tags trigger disabled should not match tag
const projectWithMentionNoTags = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'sailor' ? { ...entry, contextPolicy: { mode: 'mention', triggers: { tags: false } }, alwaysInContext: false } : entry
  )
};
const context9 = ContextResolver.resolveContext({
  project: projectWithMentionNoTags,
  beat: 'The crew prepares.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(!context9.compendiumEntries.some((entry) => entry.id === 'sailor'), 'mention mode with tags trigger disabled should not match on tag');

// Test 10: auto mode injects character card when POV matches title
const projectWithAuto = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'ada' ? { ...entry, contextPolicy: { mode: 'auto' }, alwaysInContext: false } : entry
  )
};
const context10 = ContextResolver.resolveContext({
  project: projectWithAuto,
  beat: 'Write from this perspective.',
  povCharacter: 'Ada',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context10.compendiumEntries.some((entry) => entry.id === 'ada'), 'auto mode should include character card when POV matches title');
assert.ok(context10.includedEntryReasons && context10.includedEntryReasons['ada'].includes('pov'), 'includedEntryReasons should include pov reason');

// Test 11: auto mode with pov trigger disabled does not match POV
const projectWithAutoNoPov = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'ada' ? { ...entry, contextPolicy: { mode: 'auto', triggers: { pov: false } }, alwaysInContext: false } : entry
  )
};
const context11 = ContextResolver.resolveContext({
  project: projectWithAutoNoPov,
  beat: 'Write.',
  povCharacter: 'Ada',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(!context11.compendiumEntries.some((entry) => entry.id === 'ada'), 'auto mode with pov trigger disabled should not match POV');

// Test 12: Character profile fields appear in generated prompt text
const promptWithChar = PromptBuilder.buildFictionPrompt({
  beat: '继续写。',
  sceneContext: 'Existing scene.',
  options: {
    compendiumEntries: [
      {
        id: 'char-test',
        title: 'Mira',
        type: 'character',
        body: 'Mira is a quiet observer.',
        characterProfile: {
          role: '向导',
          goal: '找到失落的城市',
          motivation: '寻找家族秘密',
          conflict: '害怕黑暗',
          voice: '平静而坚定',
          currentState: '疲惫但警觉',
          knowledge: '知道古代通道的位置',
          relationshipNotes: '与主角是旧识'
        }
      }
    ],
    sceneSummaries: []
  }
});
const renderedChar = promptWithChar.asString();
assert.ok(renderedChar.includes('Mira is a quiet observer.'), 'character body should be included');
assert.ok(renderedChar.includes('角色定位: 向导'), 'character role should appear in prompt');
assert.ok(renderedChar.includes('目标: 找到失落的城市'), 'character goal should appear in prompt');
assert.ok(renderedChar.includes('动机: 寻找家族秘密'), 'character motivation should appear in prompt');
assert.ok(renderedChar.includes('冲突: 害怕黑暗'), 'character conflict should appear in prompt');
assert.ok(renderedChar.includes('语气/声音: 平静而坚定'), 'character voice should appear in prompt');
assert.ok(renderedChar.includes('当前状态: 疲惫但警觉'), 'character currentState should appear in prompt');
assert.ok(renderedChar.includes('已知信息: 知道古代通道的位置'), 'character knowledge should appear in prompt');
assert.ok(renderedChar.includes('关系备注: 与主角是旧识'), 'character relationshipNotes should appear in prompt');

// Test 13: includedEntryReasons metadata
const context13 = ContextResolver.resolveContext({
  project: {
    ...project,
    compendium: project.compendium.map((entry) =>
      entry.id === 'ada' ? { ...entry, contextPolicy: { mode: 'auto' }, alwaysInContext: false } : entry
    )
  },
  beat: 'Let @[Navigator] go.',
  povCharacter: 'Ada',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context13.includedEntryReasons, 'includedEntryReasons should be present');
assert.ok(context13.includedEntryReasons['ada'], 'ada should have reasons');
assert.ok(context13.includedEntryReasons['ada'].includes('mention'), 'ada should be included by mention');
assert.ok(context13.includedEntryReasons['ada'].includes('pov'), 'ada should be included by pov');

// Test 14: mention mode includes entry when beat text plainly contains its title
const projectWithMentionPlain = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'ada' ? { ...entry, contextPolicy: { mode: 'mention' }, alwaysInContext: false } : entry
  )
};
const context14 = ContextResolver.resolveContext({
  project: projectWithMentionPlain,
  beat: 'Ada is navigating the storm.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context14.compendiumEntries.some((e) => e.id === 'ada'), 'mention mode should include entry when beat text plainly contains its title');

// Test 15: mention mode includes entry when beat text plainly contains an alias
const projectWithMentionAlias = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'ada' ? { ...entry, contextPolicy: { mode: 'mention' }, alwaysInContext: false } : entry
  )
};
const context15 = ContextResolver.resolveContext({
  project: projectWithMentionAlias,
  beat: 'The Navigator guides the ship.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context15.compendiumEntries.some((e) => e.id === 'ada'), 'mention mode should include entry when beat text plainly contains an alias');

// Test 16: disabling title trigger prevents plain title matching
const projectWithNoTitle = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'ada' ? { ...entry, contextPolicy: { mode: 'mention', triggers: { title: false, aliases: true } }, alwaysInContext: false } : entry
  )
};
const context16 = ContextResolver.resolveContext({
  project: projectWithNoTitle,
  beat: 'Ada is navigating the storm.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(!context16.compendiumEntries.some((e) => e.id === 'ada'), 'disabling title trigger should prevent plain title matching');

// Test 17: disabling aliases trigger prevents alias matching while title matching still works
const projectWithNoAliases = {
  ...project,
  compendium: project.compendium.map((entry) =>
    entry.id === 'ada' ? { ...entry, contextPolicy: { mode: 'mention', triggers: { title: true, aliases: false } }, alwaysInContext: false } : entry
  )
};
const context17a = ContextResolver.resolveContext({
  project: projectWithNoAliases,
  beat: 'The Navigator guides the ship.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(!context17a.compendiumEntries.some((e) => e.id === 'ada'), 'disabling aliases trigger should prevent alias matching');
const context17b = ContextResolver.resolveContext({
  project: projectWithNoAliases,
  beat: 'Ada is navigating.',
  selection: { currentSceneId: 's2', maxChars: 2000 }
});
assert.ok(context17b.compendiumEntries.some((e) => e.id === 'ada'), 'title matching should still work when alias trigger is disabled and title trigger is enabled');

console.log('Context and prompt core test passed.');
