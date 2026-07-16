(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./compendium-schema'));
    else root.DraftHarborReaderCompendiumExtraction = factory(root.DraftHarborCompendiumSchema);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CompendiumSchema) {
    const CARD_FIELDS = new Set(['type', 'title', 'summary', 'body', 'content', 'tags', 'aliases', 'characterProfile']);
    const PROFILE_FIELDS = new Set(['role', 'goal', 'motivation', 'conflict', 'voice', 'currentState', 'knowledge', 'relationshipNotes']);
    const DECISIONS = Object.freeze(['approved', 'approved-modified', 'abandoned']);

    function clean(value) { return String(value === undefined || value === null ? '' : value).trim(); }
    function identity(value) { return clean(value).toLocaleLowerCase().replace(/[\s·・_\-—]+/g, ''); }
    function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))].slice(0, 40); }

    function chunkText(textInput, options = {}) {
        const text = String(textInput || '');
        const size = Math.max(1000, Number(options.size) || 12000);
        const overlap = Math.min(size - 1, Math.max(0, Number(options.overlap) || 800));
        if (!text) return [];
        const chunks = [];
        let start = 0;
        while (start < text.length) {
            let end = Math.min(text.length, start + size);
            if (end < text.length) {
                const boundary = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('\n', end));
                if (boundary > start + Math.floor(size * 0.6)) end = boundary;
            }
            chunks.push({ index: chunks.length, start, end, text: text.slice(start, end) });
            if (end >= text.length) break;
            start = Math.max(start + 1, end - overlap);
        }
        return chunks;
    }

    function rejectUnknownFields(input, allowed, label) {
        const unknown = Object.keys(input || {}).filter((key) => !allowed.has(key));
        if (unknown.length) throw new Error(`${label} contains unauthorized fields: ${unknown.join(', ')}`);
    }

    function normalizeCard(input, evidence = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('extracted card must be an object');
        rejectUnknownFields(input, CARD_FIELDS, 'extracted card');
        if (!CompendiumSchema.ENTRY_TYPES.includes(input.type)) throw new Error(`unknown compendium card type: ${clean(input.type) || '(empty)'}`);
        if (!clean(input.title)) throw new Error('extracted card title is required');
        const profile = input.characterProfile && typeof input.characterProfile === 'object' ? input.characterProfile : {};
        rejectUnknownFields(profile, PROFILE_FIELDS, 'characterProfile');
        return {
            type: input.type,
            title: clean(input.title).slice(0, 200),
            summary: clean(input.summary).slice(0, 4000),
            body: String(input.body === undefined ? input.content || '' : input.body).slice(0, 40000),
            tags: unique(input.tags), aliases: unique(input.aliases),
            characterProfile: input.type === 'character' ? Object.fromEntries([...PROFILE_FIELDS].map((field) => [field, clean(profile[field]).slice(0, 4000)])) : undefined,
            evidence: [{ chunkIndex: evidence.chunkIndex, start: evidence.start, end: evidence.end, excerpt: clean(evidence.excerpt).slice(0, 1200) }]
        };
    }

    function names(card) { return unique([card.title, ...(card.aliases || [])]).map(identity).filter(Boolean); }
    function mergeCards(cards, limit = 80) {
        if (!Array.isArray(cards)) throw new Error('extracted cards must be an array');
        if (cards.length > limit * 4) throw new Error('extracted card result exceeds the safety limit');
        const merged = [];
        cards.forEach((card) => {
            const keys = new Set(names(card));
            const existing = merged.find((item) => item.type === card.type && names(item).some((key) => keys.has(key)));
            if (!existing) { merged.push({ ...card }); return; }
            existing.aliases = unique([...existing.aliases, card.title, ...card.aliases].filter((name) => identity(name) !== identity(existing.title)));
            existing.tags = unique([...existing.tags, ...card.tags]);
            existing.summary = existing.summary || card.summary;
            existing.body = existing.body.length >= card.body.length ? existing.body : card.body;
            existing.evidence = [...existing.evidence, ...card.evidence].slice(0, 40);
            if (existing.characterProfile && card.characterProfile) {
                Object.keys(existing.characterProfile).forEach((field) => { if (!existing.characterProfile[field]) existing.characterProfile[field] = card.characterProfile[field]; });
            }
        });
        if (merged.length > limit) throw new Error('merged card result exceeds the safety limit');
        return merged;
    }

    function compareCandidates(candidates, entries) {
        return candidates.map((candidate, index) => {
            const candidateNames = new Set(names(candidate));
            const matches = (entries || []).filter((entry) => entry.type === candidate.type && names(entry).some((name) => candidateNames.has(name)));
            const exact = matches.find((entry) => identity(entry.title) === identity(candidate.title));
            return {
                candidateId: `candidate-${index + 1}`,
                classification: exact ? 'update' : matches.length ? 'suspected-duplicate' : 'new',
                existingEntryId: exact ? exact.id : '',
                suspectedEntryIds: matches.map((entry) => entry.id),
                card: candidate,
                decision: '', modifiedCard: null
            };
        });
    }

    function validateDecisions(candidates) {
        const list = Array.isArray(candidates) ? candidates : [];
        const undecided = list.filter((item) => !DECISIONS.includes(item.decision));
        if (undecided.length) throw new Error(`every candidate requires an explicit decision; ${undecided.length} remain unreviewed`);
        return list;
    }

    return { CARD_FIELDS, PROFILE_FIELDS, DECISIONS, chunkText, normalizeCard, mergeCards, compareCandidates, validateDecisions, identity };
});
