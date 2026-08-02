    window.applyWorkflowFindingLockAction = async function applyWorkflowFindingLockAction(run, finding, index, action) {
        if (!run || !run.id) throw new Error('请先选择工作流运行');
        const projectId = typeof currentProjectId === 'function' ? currentProjectId() : '';
        if (!projectId) throw new Error('请先打开项目');
        const labels = {
            harden: '升为硬锁',
            soften: '降为软锁',
            disable: '关闭此项',
            exempt: '豁免本条'
        };
        setWorkflowStatus(`正在${labels[action] || '调整锁'}...`, 'info');
        const response = await fetch('/api/workflows/v2/update-run-locks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                runId: run.id,
                findingActions: [{
                    action,
                    index,
                    type: finding && finding.type,
                    constraintId: finding && finding.constraintId,
                    sceneId: finding && finding.sceneId,
                    metricId: finding && finding.metricId
                }]
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.run) {
            workflowState.runs = (workflowState.runs || []).map((item) => item.id === run.id ? result.run : item);
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
            if (workflowState.selectedArtifactId) {
                const review = (result.run.artifacts || []).filter((artifact) => artifact.nodeId === 'review').slice(-1)[0];
                if (review) workflowState.selectedArtifactId = review.id;
            }
            if (typeof window.renderWorkflowLockBoards === 'function') {
                window.renderWorkflowLockBoards({ forceHydrate: true });
            }
        } else if (typeof loadGuidedWorkflowRun === 'function') {
            await loadGuidedWorkflowRun(run.id);
        } else if (typeof loadWorkflowRuns === 'function') {
            await loadWorkflowRuns();
        }
        if (typeof renderWorkflow === 'function') renderWorkflow();
        const gate = result.qualityGate === 'blocked'
            ? `仍有 ${result.blockingFindingCount || 0} 项阻断问题`
            : '质量门禁已通过';
        setWorkflowStatus(`${labels[action] || '调锁'}已生效，影响后续生成/重写/审查。${gate}`, 'ok');
        return result;
    };

    window.setWorkflowGenerationProgress = function setWorkflowGenerationProgress(patch = {}) {
        workflowState.generationProgressDetail = {
            ...(workflowState.generationProgressDetail || {}),
            ...patch
        };
        const panel = document.querySelector('[data-workflow-step-progress]');
        if (!panel) return;
        const progress = workflowState.generationProgressDetail;
        const elapsed = progress.startedAt ? Math.max(0, Math.round((Date.now() - progress.startedAt) / 1000)) : 0;
        const usageLabel = progress.usageHint && progress.usageHint.label
            ? String(progress.usageHint.label)
            : '';
        // Never display a bare "0" as if it were real provider usage.
        const safeUsage = usageLabel && !/^输入\s*0\s*tokens/.test(usageLabel) ? usageLabel : '';
        panel.textContent = [
            progress.phase || '等待操作',
            progress.detail,
            progress.total ? `${progress.current || 0}/${progress.total}` : '',
            progress.characters ? `${progress.characters} 字符` : '',
            progress.cumulativeCharacters ? `累计 ${progress.cumulativeCharacters} 字符` : '',
            safeUsage,
            elapsed ? `${elapsed} 秒` : ''
        ].filter(Boolean).join(' · ');
        panel.dataset.phase = progress.phase || 'idle';
        if (safeUsage) panel.dataset.usageSource = progress.usageHint.source || '';
        else delete panel.dataset.usageSource;
    };

    window.workflowUsageHintFromMeta = function workflowUsageHintFromMeta(metaUsage = {}, fallback = null) {
        const inputTokens = Number(metaUsage.prompt_tokens != null ? metaUsage.prompt_tokens : metaUsage.input_tokens != null ? metaUsage.input_tokens : metaUsage.inputTokens);
        const outputTokens = Number(metaUsage.completion_tokens != null ? metaUsage.completion_tokens : metaUsage.output_tokens != null ? metaUsage.output_tokens : metaUsage.outputTokens);
        if (Number.isFinite(inputTokens) && inputTokens > 0) {
            return {
                source: 'provider',
                inputTokens,
                outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
                estimatedInputTokens: null,
                label: `输入 ${Math.round(inputTokens)} tokens（接口回传）`
            };
        }
        if (fallback && fallback.label) return fallback;
        return {
            source: 'unavailable',
            inputTokens: null,
            outputTokens: null,
            estimatedInputTokens: null,
            label: '输入 tokens 不可用'
        };
    };

    window.renderWorkflowArtifactForm = function renderWorkflowArtifactForm(container, content, depth = 0) {
        if (depth > 4 || content === null || content === undefined || typeof content !== 'object') {
            const value = document.createElement('p');
            value.textContent = String(content === undefined || content === null ? '' : content);
            container.appendChild(value);
            return;
        }
        const entries = Array.isArray(content)
            ? content.map((value, index) => [`第 ${index + 1} 项`, value])
            : Object.entries(content);
        entries.forEach(([key, value]) => {
            const row = document.createElement('section');
            row.className = 'desktop-workflow-artifact-form-row';
            const label = document.createElement('strong');
            label.textContent = key;
            row.appendChild(label);
            if (value && typeof value === 'object') {
                const child = document.createElement('div');
                window.renderWorkflowArtifactForm(child, value, depth + 1);
                row.appendChild(child);
            } else {
                const text = document.createElement('p');
                text.textContent = String(value === undefined || value === null ? '' : value);
                row.appendChild(text);
            }
            container.appendChild(row);
        });
    };

    window.appendWorkflowArtifactRewriteControls = function appendWorkflowArtifactRewriteControls(editor, options = {}) {
        const { artifact, currentContent, isGlobalInstructions } = options;
        const rewrite = document.createElement('section');
        rewrite.className = 'desktop-workflow-artifact-rewrite';
        const rewriteLabel = document.createElement('strong');
        rewriteLabel.textContent = isGlobalInstructions ? '修改写作指令（默认从下一批生效）' : '让 AI 按意见重写当前结果';
        const feedback = document.createElement('textarea');
        feedback.rows = 3;
        feedback.dataset.workflowArtifactFeedback = '';
        feedback.placeholder = isGlobalInstructions
            ? '例如：下一批减少旁白解释，让人物更多通过行动表达意图。'
            : '描述要保留什么、修改什么；AI 会生成新版本，确认前不会进入下一步。';
        const scope = document.createElement('select');
        scope.dataset.workflowArtifactRewriteScope = '';
        [['all', '重写整个产物'], ['selected', '只改意见中点名的字段或场景']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            scope.appendChild(option);
        });
        const aiControls = document.createElement('div');
        aiControls.className = 'desktop-workflow-ai-controls';
        const modelLabel = document.createElement('label');
        const modelTitle = document.createElement('span');
        modelTitle.textContent = '重写模型';
        const model = document.createElement('select');
        model.dataset.workflowArtifactRewriteModel = '';
        const sourceModel = document.querySelector('[data-workflow-model]');
        Array.from(sourceModel && sourceModel.options || []).forEach((source) => {
            const option = document.createElement('option');
            option.value = source.value;
            option.textContent = source.textContent;
            model.appendChild(option);
        });
        if (!model.options.length) {
            const option = document.createElement('option');
            option.value = 'inherit';
            option.textContent = '使用本流程冻结模型';
            model.appendChild(option);
        }
        model.value = Array.from(model.options).some((option) => option.value === workflowState.artifactRewriteModel)
            ? workflowState.artifactRewriteModel : 'inherit';
        model.addEventListener('change', () => { workflowState.artifactRewriteModel = model.value; });
        modelLabel.append(modelTitle, model);
        const thinkingLabel = document.createElement('label');
        thinkingLabel.className = 'desktop-workflow-toggle';
        const thinking = document.createElement('input');
        thinking.type = 'checkbox';
        thinking.checked = workflowState.artifactRewriteThinking !== false;
        thinking.dataset.workflowArtifactRewriteThinking = '';
        thinking.addEventListener('change', () => { workflowState.artifactRewriteThinking = thinking.checked; });
        thinkingLabel.append(thinking, document.createTextNode('深度思考'));
        aiControls.append(modelLabel, thinkingLabel);
        const rewriteButton = document.createElement('button');
        rewriteButton.type = 'button';
        rewriteButton.className = 'desktop-secondary-action';
        rewriteButton.dataset.workflowArtifactAiRewrite = '';
        rewriteButton.textContent = 'AI 按意见生成新版本';
        rewriteButton.disabled = workflowState.artifactRewriteBusy;
        rewriteButton.addEventListener('click', () => window.rewriteGuidedArtifactWithAi(
            artifact,
            currentContent(),
            feedback.value,
            scope.value,
            model.value,
            thinking.checked
        ).catch((error) => setWorkflowStatus(`AI 重写失败：${error.message || error}`, 'error')));
        rewrite.append(rewriteLabel, scope, feedback, aiControls, rewriteButton);
        if (isGlobalInstructions) {
            const applyCurrent = document.createElement('button');
            applyCurrent.type = 'button';
            applyCurrent.className = 'desktop-mini-action';
            applyCurrent.dataset.workflowApplyInstructionsCurrent = '';
            applyCurrent.textContent = '让最新指令作用于当前批次';
            applyCurrent.title = '若本批已有计划或正文，会保留旧版本并将其标为过期，然后从本批计划重新生成';
            applyCurrent.addEventListener('click', () => window.applyWritingInstructionsToCurrentBatch()
                .catch((error) => setWorkflowStatus(`应用失败：${error.message || error}`, 'error')));
            rewrite.appendChild(applyCurrent);
        }
        editor.appendChild(rewrite);
    };

    window.applyWritingInstructionsToCurrentBatch = async function applyWritingInstructionsToCurrentBatch() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run || run.templateId !== 'creation-guided') return;
        if (!window.confirm('最新写作指令默认只影响下一批。若改为作用于当前批次，已有计划、正文和审查会保留在历史中并标为过期，然后从本批计划重新生成。是否继续？')) return;
        const response = await fetch('/api/workflows/v2/apply-creation-writing-instructions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                runId: run.id,
                acknowledgeInvalidation: true
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item);
        workflowState.selectedArtifactId = '';
        await loadWorkflowEvents();
        window.renderWorkflow();
        setWorkflowStatus('最新写作指令已绑定当前批次；如已有内容，已返回本批计划并保留旧版本。', 'ok');
    };

    window.appendWorkflowArtifactHistoryControl = function appendWorkflowArtifactHistoryControl(editor, artifact) {
        const history = document.createElement('section');
        history.className = 'desktop-workflow-artifact-history';
        const historyButton = document.createElement('button');
        historyButton.type = 'button';
        historyButton.className = 'desktop-mini-action';
        historyButton.dataset.workflowArtifactHistory = '';
        historyButton.textContent = '查看历史版本';
        const historyContent = document.createElement('div');
        historyContent.hidden = true;
        historyButton.addEventListener('click', () => window.loadGuidedArtifactHistory(artifact, historyContent)
            .catch((error) => setWorkflowStatus(`历史读取失败：${error.message || error}`, 'error')));
        history.append(historyButton, historyContent);
        editor.appendChild(history);
    };

    window.loadGuidedArtifactHistory = async function loadGuidedArtifactHistory(artifact, container) {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run || !artifact) return;
        const response = await fetch(`/api/workflows/v2/artifact-history?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(run.id)}&artifactId=${encodeURIComponent(artifact.id)}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        container.replaceChildren();
        container.hidden = false;
        const heading = document.createElement('p');
        heading.textContent = `共 ${result.revisions.length} 个不可变 Revision。恢复旧版会另存为最新 Revision，不会删除任何版本。`;
        container.appendChild(heading);
        if (result.revisions.length > 1) {
            const compare = document.createElement('div');
            compare.className = 'desktop-workflow-history-compare';
            const left = document.createElement('select');
            const right = document.createElement('select');
            result.revisions.forEach((entry, index) => {
                [left, right].forEach((select) => {
                    const option = document.createElement('option');
                    option.value = String(index);
                    option.textContent = `第 ${index + 1} 版 · ${entry.revision.summary || '未命名修改'}`;
                    select.appendChild(option);
                });
            });
            left.value = String(Math.max(0, result.revisions.length - 2));
            right.value = String(result.revisions.length - 1);
            const compareButton = document.createElement('button');
            compareButton.type = 'button';
            compareButton.className = 'desktop-mini-action';
            compareButton.textContent = '并排比较';
            const comparison = document.createElement('div');
            comparison.className = 'desktop-workflow-history-comparison';
            comparison.hidden = true;
            compareButton.addEventListener('click', () => {
                comparison.replaceChildren();
                [left, right].forEach((select) => {
                    const entry = result.revisions[Number(select.value)];
                    const pre = document.createElement('pre');
                    pre.textContent = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2);
                    comparison.appendChild(pre);
                });
                comparison.hidden = false;
            });
            compare.append(left, right, compareButton, comparison);
            container.appendChild(compare);
        }
        result.revisions.slice().reverse().forEach((entry, reverseIndex) => {
            const chronologicalIndex = result.revisions.length - reverseIndex;
            const card = document.createElement('details');
            card.className = 'desktop-workflow-artifact-history-item';
            const summary = document.createElement('summary');
            const createdAt = entry.revision.createdAt ? new Date(entry.revision.createdAt).toLocaleString() : '';
            summary.textContent = `第 ${chronologicalIndex} 版 · ${entry.revision.summary || '未命名修改'}${createdAt ? ` · ${createdAt}` : ''}`;
            const preview = document.createElement('pre');
            preview.textContent = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2);
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'desktop-secondary-action';
            restore.textContent = chronologicalIndex === result.revisions.length ? '当前版本' : '恢复为新的后续基线';
            const activeStep = activeWorkflowStep(run);
            const canRestore = artifact.artifactType === 'workflow-writing-instructions@1'
                || !!(activeStep && activeStep.id === artifact.nodeId && activeStep.status === 'waiting_user');
            restore.disabled = chronologicalIndex === result.revisions.length || !canRestore;
            restore.addEventListener('click', () => window.saveGuidedArtifact(
                artifact,
                typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2)
            ).catch((error) => setWorkflowStatus(`恢复失败：${error.message || error}`, 'error')));
            card.append(summary, preview, restore);
            container.appendChild(card);
        });
    };

    window.rewriteGuidedArtifactWithAi = async function rewriteGuidedArtifactWithAi(
        artifact,
        currentContent,
        feedback,
        rewriteScope,
        selectedModel,
        enableThinking
    ) {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const instruction = String(feedback || '').trim();
        if (!projectId || !run || !artifact) return;
        if (!instruction) throw new Error('请先填写修改意见');
        if (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function') {
            throw new Error('生成服务尚未加载');
        }
        workflowState.artifactRewriteBusy = true;
        window.renderWorkflow();
        const stageConfig = guidedStageProviderConfig(artifact.nodeId, run);
        const config = {
            ...stageConfig,
            ...(selectedModel && selectedModel !== 'inherit' ? { model: selectedModel } : {}),
            enableThinking: enableThinking !== false,
            includeUsage: true
        };
        beginWorkflowReasoning(config, `重写：${artifact.title}`);
        beginWorkflowReasoningBatch(artifact.title, 0, 1);
        setWorkflowStatus(`AI 正在按意见重写：${artifact.title}`, 'info');
        let output = '';
        try {
            const jsonOutput = artifact.revision && artifact.revision.payload && artifact.revision.payload.format === 'json';
            const prompt = {
                messages: [
                    {
                        role: 'system',
                        content: jsonOutput
                            ? '你是小说工作流编辑。严格按用户意见修改当前产物，保留未要求改变的信息与原有字段结构。只返回一个完整合法的 JSON 对象，不要解释，不要 Markdown。'
                            : '你是小说工作流编辑。严格按用户意见修改当前文本，保留未要求改变的信息。只返回修改后的完整文本，不要解释，不要标题。'
                    },
                    {
                        role: 'user',
                        content: `产物：${artifact.title}\n修改范围：${rewriteScope === 'selected' ? '只修改意见中明确点名的字段或场景，其他部分逐字保持' : '允许重写整个产物，但仍保留未要求改变的事实'}\n修改意见：${instruction}\n\n当前内容：\n${currentContent}`
                    }
                ]
            };
            await window.DraftHarborProviderStream.streamGeneration(prompt, (token, meta) => {
                if (meta && meta.type === 'reasoning') appendWorkflowReasoning(token);
                else if (!meta || meta.type === 'content') {
                    markWorkflowAnswerStarted();
                    output += token;
                }
            }, config);
            if (!String(output).trim()) throw new Error('AI 没有返回修改结果');
            if (jsonOutput) window.parseGuidedJsonOutput(output);
            await window.saveGuidedArtifact(artifact, output);
            finishWorkflowReasoning(true, '新版本已保存，确认前不会进入下一步。');
            setWorkflowStatus(
                artifact.artifactType === 'workflow-writing-instructions@1'
                    ? '写作指令新版本已保存，将从下一批开始生效。'
                    : 'AI 修改已保存为新版本，请检查后再确认进入下一步。',
                'ok'
            );
        } catch (error) {
            finishWorkflowReasoning(false, `AI 重写失败：${error.message || error}`);
            throw error;
        } finally {
            workflowState.artifactRewriteBusy = false;
            window.renderWorkflow();
        }
    };
