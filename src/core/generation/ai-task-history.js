(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./ai-task-contract'),
            require('./generation-history')
        );
    } else {
        root.DraftHarborAITaskHistory = factory(
            root.DraftHarborAITaskContract,
            root.DraftHarborGenerationHistory
        );
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (AITaskContract, GenerationHistory) {
    function clonePlain(value) {
        if (Array.isArray(value)) return value.map(clonePlain);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
        return result;
    }

    function cleanError(error) {
        if (!error) return null;
        return {
            code: error.code || 'generation_error',
            message: error.message || String(error),
            provider: error.provider || '',
            model: error.model || ''
        };
    }

    function createAITaskRecord(input = {}) {
        const task = AITaskContract.normalizeAITask(input.task || {});
        const now = new Date().toISOString();
        const status = input.status || task.status || 'draft';
        return {
            id: input.id || `ai-task-record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            taskId: task.id,
            projectId: task.projectId,
            domain: task.domain,
            action: task.action,
            target: clonePlain(task.target),
            scope: task.scope,
            outputContract: task.outputContract,
            status,
            presetId: task.presetId,
            instruction: task.instruction,
            contextReferences: clonePlain(task.contextReferences),
            beforeSnapshot: clonePlain(task.beforeSnapshot),
            providerProfileId: task.providerProfileId,
            provider: input.provider || '',
            model: input.model || task.model || '',
            activeAvoidanceRuleIds: task.activeAvoidanceRuleIds.slice(),
            messages: clonePlain(input.messages || []),
            promptText: input.promptText || '',
            resultText: input.resultText || '',
            resultData: input.resultData === undefined ? null : clonePlain(input.resultData),
            reasoning: input.reasoning || '',
            error: cleanError(input.error),
            startedAt: input.startedAt || task.createdAt || now,
            finishedAt: input.finishedAt || '',
            createdAt: input.createdAt || now
        };
    }

    function toLegacyGenerationRecord(taskRecord, overrides = {}) {
        const record = taskRecord || {};
        const target = record.target || {};
        const input = {
            id: overrides.id || record.id,
            projectId: overrides.projectId || record.projectId || '',
            sceneId: overrides.sceneId || target.sceneId || '',
            task: overrides.task || record.action || 'generation',
            beat: overrides.beat || record.instruction || '',
            provider: record.provider || '',
            model: record.model || '',
            messages: record.messages || [],
            promptText: record.promptText || '',
            resultText: overrides.resultText === undefined ? (record.resultText || '') : overrides.resultText,
            reasoning: record.reasoning || '',
            error: record.error || null,
            createdAt: record.createdAt || record.finishedAt || record.startedAt
        };
        const legacy = GenerationHistory && typeof GenerationHistory.createGenerationRecord === 'function'
            ? GenerationHistory.createGenerationRecord(input)
            : input;
        legacy.aiTask = {
            taskId: record.taskId || '',
            domain: record.domain || '',
            action: record.action || '',
            target: clonePlain(record.target || {}),
            scope: record.scope || '',
            outputContract: record.outputContract || '',
            status: record.status || '',
            presetId: record.presetId || '',
            contextReferences: clonePlain(record.contextReferences || []),
            beforeSnapshot: clonePlain(record.beforeSnapshot),
            resultData: record.outputContract === 'text' || record.outputContract === 'summary'
                ? null
                : clonePlain(record.resultData),
            activeAvoidanceRuleIds: Array.isArray(record.activeAvoidanceRuleIds)
                ? record.activeAvoidanceRuleIds.slice()
                : [],
            startedAt: record.startedAt || '',
            finishedAt: record.finishedAt || ''
        };
        return legacy;
    }

    return {
        createAITaskRecord,
        toLegacyGenerationRecord
    };
});
