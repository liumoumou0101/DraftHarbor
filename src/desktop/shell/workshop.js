    function workshopElements() {
        return {
            projectLabel: document.querySelector('[data-workshop-project-label]'),
            projectSummary: document.querySelector('[data-workshop-project-summary]'),
            projectName: document.querySelector('[data-workshop-project-name]'),
            projectStats: document.querySelector('[data-workshop-project-stats]'),
            status: document.querySelector('[data-workshop-status]'),
            newButton: document.querySelector('[data-workshop-new]'),
            list: document.querySelector('[data-workshop-session-list]'),
            title: document.querySelector('[data-workshop-title]'),
            deleteButton: document.querySelector('[data-workshop-delete]'),
            contractEnabled: document.querySelector('[data-workshop-contract-enabled]'),
            contractContent: document.querySelector('[data-workshop-contract-content]'),
            contractSave: document.querySelector('[data-workshop-contract-save]'),
            messages: document.querySelector('[data-workshop-messages]'),
            emptyState: document.querySelector('[data-workshop-empty]'),
            emptyContent: document.querySelector('[data-workshop-empty-content]'),
            input: document.querySelector('[data-workshop-input]'),
            inputRow: document.querySelector('.desktop-workshop-input-row'),
            composer: document.querySelector('.desktop-workshop-composer'),
            template: document.querySelector('[data-workshop-template]'),
            send: document.querySelector('[data-workshop-send]'),
            toCompendium: document.querySelector('[data-workshop-to-compendium]'),
            toSummary: document.querySelector('[data-workshop-to-summary]'),
            insertDraft: document.querySelector('[data-workshop-insert-draft]'),
            outputActions: document.querySelector('[data-workshop-output-actions]')
        };
    }

    function selectedWorkshopSession() {
        return workshopState.sessions.find((session) => session.id === workshopState.selectedId) || null;
    }

    function defaultWorkshopTemplates() {
        const schema = window.DraftHarborPromptTemplateSchema;
        return schema && typeof schema.defaultPromptTemplates === 'function'
            ? schema.defaultPromptTemplates('workshop', currentProjectId())
            : [];
    }

    function selectedWorkshopTemplate() {
        const session = selectedWorkshopSession();
        const templateId = (session && session.promptTemplateId) || 'default-workshop-coach';
        return workshopState.templates.find((prompt) => prompt.id === templateId)
            || workshopState.templates[0]
            || {};
    }

    function renderWorkshopTemplateOptions() {
        const elements = workshopElements();
        if (!elements.template) return;
        const session = selectedWorkshopSession();
        const current = (session && session.promptTemplateId) || 'default-workshop-coach';
        if (!workshopState.templates.length) {
            workshopState.templates = defaultWorkshopTemplates();
        }
        elements.template.replaceChildren();
        workshopState.templates.forEach((prompt) => {
            const option = document.createElement('option');
            option.value = prompt.id;
            option.textContent = prompt.title || prompt.id;
            elements.template.appendChild(option);
        });
        if (workshopState.templates.some((prompt) => prompt.id === current)) {
            elements.template.value = current;
        }
    }

    async function loadWorkshopTemplates() {
        const projectId = currentProjectId();
        const defaults = defaultWorkshopTemplates();
        if (!projectId) {
            workshopState.templates = defaults;
            return;
        }
        try {
            const response = await fetch(`/api/prompts?${new URLSearchParams({ projectId, category: 'workshop' }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workshopState.templates = result.prompts && result.prompts.length ? result.prompts : defaults;
        } catch (error) {
            console.warn('Failed to load workshop prompts:', error);
            workshopState.templates = defaults;
        }
    }

    function selectedAssistantMessage() {
        const session = selectedWorkshopSession();
        if (!session) return null;
        if (workshopState.selectedAssistantMessageId) {
            const selected = (session.messages || []).find((message) => message.id === workshopState.selectedAssistantMessageId);
            if (selected && selected.role === 'assistant') return selected;
        }
        return [...(session.messages || [])].reverse().find((message) => message.role === 'assistant' && message.content) || null;
    }

    function setWorkshopStatus(message, tone = 'info') {
        const { status } = workshopElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function renderWorkshop() {
        const elements = workshopElements();
        const projectId = currentProjectId();
        const projectName = currentProjectName();
        const session = selectedWorkshopSession();
        const assistant = selectedAssistantMessage();
        if (elements.projectLabel) elements.projectLabel.textContent = projectId ? `当前项目：${projectName}` : '请先在书库打开或新建一个项目。';
        if (elements.projectSummary) {
            elements.projectSummary.hidden = !projectId;
            if (projectId) {
                if (elements.projectName) elements.projectName.textContent = projectName;
                const scene = currentNativeScene();
                const entries = compendiumState.entries || [];
                if (elements.projectStats) elements.projectStats.textContent = `${workshopState.sessions.length} 个对话${entries.length ? ` · ${entries.length} 张资料` : ''}${scene ? ` · 当前场景：${scene.title || '未命名'}` : ''}`;
            }
        }
        if (elements.newButton) elements.newButton.disabled = !projectId || workshopState.generating;
        if (elements.deleteButton) elements.deleteButton.disabled = !session || workshopState.generating;
        if (elements.title) elements.title.textContent = session ? session.title : '选择或新建对话';
        if (elements.contractEnabled) {
            elements.contractEnabled.disabled = !session || workshopState.generating;
            elements.contractEnabled.checked = !!(session && session.directiveContract && session.directiveContract.enabled);
        }
        if (elements.contractContent) {
            elements.contractContent.disabled = !session || workshopState.generating;
            const contractText = session && session.directiveContract ? session.directiveContract.content || '' : '';
            if (elements.contractContent.value !== contractText) elements.contractContent.value = contractText;
        }
        if (elements.contractSave) elements.contractSave.disabled = !session || workshopState.generating;
        if (elements.input && elements.input.value !== workshopState.input) elements.input.value = workshopState.input;
        if (elements.input) elements.input.disabled = !session || workshopState.generating;
        if (elements.inputRow) elements.inputRow.hidden = !session;
        if (elements.composer) elements.composer.hidden = !session;
        renderWorkshopTemplateOptions();
        if (elements.template) {
            elements.template.disabled = !session || workshopState.generating;
            if (session) elements.template.value = session.promptTemplateId || 'default-workshop-coach';
        }
        if (elements.send) elements.send.disabled = !session || workshopState.generating || !workshopState.input.trim();
        [elements.toCompendium, elements.toSummary, elements.insertDraft].forEach((button) => {
            if (button) {
                button.disabled = !assistant || workshopState.generating;
            }
        });
        if (elements.outputActions) elements.outputActions.hidden = !assistant;

        if (elements.list) {
            elements.list.replaceChildren();
            if (!projectId) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workshop-session';
                empty.textContent = '打开项目后创建对话。';
                elements.list.appendChild(empty);
            } else if (!workshopState.sessions.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workshop-session';
                empty.textContent = '还没有对话。';
                elements.list.appendChild(empty);
            } else {
                workshopState.sessions.forEach((item) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-workshop-session';
                    button.classList.toggle('is-active', item.id === workshopState.selectedId);
                    const title = document.createElement('strong');
                    title.textContent = item.title || '新对话';
                    const meta = document.createElement('span');
                    meta.textContent = `${(item.messages || []).length} 条消息`;
                    button.append(title, meta);
                    button.addEventListener('click', () => {
                        workshopState.selectedId = item.id;
                        workshopState.selectedAssistantMessageId = '';
                        renderWorkshop();
                    });
                    elements.list.appendChild(button);
                });
            }
        }

        if (elements.emptyState && elements.emptyContent) {
            const hasMessages = session && (session.messages || []).length > 0;
            if (!projectId) {
                elements.emptyState.hidden = false;
                elements.emptyContent.replaceChildren();
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\uD83D\uDCAC';
                const heading = document.createElement('h3');
                heading.textContent = '创作讨论空间';
                const desc = document.createElement('p');
                desc.textContent = '在 Workshop 中与 AI 讨论角色、情节、设定，并将讨论结果转化为资料、摘要或正文。';
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '去书库打开项目';
                action.addEventListener('click', () => setView('bookshelf'));
                elements.emptyContent.append(icon, heading, desc, action);
            } else if (!workshopState.sessions.length) {
                elements.emptyState.hidden = false;
                elements.emptyContent.replaceChildren();
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\u270D\uFE0F';
                const heading = document.createElement('h3');
                heading.textContent = '创建第一场讨论';
                const desc = document.createElement('p');
                desc.textContent = `在《${projectName}》的创作讨论中，与 AI 协作推进故事。`;
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '开始新对话';
                action.addEventListener('click', () => createWorkshopSession());
                action.disabled = workshopState.generating;
                elements.emptyContent.append(icon, heading, desc, action);
            } else if (!session) {
                elements.emptyState.hidden = false;
                elements.emptyContent.replaceChildren();
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\uD83D\uDCDD';
                const heading = document.createElement('h3');
                heading.textContent = '选择对话';
                const desc = document.createElement('p');
                const count = workshopState.sessions.length;
                desc.textContent = `共有 ${count} 个对话。从左侧列表选择或新建。`;
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '新建对话';
                action.addEventListener('click', () => createWorkshopSession());
                action.disabled = workshopState.generating;
                elements.emptyContent.append(icon, heading, desc, action);
            } else {
                elements.emptyState.hidden = true;
            }
        }

        if (elements.messages) {
            elements.messages.replaceChildren();
            if (!session || !(session.messages || []).length) {
                if (elements.emptyState && !elements.emptyState.hidden) {
                    /* empty state is already shown */
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'desktop-workshop-message';
                    empty.textContent = '输入一个问题开始讨论。';
                    elements.messages.appendChild(empty);
                }
            } else {
                (session.messages || []).forEach((message) => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'desktop-workshop-message';
                    item.dataset.role = message.role;
                    const isAssistant = message.role === 'assistant';
                    if (isAssistant && message.id === workshopState.selectedAssistantMessageId) {
                        item.classList.add('is-selected');
                    }
                    const avatar = document.createElement('span');
                    avatar.className = 'desktop-workshop-message-avatar';
                    avatar.textContent = isAssistant ? '助' : '我';
                    const body = document.createElement('div');
                    body.className = 'desktop-workshop-message-body';
                    const role = document.createElement('strong');
                    role.className = 'desktop-workshop-message-role';
                    role.textContent = isAssistant ? '助手' : '你';
                    const content = document.createElement('div');
                    content.className = 'desktop-workshop-message-text';
                    content.textContent = message.content || (isAssistant && workshopState.generating ? '生成中...' : '');
                    body.append(role, content);
                    item.append(avatar, body);
                    item.addEventListener('click', () => {
                        if (isAssistant) {
                            workshopState.selectedAssistantMessageId = message.id;
                            renderWorkshop();
                        }
                    });
                    elements.messages.appendChild(item);
                });
                elements.messages.scrollTop = elements.messages.scrollHeight;
            }
        }
        if (projectId && !workshopState.generating) setWorkshopStatus(`${workshopState.sessions.length} 个对话`, 'ok');
        renderContextStrip();
    }

    async function loadWorkshopSessions() {
        const projectId = currentProjectId();
        await loadWorkshopTemplates();
        if (!projectId) {
            workshopState.sessions = [];
            workshopState.selectedId = '';
            setWorkshopStatus('未打开项目', 'info');
            renderWorkshop();
            return;
        }
        try {
            const response = await fetch(`/api/workshop-sessions?${new URLSearchParams({ projectId }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workshopState.sessions = result.sessions || [];
            if (!workshopState.sessions.some((session) => session.id === workshopState.selectedId)) {
                workshopState.selectedId = workshopState.sessions[0] ? workshopState.sessions[0].id : '';
            }
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workshopSessions = workshopState.sessions;
        } catch (error) {
            console.warn('Failed to load workshop sessions:', error);
            setWorkshopStatus(`读取对话失败：${error.message || error}`, 'error');
        }
        renderWorkshop();
    }

    async function saveWorkshopSession(session) {
        const projectId = currentProjectId();
        if (!projectId || !session) return null;
        const response = await fetch('/api/workshop-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, session })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        return result.session;
    }

    async function createWorkshopSession() {
        const projectId = currentProjectId();
        if (!projectId || !window.DraftHarborWorkshopSchema) return;
        const elements = workshopElements();
        const session = window.DraftHarborWorkshopSchema.createWorkshopSession({
            projectId,
            title: `对话 ${workshopState.sessions.length + 1}`,
            promptTemplateId: (elements.template && elements.template.value) || 'default-workshop-coach'
        });
        const saved = await saveWorkshopSession(session);
        workshopState.sessions = [saved, ...workshopState.sessions];
        workshopState.selectedId = saved.id;
        workshopState.selectedAssistantMessageId = '';
        renderWorkshop();
    }

    async function saveWorkshopDirectiveContract() {
        const elements = workshopElements();
        const session = selectedWorkshopSession();
        if (!session) return;
        const enabled = !!(elements.contractEnabled && elements.contractEnabled.checked);
        const content = elements.contractContent ? elements.contractContent.value.trim() : '';
        if (enabled && !content) {
            setWorkshopStatus('启用会话指令前请填写内容。', 'error');
            return;
        }
        session.directiveContract = {
            enabled,
            content,
            reinforcedAt: new Date().toISOString(),
            pinMode: 'off'
        };
        const saved = await saveWorkshopSession(session);
        const index = workshopState.sessions.findIndex((item) => item.id === saved.id);
        if (index >= 0) workshopState.sessions[index] = saved;
        if (nativeEditorState.snapshot) nativeEditorState.snapshot.workshopSessions = workshopState.sessions;
        setWorkshopStatus(enabled ? '会话指令已启用。' : '会话指令已关闭。', 'ok');
        renderWorkshop();
    }

    async function sendWorkshopMessage() {
        const projectId = currentProjectId();
        const session = selectedWorkshopSession();
        const text = workshopState.input.trim();
        if (!projectId || !session || !text || workshopState.generating) return;
        const userMessage = window.DraftHarborWorkshopSchema.createWorkshopMessage({ role: 'user', content: text });
        const assistantMessage = window.DraftHarborWorkshopSchema.createWorkshopMessage({ role: 'assistant', content: '' });
        session.messages = [...(session.messages || []), userMessage, assistantMessage];
        session.updatedAt = new Date().toISOString();
        workshopState.input = '';
        workshopState.generating = true;
        setWorkshopStatus('生成中...', 'info');
        renderWorkshop();
        try {
            const prompt = window.DraftHarborWorkshopPrompt.buildWorkshopPrompt({
                project: {
                    ...nativeEditorState.snapshot,
                    currentSceneId: nativeEditorState.activeSceneId
                },
                session: {
                    ...session,
                    messages: session.messages.slice(0, -2)
                },
                template: selectedWorkshopTemplate(),
                message: text,
                currentSceneId: nativeEditorState.activeSceneId
            });
            if (!desktopGenerationAvailable()) {
                throw new Error('Provider stream is not loaded');
            }
            await streamDesktopGeneration(prompt, (token, meta) => {
                if (meta && meta.type && meta.type !== 'content') return;
                assistantMessage.content += token;
                renderWorkshop();
            }, runtimeProviderConfig({
                taskKind: 'workshop-chat',
                projectDirectiveStack: nativeEditorState.snapshot && nativeEditorState.snapshot.directiveStack,
                sessionDirective: session.directiveContract && session.directiveContract.enabled
                    ? {
                        id: 'run_session',
                        title: 'Workshop 会话指令',
                        enabled: true,
                        content: session.directiveContract.content,
                        scopes: ['workshop-chat'],
                        source: 'session'
                    }
                    : null
            }));
            const saved = await saveWorkshopSession(session);
            const index = workshopState.sessions.findIndex((item) => item.id === saved.id);
            if (index >= 0) workshopState.sessions[index] = saved;
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workshopSessions = workshopState.sessions;
            setWorkshopStatus('对话已保存', 'ok');
        } catch (error) {
            assistantMessage.content = `Error: ${error.message || error}`;
            assistantMessage.isError = true;
            try { await saveWorkshopSession(session); } catch {}
            setWorkshopStatus(`生成失败：${error.message || error}`, 'error');
        } finally {
            workshopState.generating = false;
            renderWorkshop();
        }
    }

    async function deleteWorkshopSession() {
        const projectId = currentProjectId();
        const session = selectedWorkshopSession();
        if (!projectId || !session) return;
        if (!window.confirm(`删除对话“${session.title || '新对话'}”？`)) return;
        const response = await fetch('/api/delete-workshop-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, sessionId: session.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setWorkshopStatus(`删除失败：${result.error || response.status}`, 'error');
            return;
        }
        workshopState.sessions = workshopState.sessions.filter((item) => item.id !== session.id);
        workshopState.selectedId = workshopState.sessions[0] ? workshopState.sessions[0].id : '';
        renderWorkshop();
    }

    async function workshopOutputToCompendium() {
        const message = selectedAssistantMessage();
        const projectId = currentProjectId();
        if (!message || !projectId) return;
        const scene = currentNativeScene();
        const sceneTitle = scene && scene.title ? scene.title : '';
        const title = sceneTitle ? `Workshop 讨论：${sceneTitle}` : `Workshop 讨论 ${new Date().toLocaleDateString('zh-CN')}`;
        const response = await fetch('/api/compendium', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                entry: {
                    type: 'note',
                    title,
                    summary: message.content.slice(0, 140),
                    body: message.content,
                    tags: ['workshop', sceneTitle].filter(Boolean),
                    contextPolicy: { mode: 'manual' },
                    alwaysInContext: false
                }
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setWorkshopStatus(`转资料失败：${result.error || response.status}`, 'error');
            return;
        }
        await loadCompendium();
        setWorkshopStatus(`已转为资料条目：${title}`, 'ok');
    }

    function workshopOutputToSummary() {
        const message = selectedAssistantMessage();
        const scene = currentNativeScene();
        if (!message || !scene) return;
        scene.summary = message.content.slice(0, 600);
        const elements = nativeEditorElements();
        if (elements.summary) elements.summary.value = scene.summary;
        renderNativeEditor();
        markNativeDirty('已写入场景摘要，未保存');
        setWorkshopStatus('已写入当前场景摘要', 'ok');
    }

    function workshopOutputInsertDraft() {
        const message = selectedAssistantMessage();
        const elements = nativeEditorElements();
        if (!message || !elements.editor) return;
        elements.editor.value = elements.editor.value ? `${elements.editor.value}\n\n${message.content}` : message.content;
        flushNativeEditorFields();
        renderNativeEditor();
        markNativeDirty('已插入正文，未保存');
        setWorkshopStatus('已插入当前正文', 'ok');
    }

    function nativeSelectedOrSceneExcerpt() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const text = elements.editor ? String(elements.editor.value || '') : (scene ? nativeSceneContent(scene.id) : '');
        let selected = '';
        if (elements.editor && elements.editor.selectionStart !== elements.editor.selectionEnd) {
            selected = text.slice(elements.editor.selectionStart, elements.editor.selectionEnd).trim();
        }
        const fallback = (scene && scene.summary ? scene.summary : text).trim();
        return {
            scene,
            selected,
            text: selected || fallback.slice(0, 1200),
            fullText: text
        };
    }

    async function ensureWorkshopSession() {
        let session = selectedWorkshopSession();
        if (session) return session;
        await createWorkshopSession();
        return selectedWorkshopSession();
    }

    async function sendNativeSelectionToWorkshop() {
        const projectId = currentProjectId();
        const payload = nativeSelectedOrSceneExcerpt();
        if (!projectId || !payload.scene || !payload.text) return;
        const session = await ensureWorkshopSession();
        if (!session) return;
        const sceneTitle = payload.scene.title || '当前场景';
        workshopState.input = [
            `请基于《${sceneTitle}》帮我讨论这段内容的下一步处理。`,
            '',
            payload.selected ? '选中片段：' : '场景片段：',
            payload.text
        ].join('\n');
        setView('workshop');
        renderWorkshop();
        const elements = workshopElements();
        if (elements.input) {
            elements.input.focus();
            elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
        }
    }

    async function saveNativeSelectionToCompendium() {
        const projectId = currentProjectId();
        const payload = nativeSelectedOrSceneExcerpt();
        if (!projectId || !payload.scene || !payload.text) return;
        const sceneTitle = payload.scene.title || '当前场景';
        const title = `来自《${sceneTitle}》的片段`;
        const response = await fetch('/api/compendium', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                entry: {
                    type: 'note',
                    title,
                    summary: payload.text.slice(0, 140),
                    body: payload.text,
                    tags: ['writer-fragment', sceneTitle].filter(Boolean),
                    contextPolicy: { mode: 'manual' },
                    alwaysInContext: false
                }
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setNativeSaveStatus(`保存资料失败：${result.error || response.status}`, 'error');
            return;
        }
        await loadCompendium();
        setNativeSaveStatus(`片段已保存为资料：${title}`, 'ok');
        setView('compendium');
    }

    function bindWorkshop() {
        const elements = workshopElements();
        if (elements.newButton) elements.newButton.addEventListener('click', createWorkshopSession);
        if (elements.deleteButton) elements.deleteButton.addEventListener('click', deleteWorkshopSession);
        if (elements.contractSave) elements.contractSave.addEventListener('click', saveWorkshopDirectiveContract);
        if (elements.input) {
            elements.input.addEventListener('input', () => {
                workshopState.input = elements.input.value;
                renderWorkshop();
            });
            elements.input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendWorkshopMessage();
                }
            });
        }
        if (elements.template) {
            elements.template.addEventListener('change', async () => {
                const session = selectedWorkshopSession();
                if (!session) return;
                session.promptTemplateId = elements.template.value || 'default-workshop-coach';
                session.updatedAt = new Date().toISOString();
                try {
                    const saved = await saveWorkshopSession(session);
                    const index = workshopState.sessions.findIndex((item) => item.id === saved.id);
                    if (index >= 0) workshopState.sessions[index] = saved;
                    if (nativeEditorState.snapshot) nativeEditorState.snapshot.workshopSessions = workshopState.sessions;
                    setWorkshopStatus('讨论角度已保存', 'ok');
                } catch (error) {
                    setWorkshopStatus(`保存讨论角度失败：${error.message || error}`, 'error');
                }
                renderWorkshop();
            });
        }
        if (elements.send) elements.send.addEventListener('click', sendWorkshopMessage);
        if (elements.toCompendium) elements.toCompendium.addEventListener('click', workshopOutputToCompendium);
        if (elements.toSummary) elements.toSummary.addEventListener('click', workshopOutputToSummary);
        if (elements.insertDraft) elements.insertDraft.addEventListener('click', workshopOutputInsertDraft);
        renderWorkshop();
    }
