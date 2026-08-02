(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowContextAssembly = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULT_BUDGETS = Object.freeze({
        lastSceneEnding: 1200,
        previousBatchEnding: 800,
        completedScenesTotal: 1200,
        completedSceneEach: 200,
        styleExemplarMin: 3000,
        styleExemplarMax: 4000,
        rolling: 3000,
        compendiumEachBody: 400,
        compendiumTotal: 1500,
        blueprintDigest: 800,
        previousReview: 400,
        summaryCap: 200,
        knownFactsMax: 12
    });

    const TYPE_RANK = Object.freeze({
        character: 0,
        location: 1,
        organization: 2,
        item: 3,
        lore: 4,
        timeline: 5,
        note: 6
    });

    function clean(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function list(value) {
        return Array.isArray(value) ? value : [];
    }

    function asObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function jsonSize(value) {
        try {
            return JSON.stringify(value === undefined ? null : value).length;
        } catch (_error) {
            return 0;
        }
    }

    function estimateTokensRough(chars) {
        const n = Math.max(0, Number(chars) || 0);
        return Math.ceil(n / 2);
    }

    function usageHintLabel(hint = {}) {
        const source = clean(hint.source, 'unavailable');
        if (source === 'provider' && Number.isFinite(Number(hint.inputTokens))) {
            return `输入 ${Math.round(Number(hint.inputTokens))} tokens（接口回传）`;
        }
        if (source === 'estimate' && Number.isFinite(Number(hint.estimatedInputTokens))) {
            const k = Number(hint.estimatedInputTokens);
            if (k >= 1000) return `约 ${Math.max(1, Math.round(k / 1000))}k 输入 tokens（估算）`;
            return `约 ${Math.round(k)} 输入 tokens（估算）`;
        }
        return '输入 tokens 不可用';
    }

    function buildUsageHint(input = {}) {
        const providerIn = Number(input.inputTokens);
        const providerOut = Number(input.outputTokens);
        if (Number.isFinite(providerIn) && providerIn > 0) {
            return {
                source: 'provider',
                inputTokens: providerIn,
                outputTokens: Number.isFinite(providerOut) ? providerOut : null,
                estimatedInputTokens: null,
                label: usageHintLabel({ source: 'provider', inputTokens: providerIn })
            };
        }
        const estimated = Number(input.estimatedInputTokens != null
            ? input.estimatedInputTokens
            : estimateTokensRough(input.promptChars));
        if (Number.isFinite(estimated) && estimated > 0) {
            return {
                source: 'estimate',
                inputTokens: null,
                outputTokens: null,
                estimatedInputTokens: estimated,
                label: usageHintLabel({ source: 'estimate', estimatedInputTokens: estimated })
            };
        }
        return {
            source: 'unavailable',
            inputTokens: null,
            outputTokens: null,
            estimatedInputTokens: null,
            label: usageHintLabel({ source: 'unavailable' })
        };
    }

    function sliceEnd(text, maxChars) {
        const source = String(text || '');
        const max = Math.max(0, Number(maxChars) || 0);
        if (!max || source.length <= max) return source;
        return source.slice(-max);
    }

    function sliceMid(text, maxChars) {
        const source = String(text || '');
        const max = Math.max(0, Number(maxChars) || 0);
        if (!max || source.length <= max) return source;
        // Drop edges so style sample is mid-prose (less opening/closing formula).
        const start = Math.floor((source.length - max) * 0.35);
        return source.slice(start, start + max);
    }

    function pickDialogueWindow(text, maxChars) {
        const source = String(text || '');
        const max = Math.max(0, Number(maxChars) || 0);
        if (!max || source.length <= max) return source;
        const quote = source.search(/[“「『"]/);
        if (quote < 0) return sliceMid(source, max);
        const start = Math.max(0, Math.min(quote - Math.floor(max * 0.2), source.length - max));
        return source.slice(start, start + max);
    }

    function mergeBudgets(overrides) {
        return { ...DEFAULT_BUDGETS, ...(overrides && typeof overrides === 'object' ? overrides : {}) };
    }

    function digestBlueprint(blueprint, maxChars) {
        const src = asObject(blueprint);
        if (!Object.keys(src).length) return null;
        const acts = list(src.acts).map((act) => ({
            id: clean(act && act.id),
            title: clean(act && act.title),
            purpose: clean(act && act.purpose).slice(0, 80)
        })).filter((act) => act.title);
        const conflict = asObject(src.centralConflict);
        const digest = {
            title: clean(src.title),
            logline: clean(src.logline),
            themes: list(src.themes).map(clean).filter(Boolean).slice(0, 8),
            centralConflict: {
                protagonistGoal: clean(conflict.protagonistGoal),
                opposingForce: clean(conflict.opposingForce),
                stakes: clean(conflict.stakes),
                dilemma: clean(conflict.dilemma)
            },
            endingDirection: clean(src.endingDirection),
            actTitles: acts.map((act) => act.title)
        };
        // Optional one-liners for plan stage richness if still under budget.
        if (jsonSize(digest) < maxChars * 0.7) {
            digest.acts = acts.map((act) => ({ title: act.title, purpose: act.purpose }));
        }
        let serialized = JSON.stringify(digest);
        if (serialized.length > maxChars) {
            digest.acts = undefined;
            digest.logline = digest.logline.slice(0, Math.floor(maxChars / 4));
            serialized = JSON.stringify(digest);
        }
        return digest;
    }

    function entryNames(entry) {
        const names = [clean(entry && entry.title)];
        list(entry && entry.aliases).forEach((alias) => names.push(clean(alias)));
        return names.filter(Boolean);
    }

    function textMentions(haystack, names) {
        const text = String(haystack || '');
        return names.some((name) => name && text.includes(name));
    }

    function selectCompendiumEntries(compendium, currentScene, constraints, budgets, stage) {
        const entries = list(asObject(compendium).entries || asObject(compendium).cards);
        if (!entries.length) {
            return { entries: [], selectedIds: [], droppedIds: [], trims: [] };
        }
        const scene = asObject(currentScene);
        const sceneBlob = [
            scene.povCharacter,
            list(scene.participants).join(' '),
            scene.location,
            scene.goal,
            scene.conflict,
            scene.outcome,
            scene.hook,
            list(scene.mustInclude).join(' ')
        ].join(' ');
        const constraintBlob = list(constraints).map((item) => clean(item && (item.text || item))).join(' ');
        const ranked = entries.map((entry, index) => {
            const names = entryNames(entry);
            const type = clean(entry && entry.type, 'note').toLowerCase();
            let score = 0;
            const locked = entry && (entry.locked === true || entry.sourceLevel === 'author_locked'
                || clean(entry.sourceLevel) === 'author_locked');
            if (locked) score += 1000;
            if (textMentions(constraintBlob, names)) score += 500;
            if (textMentions(sceneBlob, names)) score += 100;
            if (type === 'character' && textMentions(scene.povCharacter, names)) score += 50;
            if (type === 'location' && textMentions(scene.location, names)) score += 40;
            score += Math.max(0, 20 - (TYPE_RANK[type] != null ? TYPE_RANK[type] : 9));
            return { entry, index, score, locked };
        }).sort((a, b) => b.score - a.score || a.index - b.index);

        const selected = [];
        const selectedIds = [];
        const droppedIds = [];
        const trims = [];
        let total = 0;
        const bodyCap = stage === 'review' ? 0 : budgets.compendiumEachBody;
        for (const item of ranked) {
            const entry = item.entry;
            const id = clean(entry.id, `entry-${item.index + 1}`);
            // Keep locked / high-score related; skip low score unless nothing selected yet for plan
            if (!item.locked && item.score < 100 && selected.length >= 2 && stage === 'draft') {
                droppedIds.push(id);
                continue;
            }
            const compact = {
                id,
                type: clean(entry.type, 'note'),
                title: clean(entry.title),
                summary: clean(entry.summary).slice(0, 200),
                aliases: list(entry.aliases).map(clean).filter(Boolean).slice(0, 6)
            };
            if (bodyCap > 0 && entry.body) {
                compact.body = clean(entry.body).slice(0, bodyCap);
            }
            const size = jsonSize(compact);
            // Author-locked cards are hard context. The compendium budget is soft for them.
            if (!item.locked && total + size > budgets.compendiumTotal && selected.length) {
                droppedIds.push(id);
                trims.push({
                    slot: 'compendium',
                    beforeChars: size,
                    afterChars: 0,
                    reason: 'compendium_budget'
                });
                continue;
            }
            selected.push(compact);
            selectedIds.push(id);
            total += size;
        }
        return {
            entries: selected,
            selectedIds,
            droppedIds,
            trims
        };
    }

    function trimRollingState(rawRolling, currentScene, budgets, dueThreadIds) {
        const trims = [];
        const source = asObject(rawRolling);
        if (!Object.keys(source).length) {
            return { continuityState: null, trims, kept: { facts: 0, characters: 0, openThreads: 0, closedThreadsDropped: 0 } };
        }
        const due = new Set(list(dueThreadIds).map(clean).filter(Boolean));
        const scene = asObject(currentScene);
        const participants = new Set([
            clean(scene.povCharacter),
            ...list(scene.participants).map(clean)
        ].filter(Boolean));

        let threads = list(source.threadLedger || source.unresolvedThreads).map((thread, index) => {
            if (typeof thread === 'string') {
                return {
                    threadId: `thread-${index + 1}`,
                    label: clean(thread),
                    status: 'open',
                    mustClose: false,
                    evidence: ''
                };
            }
            return {
                threadId: clean(thread && thread.threadId, `thread-${index + 1}`),
                label: clean(thread && (thread.label || thread.text)),
                status: clean(thread && thread.status, 'open') || 'open',
                mustClose: !!(thread && thread.mustClose),
                evidence: clean(thread && thread.evidence).slice(0, 160),
                expectedRecoveryStage: clean(thread && thread.expectedRecoveryStage)
            };
        }).filter((thread) => thread.label);

        const closed = threads.filter((thread) => ['closed', 'abandoned'].includes(thread.status));
        const open = threads.filter((thread) => !['closed', 'abandoned'].includes(thread.status));
        // Drop closed/abandoned details first (keep optional ids only if room)
        let closedDropped = closed.length;
        threads = open.slice();
        if (closedDropped) {
            trims.push({
                slot: 'rolling.closedThreads',
                beforeChars: closed.length * 40,
                afterChars: 0,
                reason: 'drop_closed_threads'
            });
        }

        // Prefer due/mustClose first
        threads.sort((a, b) => {
            const aPri = (a.mustClose || due.has(a.threadId) ? 0 : 1);
            const bPri = (b.mustClose || due.has(b.threadId) ? 0 : 1);
            return aPri - bPri;
        });

        let characterStates = asObject(source.characterStates);
        const charKeys = Object.keys(characterStates);
        if (participants.size) {
            const filtered = {};
            for (const key of charKeys) {
                if (participants.has(key) || [...participants].some((name) => key.includes(name) || name.includes(key))) {
                    filtered[key] = characterStates[key];
                }
            }
            // Always keep at least something if filtering emptied but original had data
            if (Object.keys(filtered).length) {
                if (Object.keys(filtered).length < charKeys.length) {
                    trims.push({
                        slot: 'rolling.characterStates',
                        beforeChars: charKeys.length,
                        afterChars: Object.keys(filtered).length,
                        reason: 'filter_to_scene_participants'
                    });
                }
                characterStates = filtered;
            }
        }

        let knownFacts = list(source.knownFacts).map(clean).filter(Boolean);
        if (knownFacts.length > budgets.knownFactsMax) {
            trims.push({
                slot: 'rolling.knownFacts',
                beforeChars: knownFacts.join('').length,
                afterChars: knownFacts.slice(-budgets.knownFactsMax).join('').length,
                reason: 'cap_known_facts'
            });
            knownFacts = knownFacts.slice(-budgets.knownFactsMax);
        }

        let summary = clean(source.summary).slice(0, budgets.summaryCap);
        let lastEnding = sliceEnd(source.lastEnding, Math.min(800, budgets.lastSceneEnding));

        let continuityState = {
            summary,
            characterStates,
            knownFacts,
            unresolvedThreads: threads,
            threadLedger: threads,
            lastEnding
        };

        // Hard budget pass: drop non-critical open threads from the end
        while (jsonSize(continuityState) > budgets.rolling && threads.length) {
            const last = threads[threads.length - 1];
            if (last.mustClose || due.has(last.threadId)) break;
            threads = threads.slice(0, -1);
            continuityState.unresolvedThreads = threads;
            continuityState.threadLedger = threads;
            trims.push({
                slot: 'rolling.openThreads',
                beforeChars: jsonSize(last),
                afterChars: 0,
                reason: 'rolling_budget_drop_low_priority_thread'
            });
        }
        if (jsonSize(continuityState) > budgets.rolling && knownFacts.length > 4) {
            knownFacts = knownFacts.slice(-4);
            continuityState.knownFacts = knownFacts;
            trims.push({ slot: 'rolling.knownFacts', beforeChars: 0, afterChars: knownFacts.length, reason: 'rolling_budget_shrink_facts' });
        }
        if (jsonSize(continuityState) > budgets.rolling) {
            summary = summary.slice(0, 120);
            lastEnding = sliceEnd(lastEnding, 400);
            continuityState.summary = summary;
            continuityState.lastEnding = lastEnding;
            trims.push({ slot: 'rolling.summary_ending', beforeChars: budgets.rolling, afterChars: jsonSize(continuityState), reason: 'rolling_budget_hard_trim' });
        }

        return {
            continuityState,
            trims,
            kept: {
                facts: knownFacts.length,
                characters: Object.keys(characterStates).length,
                openThreads: threads.length,
                closedThreadsDropped: closedDropped
            }
        };
    }

    function buildCompletedSceneSummaries(completedScenes, budgets) {
        const items = list(completedScenes).map((item, index) => ({
            sceneId: clean(item && item.sceneId, `scene-${index + 1}`),
            title: clean(item && item.title, `场景 ${index + 1}`),
            ending: clean(item && item.ending)
        })).filter((item) => item.sceneId);
        if (!items.length) return { summaries: [], lastSceneEnding: '', trims: [] };

        const trims = [];
        const last = items[items.length - 1];
        const lastSceneEnding = sliceEnd(last.ending, budgets.lastSceneEnding);
        // Multi-scene short summaries with shared budget
        let remaining = budgets.completedScenesTotal;
        const per = Math.max(80, Math.min(budgets.completedSceneEach, Math.floor(remaining / items.length)));
        const summaries = items.map((item, index) => {
            const isLast = index === items.length - 1;
            const cap = isLast ? Math.min(budgets.completedSceneEach, Math.max(per, 120)) : per;
            let tip = item.ending;
            if (tip.length > cap) {
                tip = tip.slice(-cap);
                trims.push({
                    slot: `completedScenes[${index}]`,
                    beforeChars: item.ending.length,
                    afterChars: tip.length,
                    reason: 'completed_scene_summary_cap'
                });
            }
            remaining -= tip.length + item.title.length;
            return {
                sceneId: item.sceneId,
                title: item.title,
                summary: tip
            };
        });
        return { summaries, lastSceneEnding, trims };
    }

    function buildStyleExemplar(approvedDrafts, options, budgets) {
        const drafts = list(approvedDrafts).filter((item) => clean(item && (item.text || item.content)));
        if (!drafts.length) {
            return {
                styleExemplar: null,
                report: { sourceSceneId: '', chars: 0, strategy: 'none' },
                trims: []
            };
        }
        const anchorId = clean(options && options.styleAnchorSceneId);
        let pick = null;
        if (anchorId) {
            pick = drafts.find((item) => clean(item.sceneId) === anchorId || clean(item.id) === anchorId) || null;
        }
        if (!pick) {
            // Prefer earliest substantial draft as style anchor
            pick = drafts.find((item) => clean(item.text || item.content).length >= 400) || drafts[0];
        }
        const text = clean(pick.text || pick.content);
        const max = budgets.styleExemplarMax;
        const min = budgets.styleExemplarMin;
        let sample = pickDialogueWindow(text, max);
        if (sample.length < Math.min(min, text.length)) {
            sample = sliceMid(text, max);
        }
        if (sample.length > max) sample = sample.slice(0, max);
        return {
            styleExemplar: {
                sourceSceneId: clean(pick.sceneId || pick.id),
                sourceTitle: clean(pick.title),
                text: sample,
                purpose: 'style-only'
            },
            report: {
                sourceSceneId: clean(pick.sceneId || pick.id),
                chars: sample.length,
                strategy: anchorId ? 'anchor_scene' : 'earliest_substantial'
            },
            trims: text.length > sample.length ? [{
                slot: 'styleExemplar',
                beforeChars: text.length,
                afterChars: sample.length,
                reason: 'style_exemplar_budget'
            }] : []
        };
    }

    function slimPreviousReview(review, budgets) {
        const src = asObject(review);
        if (!Object.keys(src).length) return null;
        const findings = list(src.findings);
        const topFindingTypes = [...new Set(findings
            .filter((item) => ['error', 'critical'].includes(clean(item && item.severity).toLowerCase()))
            .map((item) => clean(item && item.type))
            .filter(Boolean))].slice(0, 8);
        const slim = {
            qualityGate: clean(src.qualityGate),
            blockingFindingCount: Number(src.blockingFindingCount) || topFindingTypes.length,
            summary: clean(src.summary).slice(0, budgets.previousReview),
            topFindingTypes
        };
        return slim;
    }

    function assembleContext(stageInput, rawInput, budgetOverrides) {
        const stage = clean(stageInput, 'draft') || 'draft';
        const raw = asObject(rawInput);
        const budgets = mergeBudgets(budgetOverrides);
        const trims = [];
        const currentScene = asObject(raw.currentScene);
        const batchContext = asObject(raw.batchContext);
        const previousBatch = asObject(batchContext.previousBatch);
        const currentBatch = asObject(batchContext.currentBatch);

        const rawChars = jsonSize(raw);

        // Blueprint: full for blueprint/compendium stages; digest otherwise
        let blueprintOut = raw.blueprint;
        if (['draft', 'plan', 'review'].includes(stage)) {
            const digest = digestBlueprint(raw.blueprint, budgets.blueprintDigest);
            if (digest) {
                trims.push({
                    slot: 'blueprint',
                    beforeChars: jsonSize(raw.blueprint),
                    afterChars: jsonSize(digest),
                    reason: 'blueprint_digest'
                });
            }
            blueprintOut = digest;
        }

        // Compendium selection
        let compendiumOut = raw.compendium;
        let selectedCompendiumIds = [];
        let droppedCompendiumIds = [];
        if (['draft', 'plan', 'review'].includes(stage)) {
            const selected = selectCompendiumEntries(
                raw.compendium,
                currentScene,
                raw.constraints,
                budgets,
                stage
            );
            compendiumOut = {
                schemaVersion: asObject(raw.compendium).schemaVersion || 1,
                kind: asObject(raw.compendium).kind || 'compendium-draft-bundle',
                entries: selected.entries
            };
            selectedCompendiumIds = selected.selectedIds;
            droppedCompendiumIds = selected.droppedIds;
            trims.push(...selected.trims);
            if (list(asObject(raw.compendium).entries).length > selected.entries.length) {
                trims.push({
                    slot: 'compendium.entries',
                    beforeChars: list(asObject(raw.compendium).entries).length,
                    afterChars: selected.entries.length,
                    reason: 'compendium_relevance_filter'
                });
            }
        }

        // Rolling / continuity
        const dueIds = [
            ...list(batchContext.dueThreads).map((item) => clean(item && (item.threadId || item))),
            ...list(batchContext.mustCloseThreads).map((item) => clean(item && (item.threadId || item)))
        ];
        const rollingSource = previousBatch.continuityState
            || raw.continuityState
            || raw.rollingState
            || null;
        const rolling = trimRollingState(rollingSource, currentScene, budgets, dueIds);
        trims.push(...rolling.trims);

        // Completed scene summaries
        const completed = buildCompletedSceneSummaries(currentBatch.completedScenes, budgets);
        trims.push(...completed.trims);

        let previousEnding = sliceEnd(previousBatch.lastSceneEnding, budgets.previousBatchEnding);
        if (previousEnding && rolling.continuityState && rolling.continuityState.lastEnding) {
            const a = previousEnding.slice(-120);
            const b = String(rolling.continuityState.lastEnding).slice(-120);
            if (a && b && (a === b || previousEnding.includes(b) || b.includes(a))) {
                trims.push({
                    slot: 'previousBatch.lastSceneEnding',
                    beforeChars: previousEnding.length,
                    afterChars: 0,
                    reason: 'dedupe_with_rolling_lastEnding'
                });
                previousEnding = '';
            }
        }

        const previousReview = slimPreviousReview(previousBatch.review, budgets);

        // Style exemplar for draft
        let styleExemplar = null;
        let styleReport = { sourceSceneId: '', chars: 0, strategy: 'none' };
        if (stage === 'draft') {
            const style = buildStyleExemplar(raw.approvedDrafts || raw.drafts, raw, budgets);
            styleExemplar = style.styleExemplar;
            styleReport = style.report;
            trims.push(...style.trims);
            // Dedupe with last ending
            if (styleExemplar && completed.lastSceneEnding) {
                const se = styleExemplar.text.slice(-80);
                const le = completed.lastSceneEnding.slice(-80);
                if (se && le && (completed.lastSceneEnding.includes(se) || styleExemplar.text.includes(le))) {
                    // Re-sample from earlier draft if available
                    const others = list(raw.approvedDrafts || raw.drafts)
                        .filter((item) => clean(item.sceneId || item.id) !== styleReport.sourceSceneId);
                    if (others.length) {
                        const alt = buildStyleExemplar(others, { ...raw, styleAnchorSceneId: '' }, budgets);
                        if (alt.styleExemplar) {
                            styleExemplar = alt.styleExemplar;
                            styleReport = { ...alt.report, strategy: 'dedupe_shift_earlier' };
                            trims.push({ slot: 'styleExemplar', beforeChars: 0, afterChars: alt.report.chars, reason: 'dedupe_with_last_ending' });
                        }
                    }
                }
            }
        }

        const slimBatchContext = {
            batchId: clean(batchContext.batchId),
            sequence: Number(batchContext.sequence) || 1,
            userInstruction: clean(batchContext.userInstruction),
            repairReview: batchContext.repairReview || null,
            blueprintStage: clean(batchContext.blueprintStage),
            suggestedSceneCount: Number(batchContext.suggestedSceneCount) || 0,
            progress: batchContext.progress && typeof batchContext.progress === 'object'
                ? {
                    completedBodyStatsChars: batchContext.progress.completedBodyStatsChars,
                    completedRawCharacters: batchContext.progress.completedRawCharacters,
                    completedCharacters: batchContext.progress.completedCharacters,
                    targetCharacters: batchContext.progress.targetCharacters,
                    targetBodyStatsChars: batchContext.progress.targetBodyStatsChars,
                    remainingBodyStatsChars: batchContext.progress.remainingBodyStatsChars
                }
                : batchContext.progress,
            dueThreads: list(batchContext.dueThreads),
            mustCloseThreads: list(batchContext.mustCloseThreads),
            previousBatch: previousBatch.batchId || previousBatch.sequence ? {
                batchId: clean(previousBatch.batchId),
                sequence: Number(previousBatch.sequence) || 0,
                batchCharacters: previousBatch.batchCharacters,
                review: previousReview,
                continuityState: rolling.continuityState,
                lastSceneEnding: previousEnding
            } : null,
            currentBatch: {
                completedSceneIds: completed.summaries.map((item) => item.sceneId),
                completedScenes: completed.summaries,
                lastSceneEnding: completed.lastSceneEnding
                    || sliceEnd(currentBatch.lastSceneEnding, budgets.lastSceneEnding)
            }
        };

        const context = {
            projectId: clean(raw.projectId),
            brief: raw.brief,
            writingInstructions: raw.writingInstructions,
            globalContext: raw.globalContext,
            // Always keep directions: draft also calls mergeDirections via prepareCreationStage.
            directions: raw.directions,
            selectedDirectionIds: raw.selectedDirectionIds,
            blueprint: blueprintOut,
            compendium: compendiumOut,
            scenePlan: raw.scenePlan,
            currentScene: Object.keys(currentScene).length ? currentScene : undefined,
            constraints: raw.constraints,
            fineOutlineEnabled: raw.fineOutlineEnabled,
            batchContext: slimBatchContext
        };
        if (styleExemplar) context.styleExemplar = styleExemplar;
        // Review keeps drafts full text from caller after assemble
        if (stage === 'review' && raw.drafts) context.drafts = raw.drafts;

        // Strip undefined keys
        Object.keys(context).forEach((key) => {
            if (context[key] === undefined) delete context[key];
        });

        const assembledChars = jsonSize(context);
        return {
            context,
            report: {
                schemaVersion: 1,
                stage,
                rawChars,
                assembledChars,
                estimatedTokensRough: estimateTokensRough(assembledChars),
                compressionRatio: rawChars ? assembledChars / rawChars : 1,
                trims,
                selectedCompendiumIds,
                droppedCompendiumIds,
                styleExemplar: styleReport,
                rollingKept: rolling.kept,
                usageHint: buildUsageHint({ estimatedInputTokens: estimateTokensRough(assembledChars), promptChars: assembledChars })
            }
        };
    }

    return {
        DEFAULT_BUDGETS,
        estimateTokensRough,
        buildUsageHint,
        usageHintLabel,
        digestBlueprint,
        selectCompendiumEntries,
        trimRollingState,
        buildCompletedSceneSummaries,
        buildStyleExemplar,
        assembleContext,
        jsonSize
    };
});
