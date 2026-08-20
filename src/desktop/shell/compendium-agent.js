    const compendiumAgentState = { running: false, result: null };

    function compendiumAgentElements() {
        return {
            modal: document.querySelector('[data-compendium-agent-modal]'),
            scope: document.querySelector('[data-compendium-agent-scope]'),
            scopeNote: document.querySelector('[data-compendium-agent-scope-note]'),
            run: document.querySelector('[data-compendium-agent-run]'),
            selectAll: document.querySelector('[data-compendium-agent-select-all]'),
            selectNone: document.querySelector('[data-compendium-agent-select-none]'),
            apply: document.querySelector('[data-compendium-agent-apply]'),
            resultActions: document.querySelector('[data-compendium-agent-result-actions]'),
            cancel: document.querySelector('[data-compendium-agent-cancel]'),
            status: document.querySelector('[data-compendium-agent-status]'),
            results: document.querySelector('[data-compendium-agent-results]')
        };
    }

    function setCompendiumAgentStatus(message, tone = 'info') {
        const elements = compendiumAgentElements();
        if (!elements.status) return;
        elements.status.textContent = message || '';
        elements.status.dataset.tone = tone;
    }

    function agentConfigured() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const agent = settings.compendiumAgent || {};
        return !!(agent.enabled && agent.providerProfileId);
    }

    function agentScopeEntries() {
        const elements = compendiumAgentElements();
        const scope = elements.scope ? elements.scope.value : 'current';
        if (scope === 'current') {
            const selected = selectedCompendiumEntry();
            return selected ? [selected] : [];
        }
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const limit = (settings.compendiumAgent || {}).maxCardsPerRun || 30;
        const entries = scope === 'filtered' ? filteredCompendiumEntries() : (compendiumState.entries || []);
        return entries.slice(0, limit);
    }

    function renderCompendiumAgentScope() {
        const elements = compendiumAgentElements();
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const agent = settings.compendiumAgent || {};
        const entries = agentScopeEntries();
        const available = (elements.scope && elements.scope.value === 'current') ? (selectedCompendiumEntry() ? 1 : 0) : (elements.scope && elements.scope.value === 'filtered' ? filteredCompendiumEntries().length : (compendiumState.entries || []).length);
        if (elements.scopeNote) elements.scopeNote.textContent = available > entries.length ? `将分析前 ${entries.length} / ${available} 张资料卡；单次上限 ${agent.maxCardsPerRun || 30} 张。` : `将分析 ${entries.length} 张资料卡；单次上限 ${agent.maxCardsPerRun || 30} 张。`;
    }

    function renderCompendiumAgentResults() {
        const elements = compendiumAgentElements();
        if (!elements.results) return;
        elements.results.replaceChildren();
        const result = compendiumAgentState.result;
        if (!result) { if (elements.resultActions) elements.resultActions.hidden = true; return; }
        const operations = new Map((result.operations || []).map((operation) => [operation.id, operation]));
        (result.findings || []).forEach((finding) => {
            const card = document.createElement('article');
            card.className = 'desktop-compendium-item';
            const title = document.createElement('strong');
            title.textContent = `${finding.severity === 'high' ? '高' : finding.severity === 'medium' ? '中' : '低'}优先级：${finding.reason}`;
            const related = document.createElement('small');
            related.textContent = `相关资料：${(finding.entryIds || []).map((entryId) => {
                const relatedEntry = (compendiumState.entries || []).find((item) => item.id === entryId);
                return relatedEntry && relatedEntry.title ? relatedEntry.title : entryId;
            }).join('、')}`;
            card.append(title, related);
            const relatedIds = (finding.entryIds || []).filter(Boolean);
            if (relatedIds.length) {
                const actions = document.createElement('div');
                actions.className = 'desktop-settings-actions';
                relatedIds.forEach((entryId) => {
                    const entry = (compendiumState.entries || []).find((item) => item.id === entryId);
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-secondary-action';
                    button.textContent = entry ? `查看资料：${entry.title || entry.id}` : `资料已不存在：${entryId}`;
                    button.disabled = !entry;
                    if (entry) button.addEventListener('click', () => focusCompendiumAgentEntry(entry.id));
                    actions.appendChild(button);
                });
                card.appendChild(actions);
            }
            (finding.operationIds || []).forEach((operationId) => {
                const operation = operations.get(operationId);
                if (!operation) return;
                const line = document.createElement('label');
                line.className = 'desktop-settings-check';
                const input = document.createElement('input');
                input.type = 'checkbox'; input.checked = true; input.dataset.compendiumAgentOperation = operation.id;
                const text = document.createElement('span');
                const entry = (compendiumState.entries || []).find((item) => item.id === operation.entryId) || {};
                const diff = Object.keys(operation.patch || {}).map((key) => `${key}: ${JSON.stringify(entry[key] || '')} → ${JSON.stringify(operation.patch[key])}`).join('；');
                text.textContent = `应用到 ${entry.title || '未命名资料'}：${diff}`;
                line.append(input, text); card.append(line);
            });
            elements.results.appendChild(card);
        });
        const operationCount = elements.results.querySelectorAll('[data-compendium-agent-operation]').length;
        if (elements.apply) elements.apply.disabled = !operationCount;
        if (elements.resultActions) elements.resultActions.hidden = !operationCount;
    }

    function openCompendiumAgent() {
        if (!currentProjectId()) return;
        if (!agentConfigured()) { setCompendiumStatus('请先在设置中心的「资料库管家」中启用并选择专用配置组。', 'error'); setView('settings'); return; }
        const elements = compendiumAgentElements();
        compendiumAgentState.result = null;
        renderCompendiumAgentResults(); renderCompendiumAgentScope(); setCompendiumAgentStatus('选择范围后开始体检。');
        if (elements.modal && typeof elements.modal.showModal === 'function') elements.modal.showModal();
    }

    function closeCompendiumAgent() {
        const elements = compendiumAgentElements();
        if (elements.modal) elements.modal.close();
        compendiumAgentState.running = false;
    }

    function focusCompendiumAgentEntry(entryId) {
        const entry = (compendiumState.entries || []).find((item) => item.id === entryId);
        if (!entry) {
            setCompendiumAgentStatus('关联资料已不存在，请重新运行体检。', 'error');
            return false;
        }
        compendiumState.selectedId = entry.id;
        closeCompendiumAgent();
        renderCompendium();
        setCompendiumStatus(`已定位到资料：${entry.title || entry.id}`, 'ok');
        return true;
    }

    async function runCompendiumAgent() {
        const entries = agentScopeEntries();
        const elements = compendiumAgentElements();
        if (!entries.length || compendiumAgentState.running) { setCompendiumAgentStatus('当前范围没有可分析的资料卡。', 'error'); return; }
        compendiumAgentState.running = true; if (elements.run) elements.run.disabled = true;
        setCompendiumAgentStatus('正在体检资料库…');
        try {
            const response = await fetch('/api/compendium-agent/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId(), entryIds: entries.map((entry) => entry.id) }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumAgentState.result = result; renderCompendiumAgentResults();
            setCompendiumAgentStatus(`体检完成：${(result.findings || []).length} 项发现，${(result.operations || []).length} 条可应用建议。`, 'ok');
        } catch (error) { setCompendiumAgentStatus(`体检失败：${error.message || error}`, 'error'); }
        finally { compendiumAgentState.running = false; if (elements.run) elements.run.disabled = false; }
    }

    async function applyCompendiumAgent() {
        const elements = compendiumAgentElements(); const result = compendiumAgentState.result;
        if (!result) return;
        const selected = new Set(Array.from(document.querySelectorAll('[data-compendium-agent-operation]:checked')).map((input) => input.dataset.compendiumAgentOperation));
        const operations = (result.operations || []).filter((operation) => selected.has(operation.id));
        if (!operations.length) { setCompendiumAgentStatus('请至少勾选一条建议。', 'error'); return; }
        if (!window.confirm(`应用 ${operations.length} 条资料库建议？系统会先创建备份。`)) return;
        if (elements.apply) elements.apply.disabled = true; setCompendiumAgentStatus('正在应用建议并创建备份…');
        try {
            const response = await fetch('/api/compendium-agent/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId(), operations }) });
            const applied = await response.json().catch(() => ({}));
            if (!response.ok || !applied.ok) throw new Error(applied.error || `HTTP ${response.status}`);
            await loadCompendium(); closeCompendiumAgent(); setCompendiumStatus(`已应用 ${applied.appliedCount} 条资料库建议，并已创建备份。`, 'ok');
        } catch (error) { setCompendiumAgentStatus(`应用失败：${error.message || error}`, 'error'); if (elements.apply) elements.apply.disabled = false; }
    }

    function bindCompendiumAgent() {
        const elements = compendiumAgentElements();
        if (elements.scope) elements.scope.addEventListener('change', renderCompendiumAgentScope);
        if (elements.run) elements.run.addEventListener('click', runCompendiumAgent);
        if (elements.selectAll) elements.selectAll.addEventListener('click', () => document.querySelectorAll('[data-compendium-agent-operation]').forEach((input) => { input.checked = true; }));
        if (elements.selectNone) elements.selectNone.addEventListener('click', () => document.querySelectorAll('[data-compendium-agent-operation]').forEach((input) => { input.checked = false; }));
        if (elements.apply) elements.apply.addEventListener('click', applyCompendiumAgent);
        if (elements.cancel) elements.cancel.addEventListener('click', closeCompendiumAgent);
    }
