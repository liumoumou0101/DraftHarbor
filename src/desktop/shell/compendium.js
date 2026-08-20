    function compendiumElements() {
        return {
            projectLabel: document.querySelector('[data-compendium-project-label]'),
            status: document.querySelector('[data-compendium-status]'),
            search: document.querySelector('[data-compendium-search]'),
            typeFilter: document.querySelector('[data-compendium-type]'),
            list: document.querySelector('[data-compendium-list]'),
            newButton: document.querySelector('[data-compendium-new]'),
            drawButton: document.querySelector('[data-compendium-draw]'),
            agentButton: document.querySelector('[data-compendium-agent]'),
            agentQaButton: document.querySelector('[data-compendium-agent-qa]'),
            form: document.querySelector('[data-compendium-form]'),
            editorTitle: document.querySelector('[data-compendium-editor-title]'),
            entryType: document.querySelector('[data-compendium-entry-type]'),
            title: document.querySelector('[data-compendium-title]'),
            summary: document.querySelector('[data-compendium-summary]'),
            tags: document.querySelector('[data-compendium-tags]'),
            aliases: document.querySelector('[data-compendium-aliases]'),
            always: document.querySelector('[data-compendium-always]'),
            policyMode: document.querySelector('[data-compendium-policy-mode]'),
            triggerTitle: document.querySelector('[data-compendium-trigger-title]'),
            triggerAliases: document.querySelector('[data-compendium-trigger-aliases]'),
            triggerTags: document.querySelector('[data-compendium-trigger-tags]'),
            triggerPov: document.querySelector('[data-compendium-trigger-pov]'),
            triggerSceneCharacters: document.querySelector('[data-compendium-trigger-scene-characters]'),
            character: document.querySelector('[data-compendium-character]'),
            characterRole: document.querySelector('[data-compendium-character-role]'),
            characterGoal: document.querySelector('[data-compendium-character-goal]'),
            characterMotivation: document.querySelector('[data-compendium-character-motivation]'),
            characterConflict: document.querySelector('[data-compendium-character-conflict]'),
            characterVoice: document.querySelector('[data-compendium-character-voice]'),
            characterCurrentState: document.querySelector('[data-compendium-character-current-state]'),
            characterKnowledge: document.querySelector('[data-compendium-character-knowledge]'),
            characterRelationship: document.querySelector('[data-compendium-character-relationship]'),
            body: document.querySelector('[data-compendium-body]'),
            save: document.querySelector('[data-compendium-save]'),
            deleteButton: document.querySelector('[data-compendium-delete]'),
            aiRewrite: document.querySelector('[data-compendium-ai-rewrite]'),
            moreButton: document.querySelector('[data-compendium-more]'),
            moreMenu: document.querySelector('[data-compendium-more-menu]'),
            saveStatus: document.querySelector('[data-compendium-save-status]'),
            typeChips: document.querySelector('[data-compendium-type-chips]'),
            characterDetails: document.querySelector('[data-compendium-character-details]'),
            policyDetails: document.querySelector('[data-compendium-policy-details]')
        };
    }

    function confirmAbandonCompendiumEdits() {
        if (!compendiumState.dirty) return true;
        if (!window.confirm('资料尚未保存，离开将丢失修改。继续？')) return false;
        compendiumState.dirty = false;
        return true;
    }

    function markCompendiumDirty() {
        compendiumState.dirty = true;
        renderCompendiumSaveStatus();
    }

    function renderCompendiumSaveStatus() {
        const { saveStatus } = compendiumElements();
        if (!saveStatus) return;
        if (!selectedCompendiumEntry()) {
            saveStatus.textContent = '';
            saveStatus.dataset.tone = '';
            return;
        }
        saveStatus.textContent = compendiumState.dirty ? '未保存' : '';
        saveStatus.dataset.tone = compendiumState.dirty ? 'warn' : '';
    }

    function characterProfileHasContent(profile) {
        return Object.values(profile || {}).some((value) => String(value || '').trim());
    }

    function closeCompendiumMoreMenu() {
        const { moreButton, moreMenu } = compendiumElements();
        if (moreMenu) moreMenu.hidden = true;
        if (moreButton) moreButton.setAttribute('aria-expanded', 'false');
    }

    function toggleCompendiumMoreMenu() {
        const { moreButton, moreMenu } = compendiumElements();
        if (!moreMenu) return;
        const nextHidden = !moreMenu.hidden ? true : false;
        moreMenu.hidden = nextHidden;
        if (moreButton) moreButton.setAttribute('aria-expanded', nextHidden ? 'false' : 'true');
    }

    function setCompendiumTypeFilter(type) {
        compendiumState.type = type || '';
        const { typeFilter, typeChips } = compendiumElements();
        if (typeFilter) typeFilter.value = compendiumState.type;
        if (typeChips) {
            typeChips.querySelectorAll('[data-compendium-type-chip]').forEach((chip) => {
                const active = (chip.dataset.compendiumTypeChip || '') === compendiumState.type;
                chip.classList.toggle('is-active', active);
                chip.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }
        renderCompendium();
        setCompendiumCountStatus();
    }

    function selectCompendiumEntry(entryId) {
        if (entryId === compendiumState.selectedId) return;
        if (!confirmAbandonCompendiumEdits()) return;
        compendiumState.selectedId = entryId;
        compendiumState.dirty = false;
        renderCompendium();
    }

    function currentProjectId() {
        if (nativeEditorState.snapshot && nativeEditorState.snapshot.project) {
            return nativeEditorState.snapshot.project.id;
        }
        const readerMetadata = typeof readerState !== 'undefined' ? readerState.documentMetadata : null;
        return readerMetadata && readerMetadata.sourceKind === 'project' ? readerMetadata.projectId || '' : '';
    }

    function currentProjectName() {
        if (nativeEditorState.snapshot && nativeEditorState.snapshot.project) {
            return nativeEditorState.snapshot.project.name || nativeEditorState.snapshot.project.title || '未命名项目';
        }
        const readerMetadata = typeof readerState !== 'undefined' ? readerState.documentMetadata : null;
        return readerMetadata && readerMetadata.sourceKind === 'project' ? readerMetadata.title || '未命名项目' : '';
    }

    function selectedCompendiumEntry() {
        return compendiumState.entries.find((entry) => entry.id === compendiumState.selectedId) || null;
    }

    function typeLabel(type) {
        return {
            character: '角色',
            location: '地点',
            organization: '组织',
            item: '物品',
            lore: '设定',
            timeline: '时间线',
            note: '笔记'
        }[type] || '资料';
    }

    function setCompendiumStatus(message, tone = 'info') {
        const { status } = compendiumElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function setCompendiumCountStatus() {
        if (!currentProjectId()) {
            setCompendiumStatus('未打开项目', 'info');
            return;
        }
        setCompendiumStatus(`${filteredCompendiumEntries().length} / ${compendiumState.entries.length} 条资料`, 'ok');
    }

    function parseCommaList(value) {
        return String(value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    }

    function filteredCompendiumEntries() {
        const query = compendiumState.query.trim().toLowerCase();
        return compendiumState.entries.filter((entry) => {
            if (compendiumState.type && entry.type !== compendiumState.type) return false;
            if (!query) return true;
            const haystack = [
                entry.title,
                entry.summary,
                entry.body,
                entry.category,
                ...(entry.tags || []),
                ...(entry.aliases || [])
            ].join('\n').toLowerCase();
            return haystack.includes(query);
        });
    }

    function normalizedContextPolicy(entry) {
        if (window.DraftHarborCompendiumSchema && typeof window.DraftHarborCompendiumSchema.normalizeContextPolicy === 'function') {
            return window.DraftHarborCompendiumSchema.normalizeContextPolicy(
                entry && entry.contextPolicy
                    ? entry.contextPolicy
                    : { mode: entry && entry.alwaysInContext ? 'always' : 'manual' }
            );
        }
        const policy = entry && entry.contextPolicy && typeof entry.contextPolicy === 'object'
            ? entry.contextPolicy
            : {};
        const mode = ['disabled', 'manual', 'mention', 'auto', 'always'].includes(policy.mode) ? policy.mode : (entry && entry.alwaysInContext ? 'always' : 'manual');
        const triggers = policy.triggers && typeof policy.triggers === 'object' ? policy.triggers : {};
        return {
            mode,
            triggers: {
                title: triggers.title !== false,
                aliases: triggers.aliases !== false,
                tags: triggers.tags !== false,
                pov: triggers.pov !== false,
                sceneCharacters: triggers.sceneCharacters !== false
            }
        };
    }

    function compendiumCharacterFields(elements) {
        return [
            elements.characterRole,
            elements.characterGoal,
            elements.characterMotivation,
            elements.characterConflict,
            elements.characterVoice,
            elements.characterCurrentState,
            elements.characterKnowledge,
            elements.characterRelationship
        ];
    }

    function compendiumPolicyFields(elements) {
        return [
            elements.policyMode,
            elements.triggerTitle,
            elements.triggerAliases,
            elements.triggerTags,
            elements.triggerPov,
            elements.triggerSceneCharacters
        ];
    }

    function renderCompendium() {
        const elements = compendiumElements();
        const projectId = currentProjectId();
        const projectName = currentProjectName();
        const selected = selectedCompendiumEntry();
        const hasProject = !!projectId;

        if (elements.projectLabel) {
            elements.projectLabel.textContent = hasProject ? projectName : '从书库打开项目后编辑资料。';
        }
        if (elements.search && elements.search.value !== compendiumState.query) elements.search.value = compendiumState.query;
        if (elements.typeFilter && elements.typeFilter.value !== compendiumState.type) elements.typeFilter.value = compendiumState.type;
        if (elements.typeChips) {
            elements.typeChips.querySelectorAll('[data-compendium-type-chip]').forEach((chip) => {
                const active = (chip.dataset.compendiumTypeChip || '') === compendiumState.type;
                chip.classList.toggle('is-active', active);
                chip.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }
        if (elements.newButton) elements.newButton.disabled = !hasProject || compendiumState.loading;
        if (elements.drawButton) elements.drawButton.disabled = !hasProject || compendiumState.loading;
        if (elements.agentButton) {
            const available = typeof openCompendiumAgent === 'function';
            elements.agentButton.hidden = !available;
            elements.agentButton.disabled = !available || !hasProject || compendiumState.loading;
        }
        if (elements.agentQaButton) {
            const available = typeof openCompendiumAgentQa === 'function';
            elements.agentQaButton.hidden = !available;
            elements.agentQaButton.disabled = !available || !hasProject || compendiumState.loading;
        }

        const compendiumTools = document.querySelector('.desktop-compendium-tools');
        if (compendiumTools) compendiumTools.hidden = !hasProject;

        if (elements.list) {
            elements.list.replaceChildren();
            const entries = filteredCompendiumEntries();
            if (!hasProject) {
                const empty = document.createElement('div');
                empty.className = 'desktop-compendium-item';
                empty.textContent = '先从书库打开一个项目。';
                elements.list.appendChild(empty);
            } else if (!entries.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-compendium-item';
                empty.textContent = compendiumState.entries.length ? '没有匹配的资料。' : '这个项目还没有资料。';
                elements.list.appendChild(empty);
            } else {
                entries.forEach((entry) => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'desktop-compendium-item';
                    item.classList.toggle('is-active', entry.id === compendiumState.selectedId);
                    const title = document.createElement('strong');
                    title.textContent = entry.title || '未命名资料';
                    const meta = document.createElement('span');
                    meta.className = 'desktop-compendium-item-meta';
                    meta.textContent = `${typeLabel(entry.type)}${entry.tags && entry.tags.length ? ` / ${entry.tags.slice(0, 3).join(', ')}` : ''}`;
                    const badge = document.createElement('span');
                    badge.className = 'desktop-compendium-injection-badge';
                    badge.dataset.mode = contextPolicyMode(entry);
                    badge.textContent = contextPolicyLabel(entry);
                    item.append(title, badge, meta);
                    item.addEventListener('click', () => selectCompendiumEntry(entry.id));
                    elements.list.appendChild(item);
                });
            }
        }

        if (elements.editorTitle) elements.editorTitle.textContent = selected ? selected.title : '选择资料条目';

        const editorEmpty = document.querySelector('[data-compendium-editor-empty]');
        const compendiumForm = document.querySelector('[data-compendium-form]');
        const emptyTitle = document.querySelector('[data-compendium-empty-title]');
        const emptyDesc = document.querySelector('[data-compendium-empty-desc]');
        if (!hasProject) {
            if (compendiumForm) compendiumForm.hidden = true;
            if (editorEmpty) {
                editorEmpty.hidden = false;
                if (emptyTitle) emptyTitle.textContent = '未打开项目';
                if (emptyDesc) emptyDesc.textContent = '从书库打开一个项目，即可编辑该项目的资料。';
            }
        } else if (!selected) {
            if (compendiumForm) compendiumForm.hidden = true;
            if (editorEmpty) {
                editorEmpty.hidden = false;
                if (emptyTitle) emptyTitle.textContent = '选择资料条目';
                if (emptyDesc) emptyDesc.textContent = '从左侧列表中选择资料卡进行编辑，或点击「新资料」创建资料卡。';
            }
        } else {
            if (editorEmpty) editorEmpty.hidden = true;
            if (compendiumForm) compendiumForm.hidden = false;
        }

        const fields = [
            elements.entryType,
            elements.title,
            elements.summary,
            elements.tags,
            elements.aliases,
            elements.always,
            elements.body,
            ...compendiumPolicyFields(elements),
            ...compendiumCharacterFields(elements)
        ];
        fields.forEach((field) => {
            if (field) field.disabled = !selected;
        });
        if (elements.save) elements.save.disabled = !selected;
        if (elements.deleteButton) elements.deleteButton.disabled = !selected;
        if (elements.aiRewrite) elements.aiRewrite.disabled = !selected;
        const isCharacter = selected && (selected.type || 'lore') === 'character';
        if (elements.characterDetails) elements.characterDetails.hidden = !isCharacter;
        if (elements.character) elements.character.hidden = !isCharacter;
        if (selected && !compendiumState.dirty) {
            const policy = normalizedContextPolicy(selected);
            const triggers = policy.triggers || {};
            const characterProfile = selected.characterProfile || {};
            if (elements.entryType) elements.entryType.value = selected.type || 'lore';
            if (elements.title) elements.title.value = selected.title || '';
            if (elements.summary) elements.summary.value = selected.summary || '';
            if (elements.tags) elements.tags.value = (selected.tags || []).join(', ');
            if (elements.aliases) elements.aliases.value = (selected.aliases || []).join(', ');
            if (elements.always) elements.always.checked = policy.mode === 'always';
            if (elements.policyMode) elements.policyMode.value = policy.mode || 'manual';
            if (elements.triggerTitle) elements.triggerTitle.checked = triggers.title !== false;
            if (elements.triggerAliases) elements.triggerAliases.checked = triggers.aliases !== false;
            if (elements.triggerTags) elements.triggerTags.checked = triggers.tags !== false;
            if (elements.triggerPov) elements.triggerPov.checked = triggers.pov !== false;
            if (elements.triggerSceneCharacters) elements.triggerSceneCharacters.checked = triggers.sceneCharacters !== false;
            if (elements.characterDetails) elements.characterDetails.open = isCharacter && characterProfileHasContent(characterProfile);
            if (elements.characterRole) elements.characterRole.value = characterProfile.role || '';
            if (elements.characterGoal) elements.characterGoal.value = characterProfile.goal || '';
            if (elements.characterMotivation) elements.characterMotivation.value = characterProfile.motivation || '';
            if (elements.characterConflict) elements.characterConflict.value = characterProfile.conflict || '';
            if (elements.characterVoice) elements.characterVoice.value = characterProfile.voice || '';
            if (elements.characterCurrentState) elements.characterCurrentState.value = characterProfile.currentState || '';
            if (elements.characterKnowledge) elements.characterKnowledge.value = characterProfile.knowledge || '';
            if (elements.characterRelationship) elements.characterRelationship.value = characterProfile.relationshipNotes || '';
            if (elements.body) elements.body.value = selected.body || '';
        } else if (!selected) {
            if (elements.characterDetails) {
                elements.characterDetails.hidden = true;
                elements.characterDetails.open = false;
            }
            fields.forEach((field) => {
                if (!field) return;
                if (field.type === 'checkbox') field.checked = false;
                else field.value = '';
            });
        }
        renderCompendiumSaveStatus();
        renderContextStrip();
    }

    async function loadCompendium() {
        const projectId = currentProjectId();
        if (!projectId) {
            compendiumState.entries = [];
            compendiumState.selectedId = '';
            setCompendiumStatus('未打开项目', 'info');
            renderCompendium();
            return;
        }
        compendiumState.loading = true;
        setCompendiumStatus('正在读取资料...', 'info');
        renderCompendium();
        let failed = false;
        try {
            const params = new URLSearchParams({ projectId });
            const response = await fetch(`/api/compendium?${params.toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumState.entries = result.entries || [];
            if (!compendiumState.entries.some((entry) => entry.id === compendiumState.selectedId)) {
                compendiumState.selectedId = compendiumState.entries[0] ? compendiumState.entries[0].id : '';
            }
            compendiumState.dirty = false;
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.compendium = compendiumState.entries;
        } catch (error) {
            console.warn('Failed to load compendium:', error);
            compendiumState.entries = [];
            compendiumState.selectedId = '';
            failed = true;
            setCompendiumStatus(`读取资料失败：${error.message || error}`, 'error');
        } finally {
            compendiumState.loading = false;
            renderCompendium();
            if (!failed) setCompendiumCountStatus();
        }
    }

    function collectCompendiumForm() {
        const elements = compendiumElements();
        const selected = selectedCompendiumEntry();
        const mode = elements.policyMode ? (elements.policyMode.value || 'manual') : (elements.always && elements.always.checked ? 'always' : 'manual');
        const type = elements.entryType ? elements.entryType.value : 'lore';
        const characterProfile = {
            role: elements.characterRole ? elements.characterRole.value.trim() : '',
            goal: elements.characterGoal ? elements.characterGoal.value.trim() : '',
            motivation: elements.characterMotivation ? elements.characterMotivation.value.trim() : '',
            conflict: elements.characterConflict ? elements.characterConflict.value.trim() : '',
            voice: elements.characterVoice ? elements.characterVoice.value.trim() : '',
            currentState: elements.characterCurrentState ? elements.characterCurrentState.value.trim() : '',
            knowledge: elements.characterKnowledge ? elements.characterKnowledge.value.trim() : '',
            relationshipNotes: elements.characterRelationship ? elements.characterRelationship.value.trim() : ''
        };
        return {
            id: selected && selected.id,
            type,
            category: type,
            title: elements.title ? elements.title.value : '',
            summary: elements.summary ? elements.summary.value : '',
            tags: elements.tags ? parseCommaList(elements.tags.value) : [],
            aliases: elements.aliases ? parseCommaList(elements.aliases.value) : [],
            alwaysInContext: mode === 'always',
            contextPolicy: {
                mode,
                triggers: {
                    title: !elements.triggerTitle || elements.triggerTitle.checked,
                    aliases: !elements.triggerAliases || elements.triggerAliases.checked,
                    tags: !elements.triggerTags || elements.triggerTags.checked,
                    pov: !elements.triggerPov || elements.triggerPov.checked,
                    sceneCharacters: !elements.triggerSceneCharacters || elements.triggerSceneCharacters.checked
                }
            },
            characterProfile: type === 'character' ? characterProfile : undefined,
            body: elements.body ? elements.body.value : ''
        };
    }

    async function saveCompendiumEntry(event) {
        if (event) event.preventDefault();
        const projectId = currentProjectId();
        if (!projectId || !selectedCompendiumEntry()) return;
        try {
            const response = await fetch('/api/compendium', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, entry: collectCompendiumForm() })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumState.dirty = false;
            await loadCompendium();
            compendiumState.selectedId = result.entry.id;
            renderCompendium();
            setCompendiumStatus('资料已保存', 'ok');
        } catch (error) {
            setCompendiumStatus(`保存失败：${error.message || error}`, 'error');
        }
    }

    async function createCompendiumEntry(typeOverride) {
        const projectId = currentProjectId();
        if (!projectId) return;
        if (!confirmAbandonCompendiumEdits()) return;
        const entryType = typeOverride || compendiumState.type || 'lore';
        try {
            const response = await fetch('/api/compendium', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    entry: {
                        type: entryType,
                        category: entryType,
                        title: entryType === 'character' ? '新人物' : '新资料',
                        body: ''
                    }
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumState.selectedId = result.entry.id;
            await loadCompendium();
            setCompendiumStatus(entryType === 'character' ? '已创建新人物卡' : '已创建新资料', 'ok');
        } catch (error) {
            setCompendiumStatus(`创建失败：${error.message || error}`, 'error');
        }
    }

    async function deleteCompendiumEntry() {
        const projectId = currentProjectId();
        const selected = selectedCompendiumEntry();
        if (!projectId || !selected) return;
        if (!window.confirm(`删除资料“${selected.title || '未命名资料'}”？`)) return;
        try {
            const response = await fetch('/api/delete-compendium-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, entryId: selected.id })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumState.selectedId = '';
            await loadCompendium();
            setCompendiumStatus('资料已删除', 'ok');
        } catch (error) {
            setCompendiumStatus(`删除失败：${error.message || error}`, 'error');
        }
    }

    function bindCompendium() {
        const elements = compendiumElements();
        if (elements.search) {
            elements.search.addEventListener('input', () => {
            compendiumState.query = elements.search.value || '';
            renderCompendium();
            setCompendiumCountStatus();
        });
        }
        if (elements.typeFilter) {
            elements.typeFilter.addEventListener('change', () => {
            setCompendiumTypeFilter(elements.typeFilter.value || '');
        });
        }
        if (elements.typeChips) {
            elements.typeChips.addEventListener('click', (event) => {
                const chip = event.target.closest('[data-compendium-type-chip]');
                if (!chip) return;
                setCompendiumTypeFilter(chip.dataset.compendiumTypeChip || '');
            });
        }
        if (elements.moreButton) {
            elements.moreButton.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleCompendiumMoreMenu();
            });
        }
        document.addEventListener('click', (event) => {
            const wrap = document.querySelector('.desktop-compendium-more-wrap');
            if (wrap && !wrap.contains(event.target)) closeCompendiumMoreMenu();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeCompendiumMoreMenu();
        });
        if (elements.newButton) elements.newButton.addEventListener('click', createCompendiumEntry);
        if (elements.drawButton) elements.drawButton.addEventListener('click', () => { closeCompendiumMoreMenu(); openCompendiumDraw(); });
        if (elements.agentButton && typeof openCompendiumAgent === 'function') elements.agentButton.addEventListener('click', () => { closeCompendiumMoreMenu(); openCompendiumAgent(); });
        if (elements.agentQaButton && typeof openCompendiumAgentQa === 'function') elements.agentQaButton.addEventListener('click', () => { closeCompendiumMoreMenu(); openCompendiumAgentQa(); });
        if (elements.aiRewrite) elements.aiRewrite.addEventListener('click', openCompendiumRewrite);
        if (elements.form) elements.form.addEventListener('submit', saveCompendiumEntry);
        if (elements.deleteButton) elements.deleteButton.addEventListener('click', deleteCompendiumEntry);
        [
            elements.entryType,
            elements.title,
            elements.summary,
            elements.tags,
            elements.aliases,
            elements.always,
            elements.body,
            ...compendiumPolicyFields(elements),
            ...compendiumCharacterFields(elements)
        ].forEach((field) => {
            if (!field) return;
            field.addEventListener('input', markCompendiumDirty);
            field.addEventListener('change', markCompendiumDirty);
        });
        if (elements.policyMode) {
            elements.policyMode.addEventListener('change', () => {
                if (elements.always) elements.always.checked = elements.policyMode.value === 'always';
            });
        }
        if (elements.always) {
            elements.always.addEventListener('change', () => {
                if (elements.policyMode) elements.policyMode.value = elements.always.checked ? 'always' : 'manual';
            });
        }
        if (elements.entryType) {
            elements.entryType.addEventListener('change', () => {
                const isCharacter = elements.entryType.value === 'character';
                if (elements.character) elements.character.hidden = !isCharacter;
                if (elements.characterDetails) {
                    elements.characterDetails.hidden = !isCharacter;
                    if (isCharacter) elements.characterDetails.open = true;
                }
            });
        }
        renderCompendium();
    }
