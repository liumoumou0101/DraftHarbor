(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowVariantSchema = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
    function list(value) { return Array.isArray(value) ? value : []; }

    function createVariantItem(input = {}, index = 0) {
        const item = {
            scopeKey: clean(input.scopeKey || input.targetSceneId, `scope-${index + 1}`),
            title: clean(input.title, `场景 ${index + 1}`),
            targetSceneId: clean(input.targetSceneId),
            artifactId: clean(input.artifactId),
            revisionId: clean(input.revisionId)
        };
        if (!item.scopeKey || !item.artifactId || !item.revisionId) throw new Error(`variant item ${index + 1} requires scopeKey, artifactId and revisionId`);
        return item;
    }

    function createVariantManifest(input = {}) {
        const variantId = clean(input.variantId || input.id);
        if (!variantId) throw new Error('variant manifest requires variantId');
        const seen = new Set();
        const items = list(input.items).map(createVariantItem).map((item) => {
            if (seen.has(item.scopeKey)) throw new Error(`duplicate variant scope: ${item.scopeKey}`);
            seen.add(item.scopeKey);
            return item;
        });
        if (!items.length) throw new Error('variant manifest requires at least one item');
        return {
            schemaVersion: 1, kind: 'workflow-variant', variantId,
            label: clean(input.label, variantId), runId: clean(input.runId), templateId: clean(input.templateId), nodeId: clean(input.nodeId),
            parentVariantId: clean(input.parentVariantId), items
        };
    }

    function compareVariantManifests(leftInput, rightInput) {
        const left = createVariantManifest(leftInput);
        const right = createVariantManifest(rightInput);
        const leftItems = new Map(left.items.map((item) => [item.scopeKey, item]));
        const rightItems = new Map(right.items.map((item) => [item.scopeKey, item]));
        const scopeKeys = [...new Set([...leftItems.keys(), ...rightItems.keys()])];
        return {
            schemaVersion: 1, kind: 'workflow-variant-comparison',
            left: { variantId: left.variantId, label: left.label }, right: { variantId: right.variantId, label: right.label },
            scopes: scopeKeys.map((scopeKey) => ({
                scopeKey, left: leftItems.get(scopeKey) || null, right: rightItems.get(scopeKey) || null,
                state: !leftItems.has(scopeKey) ? 'right_only' : !rightItems.has(scopeKey) ? 'left_only'
                    : leftItems.get(scopeKey).revisionId === rightItems.get(scopeKey).revisionId ? 'same' : 'changed'
            }))
        };
    }

    function createVariantSelection(input = {}, manifests = []) {
        const byVariant = new Map(list(manifests).map(createVariantManifest).map((manifest) => [manifest.variantId, manifest]));
        const seen = new Set();
        const selections = list(input.selections).map((selection, index) => {
            const variant = byVariant.get(clean(selection.variantId));
            const scopeKey = clean(selection.scopeKey);
            if (!variant || !scopeKey) throw new Error(`variant selection ${index + 1} is invalid`);
            const item = variant.items.find((candidate) => candidate.scopeKey === scopeKey);
            if (!item) throw new Error(`variant ${variant.variantId} does not contain scope ${scopeKey}`);
            if (seen.has(scopeKey)) throw new Error(`duplicate selected scope: ${scopeKey}`);
            seen.add(scopeKey);
            return { scopeKey, variantId: variant.variantId, ...item };
        });
        if (!selections.length) throw new Error('variant selection requires at least one scope');
        return { schemaVersion: 1, kind: 'workflow-variant-selection', selections };
    }

    return { createVariantItem, createVariantManifest, compareVariantManifests, createVariantSelection };
});
