(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowQualityMetrics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const TECHNICAL_REGISTER_MODES = Object.freeze(['off', 'avoid', 'allow']);
    const FULFILLMENT_STATUSES = Object.freeze(['fulfilled', 'deferred', 'unfulfilled', 'exempt']);
    const DEFAULT_TECHNICAL_PATTERNS = Object.freeze([
        /自动生成(?:约束)?系统/g,
        /约束系统检测到/g,
        /协议栈|参数校准|模块接口|回调函数/g,
        /(?:系统|引擎)检测到了?一个它无法/g,
        /元叙事|元规则引擎/g,
        /神经(?:回路|突触)精确/g,
        /\d+(?:\.\d+)?\s*赫兹/g
    ]);

    function clean(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function clamp01(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return Math.max(0, Math.min(1, number));
    }

    function asList(value) {
        if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean);
        return clean(value).split(/\r?\n|，|,/).map((item) => clean(item)).filter(Boolean);
    }

    function normalizeMode(value, fallback = 'avoid') {
        const mode = clean(value, fallback).toLowerCase();
        return TECHNICAL_REGISTER_MODES.includes(mode) ? mode : fallback;
    }

    function parseDialogueRatioRange(freeText) {
        const text = clean(freeText);
        if (!text) return { min: null, max: null, raw: '' };
        const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((item) => Number(item[1]) / 100);
        if (matches.length >= 2) {
            return { min: clamp01(Math.min(matches[0], matches[1])), max: clamp01(Math.max(matches[0], matches[1])), raw: text };
        }
        if (matches.length === 1) {
            const value = clamp01(matches[0]);
            return { min: value, max: value, raw: text };
        }
        const fractions = [...text.matchAll(/(0?\.\d+|1(?:\.0+)?)/g)].map((item) => Number(item[1]));
        if (fractions.length >= 2) {
            return { min: clamp01(Math.min(fractions[0], fractions[1])), max: clamp01(Math.max(fractions[0], fractions[1])), raw: text };
        }
        return { min: null, max: null, raw: text };
    }

    function normalizeQualityTargets(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const parsed = parseDialogueRatioRange(source.dialogueRatio || source.dialogueRatioText || '');
        // Product default: dialogue ratio metric is OFF unless explicitly enabled.
        const dialogueRatioEnabled = source.dialogueRatioEnabled === true || source.dialogueRatioEnabled === 'true';
        const min = clamp01(source.dialogueRatioMin != null ? source.dialogueRatioMin : parsed.min);
        const max = clamp01(source.dialogueRatioMax != null ? source.dialogueRatioMax : parsed.max);
        const technicalRegisterMode = normalizeMode(
            source.technicalRegisterMode,
            source.technicalRegisterEnabled === false ? 'off' : 'avoid'
        );
        const technicalRegisterLocked = source.technicalRegisterLocked === true || source.technicalRegisterLocked === 'true';
        return {
            dialogueRatioEnabled,
            dialogueRatioMin: dialogueRatioEnabled ? min : null,
            dialogueRatioMax: dialogueRatioEnabled ? max : null,
            dialogueRatioText: clean(source.dialogueRatio || source.dialogueRatioText || parsed.raw),
            technicalRegisterMode,
            technicalRegisterLocked,
            technicalPatterns: asList(source.technicalPatterns),
            bannedTerms: asList(source.bannedTerms),
            cautionTerms: asList(source.cautionTerms || source.mustAvoid),
            formulaicPatterns: asList(source.formulaicPatterns),
            repetitionEnabled: source.repetitionEnabled !== false && source.repetitionEnabled !== 'false',
            repetitionLocked: source.repetitionLocked === true || source.repetitionLocked === 'true',
            repeatedPhraseMinLength: Math.max(8, Math.min(48, Number(source.repeatedPhraseMinLength) || 18)),
            repeatedPhraseCountThreshold: Math.max(2, Math.min(10, Number(source.repeatedPhraseCountThreshold) || 2)),
            planOutcomeLocked: source.planOutcomeLocked === true || source.planOutcomeLocked === 'true',
            foreshadowingThreads: (Array.isArray(source.foreshadowingThreads) ? source.foreshadowingThreads : [])
                .map((thread, index) => ({
                    threadId: clean(thread && thread.threadId) || `thread-${index + 1}`,
                    label: clean(thread && (thread.label || thread.text)),
                    mustClose: !!(thread && thread.mustClose),
                    expectedRecoveryStage: clean(thread && thread.expectedRecoveryStage),
                    notes: clean(thread && thread.notes)
                }))
                .filter((thread) => thread.label)
        };
    }

    function measureDialogueRatio(text) {
        const source = String(text || '');
        const totalCharacters = source.length;
        const matches = source.match(/[“”「」『』][^“”「」『』]{0,400}[“”「」『』]/g) || [];
        const dialogueCharacters = matches.reduce((sum, item) => sum + item.length, 0);
        return {
            totalCharacters,
            dialogueCharacters,
            dialogueRatio: totalCharacters ? dialogueCharacters / totalCharacters : 0,
            dialogueSpans: matches.length
        };
    }

    function measureRepeatedPhrases(text, options = {}) {
        const source = String(text || '').replace(/\s+/g, '');
        const minLength = Math.max(8, Math.min(48, Number(options.minLength) || 18));
        const threshold = Math.max(2, Math.min(10, Number(options.threshold) || 2));
        const step = Math.max(4, Math.floor(minLength / 2));
        const counts = new Map();
        for (let index = 0; index + minLength <= source.length; index += step) {
            const phrase = source.slice(index, index + minLength);
            if (phrase.length < minLength) continue;
            counts.set(phrase, (counts.get(phrase) || 0) + 1);
        }
        const hits = Array.from(counts.entries())
            .filter(([, count]) => count >= threshold)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 20)
            .map(([phrase, count]) => ({ phrase, count }));
        return { repeatedPhraseHits: hits.length, samples: hits };
    }

    function measureFormulaicPatterns(text, patterns = []) {
        const source = String(text || '');
        const list = patterns.length
            ? patterns
            : ['不是……是', '不是...是', '不是比喻', '与其说'];
        const hits = [];
        for (const pattern of list) {
            const normalized = clean(pattern);
            if (!normalized) continue;
            const flexible = normalized
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/…+|\.\.\./g, '.{0,12}');
            const regex = new RegExp(flexible, 'g');
            let match = regex.exec(source);
            while (match) {
                hits.push({ pattern: normalized, index: match.index, evidence: source.slice(match.index, match.index + match[0].length) });
                match = regex.exec(source);
            }
        }
        return { formulaicHits: hits.length, samples: hits.slice(0, 20) };
    }

    function measureTermHits(text, terms = []) {
        const source = String(text || '');
        const samples = [];
        for (const term of asList(terms)) {
            let from = 0;
            while (from < source.length) {
                const index = source.indexOf(term, from);
                if (index < 0) break;
                samples.push({
                    term,
                    index,
                    evidence: source.slice(Math.max(0, index - 20), Math.min(source.length, index + term.length + 40)).trim()
                });
                from = index + Math.max(term.length, 1);
            }
        }
        return { termHits: samples.length, samples: samples.slice(0, 30) };
    }

    function measureTechnicalRegister(text, options = {}) {
        const mode = normalizeMode(options.mode, 'avoid');
        if (mode === 'off' || mode === 'allow') {
            return { mode, technicalHits: 0, samples: [] };
        }
        const source = String(text || '');
        const custom = asList(options.patterns).map((item) => {
            try {
                return new RegExp(item, 'g');
            } catch (_error) {
                return null;
            }
        }).filter(Boolean);
        const patterns = custom.length ? custom : DEFAULT_TECHNICAL_PATTERNS.slice();
        const samples = [];
        for (const regex of patterns) {
            regex.lastIndex = 0;
            let match = regex.exec(source);
            while (match) {
                samples.push({
                    index: match.index,
                    evidence: source.slice(Math.max(0, match.index - 24), Math.min(source.length, match.index + match[0].length + 48)).trim()
                });
                match = regex.exec(source);
            }
        }
        return { mode, technicalHits: samples.length, samples: samples.slice(0, 20) };
    }

    function measureProseMetrics(text, qualityTargets = {}) {
        const targets = normalizeQualityTargets(qualityTargets);
        const dialogue = measureDialogueRatio(text);
        const repeated = measureRepeatedPhrases(text, {
            minLength: targets.repeatedPhraseMinLength,
            threshold: targets.repeatedPhraseCountThreshold
        });
        const formulaic = measureFormulaicPatterns(text, targets.formulaicPatterns);
        const banned = measureTermHits(text, targets.bannedTerms);
        const caution = measureTermHits(text, targets.cautionTerms);
        const technical = measureTechnicalRegister(text, {
            mode: targets.technicalRegisterMode,
            patterns: targets.technicalPatterns
        });
        return {
            totalCharacters: dialogue.totalCharacters,
            dialogueCharacters: dialogue.dialogueCharacters,
            dialogueRatio: dialogue.dialogueRatio,
            dialogueSpans: dialogue.dialogueSpans,
            repeatedPhraseHits: repeated.repeatedPhraseHits,
            repeatedSamples: repeated.samples,
            formulaicHits: formulaic.formulaicHits,
            formulaicSamples: formulaic.samples,
            bannedTermHits: banned.termHits,
            bannedSamples: banned.samples,
            cautionTermHits: caution.termHits,
            cautionSamples: caution.samples,
            technicalHits: technical.technicalHits,
            technicalSamples: technical.samples,
            technicalRegisterMode: technical.mode
        };
    }

    function evidenceExcerpt(text, start, end) {
        const source = String(text || '');
        return source.slice(Math.max(0, start - 40), Math.min(source.length, end + 60)).trim();
    }

    function buildQualityFindings(input = {}) {
        const text = String(input.text || '');
        const targets = normalizeQualityTargets(input.qualityTargets || {});
        const metrics = input.metrics || measureProseMetrics(text, targets);
        const findings = [];
        const sceneId = clean(input.sceneId);
        const revisionId = clean(input.revisionId);
        const sceneTitle = clean(input.sceneTitle);

        if (targets.dialogueRatioEnabled) {
            const ratio = metrics.dialogueRatio;
            const min = targets.dialogueRatioMin;
            const max = targets.dialogueRatioMax;
            const below = min != null && ratio + 1e-9 < min;
            const above = max != null && ratio - 1e-9 > max;
            if (below || above) {
                findings.push({
                    type: below ? 'dialogue_ratio_below_target' : 'dialogue_ratio_above_target',
                    severity: 'warning',
                    enforcement: 'soft',
                    source: 'deterministic-quality-metrics',
                    metricId: 'dialogue_ratio',
                    target: { min, max },
                    actual: ratio,
                    sceneId,
                    revisionId,
                    sceneTitle,
                    exemptable: true,
                    evidence: `对话字符占比 ${(ratio * 100).toFixed(1)}%（目标 ${min != null ? `${(min * 100).toFixed(0)}%` : '?'}${max != null ? `–${(max * 100).toFixed(0)}%` : ''}）`,
                    suggestion: '可在写作指令中调整对话目标区间，或通过剧情需要增加/减少对白；本指标默认不阻断推进。'
                });
            }
        }

        if (targets.technicalRegisterMode === 'avoid' && metrics.technicalHits > 0) {
            const sample = (metrics.technicalSamples || [])[0];
            findings.push({
                type: 'technical_register_drift',
                severity: targets.technicalRegisterLocked ? 'error' : 'warning',
                enforcement: targets.technicalRegisterLocked ? 'hard' : 'soft',
                source: 'deterministic-quality-metrics',
                metricId: 'technical_register',
                actual: metrics.technicalHits,
                sceneId,
                revisionId,
                sceneTitle,
                exemptable: true,
                range: sample ? { start: sample.index, end: sample.index + 1 } : undefined,
                evidence: sample ? sample.evidence : `检测到 ${metrics.technicalHits} 处说明书/元系统腔倾向`,
                suggestion: '优先用动作、对话和人物感知带出设定；若本场必须宣读规则，可将技术说明腔改为允许/关闭，或豁免本条。'
            });
        }

        if (targets.bannedTerms.length && metrics.bannedTermHits > 0) {
            for (const sample of (metrics.bannedSamples || []).slice(0, 5)) {
                const term = clean(sample.term);
                findings.push({
                    type: 'banned_term_hit',
                    severity: 'warning',
                    enforcement: 'soft',
                    source: 'deterministic-quality-metrics',
                    metricId: 'banned_terms',
                    term,
                    text: term,
                    constraintId: bannedTermConstraintId(term),
                    sceneId,
                    revisionId,
                    sceneTitle,
                    exemptable: true,
                    evidence: sample.evidence,
                    suggestion: `避免使用「${term}」。若必须禁止，请将其写入排除硬锁。`
                });
            }
        }

        if (targets.cautionTerms.length && metrics.cautionTermHits > 0) {
            const sample = (metrics.cautionSamples || [])[0];
            findings.push({
                type: 'caution_term_hit',
                severity: 'suggestion',
                enforcement: 'soft',
                source: 'deterministic-quality-metrics',
                metricId: 'caution_terms',
                actual: metrics.cautionTermHits,
                sceneId,
                revisionId,
                sceneTitle,
                exemptable: true,
                evidence: sample ? sample.evidence : `命中 ${metrics.cautionTermHits} 处慎用表达`,
                suggestion: '考虑更换表达；避免写法库命中默认只提示，不阻断。'
            });
        }

        if (targets.repetitionEnabled && (metrics.repeatedPhraseHits > 0 || metrics.formulaicHits > 0)) {
            const sample = (metrics.repeatedSamples || [])[0] || (metrics.formulaicSamples || [])[0];
            findings.push({
                type: 'repetitive_phrasing',
                severity: targets.repetitionLocked ? 'error' : 'suggestion',
                enforcement: targets.repetitionLocked ? 'hard' : 'soft',
                source: 'deterministic-quality-metrics',
                metricId: 'repetition',
                actual: {
                    repeatedPhraseHits: metrics.repeatedPhraseHits,
                    formulaicHits: metrics.formulaicHits
                },
                sceneId,
                revisionId,
                sceneTitle,
                exemptable: true,
                evidence: sample
                    ? (sample.phrase || sample.evidence || sample.pattern)
                    : '检测到重复短语或高频句式',
                suggestion: '分散重复意象，或有意回声时保留并豁免本条。'
            });
        }

        return findings;
    }

    function evaluatePlanFulfillment(input = {}) {
        const planScenes = input.scenePlan && Array.isArray(input.scenePlan.scenes)
            ? input.scenePlan.scenes
            : [];
        const semantic = Array.isArray(input.semanticFulfillment) ? input.semanticFulfillment : [];
        const byKey = new Map();
        for (const item of semantic) {
            const sceneId = clean(item && item.sceneId);
            const field = clean(item && item.field, 'outcome');
            if (!sceneId) continue;
            const status = FULFILLMENT_STATUSES.includes(clean(item.status))
                ? clean(item.status)
                : 'unfulfilled';
            byKey.set(`${sceneId}::${field}`, {
                sceneId,
                field,
                status,
                evidence: clean(item.evidence),
                deferredToSceneId: clean(item.deferredToSceneId),
                source: 'ai-semantic-review'
            });
        }
        const results = [];
        for (const scene of planScenes) {
            const sceneId = clean(scene.id || scene.sceneId);
            const fields = [];
            if (Array.isArray(scene.mustInclude)) {
                scene.mustInclude.forEach((item, index) => {
                    fields.push({ field: `mustInclude[${index}]`, expected: clean(item) });
                });
            }
            if (clean(scene.outcome)) fields.push({ field: 'outcome', expected: clean(scene.outcome) });
            for (const entry of fields) {
                // Exact field match only. Do not map sceneId::outcome onto mustInclude[*].
                const semanticHit = byKey.get(`${sceneId}::${entry.field}`);
                if (semanticHit && clean(semanticHit.field) === entry.field) {
                    results.push({
                        ...semanticHit,
                        field: entry.field,
                        expected: entry.expected
                    });
                    continue;
                }
                // Weak lexical signal only — never hard by itself.
                const draft = clean((input.sceneTexts && input.sceneTexts[sceneId]) || '');
                const tokens = entry.expected.split(/[\s，,。；;、]/).map(clean).filter((token) => token.length >= 2);
                const hitCount = tokens.filter((token) => draft.includes(token)).length;
                const weakFulfilled = tokens.length > 0 && hitCount / tokens.length >= 0.5;
                results.push({
                    sceneId,
                    field: entry.field,
                    expected: entry.expected,
                    status: weakFulfilled ? 'fulfilled' : 'unfulfilled',
                    evidence: weakFulfilled
                        ? '确定性弱信号：关键词部分命中（需语义审查确认）'
                        : '确定性弱信号：未找到足够关键词；不得单独作为硬阻断',
                    source: 'deterministic-weak-signal'
                });
            }
        }
        return results;
    }

    function planFulfillmentFindings(fulfillment = [], options = {}) {
        const locked = options.planOutcomeLocked === true;
        return fulfillment
            .filter((item) => item && item.status && item.status !== 'fulfilled' && item.status !== 'exempt')
            .map((item) => ({
                type: item.status === 'deferred' ? 'plan_outcome_deferred' : 'plan_outcome_unfulfilled',
                severity: item.status === 'deferred'
                    ? 'warning'
                    : (locked ? 'error' : 'warning'),
                enforcement: item.status === 'deferred'
                    ? 'soft'
                    : (locked ? 'hard' : 'soft'),
                source: item.source || 'plan-fulfillment',
                metricId: 'plan_fulfillment',
                fulfillment: item.status,
                planRef: { sceneId: item.sceneId, field: item.field },
                sceneId: item.sceneId,
                exemptable: true,
                evidence: item.evidence || item.expected || '',
                suggestion: item.status === 'deferred'
                    ? `结果可能延迟到后场 ${item.deferredToSceneId || ''}`.trim()
                    : '确认本场是否兑现计划结果；可豁免、调整计划，或锁定必达后要求修复。'
            }));
    }

    function isBlockingFinding(finding = {}) {
        const severity = clean(finding.severity).toLowerCase();
        if (!['error', 'critical'].includes(severity)) return false;
        if (clean(finding.enforcement).toLowerCase() === 'soft') return false;
        return true;
    }

    function compileQualityConstraints(writingInstructions = {}, styleGuardRules = [], context = {}) {
        const targets = normalizeQualityTargets({
            ...(writingInstructions.qualityTargets || {}),
            dialogueRatio: writingInstructions.dialogueRatio,
            mustAvoid: writingInstructions.mustAvoid
        });
        const constraints = [];
        const projectId = clean(context.projectId);
        const runId = clean(context.runId);
        if (targets.technicalRegisterMode === 'avoid') {
            constraints.push({
                id: 'quality-technical-register',
                projectId,
                runId,
                kind: 'exclusion',
                text: '避免说明书式技术说明腔与元系统叙述；设定尽量通过剧情带出',
                enforcement: targets.technicalRegisterLocked ? 'hard' : 'soft',
                scope: runId ? 'workflow' : 'project',
                category: 'style',
                sourceLevel: 'author_locked',
                enabled: true
            });
        }
        for (const term of targets.bannedTerms) {
            constraints.push({
                id: `quality-banned-${term.slice(0, 24)}`,
                projectId,
                runId,
                kind: 'exclusion',
                text: term,
                enforcement: 'soft',
                scope: runId ? 'workflow' : 'project',
                category: 'style',
                sourceLevel: 'author_locked',
                enabled: true
            });
        }
        for (const rule of Array.isArray(styleGuardRules) ? styleGuardRules : []) {
            const text = clean(rule && (rule.text || rule));
            if (!text || rule && rule.enabled === false) continue;
            constraints.push({
                id: clean(rule && rule.id) || `style-guard-${text.slice(0, 16)}`,
                projectId,
                runId,
                kind: 'exclusion',
                text,
                enforcement: 'soft',
                scope: runId ? 'workflow' : 'project',
                category: 'style',
                sourceLevel: 'author_locked',
                enabled: true
            });
        }
        return { qualityTargets: targets, constraints };
    }

    const TERMINAL_THREAD_STATUSES = Object.freeze(['closed', 'abandoned']);

    function isTerminalThreadStatus(status) {
        return TERMINAL_THREAD_STATUSES.includes(clean(status).toLowerCase());
    }

    function normalizeThreadEntry(raw) {
        if (raw == null) return null;
        if (typeof raw === 'string') {
            const label = clean(raw);
            if (!label) return null;
            return {
                threadId: `thread-${label.slice(0, 24)}`,
                label,
                status: 'open',
                mustClose: false,
                expectedRecoveryStage: '',
                evidence: '',
                firstSeen: undefined,
                lastAdvanced: undefined,
                abandonReason: ''
            };
        }
        const label = clean(raw.label || raw.text);
        if (!label) return null;
        const status = clean(raw.status, 'open') || 'open';
        return {
            threadId: clean(raw.threadId) || `thread-${label.slice(0, 24)}`,
            label,
            status,
            mustClose: !!raw.mustClose,
            expectedRecoveryStage: clean(raw.expectedRecoveryStage),
            evidence: clean(raw.evidence),
            firstSeen: raw.firstSeen && typeof raw.firstSeen === 'object' ? raw.firstSeen : undefined,
            lastAdvanced: raw.lastAdvanced && typeof raw.lastAdvanced === 'object' ? raw.lastAdvanced : undefined,
            abandonReason: clean(raw.abandonReason)
        };
    }

    function mergeThreadEntries(existing, incoming) {
        if (!existing) return incoming;
        if (!incoming) return existing;
        const existingTerminal = isTerminalThreadStatus(existing.status);
        const incomingTerminal = isTerminalThreadStatus(incoming.status);
        // Closed/abandoned threads stay closed unless a later source also marks them terminal.
        const status = existingTerminal && !incomingTerminal
            ? existing.status
            : (incoming.status || existing.status || 'open');
        return {
            threadId: existing.threadId || incoming.threadId,
            label: clean(incoming.label) || existing.label,
            status,
            mustClose: !!(existing.mustClose || incoming.mustClose),
            expectedRecoveryStage: clean(incoming.expectedRecoveryStage) || existing.expectedRecoveryStage || '',
            evidence: clean(incoming.evidence) || existing.evidence || '',
            firstSeen: existing.firstSeen || incoming.firstSeen,
            lastAdvanced: incoming.lastAdvanced || existing.lastAdvanced,
            abandonReason: clean(incoming.abandonReason) || existing.abandonReason || ''
        };
    }

    function normalizeThreadLedger(previous = {}, semanticContinuity = {}, writingInstructions = {}) {
        const prevThreads = Array.isArray(previous.threadLedger)
            ? previous.threadLedger
            : (Array.isArray(previous.unresolvedThreads) ? previous.unresolvedThreads : []);
        const semanticThreads = Array.isArray(semanticContinuity.unresolvedThreads)
            ? semanticContinuity.unresolvedThreads
            : (Array.isArray(semanticContinuity.threadLedger) ? semanticContinuity.threadLedger : []);
        const instructed = normalizeQualityTargets(writingInstructions.qualityTargets || {}).foreshadowingThreads;
        const byId = new Map();

        function upsert(raw, options = {}) {
            const incoming = normalizeThreadEntry(raw);
            if (!incoming) return;
            // User-configured foreshadowing rows default to open only when the thread is new.
            if (options.instructed && !options.forceStatus) {
                // Keep status from raw when provided; otherwise leave blank so merge can default.
                if (!clean(raw && raw.status)) {
                    delete incoming.status;
                }
            }
            const existing = byId.get(incoming.threadId);
            if (!existing) {
                byId.set(incoming.threadId, {
                    ...incoming,
                    status: incoming.status || 'open'
                });
                return;
            }
            const merged = mergeThreadEntries(existing, {
                ...incoming,
                status: incoming.status || existing.status
            });
            byId.set(incoming.threadId, merged);
        }

        prevThreads.forEach((item) => upsert(item));
        semanticThreads.forEach((item) => upsert(item));
        // Instructed threads must not reopen already-closed ledger entries.
        instructed.forEach((thread) => upsert(thread, { instructed: true }));

        const threadLedger = Array.from(byId.values());
        const unresolvedThreads = threadLedger
            .filter((thread) => !isTerminalThreadStatus(thread.status))
            .map((thread) => ({
                threadId: thread.threadId,
                label: thread.label,
                status: thread.status,
                mustClose: thread.mustClose,
                expectedRecoveryStage: thread.expectedRecoveryStage,
                evidence: thread.evidence
            }));

        return {
            schemaVersion: 2,
            completedSceneIds: Array.isArray(previous.completedSceneIds)
                ? previous.completedSceneIds
                : (Array.isArray(semanticContinuity.completedSceneIds) ? semanticContinuity.completedSceneIds : []),
            summary: clean(semanticContinuity.summary || previous.summary),
            characterStates: semanticContinuity.characterStates && typeof semanticContinuity.characterStates === 'object'
                ? semanticContinuity.characterStates
                : (previous.characterStates && typeof previous.characterStates === 'object' ? previous.characterStates : {}),
            knownFacts: Array.isArray(semanticContinuity.knownFacts)
                ? semanticContinuity.knownFacts.map(clean).filter(Boolean)
                : (Array.isArray(previous.knownFacts) ? previous.knownFacts : []),
            lastEnding: clean(semanticContinuity.lastEnding || previous.lastEnding),
            unresolvedThreads,
            threadLedger
        };
    }

    function bannedTermConstraintId(term) {
        return `quality-banned-${clean(term).slice(0, 24)}`;
    }

    /**
     * Supported review-page lock actions per finding type.
     * Dialogue ratio and direction literal absence never harden (product: soft-only signals).
     */
    function allowedFindingLockActions(finding = {}) {
        const type = clean(finding.type);
        const enforcement = clean(finding.enforcement).toLowerCase();
        if (finding.exempted === true) return [];

        const softOnly = new Set([
            'dialogue_ratio_below_target',
            'dialogue_ratio_above_target',
            'direction_literal_absent',
            'direction_missing',
            'caution_term_hit',
            'thread_allowed_open'
        ]);
        const systemHard = new Set([
            'process_label_leak',
            'prompt_metadata_leak',
            'prompt_instruction_leak',
            'unexpected_markdown_title',
            'scene_boundary_repetition',
            'outline_mismatch'
        ]);

        if (softOnly.has(type)) return ['disable', 'exempt'];
        // System gates stay hard; user may only exempt this finding instance.
        if (systemHard.has(type)) return ['exempt'];
        if (enforcement === 'hard') return ['soften', 'disable', 'exempt'];
        return ['harden', 'disable', 'exempt'];
    }

    return {
        TECHNICAL_REGISTER_MODES,
        FULFILLMENT_STATUSES,
        DEFAULT_TECHNICAL_PATTERNS,
        TERMINAL_THREAD_STATUSES,
        parseDialogueRatioRange,
        normalizeQualityTargets,
        measureDialogueRatio,
        measureRepeatedPhrases,
        measureFormulaicPatterns,
        measureTermHits,
        measureTechnicalRegister,
        measureProseMetrics,
        buildQualityFindings,
        evaluatePlanFulfillment,
        planFulfillmentFindings,
        isBlockingFinding,
        compileQualityConstraints,
        normalizeThreadLedger,
        normalizeThreadEntry,
        mergeThreadEntries,
        allowedFindingLockActions,
        bannedTermConstraintId,
        evidenceExcerpt
    };
});
