(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./compendium-schema'));
    } else {
        root.DraftHarborCompendiumAgentPolicy = factory(root.DraftHarborCompendiumSchema);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CompendiumSchema) {
    const AGENT_EDITABLE_FIELDS = Object.freeze(['summary', 'tags', 'aliases', 'characterProfile']);
    const CHARACTER_PROFILE_FIELDS = Object.freeze([
        'role', 'goal', 'motivation', 'conflict', 'voice', 'currentState', 'knowledge', 'relationshipNotes'
    ]);
    const SEVERITIES = Object.freeze(['low', 'medium', 'high']);
    const MAX_CARDS_PER_RUN = 50;
    const DEFAULT_MAX_CARDS_PER_RUN = 30;

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function boundedString(value, maxLength, fallback = '') {
        return cleanString(value, fallback).slice(0, maxLength);
    }

    function uniqueStrings(values, maxItems, maxLength) {
        const seen = new Set();
        const result = [];
        for (const value of Array.isArray(values) ? values : []) {
            const text = boundedString(value, maxLength);
            if (!text || seen.has(text)) continue;
            seen.add(text);
            result.push(text);
            if (result.length >= maxItems) break;
        }
        return result;
    }

    function boundedInteger(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, Math.round(parsed)));
    }

    function normalizeCompendiumAgentSettings(input = {}) {
        const raw = input && typeof input === 'object' ? input : {};
        return {
            enabled: !!raw.enabled,
            providerProfileId: boundedString(raw.providerProfileId, 160),
            model: boundedString(raw.model, 240),
            // MVP only supports read-only access to a card body. Manuscript text is never in this contract.
            cardBodyAccess: raw.cardBodyAccess === 'none' ? 'none' : 'read-only',
            maxCardsPerRun: boundedInteger(raw.maxCardsPerRun, DEFAULT_MAX_CARDS_PER_RUN, 1, MAX_CARDS_PER_RUN)
        };
    }

    function stableStringify(value) {
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
        if (!value || typeof value !== 'object') return JSON.stringify(value);
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    function fnv1a(value) {
        let hash = 0x811c9dc5;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function entryRevision(entry) {
        const normalized = CompendiumSchema.createCompendiumEntry(entry || {});
        return `entry-v1-${fnv1a(stableStringify({
            id: normalized.id,
            type: normalized.type,
            category: normalized.category,
            title: normalized.title,
            summary: normalized.summary,
            body: normalized.body,
            tags: normalized.tags,
            aliases: normalized.aliases,
            characterProfile: normalized.characterProfile,
            sourceReferences: normalized.sourceReferences,
            contextPolicy: normalized.contextPolicy,
            updatedAt: normalized.updatedAt
        }))}`;
    }

    function createAgentEntrySnapshot(entry, settingsInput = {}) {
        const settings = normalizeCompendiumAgentSettings(settingsInput);
        const normalized = CompendiumSchema.createCompendiumEntry(entry || {});
        const snapshot = {
            id: normalized.id,
            revision: entryRevision(normalized),
            type: normalized.type,
            category: normalized.category,
            title: normalized.title,
            summary: normalized.summary,
            tags: normalized.tags.slice(),
            aliases: normalized.aliases.slice(),
            characterProfile: normalized.characterProfile ? { ...normalized.characterProfile } : null
        };
        if (settings.cardBodyAccess === 'read-only') snapshot.body = normalized.body;
        return snapshot;
    }

    function createAgentInputSnapshot(entries, settingsInput = {}) {
        const settings = normalizeCompendiumAgentSettings(settingsInput);
        return {
            version: 1,
            entries: (Array.isArray(entries) ? entries : [])
                .slice(0, settings.maxCardsPerRun)
                .map((entry) => createAgentEntrySnapshot(entry, settings))
        };
    }

    function validatePatch(patch) {
        const raw = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
        const errors = [];
        const normalized = {};
        const keys = Object.keys(raw);
        if (!keys.length) errors.push('patch is required');
        keys.forEach((key) => {
            if (!AGENT_EDITABLE_FIELDS.includes(key)) errors.push(`field is not editable: ${key}`);
        });
        if (Object.prototype.hasOwnProperty.call(raw, 'summary')) {
            if (typeof raw.summary !== 'string') errors.push('summary must be a string');
            else normalized.summary = boundedString(raw.summary, 4000);
        }
        ['tags', 'aliases'].forEach((field) => {
            if (!Object.prototype.hasOwnProperty.call(raw, field)) return;
            if (!Array.isArray(raw[field])) errors.push(`${field} must be an array`);
            else normalized[field] = uniqueStrings(raw[field], 40, 120);
        });
        if (Object.prototype.hasOwnProperty.call(raw, 'characterProfile')) {
            const profile = raw.characterProfile;
            if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
                errors.push('characterProfile must be an object');
            } else {
                const nextProfile = {};
                Object.keys(profile).forEach((key) => {
                    if (!CHARACTER_PROFILE_FIELDS.includes(key)) errors.push(`characterProfile field is not editable: ${key}`);
                    else if (typeof profile[key] !== 'string') errors.push(`characterProfile.${key} must be a string`);
                    else nextProfile[key] = boundedString(profile[key], 2000);
                });
                if (!Object.keys(nextProfile).length) errors.push('characterProfile patch is empty');
                else normalized.characterProfile = nextProfile;
            }
        }
        return { ok: errors.length === 0, errors, patch: normalized };
    }

    function validateOperation(input = {}) {
        const raw = input && typeof input === 'object' ? input : {};
        const errors = [];
        const entryId = boundedString(raw.entryId, 160);
        const baseRevision = boundedString(raw.baseRevision, 80);
        if (!entryId) errors.push('entryId is required');
        if (!baseRevision) errors.push('baseRevision is required');
        const patchResult = validatePatch(raw.patch);
        errors.push(...patchResult.errors);
        return {
            ok: errors.length === 0,
            errors,
            operation: { id: boundedString(raw.id, 160), entryId, baseRevision, patch: patchResult.patch }
        };
    }

    function validateOperations(input, options = {}) {
        const operations = Array.isArray(input) ? input : [];
        const maxOperations = boundedInteger(options.maxOperations, DEFAULT_MAX_CARDS_PER_RUN, 1, MAX_CARDS_PER_RUN);
        const errors = [];
        const normalized = [];
        const seenEntryIds = new Set();
        if (!operations.length && options.requireOperation !== false) errors.push('at least one operation is required');
        if (operations.length > maxOperations) errors.push(`operation limit is ${maxOperations}`);
        operations.slice(0, maxOperations).forEach((operation, index) => {
            const result = validateOperation(operation);
            if (!result.ok) errors.push(...result.errors.map((error) => `operations[${index}]: ${error}`));
            if (seenEntryIds.has(result.operation.entryId)) errors.push(`operations[${index}]: duplicate entryId`);
            seenEntryIds.add(result.operation.entryId);
            normalized.push(result.operation);
        });
        return { ok: errors.length === 0, errors, operations: normalized };
    }

    function validateOperationsAgainstEntries(operations, entries, options = {}) {
        const result = validateOperations(operations, options);
        const entryMap = new Map((Array.isArray(entries) ? entries : []).map((entry) => {
            const normalized = CompendiumSchema.createCompendiumEntry(entry || {});
            return [normalized.id, { entry: normalized, revision: cleanString(entry && entry.revision) || entryRevision(normalized) }];
        }));
        result.operations.forEach((operation, index) => {
            const record = entryMap.get(operation.entryId);
            if (!record) result.errors.push(`operations[${index}]: entry does not exist`);
            else if (record.revision !== operation.baseRevision) result.errors.push(`operations[${index}]: entry has changed`);
        });
        result.ok = result.errors.length === 0;
        return result;
    }

    function normalizeFinding(input = {}) {
        const raw = input && typeof input === 'object' ? input : {};
        return {
            id: boundedString(raw.id, 160),
            severity: SEVERITIES.includes(raw.severity) ? raw.severity : 'low',
            reason: boundedString(raw.reason, 1200),
            entryIds: uniqueStrings(raw.entryIds, MAX_CARDS_PER_RUN, 160),
            operationIds: uniqueStrings(raw.operationIds, MAX_CARDS_PER_RUN, 160)
        };
    }

    function validateAnalysisResult(input = {}, options = {}) {
        const raw = input && typeof input === 'object' ? input : {};
        const operationResult = validateOperations(raw.operations, { ...options, requireOperation: false });
        const findings = (Array.isArray(raw.findings) ? raw.findings : []).slice(0, MAX_CARDS_PER_RUN).map(normalizeFinding);
        const errors = operationResult.errors.slice();
        const operationIds = new Set(operationResult.operations.map((operation) => operation.id).filter(Boolean));
        findings.forEach((finding, index) => {
            if (!finding.id) errors.push(`findings[${index}]: id is required`);
            if (!finding.reason) errors.push(`findings[${index}]: reason is required`);
            if (!finding.entryIds.length) errors.push(`findings[${index}]: entryIds is required`);
            finding.operationIds.forEach((operationId) => {
                if (!operationIds.has(operationId)) errors.push(`findings[${index}]: unknown operationId`);
            });
        });
        return {
            ok: errors.length === 0,
            errors,
            result: { version: 1, findings, operations: operationResult.operations }
        };
    }

    function validateAnalysisResultAgainstEntries(input = {}, entries, options = {}) {
        const result = validateAnalysisResult(input, options);
        const entryMap = new Map((Array.isArray(entries) ? entries : []).map((entry) => {
            const normalized = CompendiumSchema.createCompendiumEntry(entry || {});
            return [normalized.id, normalized];
        }));
        const operationCheck = validateOperationsAgainstEntries(result.result.operations, entries, {
            ...options,
            requireOperation: false
        });
        operationCheck.errors.forEach((error) => {
            if (!result.errors.includes(error)) result.errors.push(error);
        });
        result.result.findings.forEach((finding, index) => {
            finding.entryIds.forEach((entryId) => {
                if (!entryMap.has(entryId)) result.errors.push(`findings[${index}]: entry does not exist`);
            });
        });
        result.ok = result.errors.length === 0;
        return result;
    }

    return {
        AGENT_EDITABLE_FIELDS,
        CHARACTER_PROFILE_FIELDS,
        SEVERITIES,
        MAX_CARDS_PER_RUN,
        DEFAULT_MAX_CARDS_PER_RUN,
        normalizeCompendiumAgentSettings,
        entryRevision,
        createAgentEntrySnapshot,
        createAgentInputSnapshot,
        validatePatch,
        validateOperation,
        validateOperations,
        validateOperationsAgainstEntries,
        normalizeFinding,
        validateAnalysisResult,
        validateAnalysisResultAgainstEntries
    };
});
