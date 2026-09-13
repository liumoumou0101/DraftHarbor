    const readerWriterTransferState = {
        transfer: null,
        preview: null,
        previewRequest: null,
        targetSnapshot: null,
        busy: false,
        applying: false,
        requestId: 0,
        controller: null
    };

    function readerWriterTransferElements() {
        const dialog = document.querySelector('[data-reader-writer-dialog]');
        return {
            dialog,
            close: dialog && dialog.querySelector('[data-reader-writer-close]'),
            source: dialog && dialog.querySelector('[data-reader-writer-source]'),
            freshness: dialog && dialog.querySelector('[data-reader-writer-freshness]'),
            project: dialog && dialog.querySelector('[data-reader-writer-project]'),
            intent: dialog && dialog.querySelector('[data-reader-writer-intent]'),
            chapter: dialog && dialog.querySelector('[data-reader-writer-chapter]'),
            scene: dialog && dialog.querySelector('[data-reader-writer-scene]'),
            chapterField: dialog && dialog.querySelector('[data-reader-writer-chapter-field]'),
            sceneField: dialog && dialog.querySelector('[data-reader-writer-scene-field]'),
            titleField: dialog && dialog.querySelector('[data-reader-writer-title-field]'),
            projectTitle: dialog && dialog.querySelector('[data-reader-writer-project-title]'),
            sections: dialog && dialog.querySelector('[data-reader-writer-sections]'),
            location: dialog && dialog.querySelector('[data-reader-writer-location]'),
            conflicts: dialog && dialog.querySelector('[data-reader-writer-conflicts]'),
            confirm: dialog && dialog.querySelector('[data-reader-writer-confirm]'),
            status: dialog && dialog.querySelector('[data-reader-writer-status]'),
            refresh: dialog && dialog.querySelector('[data-reader-writer-refresh]'),
            apply: dialog && dialog.querySelector('[data-reader-writer-apply]')
        };
    }

    function readerWriterFreshnessLabel(transfer) {
        const freshness = transfer && transfer.freshness || {};
        if (freshness.status === 'missing') return '原来源已缺失；以下内容来自不可变快照。';
        if (freshness.status === 'stale') return '原项目已变化；继续应用的是创建时快照。';
        if (freshness.newerRevisionAvailable) return '书库存在较新修订；当前预览不会被静默替换。';
        return '来源状态：创建时版本仍可解析。';
    }

    async function loadReaderWriterTargetSnapshot(projectId, signal) {
        const response = await fetch(`/api/get-project?projectId=${encodeURIComponent(projectId)}`, { signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload.project;
    }

    function renderReaderWriterTargets() {
        const elements = readerWriterTransferElements();
        const snapshot = readerWriterTransferState.targetSnapshot;
        if (!snapshot) return;
        const previousChapter = elements.chapter.value;
        const previousScene = elements.scene.value;
        elements.chapter.replaceChildren(...(snapshot.chapters || []).map((chapter) => {
            const option = document.createElement('option'); option.value = chapter.id; option.textContent = chapter.title; return option;
        }));
        if (previousChapter && Array.from(elements.chapter.options).some((option) => option.value === previousChapter)) elements.chapter.value = previousChapter;
        const chapterId = elements.chapter.value || snapshot.chapters[0] && snapshot.chapters[0].id || '';
        const scenes = (snapshot.scenes || []).filter((scene) => scene.chapterId === chapterId);
        elements.scene.replaceChildren(...scenes.map((scene) => {
            const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.title; return option;
        }));
        if (previousScene && Array.from(elements.scene.options).some((option) => option.value === previousScene)) elements.scene.value = previousScene;
    }

    function readerWriterPreviewRequest() {
        const elements = readerWriterTransferElements();
        const transfer = readerWriterTransferState.transfer;
        return {
            envelopeId: transfer.envelope.envelopeId,
            applicationId: `reader-writer:${transfer.envelope.envelopeId}`,
            intent: elements.intent.value,
            targetProjectId: elements.intent.value === 'new-project' ? '' : elements.project.value,
            targetChapterId: elements.chapter.value,
            targetSceneId: elements.scene.value,
            newProjectTitle: elements.projectTitle.value || transfer.snapshot.sourceTitle
        };
    }

    function renderReaderWriterPreview() {
        const elements = readerWriterTransferElements();
        const preview = readerWriterTransferState.preview;
        const intent = elements.intent.value;
        elements.titleField.hidden = intent !== 'new-project';
        elements.chapterField.hidden = !['new-scenes'].includes(intent);
        elements.sceneField.hidden = !['append', 'replace'].includes(intent);
        if (!preview) {
            elements.sections.replaceChildren();
            elements.location.textContent = readerWriterTransferState.busy ? '正在生成写前预览…' : '暂无可应用预览，请刷新。';
            elements.conflicts.replaceChildren();
            elements.apply.disabled = true;
            return;
        }
        const selected = new Set(Array.from(elements.sections.querySelectorAll('input:checked')).map((input) => input.value));
        elements.sections.replaceChildren(...preview.items.map((item) => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.itemId;
            checkbox.checked = selected.size ? selected.has(item.itemId) : true;
            checkbox.addEventListener('change', () => {
                elements.confirm.checked = false;
                renderReaderWriterApplyState();
            });
            const copy = document.createElement('span'); copy.textContent = `${item.title} · ${item.characterCount.toLocaleString()} 字符`;
            label.append(checkbox, copy); return label;
        }));
        elements.location.textContent = preview.location.message;
        elements.conflicts.replaceChildren(...(preview.conflicts.length ? preview.conflicts : ['未发现覆盖冲突。']).map((message) => {
            const item = document.createElement('li'); item.textContent = message; return item;
        }));
        renderReaderWriterApplyState();
    }

    function renderReaderWriterApplyState() {
        const elements = readerWriterTransferElements();
        const state = readerWriterTransferState;
        const selectedCount = elements.sections.querySelectorAll('input:checked').length;
        elements.confirm.disabled = state.busy || !state.preview;
        elements.apply.disabled = state.busy || !state.preview || !state.previewRequest || !elements.confirm.checked || (!selectedCount && state.preview.intent !== 'locate');
        [elements.project, elements.intent, elements.chapter, elements.scene, elements.projectTitle, elements.refresh,
            ...elements.sections.querySelectorAll('input')].forEach((control) => { control.disabled = state.applying; });
    }

    function invalidateReaderWriterPreview() {
        const state = readerWriterTransferState;
        state.requestId += 1;
        if (state.controller) state.controller.abort();
        state.controller = null;
        state.preview = null;
        state.previewRequest = null;
        readerWriterTransferElements().confirm.checked = false;
        return state.requestId;
    }

    async function refreshReaderWriterPreview() {
        const elements = readerWriterTransferElements();
        const state = readerWriterTransferState;
        if (!state.transfer || state.applying) return;
        const requestId = invalidateReaderWriterPreview();
        const controller = new AbortController();
        state.controller = controller;
        state.busy = true;
        elements.status.textContent = '正在读取目标版本并计算冲突…';
        renderReaderWriterPreview();
        renderReaderWriterApplyState();
        try {
            const request = readerWriterPreviewRequest();
            if (request.intent !== 'new-project') {
                const snapshot = await loadReaderWriterTargetSnapshot(request.targetProjectId, controller.signal);
                if (requestId !== state.requestId) return;
                state.targetSnapshot = snapshot;
                renderReaderWriterTargets();
                request.targetChapterId = elements.chapter.value;
                request.targetSceneId = elements.scene.value;
            }
            const response = await fetch('/api/writer/reader-transfer/preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal
            });
            const payload = await response.json().catch(() => ({}));
            if (requestId !== state.requestId) return;
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            state.preview = payload.preview;
            state.previewRequest = Object.freeze({ ...payload.preview.request });
            elements.status.textContent = '预览完成；确认前项目磁盘不会变化。';
        } catch (error) {
            if (requestId !== state.requestId) return;
            elements.status.textContent = `预览失败：${error.message || error}`;
        } finally {
            if (requestId === state.requestId) {
                state.busy = false;
                state.controller = null;
                renderReaderWriterPreview();
                renderReaderWriterApplyState();
            }
        }
    }

    async function applyReaderWriterTransfer() {
        const elements = readerWriterTransferElements();
        const state = readerWriterTransferState;
        const preview = readerWriterTransferState.preview;
        if (!preview || !state.previewRequest || !elements.confirm.checked || state.busy) return;
        const selectedItemIds = Array.from(elements.sections.querySelectorAll('input:checked')).map((input) => input.value);
        if (!selectedItemIds.length && preview.intent !== 'locate') return;
        state.busy = true;
        state.applying = true;
        elements.status.textContent = '正在创建写前备份并应用…';
        renderReaderWriterApplyState();
        try {
            const request = {
                ...state.previewRequest, confirmed: true, previewToken: preview.previewToken,
                expectedTargetUpdatedAt: preview.targetProject && preview.targetProject.updatedAt,
                selectedItemIds
            };
            const response = await fetch('/api/writer/reader-transfer/apply', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            const projectPayload = await (await fetch(`/api/get-project?projectId=${encodeURIComponent(payload.projectId)}`)).json();
            if (projectPayload.ok) {
                loadNativeProjectEditor(projectPayload.project, projectPayload.summary || {});
                const targetSceneId = payload.targetSceneIds && payload.targetSceneIds[0];
                if (targetSceneId) nativeEditorState.activeSceneId = targetSceneId;
                renderNativeEditor();
            }
            await loadProjectLibrary();
            elements.status.textContent = payload.applied
                ? `已应用${payload.backup && payload.backup.backupId ? `；备份 ${payload.backup.backupId}` : ''}${payload.idempotent ? '（重复提交未再次写入）' : ''}。`
                : `已定位到目标场景${payload.idempotent ? '。' : ''}`;
            if (elements.dialog.open) elements.dialog.close();
        } catch (error) {
            invalidateReaderWriterPreview();
            elements.status.textContent = `应用失败：${error.message || error}。请重新预览，项目不会部分重复写入。`;
        } finally {
            state.busy = false;
            state.applying = false;
            renderReaderWriterPreview();
            renderReaderWriterApplyState();
        }
    }

    async function openReaderWriterTransfer(transfer) {
        const elements = readerWriterTransferElements();
        const state = readerWriterTransferState;
        if (!elements.dialog || state.applying) return;
        const requestId = invalidateReaderWriterPreview();
        const controller = new AbortController();
        state.controller = controller;
        state.transfer = transfer;
        state.targetSnapshot = null;
        state.busy = true;
        elements.source.textContent = `${transfer.snapshot.sourceTitle} · ${transfer.envelope.characterCount.toLocaleString()} 字符`;
        elements.freshness.textContent = readerWriterFreshnessLabel(transfer);
        elements.projectTitle.value = transfer.snapshot.sourceTitle;
        if (!elements.dialog.open) elements.dialog.showModal();
        elements.status.textContent = '正在读取目标项目…';
        renderReaderWriterPreview();
        renderReaderWriterApplyState();
        try {
            const response = await fetch('/api/list-projects', { signal: controller.signal });
            const projectsPayload = await response.json();
            if (requestId !== state.requestId) return;
            if (!response.ok) throw new Error(projectsPayload.error || `HTTP ${response.status}`);
            const projects = (projectsPayload.projects || []).filter((project) => project.health === 'ok');
            elements.project.replaceChildren(...projects.map((project) => {
                const option = document.createElement('option'); option.value = project.id; option.textContent = project.name; return option;
            }));
            const activeProjectId = typeof currentProjectId === 'function' ? currentProjectId() : '';
            if (activeProjectId && projects.some((project) => project.id === activeProjectId)) elements.project.value = activeProjectId;
            elements.intent.value = transfer.envelope.sourceKind === 'project' && transfer.envelope.suggestedProjectId === elements.project.value ? 'locate' : 'new-scenes';
            await refreshReaderWriterPreview();
        } catch (error) {
            if (requestId !== state.requestId) return;
            state.busy = false;
            elements.status.textContent = `读取项目失败：${error.message || error}`;
            renderReaderWriterPreview();
            renderReaderWriterApplyState();
        }
    }

    function bindReaderWriterTransfer() {
        const elements = readerWriterTransferElements();
        if (!elements.dialog || elements.dialog.dataset.readerWriterBound === 'true') return;
        elements.dialog.dataset.readerWriterBound = 'true';
        elements.close.addEventListener('click', () => elements.dialog.close());
        elements.dialog.addEventListener('cancel', (event) => { event.preventDefault(); elements.dialog.close(); });
        elements.dialog.addEventListener('close', () => {
            if (readerWriterTransferState.applying) return;
            invalidateReaderWriterPreview();
            readerWriterTransferState.transfer = null;
            readerWriterTransferState.busy = false;
        });
        elements.refresh.addEventListener('click', refreshReaderWriterPreview);
        elements.apply.addEventListener('click', applyReaderWriterTransfer);
        elements.confirm.addEventListener('change', renderReaderWriterApplyState);
        elements.project.addEventListener('change', refreshReaderWriterPreview);
        elements.intent.addEventListener('change', refreshReaderWriterPreview);
        elements.chapter.addEventListener('change', () => { renderReaderWriterTargets(); refreshReaderWriterPreview(); });
        elements.scene.addEventListener('change', refreshReaderWriterPreview);
        elements.projectTitle.addEventListener('input', refreshReaderWriterPreview);
    }
