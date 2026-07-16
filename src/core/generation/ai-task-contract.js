(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborAITaskContract = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DOMAINS = Object.freeze(['prose', 'compendium', 'summary', 'style-guard', 'workflow']);
    const ACTIONS = Object.freeze([
        'generate',
        'rewrite',
        'regenerate-selection',
        'draw',
        'extract',
        'update',
        'summarize',
        'repair'
    ]);
    const SCOPES = Object.freeze([
        'selection',
        'field',
        'fields',
        'body',
        'whole-card',
        'scene',
        'chapter',
        'project'
    ]);
    const OUTPUT_CONTRACTS = Object.freeze(['text', 'field-patch', 'card-drafts', 'summary']);
    const STATUSES = Object.freeze(['draft', 'running', 'succeeded', 'failed', 'cancelled', 'applied', 'discarded']);
    const DOMAIN_ACTIONS = Object.freeze({
        prose: Object.freeze(['generate', 'rewrite', 'regenerate-selection']),
        compendium: Object.freeze(['draw', 'rewrite', 'extract', 'update']),
        summary: Object.freeze(['summarize']),
        'style-guard': Object.freeze(['repair']),
        workflow: Object.freeze(['generate', 'rewrite', 'extract', 'summarize'])
    });
    const DOMAIN_OUTPUTS = Object.freeze({
        prose: Object.freeze(['text']),
        compendium: Object.freeze(['field-patch', 'card-drafts']),
        summary: Object.freeze(['summary']),
        'style-guard': Object.freeze(['text']),
        workflow: Object.freeze(['text', 'summary'])
    });
    const DOMAIN_ACTION_OUTPUTS = Object.freeze({
        prose: Object.freeze({
            generate: Object.freeze(['text']),
            rewrite: Object.freeze(['text']),
            'regenerate-selection': Object.freeze(['text'])
        }),
        compendium: Object.freeze({
            draw: Object.freeze(['card-drafts']),
            rewrite: Object.freeze(['field-patch']),
            extract: Object.freeze(['card-drafts']),
            update: Object.freeze(['field-patch'])
        }),
        summary: Object.freeze({
            summarize: Object.freeze(['summary'])
        }),
        'style-guard': Object.freeze({
            repair: Object.freeze(['text'])
        }),
        workflow: Object.freeze({
            generate: Object.freeze(['text', 'summary']),
            rewrite: Object.freeze(['text']),
            extract: Object.freeze(['text', 'summary']),
            summarize: Object.freeze(['summary'])
        })
    });

    function cleanString(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const result = [];
        for (const value of Array.isArray(values) ? values : []) {
            const text = cleanString(value);
            if (!text || seen.has(text)) continue;
            seen.add(text);
            result.push(text);
        }
        return result;
    }

    function clonePlain(value) {
        if (Array.isArray(value)) return value.map(clonePlain);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
        return result;
    }

    function makeTaskId() {
        return `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function normalizeArtifactTypeRef(input) {
        if (typeof input === 'string') {
            const match = input.trim().match(/^(.+?)(?:@(\d+))?$/);
            return { id: match ? cleanString(match[1]) : '', version: match && match[2] ? Number(match[2]) : 1 };
        }
        const source = input && typeof input === 'object' ? input : {};
        const version = Number(source.version || source.schemaVersion || 1);
        return {
            id: cleanString(source.id || source.type || source.artifactType),
            version: Number.isInteger(version) && version > 0 ? version : 1
        };
    }

    function normalizeAITask(input = {}) {
        const now = new Date().toISOString();
        return {
            id: cleanString(input.id) || makeTaskId(),
            projectId: cleanString(input.projectId),
            domain: cleanString(input.domain),
            action: cleanString(input.action),
            target: input.target && typeof input.target === 'object' && !Array.isArray(input.target)
                ? clonePlain(input.target)
                : {},
            scope: cleanString(input.scope),
            presetId: cleanString(input.presetId),
            instruction: cleanString(input.instruction),
            contextReferences: Array.isArray(input.contextReferences)
                ? input.contextReferences.map(clonePlain)
                : [],
            providerProfileId: cleanString(input.providerProfileId),
            model: cleanString(input.model),
            capabilityId: cleanString(input.capabilityId),
            capabilityVersion: Number.isInteger(Number(input.capabilityVersion)) && Number(input.capabilityVersion) > 0
                ? Number(input.capabilityVersion)
                : 1,
            outputArtifactType: normalizeArtifactTypeRef(input.outputArtifactType || input.artifactType),
            outputContract: cleanString(input.outputContract),
            activeAvoidanceRuleIds: uniqueStrings(input.activeAvoidanceRuleIds),
            beforeSnapshot: input.beforeSnapshot === undefined ? null : clonePlain(input.beforeSnapshot),
            status: cleanString(input.status) || 'draft',
            createdAt: cleanString(input.createdAt) || now,
            finishedAt: cleanString(input.finishedAt)
        };
    }

    function validateAITask(input = {}) {
        const task = normalizeAITask(input);
        const errors = [];
        if (!task.projectId) errors.push('projectId is required');
        if (!DOMAINS.includes(task.domain)) errors.push(`unsupported domain: ${task.domain || '(empty)'}`);
        if (!ACTIONS.includes(task.action)) errors.push(`unsupported action: ${task.action || '(empty)'}`);
        if (!SCOPES.includes(task.scope)) errors.push(`unsupported scope: ${task.scope || '(empty)'}`);
        if (!OUTPUT_CONTRACTS.includes(task.outputContract)) {
            errors.push(`unsupported output contract: ${task.outputContract || '(empty)'}`);
        }
        if (!STATUSES.includes(task.status)) errors.push(`unsupported status: ${task.status || '(empty)'}`);
        if (!Object.keys(task.target).length) errors.push('target is required');
        if (DOMAIN_ACTIONS[task.domain] && !DOMAIN_ACTIONS[task.domain].includes(task.action)) {
            errors.push(`action ${task.action} is not supported for domain ${task.domain}`);
        }
        if (DOMAIN_OUTPUTS[task.domain] && !DOMAIN_OUTPUTS[task.domain].includes(task.outputContract)) {
            errors.push(`output ${task.outputContract} is not supported for domain ${task.domain}`);
        }
        const actionOutputs = DOMAIN_ACTION_OUTPUTS[task.domain] && DOMAIN_ACTION_OUTPUTS[task.domain][task.action];
        if (actionOutputs && !actionOutputs.includes(task.outputContract)) {
            errors.push(`output ${task.outputContract} is not supported for ${task.domain}/${task.action}`);
        }
        if (task.domain === 'workflow') {
            if (!task.capabilityId) errors.push('workflow capabilityId is required');
            if (!task.outputArtifactType.id) errors.push('workflow outputArtifactType is required');
        }
        return { ok: errors.length === 0, errors, task };
    }

    function createAITask(input = {}) {
        const validation = validateAITask(input);
        if (!validation.ok) {
            const error = new Error(`Invalid AI task: ${validation.errors.join('; ')}`);
            error.name = 'AITaskValidationError';
            error.errors = validation.errors.slice();
            throw error;
        }
        return validation.task;
    }

    function taskTargetKey(input = {}) {
        const task = normalizeAITask(input);
        const target = task.target || {};
        const targetType = cleanString(target.type) || task.scope || 'target';
        const targetId = cleanString(
            target.id
            || target.sceneId
            || target.entryId
            || target.chapterId
            || target.projectId
            || task.projectId
        );
        return [task.projectId, task.domain, targetType, targetId].join(':');
    }

    return {
        DOMAINS,
        ACTIONS,
        SCOPES,
        OUTPUT_CONTRACTS,
        STATUSES,
        DOMAIN_ACTIONS,
        DOMAIN_OUTPUTS,
        DOMAIN_ACTION_OUTPUTS,
        normalizeAITask,
        normalizeArtifactTypeRef,
        validateAITask,
        createAITask,
        taskTargetKey
    };
});
