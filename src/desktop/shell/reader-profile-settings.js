(function () {
    function renderReaderAppearanceProfileOptions() {
        const control = document.querySelector('[data-reader-appearance-profile]');
        if (!control) return;
        const custom = control.querySelector('option[value="custom"]');
        control.querySelectorAll('option[data-reader-user-profile]').forEach((option) => option.remove());
        (readerState.appearanceProfiles || []).forEach((profile) => {
            const option = document.createElement('option');
            option.value = profile.profileId;
            option.textContent = profile.name;
            option.dataset.readerUserProfile = 'true';
            control.insertBefore(option, custom || null);
        });
    }

    async function loadReaderAppearanceProfiles() {
        try {
            const payload = await readerApi('/api/reader/appearances');
            readerState.appearanceProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
            readerState.appearanceRecordUpdatedAt = payload.updatedAt || '';
            renderReaderAppearanceProfileOptions();
            window.syncReaderSettingsControls?.();
        } catch (error) {
            readerState.appearanceProfiles = [];
            renderReaderAppearanceProfileOptions();
            console.warn('Failed to load reader appearance profiles:', error);
        }
    }

    function applyReaderAppearanceProfile(profileId) {
        const preferencesApi = window.DraftHarborReaderPreferences;
        const preset = preferencesApi?.PROFILE_PRESETS?.[profileId]
            || (readerState.appearanceProfiles || []).find((profile) => profile.profileId === profileId)?.preferences;
        if (!preset) return '';
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
            paperMaterial: preset.paperMaterial,
            paperShadow: preset.paperShadow,
            paperVignette: preset.paperVignette,
            reducedMotionOverride: preset.reducedMotionOverride,
            statusBarMode: preset.statusBarMode,
            statusBarFields: preset.statusBarFields,
            statusBarAutoHide: preset.statusBarAutoHide,
            hudMode: preset.hudMode,
            keyboardPageTurn: preset.keyboardPageTurn,
            pointerPageTurn: preset.pointerPageTurn,
            touchPageTurn: preset.touchPageTurn
        });
        return 'appearance-profile';
    }

    window.renderReaderAppearanceProfileOptions = renderReaderAppearanceProfileOptions;
    window.loadReaderAppearanceProfiles = loadReaderAppearanceProfiles;
    window.applyReaderAppearanceProfile = applyReaderAppearanceProfile;
})();
