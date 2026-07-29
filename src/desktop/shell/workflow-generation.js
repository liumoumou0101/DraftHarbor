    function commaSeparatedValues(value) {
        return String(value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    }

    const creationBriefFields = Object.freeze([
        ['workingTitle', '暂定书名', 'input'], ['premise', '核心前提', 'textarea'], ['genre', '题材', 'input'],
        ['targetLength', '目标字数', 'number'], ['themes', '主题', 'textarea'], ['tone', '基调', 'input'],
        ['pov', '视角', 'input'], ['setting', '世界 / 时空设定', 'textarea'], ['endingPreference', '结局倾向', 'input'],
        ['mustInclude', '必须包含', 'textarea'], ['avoid', '避免项', 'textarea'], ['notes', '补充备注', 'textarea']
    ]);

    function creationBriefFromInputs(elements = workflowElements()) {
        return {
            workingTitle: elements.creationTitle?.value.trim() || '',
            premise: elements.creationInspiration?.value.trim() || elements.creationPremise?.value.trim() || '',
            genre: elements.creationGenre?.value.trim() || '',
            targetLength: Number(elements.creationTargetLength?.value) || 0,
            themes: commaSeparatedValues(elements.creationThemes?.value),
            tone: elements.creationTone?.value.trim() || '',
            pov: elements.creationPov?.value.trim() || '',
            setting: elements.creationSetting?.value.trim() || '',
            endingPreference: '', mustInclude: [], avoid: [], notes: ''
        };
    }

    function normalizeCreationBriefDraft(input = {}) {
        const clean = (value) => String(value === undefined || value === null ? '' : value).trim();
        const lines = (value) => Array.isArray(value) ? value.map(clean).filter(Boolean) : String(value || '').split(/[\n，,]/).map(clean).filter(Boolean);
        return {
            workingTitle: clean(input.workingTitle || input.title), premise: clean(input.premise || input.coreIdea || input.inspiration),
            genre: clean(input.genre), targetLength: Math.max(0, Number(input.targetLength || input.targetWords) || 0),
            themes: lines(input.themes), tone: clean(input.tone), pov: clean(input.pov || input.pointOfView), setting: clean(input.setting),
            endingPreference: clean(input.endingPreference), mustInclude: lines(input.mustInclude), avoid: lines(input.avoid), notes: clean(input.notes)
        };
    }

    function creationBriefValueForEditor(brief, key) {
        const value = brief[key];
        return Array.isArray(value) ? value.join('，') : String(value === undefined || value === null ? '' : value);
    }

    function setCreationBriefStatus(message, tone = 'info') {
        const elements = workflowElements();
        [elements.creationBriefStatus, elements.creationEditorStatus].filter(Boolean).forEach((status) => {
            status.textContent = message || '';
            status.dataset.tone = tone;
        });
    }

    function renderCreationBrief() {
        const elements = workflowElements();
        const brief = workflowState.creationBrief;
        if (elements.creationBrief) elements.creationBrief.hidden = !brief || !workflowState.creationBriefOpen;
        if (elements.creationComplete) elements.creationComplete.disabled = workflowState.creationBriefGenerating;
        if (elements.creationEdit) elements.creationEdit.hidden = !brief;
        if (elements.creationRewrite) elements.creationRewrite.disabled = !brief || workflowState.creationBriefGenerating;
        if (elements.creationApply) elements.creationApply.disabled = !brief || workflowState.creationBriefGenerating;
        if (!brief || !elements.creationBriefFields) return;
        elements.creationBriefFields.replaceChildren();
        creationBriefFields.forEach(([key, label, kind]) => {
            const row = document.createElement('label');
            row.className = 'desktop-workflow-creation-brief-field';
            const select = document.createElement('input'); select.type = 'checkbox'; select.dataset.workflowCreationBriefField = key; select.setAttribute('aria-label', `选择重写${label}`);
            const title = document.createElement('span'); title.textContent = label;
            const editor = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
            if (kind === 'number') { editor.type = 'number'; editor.min = '0'; editor.step = '1000'; }
            if (kind === 'textarea') editor.rows = key === 'premise' ? 4 : 2;
            editor.value = creationBriefValueForEditor(brief, key);
            editor.dataset.workflowCreationBriefEditor = key;
            editor.addEventListener('input', () => {
                const next = { ...workflowState.creationBrief };
                next[key] = ['themes', 'mustInclude', 'avoid'].includes(key) ? commaSeparatedValues(editor.value) : (key === 'targetLength' ? Number(editor.value) || 0 : editor.value.trim());
                workflowState.creationBrief = normalizeCreationBriefDraft(next);
            });
            row.append(select, title, editor);
            elements.creationBriefFields.appendChild(row);
        });
    }

    function creationBriefPrompt(brief, fields, instruction) {
        return {
            messages: [
                { role: 'system', content: '你是长篇小说策划编辑。只输出合法 JSON 对象，不要 Markdown。允许字段：workingTitle,premise,genre,targetLength,themes,tone,pov,setting,endingPreference,mustInclude,avoid,notes。targetLength 是正整数；themes、mustInclude、avoid 是字符串数组。' },
                { role: 'user', content: `创作灵感与当前 Brief：\n${JSON.stringify(brief, null, 2)}\n\n只生成或重写这些字段：${fields.join(', ')}。用户已有的其他字段必须保持不变。${instruction ? `\n额外要求：${instruction}` : ''}` }
            ],
            asString() { return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n'); }
        };
    }

    function parseCreationBriefOutput(text) {
        const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        const output = JSON.parse(cleaned);
        if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('AI 没有返回有效的 Brief 对象');
        return output;
    }

    async function generateCreationBrief(fields, instruction = '') {
        const elements = workflowElements();
        const source = workflowState.creationBrief || creationBriefFromInputs(elements);
        if (!source.premise) throw new Error('请先写下一点灵感、关键词或故事片段');
        if (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function') throw new Error('生成服务尚未加载');
        workflowState.creationBriefGenerating = true;
        renderCreationBrief();
        setCreationBriefStatus('AI 正在补全创作设定…');
        const stageConfig = guidedStageProviderConfig('brief');
        const taskLabel = workflowState.creationBrief ? '重写创作 Brief 字段' : '补全创作 Brief';
        beginWorkflowReasoning(stageConfig, taskLabel);
        beginWorkflowReasoningBatch(taskLabel, 0, 1);
        try {
            let text = '';
            await window.DraftHarborProviderStream.streamGeneration(creationBriefPrompt(source, fields, instruction), (token, meta) => {
                if (meta && meta.type === 'reasoning') appendWorkflowReasoning(token);
                else if (!meta || meta.type === 'content') {
                    markWorkflowAnswerStarted();
                    text += token;
                }
            }, { ...stageConfig, includeUsage: true });
            const rawPatch = parseCreationBriefOutput(text);
            const patch = normalizeCreationBriefDraft(rawPatch);
            const next = { ...source };
            fields.forEach((key) => { if (Object.prototype.hasOwnProperty.call(rawPatch, key)) next[key] = patch[key]; });
            workflowState.creationBrief = normalizeCreationBriefDraft(next);
            workflowState.creationBriefOpen = true;
            renderCreationBrief();
            setCreationBriefStatus(fields.length === creationBriefFields.length ? '设定已补全。可直接修改，或勾选字段后让 AI 重写。' : '所选字段已重写。可继续修改后开始创作。', 'ok');
            finishWorkflowReasoning(true, '创作 Brief 已生成。');
        } catch (error) {
            finishWorkflowReasoning(false, `Brief 生成失败：${error.message || error}`);
            throw error;
        } finally {
            workflowState.creationBriefGenerating = false;
            renderCreationBrief();
        }
    }

    function syncCreationBriefToInputs() {
        const elements = workflowElements();
        const brief = workflowState.creationBrief;
        if (!brief) return;
        if (elements.creationTitle) elements.creationTitle.value = brief.workingTitle;
        if (elements.creationInspiration) elements.creationInspiration.value = brief.premise;
        if (elements.creationPremise) elements.creationPremise.value = brief.premise;
        if (elements.creationGenre) elements.creationGenre.value = brief.genre;
        if (elements.creationTargetLength) elements.creationTargetLength.value = brief.targetLength || '';
        if (elements.creationThemes) elements.creationThemes.value = brief.themes.join('，');
        if (elements.creationTone) elements.creationTone.value = brief.tone;
        if (elements.creationPov) elements.creationPov.value = brief.pov;
        if (elements.creationSetting) elements.creationSetting.value = brief.setting;
    }

    async function startCreationWorkflowRun() {
        const projectId = currentProjectId();
        const elements = workflowElements();
        const confirmedBrief = workflowState.creationBrief ? normalizeCreationBriefDraft(workflowState.creationBrief) : null;
        const premise = confirmedBrief ? confirmedBrief.premise : '';
        if (!premise) throw new Error('请先填写核心创意或故事前提');
        workflowState.generating = true;
        setWorkflowStatus('正在创建从零创作引导...', 'info');
        renderWorkflow();
        try {
            const launch = workflowGenerationLaunchConfig();
            const endpoint = projectId ? '/api/workflows/v2/start-creation' : '/api/workflows/v2/create-project-and-start-creation';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...(projectId ? { projectId } : { project: { title: confirmedBrief.workingTitle, description: premise, status: '构思中' } }),
                    brief: {
                        ...confirmedBrief,
                        mustInclude: [...confirmedBrief.mustInclude, ...workflowLockConstraints(elements).filter((item) => item.kind === 'direction').map((item) => item.text)],
                        avoid: [...confirmedBrief.avoid, ...workflowLockConstraints(elements).filter((item) => item.kind === 'exclusion').map((item) => item.text)]
                    },
                    writingInstructions: {
                        text: elements.creationWritingInstructions?.value.trim() || '',
                        applicableStages: ['direction', 'blueprint', 'compendium', 'plan', 'draft', 'review']
                    },
                    fineOutlineEnabled: !elements.fineOutline || elements.fineOutline.checked,
                    constraints: workflowLockConstraints(elements),
                    generationPolicy: launch
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.selectedId = result.runId;
            workflowState.selectedDirectionIds = [];
            if (!projectId && result.projectId) {
                await loadProjectLibrary();
                const createdProject = (projectLibraryState.projects || []).find((item) => item.id === result.projectId);
                if (!createdProject) throw new Error('新项目已创建，但未能在书库中找到它');
                await openDesktopProject(createdProject);
            }
            await loadWorkflowRuns();
            setView('workflow');
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
                constraints: workflowLockConstraints(elements),
                generationPolicy: workflowGenerationLaunchConfig()
            }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.selectedId = result.runId; workflowState.selectedRewriteSceneIds = [];
            await loadWorkflowRuns(); setWorkflowStatus('原文已冻结，可以生成并编辑重写计划。', 'ok');
        } finally { workflowState.generating = false; renderWorkflow(); }
    }

    function parseGuidedJsonOutput(value) {
        const text = String(value || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI 没有返回 JSON 对象');
        return parsed;
    }
    window.parseGuidedJsonOutput = parseGuidedJsonOutput;

    function guidedJsonRepairPrompt(step, prompt, output, finishReason) {
        return {
            messages: [
                {
                    role: 'system',
                    content: '你是严格的 JSON 修复器。把用户提供的不完整或非法 JSON 重建为一个完整、合法的 JSON 对象。保留已有信息，补齐被截断的字符串、数组、对象和任务要求的必要字段。只返回修复后的完整 JSON，不要解释，不要 Markdown。'
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        task: prompt.title || step.title || step.id,
                        stopReason: finishReason || 'invalid_json',
                        invalidJson: String(output || '')
                    })
                }
            ]
        };
    }

    async function repairGuidedJsonOutput(step, prompt, output, finishReason, stageConfig, usage) {
        let repaired = '';
        let repairedFinishReason = '';
        setWorkflowStatus(`返回内容不完整，正在自动修复：${prompt.title || step.title}`, 'info');
        beginWorkflowReasoningBatch(`自动修复：${prompt.title || step.title}`, 0, 1);
        await window.DraftHarborProviderStream.streamGeneration(
            guidedJsonRepairPrompt(step, prompt, output, finishReason),
            (token, meta) => {
                if (meta && meta.type === 'usage') usage.push({ promptId: `${prompt.id}-repair`, model: stageConfig.model, ...meta.usage });
                else if (meta && meta.type === 'finish') repairedFinishReason = meta.finishReason || '';
                else if (meta && meta.type === 'reasoning') appendWorkflowReasoning(token);
                else if (!meta || meta.type === 'content') {
                    markWorkflowAnswerStarted();
                    repaired += token;
                }
            },
            { ...stageConfig, enableThinking: false, temperature: 0.1, includeUsage: true }
        );
        try {
            parseGuidedJsonOutput(repaired);
        } catch (error) {
            const failure = new Error(`AI 返回的 JSON 不完整，自动修复后仍无法解析：${error.message || error}`);
            failure.code = repairedFinishReason === 'length' ? 'json_repair_output_limit' : 'json_repair_failed';
            failure.generatedOutput = repaired;
            failure.finishReason = repairedFinishReason;
            throw failure;
        }
        return { text: repaired, finishReason: repairedFinishReason };
    }

    function combineGuidedOutputs(step, prepared, outputs) {
        if (step.id !== 'compendium' || outputs.length < 2) {
            return { outputs, outputTitles: (prepared.prompts || []).map((prompt) => prompt.title || '') };
        }
        const cards = outputs.flatMap((output) => {
            const parsed = parseGuidedJsonOutput(output);
            return Array.isArray(parsed.cards) ? parsed.cards : (Array.isArray(parsed.entries) ? parsed.entries : []);
        });
        return {
            outputs: [JSON.stringify({ cards })],
            outputTitles: [step.title || '人物与世界观资料草稿']
        };
    }

    async function generateGuidedWorkflowNode() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step || workflowState.generating) return;
        const endpoints = guidedWorkflowEndpoints(run);
        const outputs = [];
        const outputRecords = [];
        const usage = [];
        let repairAttempted = false;
        let completionStatus = '';
        workflowState.lastGenerationError = '';
        workflowState.generating = true;
        window.setWorkflowGenerationProgress({
            phase: '准备上下文',
            detail: step.title,
            current: 0,
            total: 0,
            characters: 0,
            cumulativeCharacters: run.generationProgress && run.generationProgress.completedCharacters || 0,
            startedAt: Date.now()
        });
        setWorkflowStatus(step.id === 'review' ? '正在执行自动审查...' : `正在生成：${step.title}`, 'info');
        renderWorkflow();
        try {
            const preparedResponse = await fetch(endpoints.prepare, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id, nodeId: step.id, selectedDirectionIds: workflowState.selectedDirectionIds })
            });
            let prepared = await preparedResponse.json().catch(() => ({}));
            if (!preparedResponse.ok || !prepared.ok) throw new Error(prepared.error || `HTTP ${preparedResponse.status}`);
            window.setWorkflowGenerationProgress({
                phase: '请求模型',
                detail: step.id === 'draft' && prepared.sequentialDraft
                    ? `第 ${prepared.batchSequence || 1} 批 · 第 ${(prepared.completedCount || 0) + 1}/${prepared.totalCount || 1} 场`
                    : step.title,
                total: (prepared.prompts || []).length,
                cumulativeCharacters: prepared.cumulativeCharacters || 0
            });
            const stageConfig = guidedStageProviderConfig(step.id, run);
            beginWorkflowReasoning(stageConfig, step.title || step.id);
            if (prepared.outputFormat !== 'text') hideWorkflowStreamStage();
            if ((prepared.prompts || []).length && (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function')) {
                throw new Error('生成服务尚未加载');
            }
            let completedIncrementally = false;
            for (let index = 0; index < (prepared.prompts || []).length; index += 1) {
                const prompt = prepared.prompts[index];
                let text = '';
                let finishReason = '';
                const outputRecord = { promptId: prompt.id, text: '', finishReason: '' };
                outputRecords.push(outputRecord);
                setWorkflowStatus(`正在生成 ${index + 1}/${prepared.prompts.length}：${prompt.title || step.title}`, 'info');
                window.setWorkflowGenerationProgress({
                    phase: '请求模型',
                    detail: prompt.title || step.title,
                    current: index + 1,
                    total: prepared.prompts.length,
                    characters: 0
                });
                beginWorkflowReasoningBatch(prompt.title || step.title, index, prepared.prompts.length);
                if (prepared.outputFormat === 'text') {
                    beginWorkflowStreamStage({
                        runId: run.id,
                        title: prompt.title || step.title || '正在生成正文',
                        current: prepared.sequentialDraft ? (prepared.completedCount || 0) + 1 : index + 1,
                        total: prepared.sequentialDraft ? prepared.totalCount || 1 : prepared.prompts.length,
                        cumulativeCharacters: prepared.cumulativeCharacters || 0,
                        model: stageConfig.model
                    });
                }
                let progressContentStarted = false;
                await window.DraftHarborProviderStream.streamGeneration(prompt.prompt, (token, meta) => {
                    if (meta && meta.type === 'usage') usage.push({ promptId: prompt.id, model: stageConfig.model, ...meta.usage });
                    else if (meta && meta.type === 'finish') {
                        finishReason = meta.finishReason || '';
                        outputRecord.finishReason = finishReason;
                    }
                    else if (meta && meta.type === 'reasoning') appendWorkflowReasoning(token);
                    else if (!meta || meta.type === 'content') {
                        markWorkflowAnswerStarted();
                        text += token;
                        outputRecord.text = text;
                        if (prepared.outputFormat === 'text') appendWorkflowStreamText(token);
                        if (!progressContentStarted || text.length % 500 < String(token || '').length) {
                            progressContentStarted = true;
                            window.setWorkflowGenerationProgress({
                                phase: '接收内容',
                                detail: prompt.title || step.title,
                                current: index + 1,
                                total: prepared.prompts.length,
                                characters: text.length,
                                cumulativeCharacters: (prepared.cumulativeCharacters || 0) + text.length
                            });
                        }
                    }
                }, { ...stageConfig, includeUsage: true });
                if (prepared.outputFormat === 'text') markWorkflowStreamSaving('正文已经抵达，正在校验并保存 Revision');
                if (prepared.outputFormat === 'json') {
                    window.setWorkflowGenerationProgress({
                        phase: '校验结果',
                        detail: prompt.title || step.title,
                        characters: text.length
                    });
                    let invalidJson = false;
                    try {
                        parseGuidedJsonOutput(text);
                    } catch {
                        invalidJson = true;
                    }
                    if (finishReason === 'length' || invalidJson) {
                        repairAttempted = true;
                        window.setWorkflowGenerationProgress({ phase: '自动修复', detail: prompt.title || step.title });
                        let repaired;
                        try {
                            repaired = await repairGuidedJsonOutput(step, prompt, text, finishReason, stageConfig, usage);
                        } catch (error) {
                            outputRecords.push({
                                promptId: `${prompt.id}-repair`,
                                text: String(error && error.generatedOutput || ''),
                                finishReason: String(error && error.finishReason || '')
                            });
                            throw error;
                        }
                        text = repaired.text;
                        outputRecord.text = repaired.text;
                        outputRecord.finishReason = repaired.finishReason || finishReason;
                    }
                }
                if (prepared.sequentialDraft) {
                    const partial = prepared.remainingCount > 1;
                    window.setWorkflowGenerationProgress({
                        phase: '保存 Revision',
                        detail: prompt.title || step.title,
                        characters: text.length
                    });
                    const partialResponse = await fetch(endpoints.complete, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectId,
                            runId: run.id,
                            nodeId: step.id,
                            outputs: [text],
                            outputIndexes: [prompt.outputIndex],
                            usage,
                            outputTitles: [prompt.title || step.title],
                            partial
                        })
                    });
                    const partialResult = await partialResponse.json().catch(() => ({}));
                    if (!partialResponse.ok || !partialResult.ok) throw new Error(partialResult.error || `HTTP ${partialResponse.status}`);
                    if (partial) {
                        finishWorkflowStreamStage(true, `${prompt.title || step.title} 已保存，正在准备下一场`);
                        window.setWorkflowGenerationProgress({
                            phase: '更新滚动上下文',
                            detail: `${prompt.title || step.title} 已保存，准备下一场`,
                            cumulativeCharacters: (prepared.cumulativeCharacters || 0) + text.length
                        });
                        const nextPreparedResponse = await fetch(endpoints.prepare, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId, runId: run.id, nodeId: step.id, selectedDirectionIds: workflowState.selectedDirectionIds })
                        });
                        prepared = await nextPreparedResponse.json().catch(() => ({}));
                        if (!nextPreparedResponse.ok || !prepared.ok) throw new Error(prepared.error || `HTTP ${nextPreparedResponse.status}`);
                        index = -1;
                        continue;
                    }
                    completedIncrementally = true;
                    break;
                }
                outputs.push(text);
            }
            if (!completedIncrementally) {
                const completedOutputs = combineGuidedOutputs(step, prepared, outputs);
                window.setWorkflowGenerationProgress({
                    phase: step.id === 'review' ? '更新滚动状态' : '保存 Revision',
                    detail: step.title,
                    characters: outputs.reduce((sum, output) => sum + output.length, 0)
                });
                const completeResponse = await fetch(endpoints.complete, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId,
                        runId: run.id,
                        nodeId: step.id,
                        outputs: completedOutputs.outputs,
                        usage,
                        outputTitles: completedOutputs.outputTitles
                    })
                });
                const completed = await completeResponse.json().catch(() => ({}));
                if (!completeResponse.ok || !completed.ok) throw new Error(completed.error || `HTTP ${completeResponse.status}`);
            }
            const refreshedRun = await loadGuidedWorkflowRun(run.id);
            const artifact = (refreshedRun.artifacts || []).filter((item) => item.nodeId === step.id).slice(-1)[0];
            workflowState.selectedArtifactId = artifact ? artifact.id : workflowState.selectedArtifactId;
            await loadWorkflowEvents();
            completionStatus = step.id === 'review'
                ? '自动审查完成。'
                : repairAttempted
                    ? '生成完成；检测到不完整 JSON，并已自动修复。请检查结果。'
                    : '生成完成，请检查并按需修改。';
            window.setWorkflowGenerationProgress({
                phase: '等待确认',
                detail: completionStatus,
                current: 0,
                total: 0
            });
            if (prepared.outputFormat === 'text') finishWorkflowStreamStage(true, '正文已生成并安全保存，可以开始审阅');
            finishWorkflowReasoning(true, '模型响应完成，结果已返回。');
        } catch (error) {
            let recoveredRun = null;
            try {
                recoveredRun = await loadGuidedWorkflowRun(run.id);
            } catch {
                recoveredRun = null;
            }
            const recoveredStep = recoveredRun && (recoveredRun.steps || []).find((item) => item.id === step.id);
            const recoveredArtifact = recoveredRun && (recoveredRun.artifacts || []).filter((item) => item.nodeId === step.id).slice(-1)[0];
            if (recoveredStep && ['waiting_user', 'completed'].includes(recoveredStep.status) && recoveredArtifact) {
                workflowState.selectedArtifactId = recoveredArtifact.id;
                workflowState.lastGenerationError = '';
                await loadWorkflowEvents().catch(() => {});
                completionStatus = step.id === 'review' ? '自动审查已完成，已从本地运行恢复。' : '生成已经完成，结果已从本地运行恢复，请检查并确认。';
                window.setWorkflowGenerationProgress({
                    phase: '等待确认',
                    detail: completionStatus,
                    current: 0,
                    total: 0
                });
                finishWorkflowStreamStage(true, '正文已经保存，并已从本地运行恢复');
                finishWorkflowReasoning(true, '模型结果已保存，并已从本地运行恢复。');
                return;
            }
            workflowState.lastGenerationError = error && error.message ? error.message : String(error);
            await fetch(endpoints.complete, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    runId: run.id,
                    nodeId: step.id,
                    generationFailure: {
                        code: error && error.code ? error.code : 'generation_failed',
                        message: workflowState.lastGenerationError,
                        repairAttempted,
                        outputs: outputRecords.map((item) => ({
                            promptId: item.promptId,
                            characters: item.text.length,
                            tail: item.text.slice(-500),
                            finishReason: item.finishReason
                        })),
                        usage
                    }
                })
            }).catch(() => {});
            await loadWorkflowEvents().catch(() => {});
            finishWorkflowStreamStage(false, `生成中断：${error.message || error}。当前已接收文字仍保留在预览中`);
            finishWorkflowReasoning(false, `响应失败：${error.message || error}`);
            throw error;
        } finally {
            workflowState.generating = false;
            renderWorkflow();
            if (completionStatus) setWorkflowStatus(completionStatus, 'ok');
        }
    }
