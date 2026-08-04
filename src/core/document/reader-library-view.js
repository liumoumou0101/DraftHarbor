(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderLibraryView = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const VIEW_SCHEMA_VERSION = 1;
    const VIEW_MODES = Object.freeze(['grid', 'list']);
    const SORT_FIELDS = Object.freeze(['recent', 'title', 'progress', 'source']);
    const SOURCE_FILTERS = Object.freeze(['all', 'project', 'local-text', 'pasted-text']);

    function cleanString(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function idList(value, maximum, label) {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
        const result = [];
        const seen = new Set();
        value.forEach((item) => {
            const id = cleanString(item);
            if (!id || seen.has(id)) return;
            if (id.length > 240) throw new Error(`${label} contains an invalid id`);
            seen.add(id);
            result.push(id);
        });
        return result.slice(0, maximum);
    }

    function createReaderLibraryShelf(input = {}) {
        const shelfId = cleanString(input.shelfId || input.id);
        if (!/^shelf:[a-z0-9][a-z0-9._-]{1,79}$/i.test(shelfId)) throw new Error('reader shelfId is invalid');
        const title = cleanString(input.title, '未命名书架').slice(0, 80) || '未命名书架';
        return { shelfId, title, documentIds: idList(input.documentIds, 500, 'reader shelf documentIds') };
    }

    function createReaderLibraryView(input = {}) {
        if (Number(input.schemaVersion || VIEW_SCHEMA_VERSION) !== VIEW_SCHEMA_VERSION) throw new Error('reader library view schema is invalid');
        const shelves = (Array.isArray(input.shelves) ? input.shelves : []).slice(0, 30).map(createReaderLibraryShelf);
        const shelfIds = new Set();
        shelves.forEach((shelf) => {
            if (shelfIds.has(shelf.shelfId)) throw new Error(`duplicate reader shelfId: ${shelf.shelfId}`);
            shelfIds.add(shelf.shelfId);
        });
        return {
            schemaVersion: VIEW_SCHEMA_VERSION,
            viewMode: VIEW_MODES.includes(input.viewMode) ? input.viewMode : 'grid',
            sortBy: SORT_FIELDS.includes(input.sortBy) ? input.sortBy : 'recent',
            sourceFilter: SOURCE_FILTERS.includes(input.sourceFilter) ? input.sourceFilter : 'all',
            query: cleanString(input.query).slice(0, 200),
            selectedShelfId: cleanString(input.selectedShelfId),
            favoriteDocumentIds: idList(input.favoriteDocumentIds, 1000, 'reader favoriteDocumentIds'),
            hiddenDocumentIds: idList(input.hiddenDocumentIds, 1000, 'reader hiddenDocumentIds'),
            shelves
        };
    }

    function mergeReaderLibraryView(base, changes) {
        return createReaderLibraryView({ ...(base || {}), ...(changes || {}) });
    }

    function filterReaderLibraryDocuments(documents, viewInput) {
        const view = createReaderLibraryView(viewInput);
        const query = view.query.toLocaleLowerCase();
        const visible = (Array.isArray(documents) ? documents : []).filter((document) => {
            if (view.hiddenDocumentIds.includes(document.documentId)) return false;
            if (view.sourceFilter !== 'all' && document.sourceKind !== view.sourceFilter) return false;
            if (!query) return true;
            return `${document.title || ''} ${document.originalFileName || ''} ${document.sourceKind || ''}`.toLocaleLowerCase().includes(query);
        });
        const selectedShelf = view.shelves.find((shelf) => shelf.shelfId === view.selectedShelfId);
        const shelfDocuments = selectedShelf ? new Set(selectedShelf.documentIds) : null;
        return visible.filter((document) => !shelfDocuments || shelfDocuments.has(document.documentId));
    }

    function sortReaderLibraryDocuments(documents, viewInput) {
        const view = createReaderLibraryView(viewInput);
        const result = filterReaderLibraryDocuments(documents, view);
        return result.slice().sort((left, right) => {
            if (view.sortBy === 'title') return String(left.title || '').localeCompare(String(right.title || ''), 'zh-Hans');
            if (view.sortBy === 'progress') return (Number(right.reading && right.reading.progress) || 0) - (Number(left.reading && left.reading.progress) || 0);
            if (view.sortBy === 'source') return String(left.sourceKind || '').localeCompare(String(right.sourceKind || '')) || String(left.title || '').localeCompare(String(right.title || ''), 'zh-Hans');
            return String(right.reading && right.reading.lastReadAt || right.updatedAt || '').localeCompare(String(left.reading && left.reading.lastReadAt || left.updatedAt || ''));
        });
    }

    return {
        VIEW_SCHEMA_VERSION,
        VIEW_MODES,
        SORT_FIELDS,
        SOURCE_FILTERS,
        createReaderLibraryShelf,
        createReaderLibraryView,
        mergeReaderLibraryView,
        filterReaderLibraryDocuments,
        sortReaderLibraryDocuments
    };
});
