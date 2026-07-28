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
        guided_artifact_transferred: '产物已回流到项目'
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
        if (Array.isArray(content.findings)) {
            appendGuidedPreviewItem(preview, '审查结论', content.findings.length ? `发现 ${content.findings.length} 项需要处理的问题` : '未发现需要处理的问题');
            content.findings.slice(0, 6).forEach((finding, index) => {
                appendGuidedPreviewItem(preview, `问题 ${index + 1}`, finding.message || finding.summary || finding.description || JSON.stringify(finding));
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

    async function restartGuidedWorkflowFromStep(run, nodeId, label) {
        const projectId = currentProjectId();
        if (!projectId || !run || !guidedRestartableStep(run, nodeId)) return;
        if (!window.confirm(`将返回“${label}”。该步骤及其后续结果会标为过期，但历史版本会保留。是否继续？`)) return;
        const response = await fetch('/api/workflows/v2/restart-node', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, nodeId, reason: '用户从步骤视图请求重新运行' })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item);
        workflowState.selectedArtifactId = '';
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus(`已返回“${label}”；该步骤及下游需要重新生成。`, 'ok');
    }

    function renderGuidedWorkflowRecoveryActions(container, run, step) {
        if (!run || !step || workflowState.generating) return;
        if (step.status === 'waiting_user' && guidedRestartableStep(run, step.id)) {
            const regenerate = document.createElement('button');
            regenerate.type = 'button';
            regenerate.className = 'desktop-mini-action';
            regenerate.dataset.workflowGuidedRegenerate = '';
            regenerate.textContent = '重新生成本步';
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
            back.textContent = `返回到：${previous.title || previous.id}`;
            back.addEventListener('click', () => restartGuidedWorkflowFromStep(run, previous.id, previous.title || previous.id).catch((error) => setWorkflowStatus(`回退失败：${error.message || error}`, 'error')));
            container.appendChild(back);
        }
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
