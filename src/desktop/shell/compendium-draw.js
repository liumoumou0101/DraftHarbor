    const compendiumDrawState = { running: false, hasDraft: false };

    function compendiumDrawElements() {
        return { modal: document.querySelector('[data-compendium-draw-modal]'), form: document.querySelector('[data-compendium-draw-form]'), type: document.querySelector('[data-compendium-draw-type]'), instruction: document.querySelector('[data-compendium-draw-instruction]'), referenceList: document.querySelector('[data-compendium-draw-reference-list]'), referenceCount: document.querySelector('[data-compendium-draw-reference-count]'), title: document.querySelector('[data-compendium-draw-title]'), tags: document.querySelector('[data-compendium-draw-tags]'), summary: document.querySelector('[data-compendium-draw-summary]'), body: document.querySelector('[data-compendium-draw-body]'), status: document.querySelector('[data-compendium-draw-status]'), generate: document.querySelector('[data-compendium-draw-generate]'), save: document.querySelector('[data-compendium-draw-save]'), draft: document.querySelector('[data-compendium-draw-draft]'), character: document.querySelector('[data-compendium-draw-character]'), characterLock: document.querySelector('[data-compendium-draw-character-lock]'), characterRole: document.querySelector('[data-compendium-draw-character-role]'), characterGoal: document.querySelector('[data-compendium-draw-character-goal]'), characterMotivation: document.querySelector('[data-compendium-draw-character-motivation]'), characterConflict: document.querySelector('[data-compendium-draw-character-conflict]'), characterVoice: document.querySelector('[data-compendium-draw-character-voice]'), characterCurrentState: document.querySelector('[data-compendium-draw-character-current-state]'), characterKnowledge: document.querySelector('[data-compendium-draw-character-knowledge]'), characterRelationship: document.querySelector('[data-compendium-draw-character-relationship]'), locks: document.querySelectorAll('[data-compendium-draw-lock]'), cancel: document.querySelectorAll('[data-compendium-draw-cancel]') };
    }
    function setCompendiumDrawStatus(message, tone = 'info') { const { status } = compendiumDrawElements(); if (status) { status.textContent = message || ''; status.dataset.tone = tone; } }
    function drawCharacterProfile(elements) { return { role: elements.characterRole ? elements.characterRole.value.trim() : '', goal: elements.characterGoal ? elements.characterGoal.value.trim() : '', motivation: elements.characterMotivation ? elements.characterMotivation.value.trim() : '', conflict: elements.characterConflict ? elements.characterConflict.value.trim() : '', voice: elements.characterVoice ? elements.characterVoice.value.trim() : '', currentState: elements.characterCurrentState ? elements.characterCurrentState.value.trim() : '', knowledge: elements.characterKnowledge ? elements.characterKnowledge.value.trim() : '', relationshipNotes: elements.characterRelationship ? elements.characterRelationship.value.trim() : '' }; }
    function setDrawCharacterProfile(elements, profile = {}) { const fields = [['characterRole', 'role'], ['characterGoal', 'goal'], ['characterMotivation', 'motivation'], ['characterConflict', 'conflict'], ['characterVoice', 'voice'], ['characterCurrentState', 'currentState'], ['characterKnowledge', 'knowledge'], ['characterRelationship', 'relationshipNotes']]; fields.forEach(([elementName, fieldName]) => { if (elements[elementName]) elements[elementName].value = profile[fieldName] || ''; }); }
    function renderCompendiumDrawState() { const elements = compendiumDrawElements(); const isCharacter = elements.type && elements.type.value === 'character'; if (elements.draft) elements.draft.hidden = !compendiumDrawState.hasDraft; if (elements.character) elements.character.hidden = !compendiumDrawState.hasDraft || !isCharacter; if (elements.characterLock) elements.characterLock.hidden = !compendiumDrawState.hasDraft || !isCharacter; if (elements.generate) elements.generate.textContent = compendiumDrawState.hasDraft ? '重新抽卡' : '生成草稿'; if (elements.save) elements.save.disabled = !compendiumDrawState.hasDraft || compendiumDrawState.running; }
    function closeCompendiumDraw() { const { modal } = compendiumDrawElements(); if (modal) modal.hidden = true; compendiumDrawState.running = false; compendiumDrawState.hasDraft = false; }
    function openCompendiumDraw() {
        if (!currentProjectId()) return;
        const elements = compendiumDrawElements();
        ['title', 'tags', 'summary', 'body'].forEach((key) => { if (elements[key]) elements[key].value = ''; });
        setDrawCharacterProfile(elements);
        renderCompendiumReferencePicker(elements.referenceList, elements.referenceCount);
        if (elements.instruction) elements.instruction.value = '';
        elements.locks.forEach((lock) => { lock.checked = false; });
        compendiumDrawState.hasDraft = false;
        renderCompendiumDrawState();
        setCompendiumDrawStatus('选择类型后抽取一张草稿卡；可锁定字段后重抽。');
        if (elements.modal) elements.modal.hidden = false;
    }
    function currentDrawDraft() {
        const elements = compendiumDrawElements();
        const type = elements.type.value;
        return { type, title: elements.title.value.trim(), tags: parseCommaList(elements.tags.value), summary: elements.summary.value.trim(), body: elements.body.value, characterProfile: type === 'character' ? drawCharacterProfile(elements) : undefined };
    }
    function drawPrompt(type, instruction, locked, references) {
        return { messages: [
            { role: 'system', content: type === 'character'
                ? '你是长篇小说创作助手。输出一张可直接保存的人物资料卡草稿，只返回 JSON：{"cards":[{"type":"character","title":"","summary":"","tags":[""],"body":"","characterProfile":{"role":"","goal":"","motivation":"","conflict":"","voice":"","currentState":"","knowledge":"","relationshipNotes":""}}]}。characterProfile 的每个字段都必须具体填写。'
                : '你是长篇小说创作助手。输出一张可直接保存的资料卡草稿，只返回 JSON：{"cards":[{"type":"organization|location|item|lore|timeline","title":"","summary":"","tags":[""],"body":""}]}' },
            { role: 'user', content: `生成类型：${type}\n灵感：${instruction || '自由发挥，但要具体、有后续剧情价值。'}\n锁定字段（必须原样保留）：${JSON.stringify(locked)}${compendiumReferencesPromptBlock(references)}` }
        ], asString() { return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n'); } };
    }
    async function generateCompendiumDraw() {
        const elements = compendiumDrawElements(); if (compendiumDrawState.running) return;
        const before = currentDrawDraft(); const locked = {};
        elements.locks.forEach((lock) => { if (lock.checked) locked[lock.dataset.compendiumDrawLock] = before[lock.dataset.compendiumDrawLock]; });
        compendiumDrawState.running = true; if (elements.generate) elements.generate.disabled = true; renderCompendiumDrawState(); setCompendiumDrawStatus('正在抽取草稿卡…');
        const profile = writerEffectiveProfile();
        const task = { projectId: currentProjectId(), domain: 'compendium', action: 'draw', scope: 'project', target: { type: 'compendium-draw', projectId: currentProjectId(), id: `draw-${elements.type.value}` }, instruction: elements.instruction.value.trim(), model: writerSelectedModelId(profile), outputContract: 'card-drafts', beforeSnapshot: { locked } };
        const result = await getNativeAITaskRunner().run(task, { prompt: drawPrompt(elements.type.value, task.instruction, locked, selectedCompendiumReferenceCards(elements.referenceList)), providerConfig: nativeGenerationConfig(), onToken: ({ text }) => setCompendiumDrawStatus(`正在接收草稿… ${text.length} 字`) });
        compendiumDrawState.running = false; if (elements.generate) elements.generate.disabled = false;
        if (!result.ok) { setCompendiumDrawStatus(`抽取失败：${result.error.message}`, 'error'); return; }
        const draft = { ...(result.output[0] || {}), ...locked };
        if (elements.type && draft.type) elements.type.value = draft.type;
        if (elements.title) elements.title.value = draft.title || '';
        if (elements.tags) elements.tags.value = Array.isArray(draft.tags) ? draft.tags.join(', ') : '';
        if (elements.summary) elements.summary.value = draft.summary || '';
        if (elements.body) elements.body.value = draft.body || draft.content || '';
        setDrawCharacterProfile(elements, draft.characterProfile || {});
        compendiumDrawState.hasDraft = true;
        renderCompendiumDrawState();
        setCompendiumDrawStatus('草稿已生成。可继续重抽或确认保存。', 'ok');
    }
    async function saveCompendiumDraw(event) {
        if (event) event.preventDefault(); const draft = currentDrawDraft();
        if (!draft.title) { setCompendiumDrawStatus('请填写标题', 'error'); return; }
        try {
            const response = await fetch('/api/compendium', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: currentProjectId(), entry: { ...draft, contextPolicy: { mode: 'manual' } } })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadCompendium(); compendiumState.selectedId = result.entry.id; closeCompendiumDraw(); setView('compendium'); renderCompendium(); setCompendiumStatus(`已保存抽卡资料：${result.entry.title}`, 'ok');
        } catch (error) { setCompendiumDrawStatus(`保存失败：${error.message || error}`, 'error'); }
    }
    function bindCompendiumDraw() { const elements = compendiumDrawElements(); if (elements.generate) elements.generate.addEventListener('click', generateCompendiumDraw); if (elements.form) elements.form.addEventListener('submit', saveCompendiumDraw); elements.cancel.forEach((button) => button.addEventListener('click', closeCompendiumDraw)); }
