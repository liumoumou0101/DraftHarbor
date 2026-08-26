    async function downloadNativeProjectPackage() {
        const projectId = currentProjectId();
        if (!projectId) {
            setNativeSaveStatus('没有可导出的项目', 'error');
            return;
        }
        if (nativeEditorState.dirty) {
            await saveNativeScene();
        } else {
            flushNativeEditorFields();
        }
        triggerDownload(`/api/export-project-package?${new URLSearchParams({ projectId }).toString()}`);
        setNativeSaveStatus('已开始导出项目包', 'ok');
    }

    function nativeGenerationHistory() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return [];
        return Array.isArray(snapshot.promptHistory) ? snapshot.promptHistory : [];
    }

    function selectedPromptTemplate() {
        return promptState.prompts.find((prompt) => prompt.id === promptState.selectedId)
            || promptState.prompts[0]
            || { id: 'default-prose', title: '均衡续写', category: 'prose', content: '', systemContent: '' };
    }

    function selectedSummaryPromptTemplate(scope) {
        const prompts = summaryPromptState.prompts || [];
        const defaultId = scope === 'chapter' ? 'default-summary-chapter' : 'default-summary-scene';
        const selectedId = summaryPromptState.selectedId || 'auto';
        return (selectedId !== 'auto' && prompts.find((prompt) => prompt.id === selectedId))
            || prompts.find((prompt) => prompt.id === defaultId)
            || prompts[0]
            || { id: defaultId, title: '默认摘要模板', category: 'summary', systemContent: '', content: '' };
    }

    function defaultSummaryPromptTemplates() {
        const schema = window.DraftHarborPromptTemplateSchema;
        return schema && typeof schema.defaultPromptTemplates === 'function'
            ? schema.defaultPromptTemplates('summary', currentProjectId())
            : [];
    }

    async function loadSummaryPrompts() {
        const projectId = currentProjectId();
        if (!projectId) {
            summaryPromptState.prompts = defaultSummaryPromptTemplates();
            summaryPromptState.selectedId = 'auto';
            renderSummaryPromptTemplates();
            return;
        }
        try {
            const response = await fetch(`/api/prompts?${new URLSearchParams({ projectId, category: 'summary' }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            summaryPromptState.prompts = result.prompts || [];
            if (summaryPromptState.selectedId !== 'auto' && !summaryPromptState.prompts.some((prompt) => prompt.id === summaryPromptState.selectedId)) {
                summaryPromptState.selectedId = 'auto';
            }
        } catch (error) {
            console.warn('Failed to load summary prompts:', error);
            summaryPromptState.prompts = defaultSummaryPromptTemplates();
        }
        renderSummaryPromptTemplates();
    }

    function renderSummaryPromptTemplates() {
        const elements = nativeEditorElements();
        if (!elements.summaryTemplate) return;
        elements.summaryTemplate.replaceChildren();
        const automatic = document.createElement('option');
        automatic.value = 'auto';
        automatic.textContent = '自动（按场景/章节选择默认模板）';
        elements.summaryTemplate.appendChild(automatic);
        (summaryPromptState.prompts || []).forEach((prompt) => {
            const option = document.createElement('option');
            option.value = prompt.id;
            option.textContent = prompt.title || '未命名摘要模板';
            elements.summaryTemplate.appendChild(option);
        });
        elements.summaryTemplate.value = summaryPromptState.selectedId || 'auto';
    }

    function isNativeDefaultPrompt(prompt) {
        if (!prompt) return false;
        return !!prompt.isDefault || String(prompt.id || '').indexOf('default-') === 0;
    }

    function promptCategoryLabel(category) {
        const labels = {
            prose: '正文',
            rewrite: '改写',
            summary: '摘要',
            workshop: '讨论',
            workflow: '工作流'
        };
        return labels[category] || '正文';
    }

    function promptManagerSummary(prompt) {
        if (!prompt) return '选择或新建一个提示词';
        if (isNativeDefaultPrompt(prompt)) return '内置模板，可另存为自定义提示词';
        return `${promptCategoryLabel(prompt.category)}自定义模板`;
    }

    async function loadPrompts() {
        const projectId = currentProjectId();
        if (!projectId) {
            promptState.prompts = [];
            promptState.selectedId = 'default-prose';
            renderNativeGeneration();
            return;
        }
        try {
            const response = await fetch(`/api/prompts?${new URLSearchParams({ projectId, category: 'prose' }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            promptState.prompts = result.prompts || [];
            if (!promptState.prompts.some((prompt) => prompt.id === promptState.selectedId)) {
                promptState.selectedId = promptState.prompts[0] ? promptState.prompts[0].id : 'default-prose';
            }
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.prompts = promptState.prompts.filter((prompt) => !isNativeDefaultPrompt(prompt));
        } catch (error) {
            console.warn('Failed to load prompts:', error);
            promptState.prompts = [{ id: 'default-prose', title: '均衡续写', category: 'prose', content: '', systemContent: '' }];
        }
        if (typeof loadWorkshopTemplates === 'function') await loadWorkshopTemplates();
        renderNativeGeneration();
    }

    function renderPromptManager() {
        const elements = nativeEditorElements();
        const prompt = selectedPromptTemplate();
        if (elements.promptManagerList) {
            elements.promptManagerList.replaceChildren();
            const prompts = promptState.prompts.length ? promptState.prompts : [prompt];
            prompts.forEach((item) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.promptManagerSelect = item.id || '';
                button.className = 'desktop-prompt-manager-item';
                button.classList.toggle('is-active', item.id === prompt.id);
                const title = document.createElement('strong');
                title.textContent = item.title || '未命名提示词';
                const meta = document.createElement('span');
                meta.textContent = `${promptCategoryLabel(item.category)} · ${isNativeDefaultPrompt(item) ? '内置' : '自定义'}`;
                button.append(title, meta);
                elements.promptManagerList.appendChild(button);
            });
        }
        if (elements.promptManagerCount) {
            const customCount = promptState.prompts.filter((item) => !isNativeDefaultPrompt(item)).length;
            elements.promptManagerCount.textContent = `${customCount} 个自定义`;
        }
        if (elements.promptManagerStatus) elements.promptManagerStatus.textContent = promptManagerSummary(prompt);
        if (elements.promptManagerTitle) elements.promptManagerTitle.value = prompt.title || '';
        if (elements.promptManagerCategory) elements.promptManagerCategory.value = prompt.category || 'prose';
        if (elements.promptManagerSystem) elements.promptManagerSystem.value = prompt.systemContent || '';
        if (elements.promptManagerContent) elements.promptManagerContent.value = prompt.content || '';
        if (elements.promptManagerDelete) elements.promptManagerDelete.disabled = !prompt || isNativeDefaultPrompt(prompt);
    }

    async function savePromptTemplate(event) {
        if (event) event.preventDefault();
        const projectId = currentProjectId();
        if (!projectId) return;
        const elements = nativeEditorElements();
        const current = selectedPromptTemplate();
        const prompt = {
            id: current && !isNativeDefaultPrompt(current) ? current.id : undefined,
            category: elements.promptManagerCategory ? elements.promptManagerCategory.value : 'prose',
            title: elements.promptManagerTitle ? elements.promptManagerTitle.value : '新提示词',
            systemContent: elements.promptManagerSystem ? elements.promptManagerSystem.value : '',
            content: elements.promptManagerContent ? elements.promptManagerContent.value : ''
        };
        const response = await fetch('/api/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, prompt })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setNativeSaveStatus(`提示词保存失败：${result.error || response.status}`, 'error');
            return;
        }
        promptState.selectedId = result.prompt.id;
        await loadPrompts();
        await loadRewritePrompts();
        await loadSummaryPrompts();
        renderPromptManager();
        setNativeSaveStatus('提示词已保存', 'ok');
    }

    async function deletePromptTemplate() {
        const projectId = currentProjectId();
        const prompt = selectedPromptTemplate();
        if (!projectId || !prompt || isNativeDefaultPrompt(prompt)) return;
        if (!window.confirm(`删除提示词“${prompt.title || '未命名'}”？`)) return;
        const response = await fetch('/api/delete-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, promptId: prompt.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setNativeSaveStatus(`提示词删除失败：${result.error || response.status}`, 'error');
            return;
        }
        promptState.selectedId = 'default-prose';
        await loadPrompts();
        await loadRewritePrompts();
        await loadSummaryPrompts();
        renderPromptManager();
        setNativeSaveStatus('提示词已删除', 'ok');
    }

    function newPromptTemplate() {
        promptState.selectedId = 'default-prose';
        const elements = nativeEditorElements();
        if (elements.promptManagerTitle) elements.promptManagerTitle.value = '新正文提示词';
        if (elements.promptManagerCategory) elements.promptManagerCategory.value = 'prose';
        if (elements.promptManagerSystem) elements.promptManagerSystem.value = '';
        if (elements.promptManagerContent) elements.promptManagerContent.value = '';
        if (elements.promptManagerDelete) elements.promptManagerDelete.disabled = true;
        if (elements.promptManagerStatus) elements.promptManagerStatus.textContent = '正在创建自定义提示词';
        if (elements.promptManagerList) {
            elements.promptManagerList.querySelectorAll('[data-prompt-manager-select]').forEach((button) => {
                button.classList.remove('is-active');
            });
        }
    }

    function renderNativeRewrite() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (elements.rewriteTaskButtons && elements.rewriteTaskButtons.length) {
            elements.rewriteTaskButtons.forEach((btn) => {
                const task = btn.getAttribute('data-native-rewrite-task');
                btn.classList.toggle('is-active', task === nativeEditorState.rewrite.rewriteTask);
            });
        }
        renderRewritePresetOptions();
        if (elements.rewritePreset && elements.rewritePreset.value !== nativeEditorState.rewrite.preset) {
            elements.rewritePreset.value = nativeEditorState.rewrite.preset;
        }
        if (elements.rewriteInstruction && elements.rewriteInstruction.value !== nativeEditorState.rewrite.instruction) {
            elements.rewriteInstruction.value = nativeEditorState.rewrite.instruction;
        }
        if (elements.regenerateUseContext) {
            if (elements.regenerateUseContext.checked !== nativeEditorState.rewrite.regenerateUseContext) {
                elements.regenerateUseContext.checked = nativeEditorState.rewrite.regenerateUseContext;
            }
        }
        const rewriteContextChars = document.querySelector('[data-native-rewrite-context-chars]');
        const regenerateContextChars = document.querySelector('[data-native-regenerate-context-chars]');
        if (rewriteContextChars && Number(rewriteContextChars.value) !== nativeRewriteContextChars()) {
            rewriteContextChars.value = String(nativeRewriteContextChars());
        }
        if (regenerateContextChars) {
            if (Number(regenerateContextChars.value) !== nativeRegenerateContextChars()) {
                regenerateContextChars.value = String(nativeRegenerateContextChars());
            }
            regenerateContextChars.disabled = nativeEditorState.rewrite.regenerateUseContext === false;
        }
        var hasSelection = rememberNativeRewriteSelection();
        if (elements.rewriteOriginalText) {
            var originalText = nativeEditorState.rewrite.originalText || '';
            if (elements.rewriteOriginalText.value !== originalText) {
                elements.rewriteOriginalText.value = originalText;
            }
        }
        updateRewritePresetDescription();
        renderRewriteSavedPrompts();
        if (elements.previewRewrite) elements.previewRewrite.disabled = !scene || !hasSelection || nativeEditorState.generation.inProgress;
        if (elements.startRewrite) elements.startRewrite.disabled = !scene || !hasSelection || nativeEditorState.generation.inProgress;
        if (elements.regenerateSelection) elements.regenerateSelection.disabled = !scene || !hasSelection || nativeEditorState.generation.inProgress;
    }

    function renderNativeCharacters() {
        const elements = nativeEditorElements();
        if (elements.newCharacter) elements.newCharacter.disabled = !currentProjectId();
        if (elements.openCompendium) elements.openCompendium.disabled = !currentProjectId();
        if (!elements.characterList) return;
        elements.characterList.replaceChildren();
        const characters = (compendiumState.entries || [])
            .filter((entry) => entry.type === 'character' || entry.category === 'character')
            .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'));
        if (!characters.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-native-character-card';
            empty.textContent = currentProjectId() ? '还没有人物卡。' : '打开项目后可创建人物卡。';
            elements.characterList.appendChild(empty);
            return;
        }
        characters.forEach((entry) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'desktop-native-character-card';
            const title = document.createElement('strong');
            title.textContent = entry.title || '未命名人物';
            const summary = document.createElement('span');
            summary.textContent = entry.summary || entry.body || '暂无简介';
            item.append(title, summary);
            item.addEventListener('click', () => {
                compendiumState.selectedId = entry.id;
                setView('compendium');
                renderCompendium();
            });
            elements.characterList.appendChild(item);
        });
    }

    function nativeContextStorageKey() {
        return currentProjectId() ? `draftharbor:nativeContext:${currentProjectId()}` : '';
    }

    function saveNativeContextPrefs() {
        const key = nativeContextStorageKey();
        if (!key) return;
        try {
            window.localStorage.setItem(key, JSON.stringify(nativeEditorState.context));
        } catch (error) { /* ignore */ }
    }

    function loadNativeContextPrefs() {
        const key = nativeContextStorageKey();
        nativeEditorState.context = { compendiumIds: [], sceneModes: {} };
        if (!key) return;
        try {
            const parsed = JSON.parse(window.localStorage.getItem(key) || '{}');
            nativeEditorState.context = {
                compendiumIds: Array.isArray(parsed.compendiumIds) ? parsed.compendiumIds : [],
                compendiumTags: Array.isArray(parsed.compendiumTags) ? parsed.compendiumTags : [],
                chapterModes: parsed.chapterModes && typeof parsed.chapterModes === 'object' ? parsed.chapterModes : {},
                sceneModes: parsed.sceneModes && typeof parsed.sceneModes === 'object' ? parsed.sceneModes : {}
            };
        } catch (error) { /* ignore */ }
    }

    function renderNativeContext() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        if (!elements.contextCompendium || !elements.contextScenes) return;
        elements.contextCompendium.replaceChildren();
        if (elements.contextCompendiumTags) elements.contextCompendiumTags.replaceChildren();
        if (elements.contextChapters) elements.contextChapters.replaceChildren();
        elements.contextScenes.replaceChildren();
        if (!snapshot || !snapshot.project) {
            elements.contextCompendium.textContent = '打开项目后选择资料。';
            if (elements.contextCompendiumTags) elements.contextCompendiumTags.textContent = '打开项目后选择资料标签。';
            if (elements.contextChapters) elements.contextChapters.textContent = '打开项目后选择章节。';
            elements.contextScenes.textContent = '打开项目后选择场景。';
            renderNativeContextSummary();
            return;
        }
        const compendium = compendiumState.entries || snapshot.compendium || [];
        if (!compendium.length) {
            elements.contextCompendium.textContent = '暂无资料。';
        } else {
            compendium.forEach((entry) => {
                const label = document.createElement('label');
                label.className = 'desktop-native-context-row';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = nativeEditorState.context.compendiumIds.includes(entry.id);
                input.addEventListener('change', () => {
                    const set = new Set(nativeEditorState.context.compendiumIds);
                    if (input.checked) set.add(entry.id); else set.delete(entry.id);
                    nativeEditorState.context.compendiumIds = Array.from(set);
                    saveNativeContextPrefs();
                    renderNativeContextSummary();
                });
                const text = document.createElement('span');
                text.textContent = `${entry.title || '未命名资料'}${entry.type ? ` · ${entry.type}` : ''}`;
                label.append(input, text);
                elements.contextCompendium.appendChild(label);
            });
        }
        const tagSet = new Set();
        compendium.forEach((entry) => {
            (entry.tags || []).forEach((tag) => {
                const normalized = String(tag || '').trim();
                if (normalized) tagSet.add(normalized);
            });
        });
        if (elements.contextCompendiumTags) {
            const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
            if (!tags.length) {
                elements.contextCompendiumTags.textContent = '暂无资料标签。';
            } else {
                tags.forEach((tag) => {
                    const label = document.createElement('label');
                    label.className = 'desktop-native-context-row';
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = nativeEditorState.context.compendiumTags.includes(tag);
                    input.addEventListener('change', () => {
                        const set = new Set(nativeEditorState.context.compendiumTags);
                        if (input.checked) set.add(tag); else set.delete(tag);
                        nativeEditorState.context.compendiumTags = Array.from(set);
                        saveNativeContextPrefs();
                        renderNativeContextSummary();
                    });
                    const text = document.createElement('span');
                    text.textContent = tag;
                    label.append(input, text);
                    elements.contextCompendiumTags.appendChild(label);
                });
            }
        }
        if (elements.contextChapters) {
            const chapters = [...(snapshot.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
            if (!chapters.length) {
                elements.contextChapters.textContent = '暂无章节。';
            } else {
                chapters.forEach((chapter) => {
                    const row = document.createElement('label');
                    row.className = 'desktop-native-context-row';
                    const select = document.createElement('select');
                    select.value = nativeEditorState.context.chapterModes[chapter.id] || '';
                    [['', '不引用'], ['summary', '摘要'], ['full', '全文']].forEach(([value, label]) => {
                        const option = document.createElement('option');
                        option.value = value;
                        option.textContent = label;
                        select.appendChild(option);
                    });
                    select.addEventListener('change', () => {
                        if (select.value) nativeEditorState.context.chapterModes[chapter.id] = select.value;
                        else delete nativeEditorState.context.chapterModes[chapter.id];
                        saveNativeContextPrefs();
                        renderNativeContextSummary();
                    });
                    const text = document.createElement('span');
                    text.textContent = chapter.title || '未命名章节';
                    row.append(select, text);
                    elements.contextChapters.appendChild(row);
                });
            }
        }
        const scenes = [...(snapshot.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        if (!scenes.length) {
            elements.contextScenes.textContent = '暂无场景。';
        } else {
            scenes.forEach((scene) => {
                const row = document.createElement('label');
                row.className = 'desktop-native-context-row';
                const select = document.createElement('select');
                select.value = nativeEditorState.context.sceneModes[scene.id] || '';
                [['', '不引用'], ['summary', '摘要'], ['full', '全文']].forEach(([value, label]) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    select.appendChild(option);
                });
                select.addEventListener('change', () => {
                    if (select.value) nativeEditorState.context.sceneModes[scene.id] = select.value;
                    else delete nativeEditorState.context.sceneModes[scene.id];
                    saveNativeContextPrefs();
                    renderNativeContextSummary();
                });
                const text = document.createElement('span');
                text.textContent = scene.title || '未命名场景';
                row.append(select, text);
                elements.contextScenes.appendChild(row);
            });
        }
        renderNativeContextSummary();
    }

    function renderNativeContextSummary() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        if (!elements.contextSummary) return;
        if (!snapshot || !snapshot.project) {
            elements.contextSummary.textContent = '打开项目后选择引用的上下文。';
            return;
        }
        const ctx = nativeEditorState.context;
        const compendium = compendiumState.entries || snapshot.compendium || [];
        const selectedEntryIds = new Set(ctx.compendiumIds || []);
        const selectedTagSet = new Set(ctx.compendiumTags || []);
        const tagMatchedIds = new Set();
        const entryMap = new Map();
        compendium.forEach((entry) => {
            entryMap.set(entry.id, entry);
            if (!selectedEntryIds.has(entry.id)) {
                const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t || '').trim()).filter(Boolean) : [];
                if (tags.some((t) => selectedTagSet.has(t))) tagMatchedIds.add(entry.id);
            }
        });
        const chapterModes = ctx.chapterModes || {};
        const sceneModes = ctx.sceneModes || {};
        const selectedChapters = Object.entries(chapterModes).filter(([, mode]) => mode);
        const selectedScenes = Object.entries(sceneModes).filter(([, mode]) => mode);
        const parts = [];
        const directCount = selectedEntryIds.size;
        const tagCount = tagMatchedIds.size;
        if (directCount > 0 || tagCount > 0) {
            const names = [];
            selectedEntryIds.forEach((id) => {
                const entry = entryMap.get(id);
                if (entry) names.push(entry.title || '未命名资料');
            });
            tagMatchedIds.forEach((id) => {
                const entry = entryMap.get(id);
                if (entry) names.push(entry.title || '未命名资料');
            });
            const label = [];
            if (directCount > 0) label.push(`${directCount}条直接引用`);
            if (tagCount > 0) label.push(`${tagCount}条标签匹配`);
            const preview = names.slice(0, 3).join('、');
            const suffix = names.length > 3 ? ` 等${names.length}条` : '';
            parts.push(`资料: ${label.join('，')}（${preview}${suffix}）`);
        }
        if (selectedChapters.length > 0) {
            const modeLabels = { summary: '摘要', full: '全文' };
            const list = selectedChapters.map(([id, mode]) => {
                const chapter = (snapshot.chapters || []).find((c) => c.id === id);
                return `${chapter ? chapter.title || '未命名章节' : '未命名章节'}（${modeLabels[mode] || mode}）`;
            }).join(', ');
            parts.push(`章节引用: ${list}`);
        }
        if (selectedScenes.length > 0) {
            const modeLabels = { summary: '摘要', full: '全文' };
            const list = selectedScenes.map(([id, mode]) => {
                const scene = (snapshot.scenes || []).find((s) => s.id === id);
                return `${scene ? scene.title || '未命名场景' : '未命名场景'}（${modeLabels[mode] || mode}）`;
            }).join(', ');
            parts.push(`场景引用: ${list}`);
        }
        if (parts.length === 0) {
            elements.contextSummary.textContent = '未选择引用上下文。';
            return;
        }
        elements.contextSummary.textContent = parts.join(' | ');
    }

    function rewritePresetCatalog() {
        const schema = window.DraftHarborPromptTemplateSchema;
        if (!schema || typeof schema.defaultPromptTemplates !== 'function') return [];
        return schema.defaultPromptTemplates('rewrite').filter((prompt) => prompt.key);
    }

    function rewritePresetRecord(key) {
        const schema = window.DraftHarborPromptTemplateSchema;
        if (schema && typeof schema.rewritePresetByKey === 'function') {
            return schema.rewritePresetByKey(key);
        }
        return rewritePresetCatalog().find((prompt) => prompt.key === key) || rewritePresetCatalog()[0] || null;
    }

    function renderRewritePresetOptions() {
        const elements = nativeEditorElements();
        if (!elements.rewritePreset) return;
        const current = nativeEditorState.rewrite.preset || 'balanced-polish';
        const presets = rewritePresetCatalog();
        if (!presets.length) return;
        elements.rewritePreset.replaceChildren();
        presets.forEach((prompt) => {
            const option = document.createElement('option');
            option.value = prompt.key;
            option.textContent = prompt.title || prompt.key;
            elements.rewritePreset.appendChild(option);
        });
        const custom = document.createElement('option');
        custom.value = 'custom';
        custom.textContent = '自定义';
        elements.rewritePreset.appendChild(custom);
        elements.rewritePreset.value = presets.some((prompt) => prompt.key === current) || current === 'custom'
            ? current
            : 'balanced-polish';
    }

    function updateRewritePresetDescription() {
        var elements = nativeEditorElements();
        if (!elements.rewritePresetDescription) return;
        var preset = nativeEditorState.rewrite.preset || 'balanced-polish';
        if (preset === 'custom') {
            elements.rewritePresetDescription.textContent = '手动输入改写要求。';
            return;
        }
        var record = rewritePresetRecord(preset);
        elements.rewritePresetDescription.textContent = record && record.hint ? record.hint : '';
    }

    function nativeRewritePreviewPending() {
        const generation = nativeEditorState.generation || {};
        return (generation.task === 'rewrite' || generation.task === 'regenerate-selection')
            && !!(generation.text || generation.inProgress);
    }

    function rememberNativeRewriteSelection() {
        const editor = nativeEditorElements().editor;
        if (nativeRewritePreviewPending()) {
            return nativeEditorState.rewrite.selectionEnd > nativeEditorState.rewrite.selectionStart;
        }
        if (!editor || editor.disabled) return nativeEditorState.rewrite.selectionEnd > nativeEditorState.rewrite.selectionStart;
        const start = Number(editor.selectionStart) || 0;
        const end = Number(editor.selectionEnd) || 0;
        if (end > start) {
            nativeEditorState.rewrite.selectionStart = start;
            nativeEditorState.rewrite.selectionEnd = end;
            nativeEditorState.rewrite.originalText = editor.value.slice(start, end);
            return true;
        }
        return nativeEditorState.rewrite.selectionEnd > nativeEditorState.rewrite.selectionStart;
    }

    function restoreNativeRewriteSelection() {
        const editor = nativeEditorElements().editor;
        if (!editor) return false;
        const liveStart = Number(editor.selectionStart) || 0;
        const liveEnd = Number(editor.selectionEnd) || 0;
        if (liveEnd > liveStart && !nativeRewritePreviewPending()) {
            nativeEditorState.rewrite.selectionStart = liveStart;
            nativeEditorState.rewrite.selectionEnd = liveEnd;
            nativeEditorState.rewrite.originalText = editor.value.slice(liveStart, liveEnd);
            return true;
        }
        const start = Number(nativeEditorState.rewrite.selectionStart) || 0;
        const end = Number(nativeEditorState.rewrite.selectionEnd) || 0;
        if (end <= start) return false;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(start, end);
        return true;
    }

    function rewriteInstructionText() {
        const custom = (nativeEditorState.rewrite.instruction || '').trim();
        if (custom && nativeEditorState.rewrite.preset === 'custom') return custom;
        const record = rewritePresetRecord(nativeEditorState.rewrite.preset || 'balanced-polish');
        return custom || (record && record.content) || '';
    }

    const NATIVE_CONTEXT_BUDGETS_KEY = 'draftharbor:nativeContextBudgets';

    function clampNativeContextChars(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function nativeRewriteContextChars() {
        return clampNativeContextChars(nativeEditorState.rewrite.rewriteContextChars, 0, 8000, 1200);
    }

    function nativeRegenerateContextChars() {
        return clampNativeContextChars(nativeEditorState.rewrite.regenerateContextChars, 0, 20000, 8000);
    }

    function loadNativeContextBudgets() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(NATIVE_CONTEXT_BUDGETS_KEY) || '{}');
            if (!saved || typeof saved !== 'object') return;
            if (saved.rewrite != null) nativeEditorState.rewrite.rewriteContextChars = clampNativeContextChars(saved.rewrite, 0, 8000, 1200);
            if (saved.regenerate != null) nativeEditorState.rewrite.regenerateContextChars = clampNativeContextChars(saved.regenerate, 0, 20000, 8000);
            if (typeof saved.regenerateUseContext === 'boolean') nativeEditorState.rewrite.regenerateUseContext = saved.regenerateUseContext;
        } catch (error) {
            /* ignore */
        }
    }

    function saveNativeContextBudgets() {
        try {
            window.localStorage.setItem(NATIVE_CONTEXT_BUDGETS_KEY, JSON.stringify({
                rewrite: nativeRewriteContextChars(),
                regenerate: nativeRegenerateContextChars(),
                regenerateUseContext: nativeEditorState.rewrite.regenerateUseContext !== false
            }));
        } catch (error) {
            /* ignore */
        }
    }

    async function loadRewritePrompts() {
        const projectId = currentProjectId();
        if (!projectId) {
            rewritePromptState.prompts = [];
            rewritePromptState.selectedId = '';
            renderRewriteSavedPrompts();
            return;
        }
        try {
            const response = await fetch(`/api/prompts?${new URLSearchParams({ projectId, category: 'rewrite' }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            rewritePromptState.prompts = result.prompts || [];
            if (rewritePromptState.selectedId && !rewritePromptState.prompts.some(function (p) { return p.id === rewritePromptState.selectedId; })) {
                rewritePromptState.selectedId = '';
                nativeEditorState.rewrite.savedPromptId = '';
            }
        } catch (error) {
            console.warn('Failed to load rewrite prompts:', error);
            rewritePromptState.prompts = [];
        }
        renderRewriteSavedPrompts();
    }

    function renderRewriteSavedPrompts() {
        var elements = nativeEditorElements();
        if (!elements.rewriteSavedPrompt) return;
        elements.rewriteSavedPrompt.replaceChildren();
        var defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '不使用已保存的 Prompt...';
        elements.rewriteSavedPrompt.appendChild(defaultOption);
        rewritePromptState.prompts.forEach(function (prompt) {
            var option = document.createElement('option');
            option.value = prompt.id;
            option.textContent = prompt.title || '未命名 Prompt';
            if (prompt.id === nativeEditorState.rewrite.savedPromptId) option.selected = true;
            elements.rewriteSavedPrompt.appendChild(option);
        });
        if (elements.rewriteSavedPrompt.value !== (nativeEditorState.rewrite.savedPromptId || '')) {
            elements.rewriteSavedPrompt.value = nativeEditorState.rewrite.savedPromptId || '';
        }
    }

    function buildNativeRewritePrompt() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!scene || !elements.editor) return null;
        if (!restoreNativeRewriteSelection()) return null;
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || 0;
        if (start === end) return null;
        const selectedText = elements.editor.value.slice(start, end);
        nativeEditorState.rewrite.originalText = selectedText;
        nativeEditorState.rewrite.selectionStart = start;
        nativeEditorState.rewrite.selectionEnd = end;
        const instruction = rewriteInstructionText();
        const avoidance = nativeAvoidanceInstruction();
        const contextChars = nativeRewriteContextChars();
        return {
            messages: [
                {
                    role: 'system',
                    content: ['你是小说编辑助手。只输出改写后的正文，不要解释，不要加标题。', avoidance].filter(Boolean).join('\n\n')
                },
                {
                    role: 'user',
                    content: [
                        `改写要求：${instruction}`,
                        '',
                        `当前场景上下文：\n${elements.editor.value.slice(Math.max(0, start - contextChars), Math.min(elements.editor.value.length, end + contextChars))}`,
                        '',
                        `需要改写的文本：\n${selectedText}`,
                        '',
                        '请只输出改写后的文本：'
                    ].join('\n')
                }
            ],
            asString() {
                return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n');
            },
            selection: { start, end, selectedText },
            instruction
        };
    }

    function buildNativeRegenerateSelectionPrompt() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!scene || !elements.editor) return null;
        if (!restoreNativeRewriteSelection()) return null;
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || 0;
        if (start === end) return null;
        const value = elements.editor.value || '';
        const selectedText = value.slice(start, end);
        nativeEditorState.rewrite.originalText = selectedText;
        nativeEditorState.rewrite.selectionStart = start;
        nativeEditorState.rewrite.selectionEnd = end;
        var useContext = nativeEditorState.rewrite.regenerateUseContext !== false;
        const contextChars = nativeRegenerateContextChars();
        const instruction = (nativeEditorState.rewrite.instruction || '').trim() || '重新生成选中文段，使它自然衔接前后文，并保留当前剧情意图。';
        const contextBefore = useContext ? value.slice(Math.max(0, start - contextChars), start) : '[用户选择不发送上下文]';
        const contextAfter = useContext ? value.slice(end, Math.min(value.length, end + contextChars)) : '[用户选择不发送上下文]';
        const contextInstruction = useContext
            ? '必须使用前后文保持连续性，替换文本要能自然插回原位置。'
            : '请根据用户要求重新生成选中文段。';
        return {
            messages: [
                {
                    role: 'system',
                    content: ['你是小说共同写作助手。只输出用于替换选区的小说正文，不要解释，不要加标题，不要使用 Markdown。', nativeAvoidanceInstruction()].filter(Boolean).join('\n\n')
                },
                {
                    role: 'user',
                    content: [
                        '请重新生成选中文段。',
                        contextInstruction,
                        '不要输出前文、后文、标签、分析或说明。',
                        '',
                        `用户要求：${instruction}`,
                        '',
                        `前文：\n${contextBefore}`,
                        '',
                        `需要替换的选中文段：\n${selectedText}`,
                        '',
                        `后文：\n${contextAfter}`,
                        '',
                        '替换后的正文：'
                    ].join('\n')
                }
            ],
            asString() {
                return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n');
            },
            selection: { start, end, selectedText },
            instruction
        };
    }

    function saveWriterModelOverride() {
        try {
            localStorage.setItem(WRITER_MODEL_KEY, JSON.stringify({
                profileId: writerModelOverride.profileId || 'inherit',
                model: writerModelOverride.model || 'inherit',
                customModel: writerModelOverride.customModel || '',
                thinking: !!writerModelOverride.thinking
            }));
        } catch (error) { /* ignore */ }
    }

    function loadWriterModelOverride() {
        try {
            var saved = JSON.parse(localStorage.getItem(WRITER_MODEL_KEY) || '{}');
            if (saved && typeof saved === 'object') {
                writerModelOverride.profileId = saved.profileId || 'inherit';
                writerModelOverride.customModel = String(saved.customModel || '').trim();
                if (saved.model === '__custom__') {
                    writerModelOverride.model = '__custom__';
                } else if (saved.model && saved.model !== 'inherit') {
                    writerModelOverride.model = saved.model;
                } else {
                    writerModelOverride.model = 'inherit';
                }
                writerModelOverride.thinking = !!saved.thinking;
            }
        } catch (error) { /* ignore */ }
    }

    function writerApiProfiles() {
        const settings = settingsWithRuntimeProfiles();
        return (settings.providerProfiles || []).filter((profile) => {
            return profile && profile.id && profile.hasApiKey && modelCatalog().isApiCompatibleProvider(profile.provider);
        });
    }

    function writerEffectiveProfile() {
        const settings = settingsWithRuntimeProfiles();
        const profiles = writerApiProfiles();
        const selectedProfile = profiles.find((profile) => profile.id === writerModelOverride.profileId);
        if (selectedProfile) {
            return {
                id: selectedProfile.id,
                label: selectedProfile.name || selectedProfile.provider || 'API 配置组',
                mode: 'api',
                provider: selectedProfile.provider,
                model: selectedProfile.model || ''
            };
        }
        const provider = settings.providerSettings || {};
        return {
            id: 'inherit',
            label: '继承全局',
            mode: provider.mode || 'local',
            provider: provider.provider || (provider.mode === 'local' ? 'lmstudio' : 'openai-compatible'),
            model: provider.model || ''
        };
    }

    function writerSelectedModelId(effectiveProfile) {
        if (writerModelOverride.model === '__custom__') return writerModelOverride.customModel || '';
        if (writerModelOverride.model && writerModelOverride.model !== 'inherit') return writerModelOverride.model;
        return effectiveProfile.model || '';
    }

    function renderWriterModelControl() {
        var elements = nativeEditorElements();
        if (!elements.modelSelect || !elements.modelControl) return;
        var catalog = modelCatalog();
        var profiles = writerApiProfiles();
        var effectiveProfile = writerEffectiveProfile();
        if (writerModelOverride.profileId !== 'inherit' && !profiles.some((profile) => profile.id === writerModelOverride.profileId)) {
            writerModelOverride.profileId = 'inherit';
            writerModelOverride.model = 'inherit';
            writerModelOverride.customModel = '';
            writerModelOverride.thinking = false;
            saveWriterModelOverride();
            effectiveProfile = writerEffectiveProfile();
        }

        if (elements.profileSelect) {
            elements.profileSelect.replaceChildren();
            const inherit = document.createElement('option');
            inherit.value = 'inherit';
            inherit.textContent = '继承写作默认';
            elements.profileSelect.appendChild(inherit);
            profiles.forEach((profile) => {
                const option = document.createElement('option');
                option.value = profile.id;
                option.textContent = `${profile.name || profile.provider} · ${catalog.getProviderMetadata(profile.provider).label || profile.provider}`;
                elements.profileSelect.appendChild(option);
            });
            elements.profileSelect.value = writerModelOverride.profileId || 'inherit';
        }

        const canSelectModel = effectiveProfile.mode === 'api' && catalog.isApiCompatibleProvider(effectiveProfile.provider);
        elements.modelControl.classList.toggle('is-disabled', !canSelectModel);

        elements.modelSelect.replaceChildren();
        const inheritModel = document.createElement('option');
        inheritModel.value = 'inherit';
        inheritModel.textContent = '继承该配置默认模型';
        elements.modelSelect.appendChild(inheritModel);
        if (canSelectModel) {
            const hidePrivacy = !!(normalizeDesktopSettings(settingsState.settings || {}).modelCatalogPreferences || {}).hidePrivacyRiskModels;
            const models = catalog.getProviderModels(effectiveProfile.provider, {
                catalog: (effectiveProfile.provider === 'opencode-zen' || effectiveProfile.provider === 'opencode-go')
                    ? ((settingsState.modelCatalogs && settingsState.modelCatalogs[effectiveProfile.provider]) || settingsState.modelCatalog)
                    : null,
                hidePrivacyRiskModels: hidePrivacy
            });
            const groups = { free: '免费已兼容', paid: '付费已兼容', other: '其他已兼容', pending: '待适配', offline: '已下线' };
            Object.keys(groups).forEach((key) => {
                const items = models.filter((item) => item.id !== '__custom__' && (catalog.modelGroup ? catalog.modelGroup(item) : 'other') === key);
                if (!items.length) return;
                const group = document.createElement('optgroup');
                group.label = groups[key];
                items.forEach((model) => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = catalog.modelOptionLabel ? catalog.modelOptionLabel(model) : (model.label || model.id);
                    const enabled = catalog.isOpencodeProvider && catalog.isOpencodeProvider(effectiveProfile.provider)
                        ? catalog.isOpencodeGatewayCallable(model)
                        : !(catalog.isModelSelectable && !catalog.isModelSelectable(model) && model.id !== '__custom__');
                    if (!enabled) option.disabled = true;
                    group.appendChild(option);
                });
                elements.modelSelect.appendChild(group);
            });
            models.filter((model) => model.id === '__custom__').forEach((model) => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = '手填模型 ID';
                elements.modelSelect.appendChild(option);
            });
        }
        elements.modelSelect.disabled = !canSelectModel;
        elements.modelSelect.value = writerModelOverride.model || 'inherit';
        if (elements.modelSelect.value !== (writerModelOverride.model || 'inherit')) {
            elements.modelSelect.value = 'inherit';
            writerModelOverride.model = 'inherit';
            writerModelOverride.customModel = '';
            writerModelOverride.thinking = false;
            saveWriterModelOverride();
        }

        if (elements.customModelGroup) elements.customModelGroup.hidden = writerModelOverride.model !== '__custom__';
        if (elements.customModelInput) {
            elements.customModelInput.value = writerModelOverride.customModel || '';
            elements.customModelInput.disabled = !canSelectModel || writerModelOverride.model !== '__custom__';
        }

        const selectedModel = writerSelectedModelId(effectiveProfile);
        const providerLabel = catalog.getProviderMetadata(effectiveProfile.provider).label || effectiveProfile.provider;
        const entry = selectedModel && catalog.getProviderModelEntry
            ? catalog.getProviderModelEntry(effectiveProfile.provider, selectedModel)
            : null;
        const modelLabel = (entry && entry.label) || selectedModel;
        if (elements.modelControlHint) {
            elements.modelControlHint.textContent = canSelectModel
                ? (modelLabel ? `${providerLabel} · ${modelLabel}` : providerLabel)
                : '当前是本地模型。换云端请到设置改写作连接，或选一个配置组';
        }
        const thinkingControl = catalog.getThinkingControl
            ? catalog.getThinkingControl(effectiveProfile.provider, selectedModel)
            : (catalog.isThinkingSupported(effectiveProfile.provider, selectedModel) ? 'toggle' : 'none');
        const thinkingAlwaysOn = thinkingControl === 'always-on';
        const thinkingAllowed = canSelectModel && (thinkingControl === 'toggle'
            || thinkingControl === 'toggle-adaptive'
            || thinkingControl === 'responses-effort');
        const showComposerThinking = canSelectModel && (thinkingAllowed || thinkingAlwaysOn);
        if (!thinkingAllowed && !thinkingAlwaysOn) writerModelOverride.thinking = false;
        (elements.thinkingToggles || []).forEach((toggle) => {
            if (thinkingAlwaysOn && canSelectModel) {
                toggle.disabled = true;
                toggle.checked = true;
            } else {
                toggle.disabled = !thinkingAllowed;
                toggle.checked = !!writerModelOverride.thinking && thinkingAllowed;
            }
        });
        (elements.composerThinking || []).forEach((wrap) => {
            wrap.hidden = !showComposerThinking;
        });
        if (elements.thinkingHint) {
            const hint = thinkingAlwaysOn && canSelectModel ? '该模型思考无法关闭' : '';
            elements.thinkingHint.textContent = hint;
            elements.thinkingHint.hidden = !hint;
        }
        const composerModelName = !canSelectModel
            ? '当前是本地模型'
            : (writerModelOverride.model === '__custom__'
                ? (writerModelOverride.customModel || '手填模型 ID')
                : ((entry && entry.label) || selectedModel || providerLabel || '未选择模型'));
        (elements.composerModelButtons || []).forEach((button) => {
            button.textContent = composerModelName;
            button.title = `打开写作设置 · ${composerModelName}`;
        });

        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const defaults = settings.generationDefaults || {};
        const useProviderDefaults = !!defaults.useProviderDefaults;
        const thinkingActive = canSelectModel && (thinkingAlwaysOn
            || (!!writerModelOverride.thinking && thinkingAllowed));
        const temperatureDisabled = useProviderDefaults || thinkingActive;
        if (elements.writerTemperature) {
            elements.writerTemperature.value = defaults.temperature === undefined ? 0.8 : defaults.temperature;
            elements.writerTemperature.disabled = temperatureDisabled;
        }
        if (elements.writerMaxTokens) {
            elements.writerMaxTokens.value = defaults.maxTokens || 8000;
            elements.writerMaxTokens.disabled = useProviderDefaults;
        }
        if (elements.writerProviderDefaults) {
            elements.writerProviderDefaults.checked = useProviderDefaults;
        }
        if (elements.lengthHint) {
            const hint = defaults.lengthHint || 'natural';
            nativeEditorState.generation.lengthHint = hint;
            elements.lengthHint.value = hint;
        }
        if (elements.writerSamplingHint) {
            const maxTokens = Number(defaults.maxTokens) || 8000;
            const schema = window.DraftHarborSettingsSchema;
            const quotaHint = thinkingActive && schema && typeof schema.thinkingOutputQuotaHint === 'function'
                ? schema.thinkingOutputQuotaHint(maxTokens, true)
                : '';
            if (useProviderDefaults) {
                elements.writerSamplingHint.textContent = '已交给服务商默认参数';
            } else if (thinkingActive) {
                elements.writerSamplingHint.textContent = quotaHint
                    ? `思考模式不发送温度参数。${quotaHint}`
                    : '思考模式不发送温度参数';
            } else if (quotaHint) {
                elements.writerSamplingHint.textContent = quotaHint;
            } else {
                elements.writerSamplingHint.textContent = maxTokens <= 800 ? '输出偏短，适合短句测试' : `约 ${maxTokens} tokens`;
            }
            elements.writerSamplingHint.classList.toggle('is-warn', !!quotaHint);
        }
    }
