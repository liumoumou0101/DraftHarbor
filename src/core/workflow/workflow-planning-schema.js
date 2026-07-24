(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./workflow-constraint-schema'));
    else root.DraftHarborWorkflowPlanningSchema = factory(root.DraftHarborWorkflowConstraintSchema);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ConstraintSchema) {
    function clean(value, fallback = '') { return String(value || fallback || '').trim(); }
    function list(value) { return Array.isArray(value) ? value : []; }
    function makeId(prefix, index) { return `${prefix}-${index + 1}`; }
    function uniqueStrings(value, limit = 30) { return [...new Set(list(value).map(clean).filter(Boolean))].slice(0, limit); }
    function fineOutlineLine(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return clean(value);
        const preferred = ['title', 'beat', 'action', 'event', 'description', 'detail', 'content', 'summary', 'purpose'];
        const parts = preferred
            .filter((key) => value[key] !== undefined)
            .map((key) => clean(value[key]))
            .filter(Boolean);
        if (parts.length) return [...new Set(parts)].join(' — ');
        return Object.values(value)
            .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
            .map(clean)
            .filter(Boolean)
            .join(' — ');
    }
    function boundedNumber(value, fallback = 0, maximum = 100) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(maximum, number)) : fallback;
    }

    function createDirectionSet(input = {}) {
        const directions = list(input.directions).slice(0, 4).map((item, index) => ({
            id: clean(item.id, makeId('direction', index)),
            title: clean(item.title, `方向 ${index + 1}`),
            premise: clean(item.premise || item.summary),
            plotFocus: clean(item.plotFocus),
            emotionalArc: clean(item.emotionalArc),
            risks: list(item.risks).map(clean).filter(Boolean)
        })).filter((item) => item.premise);
        if (directions.length < 2) throw new Error('direction set requires 2 to 4 directions');
        return { schemaVersion: 1, kind: 'direction-set', directions };
    }

    function mergeDirections(input, selectedIds, overrides = {}) {
        const set = createDirectionSet(input);
        const ids = new Set(list(selectedIds).map(clean));
        const selected = set.directions.filter((item) => ids.has(item.id));
        if (!selected.length) throw new Error('at least one direction must be selected');
        return {
            schemaVersion: 1,
            kind: 'selected-direction',
            sourceDirectionIds: selected.map((item) => item.id),
            title: clean(overrides.title, selected.map((item) => item.title).join(' + ')),
            premise: clean(overrides.premise, selected.map((item) => item.premise).join('\n')),
            plotFocus: clean(overrides.plotFocus, selected.map((item) => item.plotFocus).filter(Boolean).join('；')),
            emotionalArc: clean(overrides.emotionalArc, selected.map((item) => item.emotionalArc).filter(Boolean).join('；'))
        };
    }

    function createScenePlan(input = {}) {
        const fineOutlineEnabled = input.fineOutlineEnabled !== false;
        const scenes = list(input.scenes).map((item, index) => ({
            id: clean(item.id, makeId('planned-scene', index)),
            title: clean(item.title, `场景 ${index + 1}`),
            order: index,
            povCharacter: clean(item.povCharacter),
            location: clean(item.location),
            goal: clean(item.goal),
            conflict: clean(item.conflict),
            outcome: clean(item.outcome),
            emotionalBeat: clean(item.emotionalBeat),
            participants: uniqueStrings(item.participants || item.characters),
            turningPoint: clean(item.turningPoint),
            reveal: clean(item.reveal),
            hook: clean(item.hook || item.endingHook),
            emotionalStart: clean(item.emotionalStart),
            emotionalEnd: clean(item.emotionalEnd),
            pace: ['slow', 'medium', 'fast'].includes(clean(item.pace)) ? clean(item.pace) : 'medium',
            conflictIntensity: boundedNumber(item.conflictIntensity),
            informationDensity: boundedNumber(item.informationDensity),
            targetWords: Math.round(boundedNumber(item.targetWords, 0, 100000)),
            mustInclude: uniqueStrings(item.mustInclude),
            avoid: uniqueStrings(item.avoid),
            continuity: clean(item.continuity),
            fineOutline: fineOutlineEnabled ? list(item.fineOutline).map(fineOutlineLine).filter(Boolean) : []
        }));
        if (!scenes.length) throw new Error('scene plan requires at least one scene');
        return { schemaVersion: 1, kind: 'scene-plan', directionRevisionId: clean(input.directionRevisionId), fineOutlineEnabled, scenes };
    }

    function compileConstraintPrompt(inputs, context) {
        const snapshot = ConstraintSchema.createConstraintSnapshot(inputs, context);
        const lines = snapshot.constraints.map((item) => {
            const prefix = item.kind === 'exclusion' ? '禁止' : item.kind === 'fact' ? '事实' : '倾向';
            return `- [${prefix}/${item.enforcement}/权重${item.weight}] ${item.text}`;
        });
        return { snapshot, promptText: lines.join('\n') };
    }

    return { createDirectionSet, mergeDirections, createScenePlan, compileConstraintPrompt };
});
