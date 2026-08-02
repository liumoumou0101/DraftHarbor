(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborWorkflowChapterAssembly = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function clean(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function countBodyStats(text) {
        const value = clean(text);
        if (!value) return 0;
        const cjk = value.match(/[\u3400-\u9fff]/g) || [];
        const latin = value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
        return cjk.length + latin.length;
    }

    function countRawCharacters(text) {
        return clean(text).length;
    }

    function list(value) {
        return Array.isArray(value) ? value : [];
    }

    function planSceneId(artifact) {
        return clean(artifact && artifact.targetRef && artifact.targetRef.sceneId);
    }

    /**
     * Writer scene id must be globally unique across batches. Plan sceneIds (e.g. "dive")
     * often collide when later batches reuse short ids — use draft artifact id as transfer identity.
     */
    function draftSceneId(artifact) {
        return clean(artifact && artifact.id)
            || planSceneId(artifact)
            || '';
    }

    function draftBatchMeta(artifact) {
        const ref = artifact && artifact.targetRef ? artifact.targetRef : {};
        return {
            batchId: clean(ref.batchId),
            batchSequence: Math.max(0, Number(ref.batchSequence) || 0)
        };
    }

    function planSceneKey(batchId, sceneId) {
        return `${clean(batchId)}\u0000${clean(sceneId)}`;
    }

    /**
     * Build editable chapter assembly from approved draft artifacts + scene plans.
     * Does not write the project. generation-batch remains internal.
     */
    function buildChapterAssembly(input = {}) {
        const runId = clean(input.runId);
        const drafts = list(input.drafts).filter((artifact) => artifact
            && artifact.nodeId === 'draft'
            && artifact.revision
            && artifact.revision.reviewState === 'approved');
        const plans = list(input.plans);
        const plannedByBatchSceneId = new Map();
        const plannedCandidatesBySceneId = new Map();
        for (const plan of plans) {
            const batchId = clean(plan && plan.targetRef && plan.targetRef.batchId)
                || clean(plan && plan.batchId);
            const scenes = plan && plan.content && Array.isArray(plan.content.scenes)
                ? plan.content.scenes
                : [];
            for (const scene of scenes) {
                const id = clean(scene && scene.id);
                if (!id) continue;
                plannedByBatchSceneId.set(planSceneKey(batchId, id), scene);
                const candidates = plannedCandidatesBySceneId.get(id) || [];
                candidates.push(scene);
                plannedCandidatesBySceneId.set(id, candidates);
            }
        }

        function plannedSceneForDraft(artifact) {
            const sceneId = planSceneId(artifact);
            if (!sceneId) return null;
            const batchId = draftBatchMeta(artifact).batchId;
            const exact = plannedByBatchSceneId.get(planSceneKey(batchId, sceneId));
            if (exact) return exact;
            // Legacy plans may not carry batchId. Only use a global fallback when unambiguous.
            const candidates = plannedCandidatesBySceneId.get(sceneId) || [];
            return candidates.length === 1 ? candidates[0] : null;
        }

        const hasNarrativeHints = drafts.some((artifact) => {
            const planned = plannedSceneForDraft(artifact);
            return !!(planned && (clean(planned.chapterKey) || clean(planned.chapterTitle) || planned.chapterBreakBefore === true));
        });
        const mode = hasNarrativeHints ? 'narrative' : 'batch-compat';

        const sceneRows = drafts.map((artifact, index) => {
            const sceneId = draftSceneId(artifact) || `scene-${index + 1}`;
            const plannedId = planSceneId(artifact);
            const batch = draftBatchMeta(artifact);
            const planned = plannedSceneForDraft(artifact);
            const text = typeof artifact.content === 'string' ? artifact.content : '';
            return {
                sceneId,
                planSceneId: plannedId,
                title: clean(artifact.title || (planned && planned.title), `场景 ${index + 1}`),
                batchId: batch.batchId,
                batchSequence: batch.batchSequence || index + 1,
                source: {
                    runId,
                    artifactId: clean(artifact.id),
                    revisionId: clean(artifact.revision && artifact.revision.id)
                },
                plannedChapterKey: clean(planned && planned.chapterKey),
                plannedChapterTitle: clean(planned && planned.chapterTitle),
                plannedChapterOrder: Number(planned && planned.chapterOrder) || 0,
                plannedSceneOrderInChapter: Number(planned && planned.sceneOrderInChapter) || 0,
                chapterBreakBefore: !!(planned && planned.chapterBreakBefore),
                bodyStatsChars: countBodyStats(text),
                rawCharacters: countRawCharacters(text),
                planOrder: planned && Number.isInteger(planned.order) ? planned.order : index
            };
        }).filter((row) => row.source.artifactId && row.source.revisionId);

        sceneRows.sort((left, right) => {
            if (mode === 'narrative') {
                if (left.plannedChapterOrder > 0 && right.plannedChapterOrder > 0
                    && left.plannedChapterOrder !== right.plannedChapterOrder) {
                    return left.plannedChapterOrder - right.plannedChapterOrder;
                }
                if (left.plannedChapterKey && left.plannedChapterKey === right.plannedChapterKey) {
                    if (left.plannedSceneOrderInChapter > 0 && right.plannedSceneOrderInChapter > 0
                        && left.plannedSceneOrderInChapter !== right.plannedSceneOrderInChapter) {
                        return left.plannedSceneOrderInChapter - right.plannedSceneOrderInChapter;
                    }
                    if (left.plannedSceneOrderInChapter > 0 && right.plannedSceneOrderInChapter === 0) return -1;
                    if (right.plannedSceneOrderInChapter > 0 && left.plannedSceneOrderInChapter === 0) return 1;
                }
            }
            if (left.batchSequence !== right.batchSequence) return left.batchSequence - right.batchSequence;
            return left.planOrder - right.planOrder;
        });

        const chapters = [];
        let autoChapterIndex = 0;
        let currentKey = '';

        function startChapter(key, title, order) {
            autoChapterIndex += 1;
            const chapter = {
                key: clean(key, `chapter-${autoChapterIndex}`),
                title: clean(title, `第 ${autoChapterIndex} 章`),
                order: order > 0 ? order : autoChapterIndex,
                scenes: []
            };
            // Product rule: never default to “第 N 批” as reader chapter title.
            if (/^第\s*\d+\s*批/.test(chapter.title)) {
                chapter.title = `第 ${autoChapterIndex} 章`;
            }
            chapters.push(chapter);
            return chapter;
        }

        function uniqueChapterKey(key) {
            const base = clean(key, `chapter-${chapters.length + 1}`);
            if (!chapters.some((chapter) => chapter.key === base)) return base;
            let suffix = 2;
            while (chapters.some((chapter) => chapter.key === `${base}--${suffix}`)) suffix += 1;
            return `${base}--${suffix}`;
        }

        for (const row of sceneRows) {
            let chapter = null;
            if (mode === 'narrative') {
                if (row.chapterBreakBefore || (row.plannedChapterKey && row.plannedChapterKey !== currentKey) || !chapters.length) {
                    const narrativeKey = row.plannedChapterKey || `chapter-${chapters.length + 1}`;
                    const key = uniqueChapterKey(narrativeKey);
                    const title = row.plannedChapterTitle || row.title || `第 ${chapters.length + 1} 章`;
                    chapter = startChapter(key, title, row.plannedChapterOrder);
                    currentKey = row.plannedChapterKey || key;
                } else {
                    chapter = chapters[chapters.length - 1];
                }
            } else {
                // batch-compat: one chapter per generation batch, but title is narrative-friendly.
                const key = row.batchId || `batch-group-${row.batchSequence || 1}`;
                chapter = chapters.find((item) => item.key === key);
                if (!chapter) {
                    const title = row.plannedChapterTitle || row.title || `第 ${chapters.length + 1} 章`;
                    chapter = startChapter(key, title, row.batchSequence || chapters.length + 1);
                }
            }
            chapter.scenes.push({
                sceneId: row.sceneId,
                planSceneId: row.planSceneId,
                title: row.title,
                batchId: row.batchId,
                batchSequence: row.batchSequence,
                source: row.source,
                plannedChapterKey: row.plannedChapterKey,
                bodyStatsChars: row.bodyStatsChars,
                rawCharacters: row.rawCharacters
            });
        }

        chapters.sort((left, right) => left.order - right.order);
        chapters.forEach((chapter, index) => {
            chapter.order = index + 1;
            if (!chapter.title || /^第\s*\d+\s*批/.test(chapter.title)) {
                chapter.title = chapter.scenes[0] && chapter.scenes[0].title
                    ? chapter.scenes[0].title
                    : `第 ${chapter.order} 章`;
            }
        });

        const totals = chapters.reduce((acc, chapter) => {
            for (const scene of chapter.scenes) {
                acc.bodyStatsChars += scene.bodyStatsChars;
                acc.rawCharacters += scene.rawCharacters;
                acc.sceneCount += 1;
            }
            return acc;
        }, { bodyStatsChars: 0, rawCharacters: 0, sceneCount: 0, chapterCount: 0 });
        totals.chapterCount = chapters.length;

        return {
            schemaVersion: 1,
            kind: 'chapter-assembly-preview',
            runId,
            mode,
            chapters,
            totals
        };
    }

    /**
     * Apply user edits (rename / reorder chapters / move scenes) onto an assembly preview.
     * Does not write the project.
     */
    function applyChapterAssemblyEdits(assembly = {}, edits = {}) {
        const base = buildChapterAssembly({
            runId: assembly.runId,
            drafts: list(edits.drafts),
            plans: list(edits.plans)
        });
        // Prefer explicit chapters payload when provided (full client-side edit state).
        const editedChapters = list(edits.chapters);
        if (!editedChapters.length) {
            if (Array.isArray(assembly.chapters) && assembly.chapters.length) {
                return normalizeEditedAssembly(assembly);
            }
            return base;
        }
        return normalizeEditedAssembly({
            ...assembly,
            runId: clean(assembly.runId || base.runId),
            mode: clean(assembly.mode, base.mode) || base.mode,
            chapters: editedChapters
        });
    }

    function normalizeEditedAssembly(assembly = {}) {
        const chapters = list(assembly.chapters).map((chapter, chapterIndex) => {
            const scenes = list(chapter.scenes).map((scene) => ({
                sceneId: clean(scene.sceneId),
                title: clean(scene.title, '场景'),
                batchId: clean(scene.batchId),
                batchSequence: Math.max(0, Number(scene.batchSequence) || 0),
                source: {
                    runId: clean(scene.source && (scene.source.runId || scene.source.sourceRunId)),
                    artifactId: clean(scene.source && (scene.source.artifactId || scene.source.sourceArtifactId)),
                    revisionId: clean(scene.source && (scene.source.revisionId || scene.source.sourceRevisionId))
                },
                plannedChapterKey: clean(scene.plannedChapterKey),
                bodyStatsChars: Math.max(0, Number(scene.bodyStatsChars) || 0),
                rawCharacters: Math.max(0, Number(scene.rawCharacters) || 0)
            })).filter((scene) => scene.sceneId && scene.source.artifactId && scene.source.revisionId);
            let title = clean(chapter.title, `第 ${chapterIndex + 1} 章`);
            if (/^第\s*\d+\s*批/.test(title)) title = `第 ${chapterIndex + 1} 章`;
            return {
                key: clean(chapter.key, `chapter-${chapterIndex + 1}`),
                title,
                order: chapterIndex + 1,
                scenes
            };
        }).filter((chapter) => chapter.scenes.length);

        const totals = chapters.reduce((acc, chapter) => {
            for (const scene of chapter.scenes) {
                acc.bodyStatsChars += scene.bodyStatsChars;
                acc.rawCharacters += scene.rawCharacters;
                acc.sceneCount += 1;
            }
            return acc;
        }, { bodyStatsChars: 0, rawCharacters: 0, sceneCount: 0, chapterCount: 0 });
        totals.chapterCount = chapters.length;

        return {
            schemaVersion: 1,
            kind: 'chapter-assembly-preview',
            runId: clean(assembly.runId),
            mode: clean(assembly.mode, 'narrative') || 'narrative',
            chapters,
            totals
        };
    }

    function sceneSourceKey(scene = {}, fallbackRunId = '') {
        const source = scene.source || {};
        return [
            clean(source.runId || source.sourceRunId, fallbackRunId),
            clean(source.artifactId || source.sourceArtifactId),
            clean(source.revisionId || source.sourceRevisionId)
        ].join('\u0000');
    }

    /**
     * Reconcile client-side chapter edits with the authoritative approved-draft assembly.
     * Clients may rename/reorder/split/merge chapters, but may not add, omit, duplicate,
     * or remap scene sources.
     */
    function reconcileEditedAssembly(authoritative = {}, edited = {}) {
        const trusted = normalizeEditedAssembly(authoritative);
        const candidate = normalizeEditedAssembly({ ...edited, runId: trusted.runId });
        const trustedScenes = trusted.chapters.flatMap((chapter) => chapter.scenes);
        const trustedBySource = new Map();
        for (const scene of trustedScenes) {
            const key = sceneSourceKey(scene, trusted.runId);
            if (trustedBySource.has(key)) throw new Error('authoritative chapter assembly contains duplicate draft sources');
            trustedBySource.set(key, scene);
        }

        const seenSources = new Set();
        const seenChapterKeys = new Set();
        const chapters = candidate.chapters.map((chapter) => {
            if (seenChapterKeys.has(chapter.key)) throw new Error(`chapter assembly contains duplicate chapter key: ${chapter.key}`);
            seenChapterKeys.add(chapter.key);
            return {
                ...chapter,
                scenes: chapter.scenes.map((scene) => {
                    const key = sceneSourceKey(scene, trusted.runId);
                    const trustedScene = trustedBySource.get(key);
                    if (!trustedScene) throw new Error('chapter assembly scene source is not an approved draft from this run');
                    if (seenSources.has(key)) throw new Error('chapter assembly contains a duplicate draft source');
                    if (scene.sceneId !== trustedScene.sceneId) throw new Error('chapter assembly scene identity does not match its approved draft source');
                    seenSources.add(key);
                    // Rehydrate all scene metadata from the server-authoritative preview.
                    return { ...trustedScene };
                })
            };
        });
        if (seenSources.size !== trustedBySource.size) {
            throw new Error('chapter assembly must contain each approved draft exactly once');
        }
        return normalizeEditedAssembly({
            ...candidate,
            runId: trusted.runId,
            mode: trusted.mode,
            chapters
        });
    }

    /** Convert assembly preview into writer-transfer scene inputs (stable sceneIds). */
    function assemblyToTransferScenes(assembly = {}) {
        const normalized = normalizeEditedAssembly(assembly);
        const scenes = [];
        for (const chapter of normalized.chapters) {
            const chapterId = `chapter-${clean(chapter.key).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || chapter.order}`;
            chapter.scenes.forEach((scene, index) => {
                scenes.push({
                    // Omit mode so transfer auto-selects create vs update (idempotent re-apply).
                    targetSceneId: scene.sceneId,
                    sceneId: scene.sceneId,
                    chapterId,
                    chapterTitle: chapter.title,
                    title: scene.title || `场景 ${index + 1}`,
                    source: {
                        runId: scene.source.runId || normalized.runId,
                        artifactId: scene.source.artifactId,
                        revisionId: scene.source.revisionId
                    }
                });
            });
        }
        return scenes;
    }

    function cloneAssembly(assembly = {}) {
        return normalizeEditedAssembly(JSON.parse(JSON.stringify(assembly || {})));
    }

    function renameChapter(assembly, chapterIndex, title) {
        const next = cloneAssembly(assembly);
        const index = Number(chapterIndex);
        if (!next.chapters[index]) return next;
        let cleaned = clean(title, next.chapters[index].title);
        if (/^第\s*\d+\s*批/.test(cleaned)) cleaned = `第 ${index + 1} 章`;
        next.chapters[index].title = cleaned || `第 ${index + 1} 章`;
        return normalizeEditedAssembly(next);
    }

    function moveChapter(assembly, fromIndex, toIndex) {
        const next = cloneAssembly(assembly);
        const from = Number(fromIndex);
        const to = Number(toIndex);
        if (from < 0 || to < 0 || from >= next.chapters.length || to >= next.chapters.length || from === to) {
            return next;
        }
        const [chapter] = next.chapters.splice(from, 1);
        next.chapters.splice(to, 0, chapter);
        return normalizeEditedAssembly(next);
    }

    function moveScene(assembly, fromChapterIndex, fromSceneIndex, toChapterIndex, toSceneIndex) {
        const next = cloneAssembly(assembly);
        const fromChapter = Number(fromChapterIndex);
        const fromScene = Number(fromSceneIndex);
        const toChapter = Number(toChapterIndex);
        let toScene = Number(toSceneIndex);
        if (!next.chapters[fromChapter] || !next.chapters[fromChapter].scenes[fromScene]) return next;
        if (!next.chapters[toChapter]) return next;
        const [scene] = next.chapters[fromChapter].scenes.splice(fromScene, 1);
        if (fromChapter === toChapter && toScene > fromScene) toScene -= 1;
        toScene = Math.max(0, Math.min(toScene, next.chapters[toChapter].scenes.length));
        next.chapters[toChapter].scenes.splice(toScene, 0, scene);
        next.chapters = next.chapters.filter((chapter) => chapter.scenes.length);
        return normalizeEditedAssembly(next);
    }

    /** Split chapter so scenes after sceneIndex become a new chapter. */
    function splitChapterAfter(assembly, chapterIndex, sceneIndex) {
        const next = cloneAssembly(assembly);
        const index = Number(chapterIndex);
        const sceneAt = Number(sceneIndex);
        const chapter = next.chapters[index];
        if (!chapter || sceneAt < 0 || sceneAt >= chapter.scenes.length - 1) return next;
        const moved = chapter.scenes.splice(sceneAt + 1);
        const first = moved[0];
        const newChapter = {
            key: `split-${Date.now().toString(36)}-${index + 1}`,
            title: clean(first && first.title, `第 ${index + 2} 章`),
            order: index + 2,
            scenes: moved
        };
        next.chapters.splice(index + 1, 0, newChapter);
        return normalizeEditedAssembly(next);
    }

    /** Merge chapterIndex into the following chapter (or previous if last). */
    function mergeChapterWithNeighbor(assembly, chapterIndex, direction = 'next') {
        const next = cloneAssembly(assembly);
        const index = Number(chapterIndex);
        if (!next.chapters[index]) return next;
        const target = direction === 'prev' ? index - 1 : index + 1;
        if (!next.chapters[target]) return next;
        const left = Math.min(index, target);
        const right = Math.max(index, target);
        next.chapters[left].scenes = next.chapters[left].scenes.concat(next.chapters[right].scenes);
        next.chapters.splice(right, 1);
        return normalizeEditedAssembly(next);
    }

    return {
        countBodyStats,
        countRawCharacters,
        buildChapterAssembly,
        applyChapterAssemblyEdits,
        normalizeEditedAssembly,
        reconcileEditedAssembly,
        assemblyToTransferScenes,
        cloneAssembly,
        renameChapter,
        moveChapter,
        moveScene,
        splitChapterAfter,
        mergeChapterWithNeighbor
    };
});
