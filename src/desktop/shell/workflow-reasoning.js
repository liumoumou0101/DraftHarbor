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
        const requested = !!config.enableThinking;
        workflowState.reasoning = {
            visible: requested,
            dismissed: false,
            requested,
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
        if (!state.requested) return;
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
        state.visible = false;
        renderWorkflowReasoningBubble();
    }
