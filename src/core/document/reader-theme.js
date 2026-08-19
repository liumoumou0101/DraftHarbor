(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderTheme = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const THEME_SCHEMA_VERSION = 1;
    const BUILTIN_THEME_IDS = Object.freeze(['paper', 'lamp', 'ink', 'oled']);
    const THEME_ALIASES = Object.freeze({
        white: 'paper',
        eye: 'paper',
        warm: 'lamp',
        sepia: 'lamp',
        dark: 'ink'
    });
    const THEME_NAMES = Object.freeze({
        paper: '书页',
        lamp: '灯下',
        ink: '墨夜',
        oled: '夜黑',
        white: '书页',
        eye: '书页',
        warm: '灯下',
        sepia: '灯下',
        dark: '墨夜'
    });
    const CORE_TOKEN_KEYS = Object.freeze([
        'environment', 'page', 'text', 'mutedText', 'control', 'controlText', 'material', 'effect'
    ]);
    const SHELL_TOKEN_KEYS = Object.freeze([
        'chrome', 'line', 'lineStrong', 'accent', 'accentText', 'danger', 'warning'
    ]);
    const TOKEN_KEYS = Object.freeze([...CORE_TOKEN_KEYS, ...SHELL_TOKEN_KEYS]);
    const PAPER_TOKENS = Object.freeze({
        environment: '#d2c8b8', page: '#f1eadb', text: '#2c2822', mutedText: '#6e665b',
        control: '#e7dece', controlText: '#2c2822', material: '#e8dfd0', effect: '#6a6154',
        chrome: '#e4dccf', line: '#c9bfae', lineStrong: '#b4a894', accent: '#6f6a4e',
        accentText: '#f1eadb', danger: '#a35348', warning: '#9a7040'
    });
    const LAMP_TOKENS = Object.freeze({
        environment: '#c4b396', page: '#f3e6c6', text: '#3a2e1c', mutedText: '#6f5c3d',
        control: '#ead9b0', controlText: '#3a2e1c', material: '#ebdbb4', effect: '#7a6238',
        chrome: '#e6d5ab', line: '#cbb892', lineStrong: '#b49d72', accent: '#7a6238',
        accentText: '#f3e6c6', danger: '#a35348', warning: '#8a6828'
    });
    const INK_TOKENS = Object.freeze({
        environment: '#26251f', page: '#2f2d27', text: '#e5ded0', mutedText: '#b9ae9d',
        control: '#3a3730', controlText: '#e5ded0', material: '#343129', effect: '#000000',
        chrome: '#2c2a24', line: '#454138', lineStrong: '#5a554a', accent: '#b0b98a',
        accentText: '#26251f', danger: '#d17872', warning: '#d0a45e'
    });
    const OLED_TOKENS = Object.freeze({
        environment: '#000000', page: '#070707', text: '#e6e1d6', mutedText: '#b8b2a6',
        control: '#161616', controlText: '#e6e1d6', material: '#101010', effect: '#000000',
        chrome: '#0c0c0c', line: '#2a2a2a', lineStrong: '#3d3d3d', accent: '#c4c1a8',
        accentText: '#111111', danger: '#d17872', warning: '#d0a45e'
    });
    const BUILTIN_TOKENS = Object.freeze({
        paper: PAPER_TOKENS,
        lamp: LAMP_TOKENS,
        ink: INK_TOKENS,
        oled: OLED_TOKENS,
        white: PAPER_TOKENS,
        eye: PAPER_TOKENS,
        warm: LAMP_TOKENS,
        sepia: LAMP_TOKENS,
        dark: INK_TOKENS
    });

    function cleanString(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function validThemeId(value) {
        const themeId = cleanString(value);
        if (Object.hasOwn(BUILTIN_TOKENS, themeId) || /^user:[a-z0-9][a-z0-9._-]{1,79}$/i.test(themeId)) return themeId;
        throw new Error(`reader themeId is invalid: ${themeId || '(empty)'}`);
    }

    function resolveReaderThemeId(value) {
        const themeId = validThemeId(value);
        return THEME_ALIASES[themeId] || themeId;
    }

    function hexChannels(hex) {
        return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    }

    function deriveShellTokens(core) {
        const darkPage = luminance(core.page) < 0.35;
        return {
            chrome: core.environment,
            line: darkPage ? '#454138' : '#c9bfae',
            lineStrong: darkPage ? '#5a554a' : '#b4a894',
            accent: core.effect === '#000000' ? core.mutedText : core.effect,
            accentText: core.page,
            danger: darkPage ? '#d17872' : '#a35348',
            warning: darkPage ? '#d0a45e' : '#9a7040'
        };
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
        const core = Object.fromEntries(CORE_TOKEN_KEYS.map((key) => [key, color(sourceTokens[key], `reader theme ${key}`)]));
        const derived = deriveShellTokens(core);
        const tokens = Object.fromEntries(TOKEN_KEYS.map((key) => {
            const raw = sourceTokens[key];
            return [key, raw ? color(raw, `reader theme ${key}`) : derived[key]];
        }));
        if (contrastRatio(tokens.text, tokens.page) < 4.5) throw new Error('reader theme text/page contrast must be at least 4.5:1');
        if (contrastRatio(tokens.controlText, tokens.control) < 4.5) throw new Error('reader theme control contrast must be at least 4.5:1');
        if (contrastRatio(tokens.accentText, tokens.accent) < 4.5) throw new Error('reader theme accent contrast must be at least 4.5:1');
        return Object.freeze({
            schemaVersion: THEME_SCHEMA_VERSION,
            themeId,
            canonicalId: resolveReaderThemeId(themeId),
            name: cleanString(input.name, THEME_NAMES[themeId] || themeId) || themeId,
            builtIn,
            tokens: Object.freeze(tokens)
        });
    }

    function builtInReaderThemes() {
        return BUILTIN_THEME_IDS.map((themeId) => createReaderTheme({ themeId }));
    }

    return {
        THEME_SCHEMA_VERSION,
        TOKEN_KEYS,
        CORE_TOKEN_KEYS,
        SHELL_TOKEN_KEYS,
        BUILTIN_THEME_IDS,
        THEME_ALIASES,
        THEME_NAMES,
        BUILTIN_TOKENS,
        createReaderTheme,
        builtInReaderThemes,
        resolveReaderThemeId,
        hexChannels,
        contrastRatio
    };
});
