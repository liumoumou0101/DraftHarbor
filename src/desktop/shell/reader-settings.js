    const READER_PREFERENCE_KEYS = Object.freeze([
        'layoutMode', 'pageTransition', 'themeId', 'fontFamilyId', 'fontId', 'fontCatalogVersion', 'fontSize', 'lineHeight',
        'letterSpacing', 'paragraphSpacing', 'pageMargin', 'textWidth', 'textAlign', 'indent', 'reducedMotionOverride', 'appearanceProfileId'
    ]);
    let readerSettingsSaveTimer = null;
    let readerApplyingAppearanceProfile = false;

    function readerDefaultPreferences() {
        const schema = window.DraftHarborReaderDocumentSchema;
        return schema && typeof schema.createReaderGlobalPreferences === 'function'
            ? schema.createReaderGlobalPreferences({})
            : {
                schemaVersion: 1, layoutMode: 'flow', pageTransition: 'fade', themeId: 'dark',
                fontFamilyId: 'system', fontId: 'builtin:default', fontCatalogVersion: 1, fontSize: 18, lineHeight: 1.8, letterSpacing: 0,
                paragraphSpacing: 1.05, pageMargin: 48, textWidth: 760, textAlign: 'start', indent: true,
                reducedMotionOverride: undefined, appearanceProfileId: 'default'
            };
    }

    function normalizeReaderPreferences(input) {
        const schema = window.DraftHarborReaderDocumentSchema;
        const source = { ...readerDefaultPreferences(), ...(input || {}) };
        if (source.fontFamilyId === 'yahei') source.fontFamilyId = 'sans-serif';
        try {
            return schema && typeof schema.createReaderGlobalPreferences === 'function'
                ? schema.createReaderGlobalPreferences(source)
                : source;
        } catch (error) {
            console.warn('Invalid reader preferences; defaults restored:', error);
            return readerDefaultPreferences();
        }
    }

    function readerPreferenceSnapshot() {
        return normalizeReaderPreferences({
            layoutMode: readerState.layoutMode,
            pageTransition: readerState.pageTransition,
            themeId: readerState.theme,
            fontFamilyId: readerState.fontFamily,
            fontId: readerState.fontId,
            fontCatalogVersion: readerState.fontCatalogVersion,
            fontSize: readerState.fontSize,
            lineHeight: readerState.lineHeight,
            letterSpacing: readerState.letterSpacing,
            paragraphSpacing: readerState.paragraphSpacing,
            pageMargin: readerState.pageMargin,
            textWidth: readerState.textWidth,
            textAlign: readerState.textAlign,
            indent: readerState.indent,
            reducedMotionOverride: readerState.reducedMotionOverride,
            appearanceProfileId: readerState.appearanceProfileId
        });
    }

    function readerEffectivePreferences() {
        const globalPreferences = normalizeReaderPreferences(readerState.globalPreferences);
        if (readerState.preferenceScope !== 'document' || !readerState.activeDocumentId) return globalPreferences;
        return normalizeReaderPreferences({ ...globalPreferences, ...(readerState.preferenceOverrides || {}) });
    }

    function assignReaderPreferences(preferences) {
        readerState.layoutMode = preferences.layoutMode;
        readerState.pageTransition = preferences.pageTransition === 'curl' ? 'none' : preferences.pageTransition;
        readerState.theme = preferences.themeId;
        readerState.fontFamily = preferences.fontFamilyId;
        readerState.fontId = preferences.fontId || readerState.fontId || 'builtin:default';
        readerState.fontCatalogVersion = preferences.fontCatalogVersion || 1;
        readerState.appearanceProfileId = preferences.appearanceProfileId || 'default';
        readerState.fontSize = preferences.fontSize;
        readerState.lineHeight = preferences.lineHeight;
        readerState.letterSpacing = preferences.letterSpacing;
        readerState.paragraphSpacing = preferences.paragraphSpacing;
        readerState.pageMargin = preferences.pageMargin;
        readerState.textWidth = preferences.textWidth;
        readerState.textAlign = preferences.textAlign;
        readerState.indent = preferences.indent;
        readerState.reducedMotionOverride = preferences.reducedMotionOverride;
    }

    function applyReaderPreferenceModel() {
        assignReaderPreferences(readerEffectivePreferences());
        applyReaderSettings();
        syncReaderSettingsControls();
    }

    function readerReducedMotionActive() {
        if (readerState.reducedMotionOverride === true) return true;
        if (readerState.reducedMotionOverride === false) return false;
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function readerEffectiveTransition() {
        if (readerState.effectiveLayoutMode === 'flow' || readerReducedMotionActive()) return 'none';
        return ['fade', 'slide', 'none'].includes(readerState.pageTransition) ? readerState.pageTransition : 'none';
    }

    function updateReaderPreferenceStatus(message) {
        const status = document.querySelector('[data-reader-preference-status]');
        if (status) status.textContent = message || (readerState.preferenceScope === 'document'
            ? '当前修改仅应用于这本书。'
            : '当前修改将应用于所有书籍。');
    }

    function syncReaderSettingsControls() {
        const values = {
            '[data-reader-font-size]': readerState.fontSize,
            '[data-reader-line-height]': readerState.lineHeight,
            '[data-reader-letter-spacing]': readerState.letterSpacing,
            '[data-reader-width]': readerState.textWidth,
            '[data-reader-paragraph-spacing]': readerState.paragraphSpacing,
            '[data-reader-page-margin]': readerState.pageMargin,
            '[data-reader-text-align]': readerState.textAlign,
            '[data-reader-layout-mode]': readerState.layoutMode,
            '[data-reader-page-transition]': readerState.pageTransition,
            '[data-reader-appearance-profile]': readerState.appearanceProfileId,
            '[data-reader-preference-scope]': readerState.preferenceScope,
            '[data-reader-reduced-motion]': readerState.reducedMotionOverride === true ? 'reduce' : readerState.reducedMotionOverride === false ? 'allow' : 'system'
        };
        Object.entries(values).forEach(([selector, value]) => {
            const control = document.querySelector(selector);
            if (control && value !== undefined) control.value = String(value);
        });
        const outputValues = {
            'font-size': `${readerState.fontSize} px`,
            'line-height': Number(readerState.lineHeight).toFixed(2),
            'letter-spacing': Number(readerState.letterSpacing).toFixed(2),
            width: `${readerState.textWidth} px`,
            'paragraph-spacing': Number(readerState.paragraphSpacing).toFixed(2),
            'page-margin': `${readerState.pageMargin} px`
        };
        Object.entries(outputValues).forEach(([key, value]) => {
            const output = document.querySelector(`[data-reader-value-for="${key}"]`);
            if (output) output.textContent = value;
        });
        const scope = document.querySelector('[data-reader-preference-scope]');
        if (scope) scope.querySelector('option[value="document"]').disabled = !readerState.activeDocumentId;
        const reset = document.querySelector('[data-reader-preference-reset]');
        if (reset) reset.disabled = readerState.preferenceScope !== 'document' || !Object.keys(readerState.preferenceOverrides || {}).length;
        const status = document.querySelector('[data-reader-font-status]');
        if (status) {
            const actual = readerState.actualFontFamily || readerFontStack().split(',')[0].replace(/["']/g, '');
            status.textContent = readerState.fontFallback ? `首选字体不可用，已回退到 ${actual}` : `当前字体：${actual}`;
        }
        const stage = document.querySelector('[data-reader-theme-panel]');
        if (stage) {
            stage.dataset.readerMotion = readerReducedMotionActive() ? 'reduce' : 'allow';
            stage.dataset.readerTransition = readerEffectiveTransition();
        }
    }

    async function loadReaderPreferences() {
        try {
            const payload = await readerApi('/api/reader/preferences');
            readerState.preferenceRecord = payload.record;
            readerState.globalPreferences = normalizeReaderPreferences(payload.record && payload.record.preferences);
            applyReaderPreferenceModel();
        } catch (error) {
            readerState.globalPreferences = readerDefaultPreferences();
            applyReaderPreferenceModel();
            console.warn('Failed to load reader preferences:', error);
        }
    }

    async function persistReaderDocumentPreferences() {
        if (!readerState.activeDocumentId) return;
        if (typeof queueReaderDocumentStateWrite === 'function') {
            return queueReaderDocumentStateWrite({ preferenceOverrides: readerState.preferenceOverrides || {} });
        }
        const existing = readerState.documentRecordState || {};
        const locator = typeof captureReaderPositionLocator === 'function'
            ? captureReaderPositionLocator() || existing.positionLocator : existing.positionLocator;
        const payload = await readerApi('/api/reader/state', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: {
                documentId: readerState.activeDocumentId,
                positionLocator: locator || null,
                updatedAt: new Date().toISOString(),
                preferenceOverrides: readerState.preferenceOverrides || {},
                bookmarks: existing.bookmarks || []
            } })
        });
        readerState.documentRecordState = payload.state;
    }

    function scheduleReaderPreferenceSave() {
        if (readerSettingsSaveTimer) window.clearTimeout(readerSettingsSaveTimer);
        updateReaderPreferenceStatus('正在保存设置…');
        readerSettingsSaveTimer = window.setTimeout(async () => {
            readerSettingsSaveTimer = null;
            try {
                const preferences = readerPreferenceSnapshot();
                if (readerState.preferenceScope === 'document' && readerState.activeDocumentId) {
                    readerState.preferenceOverrides = Object.fromEntries(READER_PREFERENCE_KEYS.map((key) => [key, preferences[key]]));
                    await persistReaderDocumentPreferences();
                    updateReaderPreferenceStatus('本书设置已保存。');
                } else {
                    const payload = await readerApi('/api/reader/preferences', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            preferences,
                            expectedUpdatedAt: readerState.preferenceRecord && readerState.preferenceRecord.updatedAt,
                            updatedAt: new Date().toISOString()
                        })
                    });
                    readerState.preferenceRecord = payload.record;
                    readerState.globalPreferences = preferences;
                    updateReaderPreferenceStatus('全局设置已保存。');
                }
                syncReaderSettingsControls();
            } catch (error) {
                updateReaderPreferenceStatus('设置保存失败，请稍后重试。');
                console.warn('Failed to save reader preferences:', error);
            }
        }, 350);
    }

    function updateReaderSetting(mutator) {
        const locator = typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : null;
        const wasApplyingAppearanceProfile = readerApplyingAppearanceProfile;
        const mutationResult = mutator();
        if (!wasApplyingAppearanceProfile && !readerApplyingAppearanceProfile && mutationResult !== 'appearance-profile') {
            readerState.appearanceProfileId = 'custom';
        }
        readerState.anchorLocator = locator || readerState.anchorLocator;
        applyReaderSettings();
        syncReaderSettingsControls();
        saveReaderState();
        scheduleReaderPreferenceSave();
    }

    function bindReaderSetting(selector, eventName, mutator) {
        const control = document.querySelector(selector);
        control?.addEventListener(eventName, () => updateReaderSetting(() => mutator(control)));
    }

    function applyReaderAppearanceProfile(profileId) {
        const preferencesApi = window.DraftHarborReaderPreferences;
        const preset = preferencesApi && preferencesApi.PROFILE_PRESETS && preferencesApi.PROFILE_PRESETS[profileId];
        if (!preset) return '';
        readerApplyingAppearanceProfile = true;
        try {
            Object.assign(readerState, {
                appearanceProfileId: profileId,
                layoutMode: preset.layoutMode,
                pageTransition: preset.pageTransition,
                theme: preset.themeId,
                fontFamily: preset.fontFamilyId,
                fontId: preset.fontId,
                fontCatalogVersion: preset.fontCatalogVersion || 1,
                fontSize: preset.fontSize,
                lineHeight: preset.lineHeight,
                letterSpacing: preset.letterSpacing,
                paragraphSpacing: preset.paragraphSpacing,
                pageMargin: preset.pageMargin,
                textWidth: preset.textWidth,
                textAlign: preset.textAlign,
                indent: preset.indent,
                reducedMotionOverride: preset.reducedMotionOverride
            });
        } finally {
            readerApplyingAppearanceProfile = false;
        }
        return 'appearance-profile';
    }

    function initializeReaderSettings() {
        loadReaderPreferences();
        bindReaderSetting('[data-reader-letter-spacing]', 'input', (control) => { readerState.letterSpacing = Number(control.value) || 0; });
        bindReaderSetting('[data-reader-page-margin]', 'input', (control) => { readerState.pageMargin = Number(control.value) || 48; });
        bindReaderSetting('[data-reader-text-align]', 'change', (control) => { readerState.textAlign = control.value || 'start'; });
        bindReaderSetting('[data-reader-layout-mode]', 'change', (control) => { readerState.layoutMode = control.value || 'flow'; });
        bindReaderSetting('[data-reader-page-transition]', 'change', (control) => { readerState.pageTransition = control.value || 'none'; });
        bindReaderSetting('[data-reader-reduced-motion]', 'change', (control) => {
            readerState.reducedMotionOverride = control.value === 'reduce' ? true : control.value === 'allow' ? false : undefined;
        });
        bindReaderSetting('[data-reader-appearance-profile]', 'change', (control) => applyReaderAppearanceProfile(control.value || 'default'));
        document.querySelectorAll('[data-reader-font-size], [data-reader-line-height], [data-reader-width], [data-reader-paragraph-spacing]').forEach((control) => {
            control.addEventListener('input', () => window.setTimeout(syncReaderSettingsControls, 0));
        });
        document.querySelector('[data-reader-preference-scope]')?.addEventListener('change', (event) => {
            readerState.preferenceScope = event.currentTarget.value === 'document' && readerState.activeDocumentId ? 'document' : 'global';
            applyReaderPreferenceModel();
            updateReaderPreferenceStatus();
        });
        document.querySelector('[data-reader-preference-reset]')?.addEventListener('click', async () => {
            if (!readerState.activeDocumentId) return;
            readerState.preferenceOverrides = {};
            try {
                await persistReaderDocumentPreferences();
                applyReaderPreferenceModel();
                updateReaderPreferenceStatus('已恢复全局设置。');
            } catch (error) {
                updateReaderPreferenceStatus('恢复失败，请稍后重试。');
                console.warn('Failed to reset reader document preferences:', error);
            }
        });
        if (window.matchMedia) {
            const media = window.matchMedia('(prefers-reduced-motion: reduce)');
            media.addEventListener?.('change', () => {
                if (readerState.reducedMotionOverride === undefined) syncReaderSettingsControls();
            });
        }
        syncReaderSettingsControls();
        updateReaderPreferenceStatus();
    }
