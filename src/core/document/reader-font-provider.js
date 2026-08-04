(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./reader-font-catalog'));
    } else {
        root.DraftHarborReaderFontProvider = factory(root.DraftHarborReaderFontCatalog);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Catalog) {
    if (!Catalog) throw new Error('reader font catalog dependency is required');

    function createReaderFontProvider(options = {}) {
        const probeFont = typeof options.probe === 'function' ? options.probe : async () => true;
        const loadFont = typeof options.load === 'function' ? options.load : async () => true;
        let catalog = Catalog.createReaderFontCatalog(options.catalog || Catalog.createBuiltinReaderFontCatalog());

        function snapshot() {
            return Catalog.createReaderFontCatalog(catalog);
        }

        function replaceEntry(fontId, changes) {
            const entries = catalog.entries.map((entry) => entry.fontId === fontId ? { ...entry, ...changes } : entry);
            catalog = Catalog.createReaderFontCatalog({ catalogVersion: catalog.catalogVersion + 1, entries });
            return get(fontId);
        }

        function list() {
            return snapshot().entries;
        }

        function get(fontId) {
            return list().find((entry) => entry.fontId === String(fontId || '').trim()) || null;
        }

        function resolve(fontId) {
            return Catalog.resolveReaderFont(catalog, fontId);
        }

        function register(entryInput) {
            const entry = Catalog.createReaderFontCatalogEntry({ ...entryInput, sourceKind: entryInput.sourceKind || 'user' });
            if (get(entry.fontId)) throw new Error(`reader font already exists: ${entry.fontId}`);
            catalog = Catalog.createReaderFontCatalog({
                catalogVersion: catalog.catalogVersion + 1,
                entries: [...catalog.entries, { ...entry, catalogVersion: catalog.catalogVersion + 1 }]
            });
            return get(entry.fontId);
        }

        function remove(fontId) {
            const entry = get(fontId);
            if (!entry) return false;
            if (entry.sourceKind === 'builtin') throw new Error('built-in reader fonts cannot be removed');
            catalog = Catalog.createReaderFontCatalog({
                catalogVersion: catalog.catalogVersion + 1,
                entries: catalog.entries.filter((item) => item.fontId !== entry.fontId)
            });
            return true;
        }

        async function probe(fontId) {
            const entry = get(fontId);
            if (!entry) return false;
            try {
                const available = await probeFont(entry);
                replaceEntry(entry.fontId, { status: available ? 'ready' : 'missing', errorCode: '' });
                return !!available;
            } catch (error) {
                replaceEntry(entry.fontId, { status: 'failed', errorCode: error && error.code ? error.code : 'probe-failed' });
                return false;
            }
        }

        async function load(fontId) {
            const entry = get(fontId);
            if (!entry) return resolve(fontId);
            replaceEntry(entry.fontId, { status: 'loading', errorCode: '' });
            try {
                const loaded = await loadFont(get(entry.fontId));
                replaceEntry(entry.fontId, { status: loaded === false ? 'failed' : 'ready', errorCode: loaded === false ? 'load-failed' : '' });
            } catch (error) {
                replaceEntry(entry.fontId, { status: 'failed', errorCode: error && error.code ? error.code : 'load-failed' });
            }
            return resolve(fontId);
        }

        return Object.freeze({ snapshot, list, get, resolve, register, remove, probe, load });
    }

    return { createReaderFontProvider };
});
