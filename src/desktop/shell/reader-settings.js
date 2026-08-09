    const READER_PREFERENCE_KEYS = Object.freeze([
        'layoutMode', 'pageTransition', 'themeId', 'fontFamilyId', 'fontId', 'fontCatalogVersion', 'fontSize', 'lineHeight',
        'letterSpacing', 'paragraphSpacing', 'pageMargin', 'textWidth', 'textAlign', 'indent', 'paperMaterial', 'paperShadow', 'paperVignette', 'reducedMotionOverride', 'appearanceProfileId',
        'statusBarMode', 'statusBarFields', 'statusBarAutoHide', 'hudMode', 'keyboardPageTurn', 'pointerPageTurn', 'touchPageTurn'
    ]);
    let readerSettingsSaveTimer = null;

    function readerDefaultPreferences() {
        const preferencesApi = window.DraftHarborReaderPreferences;
        const schema = window.DraftHarborReaderDocumentSchema;
        return preferencesApi && typeof preferencesApi.createReaderPreferencesV2 === 'function'
            ? preferencesApi.createReaderPreferencesV2({})
            : schema && typeof schema.createReaderGlobalPreferences === 'function'
                ? schema.createReaderGlobalPreferences({})
            : {
            schemaVersion: 2, layoutMode: 'flow', pageTransition: 'fade', themeId: 'dark',
                fontFamilyId: 'system', fontId: 'builtin:default', fontCatalogVersion: 1, fontSize: 18, lineHeight: 1.8, letterSpacing: 0,
                paragraphSpacing: 1.05, pageMargin: 48, textWidth: 760, textAlign: 'start', indent: true,
                paperMaterial: 'flat', paperShadow: true, paperVignette: true,
                reducedMotionOverride: undefined, appearanceProfileId: 'default', statusBarMode: 'auto',
                statusBarFields: ['chapter', 'page', 'percent'], statusBarAutoHide: true
            };
    }

    function normalizeReaderPreferences(input) {
        const preferencesApi = window.DraftHarborReaderPreferences;
        const schema = window.DraftHarborReaderDocumentSchema;
        const source = { ...readerDefaultPreferences(), ...(input || {}) };
        if (source.fontFamilyId === 'yahei') source.fontFamilyId = 'sans-serif';
        try {
            return preferencesApi && typeof preferencesApi.migrateReaderPreferences === 'function'
                ? preferencesApi.migrateReaderPreferences(source)
                : schema && typeof schema.createReaderGlobalPreferences === 'function'
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
            paperMaterial: readerState.paperMaterial,
            paperShadow: readerState.paperShadow,
            paperVignette: readerState.paperVignette,
            reducedMotionOverride: readerState.reducedMotionOverride,
            appearanceProfileId: readerState.appearanceProfileId,
            statusBarMode: readerState.statusBarMode,
            statusBarFields: readerState.statusBarFields,
            statusBarAutoHide: readerState.statusBarAutoHide,
            hudMode: readerState.hudMode,
            keyboardPageTurn: readerState.keyboardPageTurn,
            pointerPageTurn: readerState.pointerPageTurn,
            touchPageTurn: readerState.touchPageTurn
        });
    }

    function readerEffectivePreferences() {
        const globalPreferences = normalizeReaderPreferences(readerState.globalPreferences);
        if (readerState.preferenceScope !== 'document' || !readerState.activeDocumentId) return globalPreferences;
        return normalizeReaderPreferences({ ...globalPreferences, ...(readerState.preferenceOverrides || {}) });
    }

    function assignReaderPreferences(preferences) {
        readerState.layoutMode = preferences.layoutMode;
        readerState.pageTransition = preferences.pageTransition;
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
        readerState.paperMaterial = preferences.paperMaterial || 'flat';
        readerState.paperShadow = preferences.paperShadow !== false;
        readerState.paperVignette = preferences.paperVignette !== false;
        readerState.reducedMotionOverride = preferences.reducedMotionOverride;
        readerState.statusBarMode = preferences.statusBarMode || 'auto';
        readerState.statusBarFields = Array.isArray(preferences.statusBarFields) ? preferences.statusBarFields : ['chapter', 'page', 'percent'];
        readerState.statusBarAutoHide = preferences.statusBarAutoHide !== false;
        readerState.hudMode = preferences.hudMode || 'auto';
        readerState.keyboardPageTurn = preferences.keyboardPageTurn !== false;
        readerState.pointerPageTurn = preferences.pointerPageTurn !== false;
        readerState.touchPageTurn = preferences.touchPageTurn !== false;
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
        const transitionApi = window.DraftHarborReaderTransition;
        if (transitionApi && typeof transitionApi.createReaderTransitionAdapter === 'function') {
            return transitionApi.createReaderTransitionAdapter({
                transition: readerState.pageTransition,
                reducedMotion: readerReducedMotionActive()
            }).transition;
        }
        return ['fade', 'slide', 'cover', 'curl', 'none'].includes(readerState.pageTransition) ? readerState.pageTransition : 'none';
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
        const statusMode = document.querySelector('[data-reader-status-bar-mode]');
        if (statusMode) statusMode.value = readerState.statusBarMode || 'auto';
        document.querySelectorAll('[data-reader-status-field]').forEach((control) => {
            control.checked = (readerState.statusBarFields || []).includes(control.value);
        });
        const statusAutoHide = document.querySelector('[data-reader-status-bar-auto-hide]');
        if (statusAutoHide) statusAutoHide.checked = readerState.statusBarAutoHide !== false;
        const quickTheme = document.querySelector('[data-reader-quick-theme]');
        if (quickTheme) {
            const themeIds = window.DraftHarborReaderTheme && window.DraftHarborReaderTheme.BUILTIN_THEME_IDS || ['white', 'paper', 'warm', 'eye', 'ink', 'oled'];
            quickTheme.value = themeIds.includes(readerState.theme) ? readerState.theme : 'ink';
        }
        const quickFontFamily = document.querySelector('[data-reader-quick-font-family]');
        if (quickFontFamily) quickFontFamily.value = readerState.fontFamily;
        const quickLayout = document.querySelector('[data-reader-quick-layout]');
        if (quickLayout) quickLayout.value = readerState.layoutMode;
        const quickFontSize = document.querySelector('[data-reader-quick-font-size]');
        if (quickFontSize) quickFontSize.textContent = `${readerState.fontSize} px`;
        const scope = document.querySelector('[data-reader-preference-scope]');
        if (scope) scope.querySelector('option[value="document"]').disabled = !readerState.activeDocumentId;
        const reset = document.querySelector('[data-reader-preference-reset]');
        if (reset) reset.disabled = readerState.preferenceScope !== 'document' || !Object.keys(readerState.preferenceOverrides || {}).length;
        const deleteProfile = document.querySelector('[data-reader-appearance-delete]');
        if (deleteProfile) deleteProfile.disabled = !/^user:/.test(readerState.appearanceProfileId || '');
        const status = document.querySelector('[data-reader-font-status]');
        if (status) {
            const actual = readerState.actualFontFamily || readerFontStack().split(',')[0].replace(/["']/g, '');
            status.textContent = readerState.fontFallback ? `首选字体不可用，已回退到 ${actual}` : `当前字体：${actual}`;
        }
        const material = document.querySelector('[data-reader-paper-material]');
        if (material) material.value = readerState.paperMaterial || 'flat';
        const shadow = document.querySelector('input[data-reader-paper-shadow]');
        if (shadow) shadow.checked = readerState.paperShadow !== false;
        const vignette = document.querySelector('input[data-reader-paper-vignette]');
        if (vignette) vignette.checked = readerState.paperVignette !== false;
        const keyboardTurn = document.querySelector('[data-reader-keyboard-page-turn]');
        if (keyboardTurn) keyboardTurn.checked = readerState.keyboardPageTurn !== false;
        const pointerTurn = document.querySelector('[data-reader-pointer-page-turn]');
        if (pointerTurn) pointerTurn.checked = readerState.pointerPageTurn !== false;
        const touchTurn = document.querySelector('[data-reader-touch-page-turn]');
        if (touchTurn) touchTurn.checked = readerState.touchPageTurn !== false;
        const stage = document.querySelector('[data-reader-theme-panel]');
        if (stage) {
            stage.dataset.readerMotion = readerReducedMotionActive() ? 'reduce' : 'allow';
            stage.dataset.readerTransition = readerEffectiveTransition();
            stage.dataset.readerMaterial = readerState.paperMaterial || 'flat';
            stage.dataset.readerPaperShadow = readerState.paperShadow === false ? 'false' : 'true';
            stage.dataset.readerVignette = readerState.paperVignette === false ? 'false' : 'true';
            stage.dataset.readerStatusBarState = readerState.statusBarMode || 'auto';
            stage.dataset.readerStatusAutoHide = readerState.statusBarAutoHide === false ? 'false' : 'true';
        }
        const shell = document.querySelector('[data-reader-shell]');
        if (shell) {
            shell.dataset.readerStatusBarState = readerState.statusBarMode || 'auto';
            shell.dataset.readerStatusAutoHide = readerState.statusBarAutoHide === false ? 'false' : 'true';
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

    function updateReaderSetting(mutator, { markCustom = true, reflow = true, refreshProgress = false, releaseFocus = false, control = null } = {}) {
        const locator = typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : null;
        window.stopReaderPageFlip?.();
        const mutationResult = mutator();
        if (markCustom && mutationResult !== 'appearance-profile') {
            readerState.appearanceProfileId = 'custom';
        }
        readerState.anchorLocator = locator || readerState.anchorLocator;
        applyReaderSettings({ reflow });
        syncReaderSettingsControls();
        if (refreshProgress && typeof updateReaderWorkspaceProgress === 'function') updateReaderWorkspaceProgress();
        saveReaderState();
        scheduleReaderPreferenceSave();
        if (releaseFocus && control === document.activeElement) control.blur();
    }

    function bindReaderSetting(selector, eventName, mutator, options) {
        const control = document.querySelector(selector);
        control?.addEventListener(eventName, () => updateReaderSetting(() => mutator(control), { ...(options || {}), control }));
    }

    function initializeReaderSettings() {
        window.initializeReaderFonts?.();
        window.initializeReaderTts?.();
        loadReaderPreferences();
        window.loadReaderAppearanceProfiles?.();
        bindReaderSetting('[data-reader-letter-spacing]', 'input', (control) => { readerState.letterSpacing = Number(control.value) || 0; });
        bindReaderSetting('[data-reader-page-margin]', 'input', (control) => { readerState.pageMargin = Number(control.value) || 48; });
        bindReaderSetting('[data-reader-text-align]', 'change', (control) => { readerState.textAlign = control.value || 'start'; }, { reflow: false });
        bindReaderSetting('[data-reader-layout-mode]', 'change', (control) => { readerState.layoutMode = control.value || 'flow'; }, { releaseFocus: true });
        bindReaderSetting('[data-reader-page-transition]', 'change', (control) => { readerState.pageTransition = control.value || 'none'; }, { reflow: false, releaseFocus: true });
        bindReaderSetting('[data-reader-reduced-motion]', 'change', (control) => {
            readerState.reducedMotionOverride = control.value === 'reduce' ? true : control.value === 'allow' ? false : undefined;
        }, { reflow: false });
        bindReaderSetting('[data-reader-status-bar-mode]', 'change', (control) => { readerState.statusBarMode = control.value || 'auto'; }, { reflow: false });
        document.querySelectorAll('[data-reader-status-field]').forEach((control) => {
            control.addEventListener('change', () => {
                const fields = Array.from(document.querySelectorAll('[data-reader-status-field]:checked')).map((item) => item.value);
                readerState.statusBarFields = fields.length ? fields : ['chapter'];
                updateReaderSetting(() => undefined, { reflow: false, refreshProgress: true });
            });
        });
        bindReaderSetting('[data-reader-status-bar-auto-hide]', 'change', (control) => { readerState.statusBarAutoHide = control.checked; }, { reflow: false });
        bindReaderSetting('[data-reader-paper-material]', 'change', (control) => { readerState.paperMaterial = control.value || 'flat'; }, { reflow: false });
        bindReaderSetting('input[data-reader-paper-shadow]', 'change', (control) => { readerState.paperShadow = control.checked; }, { reflow: false });
        bindReaderSetting('input[data-reader-paper-vignette]', 'change', (control) => { readerState.paperVignette = control.checked; }, { reflow: false });
        bindReaderSetting('[data-reader-keyboard-page-turn]', 'change', (control) => { readerState.keyboardPageTurn = control.checked; }, { reflow: false });
        bindReaderSetting('[data-reader-pointer-page-turn]', 'change', (control) => { readerState.pointerPageTurn = control.checked; }, { reflow: false });
        bindReaderSetting('[data-reader-touch-page-turn]', 'change', (control) => { readerState.touchPageTurn = control.checked; }, { reflow: false });
        bindReaderSetting('[data-reader-font-family]', 'change', (control) => {
            readerState.fontId = window.readerFontIdForSelection?.(control) || control.value || 'builtin:default';
            readerState.fontFamily = window.readerFontFamilyForSelection?.(control) || control.value || 'system';
        });
        bindReaderSetting('[data-reader-appearance-profile]', 'change', (control) => window.applyReaderAppearanceProfile?.(control.value || 'default'), { markCustom: false });
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

    window.readerPreferenceSnapshot = readerPreferenceSnapshot;
    window.readerEffectivePreferences = readerEffectivePreferences;
    window.syncReaderSettingsControls = syncReaderSettingsControls;
    window.restoreReaderPreferenceSnapshot = function restoreReaderPreferenceSnapshot(snapshot) {
        const preferences = normalizeReaderPreferences(snapshot || {});
        assignReaderPreferences(preferences);
        applyReaderSettings();
        syncReaderSettingsControls();
        saveReaderState();
        scheduleReaderPreferenceSave();
    };
