(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderTheme = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const THEME_SCHEMA_VERSION = 1;
    const BUILTIN_THEME_IDS = Object.freeze(['white', 'paper', 'warm', 'eye', 'ink', 'oled']);
    const TOKEN_KEYS = Object.freeze([
        'environment', 'page', 'text', 'mutedText', 'control', 'controlText', 'material', 'effect'
    ]);
    const BUILTIN_TOKENS = Object.freeze({
        white: Object.freeze({ environment: '#eef1f4', page: '#ffffff', text: '#20242a', mutedText: '#5e6772', control: '#e2e7ec', controlText: '#20242a', material: '#f4f6f8', effect: '#64717d' }),
        dark: Object.freeze({ environment: '#171717', page: '#23211f', text: '#f1ece4', mutedText: '#b7aea2', control: '#35312d', controlText: '#ffffff', material: '#292622', effect: '#000000' }),
        paper: Object.freeze({ environment: '#cbc2b2', page: '#f5efe2', text: '#302b25', mutedText: '#6b6258', control: '#ded3c1', controlText: '#302b25', material: '#e8decc', effect: '#6d5f4d' }),
        warm: Object.freeze({ environment: '#d6bf91', page: '#f3e5bf', text: '#3b2b1b', mutedText: '#6d593e', control: '#dcc69b', controlText: '#3b2b1b', material: '#ead4a8', effect: '#876a3b' }),
        eye: Object.freeze({ environment: '#b7c6b0', page: '#e8f0dc', text: '#233026', mutedText: '#526454', control: '#cbdac3', controlText: '#233026', material: '#dce8d4', effect: '#58705b' }),
        ink: Object.freeze({ environment: '#171a1f', page: '#252a31', text: '#f1f4f5', mutedText: '#b1bac3', control: '#363d47', controlText: '#ffffff', material: '#2e343c', effect: '#000000' }),
        oled: Object.freeze({ environment: '#000000', page: '#050505', text: '#f7f7f7', mutedText: '#b8b8b8', control: '#1a1a1a', controlText: '#ffffff', material: '#101010', effect: '#000000' }),
        sepia: Object.freeze({ environment: '#b9a17f', page: '#ead9b8', text: '#3c3022', mutedText: '#70604c', control: '#d4bd96', controlText: '#3c3022', material: '#dfc9a3', effect: '#705636' })
    });

    function cleanString(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function validThemeId(value) {
        const themeId = cleanString(value);
        if (Object.hasOwn(BUILTIN_TOKENS, themeId) || /^user:[a-z0-9][a-z0-9._-]{1,79}$/i.test(themeId)) return themeId;
        throw new Error(`reader themeId is invalid: ${themeId || '(empty)'}`);
    }

    function color(value, label) {
        const normalized = cleanString(value).toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(normalized)) throw new Error(`${label} must be a six-digit hex color`);
        return normalized;
    }

    function luminance(hex) {
        const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
            .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }

    function contrastRatio(first, second) {
        const firstLuminance = luminance(color(first, 'first color'));
        const secondLuminance = luminance(color(second, 'second color'));
        return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
    }

    function createReaderTheme(input = {}) {
        const themeId = validThemeId(input.themeId || input.id);
        const builtIn = Object.hasOwn(BUILTIN_TOKENS, themeId);
        const sourceTokens = builtIn ? BUILTIN_TOKENS[themeId] : input.tokens;
        if (!sourceTokens || typeof sourceTokens !== 'object' || Array.isArray(sourceTokens)) throw new Error('reader theme tokens are required');
        const tokens = Object.fromEntries(TOKEN_KEYS.map((key) => [key, color(sourceTokens[key], `reader theme ${key}`)]));
        if (contrastRatio(tokens.text, tokens.page) < 4.5) throw new Error('reader theme text/page contrast must be at least 4.5:1');
        if (contrastRatio(tokens.controlText, tokens.control) < 4.5) throw new Error('reader theme control contrast must be at least 4.5:1');
        return Object.freeze({
            schemaVersion: THEME_SCHEMA_VERSION,
            themeId,
            name: cleanString(input.name, themeId) || themeId,
            builtIn,
            tokens: Object.freeze(tokens)
        });
    }

    function builtInReaderThemes() {
        return BUILTIN_THEME_IDS.map((themeId) => createReaderTheme({ themeId }));
    }

    return { THEME_SCHEMA_VERSION, TOKEN_KEYS, BUILTIN_THEME_IDS, BUILTIN_TOKENS, createReaderTheme, builtInReaderThemes, contrastRatio };
});
