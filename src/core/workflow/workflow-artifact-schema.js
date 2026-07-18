(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborWorkflowArtifactSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const REVIEW_STATES = Object.freeze(['draft', 'waiting_review', 'approved', 'rejected']);
    const FRESHNESS_STATES = Object.freeze(['fresh', 'stale']);
    const APPLICATION_STATES = Object.freeze(['unapplied', 'partially_applied', 'applied']);
    const ARCHIVE_STATES = Object.freeze(['active', 'archived']);
    const PAYLOAD_FORMATS = Object.freeze(['text', 'json']);

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

    function uniqueStrings(values) {
        const seen = new Set();
        const result = [];
        for (const value of Array.isArray(values) ? values : []) {
            const item = cleanString(value);
            if (!item || seen.has(item)) continue;
            seen.add(item);
            result.push(item);
        }
        return result;
    }

    function positiveInteger(value, fallback = 1) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    function nonNegativeInteger(value, fallback = 0) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 ? number : fallback;
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

    function createArtifactTypeRef(input = {}) {
        let id = '';
        let version = 1;
        if (typeof input === 'string') {
            const match = input.trim().match(/^(.+?)(?:@(\d+))?$/);
            id = match ? cleanString(match[1]) : '';
            version = match && match[2] ? positiveInteger(match[2], 1) : 1;
        } else {
            id = cleanString(input.id || input.type || input.artifactType);
            version = positiveInteger(input.version || input.schemaVersion, 1);
        }
        return { id, version };
    }

    function artifactTypeKey(input = {}) {
        const ref = createArtifactTypeRef(input);
        return ref.id ? `${ref.id}@${ref.version}` : '';
    }

    function normalizePayload(input = {}) {
        const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        const format = cleanString(payload.format, 'text');
        return {
            format: PAYLOAD_FORMATS.includes(format) ? format : 'text',
            contentRef: cleanString(payload.contentRef),
            digest: cleanString(payload.digest),
            byteLength: nonNegativeInteger(payload.byteLength, 0)
        };
    }

    function sanitizeParameters(value) {
        if (Array.isArray(value)) return value.map(sanitizeParameters);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        const blocked = /^(api[-_]?key|authorization|token|secret|password)$/i;
        for (const [key, item] of Object.entries(value)) {
            if (blocked.test(key)) continue;
            result[key] = sanitizeParameters(item);
        }
        return result;
    }

    function normalizeProviderSnapshot(input = {}) {
        const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        return {
            providerProfileId: cleanString(source.providerProfileId || source.profileId),
            provider: cleanString(source.provider),
            model: cleanString(source.model),
            parameters: sanitizeParameters(source.parameters && typeof source.parameters === 'object' ? source.parameters : {})
        };
    }

    function createWorkflowArtifactFamily(input = {}) {
        const type = createArtifactTypeRef(input.artifactType || input.type || {});
        const now = nowIso(input.updatedAt || input.createdAt);
        return {
            id: cleanString(input.id) || makeId('workflow-artifact'),
            projectId: cleanString(input.projectId),
            runId: cleanString(input.runId),
            nodeId: cleanString(input.nodeId),
            artifactType: type,
            title: cleanString(input.title, '未命名产物') || '未命名产物',
            targetRef: input.targetRef && typeof input.targetRef === 'object' && !Array.isArray(input.targetRef)
                ? clonePlain(input.targetRef)
                : {},
            revisionIds: uniqueStrings(input.revisionIds),
            createdAt: nowIso(input.createdAt || now),
            updatedAt: now
        };
    }

    function normalizeState(value, allowed, fallback) {
        const state = cleanString(value, fallback);
        return allowed.includes(state) ? state : fallback;
    }

    function createWorkflowArtifactRevision(input = {}) {
        const now = nowIso(input.updatedAt || input.createdAt);
        return {
            id: cleanString(input.id || input.revisionId) || makeId('workflow-revision'),
            artifactId: cleanString(input.artifactId),
            schemaVersion: positiveInteger(input.schemaVersion, 1),
            parentRevisionId: cleanString(input.parentRevisionId),
            variantId: cleanString(input.variantId, 'main') || 'main',
            inputRevisionIds: uniqueStrings(input.inputRevisionIds),
            inputDigest: cleanString(input.inputDigest),
            constraintSnapshotId: cleanString(input.constraintSnapshotId),
            providerSnapshot: normalizeProviderSnapshot(input.providerSnapshot),
            payload: normalizePayload(input.payload),
            summary: cleanString(input.summary),
            reviewState: normalizeState(input.reviewState, REVIEW_STATES, 'draft'),
            freshness: normalizeState(input.freshness, FRESHNESS_STATES, 'fresh'),
            applicationState: normalizeState(input.applicationState, APPLICATION_STATES, 'unapplied'),
            archiveState: normalizeState(input.archiveState, ARCHIVE_STATES, 'active'),
            createdAt: nowIso(input.createdAt || now),
            updatedAt: now,
            approvedAt: cleanString(input.approvedAt)
        };
    }

    function validateWorkflowArtifactFamily(input = {}) {
        const artifact = createWorkflowArtifactFamily(input);
        const errors = [];
        if (!artifact.projectId) errors.push('artifact projectId is required');
        if (!artifact.runId) errors.push('artifact runId is required');
        if (!artifact.nodeId) errors.push('artifact nodeId is required');
        if (!artifact.artifactType.id) errors.push('artifact type id is required');
        return { ok: errors.length === 0, errors, artifact };
    }

    function validateWorkflowArtifactRevision(input = {}) {
        const revision = createWorkflowArtifactRevision(input);
        const errors = [];
        if (!revision.artifactId) errors.push('revision artifactId is required');
        if (!revision.payload.contentRef) errors.push('revision payload contentRef is required');
        if (!revision.payload.digest) errors.push('revision payload digest is required');
        if (revision.reviewState === 'approved' && !revision.approvedAt) {
            errors.push('approved revision approvedAt is required');
        }
        return { ok: errors.length === 0, errors, revision };
    }

    function isRevisionMutable(input = {}) {
        const revision = createWorkflowArtifactRevision(input);
        return revision.reviewState === 'draft' || revision.reviewState === 'waiting_review';
    }

    function updateDraftRevision(input = {}, patch = {}) {
        const revision = createWorkflowArtifactRevision(input);
        if (!isRevisionMutable(revision)) {
            const error = new Error(`Artifact revision ${revision.id} is immutable after review`);
            error.name = 'WorkflowArtifactImmutableError';
            throw error;
        }
        if (patch.reviewState === 'approved') {
            const error = new Error('Use approveArtifactRevision to approve a workflow artifact revision');
            error.name = 'WorkflowArtifactReviewStateError';
            throw error;
        }
        return createWorkflowArtifactRevision({
            ...revision,
            inputRevisionIds: patch.inputRevisionIds === undefined ? revision.inputRevisionIds : patch.inputRevisionIds,
            inputDigest: patch.inputDigest === undefined ? revision.inputDigest : patch.inputDigest,
            constraintSnapshotId: patch.constraintSnapshotId === undefined ? revision.constraintSnapshotId : patch.constraintSnapshotId,
            providerSnapshot: patch.providerSnapshot === undefined ? revision.providerSnapshot : patch.providerSnapshot,
            payload: patch.payload === undefined ? revision.payload : patch.payload,
            summary: patch.summary === undefined ? revision.summary : patch.summary,
            reviewState: patch.reviewState === undefined ? revision.reviewState : patch.reviewState,
            freshness: patch.freshness === undefined ? revision.freshness : patch.freshness,
            applicationState: patch.applicationState === undefined ? revision.applicationState : patch.applicationState,
            archiveState: patch.archiveState === undefined ? revision.archiveState : patch.archiveState,
            id: revision.id,
            artifactId: revision.artifactId,
            schemaVersion: revision.schemaVersion,
            parentRevisionId: revision.parentRevisionId,
            variantId: revision.variantId,
            createdAt: revision.createdAt,
            updatedAt: patch.updatedAt
        });
    }

    function approveArtifactRevision(input = {}, approvedAt = '') {
        const revision = createWorkflowArtifactRevision(input);
        if (!isRevisionMutable(revision)) {
            const error = new Error(`Artifact revision ${revision.id} cannot be approved from ${revision.reviewState}`);
            error.name = 'WorkflowArtifactReviewStateError';
            throw error;
        }
        const timestamp = nowIso(approvedAt);
        return createWorkflowArtifactRevision({
            ...revision,
            reviewState: 'approved',
            approvedAt: timestamp,
            updatedAt: timestamp
        });
    }

    function createChildArtifactRevision(parentInput = {}, overrides = {}) {
        const parent = createWorkflowArtifactRevision(parentInput);
        return createWorkflowArtifactRevision({
            schemaVersion: overrides.schemaVersion === undefined ? parent.schemaVersion : overrides.schemaVersion,
            variantId: overrides.variantId === undefined ? parent.variantId : overrides.variantId,
            inputRevisionIds: overrides.inputRevisionIds === undefined ? parent.inputRevisionIds : overrides.inputRevisionIds,
            inputDigest: overrides.inputDigest === undefined ? '' : overrides.inputDigest,
            constraintSnapshotId: overrides.constraintSnapshotId === undefined
                ? parent.constraintSnapshotId
                : overrides.constraintSnapshotId,
            providerSnapshot: overrides.providerSnapshot === undefined ? parent.providerSnapshot : overrides.providerSnapshot,
            payload: overrides.payload === undefined ? parent.payload : overrides.payload,
            summary: overrides.summary === undefined ? parent.summary : overrides.summary,
            ...overrides,
            id: overrides.id || undefined,
            artifactId: parent.artifactId,
            parentRevisionId: parent.id,
            reviewState: 'draft',
            freshness: 'fresh',
            applicationState: 'unapplied',
            archiveState: 'active',
            approvedAt: ''
        });
    }

    function attachRevisionToArtifact(artifactInput = {}, revisionInput = {}) {
        const artifact = createWorkflowArtifactFamily(artifactInput);
        const revision = createWorkflowArtifactRevision(revisionInput);
        if (revision.artifactId !== artifact.id) {
            throw new Error(`Revision ${revision.id} does not belong to artifact ${artifact.id}`);
        }
        return createWorkflowArtifactFamily({
            ...artifact,
            revisionIds: [...artifact.revisionIds, revision.id],
            createdAt: artifact.createdAt,
            updatedAt: revision.updatedAt
        });
    }

    function createArtifactBinding(input = {}) {
        return {
            id: cleanString(input.id) || makeId('workflow-binding'),
            projectId: cleanString(input.projectId),
            slotKey: cleanString(input.slotKey),
            artifactId: cleanString(input.artifactId),
            revisionId: cleanString(input.revisionId),
            updatedAt: nowIso(input.updatedAt)
        };
    }

    function validateArtifactBindings(inputs = []) {
        const bindings = (Array.isArray(inputs) ? inputs : []).map(createArtifactBinding);
        const errors = [];
        const occupied = new Set();
        for (const binding of bindings) {
            if (!binding.projectId) errors.push(`binding ${binding.id} projectId is required`);
            if (!binding.slotKey) errors.push(`binding ${binding.id} slotKey is required`);
            if (!binding.artifactId) errors.push(`binding ${binding.id} artifactId is required`);
            if (!binding.revisionId) errors.push(`binding ${binding.id} revisionId is required`);
            const key = `${binding.projectId}:${binding.slotKey}`;
            if (occupied.has(key)) errors.push(`duplicate active binding slot: ${key}`);
            occupied.add(key);
        }
        return { ok: errors.length === 0, errors, bindings };
    }

    return {
        REVIEW_STATES,
        FRESHNESS_STATES,
        APPLICATION_STATES,
        ARCHIVE_STATES,
        PAYLOAD_FORMATS,
        createArtifactTypeRef,
        artifactTypeKey,
        createWorkflowArtifactFamily,
        createWorkflowArtifactRevision,
        validateWorkflowArtifactFamily,
        validateWorkflowArtifactRevision,
        isRevisionMutable,
        updateDraftRevision,
        approveArtifactRevision,
        createChildArtifactRevision,
        attachRevisionToArtifact,
        createArtifactBinding,
        validateArtifactBindings,
        normalizeProviderSnapshot
    };
});
