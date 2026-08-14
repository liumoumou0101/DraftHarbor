    async function generateAlternativeWorkflowVariant() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run || workflowState.generating) return;
        const instruction = window.prompt('新版本要求', '生成一个情节更紧凑、冲突更强的替代版本。');
        if (!instruction || !instruction.trim()) return;
        const label = window.prompt('版本名称', instruction.trim().slice(0, 24)) || instruction.trim().slice(0, 24);
        workflowState.generating = true;
        setWorkflowStatus('正在准备替代版本...', 'info');
        renderWorkflow();
        try {
            const preparedResponse = await fetch('/api/workflows/v2/prepare-variant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id, instruction, label })
            });
            const prepared = await preparedResponse.json().catch(() => ({}));
            if (!preparedResponse.ok || !prepared.ok) throw new Error(prepared.error || `HTTP ${preparedResponse.status}`);
            const config = Object.assign({}, guidedStageProviderConfig(isRewriteWorkflow(run) ? 'repair' : 'draft', run), workflowGenerationScope(run));
            const outputs = [];
            beginWorkflowReasoning(config, `替代版本 · ${label}`);
            for (let index = 0; index < prepared.prompts.length; index += 1) {
                let output = '';
                const item = prepared.prompts[index];
                beginWorkflowReasoningBatch(item.title, index, prepared.prompts.length);
                beginWorkflowStreamStage({
                    runId: run.id,
                    title: `替代版本 · ${item.title || label}`,
                    current: index + 1,
                    total: prepared.prompts.length,
                    model: config.model
                });
                await streamDesktopGeneration(item.prompt, (token, meta) => {
                    if (meta?.type === 'reasoning') appendWorkflowReasoning(token);
                    else if (!meta || meta.type === 'content') {
                        markWorkflowAnswerStarted();
                        output += token;
                        appendWorkflowStreamText(token);
                    }
                }, { ...config, includeUsage: true });
                markWorkflowStreamSaving('替代正文已经抵达，正在准备比较版本');
                outputs.push(output);
            }
            const completeResponse = await fetch('/api/workflows/v2/complete-variant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    runId: run.id,
                    variantId: prepared.variantId,
                    instruction,
                    label,
                    outputs,
                    providerSnapshot: { provider: config.provider, model: config.model }
                })
            });
            const completed = await completeResponse.json().catch(() => ({}));
            if (!completeResponse.ok || !completed.ok) throw new Error(completed.error || `HTTP ${completeResponse.status}`);
            workflowState.pendingVariantId = completed.variant.variantId;
            workflowState.pendingVariantApproved = false;
            workflowState.variantSelections = {};
            await compareWorkflowVariants(run, completed.variant.variantId);
            finishWorkflowStreamStage(true, '替代正文已生成，可以逐场景比较');
            finishWorkflowReasoning(true, '替代版本生成完成，请逐场景比较并批准。');
            setWorkflowStatus('替代版本已生成，尚未批准或写回。', 'ok');
        } catch (error) {
            finishWorkflowStreamStage(false, `替代版本生成中断：${error.message || error}`);
            finishWorkflowReasoning(false, `版本生成失败：${error.message || error}`);
            throw error;
        } finally {
            workflowState.generating = false;
            renderWorkflow();
        }
    }
