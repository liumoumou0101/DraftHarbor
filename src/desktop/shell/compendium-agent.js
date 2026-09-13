    /* global selectCompendiumEntry */
    const compendiumAgentState = { running: false, applying: false, result: null, projectId: '', snapshot: null, requestId: 0, controller: null, selected: new Set() };

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

    function syncCompendiumAgentControls() {
        const elements = compendiumAgentElements();
        const busy = compendiumAgentState.running || compendiumAgentState.applying;
        [elements.run, elements.scope, elements.selectAll, elements.selectNone].forEach(element => { if (element) element.disabled = busy; });
        if (elements.cancel) elements.cancel.disabled = compendiumAgentState.applying;
        if (elements.apply) elements.apply.disabled = busy || !compendiumAgentState.result || !compendiumAgentState.selected.size;
        elements.results?.querySelectorAll('button, input').forEach(element => { element.disabled = busy || (element.tagName === 'BUTTON' && element.dataset.missing === 'true'); });
    }

    function invalidateCompendiumAgentRequest() {
        compendiumAgentState.requestId += 1;
        compendiumAgentState.controller?.abort();
        compendiumAgentState.controller = null;
        compendiumAgentState.running = false;
        compendiumAgentState.applying = false;
        syncCompendiumAgentControls();
    }

    function compendiumAgentRequestCurrent(requestId, projectId) {
        return requestId === compendiumAgentState.requestId && projectId === currentProjectId()
            && projectId === compendiumAgentState.projectId && compendiumAgentState.snapshot === nativeEditorState.snapshot
            && !!compendiumAgentElements().modal?.open;
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
        if (!result) { if (elements.resultActions) elements.resultActions.hidden = true; syncCompendiumAgentControls(); return; }
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
                    button.dataset.missing = String(!entry);
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
                input.type = 'checkbox'; input.checked = compendiumAgentState.selected.has(operation.id); input.dataset.compendiumAgentOperation = operation.id;
                input.addEventListener('change', () => {
                    if (input.checked) compendiumAgentState.selected.add(operation.id);
                    else compendiumAgentState.selected.delete(operation.id);
                    syncCompendiumAgentControls();
                });
                const text = document.createElement('span');
                const entry = (compendiumState.entries || []).find((item) => item.id === operation.entryId) || {};
                const diff = Object.keys(operation.patch || {}).map((key) => `${key}: ${JSON.stringify(entry[key] || '')} → ${JSON.stringify(operation.patch[key])}`).join('；');
                text.textContent = `应用到 ${entry.title || '未命名资料'}：${diff}`;
                line.append(input, text); card.append(line);
            });
            elements.results.appendChild(card);
        });
        const operationCount = elements.results.querySelectorAll('[data-compendium-agent-operation]').length;
        if (elements.resultActions) elements.resultActions.hidden = !operationCount;
        syncCompendiumAgentControls();
    }

    function openCompendiumAgent() {
        const projectId = currentProjectId();
        if (!projectId) return;
        if (!agentConfigured()) { setCompendiumStatus('请先在设置中心的「资料库管家」中启用并选择专用配置组。', 'error'); setView('settings'); window.setSettingsCategory?.('compendium-agent'); return; }
        const elements = compendiumAgentElements();
        const sameProject = compendiumAgentState.projectId === projectId && compendiumAgentState.snapshot === nativeEditorState.snapshot;
        if (elements.modal?.open && sameProject) return;
        invalidateCompendiumAgentRequest();
        if (!sameProject) {
            compendiumAgentState.result = null;
            compendiumAgentState.selected.clear();
        }
        compendiumAgentState.projectId = projectId;
        compendiumAgentState.snapshot = nativeEditorState.snapshot;
        renderCompendiumAgentResults(); renderCompendiumAgentScope();
        const warning = compendiumAgentState.result?.warning;
        setCompendiumAgentStatus(warning || (compendiumAgentState.result ? '已保留上次体检结果和勾选，可继续审阅。' : '选择范围后开始体检。'), warning ? 'warn' : 'info');
        if (elements.modal && typeof elements.modal.showModal === 'function') elements.modal.showModal();
    }

    function closeCompendiumAgent() {
        if (compendiumAgentState.applying) return false;
        const elements = compendiumAgentElements();
        invalidateCompendiumAgentRequest();
        if (elements.modal) elements.modal.close();
        return true;
    }

    function focusCompendiumAgentEntry(entryId) {
        if (compendiumAgentState.running || compendiumAgentState.applying || compendiumAgentState.projectId !== currentProjectId()
            || compendiumAgentState.snapshot !== nativeEditorState.snapshot) return false;
        const entry = (compendiumState.entries || []).find((item) => item.id === entryId);
        if (!entry) {
            setCompendiumAgentStatus('关联资料已不存在，请重新运行体检。', 'error');
            return false;
        }
        if (selectCompendiumEntry(entry.id) !== true) return false;
        closeCompendiumAgent();
        setCompendiumStatus(`已定位到资料：${entry.title || entry.id}`, 'ok');
        return true;
    }

    async function runCompendiumAgent() {
        const entries = agentScopeEntries();
        const projectId = currentProjectId();
        if (compendiumAgentState.running || compendiumAgentState.applying || !compendiumAgentRequestCurrent(compendiumAgentState.requestId, projectId)) return;
        if (!entries.length) { setCompendiumAgentStatus('当前范围没有可分析的资料卡。', 'error'); return; }
        const requestId = ++compendiumAgentState.requestId;
        const controller = new AbortController();
        compendiumAgentState.controller = controller;
        compendiumAgentState.running = true;
        compendiumAgentState.result = null;
        compendiumAgentState.selected.clear();
        renderCompendiumAgentResults();
        setCompendiumAgentStatus('正在体检资料库…');
        try {
            const response = await fetch('/api/compendium-agent/analyze', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, entryIds: entries.map((entry) => entry.id) }) });
            const result = await response.json().catch(() => ({}));
            if (!compendiumAgentRequestCurrent(requestId, projectId)) return;
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            if (result.projectId && result.projectId !== projectId) throw new Error('体检结果与当前项目不匹配。');
            compendiumAgentState.selected = new Set((result.operations || []).map(operation => operation.id));
            compendiumAgentState.result = result; renderCompendiumAgentResults();
            setCompendiumAgentStatus(result.warning || `体检完成：${(result.findings || []).length} 项发现，${(result.operations || []).length} 条可应用建议。`, result.warning ? 'warn' : 'ok');
        } catch (error) { if (compendiumAgentRequestCurrent(requestId, projectId)) setCompendiumAgentStatus(`体检失败：${error.message || error}`, 'error'); }
        finally {
            if (requestId === compendiumAgentState.requestId) {
                compendiumAgentState.running = false; compendiumAgentState.controller = null; syncCompendiumAgentControls();
            }
        }
    }

    async function applyCompendiumAgent() {
        const result = compendiumAgentState.result;
        const projectId = currentProjectId();
        if (!result || compendiumAgentState.running || compendiumAgentState.applying || !compendiumAgentRequestCurrent(compendiumAgentState.requestId, projectId)) return;
        if (compendiumState.dirty) { setCompendiumAgentStatus('当前资料有未保存修改，请先保存后再应用体检建议。', 'error'); return; }
        const operations = (result.operations || []).filter((operation) => compendiumAgentState.selected.has(operation.id));
        if (!operations.length) { setCompendiumAgentStatus('请至少勾选一条建议。', 'error'); return; }
        if (!window.confirm(`应用 ${operations.length} 条资料库建议？系统会先创建备份。`)) return;
        const captured = window.captureCompendiumDraft() || { projectId, snapshot: nativeEditorState.snapshot, entryId: '', version: -1 };
        const requestId = ++compendiumAgentState.requestId;
        compendiumAgentState.applying = true;
        syncCompendiumAgentControls(); setCompendiumAgentStatus('正在应用建议并创建备份…');
        try {
            const response = await fetch('/api/compendium-agent/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, operations }) });
            const applied = await response.json().catch(() => ({}));
            if (!compendiumAgentRequestCurrent(requestId, projectId)) return;
            if (!response.ok || !applied.ok) throw new Error(applied.error || `HTTP ${response.status}`);
            applied.entries.forEach(entry => window.acceptCompendiumSavedEntry(entry, captured));
            compendiumAgentState.result = null; compendiumAgentState.selected.clear(); compendiumAgentState.applying = false;
            closeCompendiumAgent(); setCompendiumStatus(`已应用 ${applied.appliedCount} 条资料库建议，并已创建备份。`, 'ok');
        } catch (error) { if (compendiumAgentRequestCurrent(requestId, projectId)) setCompendiumAgentStatus(`应用失败：${error.message || error}`, 'error'); }
        finally { if (requestId === compendiumAgentState.requestId) { compendiumAgentState.applying = false; syncCompendiumAgentControls(); } }
    }

    function bindCompendiumAgent() {
        const elements = compendiumAgentElements();
        if (elements.scope) elements.scope.addEventListener('change', renderCompendiumAgentScope);
        if (elements.run) elements.run.addEventListener('click', runCompendiumAgent);
        if (elements.selectAll) elements.selectAll.addEventListener('click', () => { compendiumAgentState.selected = new Set((compendiumAgentState.result?.operations || []).map(operation => operation.id)); renderCompendiumAgentResults(); });
        if (elements.selectNone) elements.selectNone.addEventListener('click', () => { compendiumAgentState.selected.clear(); renderCompendiumAgentResults(); });
        if (elements.apply) elements.apply.addEventListener('click', applyCompendiumAgent);
        if (elements.cancel) elements.cancel.addEventListener('click', closeCompendiumAgent);
        elements.modal?.addEventListener('cancel', event => { event.preventDefault(); closeCompendiumAgent(); });
    }
