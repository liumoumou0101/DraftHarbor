    const compendiumRewriteState = { entryId: '', projectId: '', snapshot: null, requestId: 0, controller: null, running: false, saving: false, hasPreview: false, draft: null };

    function compendiumRewriteElements() {
        return {
            modal: document.querySelector('[data-compendium-rewrite-modal]'), form: document.querySelector('[data-compendium-rewrite-form]'),
            fields: document.querySelectorAll('[data-compendium-rewrite-field]'), characterFields: document.querySelector('[data-compendium-rewrite-character-fields]'), selectionSummary: document.querySelector('[data-compendium-rewrite-selection-summary]'), referenceList: document.querySelector('[data-compendium-rewrite-reference-list]'), referenceCount: document.querySelector('[data-compendium-rewrite-reference-count]'), instruction: document.querySelector('[data-compendium-rewrite-instruction]'),
            preview: document.querySelector('[data-compendium-rewrite-preview]'), status: document.querySelector('[data-compendium-rewrite-status]'),
            generate: document.querySelector('[data-compendium-rewrite-generate]'), apply: document.querySelector('[data-compendium-rewrite-apply]'), cancel: document.querySelectorAll('[data-compendium-rewrite-cancel]')
        };
    }

    function setCompendiumRewriteStatus(message, tone = 'info') {
        const { status } = compendiumRewriteElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function closeCompendiumRewrite() {
        if (compendiumRewriteState.saving) return;
        const { modal } = compendiumRewriteElements();
        compendiumRewriteState.requestId += 1;
        compendiumRewriteState.controller?.abort();
        compendiumRewriteState.controller = null;
        if (modal) { if (modal.open) modal.close(); modal.hidden = true; }
        compendiumRewriteState.entryId = '';
        compendiumRewriteState.running = false;
        compendiumRewriteState.hasPreview = false;
        compendiumRewriteState.draft = null;
    }

    function currentCompendiumRewrite(requestId) {
        return requestId === compendiumRewriteState.requestId
            && currentProjectId() === compendiumRewriteState.projectId
            && nativeEditorState.snapshot === compendiumRewriteState.snapshot
            && selectedCompendiumEntry()?.id === compendiumRewriteState.entryId
            && !compendiumRewriteElements().modal.hidden;
    }

    function selectedRewriteFields() {
        const { fields } = compendiumRewriteElements();
        return Array.from(fields || []).filter((field) => field.checked).map((field) => field.value);
    }

    function updateRewriteSelectionSummary() {
        const { selectionSummary } = compendiumRewriteElements();
        if (selectionSummary) selectionSummary.textContent = `已选择 ${selectedRewriteFields().length} 个字段`;
    }

    function renderCompendiumRewriteState() {
        const { generate, apply, form, cancel } = compendiumRewriteElements();
        const busy = compendiumRewriteState.running || compendiumRewriteState.saving;
        if (form) form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = busy; });
        cancel.forEach((button) => { button.disabled = compendiumRewriteState.saving; });
        if (generate) {
            generate.disabled = busy;
            generate.classList.toggle('desktop-primary-action', !compendiumRewriteState.hasPreview);
            generate.classList.toggle('desktop-secondary-action', compendiumRewriteState.hasPreview);
        }
        if (apply) apply.disabled = busy || !compendiumRewriteState.hasPreview;
        updateRewriteSelectionSummary();
    }

    function handleRewriteFieldChange() {
        if (compendiumRewriteState.saving) return;
        compendiumRewriteState.requestId += 1;
        compendiumRewriteState.controller?.abort();
        compendiumRewriteState.controller = null;
        compendiumRewriteState.running = false;
        compendiumRewriteState.draft = null;
        const { preview } = compendiumRewriteElements();
        if (compendiumRewriteState.hasPreview) {
            compendiumRewriteState.hasPreview = false;
            if (preview) preview.value = '';
            setCompendiumRewriteStatus('补全条件已变化，请重新生成补丁。');
        }
        renderCompendiumRewriteState();
    }

    function restrictRewritePatch(patch, fields) {
        const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
        const selected = new Set(fields);
        const next = {};
        ['summary', 'body', 'tags'].forEach((field) => {
            if (selected.has(field) && Object.prototype.hasOwnProperty.call(source, field)) next[field] = source[field];
        });
        if (source.characterProfile && typeof source.characterProfile === 'object' && !Array.isArray(source.characterProfile)) {
            const profile = {};
            Object.keys(source.characterProfile).forEach((field) => {
                if (selected.has(`characterProfile.${field}`)) profile[field] = source.characterProfile[field];
            });
            if (Object.keys(profile).length) next.characterProfile = profile;
        }
        return next;
    }

    function openCompendiumRewrite() {
        if (compendiumRewriteState.saving) return;
        const captured = window.captureCompendiumDraft();
        if (!captured) return;
        const entry = captured.entry;
        closeCompendiumRewrite();
        const elements = compendiumRewriteElements();
        compendiumRewriteState.entryId = entry.id;
        compendiumRewriteState.projectId = captured.projectId;
        compendiumRewriteState.snapshot = captured.snapshot;
        const profile = entry.characterProfile || {};
        Array.from(elements.fields || []).forEach((field) => {
            const characterField = field.value.startsWith('characterProfile.');
            const profileField = characterField ? field.value.slice('characterProfile.'.length) : '';
            field.checked = field.value === 'summary' || field.value === 'body' || (entry.type === 'character' && characterField && !String(profile[profileField] || '').trim());
        });
        if (elements.characterFields) elements.characterFields.hidden = entry.type !== 'character';
        renderCompendiumReferencePicker(elements.referenceList, elements.referenceCount, [], { excludeId: entry.id });
        if (elements.instruction) elements.instruction.value = '';
        if (elements.preview) elements.preview.value = '';
        compendiumRewriteState.hasPreview = false;
        renderCompendiumRewriteState();
        setCompendiumRewriteStatus('以当前编辑内容生成建议，确认后与当前草稿一起保存。');
        const patchDetails = document.querySelector('[data-compendium-rewrite-patch]');
        if (patchDetails) patchDetails.open = false;
        if (elements.modal) { elements.modal.hidden = false; elements.modal.showModal(); }
    }

    function compendiumRewritePrompt(entry, fields, instruction) {
        return {
            messages: [
                { role: 'system', content: '你是小说资料编辑。只输出 JSON 对象字段补丁，不要 Markdown，不要输出未被要求的字段。允许字段：summary、body、tags、characterProfile（仅包含 role、goal、motivation、conflict、voice、currentState、knowledge、relationshipNotes）。tags 必须为字符串数组。' },
                { role: 'user', content: `资料卡：\n${JSON.stringify(entry, null, 2)}\n\n只重写字段：${fields.join(', ')}\n要求：${instruction || '让内容更清晰、具体并保持原意。'}${compendiumReferencesPromptBlock(selectedCompendiumReferenceCards(compendiumRewriteElements().referenceList))}` }
            ],
            asString() { return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n'); }
        };
    }

    async function generateCompendiumRewrite() {
        const captured = window.captureCompendiumDraft();
        const entry = captured && captured.entry;
        const elements = compendiumRewriteElements();
        const fields = selectedRewriteFields();
        if (!entry || !currentCompendiumRewrite(compendiumRewriteState.requestId) || compendiumRewriteState.running || compendiumRewriteState.saving) return;
        if (!fields.length) { setCompendiumRewriteStatus('请至少选择一个字段', 'error'); return; }
        compendiumRewriteState.running = true;
        compendiumRewriteState.hasPreview = false;
        compendiumRewriteState.draft = null;
        const requestId = ++compendiumRewriteState.requestId;
        const controller = new AbortController();
        compendiumRewriteState.controller = controller;
        renderCompendiumRewriteState();
        setCompendiumRewriteStatus('正在生成字段补丁…');
        try {
            const profile = writerEffectiveProfile();
            const task = {
                projectId: captured.projectId, domain: 'compendium', action: 'rewrite', scope: 'fields',
                target: { type: 'compendium-entry', entryId: entry.id, id: entry.id }, instruction: elements.instruction.value.trim(),
                model: writerSelectedModelId(profile), outputContract: 'field-patch', beforeSnapshot: entry
            };
            const result = await getNativeAITaskRunner().run(task, {
                prompt: compendiumRewritePrompt(entry, fields, task.instruction), providerConfig: nativeGenerationConfig(), abortController: controller,
                onToken: ({ text }) => { if (currentCompendiumRewrite(requestId)) setCompendiumRewriteStatus(`正在接收补丁… ${text.length} 字`); }
            });
            if (!currentCompendiumRewrite(requestId)) return;
            if (!result.ok) throw new Error(result.error?.message || '生成失败');
            const patch = restrictRewritePatch(result.output, fields);
            if (elements.preview) elements.preview.value = JSON.stringify(patch, null, 2);
            compendiumRewriteState.hasPreview = Object.keys(patch).length > 0;
            compendiumRewriteState.draft = captured;
            const patchDetails = document.querySelector('[data-compendium-rewrite-patch]');
            if (patchDetails) patchDetails.open = compendiumRewriteState.hasPreview;
            setCompendiumRewriteStatus(compendiumRewriteState.hasPreview ? '建议已生成。确认内容后点击应用。' : 'AI 没有返回可应用的字段，请调整要求后重试。', compendiumRewriteState.hasPreview ? 'ok' : 'error');
        } catch (error) {
            if (currentCompendiumRewrite(requestId)) setCompendiumRewriteStatus(`生成失败：${error.message || error}`, 'error');
        } finally {
            if (requestId === compendiumRewriteState.requestId) {
                compendiumRewriteState.running = false;
                compendiumRewriteState.controller = null;
                renderCompendiumRewriteState();
            }
        }
    }

    async function applyCompendiumRewrite(event) {
        if (event) event.preventDefault();
        const captured = window.captureCompendiumDraft();
        const previewDraft = compendiumRewriteState.draft;
        const elements = compendiumRewriteElements();
        if (!captured || !previewDraft || !currentCompendiumRewrite(compendiumRewriteState.requestId) || !compendiumRewriteState.hasPreview || compendiumRewriteState.running || compendiumRewriteState.saving) return;
        if (captured.version !== previewDraft.version || captured.snapshot !== previewDraft.snapshot || captured.entry.updatedAt !== previewDraft.entry.updatedAt) {
            handleRewriteFieldChange();
            setCompendiumRewriteStatus('资料在预览后发生变化，请重新生成建议。', 'error');
            return;
        }
        let patch;
        try { patch = JSON.parse(elements.preview.value || '{}'); } catch { setCompendiumRewriteStatus('补丁不是有效 JSON', 'error'); return; }
        const fields = selectedRewriteFields();
        patch = restrictRewritePatch(patch, fields);
        if (!Object.keys(patch).length) { setCompendiumRewriteStatus('没有可应用的字段补丁', 'error'); return; }
        const next = { ...captured.entry, ...patch, expectedUpdatedAt: captured.entry.updatedAt, characterProfile: { ...(captured.entry.characterProfile || {}), ...(patch.characterProfile || {}) } };
        const requestId = compendiumRewriteState.requestId;
        compendiumRewriteState.saving = true;
        renderCompendiumRewriteState();
        try {
            const response = await fetch('/api/compendium', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: captured.projectId, entry: next }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            const accepted = window.acceptCompendiumSavedEntry(result.entry, captured);
            if (!currentCompendiumRewrite(requestId)) return;
            compendiumRewriteState.saving = false;
            closeCompendiumRewrite();
            setCompendiumStatus(accepted ? 'AI 字段补丁已应用，资料已保存。' : 'AI 建议已保存，之后输入的内容仍未保存。', 'ok');
        } catch (error) {
            if (currentCompendiumRewrite(requestId)) setCompendiumRewriteStatus(`应用失败：${error.message || error}`, 'error');
        } finally {
            compendiumRewriteState.saving = false;
            renderCompendiumRewriteState();
        }
    }

    function bindCompendiumRewrite() {
        const elements = compendiumRewriteElements();
        if (elements.generate) elements.generate.addEventListener('click', generateCompendiumRewrite);
        if (elements.form) elements.form.addEventListener('submit', applyCompendiumRewrite);
        Array.from(elements.fields || []).forEach((field) => field.addEventListener('change', handleRewriteFieldChange));
        if (elements.instruction) elements.instruction.addEventListener('input', handleRewriteFieldChange);
        if (elements.referenceList) elements.referenceList.addEventListener('change', handleRewriteFieldChange);
        elements.cancel.forEach((button) => button.addEventListener('click', closeCompendiumRewrite));
        if (elements.modal) elements.modal.addEventListener('cancel', (event) => { event.preventDefault(); closeCompendiumRewrite(); });
    }
