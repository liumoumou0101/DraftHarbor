(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('../knowledge/compendium-schema'),
            require('./workflow-planning-schema')
        );
    } else {
        root.DraftHarborWorkflowCreationSchema = factory(
            root.DraftHarborCompendiumSchema,
            root.DraftHarborWorkflowPlanningSchema
        );
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CompendiumSchema, PlanningSchema) {
    function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
    function list(value) { return Array.isArray(value) ? value : []; }
    function strings(value, limit = 30) { return [...new Set(list(value).map((item) => clean(item)).filter(Boolean))].slice(0, limit); }
    function positiveInteger(value, fallback = 0) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    function createCreationBrief(input = {}) {
        const premise = clean(input.premise || input.coreIdea || input.inspiration);
        if (!premise) throw new Error('creation brief requires a premise or core idea');
        return {
            schemaVersion: 1,
            kind: 'creation-brief',
            workingTitle: clean(input.workingTitle || input.title, '未命名新作'),
            premise,
            genre: clean(input.genre),
            audience: clean(input.audience),
            targetLength: positiveInteger(input.targetLength || input.targetWords),
            themes: strings(input.themes, 12),
            tone: clean(input.tone),
            pov: clean(input.pov),
            setting: clean(input.setting),
            endingPreference: clean(input.endingPreference),
            mustInclude: strings(input.mustInclude),
            avoid: strings(input.avoid),
            notes: clean(input.notes)
        };
    }

    function createStoryBlueprint(input = {}) {
        const conflictInput = input.centralConflict && typeof input.centralConflict === 'object' ? input.centralConflict : {};
        const centralConflict = {
            protagonistGoal: clean(conflictInput.protagonistGoal || input.protagonistGoal),
            opposingForce: clean(conflictInput.opposingForce || input.opposingForce),
            stakes: clean(conflictInput.stakes || input.stakes),
            dilemma: clean(conflictInput.dilemma || input.dilemma)
        };
        if (!clean(input.logline) || !centralConflict.protagonistGoal || !centralConflict.opposingForce || !centralConflict.stakes) {
            throw new Error('story blueprint requires logline and a complete central conflict');
        }
        const acts = list(input.acts || input.structure).slice(0, 12).map((act, index) => ({
            id: clean(act.id, `act-${index + 1}`),
            title: clean(act.title, `阶段 ${index + 1}`),
            purpose: clean(act.purpose || act.summary),
            turningPoint: clean(act.turningPoint),
            emotionalDirection: clean(act.emotionalDirection)
        })).filter((act) => act.purpose || act.turningPoint);
        if (!acts.length) throw new Error('story blueprint requires at least one structural stage');
        return {
            schemaVersion: 1,
            kind: 'story-blueprint',
            title: clean(input.title, '未命名故事方案'),
            logline: clean(input.logline),
            themes: strings(input.themes, 12),
            centralConflict,
            acts,
            characterArcs: list(input.characterArcs).slice(0, 20).map((arc, index) => ({
                id: clean(arc.id, `arc-${index + 1}`),
                character: clean(arc.character || arc.title),
                start: clean(arc.start),
                change: clean(arc.change),
                end: clean(arc.end)
            })).filter((arc) => arc.character),
            worldRules: strings(input.worldRules, 30),
            endingDirection: clean(input.endingDirection)
        };
    }

    function createCompendiumDraftBundle(input = {}, options = {}) {
        const rawEntries = list(input.entries || input.cards);
        if (!rawEntries.length) throw new Error('compendium draft bundle requires at least one entry');
        const projectId = clean(options.projectId || input.projectId);
        const seen = new Set();
        const entries = rawEntries.slice(0, 40).map((entry, index) => {
            if (!clean(entry && entry.title)) throw new Error(`compendium draft ${index + 1} requires a title`);
            const normalized = CompendiumSchema.createCompendiumEntry({
                ...entry,
                id: clean(entry.id, `creation-card-${index + 1}`),
                projectId,
                contextPolicy: { mode: 'manual' }
            });
            if (seen.has(normalized.id)) throw new Error(`duplicate compendium draft id: ${normalized.id}`);
            seen.add(normalized.id);
            return {
                id: normalized.id,
                type: normalized.type,
                title: normalized.title,
                summary: normalized.summary,
                body: normalized.body,
                tags: normalized.tags,
                aliases: normalized.aliases,
                characterProfile: normalized.characterProfile
            };
        });
        return { schemaVersion: 1, kind: 'compendium-draft-bundle', projectId, entries };
    }

    function createCreationPackage(input = {}, options = {}) {
        return {
            schemaVersion: 1,
            kind: 'creation-package',
            brief: createCreationBrief(input.brief),
            blueprint: createStoryBlueprint(input.blueprint),
            compendium: createCompendiumDraftBundle(input.compendium, options),
            scenePlan: PlanningSchema.createScenePlan(input.scenePlan)
        };
    }

    return { createCreationBrief, createStoryBlueprint, createCompendiumDraftBundle, createCreationPackage };
});
