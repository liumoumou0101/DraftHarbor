(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborWorkflowApplicationSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const APPLICATION_STATUSES = Object.freeze(['prepared', 'applying', 'partial', 'applied', 'failed', 'restored']);
    const OPERATION_STATUSES = Object.freeze(['pending', 'applied', 'failed', 'skipped']);

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
        const parsed = new Date(value);
        return value && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    }

    function normalizeWorkflowSourceReference(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        return {
            sourceRunId: cleanString(source.sourceRunId || source.runId),
            sourceArtifactId: cleanString(source.sourceArtifactId || source.artifactId),
            sourceRevisionId: cleanString(source.sourceRevisionId || source.revisionId)
        };
    }

    function normalizeOperation(input = {}, index = 0) {
        const source = input && typeof input === 'object' ? input : {};
        const status = cleanString(source.status, 'pending');
        return {
            id: cleanString(source.id, `operation-${index + 1}`) || `operation-${index + 1}`,
            kind: cleanString(source.kind),
            target: source.target && typeof source.target === 'object' ? clonePlain(source.target) : {},
            source: normalizeWorkflowSourceReference(source.source),
            data: source.data && typeof source.data === 'object' ? clonePlain(source.data) : {},
            status: OPERATION_STATUSES.includes(status) ? status : 'pending',
            result: source.result && typeof source.result === 'object' ? clonePlain(source.result) : {},
            error: source.error && typeof source.error === 'object'
                ? { code: cleanString(source.error.code), message: cleanString(source.error.message) }
                : null
        };
    }

    function createWorkflowApplicationRecord(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const status = cleanString(source.status, 'prepared');
        const operations = Array.isArray(source.operations) ? source.operations.map(normalizeOperation) : [];
        return {
            schemaVersion: 2,
            applicationId: cleanString(source.applicationId || source.id),
            runId: cleanString(source.runId),
            projectId: cleanString(source.projectId),
            sourceRevisionIds: Array.from(new Set((Array.isArray(source.sourceRevisionIds) ? source.sourceRevisionIds : [])
                .map((id) => cleanString(id)).filter(Boolean))),
            target: source.target && typeof source.target === 'object' ? clonePlain(source.target) : {},
            operations,
            backup: source.backup && typeof source.backup === 'object' ? clonePlain(source.backup) : {},
            status: APPLICATION_STATUSES.includes(status) ? status : 'prepared',
            error: source.error && typeof source.error === 'object'
                ? { code: cleanString(source.error.code), message: cleanString(source.error.message) }
                : null,
            recovery: source.recovery && typeof source.recovery === 'object' ? clonePlain(source.recovery) : {},
            revision: Number.isInteger(Number(source.revision)) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
            createdAt: nowIso(source.createdAt),
            updatedAt: nowIso(source.updatedAt || source.createdAt)
        };
    }

    return {
        APPLICATION_STATUSES,
        OPERATION_STATUSES,
        normalizeWorkflowSourceReference,
        normalizeOperation,
        createWorkflowApplicationRecord
    };
});
