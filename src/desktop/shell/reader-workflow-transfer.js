    /* global currentProjectId, loadWorkflowRuns, renderWorkflow, workflowState, activateReaderTransferTarget */
    const readerWorkflowTransferState = { transfer: null, preview: null, busy: false };

    function readerWorkflowTransferElements() {
        const dialog = document.querySelector('[data-reader-workflow-dialog]');
        return {
            dialog, close: dialog && dialog.querySelector('[data-reader-workflow-close]'), source: dialog && dialog.querySelector('[data-reader-workflow-source]'),
            freshness: dialog && dialog.querySelector('[data-reader-workflow-freshness]'), project: dialog && dialog.querySelector('[data-reader-workflow-project]'),
            template: dialog && dialog.querySelector('[data-reader-workflow-template]'), brief: dialog && dialog.querySelector('[data-reader-workflow-brief]'),
            preview: dialog && dialog.querySelector('[data-reader-workflow-preview]'), artifact: dialog && dialog.querySelector('[data-reader-workflow-artifact]'),
            run: dialog && dialog.querySelector('[data-reader-workflow-run]'), conflicts: dialog && dialog.querySelector('[data-reader-workflow-conflicts]'),
            confirm: dialog && dialog.querySelector('[data-reader-workflow-confirm]'), status: dialog && dialog.querySelector('[data-reader-workflow-status]'),
            refresh: dialog && dialog.querySelector('[data-reader-workflow-refresh]'), apply: dialog && dialog.querySelector('[data-reader-workflow-apply]')
        };
    }

    function readerWorkflowRequest() {
        const elements = readerWorkflowTransferElements(); const transfer = readerWorkflowTransferState.transfer;
        return { envelopeId: transfer.envelope.envelopeId, projectId: elements.project.value, templateId: elements.template.value, brief: elements.brief.value.trim() };
    }

    function renderReaderWorkflowPreview() {
        const elements = readerWorkflowTransferElements(); const preview = readerWorkflowTransferState.preview;
        elements.preview.hidden = !preview;
        if (preview) {
            elements.artifact.textContent = `${preview.artifactType} · ${preview.sections.length} 个来源片段`;
            elements.run.textContent = preview.existingRun ? `将重开现有运行：${preview.runId}` : `将创建新运行：${preview.runId}`;
            elements.conflicts.replaceChildren(...(preview.conflicts.length ? preview.conflicts : ['未发现来源版本或运行身份冲突。']).map((message) => { const item = document.createElement('li'); item.textContent = message; return item; }));
        }
        elements.apply.disabled = readerWorkflowTransferState.busy || !preview || !elements.confirm.checked;
    }

    async function refreshReaderWorkflowPreview() {
        const elements = readerWorkflowTransferElements(); if (!readerWorkflowTransferState.transfer || readerWorkflowTransferState.busy) return;
        readerWorkflowTransferState.busy = true; readerWorkflowTransferState.preview = null; elements.status.textContent = '正在校验来源版本、目标项目和运行身份…'; renderReaderWorkflowPreview();
        try {
            const response = await fetch('/api/workflows/reader-transfer/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readerWorkflowRequest()) });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            readerWorkflowTransferState.preview = payload.preview;
            elements.status.textContent = payload.preview.existingRun ? '运行已存在；确认后只重开，不会创建重复 Run 或输入 Revision。' : '预览完成；确认前不会创建 Run 或输入 Revision。';
        } catch (error) { elements.status.textContent = `预览失败：${error.message || error}`; }
        finally { readerWorkflowTransferState.busy = false; renderReaderWorkflowPreview(); }
    }

    async function applyReaderWorkflowTransfer() {
        const elements = readerWorkflowTransferElements(); const preview = readerWorkflowTransferState.preview;
        if (!preview || !elements.confirm.checked || readerWorkflowTransferState.busy) return;
        readerWorkflowTransferState.busy = true; elements.status.textContent = preview.existingRun ? '正在重开已有运行…' : '正在创建版本化输入和工作流运行…'; renderReaderWorkflowPreview();
        try {
            const response = await fetch('/api/workflows/reader-transfer/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...readerWorkflowRequest(), confirmed: true, expectedProjectUpdatedAt: preview.targetProject.updatedAt }) });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            workflowState.selectedId = payload.runId; await loadWorkflowRuns(); renderWorkflow();
            elements.status.textContent = payload.idempotent ? '已重开现有运行；未创建重复输入。' : 'Reader 输入已冻结，可以从工作流首个待执行步骤继续。';
            if (typeof activateReaderTransferTarget === 'function') await activateReaderTransferTarget('workflow');
            if (elements.dialog.open) elements.dialog.close();
        } catch (error) { elements.status.textContent = `创建失败：${error.message || error}。Envelope 保持可重试，不会留下重复运行。`; }
        finally { readerWorkflowTransferState.busy = false; renderReaderWorkflowPreview(); }
    }

    async function openReaderWorkflowTransfer(transfer) {
        const elements = readerWorkflowTransferElements(); if (!elements.dialog) return;
        readerWorkflowTransferState.transfer = transfer; readerWorkflowTransferState.preview = null; elements.confirm.checked = false;
        elements.source.textContent = `${transfer.snapshot.sourceTitle} · ${transfer.envelope.characterCount.toLocaleString()} 字符`;
        elements.freshness.textContent = transfer.freshness.status === 'fresh' ? '来源状态与创建时一致。' : transfer.freshness.status === 'stale' ? '原项目已变化；工作流仍使用冻结快照。' : '原来源已缺失；工作流仍使用冻结快照。';
        const projectsPayload = await (await fetch('/api/list-projects')).json(); const projects = (projectsPayload.projects || []).filter((project) => project.health === 'ok');
        elements.project.replaceChildren(...projects.map((project) => { const option = document.createElement('option'); option.value = project.id; option.textContent = project.name; return option; }));
        const active = typeof currentProjectId === 'function' ? currentProjectId() : ''; if (active && projects.some((project) => project.id === active)) elements.project.value = active;
        const rewriteSceneIds = new Set((transfer.envelope.sourceLocators || []).map((locator) => locator.projectRef && locator.projectRef.sceneId).filter(Boolean));
        const rewriteOption = elements.template.querySelector('option[value="rewrite-guided"]'); if (rewriteOption) rewriteOption.disabled = transfer.envelope.sourceKind !== 'project' || rewriteSceneIds.size !== 1;
        if (transfer.envelope.sourceKind !== 'project' && elements.template.value === 'rewrite-guided') elements.template.value = 'continuation-guided';
        elements.status.textContent = '选择目标项目和处理模板；建议项目不会自动切换。'; renderReaderWorkflowPreview();
        if (!elements.dialog.open) elements.dialog.showModal(); await refreshReaderWorkflowPreview();
    }

    function bindReaderWorkflowTransfer() {
        const elements = readerWorkflowTransferElements(); if (!elements.dialog || elements.dialog.dataset.readerWorkflowBound === 'true') return;
        elements.dialog.dataset.readerWorkflowBound = 'true'; elements.close.addEventListener('click', () => elements.dialog.close());
        elements.dialog.addEventListener('cancel', (event) => { event.preventDefault(); elements.dialog.close(); });
        elements.refresh.addEventListener('click', refreshReaderWorkflowPreview); elements.apply.addEventListener('click', applyReaderWorkflowTransfer);
        elements.confirm.addEventListener('change', renderReaderWorkflowPreview); elements.project.addEventListener('change', refreshReaderWorkflowPreview); elements.template.addEventListener('change', refreshReaderWorkflowPreview);
    }
