    /* global selectCompendiumEntry */
    const compendiumAgentQaState = { running: false, projectId: '', snapshot: null, requestId: 0, controller: null, result: null };

    function compendiumAgentQaElements() {
        return {
            modal: document.querySelector('[data-compendium-agent-qa-modal]'), question: document.querySelector('[data-compendium-agent-qa-question]'),
            run: document.querySelector('[data-compendium-agent-qa-run]'), cancel: document.querySelector('[data-compendium-agent-qa-cancel]'),
            status: document.querySelector('[data-compendium-agent-qa-status]'), result: document.querySelector('[data-compendium-agent-qa-result]')
        };
    }
    function setCompendiumAgentQaStatus(message, tone = 'info') {
        const status = compendiumAgentQaElements().status;
        if (status) { status.textContent = message || ''; status.dataset.tone = tone; }
    }
    function syncCompendiumAgentQaControls() {
        const elements = compendiumAgentQaElements();
        if (elements.run) elements.run.disabled = compendiumAgentQaState.running;
        if (elements.question) elements.question.disabled = compendiumAgentQaState.running;
        elements.result?.querySelectorAll('button').forEach(button => { button.disabled = compendiumAgentQaState.running; });
    }
    function invalidateCompendiumAgentQaRequest() {
        compendiumAgentQaState.requestId += 1;
        compendiumAgentQaState.controller?.abort();
        compendiumAgentQaState.controller = null;
        compendiumAgentQaState.running = false;
        syncCompendiumAgentQaControls();
    }
    function compendiumAgentQaRequestCurrent(requestId, projectId) {
        return requestId === compendiumAgentQaState.requestId && projectId === currentProjectId()
            && projectId === compendiumAgentQaState.projectId && compendiumAgentQaState.snapshot === nativeEditorState.snapshot
            && !!compendiumAgentQaElements().modal?.open;
    }
    function describeCompendiumAgentQaResult(result) {
        const count = (result.sourceIds || []).length;
        setCompendiumAgentQaStatus(!count || result.confidence === 'not-found' ? '未找到足够的资料依据。' : `已基于 ${count} 张资料卡回答。`, count && result.confidence === 'grounded' ? 'ok' : 'info');
    }
    function compendiumAgentQaConfigured() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const agent = settings.compendiumAgent || {};
        return !!(agent.enabled && agent.providerProfileId);
    }
    function openCompendiumAgentQa() {
        const projectId = currentProjectId();
        if (!projectId) return;
        if (!compendiumAgentQaConfigured()) { setCompendiumStatus('请先在设置中心的「资料库管家」中启用并选择专用配置组。', 'error'); setView('settings'); window.setSettingsCategory?.('compendium-agent'); return; }
        const elements = compendiumAgentQaElements();
        const sameProject = compendiumAgentQaState.projectId === projectId && compendiumAgentQaState.snapshot === nativeEditorState.snapshot;
        if (elements.modal?.open && sameProject) return;
        invalidateCompendiumAgentQaRequest();
        if (!sameProject) {
            compendiumAgentQaState.result = null;
            if (elements.question) elements.question.value = '';
        }
        compendiumAgentQaState.projectId = projectId;
        compendiumAgentQaState.snapshot = nativeEditorState.snapshot;
        if (compendiumAgentQaState.result) {
            renderCompendiumAgentQaResult(compendiumAgentQaState.result);
            describeCompendiumAgentQaResult(compendiumAgentQaState.result);
        } else {
            if (elements.result) { elements.result.hidden = true; elements.result.replaceChildren(); }
            setCompendiumAgentQaStatus('提问后会先在本地资料卡中检索。');
        }
        if (elements.modal && typeof elements.modal.showModal === 'function') elements.modal.showModal();
    }
    function closeCompendiumAgentQa() {
        invalidateCompendiumAgentQaRequest();
        const modal = compendiumAgentQaElements().modal;
        if (modal) modal.close();
    }
    function renderCompendiumAgentQaResult(result) {
        const container = compendiumAgentQaElements().result;
        if (!container) return;
        container.replaceChildren(); container.hidden = false;
        const answer = document.createElement('p'); answer.textContent = result.answer || '资料库未提供足够信息。'; container.appendChild(answer);
        const sources = (result.sources || []).filter((source) => (result.sourceIds || []).includes(source.id));
        if (sources.length) {
            const actions = document.createElement('div'); actions.className = 'desktop-settings-actions';
            sources.forEach((source) => {
                const button = document.createElement('button');
                button.type = 'button'; button.className = 'desktop-secondary-action'; button.textContent = `查看资料：${source.title || source.id}`;
                button.addEventListener('click', () => {
                    if (compendiumAgentQaState.running || compendiumAgentQaState.projectId !== currentProjectId()
                        || compendiumAgentQaState.snapshot !== nativeEditorState.snapshot) return;
                    const entry = (compendiumState.entries || []).find((item) => item.id === source.id);
                    if (!entry) { setCompendiumAgentQaStatus('引用的资料已不存在，请重新提问。', 'error'); return; }
                    if (selectCompendiumEntry(entry.id) !== true) return;
                    closeCompendiumAgentQa(); setCompendiumStatus(`已定位到资料：${entry.title || entry.id}`, 'ok');
                });
                actions.appendChild(button);
            });
            container.appendChild(actions);
        }
    }
    async function runCompendiumAgentQa() {
        const elements = compendiumAgentQaElements(); const question = String(elements.question && elements.question.value || '').trim();
        const projectId = currentProjectId();
        if (compendiumAgentQaState.running || !compendiumAgentQaRequestCurrent(compendiumAgentQaState.requestId, projectId)) return;
        if (!question) { setCompendiumAgentQaStatus('请输入问题。', 'error'); return; }
        const requestId = ++compendiumAgentQaState.requestId;
        const controller = new AbortController();
        compendiumAgentQaState.controller = controller;
        compendiumAgentQaState.running = true;
        compendiumAgentQaState.result = null;
        if (elements.result) { elements.result.hidden = true; elements.result.replaceChildren(); }
        syncCompendiumAgentQaControls(); setCompendiumAgentQaStatus('正在本地检索并生成回答…');
        try {
            const response = await fetch('/api/compendium-agent/ask', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, question }) });
            const result = await response.json().catch(() => ({}));
            if (!compendiumAgentQaRequestCurrent(requestId, projectId)) return;
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            if (result.projectId && result.projectId !== projectId) throw new Error('问答结果与当前项目不匹配。');
            compendiumAgentQaState.result = result;
            renderCompendiumAgentQaResult(result); describeCompendiumAgentQaResult(result);
        } catch (error) { if (compendiumAgentQaRequestCurrent(requestId, projectId)) setCompendiumAgentQaStatus(`问答失败：${error.message || error}`, 'error'); }
        finally {
            if (requestId === compendiumAgentQaState.requestId) {
                compendiumAgentQaState.running = false; compendiumAgentQaState.controller = null; syncCompendiumAgentQaControls();
            }
        }
    }
    function bindCompendiumAgentQa() {
        const elements = compendiumAgentQaElements();
        if (elements.run) elements.run.addEventListener('click', runCompendiumAgentQa);
        if (elements.cancel) elements.cancel.addEventListener('click', closeCompendiumAgentQa);
        elements.modal?.addEventListener('cancel', event => { event.preventDefault(); closeCompendiumAgentQa(); });
    }
