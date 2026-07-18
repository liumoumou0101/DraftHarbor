    const compendiumRewriteState = { entryId: '', running: false, hasPreview: false };

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
        const { modal } = compendiumRewriteElements();
        if (modal) modal.hidden = true;
        compendiumRewriteState.entryId = '';
        compendiumRewriteState.running = false;
        compendiumRewriteState.hasPreview = false;
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
        const { generate, apply } = compendiumRewriteElements();
        if (generate) generate.disabled = compendiumRewriteState.running;
        if (apply) apply.disabled = compendiumRewriteState.running || !compendiumRewriteState.hasPreview;
        updateRewriteSelectionSummary();
    }

    function handleRewriteFieldChange() {
        const { preview } = compendiumRewriteElements();
        if (compendiumRewriteState.hasPreview) {
            compendiumRewriteState.hasPreview = false;
            if (preview) preview.value = '';
            setCompendiumRewriteStatus('已调整字段选择，请重新生成补丁。');
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
        const entry = selectedCompendiumEntry();
        if (!entry) return;
        const elements = compendiumRewriteElements();
        compendiumRewriteState.entryId = entry.id;
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
        setCompendiumRewriteStatus('勾选要补全的字段后生成补丁。可一次处理多个字段，生成后仍可手动修改 JSON。');
        if (elements.modal) elements.modal.hidden = false;
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
        const entry = selectedCompendiumEntry();
        const elements = compendiumRewriteElements();
        const fields = selectedRewriteFields();
        if (!entry || entry.id !== compendiumRewriteState.entryId || compendiumRewriteState.running) return;
        if (!fields.length) { setCompendiumRewriteStatus('请至少选择一个字段', 'error'); return; }
        compendiumRewriteState.running = true;
        compendiumRewriteState.hasPreview = false;
        renderCompendiumRewriteState();
        setCompendiumRewriteStatus('正在生成字段补丁…');
        const profile = writerEffectiveProfile();
        const task = {
            projectId: currentProjectId(), domain: 'compendium', action: 'rewrite', scope: 'fields',
            target: { type: 'compendium-entry', entryId: entry.id, id: entry.id }, instruction: elements.instruction.value.trim(),
            model: writerSelectedModelId(profile), outputContract: 'field-patch', beforeSnapshot: entry
        };
        const result = await getNativeAITaskRunner().run(task, {
            prompt: compendiumRewritePrompt(entry, fields, task.instruction), providerConfig: nativeGenerationConfig(),
            onToken: ({ text }) => setCompendiumRewriteStatus(`正在接收补丁… ${text.length} 字`)
        });
        compendiumRewriteState.running = false;
        if (!result.ok) { renderCompendiumRewriteState(); setCompendiumRewriteStatus(`生成失败：${result.error.message}`, 'error'); return; }
        const patch = restrictRewritePatch(result.output, fields);
        if (elements.preview) elements.preview.value = JSON.stringify(patch, null, 2);
        compendiumRewriteState.hasPreview = Object.keys(patch).length > 0;
        renderCompendiumRewriteState();
        if (!compendiumRewriteState.hasPreview) { setCompendiumRewriteStatus('AI 没有返回可应用的补丁，请调整要求后重试。', 'error'); return; }
        setCompendiumRewriteStatus('补丁已生成。确认内容后点击应用。', 'ok');
    }

    async function applyCompendiumRewrite(event) {
        if (event) event.preventDefault();
        const entry = selectedCompendiumEntry();
        const elements = compendiumRewriteElements();
        if (!entry || entry.id !== compendiumRewriteState.entryId || !compendiumRewriteState.hasPreview) return;
        let patch;
        try { patch = JSON.parse(elements.preview.value || '{}'); } catch { setCompendiumRewriteStatus('补丁不是有效 JSON', 'error'); return; }
        const fields = selectedRewriteFields();
        patch = restrictRewritePatch(patch, fields);
        if (!Object.keys(patch).length) { setCompendiumRewriteStatus('没有可应用的字段补丁', 'error'); return; }
        const next = { ...entry, ...patch, characterProfile: { ...(entry.characterProfile || {}), ...(patch.characterProfile || {}) } };
        try {
            const response = await fetch('/api/compendium', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId(), entry: next }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadCompendium();
            compendiumState.selectedId = result.entry.id;
            closeCompendiumRewrite();
            renderCompendium();
            setCompendiumStatus('AI 字段补丁已应用，记得确认资料内容。', 'ok');
        } catch (error) { setCompendiumRewriteStatus(`应用失败：${error.message || error}`, 'error'); }
    }

    function bindCompendiumRewrite() {
        const elements = compendiumRewriteElements();
        if (elements.generate) elements.generate.addEventListener('click', generateCompendiumRewrite);
        if (elements.form) elements.form.addEventListener('submit', applyCompendiumRewrite);
        Array.from(elements.fields || []).forEach((field) => field.addEventListener('change', handleRewriteFieldChange));
        elements.cancel.forEach((button) => button.addEventListener('click', closeCompendiumRewrite));
    }
