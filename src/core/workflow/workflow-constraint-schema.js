(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborWorkflowConstraintSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CONSTRAINT_KINDS = Object.freeze(['direction', 'exclusion', 'fact']);
    const ENFORCEMENT_LEVELS = Object.freeze(['soft', 'hard']);
    const CONSTRAINT_SCOPES = Object.freeze(['project', 'workflow', 'node']);
    const CONSTRAINT_CATEGORIES = Object.freeze([
        'plot',
        'character',
        'worldbuilding',
        'pacing',
        'style',
        'content_boundary'
    ]);
    const FACT_SOURCE_LEVELS = Object.freeze([
        'author_locked',
        'official_compendium',
        'active_plan',
        'confirmed_manuscript_fact',
        'ai_inference',
        'rolling_state',
        'workflow_draft'
    ]);

    const SOURCE_PRECEDENCE = Object.freeze({
        author_locked: 70,
        official_compendium: 60,
        active_plan: 50,
        confirmed_manuscript_fact: 50,
        ai_inference: 20,
        rolling_state: 20,
        workflow_draft: 10
    });
    const SCOPE_PRECEDENCE = Object.freeze({ project: 10, workflow: 20, node: 30 });
    const KIND_PRECEDENCE = Object.freeze({ direction: 10, exclusion: 10, fact: 20 });

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function clonePlain(value) {
        if (Array.isArray(value)) return value.map(clonePlain);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
        return result;
    }

    function nowIso(value = '') {
        if (value) {
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
        return new Date().toISOString();
    }

    function makeId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function normalizeEnum(value, allowed, fallback) {
        const normalized = cleanString(value, fallback);
        return allowed.includes(normalized) ? normalized : fallback;
    }

    function normalizeWeight(value, fallback = 3) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(1, Math.min(5, Math.round(number)));
    }

    function uniqueStrings(values) {
        const result = [];
        const seen = new Set();
        for (const value of Array.isArray(values) ? values : []) {
            const normalized = cleanString(value);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            result.push(normalized);
        }
        return result;
    }

    function defaultEnforcement(kind, sourceLevel, requested) {
        if (kind !== 'fact') return normalizeEnum(requested, ENFORCEMENT_LEVELS, 'soft');
        if (['ai_inference', 'rolling_state', 'workflow_draft'].includes(sourceLevel)) return 'soft';
        return 'hard';
    }

    function createCreativeConstraint(input = {}) {
        const kind = normalizeEnum(input.kind, CONSTRAINT_KINDS, 'direction');
        const sourceLevel = normalizeEnum(
            input.sourceLevel,
            FACT_SOURCE_LEVELS,
            kind === 'fact' ? 'workflow_draft' : 'author_locked'
        );
        const scope = normalizeEnum(input.scope, CONSTRAINT_SCOPES, 'project');
        const now = nowIso(input.updatedAt || input.createdAt);
        return {
            id: cleanString(input.id) || makeId('workflow-constraint'),
            projectId: cleanString(input.projectId),
            runId: scope === 'project' ? '' : cleanString(input.runId),
            nodeId: scope === 'node' ? cleanString(input.nodeId) : '',
            kind,
            text: cleanString(input.text || input.content),
            weight: normalizeWeight(input.weight),
            enforcement: defaultEnforcement(kind, sourceLevel, input.enforcement),
            scope,
            category: normalizeEnum(input.category, CONSTRAINT_CATEGORIES, 'plot'),
            sourceLevel,
            sourceReferences: uniqueStrings(input.sourceReferences),
            enabled: input.enabled !== false,
            createdAt: nowIso(input.createdAt || now),
            updatedAt: now
        };
    }

    function validateCreativeConstraint(input = {}) {
        const constraint = createCreativeConstraint(input);
        const errors = [];
        if (!constraint.projectId) errors.push('constraint projectId is required');
        if (!constraint.text) errors.push('constraint text is required');
        if (constraint.scope === 'workflow' && !constraint.runId) {
            errors.push('workflow constraint runId is required');
        }
        if (constraint.scope === 'node') {
            if (!constraint.runId) errors.push('node constraint runId is required');
            if (!constraint.nodeId) errors.push('node constraint nodeId is required');
        }
        return { ok: errors.length === 0, errors, constraint };
    }

    function constraintPrecedence(input = {}) {
        const constraint = createCreativeConstraint(input);
        return (
            (KIND_PRECEDENCE[constraint.kind] || 0) * 100000
            + (constraint.enforcement === 'hard' ? 1 : 0) * 10000
            + (SCOPE_PRECEDENCE[constraint.scope] || 0) * 100
            + (SOURCE_PRECEDENCE[constraint.sourceLevel] || 0) * 10
            + constraint.weight
        );
    }

    function isConstraintInScope(constraint, context) {
        if (!constraint.enabled || constraint.projectId !== cleanString(context.projectId)) return false;
        if (constraint.scope === 'project') return true;
        if (constraint.runId !== cleanString(context.runId)) return false;
        if (constraint.scope === 'workflow') return true;
        return constraint.nodeId === cleanString(context.nodeId);
    }

    function resolveConstraints(inputs = [], context = {}) {
        const constraints = (Array.isArray(inputs) ? inputs : []).map(createCreativeConstraint);
        return constraints
            .filter((constraint) => isConstraintInScope(constraint, context))
            .sort((left, right) => {
                const priority = constraintPrecedence(right) - constraintPrecedence(left);
                if (priority !== 0) return priority;
                return left.id.localeCompare(right.id);
            });
    }

    function comparableText(value) {
        return cleanString(value).replace(/\s+/g, ' ').toLocaleLowerCase();
    }

    function detectConstraintConflicts(inputs = []) {
        const constraints = (Array.isArray(inputs) ? inputs : [])
            .map(createCreativeConstraint)
            .filter((constraint) => constraint.enabled);
        const directionByText = new Map();
        const exclusionByText = new Map();
        for (const constraint of constraints) {
            const key = comparableText(constraint.text);
            if (!key) continue;
            const target = constraint.kind === 'direction'
                ? directionByText
                : (constraint.kind === 'exclusion' ? exclusionByText : null);
            if (!target) continue;
            if (!target.has(key)) target.set(key, []);
            target.get(key).push(constraint.id);
        }
        const conflicts = [];
        for (const [text, directionIds] of directionByText.entries()) {
            const exclusionIds = exclusionByText.get(text);
            if (!exclusionIds) continue;
            conflicts.push({
                type: 'direction_exclusion_collision',
                text,
                constraintIds: [...directionIds, ...exclusionIds]
            });
        }
        return conflicts;
    }

    function createConstraintSnapshot(inputs = [], context = {}, options = {}) {
        const constraints = resolveConstraints(inputs, context);
        return {
            schemaVersion: 1,
            id: cleanString(options.id) || makeId('constraint-snapshot'),
            projectId: cleanString(context.projectId),
            runId: cleanString(context.runId),
            nodeId: cleanString(context.nodeId),
            digest: cleanString(options.digest),
            capturedAt: nowIso(options.capturedAt),
            constraints: clonePlain(constraints),
            conflicts: detectConstraintConflicts(constraints)
        };
    }

    return {
        CONSTRAINT_KINDS,
        ENFORCEMENT_LEVELS,
        CONSTRAINT_SCOPES,
        CONSTRAINT_CATEGORIES,
        FACT_SOURCE_LEVELS,
        SOURCE_PRECEDENCE,
        createCreativeConstraint,
        validateCreativeConstraint,
        constraintPrecedence,
        resolveConstraints,
        detectConstraintConflicts,
        createConstraintSnapshot
    };
});
