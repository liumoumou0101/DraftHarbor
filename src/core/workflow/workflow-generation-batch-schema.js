(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowGenerationBatchSchema = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const BATCH_STATUSES = Object.freeze([
        'planning',
        'drafting',
        'reviewing',
        'waiting_decision',
        'completed',
        'cancelled',
        'failed'
    ]);
    const TERMINATION_REASONS = Object.freeze([
        '',
        'continued',
        'target_reached',
        'user_stopped',
        'review_blocked',
        'cancelled',
        'failed'
    ]);

    function clean(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function positiveInteger(value, fallback = 1) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    function nonNegativeInteger(value, fallback = 0) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 ? number : fallback;
    }

    function batchIdForSequence(sequence) {
        return `batch-${String(positiveInteger(sequence, 1)).padStart(4, '0')}`;
    }

    function countTextCharacters(value) {
        return clean(value).length;
    }

    function artifactRef(input = {}, options = {}) {
        const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        return {
            artifactId: clean(source.artifactId || source.id),
            revisionId: clean(source.revisionId),
            sceneId: clean(source.sceneId),
            sequence: nonNegativeInteger(source.sequence, options.sequence || 0),
            characters: nonNegativeInteger(source.characters, 0)
        };
    }

    function compactRef(input = {}, options = {}) {
        const ref = artifactRef(input, options);
        const result = {
            artifactId: ref.artifactId,
            revisionId: ref.revisionId
        };
        if (ref.sceneId) result.sceneId = ref.sceneId;
        if (ref.sequence) result.sequence = ref.sequence;
        if (ref.characters) result.characters = ref.characters;
        return result;
    }

    function createGenerationBatch(input = {}) {
        const sequence = positiveInteger(input.sequence, 1);
        const draftRefs = (Array.isArray(input.draftRefs) ? input.draftRefs : [])
            .map((item, index) => compactRef(item, { sequence: index + 1 }))
            .filter((item) => item.artifactId && item.revisionId);
        const derivedCharacters = draftRefs.reduce((sum, item) => sum + nonNegativeInteger(item.characters, 0), 0);
        const status = clean(input.status, 'planning');
        const terminationReason = clean(input.terminationReason);
        return {
            schemaVersion: 1,
            kind: 'generation-batch',
            batchId: clean(input.batchId, batchIdForSequence(sequence)),
            sequence,
            status: BATCH_STATUSES.includes(status) ? status : 'planning',
            targetCharacters: nonNegativeInteger(input.targetCharacters, 0),
            plannedCharacters: nonNegativeInteger(input.plannedCharacters, 0),
            suggestedSceneCount: nonNegativeInteger(input.suggestedSceneCount, 0),
            blueprintStage: clean(input.blueprintStage),
            userInstruction: clean(input.userInstruction),
            writingInstructionRef: compactRef(input.writingInstructionRef),
            planRef: compactRef(input.planRef),
            draftRefs,
            reviewRef: compactRef(input.reviewRef),
            rollingStateRef: compactRef(input.rollingStateRef),
            batchCharacters: nonNegativeInteger(input.batchCharacters, derivedCharacters),
            cumulativeCharacters: nonNegativeInteger(input.cumulativeCharacters, derivedCharacters),
            terminationReason: TERMINATION_REASONS.includes(terminationReason) ? terminationReason : '',
            createdAt: clean(input.createdAt),
            completedAt: clean(input.completedAt)
        };
    }

    function validateGenerationBatch(input = {}) {
        const batch = createGenerationBatch(input);
        const errors = [];
        if (!batch.batchId) errors.push('generation batch requires batchId');
        const requestedStatus = clean(input.status, 'planning');
        if (!BATCH_STATUSES.includes(requestedStatus)) errors.push(`unknown generation batch status: ${requestedStatus}`);
        const requestedTerminationReason = clean(input.terminationReason);
        if (!TERMINATION_REASONS.includes(requestedTerminationReason)) {
            errors.push(`unknown generation batch terminationReason: ${requestedTerminationReason}`);
        }
        if (batch.cumulativeCharacters < batch.batchCharacters) {
            errors.push('generation batch cumulativeCharacters cannot be smaller than batchCharacters');
        }
        const referencedCharacters = batch.draftRefs.reduce((sum, item) => sum + item.characters, 0);
        if (referencedCharacters && batch.batchCharacters !== referencedCharacters) {
            errors.push('generation batch batchCharacters must match draftRefs characters');
        }
        const refIds = new Set();
        for (const ref of batch.draftRefs) {
            const key = `${ref.artifactId}@${ref.revisionId}`;
            if (refIds.has(key)) errors.push(`duplicate generation batch draft ref: ${key}`);
            refIds.add(key);
        }
        if (['drafting', 'reviewing', 'waiting_decision', 'completed'].includes(batch.status)
            && (!batch.planRef.artifactId || !batch.planRef.revisionId)) {
            errors.push(`generation batch ${batch.status} status requires planRef`);
        }
        if (['reviewing', 'waiting_decision', 'completed'].includes(batch.status) && !batch.draftRefs.length) {
            errors.push(`generation batch ${batch.status} status requires draftRefs`);
        }
        if (['waiting_decision', 'completed'].includes(batch.status)
            && (!batch.reviewRef.artifactId || !batch.reviewRef.revisionId)) {
            errors.push(`generation batch ${batch.status} status requires reviewRef`);
        }
        if (batch.status === 'completed' && !batch.terminationReason) {
            errors.push('completed generation batch requires terminationReason');
        }
        return { ok: errors.length === 0, errors, batch };
    }

    function requireGenerationBatch(input = {}) {
        const validation = validateGenerationBatch(input);
        if (!validation.ok) throw new Error(`Invalid generation batch: ${validation.errors.join('; ')}`);
        return validation.batch;
    }

    function createGenerationBatchSet(inputs = []) {
        const batches = (Array.isArray(inputs) ? inputs : []).map((input) => requireGenerationBatch(input))
            .sort((left, right) => left.sequence - right.sequence);
        const ids = new Set();
        const sequences = new Set();
        let previousCumulative = 0;
        for (const batch of batches) {
            if (ids.has(batch.batchId)) throw new Error(`duplicate generation batch id: ${batch.batchId}`);
            if (sequences.has(batch.sequence)) throw new Error(`duplicate generation batch sequence: ${batch.sequence}`);
            if (batch.cumulativeCharacters < previousCumulative) {
                throw new Error(`generation batch cumulativeCharacters must not decrease: ${batch.batchId}`);
            }
            ids.add(batch.batchId);
            sequences.add(batch.sequence);
            previousCumulative = batch.cumulativeCharacters;
        }
        return batches;
    }

    return {
        BATCH_STATUSES,
        TERMINATION_REASONS,
        batchIdForSequence,
        countTextCharacters,
        artifactRef,
        createGenerationBatch,
        validateGenerationBatch,
        requireGenerationBatch,
        createGenerationBatchSet
    };
});
