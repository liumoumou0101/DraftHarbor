    const compendiumExtractionState = { source: null, running: false };

    function compendiumExtractionElements() {
        return {
            modal: document.querySelector('[data-native-extract-modal]'), form: document.querySelector('[data-native-extract-form]'),
            type: document.querySelector('[data-native-extract-type]'), source: document.querySelector('[data-native-extract-source]'),
            title: document.querySelector('[data-native-extract-title]'), tags: document.querySelector('[data-native-extract-tags]'),
            summary: document.querySelector('[data-native-extract-summary]'), body: document.querySelector('[data-native-extract-body]'),
            referenceList: document.querySelector('[data-native-extract-reference-list]'), referenceCount: document.querySelector('[data-native-extract-reference-count]'),
            character: document.querySelector('[data-native-extract-character]'), characterRole: document.querySelector('[data-native-extract-character-role]'), characterGoal: document.querySelector('[data-native-extract-character-goal]'), characterMotivation: document.querySelector('[data-native-extract-character-motivation]'), characterConflict: document.querySelector('[data-native-extract-character-conflict]'), characterVoice: document.querySelector('[data-native-extract-character-voice]'), characterCurrentState: document.querySelector('[data-native-extract-character-current-state]'), characterKnowledge: document.querySelector('[data-native-extract-character-knowledge]'), characterRelationship: document.querySelector('[data-native-extract-character-relationship]'),
            status: document.querySelector('[data-native-extract-status]'), generate: document.querySelector('[data-native-extract-generate]'),
            cancel: document.querySelectorAll('[data-native-extract-cancel]')
        };
    }

    function setCompendiumExtractionStatus(message, tone = 'info') {
        const { status } = compendiumExtractionElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }
    function extractionCharacterProfile(elements) { return { role: elements.characterRole.value.trim(), goal: elements.characterGoal.value.trim(), motivation: elements.characterMotivation.value.trim(), conflict: elements.characterConflict.value.trim(), voice: elements.characterVoice.value.trim(), currentState: elements.characterCurrentState.value.trim(), knowledge: elements.characterKnowledge.value.trim(), relationshipNotes: elements.characterRelationship.value.trim() }; }
    function setExtractionCharacterProfile(elements, profile = {}) { [['characterRole', 'role'], ['characterGoal', 'goal'], ['characterMotivation', 'motivation'], ['characterConflict', 'conflict'], ['characterVoice', 'voice'], ['characterCurrentState', 'currentState'], ['characterKnowledge', 'knowledge'], ['characterRelationship', 'relationshipNotes']].forEach(([elementName, fieldName]) => { if (elements[elementName]) elements[elementName].value = profile[fieldName] || ''; }); }
    function renderExtractionType() { const elements = compendiumExtractionElements(); if (elements.character) elements.character.hidden = !elements.type || elements.type.value !== 'character'; }

    function closeNativeCompendiumExtraction() {
        const { modal } = compendiumExtractionElements();
        if (modal) modal.hidden = true;
        compendiumExtractionState.source = null;
        compendiumExtractionState.running = false;
    }

    function openNativeCompendiumExtraction() {
        const projectId = currentProjectId();
        const payload = nativeSelectedOrSceneExcerpt();
        if (!projectId || !payload.scene || !payload.selected) {
            setNativeSaveStatus('请先在正文中选中要提取的文字', 'error');
            return;
        }
        const elements = compendiumExtractionElements();
        compendiumExtractionState.source = { projectId, sceneId: payload.scene.id, excerpt: payload.selected, sceneTitle: payload.scene.title || '当前场景' };
        if (elements.source) elements.source.value = payload.selected;
        if (elements.title) elements.title.value = '';
        if (elements.tags) elements.tags.value = '';
        if (elements.summary) elements.summary.value = '';
        if (elements.body) elements.body.value = '';
        if (elements.type) elements.type.value = 'character';
        setExtractionCharacterProfile(elements);
        renderExtractionType();
        renderCompendiumReferencePicker(elements.referenceList, elements.referenceCount);
        setCompendiumExtractionStatus('选择类型后生成草稿，或直接手动填写。');
        if (elements.modal) elements.modal.hidden = false;
    }

    function extractionPrompt(source, type, references) {
        return {
            messages: [
                { role: 'system', content: type === 'character' ? '你是小说资料编辑。只根据给出的正文选区提取一张人物资料卡草稿。必须返回 JSON，不要使用 Markdown。JSON 格式：{"cards":[{"type":"character","title":"","summary":"","tags":[""],"aliases":[""],"body":"","characterProfile":{"role":"","goal":"","motivation":"","conflict":"","voice":"","currentState":"","knowledge":"","relationshipNotes":""}}]}。正文没有明确支持的约束字段可留空，不能编造。' : '你是小说资料编辑。只根据给出的正文选区提取一张资料卡草稿。必须返回 JSON，不要使用 Markdown。JSON 格式：{"cards":[{"type":"location|organization|item|lore|timeline|note","title":"","summary":"","tags":[""],"aliases":[""],"body":""}]}' },
                { role: 'user', content: `目标类型：${type}\n场景：${source.sceneTitle}\n\n正文选区：\n${source.excerpt}${compendiumReferencesPromptBlock(references)}` }
            ],
            asString() { return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n'); }
        };
    }

    async function generateNativeCompendiumDraft() {
        const source = compendiumExtractionState.source;
        const elements = compendiumExtractionElements();
        if (!source || compendiumExtractionState.running) return;
        compendiumExtractionState.running = true;
        if (elements.generate) elements.generate.disabled = true;
        setCompendiumExtractionStatus('正在提取资料卡草稿...', 'info');
        const profile = writerEffectiveProfile();
        const task = {
            projectId: source.projectId, domain: 'compendium', action: 'extract', scope: 'selection',
            target: { type: 'scene-selection', sceneId: source.sceneId, id: source.sceneId },
            instruction: `从正文选区提取${elements.type ? elements.type.value : 'character'}资料卡`,
            model: writerSelectedModelId(profile), outputContract: 'card-drafts',
            beforeSnapshot: { sceneId: source.sceneId, excerpt: source.excerpt }
        };
        const result = await getNativeAITaskRunner().run(task, {
            prompt: extractionPrompt(source, elements.type ? elements.type.value : 'character', selectedCompendiumReferenceCards(elements.referenceList)),
            providerConfig: nativeGenerationConfig(),
            onToken: ({ text }) => setCompendiumExtractionStatus(`正在接收草稿… ${text.length} 字`, 'info')
        });
        compendiumExtractionState.running = false;
        if (elements.generate) elements.generate.disabled = false;
        if (!result.ok) { setCompendiumExtractionStatus(`提取失败：${result.error.message}`, 'error'); return; }
        const draft = result.output[0] || {};
        if (elements.type && draft.type) elements.type.value = draft.type;
        if (elements.title) elements.title.value = draft.title || '';
        if (elements.tags) elements.tags.value = Array.isArray(draft.tags) ? draft.tags.join(', ') : '';
        if (elements.summary) elements.summary.value = draft.summary || '';
        if (elements.body) elements.body.value = draft.body || draft.content || '';
        setExtractionCharacterProfile(elements, draft.characterProfile || {});
        renderExtractionType();
        setCompendiumExtractionStatus('草稿已生成。请检查并确认保存。', 'ok');
    }

    async function saveNativeCompendiumDraft(event) {
        if (event) event.preventDefault();
        const source = compendiumExtractionState.source;
        const elements = compendiumExtractionElements();
        if (!source) return;
        const entry = {
            type: elements.type.value, title: elements.title.value.trim(), summary: elements.summary.value.trim(), body: elements.body.value,
            tags: parseCommaList(elements.tags.value), characterProfile: elements.type.value === 'character' ? extractionCharacterProfile(elements) : undefined, relatedSceneIds: [source.sceneId],
            sourceReferences: [{ sceneId: source.sceneId, excerpt: source.excerpt }], contextPolicy: { mode: 'manual' }
        };
        if (!entry.title) { setCompendiumExtractionStatus('请填写资料卡标题', 'error'); return; }
        try {
            const response = await fetch('/api/compendium', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: source.projectId, entry }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadCompendium();
            compendiumState.selectedId = result.entry.id;
            closeNativeCompendiumExtraction();
            setNativeSaveStatus(`已保存资料卡：${result.entry.title}`, 'ok');
            setView('compendium');
            renderCompendium();
        } catch (error) { setCompendiumExtractionStatus(`保存失败：${error.message || error}`, 'error'); }
    }

    function bindNativeCompendiumExtraction() {
        const elements = compendiumExtractionElements();
        if (elements.generate) elements.generate.addEventListener('click', generateNativeCompendiumDraft);
        if (elements.form) elements.form.addEventListener('submit', saveNativeCompendiumDraft);
        if (elements.type) elements.type.addEventListener('change', renderExtractionType);
        elements.cancel.forEach((button) => button.addEventListener('click', closeNativeCompendiumExtraction));
    }
