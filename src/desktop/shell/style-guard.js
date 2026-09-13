    let styleGuardDraft = null;
    let styleGuardReturnFocus = null;
    let styleGuardSaving = false;
    function styleGuardElements() {
        const modal = document.querySelector('[data-style-guard-modal]');
        return { modal, form: modal.querySelector('form'), scope: modal.querySelector('[data-style-guard-scope]'), list: modal.querySelector('[data-style-guard-list]'), rules: modal.querySelector('[data-style-guard-rules]'), status: modal.querySelector('[data-style-guard-status]') };
    }
    function setStyleGuardStatus(message, tone = 'info') {
        const { status } = styleGuardElements();
        status.textContent = message;
        status.dataset.tone = tone;
    }
    function styleGuardNormalized(rules, scope) {
        return window.DraftHarborAvoidanceRules.normalizeRules(rules).map(rule => ({ ...rule, scope }));
    }
    function renderStyleGuardCount() {
        const rules = [...((settingsState.settings || {}).globalStyleGuardRules || []), ...((nativeEditorState.snapshot || {}).styleGuardRules || [])];
        const count = window.DraftHarborAvoidanceRules.normalizeRules(rules).filter(rule => rule.enabled).length;
        document.querySelectorAll('[data-style-guard-count]').forEach(label => { label.textContent = `避用规则 · ${count} 条`; });
    }
    function renderStyleGuardRows() {
        const { list, scope, modal } = styleGuardElements();
        const rows = styleGuardDraft[scope.value];
        list.replaceChildren();
        const updateSummary = () => {
            modal.querySelector('[data-style-guard-summary]').textContent = `当前项目 ${styleGuardNormalized(styleGuardDraft.project, 'project').filter(r => r.enabled).length} 条 · 全局 ${styleGuardNormalized(styleGuardDraft.global, 'global').filter(r => r.enabled).length} 条。切换范围会保留未保存的编辑。`;
        };
        updateSummary();
        if (!rows.length) {
            const empty = document.createElement('p');
            empty.textContent = '尚未添加规则。可添加避用表达，并说明希望如何调整。';
            list.append(empty);
        }
        rows.forEach((rule, index) => {
            const row = document.createElement('div');
            row.className = 'desktop-style-guard-row';
            for (const [key, labelText, placeholder] of [['text', '避用表达', '例如：嘴角微微上扬'], ['reason', '原因或替代方向（可选）', '例如：用动作表现情绪']]) {
                const label = document.createElement('label');
                label.textContent = labelText;
                const input = document.createElement('input');
                input.value = rule[key] || '';
                input.placeholder = placeholder;
                input.addEventListener('input', () => { rule[key] = input.value; updateSummary(); });
                label.append(input);
                row.append(label);
            }
            const enabledLabel = document.createElement('label');
            enabledLabel.className = 'desktop-style-guard-enabled';
            const enabled = document.createElement('input');
            enabled.type = 'checkbox';
            enabled.checked = rule.enabled !== false;
            enabled.addEventListener('change', () => { rule.enabled = enabled.checked; updateSummary(); });
            enabledLabel.append(enabled, '启用');
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'desktop-secondary-action';
            remove.textContent = '移除';
            remove.setAttribute('aria-label', `移除第 ${index + 1} 条规则`);
            remove.addEventListener('click', () => { rows.splice(index, 1); renderStyleGuardRows(); });
            row.append(enabledLabel, remove);
            list.append(row);
        });
    }
    function openStyleGuard(event) {
        if (!nativeEditorState.snapshot) return;
        const { modal, scope, rules } = styleGuardElements();
        styleGuardReturnFocus = event && event.currentTarget || document.activeElement;
        styleGuardDraft = {
            project: structuredClone(nativeEditorState.snapshot.styleGuardRules || []),
            global: structuredClone((settingsState.settings || {}).globalStyleGuardRules || []),
            snapshot: nativeEditorState.snapshot,
            bulk: { project: '', global: '' }
        };
        scope.value = 'project';
        rules.value = '';
        renderStyleGuardRows();
        setStyleGuardStatus('项目规则随作品保存；全局规则保存后用于所有项目。');
        modal.hidden = false;
        modal.showModal();
        scope.focus();
    }
    function closeStyleGuard() {
        if (styleGuardSaving) return;
        const { modal } = styleGuardElements();
        modal.close();
        modal.hidden = true;
        styleGuardDraft = null;
        if (styleGuardReturnFocus && styleGuardReturnFocus.isConnected) styleGuardReturnFocus.focus();
    }
    function parseStyleGuardRules(value) {
        return window.DraftHarborAvoidanceRules.normalizeRules(String(value || '').split(/\r?\n/).map(row => {
            const [text, ...reason] = row.split('|');
            return { text: text.trim(), reason: reason.join('|').trim(), enabled: true };
        }));
    }
    async function saveStyleGuard(event) {
        event.preventDefault();
        if (!styleGuardDraft || styleGuardSaving) return;
        const draft = styleGuardDraft;
        const { modal, rules, scope } = styleGuardElements();
        const pendingScope = ['project', 'global'].find(key => draft.bulk[key].trim());
        if (rules.value.trim() || pendingScope) {
            if (pendingScope) {
                scope.value = pendingScope;
                rules.value = draft.bulk[pendingScope];
                renderStyleGuardRows();
            }
            rules.closest('details').open = true;
            setStyleGuardStatus('批量输入尚未添加，请先点击“添加到列表”。', 'error');
            rules.focus();
            return;
        }
        for (const key of ['project', 'global']) {
            if (draft[key].some(rule => !String(rule.text || '').trim() && String(rule.reason || '').trim())) {
                scope.value = key;
                renderStyleGuardRows();
                setStyleGuardStatus('请填写避用表达，或移除不需要的空规则。', 'error');
                return;
            }
        }
        styleGuardSaving = true;
        modal.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = true; });
        let saved = false;
        try {
            if (nativeEditorState.snapshot !== draft.snapshot) throw new Error('项目已切换，请重新打开规则编辑。');
            const globalRules = styleGuardNormalized(draft.global, 'global');
            if (JSON.stringify(globalRules) !== JSON.stringify((settingsState.settings || {}).globalStyleGuardRules || [])) {
                const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(settingsState.settings || {}), globalStyleGuardRules: globalRules }) });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error || '无法保存全局规则');
                settingsState.settings = result.settings || { ...(settingsState.settings || {}), globalStyleGuardRules: globalRules };
            }
            draft.snapshot.styleGuardRules = styleGuardNormalized(draft.project, 'project');
            markNativeDirty('避用规则已更新，请保存作品');
            renderStyleGuardCount();
            setNativeSaveStatus('避用规则已应用；项目规则请随作品保存', 'ok');
            saved = true;
        } catch (error) {
            setStyleGuardStatus(`保存失败：${error.message}。编辑内容已保留，可重试。`, 'error');
        } finally {
            styleGuardSaving = false;
            modal.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = false; });
        }
        if (saved) closeStyleGuard();
    }
    function bindStyleGuard() {
        window.renderStyleGuardCount = renderStyleGuardCount;
        const { modal, scope, form, rules } = styleGuardElements();
        document.querySelectorAll('[data-native-style-guard]').forEach(button => button.addEventListener('click', openStyleGuard));
        rules.addEventListener('input', () => { styleGuardDraft.bulk[scope.value] = rules.value; });
        scope.addEventListener('change', () => {
            rules.value = styleGuardDraft.bulk[scope.value];
            renderStyleGuardRows();
        });
        form.addEventListener('submit', saveStyleGuard);
        modal.addEventListener('cancel', event => { event.preventDefault(); closeStyleGuard(); });
        modal.querySelectorAll('[data-style-guard-cancel]').forEach(button => button.addEventListener('click', closeStyleGuard));
        modal.querySelector('[data-style-guard-add]').addEventListener('click', () => {
            const rows = styleGuardDraft[scope.value];
            if (rows.length >= 80) { setStyleGuardStatus('每个范围最多 80 条规则。', 'error'); return; }
            rows.push({ text: '', reason: '', enabled: true });
            renderStyleGuardRows();
            modal.querySelector('.desktop-style-guard-row:last-child input').focus();
        });
        modal.querySelector('[data-style-guard-import]').addEventListener('click', () => {
            const next = [...styleGuardDraft[scope.value], ...parseStyleGuardRules(rules.value)];
            if (new Set(next.map(rule => rule.text.trim()).filter(Boolean)).size > 80) { setStyleGuardStatus('每个范围最多 80 条规则，请减少批量输入。', 'error'); return; }
            styleGuardDraft[scope.value] = styleGuardNormalized(next, scope.value);
            rules.value = '';
            styleGuardDraft.bulk[scope.value] = '';
            renderStyleGuardRows();
        });
    }
