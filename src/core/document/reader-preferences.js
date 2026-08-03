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
    const PAGE_TRANSITIONS = Object.freeze(['fade', 'slide', 'curl', 'none']);
    const THEME_IDS = Object.freeze(['dark', 'paper', 'sepia']);
    const FONT_IDS = Object.freeze(['builtin:default', 'builtin:serif', 'builtin:sans', 'builtin:kai']);
    const TEXT_ALIGNMENTS = Object.freeze(['start', 'justify']);

    const DEFAULT_PREFERENCES = Object.freeze({
        layoutMode: 'flow',
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
        reducedMotionOverride: undefined,
        appearanceProfileId: 'default'
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

    function createReaderPreferencesV2(input = {}) {
        const profileId = enumValue(input.appearanceProfileId, PROFILE_IDS, 'default', 'reader appearanceProfileId');
        const fontId = normalizeFontId(input);
        const reducedMotionOverride = input.reducedMotionOverride;
        if (![undefined, null, true, false].includes(reducedMotionOverride)) {
            throw new Error('reader reducedMotionOverride must be true, false or unset');
        }
        return {
            schemaVersion: PREFERENCES_SCHEMA_VERSION,
            layoutMode: enumValue(input.layoutMode, LAYOUT_MODES, DEFAULT_PREFERENCES.layoutMode, 'reader layoutMode'),
            pageTransition: enumValue(input.pageTransition, PAGE_TRANSITIONS, DEFAULT_PREFERENCES.pageTransition, 'reader pageTransition'),
            themeId: enumValue(input.themeId, THEME_IDS, DEFAULT_PREFERENCES.themeId, 'reader themeId'),
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
            reducedMotionOverride: reducedMotionOverride === null ? undefined : reducedMotionOverride,
            appearanceProfileId: profileId
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
        const profileId = enumValue(input.profileId || input.id, PROFILE_IDS.filter((id) => id !== 'custom'), 'default', 'reader profileId');
        const name = cleanString(input.name, profileId === 'paper' ? '纸张小说' : profileId === 'focus' ? '专注长读' : '默认阅读') || '阅读方案';
        return Object.freeze({
            schemaVersion: PROFILE_SCHEMA_VERSION,
            profileId,
            name,
            builtIn: input.builtIn !== false,
            preferences: createReaderPreferencesV2({ ...PROFILE_PRESETS[profileId], ...(input.preferences || {}), appearanceProfileId: profileId })
        });
    }

    function builtInAppearanceProfiles() {
        return ['default', 'paper', 'focus'].map((profileId) => createReaderAppearanceProfile({ profileId }));
    }

    return {
        PREFERENCES_SCHEMA_VERSION,
        PROFILE_SCHEMA_VERSION,
        PROFILE_IDS,
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
