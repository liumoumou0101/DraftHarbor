(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderFontCatalog = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CATALOG_SCHEMA_VERSION = 1;
    const ENTRY_STATUS = Object.freeze(['ready', 'loading', 'missing', 'failed']);
    const SOURCE_KINDS = Object.freeze(['builtin', 'user']);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function enumValue(value, allowed, fallback, label) {
        const normalized = cleanString(value, fallback);
        if (!allowed.includes(normalized)) throw new Error(`${label} is not supported: ${normalized || '(empty)'}`);
        return normalized;
    }

    function createReaderFontCatalogEntry(input = {}) {
        const fontId = cleanString(input.fontId || input.id);
        if (!fontId || !/^[a-z0-9][a-z0-9:._-]{1,119}$/i.test(fontId)) throw new Error('reader fontId is invalid');
        const family = cleanString(input.family || input.cssFamily);
        if (!family) throw new Error(`reader font ${fontId} family is required`);
        const sourceKind = enumValue(input.sourceKind, SOURCE_KINDS, 'builtin', 'reader font sourceKind');
        const status = enumValue(input.status, ENTRY_STATUS, 'ready', 'reader font status');
        return {
            schemaVersion: CATALOG_SCHEMA_VERSION,
            fontId,
            displayName: cleanString(input.displayName, fontId) || fontId,
            family,
            sourceKind,
            status,
            catalogVersion: Math.max(1, Math.floor(Number(input.catalogVersion) || 1)),
            fileName: sourceKind === 'user' ? cleanString(input.fileName) : '',
            format: sourceKind === 'user' ? cleanString(input.format).toLowerCase() : '',
            errorCode: status === 'failed' ? cleanString(input.errorCode) : ''
        };
    }

    function createBuiltinReaderFontCatalog() {
        return createReaderFontCatalog({
            catalogVersion: 1,
            entries: [
                { fontId: 'builtin:default', displayName: '系统默认', family: '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif' },
                { fontId: 'builtin:serif', displayName: '宋体 / 衬线', family: '"SimSun", "Noto Serif CJK SC", Georgia, serif' },
                { fontId: 'builtin:sans', displayName: '黑体 / 无衬线', family: '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif' },
                { fontId: 'builtin:kai', displayName: '楷体', family: '"KaiTi", "STKaiti", "Kaiti SC", serif' }
            ]
        });
    }

    function createReaderFontCatalog(input = {}) {
        const entries = (Array.isArray(input.entries) ? input.entries : []).map(createReaderFontCatalogEntry);
        const seen = new Set();
        entries.forEach((entry) => {
            if (seen.has(entry.fontId)) throw new Error(`duplicate reader fontId: ${entry.fontId}`);
            seen.add(entry.fontId);
        });
        if (!seen.has('builtin:default')) throw new Error('reader font catalog requires builtin:default');
        return {
            schemaVersion: CATALOG_SCHEMA_VERSION,
            catalogVersion: Math.max(1, Math.floor(Number(input.catalogVersion) || 1)),
            entries
        };
    }

    function resolveReaderFont(catalogInput, requestedFontId) {
        const catalog = createReaderFontCatalog(catalogInput);
        const requested = cleanString(requestedFontId, 'builtin:default');
        const selected = catalog.entries.find((entry) => entry.fontId === requested);
        if (selected && selected.status === 'ready') return { requestedFontId: requested, actual: selected, fallback: false };
        const fallback = catalog.entries.find((entry) => entry.fontId === 'builtin:default');
        return { requestedFontId: requested, actual: fallback, fallback: true, reason: selected ? selected.status : 'missing' };
    }

    return {
        CATALOG_SCHEMA_VERSION,
        ENTRY_STATUS,
        SOURCE_KINDS,
        createReaderFontCatalogEntry,
        createReaderFontCatalog,
        createBuiltinReaderFontCatalog,
        resolveReaderFont
    };
});
