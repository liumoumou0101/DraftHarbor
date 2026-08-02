    function ensureWorkflowLauncherLayout() {
        const launcher = document.querySelector('[data-workflow-launcher]');
        const main = document.querySelector('.desktop-workflow-main');
        const header = main && main.querySelector('.desktop-compendium-editor-header');
        if (!launcher || !main || !header || launcher.parentElement === main || launcher.closest('.desktop-workflow-setup')) return;
        const setup = document.createElement('section');
        setup.className = 'desktop-workflow-setup';
        setup.setAttribute('aria-label', '新建创作流程设置');
        setup.appendChild(launcher);
        main.insertBefore(setup, header);
    }

    function workflowElements() {
        ensureWorkflowLauncherLayout();
        return {
            projectLabel: document.querySelector('[data-workflow-project-label]'),
            launcher: document.querySelector('[data-workflow-launcher]'),
            launcherTitle: document.querySelector('[data-workflow-launcher-title]'),
            mode: document.querySelector('[data-workflow-mode]'),
            modeNote: document.querySelector('[data-workflow-mode-note]'),
            aiConfig: document.querySelector('[data-workflow-ai-config]'),
            continuationFields: document.querySelector('[data-workflow-continuation-fields]'),
            creationFields: document.querySelector('[data-workflow-creation-fields]'),
            rewriteFields: document.querySelector('[data-workflow-rewrite-fields]'),
            brief: document.querySelector('[data-workflow-brief]'),
            sourceScope: document.querySelector('[data-workflow-source-scope]'),
            lockBoard: document.querySelector('[data-workflow-lock-board][data-lock-scope="launch"]'),
            activeLockBoard: document.querySelector('[data-workflow-active-lock-board]'),
            fineOutline: document.querySelector('[data-workflow-fine-outline]'),
            thinking: document.querySelector('[data-workflow-thinking]'),
            workflowModel: document.querySelector('[data-workflow-model]'),
            briefThinking: document.querySelector('[data-workflow-brief-thinking]'),
            briefWorkflowModel: document.querySelector('[data-workflow-brief-model]'),
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
            creationInspiration: document.querySelector('[data-workflow-creation-inspiration]'),
            creationWritingInstructions: document.querySelector('[data-workflow-creation-writing-instructions]'),
            creationPremise: document.querySelector('[data-workflow-creation-premise]'),
            creationGenre: document.querySelector('[data-workflow-creation-genre]'),
            creationTargetLength: document.querySelector('[data-workflow-creation-target-length]'),
            creationThemes: document.querySelector('[data-workflow-creation-themes]'),
            creationTone: document.querySelector('[data-workflow-creation-tone]'),
            creationPov: document.querySelector('[data-workflow-creation-pov]'),
            creationSetting: document.querySelector('[data-workflow-creation-setting]'),
            creationComplete: document.querySelector('[data-workflow-creation-complete]'),
            creationBrief: document.querySelector('[data-workflow-creation-brief]'),
            creationBriefFields: document.querySelector('[data-workflow-creation-brief-fields]'),
            creationBriefStatus: document.querySelector('[data-workflow-creation-brief-status]'),
            creationEditorStatus: document.querySelector('[data-workflow-creation-editor-status]'),
            creationRewriteInstruction: document.querySelector('[data-workflow-creation-rewrite-instruction]'),
            creationRewrite: document.querySelector('[data-workflow-creation-rewrite]'),
            creationApply: document.querySelector('[data-workflow-creation-apply]'),
            creationEdit: document.querySelector('[data-workflow-creation-edit]'),
            creationBriefClose: document.querySelector('[data-workflow-creation-brief-close]'),
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

    function isGuidedWorkflow(run = selectedWorkflowRun()) {
        return !!(run && run.storageVersion === 'v2' && run.supportsV2Execution);
    }

    function isCreationWorkflow(run = selectedWorkflowRun()) {
        return !!(run && run.templateId === 'creation-guided');
    }
    window.isCreationWorkflow = isCreationWorkflow;

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
        if (typeof window.renderWorkflowModelControl === 'function') window.renderWorkflowModelControl();
    }

    // Lock collection / writing-instructions payload live in workflow-locks.js
    // so launch form, active-run panel and review actions share one model.


    async function loadGuidedWorkflowRun(runId = workflowState.selectedId) {
        const projectId = currentProjectId();
        const summary = workflowState.runs.find((run) => run.id === runId);
        if (!projectId || !summary || !summary.supportsV2Execution) return summary;
        const response = await fetch(`${guidedWorkflowEndpoints(summary).get}?${new URLSearchParams({ projectId, runId }).toString()}`, { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((run) => run.id === runId ? result.run : run);
        if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
        const artifacts = result.run.artifacts || [];
        const direction = artifacts.filter((artifact) => artifact.nodeId === 'direction').slice(-1)[0];
        const persistedDirectionIds = direction && direction.content && Array.isArray(direction.content.selectedDirectionIds)
            ? direction.content.selectedDirectionIds : [];
        const availableDirectionIds = direction && direction.content && Array.isArray(direction.content.directions)
            ? direction.content.directions.map((item) => item.id).filter(Boolean) : [];
        const selectedDirectionIds = (persistedDirectionIds.length ? persistedDirectionIds : workflowState.selectedDirectionIds)
            .filter((id) => availableDirectionIds.includes(id));
        workflowState.selectedDirectionIds = selectedDirectionIds.length
            ? selectedDirectionIds
            : availableDirectionIds.slice(0, 1);
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
        if (typeof window.renderWorkflowStreamStage === 'function') window.renderWorkflowStreamStage();
        const step = activeWorkflowStep(run);
        const isTerminalRun = run && ['completed', 'cancelled', 'failed'].includes(run.status);
        const draftArtifact = latestWorkflowArtifact(run, 'draft_text');
        const graphMode = workflowState.viewMode === 'graph';
        if (elements.launcher) {
            const launcherProjectId = elements.launcher.dataset.projectId || '';
            const launcherRunId = elements.launcher.dataset.runId || '';
            if (launcherProjectId !== (projectId || '') || launcherRunId !== (run && run.id || '')) {
                elements.launcher.dataset.projectId = projectId || '';
                elements.launcher.dataset.runId = run && run.id || '';
                elements.launcher.open = !run;
                if (typeof window.renderWorkflowLockBoards === 'function') {
                    // Switching run reloads locks unless user is mid-edit on same run.
                    window.renderWorkflowLockBoards({ forceHydrate: true });
                }
            }
        }
        if (typeof window.renderWorkflowLockBoards === 'function') {
            window.renderWorkflowLockBoards({ preserveDraft: !!(workflowState.lockDraft && workflowState.lockDraft.dirty) });
        }
        if (elements.launcherTitle) elements.launcherTitle.textContent = run ? '新建另一条流程' : '新建创作流程';
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
        if (elements.aiConfig) elements.aiConfig.textContent = `AI：${workflowConfigLabel(workflowGenerationPolicy(run))}`;
        if (elements.modeNote && run && isGuidedWorkflow(run)) {
            const label = isCreationWorkflow(run) ? '从零创作' : isRewriteWorkflow(run) ? '大段重写' : '续写引导';
            elements.modeNote.textContent = `正在查看：${label}。新建流程设置已单独收起，不会改变当前运行。`;
        }
        if (elements.start) elements.start.disabled = !projectId || workflowState.generating;
        if (elements.startCreation) elements.startCreation.disabled = workflowState.generating || !workflowState.creationBrief;
        if (elements.startRewrite) elements.startRewrite.disabled = !projectId || workflowState.generating;
        if (elements.legacyStart) elements.legacyStart.disabled = !projectId || workflowState.generating;
        if (elements.title) {
            if (!projectId) {
                elements.title.textContent = '请先打开项目';
            } else if (!run) {
                elements.title.textContent = '创建你的第一个创作流程';
            } else {
                const terminalLabels = { completed: '完成', cancelled: '已取消', failed: '异常' };
                const stepTitle = step
                    ? (isGuidedWorkflow(run) ? (step.title || step.id) : (step.id || step.title)) || '当前步骤'
                    : (terminalLabels[run.status] || '等待恢复');
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
                    const activeTitle = window.workflowStepTitle(item, item.activeStepId || item.activeNodeId);
                    button.innerHTML = `<strong>${item.title || '创作流程'}</strong><span>${statusText}${activeTitle ? ` · ${activeTitle}` : ''}${storageLabel}</span>`;
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
                const stepStatusLabels = { completed: '已完成', cancelled: '已取消', failed: '失败', in_progress: '生成中', waiting_user: '等待审批', ready: '准备执行', pending: '待处理' };
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
                const stepTitle = window.workflowStepTitle(run, event.stepId || event.nodeId);
                card.textContent = `${formatDate(event.createdAt)} · ${window.workflowEventLabel(event.type)}${stepTitle ? ` · ${stepTitle}` : ''}`;
                if (event.type === 'guided_node_generation_failed' && event.payload) {
                    const diagnostic = Array.isArray(event.payload.outputs) ? event.payload.outputs[0] : null;
                    const details = [
                        event.payload.message,
                        diagnostic && diagnostic.characters ? `${diagnostic.characters} 字符` : '',
                        diagnostic && diagnostic.finishReason ? `停止原因：${diagnostic.finishReason}` : '',
                        event.payload.repairAttempted ? '已尝试自动修复' : ''
                    ].filter(Boolean);
                    if (details.length) card.textContent += ` · ${details.join(' · ')}`;
                    if (diagnostic && diagnostic.tail) card.title = `响应尾部：${diagnostic.tail}`;
                }
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
            const providerConfig = guidedStageProviderConfig(step.id, run);
            beginWorkflowReasoning(providerConfig, step.title || step.id);
            beginWorkflowStreamStage({
                runId: run.id,
                title: step.title || step.id || '正在生成正文',
                current: 1,
                total: 1,
                model: providerConfig.model
            });
            await window.DraftHarborProviderStream.streamGeneration(prepared.prompt, (token, meta) => {
                if (meta && meta.type === 'reasoning') {
                    appendWorkflowReasoning(token);
                    return;
                }
                if (meta && ['usage', 'finish'].includes(meta.type)) return;
                markWorkflowAnswerStarted();
                workflowState.generatedText += token;
                appendWorkflowStreamText(token);
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
            markWorkflowStreamSaving('正文已经抵达，正在写入工作流产物');
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
            finishWorkflowStreamStage(true, '正文已生成并安全保存，可以开始审阅');
            finishWorkflowReasoning(true, '模型响应完成，结果已返回。');
        } catch (error) {
            console.warn('Workflow generation failed:', error);
            setWorkflowStatus(`工作流生成失败：${error.message || error}`, 'error');
            finishWorkflowStreamStage(false, `生成中断：${error.message || error}。当前已接收文字仍保留在预览中`);
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
        const provider = guidedStageProviderConfig(step && step.id, run);
        const contextCount = (run.artifacts || []).filter((artifact) => !step || artifact.nodeId !== step.id).length;
        const budget = provider.useProviderDefaults ? '使用模型默认输出预算' : `单批最多 ${provider.maxTokens || '未设置'} tokens`;
        const contextNote = document.createElement('p');
        contextNote.className = 'desktop-workflow-context-note';
        contextNote.textContent = `上下文来源 ${contextCount} 个产物 · ${provider.model || '当前模型'} · ${budget}${provider.enableThinking ? ' · 深度思考已开启' : ''}`;
        container.appendChild(contextNote);
        const progressPanel = document.createElement('p');
        progressPanel.className = 'desktop-workflow-step-progress';
        progressPanel.dataset.workflowStepProgress = '';
        container.appendChild(progressPanel);
        window.setWorkflowGenerationProgress();
        renderGuidedWorkflowInlineResult(container, run, step);
        if (run.status === 'cancelled') {
            const resumeNote = document.createElement('p');
            resumeNote.className = 'desktop-workflow-context-note';
            resumeNote.textContent = '此流程保留了已生成的产物，可以从中断位置继续，不会重新消耗额度生成已有内容。';
            const resume = document.createElement('button');
            resume.type = 'button';
            resume.className = 'desktop-primary-action';
            resume.dataset.workflowGuidedResume = '';
            resume.textContent = '恢复此流程';
            resume.disabled = workflowState.generating;
            resume.addEventListener('click', () => resumeGuidedWorkflowRun().catch((error) => setWorkflowStatus(`恢复失败：${error.message || error}`, 'error')));
            container.append(resumeNote, resume);
        }
        if (workflowState.reasoning && workflowState.reasoning.hasReasoning) {
            const showReasoning = document.createElement('button');
            showReasoning.type = 'button';
            showReasoning.className = 'desktop-mini-action';
            showReasoning.dataset.workflowReasoningShow = '';
            showReasoning.textContent = '查看本次思考';
            showReasoning.addEventListener('click', () => {
                workflowState.reasoning.visible = true;
                workflowState.reasoning.dismissed = false;
                renderWorkflowReasoningBubble();
            });
            container.appendChild(showReasoning);
        }
        if (active && step.id !== 'transfer' && ['ready', 'failed'].includes(step.status)) {
            const generate = document.createElement('button');
            generate.type = 'button';
            generate.className = 'desktop-primary-action';
            generate.dataset.workflowGuidedGenerate = '';
            generate.textContent = step.id === 'review' ? '开始自动审查' : `开始生成：${step.title}`;
            generate.disabled = workflowState.generating;
            generate.addEventListener('click', () => generateGuidedWorkflowNode().catch((error) => setWorkflowStatus(`生成失败：${error.message || error}`, 'error')));
            container.appendChild(generate);
        }
        if (active && step.status === 'waiting_user') {
            const approve = document.createElement('button');
            approve.type = 'button';
            approve.className = 'desktop-primary-action';
            approve.dataset.workflowGuidedApprove = '';
            approve.textContent = '确认结果并继续';
            approve.disabled = workflowState.generating;
            approve.addEventListener('click', () => approveGuidedWorkflowNode().catch((error) => setWorkflowStatus(`确认失败：${error.message || error}`, 'error')));
            container.appendChild(approve);
        }
        renderCreationBatchDecisionActions(container, run, step);
        if ((step && step.id === 'transfer') || (transferStep && transferStep.status === 'completed')) {
            const creationReviewBlocked = window.creationQualityGateBlocked(run);
            const writer = document.createElement('button');
            writer.type = 'button';
            writer.className = 'desktop-primary-action';
            writer.dataset.workflowGuidedTransferWriter = '';
            writer.textContent = isRewriteWorkflow(run) ? '更新勾选的原场景' : isCreationWorkflow(run) && step && step.id === 'transfer' ? '结束并回流正文' : '预览并转到写作区';
            writer.disabled = workflowState.generating || creationReviewBlocked; if (creationReviewBlocked) writer.title = '存在未修复的阻断问题，重新审查通过后才能回流正文';
            writer.addEventListener('click', () => (isRewriteWorkflow(run) ? transferGuidedRewrite() : transferGuidedDrafts()).catch((error) => setWorkflowStatus(`转写失败：${error.message || error}`, 'error')));
            const compendium = document.createElement('button');
            compendium.type = 'button';
            compendium.className = 'desktop-secondary-action';
            compendium.dataset.workflowGuidedTransferCompendium = '';
            compendium.textContent = '确认并写入资料库';
            compendium.disabled = workflowState.generating;
            compendium.addEventListener('click', () => window.transferGuidedCompendiumSuggestions().catch((error) => setWorkflowStatus(`资料回流失败：${error.message || error}`, 'error')));
            container.appendChild(writer);
            if (!isRewriteWorkflow(run)) {
                container.appendChild(compendium);
                const transferNote = document.createElement('p');
                transferNote.className = 'desktop-workflow-context-note';
                transferNote.textContent = '正文与资料卡需要分别确认；流程完成后，尚未应用的另一项仍可继续回流。';
                container.appendChild(transferNote);
            }
            const variant = document.createElement('button');
            variant.type = 'button'; variant.className = 'desktop-secondary-action'; variant.dataset.workflowGenerateVariant = '';
            variant.textContent = '生成并比较替代版本'; variant.disabled = workflowState.generating;
            variant.addEventListener('click', () => generateAlternativeWorkflowVariant().catch((error) => setWorkflowStatus(`版本生成失败：${error.message || error}`, 'error')));
            container.appendChild(variant);
        }
        renderGuidedWorkflowRecoveryActions(container, run, step);
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
        label.textContent = '完整内容与版本';
        const list = document.createElement('div');
        list.className = 'desktop-workflow-artifact-list';
        (run.artifacts || []).forEach((artifact) => {
            const artifactVersions = (run.artifacts || []).filter((candidate) => candidate.nodeId === artifact.nodeId);
            const versionNumber = artifactVersions.findIndex((candidate) => candidate.id === artifact.id) + 1;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'desktop-workflow-artifact-tab';
            button.classList.toggle('is-active', artifact.id === workflowState.selectedArtifactId);
            button.textContent = `${artifact.title} · 第 ${versionNumber} 版 · ${window.workflowReviewStateLabel(artifact.revision.reviewState)}${artifact.effectiveFreshness === 'stale' ? ' · 已过期' : ''}`;
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
        const selectedVersions = (run.artifacts || []).filter((artifact) => artifact.nodeId === selected.nodeId);
        const selectedVersionNumber = selectedVersions.findIndex((artifact) => artifact.id === selected.id) + 1;
        meta.innerHTML = `<strong>${selected.title}</strong><span>第 ${selectedVersionNumber} 版 · ${window.workflowReviewStateLabel(selected.revision.reviewState)}${selected.effectiveFreshness === 'stale' ? ' · 已过期，需重新生成' : ''}${provider.model ? ` · ${provider.model}` : ''}</span>`;
        const textarea = document.createElement('textarea');
        textarea.dataset.workflowArtifactEditor = '';
        textarea.value = typeof selected.content === 'string' ? selected.content : JSON.stringify(selected.content, null, 2);
        const activeStep = activeWorkflowStep(run);
        const isGlobalInstructions = selected.artifactType === 'workflow-writing-instructions@1';
        const editable = !!(
            (activeStep && activeStep.id === selected.nodeId && activeStep.status === 'waiting_user')
            || (isGlobalInstructions && run.status === 'in_progress')
        );
        textarea.readOnly = !editable;
        editor.appendChild(meta);
        const viewSwitch = document.createElement('div');
        viewSwitch.className = 'desktop-workflow-view-switch';
        viewSwitch.setAttribute('role', 'group');
        viewSwitch.setAttribute('aria-label', '产物查看方式');
        const readable = document.createElement('div');
        readable.dataset.workflowArtifactReadable = '';
        const renderedPreview = window.renderGuidedArtifactPreview(readable, selected.content);
        if (!renderedPreview) {
            const text = document.createElement('div');
            text.className = 'desktop-workflow-readable-text';
            text.textContent = typeof selected.content === 'string' ? selected.content : JSON.stringify(selected.content, null, 2);
            readable.appendChild(text);
        }
        const form = document.createElement('div');
        form.dataset.workflowArtifactForm = '';
        form.className = 'desktop-workflow-artifact-form';
        window.renderWorkflowArtifactForm(form, selected.content);
        const advancedLabel = document.createElement('p');
        advancedLabel.className = 'desktop-workflow-advanced-label';
        advancedLabel.textContent = editable ? '高级编辑（JSON）— 修改后保存为新版本' : '高级内容（只读）';
        const views = [
            ['readable', '可读视图', readable],
            ['form', '表单视图', form],
            ['json', typeof selected.content === 'string' ? '原始文本' : '原始 JSON', textarea]
        ];
        const setArtifactView = (mode) => {
            workflowState.artifactViewMode = mode;
            views.forEach(([id, , panel]) => { panel.hidden = id !== mode; });
            advancedLabel.hidden = mode !== 'json';
            Array.from(viewSwitch.children).forEach((button) => button.classList.toggle('is-active', button.dataset.artifactView === mode));
        };
        views.forEach(([id, title]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.artifactView = id;
            button.textContent = title;
            button.addEventListener('click', () => setArtifactView(id));
            viewSwitch.appendChild(button);
        });
        editor.append(viewSwitch, readable, form, advancedLabel, textarea);
        setArtifactView(workflowState.artifactViewMode || 'readable');
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
            window.appendWorkflowArtifactRewriteControls(editor, {
                artifact: selected,
                currentContent: () => textarea.value,
                isGlobalInstructions
            });
            const save = document.createElement('button');
            save.type = 'button';
            save.className = 'desktop-secondary-action';
            save.dataset.workflowArtifactSave = '';
            save.textContent = '保存修改为新版本';
            save.addEventListener('click', () => saveGuidedArtifact(selected, textarea.value).catch((error) => setWorkflowStatus(`保存失败：${error.message || error}`, 'error')));
            editor.appendChild(save);
        }
        window.appendWorkflowArtifactHistoryControl(editor, selected);
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
        const sourceScenes = scope === 'project' ? (nativeEditorState.snapshot.scenes || [])
            : scope === 'chapter' ? (nativeEditorState.snapshot.scenes || []).filter((scene) => scene.chapterId === activeScene.chapterId)
                : [activeScene];
        const sceneContents = nativeEditorState.snapshot.sceneContents || {};
        if (!sourceScenes.some((scene) => String(
            scene && sceneContents[scene.id] !== undefined ? sceneContents[scene.id] : scene && scene.content || ''
        ).trim())) {
            throw new Error('续写范围内没有正文，请先在写作页填写正文，或选择包含正文的场景/章节');
        }
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
                    constraints: workflowLockConstraints(elements),
                    writingInstructions: typeof window.workflowWritingInstructionsPayload === 'function'
                        ? window.workflowWritingInstructionsPayload(elements)
                        : undefined,
                    generationPolicy: workflowGenerationLaunchConfig()
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
        try {
            const projectId = currentProjectId();
            const run = selectedWorkflowRun();
            const drafts = (run.artifacts || []).filter((artifact) => artifact.nodeId === 'draft' && artifact.revision.reviewState === 'approved');
            if (!drafts.length) throw new Error('没有已批准的正文产物');

            // Creation: open editable chapter assembly panel (F-09.6I).
            if (isCreationWorkflow(run) && typeof window.openWorkflowChapterAssembly === 'function') {
                setWorkflowStatus('正在打开章节装配预览…', 'info');
                await window.openWorkflowChapterAssembly(projectId, run);
                setWorkflowStatus('请在章节装配中调整章名/顺序后确认转入写作区。', 'info');
                return;
            }

            // Non-creation templates: single chapter fallback without batch names.
            const chapterId = `workflow-${run.id}`;
            const scenes = drafts.map((artifact) => ({
                sceneId: artifact.targetRef?.sceneId || artifact.id,
                targetSceneId: artifact.targetRef?.sceneId || artifact.id,
                chapterId,
                chapterTitle: window.cleanChapterTitleForTransfer(run.title || '正文', artifact.title),
                title: artifact.title,
                summary: artifact.revision.summary,
                source: { runId: run.id, artifactId: artifact.id, revisionId: artifact.revision.id }
            }));
            if (!scenes.length) throw new Error('章节装配结果为空');

            const previewResponse = await fetch('/api/workflows/v2/preview-writer-transfer', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, scenes })
            });
            const preview = await previewResponse.json().catch(() => ({}));
            if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
            if (!window.confirm(`将 ${preview.counts.scenes} 个场景转入写作区，是否继续？`)) return;
            const applicationId = (typeof window.workflowStableApplicationId === 'function'
                ? window.workflowStableApplicationId
                : (typeof workflowStableApplicationId === 'function' ? workflowStableApplicationId : null));
            if (!applicationId) throw new Error('workflowStableApplicationId is unavailable');
            const response = await fetch('/api/workflows/v2/apply-writer-transfer', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    runId: run.id,
                    applicationId: applicationId(
                        `guided-writer-${run.id}`,
                        drafts.map((artifact) => artifact.revision.id)
                    ),
                    scenes
                })
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
            setWorkflowStatus('正文已转入写作区；资料卡需要点击“确认并写入资料库”另行确认。', 'ok');
        } catch (error) {
            window.__lastTransferError = String(error && error.message || error);
            throw error;
        }
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
        [elements.workflowModel, elements.briefWorkflowModel].filter(Boolean).forEach((select) => select.addEventListener('change', () => {
            workflowState.workflowModel = select.value || 'inherit';
            window.renderWorkflowModelControl?.();
            renderWorkflow();
        }));
        [elements.thinking, elements.briefThinking].filter(Boolean).forEach((toggle) => toggle.addEventListener('change', () => {
            workflowState.workflowThinking = !!toggle.checked;
            window.renderWorkflowModelControl?.();
            renderWorkflow();
        }));
        if (elements.creationComplete) elements.creationComplete.addEventListener('click', () => {
            const draft = creationBriefFromInputs(elements);
            const fields = creationBriefFields.map(([key]) => key).filter((key) => {
                const value = draft[key];
                return key !== 'premise' && (!value || (Array.isArray(value) && !value.length));
            });
            if (!fields.length) {
                setCreationBriefStatus('所有字段都已有内容；请勾选要重写的字段。', 'info');
                workflowState.creationBrief = draft;
                workflowState.creationBriefOpen = true;
                renderCreationBrief();
                return;
            }
            generateCreationBrief(fields).catch((error) => setCreationBriefStatus(`补全失败：${error.message || error}`, 'error'));
        });
        if (elements.creationRewrite) elements.creationRewrite.addEventListener('click', () => {
            const fields = Array.from(document.querySelectorAll('[data-workflow-creation-brief-field]:checked')).map((item) => item.dataset.workflowCreationBriefField).filter(Boolean);
            if (!fields.length) { setCreationBriefStatus('请先勾选一个或多个要重写的字段。', 'error'); return; }
            const instruction = [
                '保持未选择字段不变；让所选字段与整体故事设定一致、具体且可执行。',
                elements.creationRewriteInstruction?.value.trim() || ''
            ].filter(Boolean).join(' ');
            generateCreationBrief(fields, instruction).catch((error) => setCreationBriefStatus(`重写失败：${error.message || error}`, 'error'));
        });
        if (elements.creationApply) elements.creationApply.addEventListener('click', () => {
            syncCreationBriefToInputs();
            workflowState.creationBriefOpen = false;
            renderCreationBrief();
            renderWorkflow();
            setCreationBriefStatus('Brief 已确认，可开始从零创作。', 'ok');
        });
        if (elements.creationEdit) elements.creationEdit.addEventListener('click', () => {
            workflowState.creationBriefOpen = true;
            renderCreationBrief();
        });
        if (elements.creationBriefClose) elements.creationBriefClose.addEventListener('click', () => {
            workflowState.creationBriefOpen = false;
            renderCreationBrief();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !workflowState.creationBriefOpen) return;
            workflowState.creationBriefOpen = false;
            renderCreationBrief();
        });
        if (elements.start) elements.start.addEventListener('click', () => startGuidedWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.startCreation) elements.startCreation.addEventListener('click', () => startCreationWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.startRewrite) elements.startRewrite.addEventListener('click', () => startRewriteWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.legacyStart) elements.legacyStart.addEventListener('click', () => startWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        if (elements.reasoningClose) elements.reasoningClose.addEventListener('click', () => {
            workflowState.reasoning.dismissed = true;
            renderWorkflowReasoningBubble();
        });
        if (typeof window.bindWorkflowStreamStage === 'function') window.bindWorkflowStreamStage();
        renderWorkflowLaunchMode();
        renderWorkflow();
    }
