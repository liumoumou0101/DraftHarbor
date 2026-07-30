    function guidedCurrentArtifact(run, step) {
        if (!run || !step) return null;
        return (run.artifacts || []).filter((artifact) => artifact.nodeId === step.id).slice(-1)[0] || null;
    }

    window.workflowStepTitle = (run, stepId) => {
        const step = run && (run.steps || []).find((item) => item.id === stepId);
        return step ? (step.title || step.id) : '';
    };

    window.workflowReviewStateLabel = (state) => ({
        draft: '草稿',
        waiting_review: '待审批',
        approved: '已确认',
        rejected: '已退回'
    })[state] || state || '未标记';

    function workflowStableApplicationId(prefix, values) {
        const text = (Array.isArray(values) ? values : [values]).map((value) => String(value || '')).join('|');
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    window.workflowEventLabel = (type) => ({
        guided_run_created: '流程已创建',
        guided_run_resumed: '流程已恢复',
        guided_run_cancelled: '流程已取消',
        guided_node_generated: '步骤结果已生成',
        guided_node_generation_failed: '步骤生成失败诊断',
        guided_node_approved: '步骤已确认',
        guided_node_rejected: '步骤已退回',
        guided_node_restarted: '步骤已重新开始',
        guided_nodes_invalidated: '后续结果已标记为过期',
        guided_artifact_revised: '产物已保存为新版本',
        guided_artifact_transferred: '产物已回流到项目',
        creation_batch_continued: '已开始下一批创作'
    })[type] || '流程记录';

    function guidedResultSummary(content) {
        if (typeof content === 'string') return content.slice(0, 420);
        if (!content || typeof content !== 'object') return '本步骤已经生成结果，可打开完整产物查看。';
        if (content.logline) return content.logline;
        if (content.summary) return content.summary;
        if (Array.isArray(content.scenes)) return `已生成 ${content.scenes.length} 个场景，可打开完整产物编辑。`;
        if (Array.isArray(content.entries)) return `已生成 ${content.entries.length} 条资料草稿，可打开完整产物编辑。`;
        if (Array.isArray(content.findings)) return `审查完成，发现 ${content.findings.length} 项结果。`;
        return '本步骤已经生成结果，可打开完整产物查看。';
    }

    function appendGuidedPreviewItem(container, label, value) {
        if (value === undefined || value === null || value === '') return;
        const item = document.createElement('div');
        const term = document.createElement('strong');
        const detail = document.createElement('span');
        term.textContent = label;
        detail.textContent = String(value);
        item.append(term, detail);
        container.appendChild(item);
    }

    function renderGuidedArtifactPreview(container, content) {
        if (!content || typeof content !== 'object') return false;
        const preview = document.createElement('section');
        preview.className = 'desktop-workflow-structured-preview';
        if (content.logline) appendGuidedPreviewItem(preview, '一句话故事', content.logline);
        if (content.centralConflict && typeof content.centralConflict === 'object') {
            appendGuidedPreviewItem(preview, '主角目标', content.centralConflict.protagonistGoal);
            appendGuidedPreviewItem(preview, '主要阻力', content.centralConflict.opposition);
            appendGuidedPreviewItem(preview, '失败代价', content.centralConflict.stakes);
            appendGuidedPreviewItem(preview, '核心困境', content.centralConflict.dilemma);
        }
        const entries = Array.isArray(content.entries) ? content.entries : (Array.isArray(content.cards) ? content.cards : []);
        if (entries.length) {
            entries.slice(0, 8).forEach((entry, index) => {
                appendGuidedPreviewItem(preview, entry.title || `资料 ${index + 1}`, entry.summary || entry.type || '资料草稿');
            });
        }
        if (Array.isArray(content.scenes) && content.scenes.length) {
            content.scenes.slice(0, 8).forEach((scene, index) => {
                const details = [scene.goal && `目标：${scene.goal}`, scene.conflict && `冲突：${scene.conflict}`, scene.targetWords && `约 ${scene.targetWords} 字`].filter(Boolean).join(' · ');
                appendGuidedPreviewItem(preview, `${index + 1}. ${scene.title || '未命名场景'}`, details || scene.outcome || '场景计划');
            });
        }
        if (content.metrics && content.metrics.batch) {
            const batch = content.metrics.batch;
            const targets = content.qualityTargetsSnapshot || {};
            const dialogueLine = targets.dialogueRatioEnabled
                ? `对话比例 ${(Number(batch.dialogueRatio || 0) * 100).toFixed(1)}%（目标 ${targets.dialogueRatioMin != null ? `${Math.round(targets.dialogueRatioMin * 100)}%` : '?'}${targets.dialogueRatioMax != null ? `–${Math.round(targets.dialogueRatioMax * 100)}%` : ''}）`
                : `对话比例 ${(Number(batch.dialogueRatio || 0) * 100).toFixed(1)}%（软指标未启用）`;
            appendGuidedPreviewItem(preview, '质量指标', [
                dialogueLine,
                `技术说明腔命中 ${batch.technicalHits || 0}`,
                `重复短语样本 ${batch.repeatedPhraseHits || 0}`,
                Array.isArray(content.metrics.planFulfillment)
                    ? `计划兑现 ${content.metrics.planFulfillment.filter((item) => item.status === 'fulfilled').length}/${content.metrics.planFulfillment.length}`
                    : ''
            ].filter(Boolean).join(' · '));
        }
        if (Array.isArray(content.findings)) {
            appendGuidedPreviewItem(preview, '审查结论', content.qualityGate === 'blocked'
                ? `质量门禁未通过：${content.blockingFindingCount || 1} 项阻断问题`
                : content.findings.length ? `发现 ${content.findings.length} 项需要处理的问题` : '未发现需要处理的问题');
            content.findings.slice(0, 12).forEach((finding, index) => {
                const lockLabel = finding.enforcement === 'hard' ? '硬锁' : (finding.enforcement === 'soft' ? '软锁' : '');
                const exemptLabel = finding.exempted ? '已豁免' : '';
                const label = [
                    String(finding.severity || 'warning').toUpperCase(),
                    lockLabel,
                    exemptLabel,
                    finding.sceneTitle || finding.sceneId || '',
                    finding.type || ''
                ].filter(Boolean).join(' · ');
                const detail = [
                    finding.evidence && `证据：${finding.evidence}`,
                    finding.suggestion && `建议：${finding.suggestion}`,
                    finding.message || finding.summary || finding.description || ''
                ].filter(Boolean).join('；');
                appendGuidedPreviewItem(preview, `问题 ${index + 1}｜${label}`, detail || JSON.stringify(finding));
                const run = selectedWorkflowRun();
                const actions = document.createElement('div');
                actions.className = 'desktop-workflow-finding-actions';
                const appendLockAction = (action, text) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-mini-action';
                    button.textContent = text;
                    button.addEventListener('click', () => {
                        if (typeof window.applyWorkflowFindingLockAction !== 'function') {
                            setWorkflowStatus('当前版本尚不支持审查页调锁', 'error');
                            return;
                        }
                        window.applyWorkflowFindingLockAction(run, finding, index, action)
                            .catch((error) => setWorkflowStatus(`调锁失败：${error.message || error}`, 'error'));
                    });
                    actions.appendChild(button);
                };
                if (run && !finding.exempted) {
                    if (finding.enforcement !== 'hard') appendLockAction('harden', '升为硬锁');
                    if (finding.enforcement === 'hard') appendLockAction('soften', '降为软锁');
                    appendLockAction('disable', '关闭此项');
                    appendLockAction('exempt', '豁免本条');
                }
                const normalizedSeverity = String(finding.severity || '').trim().toLowerCase();
                if (['error', 'critical', 'major', 'high', '严重', '致命'].includes(normalizedSeverity)) {
                    const matchingDraft = (run?.artifacts || []).find((artifact) => artifact.nodeId === 'draft'
                        && (!run.activeBatchId || artifact.targetRef?.batchId === run.activeBatchId)
                        && (artifact.targetRef?.sceneId === finding.sceneId
                            || (!finding.sceneId && artifact.title === finding.sceneTitle)));
                    if (run?.templateId === 'creation-guided' && matchingDraft?.targetRef?.sceneId) {
                        const repair = document.createElement('button');
                        repair.type = 'button';
                        repair.className = 'desktop-mini-action';
                        repair.dataset.workflowRepairFinding = matchingDraft.targetRef.sceneId;
                        repair.textContent = `只修复“${matchingDraft.title || finding.sceneTitle || '此场景'}”`;
                        repair.addEventListener('click', () => {
                            const instruction = window.prompt(
                                '补充修复意见（可直接确认默认建议）',
                                finding.suggestion || '修复审查指出的问题，保留其他内容和事实。'
                            );
                            if (instruction === null) return;
                            restartGuidedWorkflowFromStep(run, 'draft', matchingDraft.title || '分场正文', {
                                skipConfirm: true,
                                sceneIds: [matchingDraft.targetRef.sceneId],
                                userInstruction: instruction.trim(),
                                reason: `修复审查问题：${finding.type || 'quality-gate'}`
                            }).catch((error) => setWorkflowStatus(`场景修复失败：${error.message || error}`, 'error'));
                        });
                        actions.appendChild(repair);
                    }
                }
                if (actions.childElementCount) preview.lastElementChild?.appendChild(actions);
            });
        }
        if (!preview.childElementCount && content.summary) appendGuidedPreviewItem(preview, '摘要', content.summary);
        if (!preview.childElementCount && Array.isArray(content.outline)) {
            appendGuidedPreviewItem(preview, '内容提要', content.outline.slice(0, 8).join('；'));
        }
        if (!preview.childElementCount) return false;
        container.appendChild(preview);
        return true;
    }

    window.renderGuidedArtifactPreview = renderGuidedArtifactPreview;

    window.creationQualityGateBlocked = function creationQualityGateBlocked(run) {
        if (!run || run.templateId !== 'creation-guided') return false;
        return (run.artifacts || []).some((artifact) => artifact.nodeId === 'review'
            && artifact.content
            && (artifact.content.qualityGate === 'blocked'
                || (artifact.content.findings || []).some((finding) => {
                    if (String(finding?.enforcement || '').toLowerCase() === 'soft') return false;
                    if (finding?.exempted) return false;
                    const severity = String(finding?.severity || '').trim().toLowerCase();
                    return ['error', 'critical', 'major', 'high', '严重', '致命'].includes(severity);
                })));
    };

    function renderGuidedWorkflowInlineResult(container, run, step) {
        if (workflowState.lastGenerationError) {
            const failure = document.createElement('section');
            failure.className = 'desktop-workflow-current-result is-error';
            failure.dataset.workflowGenerationError = '';
            const title = document.createElement('strong');
            title.textContent = '本步生成失败，可以直接重试';
            const message = document.createElement('p');
            message.textContent = workflowState.lastGenerationError;
            failure.append(title, message);
            container.appendChild(failure);
        }
        const artifact = guidedCurrentArtifact(run, step);
        if (!artifact || !step || step.status !== 'waiting_user') return;
        const panel = document.createElement('section');
        panel.className = 'desktop-workflow-current-result';
        panel.dataset.workflowCurrentResult = '';
        const heading = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `本步结果：${artifact.title}`;
        const hint = document.createElement('span');
        hint.textContent = '请检查、选择或修改后再进入下一步。';
        heading.append(title, hint);
        panel.appendChild(heading);
        const content = artifact.content || {};
        if (step.id === 'direction' && Array.isArray(content.directions)) {
            const choices = document.createElement('div');
            choices.className = 'desktop-workflow-current-direction-list';
            const directionIds = content.directions.map((item) => item.id).filter(Boolean);
            workflowState.selectedDirectionIds = workflowState.selectedDirectionIds.filter((id) => directionIds.includes(id));
            if (!workflowState.selectedDirectionIds.length && directionIds[0]) workflowState.selectedDirectionIds = [directionIds[0]];
            content.directions.forEach((direction) => {
                const choice = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = workflowState.selectedDirectionIds.includes(direction.id);
                checkbox.addEventListener('change', () => {
                    const ids = new Set(workflowState.selectedDirectionIds);
                    if (checkbox.checked) ids.add(direction.id); else ids.delete(direction.id);
                    workflowState.selectedDirectionIds = Array.from(ids);
                });
                const body = document.createElement('span');
                const directionTitle = document.createElement('strong');
                directionTitle.textContent = direction.title || '未命名方向';
                const premise = document.createElement('span');
                premise.textContent = direction.premise || '未提供故事前提。';
                const details = document.createElement('small');
                details.textContent = [direction.plotFocus, direction.emotionalArc, Array.isArray(direction.risks) && direction.risks.length ? `风险：${direction.risks.join('、')}` : ''].filter(Boolean).join(' · ');
                body.append(directionTitle, premise);
                if (details.textContent) body.appendChild(details);
                choice.append(checkbox, body);
                choices.appendChild(choice);
            });
            panel.appendChild(choices);
        } else {
            if (!renderGuidedArtifactPreview(panel, content)) {
                const summary = document.createElement('p');
                summary.textContent = guidedResultSummary(content);
                panel.appendChild(summary);
            }
        }
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'desktop-mini-action';
        open.dataset.workflowOpenCurrentArtifact = '';
        open.textContent = '查看完整内容与高级编辑';
        open.addEventListener('click', () => {
            workflowState.selectedArtifactId = artifact.id;
            renderWorkflow();
            document.querySelector('[data-workflow-artifacts]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        panel.appendChild(open);
        container.appendChild(panel);
    }

    function guidedRestartableStep(run, nodeId) {
        const step = (run.steps || []).find((item) => item.id === nodeId);
        return !!(step && !['source', 'brief', 'transfer'].includes(step.id));
    }

    async function restartGuidedWorkflowFromStep(run, nodeId, label, options = {}) {
        const projectId = currentProjectId();
        if (!projectId || !run || !guidedRestartableStep(run, nodeId)) return;
        if (!options.skipConfirm && !window.confirm(`将返回“${label}”。该步骤及其后续结果会标为过期，但历史版本会保留。是否继续？`)) return;
        const response = await fetch('/api/workflows/v2/restart-node', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                runId: run.id,
                nodeId,
                reason: options.reason || '用户从步骤视图请求重新运行',
                sceneIds: options.sceneIds || [],
                userInstruction: options.userInstruction || ''
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item);
        workflowState.selectedArtifactId = '';
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus(options.sceneIds?.length
            ? '已进入场景修复；无问题的前序场景保持原 Revision，依赖该场景的后续内容会重新生成。'
            : `已返回“${label}”；该步骤及下游需要重新生成。`, 'ok');
    }

    function renderGuidedWorkflowRecoveryActions(container, run, step) {
        if (!run || !step || workflowState.generating) return;
        if (step.status === 'waiting_user' && guidedRestartableStep(run, step.id)) {
            const regenerate = document.createElement('button');
            regenerate.type = 'button';
            regenerate.className = 'desktop-mini-action';
            regenerate.dataset.workflowGuidedRegenerate = '';
            regenerate.textContent = '重新生成当前步骤';
            regenerate.addEventListener('click', () => restartGuidedWorkflowFromStep(run, step.id, step.title || step.id).catch((error) => setWorkflowStatus(`重跑失败：${error.message || error}`, 'error')));
            container.appendChild(regenerate);
        }
        const index = (run.steps || []).findIndex((item) => item.id === step.id);
        const previous = index > 0 ? run.steps[index - 1] : null;
        if (previous && guidedRestartableStep(run, previous.id)) {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'desktop-mini-action';
            back.dataset.workflowGuidedReturn = previous.id;
            back.textContent = `返回上一步：${previous.title || previous.id}`;
            back.addEventListener('click', () => restartGuidedWorkflowFromStep(run, previous.id, previous.title || previous.id).catch((error) => setWorkflowStatus(`回退失败：${error.message || error}`, 'error')));
            container.appendChild(back);
        }
    }

    async function continueCreationFromDecision(run, requestAdjustment) {
        const projectId = currentProjectId();
        if (!projectId || !run || run.templateId !== 'creation-guided') return;
        const previewResponse = await fetch('/api/workflows/v2/preview-next-creation-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id })
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
        let userInstruction = '';
        if (requestAdjustment) {
            const entered = window.prompt('下一批调整要求', '承接上一批，调整节奏、人物选择或必须落实的情节。');
            if (entered === null) return;
            userInstruction = entered.trim();
        }
        if (preview.qualityGateBlocked) {
            throw new Error(`质量门禁未通过：当前批次仍有 ${preview.blockingFindingCount || 1} 项阻断问题，请先点击“修复当前批次”并重新审查`);
        }
        if (!window.confirm(`将开始第 ${preview.nextBatch.sequence} 批。当前已完成 ${preview.progress.completedCharacters}/${preview.progress.targetCharacters || '未设目标'} 字符，是否继续？`)) {
            return;
        }
        workflowState.generating = true;
        renderWorkflow();
        setWorkflowStatus('正在建立下一批并准备连续性上下文…', 'info');
        try {
            const response = await fetch('/api/workflows/v2/continue-creation-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id, userInstruction })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item);
            workflowState.selectedArtifactId = '';
            await loadWorkflowEvents();
            setWorkflowStatus(`第 ${result.run.batches.length} 批已建立，可以生成下一批场景计划。`, 'ok');
        } finally {
            workflowState.generating = false;
            renderWorkflow();
        }
    }

    function renderCreationBatchDecisionActions(container, run, step) {
        if (!run || run.templateId !== 'creation-guided' || !step || step.id !== 'transfer' || run.status !== 'in_progress') return;
        const active = (run.batches || []).find((batch) => batch.batchId === run.activeBatchId);
        if (!active || active.status !== 'waiting_decision') return;
        const progress = run.generationProgress || {};
        const currentReview = (run.artifacts || []).filter((artifact) => artifact.nodeId === 'review'
            && (!run.activeBatchId || artifact.targetRef?.batchId === run.activeBatchId)).slice(-1)[0];
        const blockingFindingCount = currentReview?.content?.blockingFindingCount
            || (currentReview?.content?.findings || []).filter((finding) =>
                ['error', 'critical', 'major', 'high', '严重', '致命'].includes(String(finding?.severity || '').trim().toLowerCase())).length;
        const qualityGateBlocked = currentReview?.content?.qualityGate === 'blocked' || blockingFindingCount > 0;
        const note = document.createElement('p');
        note.className = 'desktop-workflow-context-note';
        note.dataset.workflowCreationBatchProgress = '';
        note.textContent = qualityGateBlocked
            ? `第 ${active.sequence} 批质量门禁未通过：${blockingFindingCount} 项阻断问题。请先修复当前批次并重新审查；继续生成和转入写作区已暂停。`
            : `第 ${active.sequence} 批已审查 · 本批 ${active.batchCharacters} 字符 · 累计 ${progress.completedCharacters || 0}/${progress.targetCharacters || '未设目标'} 字符`;
        const repair = document.createElement('button');
        repair.type = 'button';
        repair.className = 'desktop-secondary-action';
        repair.dataset.workflowCreationRepairBatch = '';
        repair.textContent = '修复当前批次';
        repair.addEventListener('click', () => restartGuidedWorkflowFromStep(run, 'draft', '分场正文').catch((error) => setWorkflowStatus(`返回失败：${error.message || error}`, 'error')));
        const adjust = document.createElement('button');
        adjust.type = 'button';
        adjust.className = 'desktop-secondary-action';
        adjust.dataset.workflowCreationAdjustContinue = '';
        adjust.textContent = '调整要求后继续';
        adjust.disabled = qualityGateBlocked;
        adjust.addEventListener('click', () => continueCreationFromDecision(run, true).catch((error) => setWorkflowStatus(`继续失败：${error.message || error}`, 'error')));
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'desktop-primary-action';
        next.dataset.workflowCreationContinue = '';
        next.textContent = progress.targetCharacters && progress.completedCharacters >= progress.targetCharacters ? '仍要继续下一批' : '继续下一批';
        next.disabled = qualityGateBlocked;
        next.addEventListener('click', () => continueCreationFromDecision(run, false).catch((error) => setWorkflowStatus(`继续失败：${error.message || error}`, 'error')));
        container.append(note, repair, adjust, next);
    }

    async function resumeGuidedWorkflowRun() {
        const run = selectedWorkflowRun();
        const projectId = currentProjectId();
        if (!run || !projectId || run.status !== 'cancelled') return;
        workflowState.generating = true;
        renderWorkflow();
        setWorkflowStatus('正在恢复流程…');
        try {
            const response = await fetch('/api/workflows/v2/resume-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item);
            const activeArtifact = (result.run.artifacts || []).filter((artifact) => artifact.nodeId === result.run.activeNodeId).slice(-1)[0];
            if (activeArtifact) workflowState.selectedArtifactId = activeArtifact.id;
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
            await loadWorkflowEvents();
            renderWorkflow();
            const activeStep = activeWorkflowStep(result.run);
            setWorkflowStatus(activeStep
                ? `已恢复到“${activeStep.title || activeStep.id}”，已有结果保持不变。`
                : '流程已恢复。', 'ok');
        } finally {
            workflowState.generating = false;
            renderWorkflow();
        }
    }
