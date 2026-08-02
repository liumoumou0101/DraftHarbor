/**
 * F-09.6I chapter assembly panel: rename / reorder / split / merge before writer transfer.
 */
(function () {
    function clean(value, fallback) {
        const text = String(value === undefined || value === null ? (fallback || '') : value).trim();
        return text || String(fallback || '').trim();
    }

    function cloneAssembly(assembly) {
        return JSON.parse(JSON.stringify(assembly || { chapters: [], totals: {} }));
    }

    function reindexAssembly(assembly) {
        const next = cloneAssembly(assembly);
        next.chapters = (next.chapters || []).filter((chapter) => Array.isArray(chapter.scenes) && chapter.scenes.length);
        next.chapters.forEach((chapter, index) => {
            chapter.order = index + 1;
            if (!chapter.key) chapter.key = `chapter-${index + 1}`;
            let title = clean(chapter.title, `第 ${index + 1} 章`);
            if (/^第\s*\d+\s*批/.test(title)) title = `第 ${index + 1} 章`;
            chapter.title = title;
        });
        const totals = { bodyStatsChars: 0, rawCharacters: 0, sceneCount: 0, chapterCount: next.chapters.length };
        next.chapters.forEach((chapter) => {
            chapter.scenes.forEach((scene) => {
                totals.bodyStatsChars += Number(scene.bodyStatsChars) || 0;
                totals.rawCharacters += Number(scene.rawCharacters) || 0;
                totals.sceneCount += 1;
            });
        });
        next.totals = totals;
        return next;
    }

    function assemblyState() {
        if (!workflowState.chapterAssembly) {
            workflowState.chapterAssembly = {
                open: false,
                loading: false,
                baseline: null,
                draft: null,
                projectId: '',
                runId: '',
                status: ''
            };
        }
        return workflowState.chapterAssembly;
    }

    function assemblyDialog() {
        return document.querySelector('[data-workflow-assembly-dialog]');
    }

    function setAssemblyStatus(text) {
        const state = assemblyState();
        state.status = text || '';
        const node = document.querySelector('[data-workflow-assembly-status]');
        if (node) node.textContent = state.status;
    }

    window.closeWorkflowChapterAssembly = function closeWorkflowChapterAssembly() {
        const state = assemblyState();
        state.open = false;
        state.loading = false;
        const dialog = assemblyDialog();
        if (dialog && typeof dialog.close === 'function' && dialog.open) dialog.close();
    };

    window.openWorkflowChapterAssembly = async function openWorkflowChapterAssembly(projectId, run) {
        if (!projectId || !run || !run.id) throw new Error('章节装配需要项目与运行');
        const state = assemblyState();
        state.projectId = projectId;
        state.runId = run.id;
        state.loading = true;
        state.open = true;
        setAssemblyStatus('正在生成章节装配预览…');
        const dialog = assemblyDialog();
        if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
        try {
            const built = await window.buildWorkflowTransferScenesFromAssembly(projectId, run);
            state.baseline = built.assembly;
            state.draft = cloneAssembly(built.assembly);
            state.loading = false;
            setAssemblyStatus(`正文统计 ${built.assembly.totals.bodyStatsChars || 0} · 原始字符 ${built.assembly.totals.rawCharacters || 0} · 可改名/调序/拆并章`);
            renderWorkflowChapterAssembly();
            return built;
        } catch (error) {
            state.loading = false;
            setAssemblyStatus(`装配失败：${error.message || error}`);
            throw error;
        }
    };

    function renderWorkflowChapterAssembly() {
        const body = document.querySelector('[data-workflow-assembly-body]');
        const meta = document.querySelector('[data-workflow-assembly-meta]');
        const state = assemblyState();
        if (!body) return;
        body.innerHTML = '';
        const assembly = state.draft;
        if (!assembly || !Array.isArray(assembly.chapters) || !assembly.chapters.length) {
            const empty = document.createElement('p');
            empty.className = 'desktop-workflow-assembly-empty';
            empty.textContent = state.loading ? '正在准备装配…' : '暂无已批准正文可装配。';
            body.appendChild(empty);
            return;
        }
        if (meta) {
            meta.textContent = `共 ${assembly.totals.chapterCount || assembly.chapters.length} 章 · ${assembly.totals.sceneCount || 0} 场 · 正文统计 ${assembly.totals.bodyStatsChars || 0} · 原始字符 ${assembly.totals.rawCharacters || 0} · 模式 ${assembly.mode || 'narrative'}`;
        }
        assembly.chapters.forEach((chapter, chapterIndex) => {
            const card = document.createElement('section');
            card.className = 'desktop-workflow-assembly-chapter';
            card.dataset.workflowAssemblyChapter = '';
            card.dataset.chapterIndex = String(chapterIndex);

            const head = document.createElement('div');
            head.className = 'desktop-workflow-assembly-chapter-head';
            const badge = document.createElement('strong');
            badge.textContent = `第 ${chapterIndex + 1} 章`;
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = chapter.title || '';
            titleInput.setAttribute('aria-label', `第 ${chapterIndex + 1} 章标题`);
            titleInput.addEventListener('change', () => {
                state.draft = reindexAssembly(state.draft);
                state.draft.chapters[chapterIndex].title = clean(titleInput.value, `第 ${chapterIndex + 1} 章`);
                if (/^第\s*\d+\s*批/.test(state.draft.chapters[chapterIndex].title)) {
                    state.draft.chapters[chapterIndex].title = `第 ${chapterIndex + 1} 章`;
                }
                state.draft = reindexAssembly(state.draft);
                renderWorkflowChapterAssembly();
            });
            const chapterTools = document.createElement('div');
            chapterTools.className = 'desktop-workflow-assembly-chapter-tools';
            const addTool = (label, disabled, handler) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'desktop-mini-action';
                button.textContent = label;
                button.disabled = !!disabled;
                button.addEventListener('click', handler);
                chapterTools.appendChild(button);
            };
            addTool('章↑', chapterIndex === 0, () => {
                if (chapterIndex === 0) return;
                const chapters = state.draft.chapters;
                [chapters[chapterIndex - 1], chapters[chapterIndex]] = [chapters[chapterIndex], chapters[chapterIndex - 1]];
                state.draft = reindexAssembly(state.draft);
                renderWorkflowChapterAssembly();
            });
            addTool('章↓', chapterIndex >= assembly.chapters.length - 1, () => {
                if (chapterIndex >= state.draft.chapters.length - 1) return;
                const chapters = state.draft.chapters;
                [chapters[chapterIndex + 1], chapters[chapterIndex]] = [chapters[chapterIndex], chapters[chapterIndex + 1]];
                state.draft = reindexAssembly(state.draft);
                renderWorkflowChapterAssembly();
            });
            addTool('并入下章', chapterIndex >= assembly.chapters.length - 1, () => {
                if (chapterIndex >= state.draft.chapters.length - 1) return;
                const left = state.draft.chapters[chapterIndex];
                const right = state.draft.chapters[chapterIndex + 1];
                left.scenes = left.scenes.concat(right.scenes);
                state.draft.chapters.splice(chapterIndex + 1, 1);
                state.draft = reindexAssembly(state.draft);
                renderWorkflowChapterAssembly();
            });
            addTool('并入上章', chapterIndex === 0, () => {
                if (chapterIndex === 0) return;
                const left = state.draft.chapters[chapterIndex - 1];
                const right = state.draft.chapters[chapterIndex];
                left.scenes = left.scenes.concat(right.scenes);
                state.draft.chapters.splice(chapterIndex, 1);
                state.draft = reindexAssembly(state.draft);
                renderWorkflowChapterAssembly();
            });
            head.append(badge, titleInput, chapterTools);
            card.appendChild(head);

            (chapter.scenes || []).forEach((scene, sceneIndex) => {
                const row = document.createElement('div');
                row.className = 'desktop-workflow-assembly-scene';
                const info = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = scene.title || scene.sceneId || `场景 ${sceneIndex + 1}`;
                const detail = document.createElement('span');
                detail.textContent = [
                    scene.planSceneId ? `计划 ${scene.planSceneId}` : '',
                    scene.batchSequence ? `生成批 ${scene.batchSequence}` : '',
                    `正文统计 ${scene.bodyStatsChars || 0}`,
                    `原始 ${scene.rawCharacters || 0}`
                ].filter(Boolean).join(' · ');
                info.append(title, detail);
                const tools = document.createElement('div');
                tools.className = 'desktop-workflow-assembly-scene-tools';
                const addSceneTool = (label, disabled, handler) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-mini-action';
                    button.textContent = label;
                    button.disabled = !!disabled;
                    button.addEventListener('click', handler);
                    tools.appendChild(button);
                };
                addSceneTool('上移', sceneIndex === 0, () => {
                    if (sceneIndex === 0) return;
                    const scenes = state.draft.chapters[chapterIndex].scenes;
                    [scenes[sceneIndex - 1], scenes[sceneIndex]] = [scenes[sceneIndex], scenes[sceneIndex - 1]];
                    state.draft = reindexAssembly(state.draft);
                    renderWorkflowChapterAssembly();
                });
                addSceneTool('下移', sceneIndex >= chapter.scenes.length - 1, () => {
                    const scenes = state.draft.chapters[chapterIndex].scenes;
                    if (sceneIndex >= scenes.length - 1) return;
                    [scenes[sceneIndex + 1], scenes[sceneIndex]] = [scenes[sceneIndex], scenes[sceneIndex + 1]];
                    state.draft = reindexAssembly(state.draft);
                    renderWorkflowChapterAssembly();
                });
                addSceneTool('移到上章', chapterIndex === 0, () => {
                    if (chapterIndex === 0) return;
                    const [moved] = state.draft.chapters[chapterIndex].scenes.splice(sceneIndex, 1);
                    state.draft.chapters[chapterIndex - 1].scenes.push(moved);
                    state.draft = reindexAssembly(state.draft);
                    renderWorkflowChapterAssembly();
                });
                addSceneTool('移到下章', chapterIndex >= assembly.chapters.length - 1, () => {
                    if (chapterIndex >= state.draft.chapters.length - 1) return;
                    const [moved] = state.draft.chapters[chapterIndex].scenes.splice(sceneIndex, 1);
                    state.draft.chapters[chapterIndex + 1].scenes.unshift(moved);
                    state.draft = reindexAssembly(state.draft);
                    renderWorkflowChapterAssembly();
                });
                addSceneTool('此后拆章', sceneIndex >= chapter.scenes.length - 1, () => {
                    const scenes = state.draft.chapters[chapterIndex].scenes;
                    if (sceneIndex >= scenes.length - 1) return;
                    const moved = scenes.splice(sceneIndex + 1);
                    state.draft.chapters.splice(chapterIndex + 1, 0, {
                        key: `split-${Date.now().toString(36)}`,
                        title: clean(moved[0] && moved[0].title, `第 ${chapterIndex + 2} 章`),
                        scenes: moved
                    });
                    state.draft = reindexAssembly(state.draft);
                    renderWorkflowChapterAssembly();
                });
                row.append(info, tools);
                card.appendChild(row);
            });
            body.appendChild(card);
        });
        setAssemblyStatus(`正文统计 ${assembly.totals.bodyStatsChars || 0} · 原始字符 ${assembly.totals.rawCharacters || 0} · 确认前不写入项目`);
    }

    window.confirmWorkflowChapterAssemblyTransfer = async function confirmWorkflowChapterAssemblyTransfer() {
        const state = assemblyState();
        if (!state.draft || !state.projectId || !state.runId) throw new Error('没有可确认的章节装配');
        const run = typeof selectedWorkflowRun === 'function'
            ? selectedWorkflowRun()
            : (workflowState.runs || []).find((item) => item.id === state.runId);
        if (!run) throw new Error('工作流运行不存在');
        setAssemblyStatus('正在根据装配生成回流清单…');
        const built = await window.buildWorkflowTransferScenesFromAssembly(state.projectId, run, state.draft);
        if (!built.scenes || !built.scenes.length) throw new Error('装配结果为空');
        setAssemblyStatus('正在预览回流…');
        const previewResponse = await fetch('/api/workflows/v2/preview-writer-transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: state.projectId, runId: state.runId, scenes: built.scenes })
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
        const drafts = (run.artifacts || []).filter((artifact) => artifact.nodeId === 'draft' && artifact.revision.reviewState === 'approved');
        const applicationId = (typeof window.workflowStableApplicationId === 'function'
            ? window.workflowStableApplicationId
            : null);
        if (!applicationId) throw new Error('workflowStableApplicationId is unavailable');
        setAssemblyStatus('正在写入写作区…');
        const response = await fetch('/api/workflows/v2/apply-writer-transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId: state.projectId,
                runId: state.runId,
                applicationId: applicationId(
                    `guided-writer-${run.id}`,
                    drafts.map((artifact) => artifact.revision.id)
                ),
                scenes: built.scenes
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.guidedRun) {
            workflowState.runs = (workflowState.runs || []).map((item) => item.id === run.id ? result.guidedRun : item);
        }
        window.closeWorkflowChapterAssembly();
        if (typeof fetchProjectSnapshot === 'function' && typeof loadNativeProjectEditor === 'function') {
            const refreshed = await fetchProjectSnapshot({ id: state.projectId });
            loadNativeProjectEditor(refreshed, { id: state.projectId, source: 'project-directory' });
            if (typeof loadReaderFromProjectSnapshot === 'function') loadReaderFromProjectSnapshot(refreshed);
        }
        if (typeof loadProjectLibrary === 'function') await loadProjectLibrary();
        if (typeof loadWorkflowEvents === 'function') await loadWorkflowEvents();
        if (typeof renderWorkflow === 'function') renderWorkflow();
        if (typeof setWorkflowStatus === 'function') {
            setWorkflowStatus('正文已转入写作区；资料卡需要点击“确认并写入资料库”另行确认。', 'ok');
        }
        return result;
    };

    function bindAssemblyDialogOnce() {
        if (window.__workflowAssemblyBound) return;
        window.__workflowAssemblyBound = true;
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('[data-workflow-assembly-close]')) {
                window.closeWorkflowChapterAssembly();
                return;
            }
            if (target.closest('[data-workflow-assembly-reset]')) {
                const state = assemblyState();
                if (state.baseline) {
                    state.draft = cloneAssembly(state.baseline);
                    renderWorkflowChapterAssembly();
                    setAssemblyStatus('已恢复默认装配');
                }
                return;
            }
            if (target.closest('[data-workflow-assembly-confirm]')) {
                window.confirmWorkflowChapterAssemblyTransfer()
                    .catch((error) => {
                        setAssemblyStatus(`转入失败：${error.message || error}`);
                        if (typeof setWorkflowStatus === 'function') {
                            setWorkflowStatus(`转写失败：${error.message || error}`, 'error');
                        }
                    });
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindAssemblyDialogOnce);
    } else {
        bindAssemblyDialogOnce();
    }
})();
