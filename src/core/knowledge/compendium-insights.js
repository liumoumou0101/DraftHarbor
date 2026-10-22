(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborCompendiumInsights = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const LIMITS = Object.freeze({ mentions: 50, related: 12, sources: 40 });
    const SOURCE_FIELDS = ['kind', 'envelopeId', 'batchId', 'candidateId', 'documentId', 'revisionId', 'sectionId', 'chapterId', 'sceneId', 'excerpt', 'createdAt'];

    function clean(value) {
        return value === null || value === undefined || typeof value === 'object' ? '' : String(value).trim();
    }

    function array(value) {
        return Array.isArray(value) ? value : [];
    }

    function names(entry) {
        return [...new Set([entry && entry.title, ...array(entry && entry.aliases)].map(clean).filter(Boolean))];
    }

    function firstMatch(text, terms) {
        let first = -1;
        for (const term of array(terms).map(clean).filter(Boolean)) {
            // A one-character name is too noisy in prose, but can match exact cast metadata.
            if (Array.from(term).length < 2) continue;
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const cjk = /[\u3040-\u30ff\u3400-\u9fff]/u.test(term);
            const pattern = cjk ? escaped : `(^|[^\\p{L}\\p{N}_-])(${escaped})(?=$|[^\\p{L}\\p{N}_-])`;
            const match = new RegExp(pattern, 'iu').exec(text);
            if (!match) continue;
            const index = match.index + (cjk ? 0 : match[1].length);
            if (first < 0 || index < first) first = index;
        }
        return first;
    }

    // Returns raw text, never HTML. Consumers must use textContent (or equivalent escaping).
    function excerpt(text, options = {}) {
        const plain = clean(text).replace(/\s+/gu, ' ');
        const requested = Number(options.maxLength);
        const limit = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 160;
        if (!limit) return '';
        const characters = Array.from(plain);
        if (characters.length <= limit) return plain;
        if (limit <= 2) return `${characters.slice(0, limit - 1).join('')}…`;
        const match = firstMatch(plain, options.terms);
        const matchIndex = match < 0 ? 0 : Array.from(plain.slice(0, match)).length;
        const width = Math.max(1, limit - 2);
        const start = Math.max(0, Math.min(matchIndex - Math.floor(width / 3), characters.length - width));
        const end = Math.min(characters.length, start + width);
        return `${start ? '…' : ''}${characters.slice(start, end).join('')}${end < characters.length ? '…' : ''}`;
    }

    function isSummaryEntry(entry) {
        return array(entry && entry.tags).some(tag => tag === 'scene-summary' || tag === 'chapter-summary')
            || array(entry && entry.sourceReferences).some(source => source && source.kind === 'summary');
    }

    function projectContext(entry, snapshot) {
        const project = snapshot && typeof snapshot === 'object' ? snapshot : {};
        const snapshotId = clean(project.project && project.project.id) || clean(project.id);
        const entryProjectId = clean(entry && entry.projectId);
        const allowed = !snapshotId || !entryProjectId || snapshotId === entryProjectId;
        const projectId = entryProjectId || snapshotId;
        const belongs = item => item && (!projectId || !clean(item.projectId) || clean(item.projectId) === projectId);
        return { project, allowed, belongs };
    }

    function collector(limit) {
        return { items: [], total: 0, add(value) { this.total += 1; if (this.items.length < limit) this.items.push(value); } };
    }

    function sceneContent(project, scene) {
        const contents = project.sceneContents;
        return clean(contents && Object.prototype.hasOwnProperty.call(contents, scene.id) ? contents[scene.id] : scene.content);
    }

    function castMatches(scene, terms) {
        const cast = [scene.povCharacter || scene.pov, ...array(scene.characters), ...array(scene.participants)].map(clean).filter(Boolean).map(value => value.toLowerCase());
        return terms.some(term => cast.includes(term.toLowerCase()));
    }

    function collectMentions(entry, context) {
        const result = collector(LIMITS.mentions);
        if (!context.allowed) return result;
        const { project, belongs } = context;
        const chapters = new Map(array(project.chapters).filter(belongs).map(chapter => [clean(chapter.id), chapter]));
        const chapterOrder = scene => Number((chapters.get(clean(scene.chapterId)) || {}).order) || 0;
        const scenes = array(project.scenes).filter(belongs).map((scene, index) => ({ scene, index })).sort((a, b) =>
            chapterOrder(a.scene) - chapterOrder(b.scene) || (Number(a.scene.order) || 0) - (Number(b.scene.order) || 0) || a.index - b.index);
        const explicit = new Set(array(entry.relatedSceneIds).map(clean).filter(Boolean));
        const terms = names(entry);
        const seen = new Set();
        for (const { scene } of scenes) {
            const sceneId = clean(scene.id);
            if (!sceneId || seen.has(sceneId)) continue;
            seen.add(sceneId);
            const content = sceneContent(project, scene);
            const matchKind = explicit.has(sceneId) ? 'explicit' : firstMatch(content, terms) >= 0 ? 'text' : castMatches(scene, terms) ? 'cast' : '';
            if (!matchKind) continue;
            const chapter = chapters.get(clean(scene.chapterId));
            result.add({ sceneId, chapterId: clean(scene.chapterId), sceneTitle: clean(scene.title), chapterTitle: clean(chapter && chapter.title), excerpt: excerpt(content, { terms }), matchKind });
        }
        return result;
    }

    function entryText(entry) {
        const profile = entry.characterProfile && typeof entry.characterProfile === 'object' ? Object.values(entry.characterProfile) : [];
        return [entry.summary, entry.body, ...profile].map(clean).filter(Boolean).join('\n');
    }

    function collectRelated(entry, context, entries) {
        const result = collector(LIMITS.related);
        if (!context.allowed) return result;
        const selectedText = entryText(entry);
        const selectedTerms = names(entry);
        const tags = new Set(array(entry.tags).map(tag => clean(tag).toLowerCase()).filter(Boolean));
        const seen = new Set();
        for (const candidate of array(entries)) {
            if (!context.belongs(candidate) || candidate === entry) continue;
            const entryId = clean(candidate.id);
            if (!entryId || entryId === clean(entry.id) || seen.has(entryId)) continue;
            seen.add(entryId);
            const candidateText = entryText(candidate);
            const candidateTerms = names(candidate);
            const reason = firstMatch(selectedText, candidateTerms) >= 0 ? 'mentions-entry'
                : firstMatch(candidateText, selectedTerms) >= 0 ? 'mentioned-by-entry'
                    : array(candidate.tags).some(tag => tags.has(clean(tag).toLowerCase())) ? 'shared-tag' : '';
            if (!reason) continue;
            result.add({ entryId, title: clean(candidate.title), type: clean(candidate.type),
                excerpt: excerpt(reason === 'mentions-entry' ? selectedText : candidateText, { terms: reason === 'mentions-entry' ? candidateTerms : selectedTerms }), reason });
        }
        return result;
    }

    function sourceLabel(source) {
        return [source.kind, source.documentId && `文档 ${source.documentId}`, source.sceneId && `场景 ${source.sceneId}`,
            source.chapterId && `章节 ${source.chapterId}`, source.sectionId && `分节 ${source.sectionId}`,
            !source.documentId && !source.sceneId && !source.chapterId && source.envelopeId].filter(Boolean).join(' · ') || '来源记录';
    }

    function collectSources(entry, context) {
        const result = collector(LIMITS.sources);
        const scenes = new Set(context.allowed ? array(context.project.scenes).filter(context.belongs).map(scene => clean(scene.id)).filter(Boolean) : []);
        const chapters = new Set(context.allowed ? array(context.project.chapters).filter(context.belongs).map(chapter => clean(chapter.id)).filter(Boolean) : []);
        const seen = new Set();
        for (const reference of array(entry.sourceReferences)) {
            if (!reference || typeof reference !== 'object') continue;
            const source = Object.fromEntries(SOURCE_FIELDS.map(field => [field, clean(reference[field])]));
            if (!SOURCE_FIELDS.some(field => field !== 'createdAt' && source[field])) continue;
            const key = JSON.stringify(SOURCE_FIELDS.filter(field => field !== 'createdAt').map(field => source[field]));
            if (seen.has(key)) continue;
            seen.add(key);
            result.add({ ...source, label: excerpt(sourceLabel(source), { maxLength: 180 }), excerpt: excerpt(source.excerpt),
                sceneAvailable: !!source.sceneId && scenes.has(source.sceneId), chapterAvailable: !!source.chapterId && chapters.has(source.chapterId) });
        }
        return result;
    }

    function analyzeEntry(entry, snapshot, entries) {
        const selected = entry && typeof entry === 'object' ? entry : {};
        const context = projectContext(selected, snapshot);
        const collections = {
            mentions: collectMentions(selected, context),
            related: collectRelated(selected, context, entries === undefined ? context.project.compendium : entries),
            sources: collectSources(selected, context)
        };
        const result = { totals: {}, truncated: {} };
        for (const [key, collection] of Object.entries(collections)) {
            result[key] = collection.items;
            result.totals[key] = collection.total;
            result.truncated[key] = collection.total > LIMITS[key];
        }
        return result;
    }

    return { analyzeEntry, excerpt, isSummaryEntry };
});
