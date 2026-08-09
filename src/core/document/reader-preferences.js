(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderPreferences = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PREFERENCES_SCHEMA_VERSION = 2;
    const PROFILE_SCHEMA_VERSION = 1;
    const PROFILE_IDS = Object.freeze(['default', 'paper', 'focus', 'custom']);
    const LAYOUT_MODES = Object.freeze(['flow', 'single-page', 'double-page', 'auto']);
    const PAGE_TRANSITIONS = Object.freeze(['fade', 'slide', 'cover', 'curl', 'none']);
    const THEME_IDS = Object.freeze(['white', 'paper', 'warm', 'eye', 'ink', 'oled', 'dark', 'sepia']);
    const FONT_IDS = Object.freeze(['builtin:default', 'builtin:serif', 'builtin:sans', 'builtin:kai']);
    const TEXT_ALIGNMENTS = Object.freeze(['start', 'justify']);
    const VISIBILITY_MODES = Object.freeze(['auto', 'visible', 'hidden']);
    const PAPER_MATERIALS = Object.freeze(['flat', 'soft', 'grain']);
    const STATUS_BAR_FIELDS = Object.freeze(['chapter', 'page', 'percent', 'characters', 'eta']);

    const DEFAULT_PREFERENCES = Object.freeze({
        layoutMode: 'double-page',
        pageTransition: 'fade',
        themeId: 'dark',
        fontId: 'builtin:default',
        fontFamilyId: 'system',
        fontSize: 18,
        lineHeight: 1.8,
        letterSpacing: 0,
        paragraphSpacing: 1.05,
        pageMargin: 48,
        textWidth: 760,
        textAlign: 'start',
        indent: true,
        paperMaterial: 'flat',
        paperShadow: true,
        paperVignette: true,
        reducedMotionOverride: undefined,
        appearanceProfileId: 'default',
        statusBarMode: 'auto',
        statusBarFields: ['chapter', 'page', 'percent'],
        statusBarAutoHide: true,
        hudMode: 'auto',
        keyboardPageTurn: true,
        pointerPageTurn: true,
        touchPageTurn: true
    });

    const PROFILE_PRESETS = Object.freeze({
        default: Object.freeze({ ...DEFAULT_PREFERENCES }),
        paper: Object.freeze({
            ...DEFAULT_PREFERENCES,
            appearanceProfileId: 'paper',
            themeId: 'paper',
            fontId: 'builtin:serif',
            fontFamilyId: 'serif',
            fontSize: 19,
            lineHeight: 1.85,
            paragraphSpacing: 1.1,
            pageMargin: 56,
            textWidth: 720,
            pageTransition: 'fade'
        }),
        focus: Object.freeze({
            ...DEFAULT_PREFERENCES,
            appearanceProfileId: 'focus',
            themeId: 'sepia',
            fontId: 'builtin:default',
            fontFamilyId: 'system',
            fontSize: 20,
            lineHeight: 1.95,
            paragraphSpacing: 1.18,
            pageMargin: 64,
            textWidth: 740,
            pageTransition: 'none'
        })
    });

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function finiteNumber(value, fallback, minimum, maximum) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(minimum, Math.min(maximum, number));
    }

    function enumValue(value, allowed, fallback, label) {
        const normalized = cleanString(value, fallback);
        if (!allowed.includes(normalized)) throw new Error(`${label} is not supported: ${normalized || '(empty)'}`);
        return normalized;
    }

    function normalizeFontId(input = {}) {
        const requested = cleanString(input.fontId);
        if (requested) return requested;
        const family = cleanString(input.fontFamilyId, 'system');
        return {
            system: 'builtin:default',
            serif: 'builtin:serif',
            'sans-serif': 'builtin:sans',
            kai: 'builtin:kai'
        }[family] || 'builtin:default';
    }

    function fontFamilyForId(fontId) {
        return {
            'builtin:default': 'system',
            'builtin:serif': 'serif',
            'builtin:sans': 'sans-serif',
            'builtin:kai': 'kai'
        }[fontId] || 'system';
    }

    function profileIdValue(value, fallback = 'default') {
        const profileId = cleanString(value, fallback);
        if (PROFILE_IDS.includes(profileId) || /^user:[a-z0-9][a-z0-9._-]{1,79}$/i.test(profileId)) return profileId;
        throw new Error(`reader appearanceProfileId is not supported: ${profileId || '(empty)'}`);
    }

    function themeIdValue(value, fallback = DEFAULT_PREFERENCES.themeId) {
        const themeId = cleanString(value, fallback);
        if (THEME_IDS.includes(themeId) || /^user:[a-z0-9][a-z0-9._-]{1,79}$/i.test(themeId)) return themeId;
        throw new Error(`reader themeId is not supported: ${themeId || '(empty)'}`);
    }

    function statusBarFieldsValue(value) {
        const requested = Array.isArray(value) ? value : DEFAULT_PREFERENCES.statusBarFields;
        const fields = [...new Set(requested.filter((field) => STATUS_BAR_FIELDS.includes(field)))];
        return fields.length ? fields : [...DEFAULT_PREFERENCES.statusBarFields];
    }

    function createReaderPreferencesV2(input = {}) {
        const profileId = profileIdValue(input.appearanceProfileId);
        const fontId = normalizeFontId(input);
        const reducedMotionOverride = input.reducedMotionOverride;
        if (![undefined, null, true, false].includes(reducedMotionOverride)) {
            throw new Error('reader reducedMotionOverride must be true, false or unset');
        }
        return {
            schemaVersion: PREFERENCES_SCHEMA_VERSION,
            layoutMode: enumValue(input.layoutMode, LAYOUT_MODES, DEFAULT_PREFERENCES.layoutMode, 'reader layoutMode'),
            pageTransition: enumValue(input.pageTransition, PAGE_TRANSITIONS, DEFAULT_PREFERENCES.pageTransition, 'reader pageTransition'),
            themeId: themeIdValue(input.themeId),
            fontId,
            fontFamilyId: cleanString(input.fontFamilyId, fontFamilyForId(fontId)) || 'system',
            fontCatalogVersion: Math.max(1, Math.floor(Number(input.fontCatalogVersion) || 1)),
            fontSize: finiteNumber(input.fontSize, DEFAULT_PREFERENCES.fontSize, 12, 48),
            lineHeight: finiteNumber(input.lineHeight, DEFAULT_PREFERENCES.lineHeight, 1.2, 3),
            letterSpacing: finiteNumber(input.letterSpacing, DEFAULT_PREFERENCES.letterSpacing, -0.05, 0.3),
            paragraphSpacing: finiteNumber(input.paragraphSpacing, DEFAULT_PREFERENCES.paragraphSpacing, 0, 3),
            pageMargin: finiteNumber(input.pageMargin, DEFAULT_PREFERENCES.pageMargin, 12, 160),
            textWidth: finiteNumber(input.textWidth, DEFAULT_PREFERENCES.textWidth, 420, 1400),
            textAlign: enumValue(input.textAlign, TEXT_ALIGNMENTS, DEFAULT_PREFERENCES.textAlign, 'reader textAlign'),
            indent: input.indent !== false,
            paperMaterial: enumValue(input.paperMaterial, PAPER_MATERIALS, DEFAULT_PREFERENCES.paperMaterial, 'reader paperMaterial'),
            paperShadow: input.paperShadow !== false,
            paperVignette: input.paperVignette !== false,
            reducedMotionOverride: reducedMotionOverride === null ? undefined : reducedMotionOverride,
            appearanceProfileId: profileId,
            statusBarMode: enumValue(input.statusBarMode, VISIBILITY_MODES, DEFAULT_PREFERENCES.statusBarMode, 'reader statusBarMode'),
            statusBarFields: statusBarFieldsValue(input.statusBarFields),
            statusBarAutoHide: input.statusBarAutoHide !== false,
            hudMode: enumValue(input.hudMode, VISIBILITY_MODES, DEFAULT_PREFERENCES.hudMode, 'reader hudMode'),
            keyboardPageTurn: input.keyboardPageTurn !== false,
            pointerPageTurn: input.pointerPageTurn !== false,
            touchPageTurn: input.touchPageTurn !== false
        };
    }

    function migrateReaderPreferences(input = {}) {
        return createReaderPreferencesV2({ ...input, fontId: normalizeFontId(input) });
    }

    function mergeReaderPreferenceLayers(...layers) {
        const merged = { ...DEFAULT_PREFERENCES };
        layers.filter((layer) => layer && typeof layer === 'object' && !Array.isArray(layer)).forEach((layer) => {
            Object.assign(merged, layer);
        });
        return createReaderPreferencesV2(merged);
    }

    function createReaderAppearanceProfile(input = {}) {
        const profileId = profileIdValue(input.profileId || input.id);
        if (profileId === 'custom') throw new Error('reader profileId is not supported: custom');
        const builtIn = Object.hasOwn(PROFILE_PRESETS, profileId);
        const name = cleanString(input.name, profileId === 'paper' ? '纸张小说' : profileId === 'focus' ? '专注长读' : '默认阅读') || '阅读方案';
        return Object.freeze({
            schemaVersion: PROFILE_SCHEMA_VERSION,
            profileId,
            name,
            builtIn,
            preferences: createReaderPreferencesV2({
                ...(builtIn ? PROFILE_PRESETS[profileId] : DEFAULT_PREFERENCES),
                ...(builtIn ? {} : input.preferences || {}),
                appearanceProfileId: profileId
            })
        });
    }

    function builtInAppearanceProfiles() {
        return ['default', 'paper', 'focus'].map((profileId) => createReaderAppearanceProfile({ profileId }));
    }

    return {
        PREFERENCES_SCHEMA_VERSION,
        PROFILE_SCHEMA_VERSION,
        PROFILE_IDS,
        VISIBILITY_MODES,
        PAPER_MATERIALS,
        STATUS_BAR_FIELDS,
        FONT_IDS,
        DEFAULT_PREFERENCES,
        PROFILE_PRESETS,
        createReaderPreferencesV2,
        migrateReaderPreferences,
        mergeReaderPreferenceLayers,
        createReaderAppearanceProfile,
        builtInAppearanceProfiles,
        fontFamilyForId
    };
});
