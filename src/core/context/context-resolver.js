(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborContextResolver = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function cleanString(value) {
        return String(value || '').trim();
    }

    function uniquePush(list, item, key) {
        if (!item) return;
        const id = key(item);
        if (!id || list.some((existing) => key(existing) === id)) return;
        list.push(item);
    }

    function mentionNames(text, marker) {
        const pattern = marker === '@' ? /@\[([^\]]+)\]/g : /#\[([^\]]+)\]/g;
        const names = [];
        let match;
        while ((match = pattern.exec(String(text || '')))) {
            const name = cleanString(match[1]).toLowerCase();
            if (name) names.push(name);
        }
        return names;
    }

    function textLength(value) {
        return String(value || '').length;
    }

    function entryMatchesTitle(entry, names) {
        const title = cleanString(entry.title).toLowerCase();
        return names.includes(title);
    }

    function entryMatchesAliases(entry, names) {
        const aliases = Array.isArray(entry.aliases) ? entry.aliases.map((alias) => cleanString(alias).toLowerCase()) : [];
        return aliases.some((alias) => names.includes(alias));
    }

    function entryMatchesPov(entry, povCharacter) {
        const pov = cleanString(povCharacter || '').toLowerCase();
        if (!pov) return false;
        const title = cleanString(entry.title).toLowerCase();
        if (title === pov) return true;
        const aliases = Array.isArray(entry.aliases) ? entry.aliases.map((alias) => cleanString(alias).toLowerCase()) : [];
        return aliases.includes(pov);
    }

    function entryMatchesSceneCharacters(entry, sceneCharacters) {
        const chars = Array.isArray(sceneCharacters) ? sceneCharacters : [];
        if (!chars.length) return false;
        const title = cleanString(entry.title).toLowerCase();
        const aliases = Array.isArray(entry.aliases) ? entry.aliases.map((alias) => cleanString(alias).toLowerCase()) : [];
        return chars.some((char) => {
            const c = cleanString(char || '').toLowerCase();
            return title === c || aliases.includes(c);
        });
    }

    function sceneMatchesMention(scene, names) {
        return names.includes(cleanString(scene.title).toLowerCase());
    }

    function sceneSummary(scene, content = '') {
        return {
            id: scene.id,
            title: scene.title || '未命名场景',
            summary: (!scene.summaryStale && scene.summary) || String(content || '').slice(0, 500)
        };
    }

    function textMentionsTerm(text, term) {
        const source = String(text || '');
        const raw = String(term || '').trim();
        if (!source || !raw) return false;
        if (/^[A-Za-z0-9_-]+$/.test(raw)) {
            const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '($|[^A-Za-z0-9_-])', 'i');
            return re.test(source);
        }
        return source.toLowerCase().includes(raw.toLowerCase());
    }

    function sceneRelevanceScore(scene, index, currentIndex, currentChapterId, currentTags, currentPov, mentionText, mentionedSceneNames) {
        let score = index / Math.max(1, currentIndex + 1);
        if (currentChapterId && scene.chapterId === currentChapterId) score += 1;
        const tags = Array.isArray(scene.tags) ? scene.tags.map((tag) => cleanString(tag).toLowerCase()).filter(Boolean) : [];
        score += tags.filter((tag) => currentTags.includes(tag)).length * 3;
        if (currentPov && cleanString(scene.povCharacter || scene.pov).toLowerCase() === currentPov) score += 2;
        if (sceneMatchesMention(scene, mentionedSceneNames)) score += 8;
        if (textMentionsTerm(mentionText, scene.title)) score += 4;
        return score;
    }

    function getPolicy(entry) {
        if (entry.alwaysInContext) return 'always';
        const policy = entry.contextPolicy;
        if (!policy || typeof policy !== 'object') return 'manual';
        const validModes = ['disabled', 'manual', 'mention', 'auto', 'always'];
        return validModes.includes(policy.mode) ? policy.mode : 'manual';
    }

    function getTriggers(entry) {
        const policy = entry.contextPolicy;
        if (!policy || typeof policy !== 'object' || !policy.triggers || typeof policy.triggers !== 'object') {
            return { title: true, aliases: true, tags: true, pov: true, sceneCharacters: true };
        }
        return {
            title: policy.triggers.title !== false,
            aliases: policy.triggers.aliases !== false,
            tags: policy.triggers.tags !== false,
            pov: policy.triggers.pov !== false,
            sceneCharacters: policy.triggers.sceneCharacters !== false
        };
    }

    function applyBudget(context, maxChars) {
        if (!Number.isFinite(Number(maxChars)) || Number(maxChars) <= 0) return context;
        let remaining = Number(maxChars);
        const compendiumEntries = [];
        for (const entry of context.compendiumEntries) {
            const cost = textLength(entry.title) + textLength(entry.summary) + textLength(entry.body);
            if (cost > remaining && compendiumEntries.length) continue;
            compendiumEntries.push(entry);
            remaining -= cost;
            if (remaining <= 0) break;
        }
        const sceneSummaries = [];
        for (const scene of context.sceneSummaries) {
            const cost = textLength(scene.title) + textLength(scene.summary);
            if (cost > remaining && sceneSummaries.length) continue;
            sceneSummaries.push(scene);
            remaining -= cost;
            if (remaining <= 0) break;
        }
        return {
            ...context,
            compendiumEntries,
            sceneSummaries,
            budget: {
                maxChars: Number(maxChars),
                remaining: Math.max(0, remaining)
            }
        };
    }

    function resolveContext(input = {}) {
        const project = input.project || {};
        const selection = input.selection || {};
        const beat = input.beat || '';
        const currentSceneId = cleanString(selection.currentSceneId || input.currentSceneId || project.currentSceneId);
        const maxChars = selection.maxChars || input.maxChars || 5000;
        const povCharacter = cleanString(selection.povCharacter || input.povCharacter || '');
        const sceneCharacters = Array.isArray(selection.sceneCharacters || input.sceneCharacters)
            ? (selection.sceneCharacters || input.sceneCharacters)
            : (typeof (selection.sceneCharacters || input.sceneCharacters) === 'string'
                ? String(selection.sceneCharacters || input.sceneCharacters).split(',').map((s) => s.trim()).filter(Boolean)
                : []);
        const compendium = Array.isArray(project.compendium) ? project.compendium : [];
        const scenes = Array.isArray(project.scenes) ? project.scenes : [];
        const sceneContents = project.sceneContents && typeof project.sceneContents === 'object' ? project.sceneContents : {};
        const context = {
            compendiumEntries: [],
            sceneSummaries: [],
            manualText: cleanString(selection.manualText),
            includedEntryReasons: {},
            selected: {
                compendiumIds: Array.isArray(selection.compendiumIds) ? selection.compendiumIds : [],
                compendiumTags: Array.isArray(selection.compendiumTags) ? selection.compendiumTags : [],
                sceneIds: Array.isArray(selection.sceneIds) ? selection.sceneIds : [],
                chapterIds: Array.isArray(selection.chapterIds) ? selection.chapterIds : []
            }
        };

        const currentSceneObj = scenes.find((scene) => scene.id === currentSceneId);
        const currentSceneContent = (currentSceneObj && currentSceneObj.content) || sceneContents[currentSceneId] || '';
        const mentionText = [beat, currentSceneContent].filter(Boolean).join('\n\n');

        const entryMentionNames = mentionNames(beat, '@');
        for (const entry of compendium) {
            const policy = getPolicy(entry);
            const triggers = getTriggers(entry);
            const reasons = [];

            const selectedById = context.selected.compendiumIds.includes(entry.id);
            const selectedByTag = (entry.tags || []).some((tag) => context.selected.compendiumTags.includes(tag));

            if (selectedById) reasons.push('manual');
            if (selectedByTag) reasons.push('tag');

            const isAlways = policy === 'always' || entry.alwaysInContext;

            if (policy !== 'disabled' || selectedById || selectedByTag) {
                const selectedByExplicitTitle = triggers.title && entryMatchesTitle(entry, entryMentionNames);
                const selectedByExplicitAlias = triggers.aliases && entryMatchesAliases(entry, entryMentionNames);
                let mentionReason = selectedByExplicitTitle || selectedByExplicitAlias;

                if (policy === 'mention' || policy === 'auto') {
                    const selectedByPlainTitle = triggers.title && textMentionsTerm(mentionText, entry.title);
                    const selectedByPlainAlias = triggers.aliases && (entry.aliases || []).some(function (alias) { return textMentionsTerm(mentionText, alias); });
                    if (selectedByPlainTitle || selectedByPlainAlias) mentionReason = true;
                }

                if (mentionReason) reasons.push('mention');

                const selectedByTagMention = triggers.tags && (entry.tags || []).some((tag) => textMentionsTerm(mentionText, tag));
                if (selectedByTagMention) reasons.push('tag-mention');

                const selectedByPov = (policy === 'auto') && triggers.pov && entryMatchesPov(entry, povCharacter);
                if (selectedByPov) reasons.push('pov');

                const selectedBySceneChar = (policy === 'auto') && triggers.sceneCharacters && entryMatchesSceneCharacters(entry, sceneCharacters);
                if (selectedBySceneChar) reasons.push('scene-characters');
            }

            if (isAlways) {
                reasons.unshift('always');
            }

            if (reasons.length) {
                uniquePush(context.compendiumEntries, entry, (item) => item.id);
                context.includedEntryReasons[entry.id] = reasons;
            }
        }

        const sceneMentionNames = mentionNames(beat, '#');
        const currentIndex = scenes.findIndex((scene) => scene.id === currentSceneId);
        const currentTags = currentSceneObj && Array.isArray(currentSceneObj.tags)
            ? currentSceneObj.tags.map((tag) => cleanString(tag).toLowerCase()).filter(Boolean)
            : [];
        const currentChapterId = cleanString(currentSceneObj && currentSceneObj.chapterId);
        const currentPov = cleanString(currentSceneObj && (currentSceneObj.povCharacter || currentSceneObj.pov)).toLowerCase();
        const previousScenes = scenes
            .map((scene, index) => ({ scene, index }))
            .filter(({ scene, index }) => index < currentIndex && scene.summary && !scene.summaryStale)
            .sort((a, b) => {
                const scoreDiff = sceneRelevanceScore(b.scene, b.index, currentIndex, currentChapterId, currentTags, currentPov, mentionText, sceneMentionNames)
                    - sceneRelevanceScore(a.scene, a.index, currentIndex, currentChapterId, currentTags, currentPov, mentionText, sceneMentionNames);
                return scoreDiff || b.index - a.index;
            })
            .slice(0, Number(selection.recentSceneLimit || 6))
            .sort((a, b) => a.index - b.index);
        for (const { scene } of previousScenes) {
            uniquePush(context.sceneSummaries, sceneSummary(scene, sceneContents[scene.id] || scene.content), (item) => item.id || item.title);
        }
        for (const scene of scenes) {
            const selectedById = context.selected.sceneIds.includes(scene.id);
            const selectedByChapter = context.selected.chapterIds.includes(scene.chapterId);
            const selectedByMention = sceneMatchesMention(scene, sceneMentionNames);
            if (selectedById || selectedByChapter || selectedByMention) {
                uniquePush(context.sceneSummaries, sceneSummary(scene, sceneContents[scene.id] || scene.content), (item) => item.id || item.title);
            }
        }

        return applyBudget(context, maxChars);
    }

    return {
        resolveContext,
        mentionNames,
        applyBudget
    };
});
