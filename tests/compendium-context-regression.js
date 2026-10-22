const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Resolver = require('../src/core/context/context-resolver');
const PromptBuilder = require('../src/core/generation/prompt-builder');
const Workshop = require('../src/core/workshop/workshop-prompt');
const Assembly = require('../src/core/workflow/workflow-context-assembly');

const profile = {
    role: 'PROFILE_ROLE', goal: 'PROFILE_GOAL', motivation: 'PROFILE_MOTIVATION',
    conflict: 'PROFILE_CONFLICT', voice: 'PROFILE_VOICE', currentState: 'PROFILE_STATE',
    knowledge: 'PROFILE_KNOWLEDGE', relationshipNotes: 'PROFILE_RELATIONSHIPS'
};
const character = { id: 'mira', type: 'character', title: 'Mira', summary: 'SUMMARY_ONLY_FACT', characterProfile: profile };

test('fiction prose receives summary-only facts and preserves summary alongside body', () => {
    for (const body of ['', 'BODY_FACT']) {
        const prompt = PromptBuilder.buildFictionPrompt({ options: { compendiumEntries: [{ ...character, body }] } });
        assert.ok(prompt.asString().includes(character.summary), 'summary is authoritative context even without a body');
        if (body) assert.ok(prompt.asString().includes(body));
    }
});

test('ordinary workshop discussion receives all eight structured character fields', () => {
    const prompt = Workshop.buildWorkshopPrompt({ project: { compendium: [{ ...character, alwaysInContext: true }] }, message: 'Discuss the next action.' });
    for (const value of Object.values(profile)) assert.ok(prompt.asString().includes(value), value);
});

for (const stage of ['draft', 'plan', 'review']) test(stage + ' compaction preserves structured character constraints', () => {
    const result = Assembly.assembleContext(stage, {
        compendium: { entries: [{ ...character, sourceLevel: 'author_locked' }] }, currentScene: { povCharacter: 'Mira' }
    });
    assert.deepEqual(result.context.compendium.entries[0].characterProfile, profile);
});

test('resolver uses current scene POV and participants when callers omit overrides', () => {
    const project = {
        currentSceneId: 'current',
        scenes: [{ id: 'current', povCharacter: 'Mira', characters: ['Navigator'] }],
        compendium: [
            { ...character, contextPolicy: { mode: 'auto' } },
            { id: 'ada', title: 'Ada', aliases: ['Navigator'], contextPolicy: { mode: 'auto' } }
        ]
    };
    const context = Resolver.resolveContext({ project });
    assert.deepEqual(context.includedEntryReasons.mira, ['pov']);
    assert.deepEqual(context.includedEntryReasons.ada, ['scene-characters']);
    const override = Resolver.resolveContext({ project, selection: { povCharacter: 'Other', sceneCharacters: [] } });
    assert.deepEqual(override.compendiumEntries, [], 'explicit scene overrides must still win');
});

test('soft budget reserves all always and manual cards and reports their overflow', () => {
    const context = Resolver.resolveContext({
        project: { compendium: [
            { id: 'ordinary', title: 'Ordinary', body: 'o'.repeat(500), contextPolicy: { mode: 'mention' } },
            { id: 'always', title: 'Always', body: 'a'.repeat(200), alwaysInContext: true },
            { id: 'manual', title: 'Manual', body: 'm'.repeat(200), contextPolicy: { mode: 'disabled' } },
            { id: 'tag', title: 'Tag', body: 't'.repeat(200), tags: ['chosen'], contextPolicy: { mode: 'disabled' } }
        ] },
        beat: 'Ordinary', selection: { maxChars: 100, compendiumIds: ['manual'], compendiumTags: ['chosen'] }
    });
    assert.deepEqual(context.compendiumEntries.map(entry => entry.id), ['always', 'manual', 'tag']);
    assert.deepEqual(Object.keys(context.includedEntryReasons), ['always', 'manual', 'tag']);
    assert.equal(context.budget.remaining, 0);
    assert.ok(context.budget.overBudgetChars > 0, 'forced context may exceed the soft cap transparently');
});

