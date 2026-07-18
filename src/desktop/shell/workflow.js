    function workflowElements() {
        return {
            projectLabel: document.querySelector('[data-workflow-project-label]'),
            mode: document.querySelector('[data-workflow-mode]'),
            modeNote: document.querySelector('[data-workflow-mode-note]'),
            continuationFields: document.querySelector('[data-workflow-continuation-fields]'),
            creationFields: document.querySelector('[data-workflow-creation-fields]'),
            rewriteFields: document.querySelector('[data-workflow-rewrite-fields]'),
            brief: document.querySelector('[data-workflow-brief]'),
            sourceScope: document.querySelector('[data-workflow-source-scope]'),
            directionLocks: document.querySelector('[data-workflow-direction-locks]'),
            exclusionLocks: document.querySelector('[data-workflow-exclusion-locks]'),
            fineOutline: document.querySelector('[data-workflow-fine-outline]'),
            thinking: document.querySelector('[data-workflow-thinking]'),
            start: document.querySelector('[data-workflow-start-guided]'),
            startCreation: document.querySelector('[data-workflow-start-creation]'),
            startRewrite: document.querySelector('[data-workflow-start-rewrite]'),
            rewriteScope: document.querySelector('[data-workflow-rewrite-scope]'),
            rewriteInstruction: document.querySelector('[data-workflow-rewrite-instruction]'),
            rewriteStyle: document.querySelector('[data-workflow-rewrite-style]'),
            rewriteTone: document.querySelector('[data-workflow-rewrite-tone]'),
            rewritePov: document.querySelector('[data-workflow-rewrite-pov]'),
            rewriteRatio: document.querySelector('[data-workflow-rewrite-ratio]'),
            creationTitle: document.querySelector('[data-workflow-creation-title]'),
            creationPremise: document.querySelector('[data-workflow-creation-premise]'),
            creationGenre: document.querySelector('[data-workflow-creation-genre]'),
            creationTargetLength: document.querySelector('[data-workflow-creation-target-length]'),
            creationThemes: document.querySelector('[data-workflow-creation-themes]'),
            creationTone: document.querySelector('[data-workflow-creation-tone]'),
            creationPov: document.querySelector('[data-workflow-creation-pov]'),
            creationSetting: document.querySelector('[data-workflow-creation-setting]'),
            legacyStart: document.querySelector('[data-workflow-start]'),
            status: document.querySelector('[data-workflow-status]'),
            runList: document.querySelector('[data-workflow-run-list]'),
            title: document.querySelector('[data-workflow-title]'),
            viewGuided: document.querySelector('[data-workflow-view-guided]'),
            viewGraph: document.querySelector('[data-workflow-view-graph]'),
            graph: document.querySelector('[data-workflow-graph]'),
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
            eventsCount: document.querySelector('[data-workflow-events-count]'),
            reasoningBubble: document.querySelector('[data-workflow-reasoning-bubble]'),
            reasoningTitle: document.querySelector('[data-workflow-reasoning-title]'),
            reasoningStatus: document.querySelector('[data-workflow-reasoning-status]'),
            reasoningContent: document.querySelector('[data-workflow-reasoning-content]'),
            reasoningClose: document.querySelector('[data-workflow-reasoning-close]')
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

    function renderWorkflowReasoningBubble() {
        const elements = workflowElements();
        const state = workflowState.reasoning;
        if (!elements.reasoningBubble || !state) return;
        elements.reasoningBubble.hidden = !state.visible || state.dismissed;
        elements.reasoningBubble.dataset.phase = state.phase || 'idle';
        if (elements.reasoningTitle) elements.reasoningTitle.textContent = state.title || 'AI 思考过程';
        if (elements.reasoningStatus) elements.reasoningStatus.textContent = state.status || '等待模型响应…';
        if (elements.reasoningContent) {
            const shouldFollow = elements.reasoningContent.scrollHeight - elements.reasoningContent.scrollTop - elements.reasoningContent.clientHeight < 48;
            elements.reasoningContent.textContent = state.text || (state.phase === 'waiting' ? '正在连接模型…' : '当前模型未返回可展示的思考过程。');
            if (shouldFollow) elements.reasoningContent.scrollTop = elements.reasoningContent.scrollHeight;
        }
    }

    function beginWorkflowReasoning(config = {}, label = '当前任务') {
        const deepSeek = String(config.provider || config.aiProvider || '').toLowerCase() === 'deepseek';
        const model = String(config.model || config.aiModel || '').trim();
        workflowState.reasoning = {
            visible: true,
            dismissed: false,
            phase: 'waiting',
            title: `${deepSeek ? 'DeepSeek' : 'AI'} 思考过程${model ? ` · ${model}` : ''}`,
            status: `已发送：${label}，等待模型响应…`,
            text: '',
            hasReasoning: false,
            batchHasReasoning: false
        };
        renderWorkflowReasoningBubble();
    }

    function beginWorkflowReasoningBatch(label, index, total) {
        const state = workflowState.reasoning;
        if (!state) return;
        if (index > 0) state.text += `${state.text ? '\n\n' : ''}—— ${label} ——\n`;
        state.phase = 'waiting';
        state.batchHasReasoning = false;
        state.status = `正在处理 ${index + 1}/${total}：${label}，等待思考流…`;
        renderWorkflowReasoningBubble();
    }

    function appendWorkflowReasoning(token) {
        if (!token || !workflowState.reasoning) return;
        const state = workflowState.reasoning;
        state.hasReasoning = true;
        state.batchHasReasoning = true;
        state.phase = 'thinking';
        state.status = '模型正在思考，内容实时返回中…';
        state.text += token;
        if (state.text.length > 50000) state.text = `…较早的思考内容已省略…\n${state.text.slice(-48000)}`;
        renderWorkflowReasoningBubble();
    }

    function markWorkflowAnswerStarted() {
        const state = workflowState.reasoning;
        if (!state || state.phase === 'answer') return;
        state.phase = 'answer';
        state.status = state.batchHasReasoning ? '思考完成，正在生成结果…' : '当前批次未返回可展示的思考过程，正在生成结果…';
        renderWorkflowReasoningBubble();
    }

    function finishWorkflowReasoning(ok, message) {
        const state = workflowState.reasoning;
        if (!state) return;
        state.phase = ok ? 'complete' : 'failed';
        state.status = message || (ok ? '模型响应完成。' : '模型响应失败。');
        renderWorkflowReasoningBubble();
    }

    function isGuidedWorkflow(run = selectedWorkflowRun()) {
        return !!(run && run.storageVersion === 'v2' && run.supportsV2Execution);
    }

    function isCreationWorkflow(run = selectedWorkflowRun()) {
        return !!(run && run.templateId === 'creation-guided');
    }

    function isRewriteWorkflow(run = selectedWorkflowRun()) {
        return !!(run && run.templateId === 'rewrite-guided');
    }

    function guidedWorkflowEndpoints(run = selectedWorkflowRun()) {
        if (isRewriteWorkflow(run)) return {
            get: '/api/workflows/v2/rewrite-run', prepare: '/api/workflows/v2/prepare-rewrite-node', complete: '/api/workflows/v2/complete-rewrite-node',
            revise: '/api/workflows/v2/revise-rewrite-artifact', approve: '/api/workflows/v2/approve-rewrite-node', cancel: '/api/workflows/v2/cancel-rewrite'
        };
        return isCreationWorkflow(run) ? {
            get: '/api/workflows/v2/creation-run',
            prepare: '/api/workflows/v2/prepare-creation-node',
            complete: '/api/workflows/v2/complete-creation-node',
            revise: '/api/workflows/v2/revise-creation-artifact',
            approve: '/api/workflows/v2/approve-creation-node',
            cancel: '/api/workflows/v2/cancel-creation'
        } : {
            get: '/api/workflows/v2/guided-run',
            prepare: '/api/workflows/v2/prepare-guided-node',
            complete: '/api/workflows/v2/complete-guided-node',
            revise: '/api/workflows/v2/revise-guided-artifact',
            approve: '/api/workflows/v2/approve-guided-node',
            cancel: '/api/workflows/v2/cancel-guided'
        };
    }

    function renderWorkflowLaunchMode() {
        const elements = workflowElements();
        const mode = elements.mode ? elements.mode.value : 'continuation';
        const creation = mode === 'creation';
        const rewrite = mode === 'rewrite';
        if (elements.continuationFields) elements.continuationFields.hidden = creation || rewrite;
        if (elements.creationFields) elements.creationFields.hidden = !creation;
        if (elements.rewriteFields) elements.rewriteFields.hidden = !rewrite;
        if (elements.start) elements.start.hidden = creation || rewrite;
        if (elements.startCreation) elements.startCreation.hidden = !creation;
        if (elements.startRewrite) elements.startRewrite.hidden = !rewrite;
        if (elements.legacyStart) elements.legacyStart.hidden = creation || rewrite;
        if (elements.modeNote) elements.modeNote.textContent = rewrite ? '大段重写：冻结原文后，确认重写计划，分场景重写、修复衔接、预览差异并选择回流。' : creation
            ? '从零创作：确认 Brief 后，依次设计方向、故事蓝图、人物与世界观、节奏细纲、正文和回流。' : '续写引导：冻结原文后，依次确认分析、方向、细纲、正文、审查和回流。';
    }

    function workflowLockConstraints(elements) {
        const lines = (value) => String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        return [
            ...lines(elements.directionLocks && elements.directionLocks.value).map((text, index) => ({ id: `direction-lock-${index + 1}`, kind: 'direction', text, enforcement: 'soft', weight: 1 })),
            ...lines(elements.exclusionLocks && elements.exclusionLocks.value).map((text, index) => ({ id: `exclusion-lock-${index + 1}`, kind: 'exclusion', text, enforcement: 'hard', weight: 1 }))
        ];
    }

    function guidedStageProviderConfig(nodeId) {
        const config = runtimeProviderConfig();
        const thinking = !!workflowElements().thinking?.checked;
        const minimums = { analysis: 4000, direction: 3000, blueprint: 5000, compendium: 5000, plan: 4000, draft: 6000, rewrite: 6000, repair: 6000, review: 3000 };
        const minimum = minimums[nodeId] || 3000;
        return {
            ...config,
            enableThinking: thinking,
            useProviderDefaults: false,
            maxTokens: Math.max(Number(config.maxTokens) || 0, minimum)
        };
    }

    async function loadGuidedWorkflowRun(runId = workflowState.selectedId) {
        const projectId = currentProjectId();
        const summary = workflowState.runs.find((run) => run.id === runId);
        if (!projectId || !summary || !summary.supportsV2Execution) return summary;
        const response = await fetch(`${guidedWorkflowEndpoints(summary).get}?${new URLSearchParams({ projectId, runId }).toString()}`, { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((run) => run.id === runId ? result.run : run);
        const artifacts = result.run.artifacts || [];
        const direction = artifacts.filter((artifact) => artifact.nodeId === 'direction').slice(-1)[0];
        const persistedDirectionIds = direction && direction.content && Array.isArray(direction.content.selectedDirectionIds)
            ? direction.content.selectedDirectionIds : [];
        if (persistedDirectionIds.length) workflowState.selectedDirectionIds = persistedDirectionIds.slice();
        if (!artifacts.some((artifact) => artifact.id === workflowState.selectedArtifactId)) {
            const activeArtifact = artifacts.filter((artifact) => artifact.nodeId === result.run.activeNodeId).slice(-1)[0];
            workflowState.selectedArtifactId = activeArtifact ? activeArtifact.id : (artifacts[artifacts.length - 1] || {}).id || '';
        }
        return result.run;
    }

    function renderWorkflow() {
        const elements = workflowElements();
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        const isTerminalRun = run && ['completed', 'cancelled', 'failed'].includes(run.status);
        const draftArtifact = latestWorkflowArtifact(run, 'draft_text');
        const graphMode = workflowState.viewMode === 'graph';
        if (elements.viewGuided) elements.viewGuided.classList.toggle('is-active', !graphMode);
        if (elements.viewGraph) {
            elements.viewGraph.classList.toggle('is-active', graphMode);
            elements.viewGraph.disabled = !!run && !run.definition;
        }
        if (elements.steps) elements.steps.hidden = graphMode;
        if (elements.graph) {
            elements.graph.hidden = !graphMode;
            if (graphMode) renderWorkflowGraph(elements.graph, run);
        }
        if (elements.projectLabel) {
            const project = nativeEditorState.snapshot && nativeEditorState.snapshot.project;
            elements.projectLabel.textContent = project ? `当前项目：${project.name || project.title || project.id}` : '请先在书库打开或新建一个项目。';
        }
        if (elements.start) elements.start.disabled = !projectId || workflowState.generating;
        if (elements.startCreation) elements.startCreation.disabled = !projectId || workflowState.generating;
        if (elements.startRewrite) elements.startRewrite.disabled = !projectId || workflowState.generating;
        if (elements.legacyStart) elements.legacyStart.disabled = !projectId || workflowState.generating;
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
                    const guidedLabel = item.templateId === 'creation-guided' ? ' · 从零创作' : item.templateId === 'rewrite-guided' ? ' · 大段重写' : ' · 续写引导';
                    const storageLabel = item.storageVersion === 'v2' ? (item.supportsV2Execution ? guidedLabel : ' · v2（只读）') : '';
                    button.innerHTML = `<strong>${item.title || '创作流程'}</strong><span>${statusText}${item.activeStepId ? ` · ${item.activeStepId}` : ''}${storageLabel}</span>`;
                    button.addEventListener('click', async () => {
                        workflowState.selectedId = item.id;
                        workflowState.selectedArtifactId = '';
                        workflowState.selectedDirectionIds = [];
                        workflowState.selectedRewriteSceneIds = [];
                        workflowState.variantComparison = null;
                        workflowState.variantSelections = {};
                        workflowState.pendingVariantId = '';
                        workflowState.pendingVariantApproved = false;
                        workflowState.graphEditing = false;
                        workflowState.graphDraftRunId = '';
                        workflowState.graphDraft = null;
                        workflowState.graphSelectedNodeId = '';
                        workflowState.graphTemplateId = '';
                        workflowState.graphTemplateVersion = 0;
                        workflowState.graphPendingConnection = null;
                        if (item.supportsV2Execution) await loadGuidedWorkflowRun(item.id);
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
            } else if (run && run.readOnly) {
                const guideDiv = document.createElement('div');
                guideDiv.className = 'desktop-workflow-steps-guide';
                guideDiv.dataset.workflowGuide = '';
                const kicker = document.createElement('p');
                kicker.className = 'desktop-section-kicker';
                kicker.textContent = '新版工作流存储';
                const heading = document.createElement('h3');
                heading.textContent = '此运行已按 v2 协议保存';
                const desc = document.createElement('p');
                desc.textContent = '当前版本仅提供兼容查看。v2 执行器将在后续工作包接入，旧执行、审批和写回按钮不会作用于该运行。';
                guideDiv.append(kicker, heading, desc);
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
                statusText.textContent = `${stepStatusLabels[item.status] || item.status} · ${item.kind || ''}${item.staleArtifactCount ? ` · ${item.staleArtifactCount} 个过期产物` : ''}`;
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
            if (run && run.readOnly) {
                const note = document.createElement('p');
                note.className = 'desktop-workflow-artifacts-label';
                note.textContent = 'v2 运行当前为只读兼容状态；请等待 v2 执行器接入。';
                elements.stageActions.appendChild(note);
            } else if (run && isGuidedWorkflow(run)) {
                renderGuidedWorkflowActions(elements.stageActions, run, step, isTerminalRun);
            } else if (run) {
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
                if (run.copyToV2Available) {
                    const copyBtn = document.createElement('button');
                    copyBtn.className = 'desktop-mini-action';
                    copyBtn.type = 'button';
                    copyBtn.dataset.workflowCopyLegacy = '';
                    copyBtn.textContent = '复制为新版运行';
                    copyBtn.disabled = workflowState.generating;
                    copyBtn.addEventListener('click', () => copyLegacyWorkflowRun().catch((error) => setWorkflowStatus(`复制失败：${error.message || error}`, 'error')));
                    elements.stageActions.appendChild(copyBtn);
                }
            }
        }

        if (elements.artifacts) {
            elements.artifacts.replaceChildren();
            const hasArtifacts = run && run.artifacts && run.artifacts.length > 0;
            elements.artifacts.hidden = !hasArtifacts;
            if (hasArtifacts && isGuidedWorkflow(run)) {
                renderGuidedWorkflowArtifacts(elements.artifacts, run);
            } else if (hasArtifacts) {
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
            await loadGuidedWorkflowRun();
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
            const providerConfig = { ...runtimeProviderConfig(), enableThinking: !!workflowElements().thinking?.checked };
            beginWorkflowReasoning(providerConfig, step.title || step.id);
            await window.DraftHarborProviderStream.streamGeneration(prepared.prompt, (token, meta) => {
                if (meta && meta.type === 'reasoning') {
                    appendWorkflowReasoning(token);
                    return;
                }
                if (meta && meta.type === 'usage') return;
                markWorkflowAnswerStarted();
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
            }, providerConfig);
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
            finishWorkflowReasoning(true, '模型响应完成，结果已返回。');
        } catch (error) {
            console.warn('Workflow generation failed:', error);
            setWorkflowStatus(`工作流生成失败：${error.message || error}`, 'error');
            finishWorkflowReasoning(false, `响应失败：${error.message || error}`);
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

    async function copyLegacyWorkflowRun() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run || !run.copyToV2Available || workflowState.generating) return;
        const response = await fetch('/api/workflows/copy-legacy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, legacyRunId: run.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = [result.run, ...workflowState.runs.filter((item) => item.id !== result.run.id)];
        workflowState.selectedId = result.run.id;
        if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('已复制为 v2 新运行；原运行保持不变。', 'ok');
    }

    function renderGuidedWorkflowActions(container, run, step, isTerminalRun) {
        const active = step && !isTerminalRun;
        const transferStep = (run.steps || []).find((item) => item.id === 'transfer');
        const provider = guidedStageProviderConfig(step && step.id);
        const contextCount = (run.artifacts || []).filter((artifact) => !step || artifact.nodeId !== step.id).length;
        const budget = provider.useProviderDefaults ? '使用模型默认输出预算' : `单批最多 ${provider.maxTokens || '未设置'} tokens`;
        const contextNote = document.createElement('p');
        contextNote.className = 'desktop-workflow-context-note';
        contextNote.textContent = `上下文来源 ${contextCount} 个产物 · ${provider.model || '当前模型'} · ${budget}${provider.enableThinking ? ' · 深度思考已开启' : ''}`;
        container.appendChild(contextNote);
        if (active && step.id !== 'transfer') {
            const generate = document.createElement('button');
            generate.type = 'button';
            generate.className = 'desktop-primary-action';
            generate.dataset.workflowGuidedGenerate = '';
            generate.textContent = step.id === 'review' ? '执行自动审查' : `生成：${step.title}`;
            generate.disabled = workflowState.generating || !['ready', 'failed'].includes(step.status);
            generate.addEventListener('click', () => generateGuidedWorkflowNode().catch((error) => setWorkflowStatus(`生成失败：${error.message || error}`, 'error')));
            container.appendChild(generate);
        }
        if (active && step.status === 'waiting_user') {
            const approve = document.createElement('button');
            approve.type = 'button';
            approve.className = 'desktop-secondary-action';
            approve.dataset.workflowGuidedApprove = '';
            approve.textContent = `确认并进入下一步`;
            approve.disabled = workflowState.generating;
            approve.addEventListener('click', () => approveGuidedWorkflowNode().catch((error) => setWorkflowStatus(`确认失败：${error.message || error}`, 'error')));
            container.appendChild(approve);
        }
        if ((step && step.id === 'transfer') || (transferStep && transferStep.status === 'completed')) {
            const writer = document.createElement('button');
            writer.type = 'button';
            writer.className = 'desktop-primary-action';
            writer.dataset.workflowGuidedTransferWriter = '';
            writer.textContent = isRewriteWorkflow(run) ? '更新勾选的原场景' : '预览并转到写作区';
            writer.disabled = workflowState.generating;
            writer.addEventListener('click', () => (isRewriteWorkflow(run) ? transferGuidedRewrite() : transferGuidedDrafts()).catch((error) => setWorkflowStatus(`转写失败：${error.message || error}`, 'error')));
            const compendium = document.createElement('button');
            compendium.type = 'button';
            compendium.className = 'desktop-secondary-action';
            compendium.dataset.workflowGuidedTransferCompendium = '';
            compendium.textContent = '预览资料卡建议';
            compendium.disabled = workflowState.generating;
            compendium.addEventListener('click', () => transferGuidedCompendiumSuggestions().catch((error) => setWorkflowStatus(`资料回流失败：${error.message || error}`, 'error')));
            container.appendChild(writer);
            if (!isRewriteWorkflow(run)) container.appendChild(compendium);
            const variant = document.createElement('button');
            variant.type = 'button'; variant.className = 'desktop-secondary-action'; variant.dataset.workflowGenerateVariant = '';
            variant.textContent = '生成并比较替代版本'; variant.disabled = workflowState.generating;
            variant.addEventListener('click', () => generateAlternativeWorkflowVariant().catch((error) => setWorkflowStatus(`版本生成失败：${error.message || error}`, 'error')));
            container.appendChild(variant);
        }
        if (!isTerminalRun) {
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'desktop-mini-action';
            cancel.dataset.workflowGuidedCancel = '';
            cancel.textContent = '取消运行';
            cancel.disabled = workflowState.generating;
            cancel.addEventListener('click', () => cancelGuidedWorkflowRun().catch((error) => setWorkflowStatus(`取消失败：${error.message || error}`, 'error')));
            container.appendChild(cancel);
        }
    }

    function renderGuidedWorkflowArtifacts(container, run) {
        const label = document.createElement('p');
        label.className = 'desktop-workflow-artifacts-label';
        label.textContent = '产物与版本';
        const list = document.createElement('div');
        list.className = 'desktop-workflow-artifact-list';
        (run.artifacts || []).forEach((artifact) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'desktop-workflow-artifact-tab';
            button.classList.toggle('is-active', artifact.id === workflowState.selectedArtifactId);
            button.textContent = `${artifact.title} · ${artifact.revision.reviewState}${artifact.effectiveFreshness === 'stale' ? ' · 已过期' : ''}`;
            button.addEventListener('click', () => {
                workflowState.selectedArtifactId = artifact.id;
                renderWorkflow();
            });
            list.appendChild(button);
        });
        container.append(label, list);
        const selected = (run.artifacts || []).find((artifact) => artifact.id === workflowState.selectedArtifactId)
            || (run.artifacts || [])[run.artifacts.length - 1];
        if (!selected) return;
        const editor = document.createElement('section');
        editor.className = 'desktop-workflow-artifact-editor';
        const meta = document.createElement('div');
        const provider = selected.revision.providerSnapshot || {};
        meta.innerHTML = `<strong>${selected.title}</strong><span>${selected.artifactType} · Revision ${selected.revision.id} · ${selected.revision.reviewState}${selected.effectiveFreshness === 'stale' ? ' · 已过期，需重新生成' : ''}${provider.model ? ` · ${provider.model}` : ''}</span>`;
        const textarea = document.createElement('textarea');
        textarea.dataset.workflowArtifactEditor = '';
        textarea.value = typeof selected.content === 'string' ? selected.content : JSON.stringify(selected.content, null, 2);
        const activeStep = activeWorkflowStep(run);
        const editable = !!(activeStep && activeStep.id === selected.nodeId && activeStep.status === 'waiting_user');
        textarea.readOnly = !editable;
        editor.append(meta, textarea);
        if (selected.artifactType === 'rewrite-comparison@1' && selected.content && Array.isArray(selected.content.comparisons)) {
            textarea.hidden = true;
            const comparisons = document.createElement('div');
            comparisons.className = 'desktop-workflow-rewrite-comparisons';
            if (!workflowState.selectedRewriteSceneIds.length) workflowState.selectedRewriteSceneIds = selected.content.comparisons.map((item) => item.result.targetSceneId);
            selected.content.comparisons.forEach((item) => {
                const card = document.createElement('section');
                card.className = 'desktop-workflow-rewrite-comparison';
                const heading = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox'; checkbox.checked = workflowState.selectedRewriteSceneIds.includes(item.result.targetSceneId);
                checkbox.addEventListener('change', () => {
                    const ids = new Set(workflowState.selectedRewriteSceneIds);
                    if (checkbox.checked) ids.add(item.result.targetSceneId); else ids.delete(item.result.targetSceneId);
                    workflowState.selectedRewriteSceneIds = Array.from(ids);
                });
                const title = document.createElement('strong');
                title.textContent = `${item.result.targetSceneId} · ${item.diff.characterDelta >= 0 ? '+' : ''}${item.diff.characterDelta} 字符`;
                heading.append(checkbox, title);
                const diff = document.createElement('div');
                diff.className = 'desktop-workflow-rewrite-diff';
                item.diff.operations.forEach((operation) => {
                    const block = document.createElement('p'); block.dataset.diffType = operation.type; block.textContent = operation.text; diff.appendChild(block);
                });
                card.append(heading, diff); comparisons.appendChild(card);
            });
            editor.appendChild(comparisons);
        }
        if (selected.nodeId === 'direction' && selected.content && Array.isArray(selected.content.directions)) {
            const options = document.createElement('div');
            options.className = 'desktop-workflow-direction-options';
            if (!workflowState.selectedDirectionIds.length && selected.content.directions[0]) workflowState.selectedDirectionIds = [selected.content.directions[0].id];
            selected.content.directions.forEach((direction) => {
                const option = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = workflowState.selectedDirectionIds.includes(direction.id);
                checkbox.addEventListener('change', () => {
                    const ids = new Set(workflowState.selectedDirectionIds);
                    if (checkbox.checked) ids.add(direction.id); else ids.delete(direction.id);
                    workflowState.selectedDirectionIds = Array.from(ids);
                });
                const text = document.createElement('span');
                text.textContent = `${direction.title}：${direction.premise}`;
                option.append(checkbox, text);
                options.appendChild(option);
            });
            editor.appendChild(options);
        }
        if (editable) {
            const save = document.createElement('button');
            save.type = 'button';
            save.className = 'desktop-secondary-action';
            save.dataset.workflowArtifactSave = '';
            save.textContent = '保存为新版本';
            save.addEventListener('click', () => saveGuidedArtifact(selected, textarea.value).catch((error) => setWorkflowStatus(`保存失败：${error.message || error}`, 'error')));
            editor.appendChild(save);
        }
        container.appendChild(editor);
        renderWorkflowVariantComparison(container, run);
    }

    function renderWorkflowVariantComparison(container, run) {
        const comparison = workflowState.variantComparison;
        if (!comparison || comparison.runId !== run.id || !Array.isArray(comparison.scopes)) return;
        const panel = document.createElement('section'); panel.className = 'desktop-workflow-variant-panel'; panel.dataset.workflowVariantPanel = '';
        const heading = document.createElement('div');
        heading.innerHTML = `<strong>版本比较</strong><span>${comparison.left.label} ↔ ${comparison.right.label}</span>`;
        panel.appendChild(heading);
        comparison.scopes.forEach((scope, index) => {
            const card = document.createElement('section'); card.className = 'desktop-workflow-variant-scope';
            const title = document.createElement('strong'); title.textContent = (scope.right || scope.left).title || scope.scopeKey;
            const choices = document.createElement('div'); choices.className = 'desktop-workflow-variant-choices';
            [['left', comparison.left.label], ['right', comparison.right.label]].forEach(([side, label]) => {
                if (!scope[side]) return;
                const option = document.createElement('label'); const radio = document.createElement('input');
                radio.type = 'radio'; radio.name = `variant-${run.id}-${scope.scopeKey}`; radio.value = side; radio.dataset.workflowVariantChoice = scope.scopeKey;
                radio.checked = (workflowState.variantSelections[scope.scopeKey] || 'right') === side;
                radio.addEventListener('change', () => { if (radio.checked) workflowState.variantSelections[scope.scopeKey] = side; });
                option.append(radio, document.createTextNode(label)); choices.appendChild(option);
            });
            card.append(title, choices);
            if (scope.diff) {
                const diff = document.createElement('div'); diff.className = 'desktop-workflow-rewrite-diff';
                scope.diff.operations.forEach((operation) => { const block = document.createElement('p'); block.dataset.diffType = operation.type; block.textContent = operation.text; diff.appendChild(block); });
                card.appendChild(diff);
            }
            panel.appendChild(card);
            if (!workflowState.variantSelections[scope.scopeKey]) workflowState.variantSelections[scope.scopeKey] = 'right';
        });
        const actions = document.createElement('div'); actions.className = 'desktop-workflow-variant-actions';
        if (!workflowState.pendingVariantApproved) {
            const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'desktop-secondary-action'; approve.dataset.workflowApproveVariant = ''; approve.textContent = '批准替代版本';
            approve.addEventListener('click', () => approveAlternativeWorkflowVariant().catch((error) => setWorkflowStatus(`版本批准失败：${error.message || error}`, 'error'))); actions.appendChild(approve);
        }
        const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'desktop-primary-action'; apply.dataset.workflowApplyVariantSelection = ''; apply.textContent = '采用所选场景组合';
        apply.disabled = !workflowState.pendingVariantApproved; apply.addEventListener('click', () => applyWorkflowVariantSelection().catch((error) => setWorkflowStatus(`版本采用失败：${error.message || error}`, 'error'))); actions.appendChild(apply);
        panel.appendChild(actions); container.appendChild(panel);
    }

    async function startGuidedWorkflowRun() {
        const projectId = currentProjectId();
        const elements = workflowElements();
        if (!projectId || !nativeEditorState.snapshot) return;
        const scope = elements.sourceScope ? elements.sourceScope.value : 'chapter';
        const activeScene = (nativeEditorState.snapshot.scenes || []).find((scene) => scene.id === nativeEditorState.activeSceneId)
            || (nativeEditorState.snapshot.scenes || [])[0];
        if (scope !== 'project' && !activeScene) throw new Error('当前项目没有可用场景');
        workflowState.generating = true;
        setWorkflowStatus('正在冻结原文并创建引导运行...', 'info');
        renderWorkflow();
        try {
            const response = await fetch('/api/workflows/v2/start-guided', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    scope,
                    sceneId: activeScene && activeScene.id,
                    chapterId: activeScene && activeScene.chapterId,
                    brief: elements.brief ? elements.brief.value : '',
                    fineOutlineEnabled: !elements.fineOutline || elements.fineOutline.checked,
                    constraints: workflowLockConstraints(elements)
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.selectedId = result.runId;
            await loadWorkflowRuns();
            setWorkflowStatus('原文快照已冻结，可以开始原文分析。', 'ok');
        } finally {
            workflowState.generating = false;
            renderWorkflow();
        }
    }

    function commaSeparatedValues(value) {
        return String(value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    }

    async function startCreationWorkflowRun() {
        const projectId = currentProjectId();
        const elements = workflowElements();
        if (!projectId || !nativeEditorState.snapshot) return;
        const premise = elements.creationPremise ? elements.creationPremise.value.trim() : '';
        if (!premise) throw new Error('请先填写核心创意或故事前提');
        workflowState.generating = true;
        setWorkflowStatus('正在创建从零创作引导...', 'info');
        renderWorkflow();
        try {
            const response = await fetch('/api/workflows/v2/start-creation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    brief: {
                        workingTitle: elements.creationTitle ? elements.creationTitle.value : '',
                        premise,
                        genre: elements.creationGenre ? elements.creationGenre.value : '',
                        targetLength: Number(elements.creationTargetLength && elements.creationTargetLength.value) || 0,
                        themes: commaSeparatedValues(elements.creationThemes && elements.creationThemes.value),
                        tone: elements.creationTone ? elements.creationTone.value : '',
                        pov: elements.creationPov ? elements.creationPov.value : '',
                        setting: elements.creationSetting ? elements.creationSetting.value : '',
                        mustInclude: workflowLockConstraints(elements).filter((item) => item.kind === 'direction').map((item) => item.text),
                        avoid: workflowLockConstraints(elements).filter((item) => item.kind === 'exclusion').map((item) => item.text)
                    },
                    fineOutlineEnabled: !elements.fineOutline || elements.fineOutline.checked,
                    constraints: workflowLockConstraints(elements)
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.selectedId = result.runId;
            workflowState.selectedDirectionIds = [];
            await loadWorkflowRuns();
            setWorkflowStatus('创作 Brief 已冻结，可以开始设计创意方向。', 'ok');
        } finally {
            workflowState.generating = false;
            renderWorkflow();
        }
    }

    async function startRewriteWorkflowRun() {
        const projectId = currentProjectId();
        const elements = workflowElements();
        if (!projectId || !nativeEditorState.snapshot) return;
        const instruction = elements.rewriteInstruction ? elements.rewriteInstruction.value.trim() : '';
        if (!instruction) throw new Error('请先填写重写目标');
        const activeScene = (nativeEditorState.snapshot.scenes || []).find((scene) => scene.id === nativeEditorState.activeSceneId) || (nativeEditorState.snapshot.scenes || [])[0];
        const scope = elements.rewriteScope ? elements.rewriteScope.value : 'chapter';
        if (scope !== 'project' && !activeScene) throw new Error('当前项目没有可重写场景');
        workflowState.generating = true; setWorkflowStatus('正在冻结原文并创建重写运行...', 'info'); renderWorkflow();
        try {
            const response = await fetch('/api/workflows/v2/start-rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                projectId, scope, sceneId: activeScene && activeScene.id, chapterId: activeScene && activeScene.chapterId,
                brief: { instruction, targetStyle: elements.rewriteStyle?.value || '', targetTone: elements.rewriteTone?.value || '', targetPov: elements.rewritePov?.value || '', targetLengthRatio: Number(elements.rewriteRatio?.value) || 1 },
                constraints: workflowLockConstraints(elements)
            }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.selectedId = result.runId; workflowState.selectedRewriteSceneIds = [];
            await loadWorkflowRuns(); setWorkflowStatus('原文已冻结，可以生成并编辑重写计划。', 'ok');
        } finally { workflowState.generating = false; renderWorkflow(); }
    }

    async function generateGuidedWorkflowNode() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step || workflowState.generating) return;
        workflowState.generating = true;
        setWorkflowStatus(step.id === 'review' ? '正在执行自动审查...' : `正在生成：${step.title}`, 'info');
        renderWorkflow();
        try {
            const endpoints = guidedWorkflowEndpoints(run);
            const preparedResponse = await fetch(endpoints.prepare, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id, nodeId: step.id, selectedDirectionIds: workflowState.selectedDirectionIds })
            });
            const prepared = await preparedResponse.json().catch(() => ({}));
            if (!preparedResponse.ok || !prepared.ok) throw new Error(prepared.error || `HTTP ${preparedResponse.status}`);
            const outputs = [];
            const usage = [];
            const stageConfig = guidedStageProviderConfig(step.id);
            beginWorkflowReasoning(stageConfig, step.title || step.id);
            if ((prepared.prompts || []).length && (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function')) {
                throw new Error('生成服务尚未加载');
            }
            for (let index = 0; index < (prepared.prompts || []).length; index += 1) {
                const prompt = prepared.prompts[index];
                let text = '';
                setWorkflowStatus(`正在生成 ${index + 1}/${prepared.prompts.length}：${prompt.title || step.title}`, 'info');
                beginWorkflowReasoningBatch(prompt.title || step.title, index, prepared.prompts.length);
                await window.DraftHarborProviderStream.streamGeneration(prompt.prompt, (token, meta) => {
                    if (meta && meta.type === 'usage') usage.push({ promptId: prompt.id, model: stageConfig.model, ...meta.usage });
                    else if (meta && meta.type === 'reasoning') appendWorkflowReasoning(token);
                    else {
                        markWorkflowAnswerStarted();
                        text += token;
                    }
                }, { ...stageConfig, includeUsage: true });
                outputs.push(text);
            }
            const completeResponse = await fetch(endpoints.complete, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id, nodeId: step.id, outputs, usage, outputTitles: (prepared.prompts || []).map((prompt) => prompt.title || '') })
            });
            const completed = await completeResponse.json().catch(() => ({}));
            if (!completeResponse.ok || !completed.ok) throw new Error(completed.error || `HTTP ${completeResponse.status}`);
            workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? completed.run : item);
            const artifact = (completed.run.artifacts || []).filter((item) => item.nodeId === step.id).slice(-1)[0];
            workflowState.selectedArtifactId = artifact ? artifact.id : workflowState.selectedArtifactId;
            await loadWorkflowEvents();
            setWorkflowStatus(step.id === 'review' ? '自动审查完成。' : '生成完成，请检查并按需修改。', 'ok');
            finishWorkflowReasoning(true, '模型响应完成，结果已返回。');
        } catch (error) {
            finishWorkflowReasoning(false, `响应失败：${error.message || error}`);
            throw error;
        } finally {
            workflowState.generating = false;
            renderWorkflow();
        }
    }

    async function approveGuidedWorkflowNode() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step) return;
        if (step.id === 'direction' && !workflowState.selectedDirectionIds.length) throw new Error('请至少选择一个创作方向');
        const response = await fetch(guidedWorkflowEndpoints(run).approve, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, nodeId: step.id, selectedDirectionIds: workflowState.selectedDirectionIds })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item);
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('已确认，进入下一阶段。', 'ok');
    }

    async function saveGuidedArtifact(artifact, content) {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const response = await fetch(guidedWorkflowEndpoints(run).revise, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, artifactId: artifact.id, parentRevisionId: artifact.revision.id, content })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        await loadGuidedWorkflowRun(run.id);
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('修改已保存为新的不可变版本。', 'ok');
    }

    async function transferGuidedDrafts() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const drafts = (run.artifacts || []).filter((artifact) => artifact.nodeId === 'draft' && artifact.revision.reviewState === 'approved');
        if (!drafts.length) throw new Error('没有已批准的正文产物');
        const activeScene = (nativeEditorState.snapshot.scenes || []).find((scene) => scene.id === nativeEditorState.activeSceneId);
        const chapterId = `workflow-${run.id}`;
        const scenes = drafts.map((artifact, index) => ({
            sceneId: `${chapterId}-scene-${index + 1}`,
            chapterId,
            chapterTitle: `${run.title} · 生成章节`,
            title: artifact.title,
            summary: artifact.revision.summary,
            source: { runId: run.id, artifactId: artifact.id, revisionId: artifact.revision.id }
        }));
        const previewResponse = await fetch('/api/workflows/v2/preview-writer-transfer', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, scenes })
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
        const targetHint = activeScene ? `当前场景所在项目中新建章节` : '项目中新建章节';
        if (!window.confirm(`将 ${preview.counts.scenes} 个场景转入写作区（${targetHint}），是否继续？`)) return;
        const response = await fetch('/api/workflows/v2/apply-writer-transfer', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, applicationId: `guided-writer-${Date.now()}`, scenes })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.guidedRun) workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.guidedRun : item);
        const refreshed = await fetchProjectSnapshot({ id: projectId });
        loadNativeProjectEditor(refreshed, { id: projectId, source: 'project-directory' });
        loadReaderFromProjectSnapshot(refreshed);
        await loadProjectLibrary();
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('正文已转入写作区，并保留工作流来源。', 'ok');
    }

    async function transferGuidedCompendiumSuggestions() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const sourceArtifact = isCreationWorkflow(run)
            ? (run.artifacts || []).find((artifact) => artifact.nodeId === 'compendium' && artifact.revision.reviewState === 'approved')
            : (run.artifacts || []).find((artifact) => artifact.nodeId === 'analysis' && artifact.revision.reviewState === 'approved');
        const drafts = isCreationWorkflow(run)
            ? sourceArtifact && sourceArtifact.content && sourceArtifact.content.entries
            : sourceArtifact && sourceArtifact.content && sourceArtifact.content.characterCandidates;
        const candidates = Array.isArray(drafts)
            ? drafts.map((draft, index) => ({ id: `guided-card-${index + 1}`, draft, source: { runId: run.id, artifactId: sourceArtifact.id, revisionId: sourceArtifact.revision.id } }))
            : [];
        if (!candidates.length) throw new Error(isCreationWorkflow(run) ? '人物与世界观阶段没有提供资料卡草稿' : '原文分析没有提供资料卡候选');
        const previewResponse = await fetch('/api/workflows/v2/preview-compendium-suggestions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, candidates })
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
        if (!window.confirm(`发现 ${preview.suggestions.length} 条资料建议。确认后才会写入资料库，是否全部应用？`)) return;
        const response = await fetch('/api/workflows/v2/apply-compendium-suggestions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, applicationId: `guided-compendium-${Date.now()}`, candidates, confirmedSuggestionIds: preview.suggestions.map((suggestion) => suggestion.id) })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        await loadCompendium();
        setWorkflowStatus('已确认的资料建议已写入资料库。', 'ok');
    }

    async function transferGuidedRewrite() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const comparison = (run.artifacts || []).find((artifact) => artifact.artifactType === 'rewrite-comparison@1');
        const repaired = (run.artifacts || []).filter((artifact) => artifact.nodeId === 'repair' && artifact.artifactType === 'rewrite-text@1' && artifact.revision.reviewState === 'approved');
        if (!comparison || !repaired.length) throw new Error('没有可回流的已批准重写结果');
        const selected = new Set(workflowState.selectedRewriteSceneIds);
        const scenes = comparison.content.comparisons.map((item, index) => ({
            item, artifact: repaired[index]
        })).filter(({ item, artifact }) => artifact && selected.has(item.result.targetSceneId)).map(({ item, artifact }) => ({
            mode: 'update', targetSceneId: item.result.targetSceneId,
            source: { runId: run.id, artifactId: artifact.id, revisionId: artifact.revision.id }
        }));
        if (!scenes.length) throw new Error('请至少勾选一个要更新的场景');
        const previewResponse = await fetch('/api/workflows/v2/preview-writer-transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, scenes }) });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
        if (!window.confirm(`将以重写结果更新 ${preview.counts.updates} 个原场景。此操作会先保留备份，是否继续？`)) return;
        const response = await fetch('/api/workflows/v2/apply-writer-transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, applicationId: `rewrite-writer-${Date.now()}`, scenes }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.guidedRun) workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.guidedRun : item);
        const refreshed = await fetchProjectSnapshot({ id: projectId });
        loadNativeProjectEditor(refreshed, { id: projectId, source: 'project-directory' }); loadReaderFromProjectSnapshot(refreshed);
        await loadProjectLibrary(); await loadWorkflowEvents(); renderWorkflow(); setWorkflowStatus(`已更新 ${scenes.length} 个原场景，并保留重写来源。`, 'ok');
    }

    async function compareWorkflowVariants(run, rightVariantId) {
        const response = await fetch('/api/workflows/v2/compare-variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId(), runId: run.id, leftVariantId: 'main', rightVariantId }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.variantComparison = { ...result.comparison, runId: run.id };
        return result.comparison;
    }

    async function generateAlternativeWorkflowVariant() {
        const projectId = currentProjectId(); const run = selectedWorkflowRun();
        if (!projectId || !run || workflowState.generating) return;
        const instruction = window.prompt('新版本要求', '生成一个情节更紧凑、冲突更强的替代版本。');
        if (!instruction || !instruction.trim()) return;
        const label = window.prompt('版本名称', instruction.trim().slice(0, 24)) || instruction.trim().slice(0, 24);
        workflowState.generating = true; setWorkflowStatus('正在准备替代版本...', 'info'); renderWorkflow();
        try {
            const preparedResponse = await fetch('/api/workflows/v2/prepare-variant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, instruction, label }) });
            const prepared = await preparedResponse.json().catch(() => ({}));
            if (!preparedResponse.ok || !prepared.ok) throw new Error(prepared.error || `HTTP ${preparedResponse.status}`);
            const config = guidedStageProviderConfig(isRewriteWorkflow(run) ? 'repair' : 'draft');
            const outputs = []; beginWorkflowReasoning(config, `替代版本 · ${label}`);
            for (let index = 0; index < prepared.prompts.length; index += 1) {
                let output = ''; const item = prepared.prompts[index]; beginWorkflowReasoningBatch(item.title, index, prepared.prompts.length);
                await window.DraftHarborProviderStream.streamGeneration(item.prompt, (token, meta) => {
                    if (meta?.type === 'reasoning') appendWorkflowReasoning(token); else if (meta?.type !== 'usage') { markWorkflowAnswerStarted(); output += token; }
                }, { ...config, includeUsage: true });
                outputs.push(output);
            }
            const completeResponse = await fetch('/api/workflows/v2/complete-variant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, variantId: prepared.variantId, instruction, label, outputs, providerSnapshot: { provider: config.provider, model: config.model } }) });
            const completed = await completeResponse.json().catch(() => ({}));
            if (!completeResponse.ok || !completed.ok) throw new Error(completed.error || `HTTP ${completeResponse.status}`);
            workflowState.pendingVariantId = completed.variant.variantId; workflowState.pendingVariantApproved = false; workflowState.variantSelections = {};
            await compareWorkflowVariants(run, completed.variant.variantId); finishWorkflowReasoning(true, '替代版本生成完成，请逐场景比较并批准。');
            setWorkflowStatus('替代版本已生成，尚未批准或写回。', 'ok');
        } catch (error) { finishWorkflowReasoning(false, `版本生成失败：${error.message || error}`); throw error; }
        finally { workflowState.generating = false; renderWorkflow(); }
    }

    async function approveAlternativeWorkflowVariant() {
        const run = selectedWorkflowRun();
        const response = await fetch('/api/workflows/v2/approve-variant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId(), runId: run.id, variantId: workflowState.pendingVariantId }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.pendingVariantApproved = true; await compareWorkflowVariants(run, workflowState.pendingVariantId); renderWorkflow(); setWorkflowStatus('替代版本已批准，可逐场景混合采用。', 'ok');
    }

    async function applyWorkflowVariantSelection() {
        const projectId = currentProjectId(); const run = selectedWorkflowRun(); const comparison = workflowState.variantComparison;
        if (!workflowState.pendingVariantApproved || !comparison) throw new Error('请先批准替代版本');
        const chapterId = `workflow-${run.id}`;
        const scenes = comparison.scopes.map((scope, index) => {
            const side = workflowState.variantSelections[scope.scopeKey] || 'right'; const item = scope[side];
            if (!item) return null;
            const targetSceneId = item.targetSceneId || `${chapterId}-scene-${index + 1}`;
            const exists = (nativeEditorState.snapshot.scenes || []).some((scene) => scene.id === targetSceneId);
            return {
                mode: exists ? 'update' : 'create', targetSceneId, sceneId: targetSceneId,
                chapterId: item.targetSceneId ? undefined : chapterId, chapterTitle: `${run.title} · 版本采用`, title: item.title,
                source: { runId: run.id, artifactId: item.artifactId, revisionId: item.revisionId }
            };
        }).filter(Boolean);
        if (!scenes.length) throw new Error('没有选择任何版本场景');
        const previewResponse = await fetch('/api/workflows/v2/preview-writer-transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, scenes }) });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
        if (!window.confirm(`将采用 ${scenes.length} 个场景的混合版本（新建 ${preview.counts.creates}，更新 ${preview.counts.updates}），是否继续？`)) return;
        const response = await fetch('/api/workflows/v2/apply-writer-transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, applicationId: `variant-selection-${Date.now()}`, scenes }) });
        const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        const refreshed = await fetchProjectSnapshot({ id: projectId }); loadNativeProjectEditor(refreshed, { id: projectId, source: 'project-directory' }); loadReaderFromProjectSnapshot(refreshed);
        await loadProjectLibrary(); renderWorkflow(); setWorkflowStatus('所选场景版本已应用到写作区。', 'ok');
    }

    async function cancelGuidedWorkflowRun() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run) return;
        const response = await fetch(guidedWorkflowEndpoints(run).cancel, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, reason: '用户从引导界面取消' })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item);
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('引导运行已取消，已有产物仍保留。', 'ok');
    }

    function bindWorkflow() {
        const elements = workflowElements();
        if (elements.viewGuided) elements.viewGuided.addEventListener('click', () => {
            workflowState.viewMode = 'guided';
            renderWorkflow();
        });
        if (elements.viewGraph) elements.viewGraph.addEventListener('click', async () => {
            workflowState.viewMode = 'graph';
            renderWorkflow();
            await loadWorkflowGraphTemplates();
            renderWorkflow();
        });
        if (elements.mode) elements.mode.addEventListener('change', () => {
            renderWorkflowLaunchMode();
            renderWorkflow();
        });
        if (elements.start) elements.start.addEventListener('click', () => startGuidedWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.startCreation) elements.startCreation.addEventListener('click', () => startCreationWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.startRewrite) elements.startRewrite.addEventListener('click', () => startRewriteWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.legacyStart) elements.legacyStart.addEventListener('click', () => startWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.reasoningClose) elements.reasoningClose.addEventListener('click', () => {
            workflowState.reasoning.dismissed = true;
            renderWorkflowReasoningBubble();
        });
        renderWorkflowLaunchMode();
        renderWorkflow();
    }
