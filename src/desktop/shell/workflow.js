    function workflowElements() {
        return {
            projectLabel: document.querySelector('[data-workflow-project-label]'),
            brief: document.querySelector('[data-workflow-brief]'),
            start: document.querySelector('[data-workflow-start]'),
            status: document.querySelector('[data-workflow-status]'),
            runList: document.querySelector('[data-workflow-run-list]'),
            title: document.querySelector('[data-workflow-title]'),
            generate: document.querySelector('[data-workflow-generate]'),
            applyArtifact: document.querySelector('[data-workflow-apply-artifact]'),
            approve: document.querySelector('[data-workflow-approve]'),
            reject: document.querySelector('[data-workflow-reject]'),
            cancel: document.querySelector('[data-workflow-cancel]'),
            steps: document.querySelector('[data-workflow-steps]'),
            stageActions: document.querySelector('[data-workflow-stage-actions]'),
            artifacts: document.querySelector('[data-workflow-artifacts]'),
            events: document.querySelector('[data-workflow-events]'),
            eventsDetails: document.querySelector('[data-workflow-events-details]'),
            eventsSummary: document.querySelector('[data-workflow-events-summary]'),
            eventsCount: document.querySelector('[data-workflow-events-count]')
        };
    }

    function selectedWorkflowRun() {
        return workflowState.runs.find((run) => run.id === workflowState.selectedId) || null;
    }

    function activeWorkflowStep(run = selectedWorkflowRun()) {
        if (!run) return null;
        return (run.steps || []).find((step) => step.id === run.activeStepId)
            || (run.steps || []).find((step) => ['ready', 'waiting_user'].includes(step.status))
            || null;
    }

    function latestWorkflowArtifact(run, type) {
        const artifacts = (run && run.artifacts) || [];
        const matches = artifacts.filter((artifact) => !type || artifact.type === type);
        return matches[matches.length - 1] || null;
    }

    function setWorkflowStatus(message, tone = 'info') {
        const { status } = workflowElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function renderWorkflow() {
        const elements = workflowElements();
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        const isTerminalRun = run && ['completed', 'cancelled', 'failed'].includes(run.status);
        const draftArtifact = latestWorkflowArtifact(run, 'draft_text');
        if (elements.projectLabel) {
            const project = nativeEditorState.snapshot && nativeEditorState.snapshot.project;
            elements.projectLabel.textContent = project ? `当前项目：${project.name || project.title || project.id}` : '请先在书库打开或新建一个项目。';
        }
        if (elements.start) elements.start.disabled = !projectId || workflowState.generating;
        if (elements.title) {
            if (!projectId) {
                elements.title.textContent = '请先打开项目';
            } else if (!run) {
                elements.title.textContent = '创建你的第一个创作流程';
            } else {
                const stepTitle = step ? (step.id || step.title || '当前步骤') : '完成';
                elements.title.textContent = `${run.title || '创作流程'} · ${stepTitle}`;
            }
        }
        if (elements.runList) {
            elements.runList.replaceChildren();
            if (!projectId) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workflow-run';
                empty.textContent = '打开项目后启动创作流程。';
                elements.runList.appendChild(empty);
            } else if (!workflowState.runs.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workflow-run';
                empty.textContent = '还没有创作流程。在下方写出你的想法。';
                elements.runList.appendChild(empty);
            } else {
                workflowState.runs.forEach((item) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-workflow-run';
                    button.classList.toggle('is-active', item.id === workflowState.selectedId);
                    const statusLabels = { completed: '已完成', cancelled: '已取消', failed: '异常', in_progress: '进行中' };
                    const statusText = statusLabels[item.status] || item.status;
                    button.innerHTML = `<strong>${item.title || '创作流程'}</strong><span>${statusText}${item.activeStepId ? ` · ${item.activeStepId}` : ''}</span>`;
                    button.addEventListener('click', async () => {
                        workflowState.selectedId = item.id;
                        await loadWorkflowEvents();
                        renderWorkflow();
                    });
                    elements.runList.appendChild(button);
                });
            }
        }
        if (elements.steps) {
            elements.steps.replaceChildren();
            const hasSteps = run && run.steps && run.steps.length;
            if (!projectId) {
                const guideDiv = document.createElement('div');
                guideDiv.className = 'desktop-workflow-steps-guide';
                guideDiv.dataset.workflowGuide = '';
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\uD83D\uDCCB';
                const heading = document.createElement('h3');
                heading.textContent = '创作流程看板';
                const desc = document.createElement('p');
                desc.textContent = '打开项目后，在这里设置创作 Brief，启动按步骤引导的写作流程。';
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '去书库打开项目';
                action.addEventListener('click', () => setView('bookshelf'));
                guideDiv.append(icon, heading, desc, action);
                elements.steps.appendChild(guideDiv);
            } else if (!hasSteps) {
                const guideDiv = document.createElement('div');
                guideDiv.className = 'desktop-workflow-steps-guide';
                guideDiv.dataset.workflowGuide = '';
                const kicker = document.createElement('p');
                kicker.className = 'desktop-section-kicker';
                kicker.textContent = '创作流程指引';
                guideDiv.appendChild(kicker);

                const timeline = document.createElement('div');
                timeline.className = 'desktop-workflow-steps-timeline';
                const milestones = [
                    { num: 1, title: '设定 Brief', desc: '在左侧写下题材、主线、角色、限制和目标' },
                    { num: 2, title: '启动流程', desc: '点击「开始创作流程」按钮进入引导步骤' },
                    { num: 3, title: '逐步执行', desc: '按顺序批准、退回或重新生成每个步骤' },
                    { num: 4, title: '采纳产物', desc: '将生成的正文草稿写入当前项目' }
                ];
                milestones.forEach((m) => {
                    const item = document.createElement('div');
                    item.className = 'desktop-workflow-milestone';
                    const mark = document.createElement('span');
                    mark.className = 'desktop-workflow-milestone-mark';
                    mark.textContent = String(m.num);
                    const body = document.createElement('div');
                    const strong = document.createElement('strong');
                    strong.textContent = m.title;
                    const span = document.createElement('span');
                    span.textContent = m.desc;
                    body.append(strong, span);
                    item.append(mark, body);
                    timeline.appendChild(item);
                });
                guideDiv.appendChild(timeline);
                elements.steps.appendChild(guideDiv);
            }
            (run && run.steps || []).forEach((item, index) => {
                const card = document.createElement('article');
                card.className = 'desktop-workflow-step-card';
                card.classList.toggle('is-active', item.id === (step && step.id));
                const statusClass = item.status === 'completed' ? 'is-done' : (item.status === 'failed' ? 'is-failed' : (item.status === 'in_progress' ? 'is-progress' : ''));
                if (statusClass) card.classList.add(statusClass);

                const header = document.createElement('div');
                header.className = 'desktop-workflow-step-card-header';
                const mark = document.createElement('span');
                mark.className = 'desktop-workflow-step-mark';
                mark.textContent = String(index + 1);
                const meta = document.createElement('div');
                meta.className = 'desktop-workflow-step-card-meta';
                const title = document.createElement('strong');
                title.textContent = item.title || item.id;
                const statusText = document.createElement('span');
                const stepStatusLabels = { completed: '已完成', failed: '失败', in_progress: '生成中', waiting_user: '等待审批', ready: '准备执行', pending: '待处理' };
                statusText.textContent = `${stepStatusLabels[item.status] || item.status} · ${item.kind || ''}`;
                meta.append(title, statusText);
                header.append(mark, meta);
                card.appendChild(header);

                if (item.description) {
                    const desc = document.createElement('p');
                    desc.className = 'desktop-workflow-step-card-desc';
                    desc.textContent = item.description;
                    card.appendChild(desc);
                }
                elements.steps.appendChild(card);
            });
        }

        if (elements.stageActions) {
            elements.stageActions.replaceChildren();
            elements.stageActions.hidden = !run;
            if (run) {
                const hasActiveStep = step && !isTerminalRun;
                const generateActionBtn = document.createElement('button');
                generateActionBtn.className = 'desktop-primary-action';
                generateActionBtn.type = 'button';
                generateActionBtn.dataset.workflowGenerate = '';
                generateActionBtn.textContent = `生成：${step ? (step.title || step.id) : '当前步骤'}`;
                generateActionBtn.disabled = !hasActiveStep || step.kind !== 'generation' || workflowState.generating || step.status === 'completed';
                generateActionBtn.addEventListener('click', generateWorkflowStep);

                const approveBtn = document.createElement('button');
                approveBtn.className = 'desktop-secondary-action';
                approveBtn.type = 'button';
                approveBtn.dataset.workflowApprove = '';
                approveBtn.textContent = '批准';
                approveBtn.disabled = !hasActiveStep || workflowState.generating || !['waiting_user', 'ready'].includes(step.status);
                approveBtn.addEventListener('click', () => approveWorkflowStep().catch((error) => setWorkflowStatus(`批准失败：${error.message || error}`, 'error')));

                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'desktop-secondary-action';
                rejectBtn.type = 'button';
                rejectBtn.dataset.workflowReject = '';
                rejectBtn.textContent = '退回';
                rejectBtn.disabled = !hasActiveStep || workflowState.generating || step.status === 'completed';
                rejectBtn.addEventListener('click', () => rejectWorkflowStep().catch((error) => setWorkflowStatus(`退回失败：${error.message || error}`, 'error')));

                const adoptBtn = document.createElement('button');
                adoptBtn.className = 'desktop-secondary-action';
                adoptBtn.type = 'button';
                adoptBtn.dataset.workflowApplyArtifact = '';
                adoptBtn.textContent = '采纳草稿';
                adoptBtn.disabled = !projectId || isTerminalRun || !draftArtifact || workflowState.generating;
                adoptBtn.addEventListener('click', () => applyWorkflowArtifact().catch((error) => setWorkflowStatus(`采纳失败：${error.message || error}`, 'error')));

                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'desktop-mini-action';
                cancelBtn.type = 'button';
                cancelBtn.dataset.workflowCancel = '';
                cancelBtn.textContent = '取消流程';
                cancelBtn.disabled = isTerminalRun || workflowState.generating;
                cancelBtn.addEventListener('click', () => cancelWorkflowRun().catch((error) => setWorkflowStatus(`取消失败：${error.message || error}`, 'error')));

                elements.stageActions.append(generateActionBtn, approveBtn, rejectBtn, adoptBtn, cancelBtn);
            }
        }

        if (elements.artifacts) {
            elements.artifacts.replaceChildren();
            const hasArtifacts = run && run.artifacts && run.artifacts.length > 0;
            elements.artifacts.hidden = !hasArtifacts;
            if (hasArtifacts) {
                const label = document.createElement('p');
                label.className = 'desktop-workflow-artifacts-label';
                label.textContent = '最新产物';
                elements.artifacts.appendChild(label);
                (run.artifacts || []).slice().reverse().slice(0, 1).forEach((artifact) => {
                    const card = document.createElement('article');
                    card.className = 'desktop-workflow-artifact';
                    const content = document.createElement('pre');
                    content.textContent = artifact.content || '';
                    card.innerHTML = `<strong>${artifact.title || artifact.type}</strong><span>${artifact.type} / ${artifact.stepId || ''}</span>`;
                    card.appendChild(content);
                    elements.artifacts.appendChild(card);
                });
            }
        }
        if (elements.events) {
            elements.events.replaceChildren();
            const eventCount = workflowState.events.length;
            if (elements.eventsCount) elements.eventsCount.textContent = eventCount ? `${eventCount} 条` : '';
            workflowState.events.slice().reverse().forEach((event) => {
                const card = document.createElement('div');
                card.className = 'desktop-workflow-event';
                card.textContent = `${formatDate(event.createdAt)} / ${event.type}${event.stepId ? ` / ${event.stepId}` : ''}`;
                elements.events.appendChild(card);
            });
            if (elements.eventsDetails && !run) {
                elements.eventsDetails.hidden = true;
            } else if (elements.eventsDetails) {
                elements.eventsDetails.hidden = false;
                if (eventCount === 0) {
                    elements.eventsDetails.open = false;
                }
            }
        }
        if (projectId && !workflowState.generating) setWorkflowStatus(`${workflowState.runs.length} 个运行`, 'ok');
    }

    async function loadWorkflowRuns() {
        const projectId = currentProjectId();
        if (!projectId) {
            workflowState.runs = [];
            workflowState.selectedId = '';
            workflowState.events = [];
            renderWorkflow();
            return;
        }
        try {
            const response = await fetch(`/api/workflows?${new URLSearchParams({ projectId }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.runs = result.runs || [];
            if (!workflowState.runs.some((run) => run.id === workflowState.selectedId)) {
                workflowState.selectedId = workflowState.runs[0] ? workflowState.runs[0].id : '';
            }
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
            await loadWorkflowEvents();
        } catch (error) {
            console.warn('Failed to load workflows:', error);
            workflowState.runs = [];
            workflowState.selectedId = '';
            workflowState.events = [];
            setWorkflowStatus(`读取工作流失败：${error.message || error}`, 'error');
        }
        renderWorkflow();
    }

    async function loadWorkflowEvents() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run) {
            workflowState.events = [];
            return;
        }
        const response = await fetch(`/api/workflow-events?${new URLSearchParams({ projectId, runId: run.id }).toString()}`, { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        workflowState.events = response.ok && result.ok ? (result.events || []) : [];
    }

    async function startWorkflowRun() {
        const projectId = currentProjectId();
        const elements = workflowElements();
        if (!projectId) return;
        setWorkflowStatus('正在创建运行前快照...', 'info');
        const response = await fetch('/api/workflows/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                brief: elements.brief ? elements.brief.value : ''
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = [result.run, ...workflowState.runs.filter((run) => run.id !== result.run.id)];
        workflowState.selectedId = result.run.id;
        if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('工作流已启动，运行前快照已创建。', 'ok');
    }

    async function generateWorkflowStep() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step || step.kind !== 'generation' || workflowState.generating) return;
        workflowState.generating = true;
        workflowState.generatedText = '';
        setWorkflowStatus(`正在生成：${step.title || step.id}`, 'info');
        renderWorkflow();
        try {
            const prepareResponse = await fetch('/api/workflows/prepare-step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id, stepId: step.id })
            });
            const prepared = await prepareResponse.json().catch(() => ({}));
            if (!prepareResponse.ok || !prepared.ok) throw new Error(prepared.error || `HTTP ${prepareResponse.status}`);
            if (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function') {
                throw new Error('Native generation provider stream is not loaded.');
            }
            await window.DraftHarborProviderStream.streamGeneration(prepared.prompt, (token) => {
                workflowState.generatedText += token;
                const currentRun = selectedWorkflowRun();
                const existing = latestWorkflowArtifact(currentRun, 'generation_result');
                if (!existing && currentRun) {
                    currentRun.artifacts = currentRun.artifacts || [];
                    currentRun.artifacts.push({
                        id: 'workflow-live-generation',
                        type: 'generation_result',
                        title: '生成中',
                        stepId: step.id,
                        content: workflowState.generatedText,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                } else if (existing && existing.id === 'workflow-live-generation') {
                    existing.content = workflowState.generatedText;
                }
                renderWorkflow();
            }, runtimeProviderConfig());
            const completeResponse = await fetch('/api/workflows/complete-generation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    runId: run.id,
                    stepId: step.id,
                    result: {
                        text: workflowState.generatedText,
                        prompt: prepared.prompt
                    }
                })
            });
            const completed = await completeResponse.json().catch(() => ({}));
            if (!completeResponse.ok || !completed.ok) throw new Error(completed.error || `HTTP ${completeResponse.status}`);
            workflowState.runs = workflowState.runs.map((item) => item.id === completed.run.id ? completed.run : item);
            await loadWorkflowEvents();
            setWorkflowStatus('步骤已生成，等待人工确认。', 'ok');
        } catch (error) {
            console.warn('Workflow generation failed:', error);
            setWorkflowStatus(`工作流生成失败：${error.message || error}`, 'error');
        } finally {
            workflowState.generating = false;
            workflowState.generatedText = '';
            renderWorkflow();
        }
    }

    async function approveWorkflowStep() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step) return;
        const response = await fetch('/api/workflows/approve-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, stepId: step.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        if (result.applyResult && result.applyResult.applied) {
            const refreshed = await fetchProjectSnapshot({ id: projectId });
            loadNativeProjectEditor(refreshed, { id: projectId, source: 'project-directory' });
            loadReaderFromProjectSnapshot(refreshed);
            await loadProjectLibrary();
        }
        renderWorkflow();
        setWorkflowStatus(result.run.status === 'completed' ? '工作流已完成，草稿已写入项目。' : '步骤已批准。', 'ok');
    }

    async function rejectWorkflowStep() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step) return;
        const reason = window.prompt('退回原因', '需要调整后重新生成。') || '';
        const response = await fetch('/api/workflows/reject-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, stepId: step.id, reason })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('步骤已退回，可重新生成。', 'ok');
    }

    async function applyWorkflowArtifact() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const draftArtifact = latestWorkflowArtifact(run, 'draft_text');
        if (!projectId || !run || !draftArtifact) return;
        const response = await fetch('/api/workflows/apply-artifact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, artifactId: draftArtifact.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        if (result.applyResult && result.applyResult.applied) {
            const refreshed = await fetchProjectSnapshot({ id: projectId });
            loadNativeProjectEditor(refreshed, { id: projectId, source: 'project-directory' });
            loadReaderFromProjectSnapshot(refreshed);
            await loadProjectLibrary();
        }
        renderWorkflow();
        setWorkflowStatus('草稿已采纳到当前项目，工作流仍可继续调整。', 'ok');
    }

    async function cancelWorkflowRun() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run) return;
        const reason = window.prompt('取消原因', '用户取消此工作流。') || '';
        const response = await fetch('/api/workflows/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, reason })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('工作流已取消。', 'ok');
    }

    function bindWorkflow() {
        const elements = workflowElements();
        if (elements.start) elements.start.addEventListener('click', () => startWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        renderWorkflow();
    }
