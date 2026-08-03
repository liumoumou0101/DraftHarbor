(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderAnnotation = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const ANNOTATION_SCHEMA_VERSION = 1;
    const HISTORY_SCHEMA_VERSION = 1;
    const TYPES = Object.freeze(['highlight', 'underline', 'note']);
    const COLORS = Object.freeze(['yellow', 'blue', 'green', 'pink', 'gray']);
    const MAX_HISTORY = 100;

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function enumValue(value, allowed, fallback, label) {
        const normalized = cleanString(value, fallback);
        if (!allowed.includes(normalized)) throw new Error(`${label} is not supported: ${normalized || '(empty)'}`);
        return normalized;
    }

    function validTimestamp(value, label) {
        const text = cleanString(value);
        const date = new Date(text);
        if (!text || Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
        return date.toISOString();
    }

    function clone(value) {
        if (Array.isArray(value)) return value.map(clone);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    }

    function createReaderAnnotation(input = {}) {
        const annotationId = cleanString(input.annotationId || input.id);
        if (!annotationId) throw new Error('reader annotationId is required');
        const documentId = cleanString(input.documentId);
        const revisionId = cleanString(input.revisionId);
        if (!documentId || !revisionId) throw new Error('reader annotation documentId and revisionId are required');
        if (!input.range || typeof input.range !== 'object' || Array.isArray(input.range)) throw new Error('reader annotation range is required');
        const note = cleanString(input.note).slice(0, 4000);
        const now = validTimestamp(input.updatedAt || input.createdAt, 'reader annotation updatedAt');
        return {
            schemaVersion: ANNOTATION_SCHEMA_VERSION,
            annotationId,
            documentId,
            revisionId,
            type: enumValue(input.type, TYPES, 'highlight', 'reader annotation type'),
            color: enumValue(input.color, COLORS, 'yellow', 'reader annotation color'),
            range: clone(input.range),
            excerpt: cleanString(input.excerpt).slice(0, 1000),
            note,
            createdAt: validTimestamp(input.createdAt || now, 'reader annotation createdAt'),
            updatedAt: now
        };
    }

    function createReaderPositionHistory(input = {}) {
        const items = Array.isArray(input.items) ? input.items : [];
        const normalized = items.slice(-MAX_HISTORY).map((item) => {
            const documentId = cleanString(item.documentId);
            if (!documentId) throw new Error('reader history documentId is required');
            return {
                documentId,
                revisionId: cleanString(item.revisionId),
                locator: clone(item.locator || null),
                visitedAt: validTimestamp(item.visitedAt, 'reader history visitedAt')
            };
        });
        return { schemaVersion: HISTORY_SCHEMA_VERSION, maxItems: MAX_HISTORY, items: normalized };
    }

    function appendReaderPositionHistory(historyInput, entry) {
        const history = createReaderPositionHistory(historyInput);
        return createReaderPositionHistory({ items: [...history.items, entry] });
    }

    return {
        ANNOTATION_SCHEMA_VERSION,
        HISTORY_SCHEMA_VERSION,
        TYPES,
        COLORS,
        MAX_HISTORY,
        createReaderAnnotation,
        createReaderPositionHistory,
        appendReaderPositionHistory
    };
});
