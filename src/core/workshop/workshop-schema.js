(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborWorkshopSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const ROLES = Object.freeze(['user', 'assistant', 'system']);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function timestamp(value) {
        if (value) {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime())) return date.toISOString();
        }
        return new Date().toISOString();
    }

    function makeId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function createWorkshopMessage(input = {}) {
        return {
            id: cleanString(input.id, makeId('message')),
            role: ROLES.includes(input.role) ? input.role : 'user',
            content: String(input.content || ''),
            createdAt: timestamp(input.createdAt || input.timestamp),
            isError: !!input.isError,
            meta: input.meta && typeof input.meta === 'object' ? input.meta : {}
        };
    }

    function createWorkshopSession(input = {}) {
        const now = timestamp(input.createdAt || input.created);
        const rawContract = input.directiveContract && typeof input.directiveContract === 'object'
            ? input.directiveContract : {};
        return {
            id: cleanString(input.id, makeId('workshop')),
            projectId: cleanString(input.projectId),
            title: cleanString(input.title || input.name, '新对话') || '新对话',
            messages: Array.isArray(input.messages) ? input.messages.map(createWorkshopMessage) : [],
            directiveContract: {
                enabled: !!rawContract.enabled,
                content: cleanString(rawContract.content),
                reinforcedAt: cleanString(rawContract.reinforcedAt),
                pinMode: ['off', 'tail', 'sandwich'].includes(rawContract.pinMode) ? rawContract.pinMode : 'off'
            },
            createdAt: timestamp(input.createdAt || input.created || now),
            updatedAt: timestamp(input.updatedAt || input.modified || now)
        };
    }

    function normalizeWorkshopSessions(sessions = [], projectId = '') {
        const seen = new Set();
        return (Array.isArray(sessions) ? sessions : [])
            .map((session) => createWorkshopSession({
                ...session,
                projectId: cleanString(session && session.projectId, projectId)
            }))
            .filter((session) => {
                if (seen.has(session.id)) return false;
                seen.add(session.id);
                return true;
            })
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    return {
        ROLES,
        createWorkshopMessage,
        createWorkshopSession,
        normalizeWorkshopSessions
    };
});