test('structured profile text is budgeted and dropped cards have no inclusion reason', () => {
    const context = Resolver.resolveContext({
        project: { compendium: [
            { ...character, characterProfile: { ...profile, knowledge: 'K'.repeat(500) }, contextPolicy: { mode: 'mention' } },
            { id: 'small', title: 'Small', body: 'small fact', contextPolicy: { mode: 'mention' } }
        ] }, beat: 'Mira and Small', selection: { maxChars: 100 }
    });
    assert.deepEqual(context.compendiumEntries.map(entry => entry.id), ['small']);
    assert.deepEqual(Object.keys(context.includedEntryReasons), ['small']);
});

test('manual scene and chapter references survive the soft cap before automatic cards', () => {
    for (const selection of [{ sceneIds: ['prior'] }, { chapterIds: ['chapter'] }]) {
        const result = Resolver.resolveContext({
            project: {
                scenes: [{ id: 'prior', chapterId: 'chapter', title: 'Prior', summary: 'S'.repeat(500) }],
                compendium: [{ id: 'auto', title: 'Auto', body: 'automatic fact', contextPolicy: { mode: 'mention' } }]
            }, beat: 'Auto', selection: { ...selection, maxChars: 50 }
        });
        assert.deepEqual(result.sceneSummaries.map(scene => scene.id), ['prior']);
        assert.deepEqual(result.compendiumEntries, []);
        assert.ok(result.budget.overBudgetChars > 0);
    }
});

function writerFixture() {
    const snapshotScene = { id: 'current', title: 'Current' };
    const liveScene = { ...snapshotScene, povCharacter: 'Mira', characters: ['Navigator'] };
    const compendium = [
        { ...character, contextPolicy: { mode: 'auto' } },
        { id: 'ada', title: 'Ada', aliases: ['Navigator'], summary: 'ADA_FACT', contextPolicy: { mode: 'auto' } },
        { id: 'large', title: 'Large', summary: 'LARGE_FACT', body: 'x'.repeat(6100), contextPolicy: { mode: 'mention' } }
    ];
    const elements = { beatInput: { value: 'Large' }, contextSummary: {} };
    const state = {
        snapshot: { project: { id: 'p' }, scenes: [snapshotScene], compendium, sceneContents: {} },
        generation: { beat: 'Large' }, context: { compendiumIds: [], compendiumTags: [], chapterModes: {}, sceneModes: {} }
    };
    const context = vm.createContext({
        nativeEditorState: state, nativeEditorElements: () => elements,
        currentNativeScene: () => liveScene, currentNativeChapter: () => null,
        nativeSceneContent: () => '', flushNativeEditorFields: () => {}, nativeAvoidanceInstruction: () => '',
        compendiumState: { entries: compendium },
        window: { DraftHarborContextResolver: Resolver, DraftHarborPromptBuilder: PromptBuilder }
    });
    for (const name of ['writer-prompts.js', 'writer-generation.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell', name), 'utf8'), context);
    }
    context.selectedPromptTemplate = () => ({});
    return { context, elements, state };
}

test('writer prompt and automatic reference preview use live POV and character fields', () => {
    const fixture = writerFixture();
    const prompt = fixture.context.buildNativePrompt().asString();
    fixture.context.renderNativeContextSummary();
    for (const name of ['Mira', 'Ada']) {
        assert.ok(prompt.includes('-- ' + name + ' --'), name + ' card reaches prompt');
        assert.ok(fixture.elements.contextSummary.textContent.includes(name), name + ' card appears in preview');
    }
    assert.ok(!prompt.includes('LARGE_FACT'));
    assert.ok(!fixture.elements.contextSummary.textContent.includes('Large'));
});

test('writer preview and prompt reserve the same manual cards before automatic references', () => {
    const fixture = writerFixture();
    fixture.state.context.compendiumIds = ['large', 'deleted-card'];
    const prompt = fixture.context.buildNativePrompt().asString();
    fixture.context.renderNativeContextSummary();
    assert.ok(prompt.includes('LARGE_FACT'));
    assert.ok(fixture.elements.contextSummary.textContent.includes('Large'));
    assert.ok(!prompt.includes('-- Mira --'), 'manual over-budget card leaves no room for automatic cards');
    assert.ok(!fixture.elements.contextSummary.textContent.includes('Mira'));
});
