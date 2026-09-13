(function () {
    const modes = new Map();
    const checked = new Map();
    const checking = new Map();
    let active = null;
    let mutation = null;
    let bound = false;
    const ui = () => window.WorkshopUI;
    const key = () => `${ui().capture().projectId}:${ui().capture().sessionId}`;
    const mode = () => modes.get(key()) || modes.get(`${ui().capture().projectId}:`) || 'chat';
    const isBusy = () => !!mutation;
    const same = captured => ui().isCurrent(captured);
    const dirty = () => {
        const state = ui().native();
        return state.dirty || state.isSaving || state.generation?.inProgress || ui().compendium().dirty;
    };
    const statusLabels = { running: '正在处理', completed: '已完成', cancelled: '已取消', failed: '处理失败', applying: '正在应用', applied: '已应用', undone: '已撤销', expired: '操作已过期' };

    async function request(action, body, signal) {
        const get = action === 'run';
        const response = await fetch(`/api/workshop-agent/${action}${get ? `?${new URLSearchParams(body)}` : ''}`, {
            method: get ? 'GET' : 'POST', cache: 'no-store', signal,
            ...(get ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            const error = new Error(result.error || `请求失败（${response.status}）`);
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function validRun(run, captured) {
        return run && run.projectId === captured.projectId && run.sessionId === captured.sessionId;
    }

    function update(record, run) {
        if (!validRun(run, record.captured)) throw new Error('助手结果不属于当前作品或对话。');
        record.run = run;
        record.message.content = run.answer || '';
        record.message.meta = { ...record.message.meta, workshopAgent: structuredClone(run) };
        checked.set(run.id, record.captured.snapshot);
        if (same(record.captured)) ui().render();
    }

    async function persist(record) {
        try { await ui().persist(record.captured.session, record.captured); }
        catch (error) { if (same(record.captured)) ui().status(`结果仍在当前对话中，保存失败：${error.message}`, 'error'); }
    }

    function release(record) {
        clearTimeout(record.timer);
        if (active !== record) return;
        active = null;
        if (same(record.captured)) { ui().state().generating = false; ui().render(); }
        else queueMicrotask(() => restore());
    }

    async function poll(record) {
        if (active !== record || record.stopped || !same(record.captured)) return;
        try {
            const result = await request('run', { runId: record.run.id }, record.controller.signal);
            if (active !== record || record.stopped || !same(record.captured)) return;
            update(record, result.run);
            if (result.run.status === 'running' || result.run.status === 'applying') {
                record.timer = setTimeout(() => poll(record), 900);
            } else { release(record); await persist(record); }
        } catch (error) {
            if (record.stopped || active !== record) return;
            const expired = error.status === 404 || error.status === 410;
            record.message.meta.workshopAgent = { ...record.run, status: expired ? 'expired' : 'failed', error: error.message };
            if (!expired) request('cancel', { runId: record.run.id }).catch(() => {});
            release(record);
            await persist(record);
        }
    }

    async function stop(record = active) {
        if (!record || record.stopped || mutation) return;
        record.stopped = true;
        clearTimeout(record.timer);
        record.controller.abort();
        if (record.run?.id) {
            record.message.meta.workshopAgent = { ...record.run, status: 'cancelled' };
            try {
                const result = await request('cancel', { runId: record.run.id });
                if (validRun(result.run, record.captured)) update(record, result.run);
            } catch (error) {
                record.message.meta.workshopAgent.error = `停止请求未确认：${error.message}`;
            }
        } else record.message.meta.workshopAgent = { ...record.message.meta.workshopAgent, status: 'cancelled' };
        release(record);
        await persist(record);
    }

    function sync() {
        if (active && !same(active.captured)) stop(active);
        queueMicrotask(() => restore());
    }

    async function start() {
        const captured = ui().capture();
        const text = ui().state().input.trim();
        if (!captured.projectId || !captured.session || !text || ui().state().generating || active || mutation) return;
        if (dirty()) { ui().status('正文或资料有未保存修改，请先保存后再使用项目助手。', 'error'); return; }
        const record = { captured, run: null, message: window.DraftHarborWorkshopSchema.createWorkshopMessage({ role: 'assistant', content: '', meta: { workshopAgent: { status: 'running', steps: [{ label: '准备当前作品上下文' }] } } }), controller: new AbortController(), stopped: false, timer: null };
        active = record;
        ui().state().generating = true;
        const savedHistory = ui().persist(captured.session, captured);
        const user = window.DraftHarborWorkshopSchema.createWorkshopMessage({ role: 'user', content: text, meta: { mode: 'agent' } });
        captured.session.messages = [...(captured.session.messages || []), user, record.message];
        ui().state().selectedAssistantMessageId = record.message.id;
        ui().input('');
        ui().render();
        try {
            await savedHistory;
            if (record.stopped || !same(captured)) { release(record); return; }
            if (dirty()) throw new Error('正文或资料有新的未保存修改，请先保存。');
            // Keep the start response observable even if the user leaves while
            // it is in flight, so the newly allocated server run can be stopped.
            const result = await request('start', { projectId: captured.projectId, sessionId: captured.sessionId, message: text, currentSceneId: ui().native().activeSceneId || undefined });
            if (!validRun(result.run, captured)) throw new Error('助手结果不属于当前作品或对话。');
            record.run = result.run;
            if (record.stopped || !same(captured)) {
                await request('cancel', { runId: result.run.id }).catch(() => {});
                record.message.meta.workshopAgent = { ...result.run, status: 'cancelled' };
                release(record);
                await persist(record);
                return;
            }
            update(record, result.run);
            await persist(record);
            if (record.stopped || active !== record) return;
            if (result.run.status === 'running') record.timer = setTimeout(() => poll(record), 900);
            else release(record);
        } catch (error) {
            record.message.meta.workshopAgent = { ...(record.run || {}), status: record.stopped ? 'cancelled' : 'failed', error: error.message };
            if (same(captured) && !record.stopped) ui().input(text);
            release(record);
            await persist(record);
        }
    }

    async function restore() {
        if (active || mutation) return;
        const captured = ui().capture();
        if (!captured.session) return;
        for (const message of captured.session.messages || []) {
            const run = message.meta?.workshopAgent;
            if (!run?.id || checked.get(run.id) === captured.snapshot || checking.get(run.id) === captured.snapshot || ['expired', 'cancelled', 'failed', 'undone'].includes(run.status)) continue;
            checking.set(run.id, captured.snapshot);
            try {
                const result = await request('run', { runId: run.id });
                if (!same(captured)) return;
                const record = { captured, message, run, controller: new AbortController(), stopped: false };
                update(record, result.run);
                if (['running', 'applying'].includes(result.run.status)) {
                    active = record;
                    ui().state().generating = true;
                    ui().render();
                    record.timer = setTimeout(() => poll(record), 900);
                }
                await persist(record);
            } catch (error) {
                if (!same(captured)) return;
                message.meta.workshopAgent = { ...run, status: error.status === 404 || error.status === 410 ? 'expired' : run.status, error: '无法确认此操作的当前状态，请重新打开对话后重试。' };
                checked.delete(run.id);
                ui().renderMessages();
                await persist({ captured, message, run: message.meta.workshopAgent });
            } finally { if (checking.get(run.id) === captured.snapshot) checking.delete(run.id); }
        }
    }

    async function act(message, action) {
        const captured = ui().capture();
        const run = message.meta?.workshopAgent;
        if (!run?.id || mutation || active || !captured.session?.messages.includes(message)) return;
        if (action !== 'cancel' && dirty()) { ui().status('正文或资料有未保存修改，请先保存再应用或撤销。', 'error'); return; }
        if (checked.get(run.id) !== captured.snapshot) { ui().status('正在核对操作状态，请稍后重试。', 'info'); await restore(); return; }
        mutation = { captured, runId: run.id, action };
        ui().state().generating = true;
        ui().render();
        const record = { captured, message, run };
        try {
            const latest = await request('run', { runId: run.id });
            if (!same(captured) || !validRun(latest.run, captured)) throw new Error('当前作品或对话已改变，操作已停止。');
            update(record, latest.run);
            const expected = action === 'undo' ? 'applied' : 'completed';
            if (latest.run.status !== expected || (action === 'apply' && !latest.run.proposal)) throw new Error('操作状态已变化，请查看最新结果。');
            if (action !== 'cancel' && dirty()) throw new Error('有新的未保存修改，请先保存。');
            const result = await request(action, { runId: run.id });
            update(record, result.run);
            await persist(record);
            if (action !== 'cancel' && same(captured)) {
                if (typeof window.refreshWorkshopAgentProject !== 'function') throw new Error('操作已写入，请重新打开作品以读取最新内容。');
                await window.refreshWorkshopAgentProject(captured.projectId, captured.snapshot, result);
            }
        } catch (error) {
            message.meta.workshopAgent = { ...message.meta.workshopAgent, error: error.message };
            if (error.status === 404 || error.status === 410) { message.meta.workshopAgent.status = 'expired'; checked.delete(run.id); }
            await persist(record);
            if (same(captured)) ui().status(error.message, 'error');
        } finally {
            mutation = null;
            if (same(captured)) { ui().state().generating = false; ui().render(); }
        }
    }

    const fieldNames = { title: '标题', content: '正文', body: '正文', summary: '摘要', tags: '标签', aliases: '别名', type: '类型', role: '人物角色', goal: '人物目标', motivation: '人物动机', conflict: '人物冲突', voice: '人物口吻', currentState: '人物当前状态', knowledge: '人物已知信息', relationshipNotes: '人物关系' };
    const typeNames = { character: '人物', location: '地点', organization: '组织', item: '物品', lore: '设定', timeline: '时间线', note: '笔记' };
    const emptyValue = value => value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);
    const fieldValue = (entry, field) => field.startsWith('characterProfile.') ? entry?.characterProfile?.[field.split('.')[1]] : entry?.[field];

    function previewFields(change) {
        if (typeof change.before === 'string' || typeof change.after === 'string') return [{ name: '正文', before: change.before, after: change.after }];
        const scene = String(change.kind).startsWith('scene');
        const fields = scene ? ['content', 'summary'] : ['title', 'type', 'summary', 'body', 'tags', 'aliases', ...['role', 'goal', 'motivation', 'conflict', 'voice', 'currentState', 'knowledge', 'relationshipNotes'].map(field => `characterProfile.${field}`)];
        return fields.map(field => ({ field, name: fieldNames[field.split('.').at(-1)], before: fieldValue(change.before, field), after: fieldValue(change.after, field) }))
            .filter(({ before, after }) => change.before ? !(emptyValue(before) && emptyValue(after)) && JSON.stringify(before) !== JSON.stringify(after) : !emptyValue(after));
    }

    function fieldText(value, field, cleared = false) {
        if (emptyValue(value)) return cleared ? '已清空' : '（空）';
        if (field === 'type') return typeNames[value] || '资料';
        return Array.isArray(value) ? value.join('、') : String(value);
    }

    function renderMessage(item, message) {
        const run = message.meta?.workshopAgent;
        item.classList.toggle('is-agent-result', !!run);
        if (!run) return;
        let panel = item.querySelector('[data-workshop-agent-result]');
        if (!panel) { panel = document.createElement('section'); panel.dataset.workshopAgentResult = ''; item.querySelector('.desktop-workshop-message-body').appendChild(panel); }
        const verified = checked.get(run.id) === ui().capture().snapshot;
        const signature = JSON.stringify([run, !!mutation, !!active, verified]);
        if (panel.dataset.signature === signature) return;
        panel.dataset.signature = signature;
        const oldOpen = panel.querySelector('details')?.open;
        panel.replaceChildren();
        const status = document.createElement('p');
        status.className = 'desktop-workshop-agent-status';
        status.setAttribute('role', 'status');
        status.textContent = run.status === 'completed' && run.proposal ? '待确认 · 尚未写入' : statusLabels[run.status] || '准备中';
        panel.append(status);
        if (run.steps?.length) {
            const steps = document.createElement('ol');
            steps.className = 'desktop-workshop-agent-steps';
            for (const step of run.steps) { const li = document.createElement('li'); li.textContent = step.label || '处理当前作品'; steps.append(li); }
            panel.append(steps);
        }
        if (run.proposal?.changes?.length) {
            const preview = document.createElement('details');
            preview.open = oldOpen === undefined ? true : oldOpen;
            const summary = document.createElement('summary');
            summary.textContent = `${run.status === 'applied' ? '已应用的修改' : '修改预览'} · ${run.proposal.changes.length} 处`;
            preview.append(summary);
            for (const change of run.proposal.changes) {
                const fields = previewFields(change);
                const card = document.createElement('article');
                card.className = 'desktop-workshop-agent-change';
                const heading = document.createElement('h4'); heading.textContent = `${change.before ? '' : '新增 · '}${change.title || change.after?.title || change.before?.title || '作品内容'}`; card.append(heading);
                const changedFields = document.createElement('p'); changedFields.className = 'desktop-workshop-agent-fields';
                changedFields.textContent = `${change.before ? '变更字段' : '新增内容'}：${fields.map(field => field.name).join('、') || '无文本变化'}`;
                card.append(changedFields);
                if (change.reason) { const reason = document.createElement('p'); reason.textContent = change.reason; card.append(reason); }
                for (const field of fields) {
                    const fieldHeading = document.createElement('h5'); fieldHeading.textContent = field.name;
                    const compare = document.createElement('div'); compare.className = `desktop-workshop-agent-compare${change.before ? '' : ' is-create'}`;
                    compare.dataset.workshopChangedField = field.field || 'content';
                    const values = change.before ? [['修改前', field.before], ['修改后', field.after]] : [['新增内容', field.after]];
                    for (const [label, value] of values) {
                        const column = document.createElement('div'); const title = document.createElement('strong'); title.textContent = label;
                        const content = document.createElement('pre'); content.textContent = fieldText(value, field.field, label === '修改后'); column.append(title, content); compare.append(column);
                    }
                    card.append(fieldHeading, compare);
                }
                preview.append(card);
            }
            panel.append(preview);
        }
        if (run.error) { const error = document.createElement('p'); error.className = 'desktop-workshop-agent-error'; error.textContent = run.error; panel.append(error); }
        const actions = document.createElement('div'); actions.className = 'desktop-workshop-agent-actions';
        const choices = run.status === 'completed' && run.proposal ? [['apply', '确认应用'], ['cancel', '取消修改']] : run.status === 'applied' ? [['undo', '撤销此次修改']] : [];
        for (const [action, label] of choices) {
            const button = document.createElement('button'); button.type = 'button'; button.className = action === 'apply' ? 'desktop-primary-action' : 'desktop-secondary-action';
            button.dataset.workshopAgentAction = action; button.textContent = mutation?.runId === run.id ? '处理中…' : label;
            button.disabled = !!mutation || !!active || !verified;
            button.addEventListener('click', () => act(message, action)); actions.append(button);
        }
        if (choices.length && !verified) { const hint = document.createElement('span'); hint.textContent = '核对操作状态后才可继续'; actions.append(hint); }
        panel.append(actions);
    }

    function renderMode() {
        const agent = mode() === 'agent';
        const state = ui().state();
        document.querySelectorAll('[data-workshop-mode]').forEach(button => { button.setAttribute('aria-pressed', String((button.dataset.workshopMode === 'agent') === agent)); button.disabled = state.generating; });
        const help = document.querySelector('[data-workshop-mode-help]');
        if (help) help.textContent = agent ? '只操作当前作品：自动检索正文与资料；修改先预览，由你确认应用。' : '讨论人物与情节，回复由你决定如何使用。';
        const elements = ui().elements();
        if (elements.template) { elements.template.closest('label').hidden = agent; elements.template.disabled = agent || !ui().session() || state.generating; }
        if (elements.input) elements.input.placeholder = agent ? '例如：核对前三场人物动机，并提出需要修正的资料。' : '想清楚再写。可用 @[资料] 或 #[场景] 引用上下文。';
        if (elements.outputActions && agent) elements.outputActions.hidden = true;
        const stopButton = document.querySelector('[data-workshop-stop]');
        if (stopButton) { stopButton.hidden = !state.generating || !!mutation; stopButton.disabled = !!active?.stopped; }
        if (elements.send) elements.send.hidden = state.generating;
    }

    function bind() {
        if (bound) return;
        bound = true;
        document.querySelectorAll('[data-workshop-mode]').forEach(button => button.addEventListener('click', () => { if (ui().state().generating) return; modes.set(key(), button.dataset.workshopMode); ui().render(); restore(); }));
        document.querySelector('[data-workshop-stop]')?.addEventListener('click', () => { if (active) stop(); else ui().stopChat(); });
        window.addEventListener('beforeunload', event => { if (!mutation) return; event.preventDefault(); event.returnValue = ''; });
    }

    window.WorkshopAgent = { mode, bind, start, sync, restore, renderMode, renderMessage, stop, isBusy,
        canLeave: (notify = true) => { if (!mutation) return true; if (notify) ui().status('正在写入作品，请稍候再离开。', 'info'); return false; } };
})();
