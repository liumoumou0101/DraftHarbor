(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowRewriteSchema = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const RULE_KINDS = Object.freeze(['preserve', 'delete', 'compress', 'expand', 'reorder', 'style', 'perspective', 'tone']);

    function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
    function list(value) { return Array.isArray(value) ? value : []; }
    function strings(value, limit = 60) { return [...new Set(list(value).map((item) => clean(item)).filter(Boolean))].slice(0, limit); }
    function positiveInteger(value, fallback = 0) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    function createRewriteBrief(input = {}) {
        const instruction = clean(input.instruction || input.goal || input.objective);
        if (!instruction) throw new Error('rewrite brief requires an instruction');
        return {
            schemaVersion: 1,
            kind: 'rewrite-brief',
            instruction,
            targetStyle: clean(input.targetStyle || input.style),
            targetTone: clean(input.targetTone || input.tone),
            targetPov: clean(input.targetPov || input.pov),
            targetTense: clean(input.targetTense || input.tense),
            targetLengthRatio: Math.max(0.1, Math.min(5, Number(input.targetLengthRatio) || 1)),
            preserve: strings(input.preserve || input.mustPreserve),
            remove: strings(input.remove || input.mustRemove),
            notes: clean(input.notes)
        };
    }

    function sourceSceneIds(sourceSnapshot = {}) {
        return new Set(list(sourceSnapshot.content).map((entry) => clean(entry && entry.sceneId)).filter(Boolean));
    }

    function createRewritePlan(input = {}, options = {}) {
        const available = sourceSceneIds(options.sourceSnapshot || input.sourceSnapshot);
        const seenTargets = new Set();
        const units = list(input.units).slice(0, 200).map((unit, index) => {
            const sourceIds = strings(unit.sourceSceneIds || [unit.sourceSceneId || unit.sceneId], 20);
            const targetSceneId = clean(unit.targetSceneId || unit.sceneId || sourceIds[0]);
            if (!sourceIds.length || !targetSceneId) throw new Error(`rewrite unit ${index + 1} requires source and target scene ids`);
            if (available.size && sourceIds.some((sceneId) => !available.has(sceneId))) throw new Error(`rewrite unit ${index + 1} references a scene outside the source snapshot`);
            if (available.size && !available.has(targetSceneId)) throw new Error(`rewrite unit ${index + 1} target is outside the source snapshot`);
            if (seenTargets.has(targetSceneId)) throw new Error(`duplicate rewrite target scene: ${targetSceneId}`);
            seenTargets.add(targetSceneId);
            const rules = list(unit.rules || unit.operations).slice(0, 30).map((rule) => ({
                kind: RULE_KINDS.includes(clean(rule && (rule.kind || rule.operation))) ? clean(rule.kind || rule.operation) : 'preserve',
                instruction: clean(rule && (rule.instruction || rule.text || rule.target)),
                weight: Math.max(0, Math.min(5, Number(rule && rule.weight) || 1))
            })).filter((rule) => rule.instruction);
            return {
                id: clean(unit.id, `rewrite-unit-${index + 1}`),
                sequence: index,
                title: clean(unit.title, `重写单元 ${index + 1}`),
                sourceSceneIds: sourceIds,
                targetSceneId,
                objective: clean(unit.objective || unit.goal),
                rules,
                preserveFacts: strings(unit.preserveFacts || unit.mustPreserve),
                removeElements: strings(unit.removeElements || unit.mustRemove),
                targetWords: positiveInteger(unit.targetWords),
                bridgeBefore: clean(unit.bridgeBefore),
                bridgeAfter: clean(unit.bridgeAfter),
                continuityRequirements: strings(unit.continuityRequirements)
            };
        });
        if (!units.length) throw new Error('rewrite plan requires at least one unit');
        return {
            schemaVersion: 1,
            kind: 'rewrite-plan',
            strategy: clean(input.strategy || input.summary),
            sourceRevisionId: clean(options.sourceRevisionId || input.sourceRevisionId),
            units
        };
    }

    function createRewriteUnitResult(input = {}) {
        const text = clean(input.text || input.content);
        if (!clean(input.unitId) || !clean(input.targetSceneId) || !text) throw new Error('rewrite result requires unitId, targetSceneId and text');
        return {
            schemaVersion: 1,
            kind: 'rewrite-unit-result',
            unitId: clean(input.unitId),
            targetSceneId: clean(input.targetSceneId),
            text,
            repairApplied: input.repairApplied === true,
            notes: clean(input.notes)
        };
    }

    function paragraphs(value) {
        const text = String(value || '').replace(/\r\n/g, '\n').trim();
        return text ? text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean) : [];
    }

    function coarseDiff(before, after) {
        let prefix = 0;
        while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
        let suffix = 0;
        while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
        return [
            ...before.slice(0, prefix).map((text) => ({ type: 'equal', text })),
            ...before.slice(prefix, before.length - suffix).map((text) => ({ type: 'delete', text })),
            ...after.slice(prefix, after.length - suffix).map((text) => ({ type: 'insert', text })),
            ...before.slice(before.length - suffix).map((text) => ({ type: 'equal', text }))
        ];
    }

    function paragraphDiff(before, after) {
        if (before.length * after.length > 40000) return coarseDiff(before, after);
        const table = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
        for (let left = before.length - 1; left >= 0; left -= 1) {
            for (let right = after.length - 1; right >= 0; right -= 1) {
                table[left][right] = before[left] === after[right]
                    ? table[left + 1][right + 1] + 1
                    : Math.max(table[left + 1][right], table[left][right + 1]);
            }
        }
        const operations = [];
        let left = 0;
        let right = 0;
        while (left < before.length || right < after.length) {
            if (left < before.length && right < after.length && before[left] === after[right]) {
                operations.push({ type: 'equal', text: before[left] }); left += 1; right += 1;
            } else if (right < after.length && (left === before.length || table[left][right + 1] >= table[left + 1][right])) {
                operations.push({ type: 'insert', text: after[right] }); right += 1;
            } else {
                operations.push({ type: 'delete', text: before[left] }); left += 1;
            }
        }
        return operations;
    }

    function createRewriteDiff(original, rewritten, options = {}) {
        const beforeText = String(original || '');
        const afterText = String(rewritten || '');
        const operations = paragraphDiff(paragraphs(beforeText), paragraphs(afterText));
        return {
            schemaVersion: 1,
            kind: 'rewrite-diff',
            unitId: clean(options.unitId),
            targetSceneId: clean(options.targetSceneId),
            originalCharacters: beforeText.length,
            rewrittenCharacters: afterText.length,
            characterDelta: afterText.length - beforeText.length,
            operations,
            counts: {
                unchanged: operations.filter((item) => item.type === 'equal').length,
                inserted: operations.filter((item) => item.type === 'insert').length,
                deleted: operations.filter((item) => item.type === 'delete').length
            }
        };
    }

    function createRewriteBatchComparison(sourceSnapshot = {}, results = []) {
        const sourceByScene = new Map(list(sourceSnapshot.content).map((entry) => [clean(entry.sceneId), entry]));
        const comparisons = list(results).map(createRewriteUnitResult).map((result) => {
            const source = sourceByScene.get(result.targetSceneId);
            if (!source) throw new Error(`rewrite comparison source scene not found: ${result.targetSceneId}`);
            return { result, diff: createRewriteDiff(source.content, result.text, result) };
        });
        return { schemaVersion: 1, kind: 'rewrite-batch-comparison', comparisons };
    }

    return { RULE_KINDS, createRewriteBrief, createRewritePlan, createRewriteUnitResult, createRewriteDiff, createRewriteBatchComparison };
});
