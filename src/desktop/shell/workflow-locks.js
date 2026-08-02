    function defaultWorkflowQualityTargets() {
        return {
            dialogueRatioEnabled: false,
            dialogueRatioMin: 0.25,
            dialogueRatioMax: 0.35,
            technicalRegisterMode: 'avoid',
            technicalRegisterLocked: false,
            planOutcomeLocked: false
        };
    }

    function createWorkflowLockRow(kind = 'direction', seed = {}) {
        return {
            id: seed.id || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            kind: kind === 'exclusion' || kind === 'fact' ? kind : 'direction',
            text: String(seed.text || '').trim(),
            enforcement: seed.enforcement === 'hard' ? 'hard' : 'soft',
            enabled: seed.enabled !== false,
            weight: Number(seed.weight) > 0 ? Number(seed.weight) : 1
        };
    }

    function parseLegacyLockTextarea(value, kind) {
        return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((raw, index) => {
            const match = raw.match(/^(.*?)(?:\s*[|｜]\s*(hard|soft|off|硬|软|关)\s*)?$/i);
            const body = match && match[1] ? match[1].trim() : raw;
            if (!body) return null;
            const flag = match && match[2] ? match[2].toLowerCase() : '';
            if (flag === 'off' || flag === '关') {
                return createWorkflowLockRow(kind, { id: `${kind}-legacy-${index + 1}`, text: body, enforcement: 'soft', enabled: false });
            }
            return createWorkflowLockRow(kind, {
                id: `${kind}-legacy-${index + 1}`,
                text: body,
                enforcement: flag === 'hard' || flag === '硬' ? 'hard' : 'soft',
                enabled: true
            });
        }).filter(Boolean);
    }

    function ensureWorkflowLockDraft() {
        if (!workflowState.lockDraft) {
            workflowState.lockDraft = {
                constraints: [],
                qualityTargets: defaultWorkflowQualityTargets(),
                sourceRunId: '',
                dirty: false
            };
        }
        return workflowState.lockDraft;
    }

    function qualityTargetsFromRun(run) {
        const artifacts = (run && run.artifacts) || [];
        const instructions = artifacts.filter((artifact) =>
            artifact.artifactType === 'workflow-writing-instructions@1'
            || (artifact.id && String(artifact.id).includes('writing-instruction'))
        ).slice(-1)[0];
        const targets = instructions && instructions.content && instructions.content.qualityTargets
            ? instructions.content.qualityTargets
            : {};
        const defaults = defaultWorkflowQualityTargets();
        return {
            dialogueRatioEnabled: targets.dialogueRatioEnabled === true,
            dialogueRatioMin: Number.isFinite(Number(targets.dialogueRatioMin)) ? Number(targets.dialogueRatioMin) : defaults.dialogueRatioMin,
            dialogueRatioMax: Number.isFinite(Number(targets.dialogueRatioMax)) ? Number(targets.dialogueRatioMax) : defaults.dialogueRatioMax,
            technicalRegisterMode: ['off', 'avoid', 'allow'].includes(targets.technicalRegisterMode)
                ? targets.technicalRegisterMode
                : defaults.technicalRegisterMode,
            technicalRegisterLocked: targets.technicalRegisterLocked === true,
            planOutcomeLocked: targets.planOutcomeLocked === true
        };
    }

    function hydrateWorkflowLockDraftFromRun(run, options = {}) {
        const draft = ensureWorkflowLockDraft();
        if (!run) {
            if (options.force) {
                draft.constraints = [];
                draft.qualityTargets = defaultWorkflowQualityTargets();
                draft.sourceRunId = '';
                draft.dirty = false;
            }
            return draft;
        }
        if (!options.force && draft.dirty && draft.sourceRunId === run.id) return draft;
        const constraints = Array.isArray(run.settings && run.settings.constraints)
            ? run.settings.constraints.map((item) => createWorkflowLockRow(item.kind, item))
            : [];
        draft.constraints = constraints;
        draft.qualityTargets = qualityTargetsFromRun(run);
        draft.sourceRunId = run.id;
        draft.dirty = false;
        return draft;
    }

    function readQualityTargetsFromBoard(board) {
        if (!board) return defaultWorkflowQualityTargets();
        const isActive = board.matches('[data-workflow-active-lock-board]');
        const prefix = isActive ? 'active-' : '';
        const enabled = board.querySelector(`[data-workflow-${prefix}dialogue-ratio-enabled]`);
        const min = board.querySelector(`[data-workflow-${prefix}dialogue-ratio-min]`);
        const max = board.querySelector(`[data-workflow-${prefix}dialogue-ratio-max]`);
        const mode = board.querySelector(`[data-workflow-${prefix}technical-register-mode]`);
        const locked = board.querySelector(`[data-workflow-${prefix}technical-register-locked]`);
        const planLocked = board.querySelector(`[data-workflow-${prefix}plan-outcome-locked]`);
        const minPct = Number(min && min.value);
        const maxPct = Number(max && max.value);
        const dialogueRatioEnabled = !!(enabled && enabled.checked);
        return {
            dialogueRatioEnabled,
            dialogueRatioMin: dialogueRatioEnabled && Number.isFinite(minPct) ? Math.max(0, Math.min(1, minPct / 100)) : null,
            dialogueRatioMax: dialogueRatioEnabled && Number.isFinite(maxPct) ? Math.max(0, Math.min(1, maxPct / 100)) : null,
            technicalRegisterMode: mode && ['off', 'avoid', 'allow'].includes(mode.value) ? mode.value : 'avoid',
            technicalRegisterLocked: !!(locked && locked.checked),
            planOutcomeLocked: !!(planLocked && planLocked.checked)
        };
    }

    function writeQualityTargetsToBoard(board, targets = defaultWorkflowQualityTargets()) {
        if (!board) return;
        const isActive = board.matches('[data-workflow-active-lock-board]');
        const prefix = isActive ? 'active-' : '';
        const enabled = board.querySelector(`[data-workflow-${prefix}dialogue-ratio-enabled]`);
        const min = board.querySelector(`[data-workflow-${prefix}dialogue-ratio-min]`);
        const max = board.querySelector(`[data-workflow-${prefix}dialogue-ratio-max]`);
        const mode = board.querySelector(`[data-workflow-${prefix}technical-register-mode]`);
        const locked = board.querySelector(`[data-workflow-${prefix}technical-register-locked]`);
        const planLocked = board.querySelector(`[data-workflow-${prefix}plan-outcome-locked]`);
        if (enabled) enabled.checked = targets.dialogueRatioEnabled === true;
        if (min) min.value = String(Math.round((Number(targets.dialogueRatioMin) || 0.25) * 100));
        if (max) max.value = String(Math.round((Number(targets.dialogueRatioMax) || 0.35) * 100));
        if (mode) mode.value = targets.technicalRegisterMode || 'avoid';
        if (locked) locked.checked = targets.technicalRegisterLocked === true;
        if (planLocked) planLocked.checked = targets.planOutcomeLocked === true;
    }

    function collectConstraintsFromList(listEl) {
        if (!listEl) return [];
        return Array.from(listEl.querySelectorAll('[data-workflow-lock-row]')).map((row, index) => {
            const kind = row.getAttribute('data-kind') === 'exclusion' ? 'exclusion' : 'direction';
            const text = row.querySelector('[data-workflow-lock-text]');
            const enforcement = row.querySelector('[data-workflow-lock-enforcement]');
            const enabled = row.querySelector('[data-workflow-lock-enabled]');
            const body = text ? text.value.trim() : '';
            if (!body) return null;
            return createWorkflowLockRow(kind, {
                id: row.getAttribute('data-lock-id') || `${kind}-${index + 1}`,
                text: body,
                enforcement: enforcement && enforcement.value === 'hard' ? 'hard' : 'soft',
                enabled: !enabled || enabled.checked
            });
        }).filter(Boolean);
    }

    function markWorkflowLockDraftDirty() {
        const draft = ensureWorkflowLockDraft();
        draft.dirty = true;
        const launchList = document.querySelector('[data-workflow-lock-board][data-lock-scope="launch"] [data-workflow-lock-list]');
        const activeList = document.querySelector('[data-workflow-active-lock-list]');
        const activeBoard = document.querySelector('[data-workflow-active-lock-board]');
        const launchBoard = document.querySelector('[data-workflow-lock-board][data-lock-scope="launch"]');
        // Prefer active board when visible, else launch — single source of truth while editing.
        if (activeBoard && !activeBoard.hidden) {
            draft.constraints = collectConstraintsFromList(activeList);
            draft.qualityTargets = readQualityTargetsFromBoard(activeBoard);
            draft.sourceRunId = workflowState.selectedId || draft.sourceRunId;
        } else if (launchBoard) {
            draft.constraints = collectConstraintsFromList(launchList);
            draft.qualityTargets = readQualityTargetsFromBoard(launchBoard);
        }
    }

    function renderWorkflowLockRow(row, options = {}) {
        const item = document.createElement('div');
        item.className = 'desktop-workflow-lock-row';
        item.dataset.workflowLockRow = '';
        item.dataset.lockId = row.id;
        item.dataset.kind = row.kind;
        if (row.enabled === false) item.classList.add('is-disabled');
        if (row.enforcement === 'hard') item.classList.add('is-hard');

        const kindLabel = document.createElement('span');
        kindLabel.className = 'desktop-workflow-lock-kind';
        kindLabel.textContent = row.kind === 'exclusion' ? '排除' : '倾向';

        const text = document.createElement('input');
        text.type = 'text';
        text.dataset.workflowLockText = '';
        text.placeholder = row.kind === 'exclusion' ? '不要出现…' : '希望故事…';
        text.value = row.text || '';
        text.addEventListener('input', () => {
            markWorkflowLockDraftDirty();
            item.classList.toggle('is-disabled', !(item.querySelector('[data-workflow-lock-enabled]') || {}).checked);
        });

        const enforcement = document.createElement('select');
        enforcement.dataset.workflowLockEnforcement = '';
        enforcement.innerHTML = '<option value="soft">软锁</option><option value="hard">硬锁</option>';
        enforcement.value = row.enforcement === 'hard' ? 'hard' : 'soft';
        enforcement.addEventListener('change', () => {
            item.classList.toggle('is-hard', enforcement.value === 'hard');
            markWorkflowLockDraftDirty();
        });

        const enabledLabel = document.createElement('label');
        enabledLabel.className = 'desktop-workflow-toggle desktop-workflow-lock-enabled';
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.dataset.workflowLockEnabled = '';
        enabled.checked = row.enabled !== false;
        enabled.addEventListener('change', () => {
            item.classList.toggle('is-disabled', !enabled.checked);
            markWorkflowLockDraftDirty();
        });
        const enabledText = document.createElement('span');
        enabledText.textContent = '启用';
        enabledLabel.append(enabled, enabledText);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'desktop-icon-button';
        remove.setAttribute('aria-label', '删除此锁');
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            item.remove();
            markWorkflowLockDraftDirty();
            if (typeof window.renderWorkflowLockBoards === 'function') window.renderWorkflowLockBoards({ preserveDraft: true });
        });

        item.append(kindLabel, text, enforcement, enabledLabel, remove);
        if (options.readOnly) {
            text.readOnly = true;
            enforcement.disabled = true;
            enabled.disabled = true;
            remove.hidden = true;
        }
        return item;
    }

    function renderWorkflowLockList(listEl, constraints, emptyEl) {
        if (!listEl) return;
        listEl.replaceChildren();
        (constraints || []).forEach((row) => listEl.appendChild(renderWorkflowLockRow(row)));
        if (emptyEl) emptyEl.hidden = !!(constraints && constraints.length);
    }

    window.renderWorkflowLockBoards = function renderWorkflowLockBoards(options = {}) {
        const run = typeof selectedWorkflowRun === 'function' ? selectedWorkflowRun() : null;
        const draft = options.preserveDraft ? ensureWorkflowLockDraft() : hydrateWorkflowLockDraftFromRun(run, { force: !!options.forceHydrate });
        if (!options.preserveDraft && !run && !draft.constraints.length && !draft.dirty) {
            draft.qualityTargets = defaultWorkflowQualityTargets();
        }

        const launchBoard = document.querySelector('[data-workflow-lock-board][data-lock-scope="launch"]');
        const launchList = launchBoard && launchBoard.querySelector('[data-workflow-lock-list]');
        const launchEmpty = launchBoard && launchBoard.querySelector('[data-workflow-lock-empty]');
        renderWorkflowLockList(launchList, draft.constraints, launchEmpty);
        writeQualityTargetsToBoard(launchBoard, draft.qualityTargets);

        const activeBoard = document.querySelector('[data-workflow-active-lock-board]');
        const activeList = document.querySelector('[data-workflow-active-lock-list]');
        const activeNote = document.querySelector('[data-workflow-active-lock-note]');
        if (activeBoard) {
            const show = !!(run && run.supportsV2Execution && !['completed', 'cancelled', 'failed'].includes(run.status));
            activeBoard.hidden = !show;
            if (show) {
                // Keep launch and active in sync when not dirty-split
                renderWorkflowLockList(activeList, draft.constraints, null);
                writeQualityTargetsToBoard(activeBoard, draft.qualityTargets);
                if (activeNote) {
                    const template = run.templateId === 'creation-guided' ? '从零创作'
                        : run.templateId === 'rewrite-guided' ? '大段重写' : '续写引导';
                    activeNote.textContent = `当前：${template} · 锁数 ${draft.constraints.length}。审查页也可对单条 finding 升硬/降软/豁免。`;
                }
            }
        }
    };

    window.workflowLockConstraints = function workflowLockConstraints() {
        const draft = ensureWorkflowLockDraft();
        markWorkflowLockDraftDirty();
        return (draft.constraints || []).filter((item) => item.text);
    };

    window.workflowQualityTargetsFromElements = function workflowQualityTargetsFromElements() {
        markWorkflowLockDraftDirty();
        return ensureWorkflowLockDraft().qualityTargets || defaultWorkflowQualityTargets();
    };

    /**
     * Client-side mirror of QualityMetrics.allowedFindingLockActions.
     * Keep in sync with src/core/workflow/workflow-quality-metrics.js.
     */
    window.workflowFindingLockActions = function workflowFindingLockActions(finding = {}) {
        const type = String(finding.type || '').trim();
        const enforcement = String(finding.enforcement || '').trim().toLowerCase();
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
        if (systemHard.has(type)) return ['exempt'];
        if (enforcement === 'hard') return ['soften', 'disable', 'exempt'];
        return ['harden', 'disable', 'exempt'];
    };

    window.workflowWritingInstructionsPayload = function workflowWritingInstructionsPayload(elements) {
        const qualityTargets = window.workflowQualityTargetsFromElements();
        const text = elements && elements.creationWritingInstructions
            ? elements.creationWritingInstructions.value.trim()
            : (document.querySelector('[data-workflow-creation-writing-instructions]') || {}).value || '';
        const parts = [];
        if (qualityTargets.dialogueRatioEnabled) {
            parts.push(`对话比例约 ${Math.round((qualityTargets.dialogueRatioMin || 0) * 100)}%–${Math.round((qualityTargets.dialogueRatioMax || 0) * 100)}%`);
        }
        if (qualityTargets.technicalRegisterMode === 'avoid') {
            parts.push(qualityTargets.technicalRegisterLocked
                ? '严格避免说明书式技术说明腔'
                : '尽量避免说明书式技术说明腔，设定通过剧情带出');
        }
        return {
            text: String(text || '').trim() || parts.join('；'),
            dialogueRatio: qualityTargets.dialogueRatioEnabled
                ? `约 ${Math.round((qualityTargets.dialogueRatioMin || 0) * 100)}%–${Math.round((qualityTargets.dialogueRatioMax || 0) * 100)}%`
                : '',
            applicableStages: ['direction', 'blueprint', 'compendium', 'plan', 'draft', 'review'],
            qualityTargets
        };
    };

    window.saveActiveWorkflowLocks = async function saveActiveWorkflowLocks() {
        const run = typeof selectedWorkflowRun === 'function' ? selectedWorkflowRun() : null;
        if (!run || !run.id) throw new Error('请先选择进行中的工作流运行');
        const projectId = typeof currentProjectId === 'function' ? currentProjectId() : '';
        if (!projectId) throw new Error('请先打开项目');
        markWorkflowLockDraftDirty();
        const draft = ensureWorkflowLockDraft();
        const status = document.querySelector('[data-workflow-active-lock-status]');
        if (status) status.textContent = '正在保存创作锁…';
        const response = await fetch('/api/workflows/v2/update-run-locks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                runId: run.id,
                constraints: draft.constraints,
                qualityTargets: draft.qualityTargets,
                writingInstructions: window.workflowWritingInstructionsPayload()
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.run) {
            workflowState.runs = (workflowState.runs || []).map((item) => item.id === run.id ? result.run : item);
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
            hydrateWorkflowLockDraftFromRun(result.run, { force: true });
        }
        draft.dirty = false;
        if (typeof renderWorkflow === 'function') renderWorkflow();
        if (status) status.textContent = `已保存：${(result.constraints || []).length} 条锁；后续生成/审查/重写将使用新锁。`;
        if (typeof setWorkflowStatus === 'function') {
            setWorkflowStatus('当前运行创作锁已更新。', 'ok');
        }
        return result;
    };

    function bindWorkflowLockBoardsOnce() {
        if (window.__workflowLockBoardsBound) return;
        window.__workflowLockBoardsBound = true;
        document.addEventListener('click', (event) => {
            const addLaunch = event.target.closest('[data-workflow-lock-add]');
            if (addLaunch) {
                event.preventDefault();
                const kind = addLaunch.getAttribute('data-workflow-lock-add') === 'exclusion' ? 'exclusion' : 'direction';
                const draft = ensureWorkflowLockDraft();
                draft.constraints.push(createWorkflowLockRow(kind, {}));
                draft.dirty = true;
                window.renderWorkflowLockBoards({ preserveDraft: true });
                return;
            }
            const addActive = event.target.closest('[data-workflow-active-lock-add]');
            if (addActive) {
                event.preventDefault();
                const kind = addActive.getAttribute('data-workflow-active-lock-add') === 'exclusion' ? 'exclusion' : 'direction';
                const draft = ensureWorkflowLockDraft();
                draft.constraints.push(createWorkflowLockRow(kind, {}));
                draft.dirty = true;
                window.renderWorkflowLockBoards({ preserveDraft: true });
                return;
            }
            const save = event.target.closest('[data-workflow-active-lock-save]');
            if (save) {
                event.preventDefault();
                window.saveActiveWorkflowLocks().catch((error) => {
                    const status = document.querySelector('[data-workflow-active-lock-status]');
                    if (status) status.textContent = error.message || String(error);
                    if (typeof setWorkflowStatus === 'function') setWorkflowStatus(`保存锁失败：${error.message || error}`, 'error');
                });
            }
        });
        document.addEventListener('change', (event) => {
            if (event.target.closest('[data-workflow-lock-board], [data-workflow-active-lock-board]')) {
                markWorkflowLockDraftDirty();
            }
        });
        document.addEventListener('input', (event) => {
            if (event.target.closest('[data-workflow-lock-board], [data-workflow-active-lock-board]')) {
                markWorkflowLockDraftDirty();
            }
        });
    }

    bindWorkflowLockBoardsOnce();
    // Initial paint after fragments load
    if (document.documentElement.dataset.fragmentsReady === 'true') {
        window.renderWorkflowLockBoards({ forceHydrate: true });
    } else if (window.DraftHarborFragmentsReady && typeof window.DraftHarborFragmentsReady.then === 'function') {
        window.DraftHarborFragmentsReady.then(() => window.renderWorkflowLockBoards({ forceHydrate: true })).catch(() => {});
    }
