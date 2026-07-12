(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborCompendiumSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const ENTRY_TYPES = Object.freeze([
        'character',
        'location',
        'organization',
        'item',
        'lore',
        'timeline',
        'note'
    ]);

    function nowIso() {
        return new Date().toISOString();
    }

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function defaultContextPolicy(existingAlwaysInContext) {
        return {
            mode: existingAlwaysInContext ? 'always' : 'manual',
            triggers: {
                title: true,
                aliases: true,
                tags: true,
                pov: true,
                sceneCharacters: true
            }
        };
    }

    function defaultCharacterProfile() {
        return {
            role: '',
            goal: '',
            motivation: '',
            conflict: '',
            voice: '',
            currentState: '',
            knowledge: '',
            relationshipNotes: ''
        };
    }

    function normalizeContextPolicy(input) {
        const raw = input && typeof input === 'object' ? input : {};
        const validModes = ['disabled', 'manual', 'mention', 'auto', 'always'];
        const mode = validModes.includes(raw.mode) ? raw.mode : 'manual';
        const triggersRaw = raw.triggers && typeof raw.triggers === 'object' ? raw.triggers : {};
        return {
            mode,
            triggers: {
                title: triggersRaw.title !== false,
                aliases: triggersRaw.aliases !== false,
                tags: triggersRaw.tags !== false,
                pov: triggersRaw.pov !== false,
                sceneCharacters: triggersRaw.sceneCharacters !== false
            }
        };
    }

    function normalizeTimestamp(value, fallback) {
        if (!value) return fallback;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const result = [];
        for (const value of Array.isArray(values) ? values : []) {
            const text = cleanString(value);
            if (!text || seen.has(text)) continue;
            seen.add(text);
            result.push(text);
        }
        return result;
    }

    function normalizeSourceReferences(values) {
        const seen = new Set();
        return (Array.isArray(values) ? values : [])
            .map((value) => {
                const source = value && typeof value === 'object' ? value : {};
                return {
                    sceneId: cleanString(source.sceneId),
                    excerpt: cleanString(source.excerpt),
                    createdAt: normalizeTimestamp(source.createdAt, nowIso())
                };
            })
            .filter((source) => source.sceneId || source.excerpt)
            .filter((source) => {
                const key = `${source.sceneId}\n${source.excerpt}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 40);
    }

    function typeFromCategory(value) {
        const text = cleanString(value).toLowerCase();
        const aliases = {
            characters: 'character',
            character: 'character',
            people: 'character',
            locations: 'location',
            location: 'location',
            places: 'location',
            organizations: 'organization',
            organization: 'organization',
            factions: 'organization',
            items: 'item',
            item: 'item',
            objects: 'item',
            lore: 'lore',
            worldbuilding: 'lore',
            timeline: 'timeline',
            timelines: 'timeline',
            notes: 'note',
            note: 'note'
        };
        return aliases[text] || (ENTRY_TYPES.includes(text) ? text : 'lore');
    }

    function makeId(prefix = 'entry') {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function createCompendiumEntry(input = {}) {
        const now = nowIso();
        const type = ENTRY_TYPES.includes(input.type) ? input.type : typeFromCategory(input.category);
        const id = cleanString(input.id, makeId(type));
        const rawPolicy = input.contextPolicy;
        const policyFromInput = rawPolicy && typeof rawPolicy === 'object';
        const alwaysFromInput = !!(input.alwaysInContext);
        const contextPolicy = normalizeContextPolicy(
            policyFromInput
                ? rawPolicy
                : alwaysFromInput
                    ? { mode: 'always' }
                    : defaultContextPolicy(false)
        );
        const alwaysInContext = alwaysFromInput || contextPolicy.mode === 'always';
        const characterProfile = type === 'character'
            ? {
                ...defaultCharacterProfile(),
                ...(input.characterProfile && typeof input.characterProfile === 'object' ? input.characterProfile : {})
            }
            : undefined;
        return {
            id,
            projectId: cleanString(input.projectId),
            type,
            category: cleanString(input.category, type),
            title: cleanString(input.title, '未命名资料') || '未命名资料',
            summary: cleanString(input.summary),
            body: input.body === undefined ? cleanString(input.content) : String(input.body || ''),
            tags: uniqueStrings(input.tags).slice(0, 40),
            aliases: uniqueStrings(input.aliases).slice(0, 40),
            relatedSceneIds: uniqueStrings(input.relatedSceneIds || input.sceneIds).slice(0, 80),
            sourceReferences: normalizeSourceReferences(input.sourceReferences),
            imageUrl: cleanString(input.imageUrl),
            alwaysInContext,
            contextPolicy,
            characterProfile,
            order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
            createdAt: normalizeTimestamp(input.createdAt || input.created, now),
            updatedAt: normalizeTimestamp(input.updatedAt || input.modified, now)
        };
    }

    function normalizeCompendiumEntries(entries = [], projectId = '') {
        const seen = new Set();
        return (Array.isArray(entries) ? entries : [])
            .map((entry, index) => createCompendiumEntry({
                ...entry,
                projectId: cleanString(entry && entry.projectId, projectId),
                order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index
            }))
            .filter((entry) => {
                if (seen.has(entry.id)) return false;
                seen.add(entry.id);
                return true;
            })
            .sort((a, b) => {
                const typeCompare = a.type.localeCompare(b.type);
                if (typeCompare) return typeCompare;
                return (Number(a.order) || 0) - (Number(b.order) || 0);
            });
    }

    function compendiumEntrySummary(entry) {
        const normalized = createCompendiumEntry(entry);
        return {
            id: normalized.id,
            projectId: normalized.projectId,
            type: normalized.type,
            category: normalized.category,
            title: normalized.title,
            summary: normalized.summary,
            tags: normalized.tags,
            aliases: normalized.aliases,
            alwaysInContext: normalized.alwaysInContext,
            contextPolicy: normalized.contextPolicy,
            characterProfile: normalized.characterProfile,
            sourceReferences: normalized.sourceReferences,
            updatedAt: normalized.updatedAt
        };
    }

    return {
        ENTRY_TYPES,
        createCompendiumEntry,
        normalizeCompendiumEntries,
        compendiumEntrySummary,
        normalizeSourceReferences,
        typeFromCategory,
        normalizeContextPolicy
    };
});
