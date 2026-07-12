    const compendiumRewriteState = { entryId: '', running: false };

    function compendiumRewriteElements() {
        return {
            modal: document.querySelector('[data-compendium-rewrite-modal]'), form: document.querySelector('[data-compendium-rewrite-form]'),
            fields: document.querySelector('[data-compendium-rewrite-fields]'), instruction: document.querySelector('[data-compendium-rewrite-instruction]'),
            preview: document.querySelector('[data-compendium-rewrite-preview]'), status: document.querySelector('[data-compendium-rewrite-status]'),
            generate: document.querySelector('[data-compendium-rewrite-generate]'), cancel: document.querySelectorAll('[data-compendium-rewrite-cancel]')
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
    }

    function selectedRewriteFields() {
        const { fields } = compendiumRewriteElements();
        return fields ? Array.from(fields.selectedOptions).map((option) => option.value) : [];
    }

    function openCompendiumRewrite() {
        const entry = selectedCompendiumEntry();
        if (!entry) return;
        const elements = compendiumRewriteElements();
        compendiumRewriteState.entryId = entry.id;
        if (elements.fields) Array.from(elements.fields.options).forEach((option) => { option.selected = option.value === 'summary' || option.value === 'body'; });
        if (elements.instruction) elements.instruction.value = '';
        if (elements.preview) elements.preview.value = '';
        setCompendiumRewriteStatus('选择字段并生成补丁；应用前可以手动修改 JSON。');
        if (elements.modal) elements.modal.hidden = false;
    }

    function compendiumRewritePrompt(entry, fields, instruction) {
        return {
            messages: [
                { role: 'system', content: '你是小说资料编辑。只输出 JSON 对象字段补丁，不要 Markdown，不要输出未被要求的字段。允许字段：summary、body、tags、characterProfile（仅包含 goal、motivation、voice）。tags 必须为字符串数组。' },
                { role: 'user', content: `资料卡：\n${JSON.stringify(entry, null, 2)}\n\n只重写字段：${fields.join(', ')}\n要求：${instruction || '让内容更清晰、具体并保持原意。'}` }
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
        if (elements.generate) elements.generate.disabled = true;
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
        if (elements.generate) elements.generate.disabled = false;
        if (!result.ok) { setCompendiumRewriteStatus(`生成失败：${result.error.message}`, 'error'); return; }
        const patch = result.output || {};
        const allowed = new Set(fields.map((field) => field.split('.')[0]));
        Object.keys(patch).forEach((key) => { if (!allowed.has(key)) delete patch[key]; });
        if (elements.preview) elements.preview.value = JSON.stringify(patch, null, 2);
        setCompendiumRewriteStatus('补丁已生成。确认内容后点击应用。', 'ok');
    }

    async function applyCompendiumRewrite(event) {
        if (event) event.preventDefault();
        const entry = selectedCompendiumEntry();
        const elements = compendiumRewriteElements();
        if (!entry || entry.id !== compendiumRewriteState.entryId) return;
        let patch;
        try { patch = JSON.parse(elements.preview.value || '{}'); } catch { setCompendiumRewriteStatus('补丁不是有效 JSON', 'error'); return; }
        const fields = selectedRewriteFields();
        const allowed = new Set(fields.map((field) => field.split('.')[0]));
        Object.keys(patch).forEach((key) => { if (!allowed.has(key)) delete patch[key]; });
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
        elements.cancel.forEach((button) => button.addEventListener('click', closeCompendiumRewrite));
    }
