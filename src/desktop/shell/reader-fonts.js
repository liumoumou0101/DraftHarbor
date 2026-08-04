(() => {
    const BUILTIN_VALUES = Object.freeze({
        'builtin:default': 'system',
        'builtin:serif': 'serif',
        'builtin:sans': 'sans-serif',
        'builtin:kai': 'kai'
    });
    let catalog = null;
    let provider = null;

    function providerApi() {
        return window.DraftHarborReaderFontProvider;
    }

    function ensureProvider(input) {
        const api = providerApi();
        if (!api?.createReaderFontProvider) return null;
        if (!provider || input) provider = api.createReaderFontProvider({ catalog: input || undefined });
        return provider;
    }

    function userEntries() {
        return (catalog?.entries || []).filter((entry) => entry.sourceKind === 'user');
    }

    function entryFor(fontId) {
        return (catalog?.entries || []).find((entry) => entry.fontId === String(fontId || '').trim()) || null;
    }

    function fontFamilyForEntry(entry) {
        return entry && entry.sourceKind === 'user' ? entry.fontId : BUILTIN_VALUES[entry?.fontId] || 'system';
    }

    function installFontFaces() {
        const styleId = 'reader-user-font-faces';
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
        }
        style.textContent = userEntries().map((entry) => {
            const url = `/api/reader/fonts/file?fontId=${encodeURIComponent(entry.fontId)}`;
            return `@font-face{font-family:${JSON.stringify(entry.family)};src:url(${JSON.stringify(url)}) format(${JSON.stringify(entry.format)});font-weight:${entry.weight || 400};font-style:${entry.style || 'normal'};font-display:swap;}`;
        }).join('\n');
    }

    function renderFontOptions() {
        document.querySelectorAll('[data-reader-font-family], [data-reader-quick-font-family]').forEach((control) => {
            control.querySelectorAll('option[data-reader-user-font]').forEach((option) => option.remove());
            userEntries().forEach((entry) => {
                const option = document.createElement('option');
                option.value = entry.fontId;
                option.textContent = `${entry.displayName}${entry.status === 'missing' ? '（缺失）' : ''}`;
                option.dataset.readerUserFont = 'true';
                option.dataset.readerFontId = entry.fontId;
                control.appendChild(option);
            });
            control.querySelectorAll('option').forEach((option) => {
                if (!option.dataset.readerFontId) {
                    option.dataset.readerFontId = Object.entries(BUILTIN_VALUES).find(([, value]) => value === option.value)?.[0] || '';
                }
            });
            const selected = entryFor(readerState.fontId) || entryFor('builtin:default');
            const value = selected ? fontFamilyForEntry(selected) : 'system';
            if (Array.from(control.options).some((option) => option.value === value)) control.value = value;
        });
    }

    function renderFontManagement() {
        const list = document.querySelector('[data-reader-font-list]');
        const preview = document.querySelector('[data-reader-font-preview]');
        if (preview) preview.style.fontFamily = readerFontStack();
        if (!list) return;
        list.replaceChildren();
        const entries = userEntries();
        if (!entries.length) {
            const empty = document.createElement('p');
            empty.className = 'desktop-reader-hint';
            empty.textContent = '尚未安装用户字体。安装后会显示在字体选择器中。';
            list.appendChild(empty);
            return;
        }
        entries.forEach((entry) => {
            const item = document.createElement('article');
            item.className = 'desktop-reader-font-item';
            const heading = document.createElement('strong');
            heading.textContent = entry.displayName;
            const meta = document.createElement('span');
            meta.textContent = `${entry.format.toUpperCase()} · ${entry.weight || 400} · ${entry.style || 'normal'} · ${entry.status === 'ready' ? '可用' : entry.status === 'missing' ? '文件缺失' : '加载失败'}`;
            const sample = document.createElement('p');
            sample.className = 'desktop-reader-font-preview';
            sample.style.fontFamily = entry.family;
            sample.textContent = '潮汐 Tide 123 · 中文样张';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'desktop-reader-tool';
            remove.textContent = '删除';
            remove.addEventListener('click', () => removeReaderFont(entry));
            item.append(heading, meta, sample, remove);
            list.appendChild(item);
        });
    }

    function setFontStatus(message, tone = '') {
        const status = document.querySelector('[data-reader-font-management-status]');
        if (status) {
            status.textContent = message;
            status.dataset.tone = tone;
        }
    }

    function base64(bytes) {
        const chunkSize = 0x8000;
        let result = '';
        for (let index = 0; index < bytes.length; index += chunkSize) {
            result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(result);
    }

    async function loadReaderFontCatalog() {
        try {
            const payload = await readerApi('/api/reader/fonts');
            catalog = payload.catalog;
            ensureProvider(catalog);
            installFontFaces();
            renderFontOptions();
            renderFontManagement();
            if (typeof applyReaderSettings === 'function') applyReaderSettings();
            if (typeof syncReaderSettingsControls === 'function') syncReaderSettingsControls();
            return catalog;
        } catch (error) {
            catalog = null;
            ensureProvider();
            setFontStatus(`字体目录读取失败：${error.message || error}`, 'error');
            return null;
        }
    }

    async function importReaderFont(file) {
        if (!file) return;
        setFontStatus('正在校验并安装字体…');
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const response = await readerApi('/api/reader/fonts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, bytes: base64(bytes) })
            });
            await loadReaderFontCatalog();
            window.applyReaderFontSelection?.(response.entry.fontId);
            setFontStatus(response.idempotent ? '字体已安装，目录未重复写入。' : '字体已安装，可在字体选择器中使用。');
        } catch (error) {
            setFontStatus(`字体安装失败：${error.message || error}`, 'error');
        }
    }

    async function removeReaderFont(entry) {
        if (!entry || !window.confirm(`删除“${entry.displayName}”？使用它的阅读方案会回退到系统默认字体。`)) return;
        setFontStatus('正在删除字体…');
        try {
            const response = await readerApi(`/api/reader/fonts?fontId=${encodeURIComponent(entry.fontId)}&expectedCatalogVersion=${encodeURIComponent(catalog?.catalogVersion || '')}`, { method: 'DELETE' });
            if (readerState.fontId === entry.fontId) window.applyReaderFontSelection?.('builtin:default');
            catalog = response.catalog;
            ensureProvider(catalog);
            installFontFaces();
            renderFontOptions();
            renderFontManagement();
            setFontStatus('字体已删除，相关方案已安全回退。');
        } catch (error) {
            setFontStatus(`字体删除失败：${error.message || error}`, 'error');
        }
    }

    function readerFontResolution(fontId) {
        const active = ensureProvider();
        return active ? active.resolve(fontId || 'builtin:default') : null;
    }

    function readerFontIdForSelection(control) {
        return control?.selectedOptions?.[0]?.dataset.readerFontId || control?.value || 'builtin:default';
    }

    function readerFontFamilyForSelection(control) {
        const entry = entryFor(readerFontIdForSelection(control));
        return fontFamilyForEntry(entry);
    }

    function applyReaderFontSelection(fontId) {
        const entry = entryFor(fontId) || entryFor('builtin:default');
        readerState.fontId = fontId || 'builtin:default';
        readerState.fontFamily = fontFamilyForEntry(entry);
        const resolved = readerFontResolution(readerState.fontId);
        readerState.fontFallback = !!resolved?.fallback;
        readerState.actualFontFamily = resolved?.actual?.family || '';
        readerState.fontCatalogVersion = catalog?.catalogVersion || 1;
        if (typeof applyReaderSettings === 'function') applyReaderSettings();
        if (typeof syncReaderSettingsControls === 'function') syncReaderSettingsControls();
    }

    function initializeReaderFonts() {
        const input = document.querySelector('[data-reader-font-file]');
        if (input && input.dataset.readerFontBound !== 'true') {
            input.dataset.readerFontBound = 'true';
            input.addEventListener('change', (event) => {
                const target = event.currentTarget;
                importReaderFont(target.files?.[0]).finally(() => { target.value = ''; });
            });
        }
        loadReaderFontCatalog();
    }

    window.initializeReaderFonts = initializeReaderFonts;
    window.loadReaderFontCatalog = loadReaderFontCatalog;
    window.readerFontResolution = readerFontResolution;
    window.readerFontIdForSelection = readerFontIdForSelection;
    window.readerFontFamilyForSelection = readerFontFamilyForSelection;
    window.applyReaderFontSelection = applyReaderFontSelection;
    window.renderReaderFontManagement = renderFontManagement;
})();
