    const compendiumAgentQaState = { running: false };

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
    function compendiumAgentQaConfigured() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const agent = settings.compendiumAgent || {};
        return !!(agent.enabled && agent.providerProfileId);
    }
    function openCompendiumAgentQa() {
        if (!currentProjectId()) return;
        if (!compendiumAgentQaConfigured()) { setCompendiumStatus('请先在设置中心的「资料库管家」中启用并选择专用配置组。', 'error'); setView('settings'); return; }
        const elements = compendiumAgentQaElements();
        if (elements.result) { elements.result.hidden = true; elements.result.replaceChildren(); }
        setCompendiumAgentQaStatus('提问后会先在本地资料卡中检索。');
        if (elements.modal && typeof elements.modal.showModal === 'function') elements.modal.showModal();
    }
    function closeCompendiumAgentQa() { const modal = compendiumAgentQaElements().modal; if (modal) modal.close(); compendiumAgentQaState.running = false; }
    function renderCompendiumAgentQaResult(result) {
        const container = compendiumAgentQaElements().result;
        if (!container) return;
        container.replaceChildren(); container.hidden = false;
        const answer = document.createElement('p'); answer.textContent = result.answer || '资料库未提供足够信息。'; container.appendChild(answer);
        const sources = (result.sources || []).filter((source) => (result.sourceIds || []).includes(source.id));
        if (sources.length) {
            const actions = document.createElement('div'); actions.className = 'desktop-settings-actions';
            sources.forEach((source) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'desktop-secondary-action'; button.textContent = `查看资料：${source.title || source.id}`; button.addEventListener('click', () => { const entry = (compendiumState.entries || []).find((item) => item.id === source.id); if (!entry) return; compendiumState.selectedId = entry.id; closeCompendiumAgentQa(); renderCompendium(); setCompendiumStatus(`已定位到资料：${entry.title || entry.id}`, 'ok'); }); actions.appendChild(button); });
            container.appendChild(actions);
        }
    }
    async function runCompendiumAgentQa() {
        const elements = compendiumAgentQaElements(); const question = String(elements.question && elements.question.value || '').trim();
        if (!question || compendiumAgentQaState.running) { setCompendiumAgentQaStatus('请输入问题。', 'error'); return; }
        compendiumAgentQaState.running = true; if (elements.run) elements.run.disabled = true; setCompendiumAgentQaStatus('正在本地检索并生成回答…');
        try {
            const response = await fetch('/api/compendium-agent/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId(), question }) });
            const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            renderCompendiumAgentQaResult(result); setCompendiumAgentQaStatus(result.confidence === 'not-found' ? '未找到足够的资料依据。' : `已基于 ${result.sourceIds.length} 张资料卡回答。`, result.confidence === 'grounded' ? 'ok' : 'info');
        } catch (error) { setCompendiumAgentQaStatus(`问答失败：${error.message || error}`, 'error'); }
        finally { compendiumAgentQaState.running = false; if (elements.run) elements.run.disabled = false; }
    }
    function bindCompendiumAgentQa() { const elements = compendiumAgentQaElements(); if (elements.run) elements.run.addEventListener('click', runCompendiumAgentQa); if (elements.cancel) elements.cancel.addEventListener('click', closeCompendiumAgentQa); }
