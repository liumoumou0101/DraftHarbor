/* global selectCompendiumEntry */
(() => {
    const state = { panel: null, entryId: '', projectId: '', snapshot: null, trigger: null, source: '' };
    const BODY_LIMIT = 2600;
    const profileNames = { role: '身份', goal: '目标', motivation: '动机', conflict: '冲突', voice: '声音', currentState: '当前状态', knowledge: '已知信息', relationshipNotes: '关系' };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function scopedEntry() {
        if (!state.projectId || currentProjectId() !== state.projectId || nativeEditorState.snapshot !== state.snapshot) return null;
        return (compendiumState.entries || []).find(entry => entry.id === state.entryId && (!entry.projectId || entry.projectId === state.projectId)) || null;
    }

    function close(options = {}) {
        if (!state.panel || state.panel.hidden) return;
        const sameProject = currentProjectId() === state.projectId && nativeEditorState.snapshot === state.snapshot;
        const focusInside = state.panel.contains(document.activeElement) || document.activeElement === document.body;
        state.panel.hidden = true;
        if (options.restoreFocus !== false && focusInside && sameProject && state.trigger && state.trigger.isConnected) state.trigger.focus({ preventScroll: true });
        state.entryId = '';
        state.trigger = null;
    }

    function guard() {
        const entry = scopedEntry();
        if (!entry) close({ restoreFocus: false });
        return entry;
    }

    function button(text, attribute, handler) {
        const node = element('button', 'desktop-compendium-peek-button', text);
        node.type = 'button';
        node.setAttribute(attribute, '');
        node.addEventListener('click', handler);
        return node;
    }

    function ensurePanel() {
        if (state.panel) return state.panel;
        const panel = element('aside', 'desktop-compendium-peek');
        panel.dataset.compendiumPeek = '';
        panel.hidden = true;
        panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'compendium-peek-title');
        const header = element('header', 'desktop-compendium-peek-header');
        const heading = element('div');
        heading.append(element('p', 'desktop-compendium-peek-eyebrow', '资料速览'));
        const title = element('h2');
        title.id = 'compendium-peek-title';
        title.dataset.compendiumPeekTitle = '';
        heading.append(title);
        const dismiss = button('关闭', 'data-compendium-peek-close', () => close());
        dismiss.setAttribute('aria-label', '关闭资料速览');
        header.append(heading, dismiss);
        const content = element('div', 'desktop-compendium-peek-content');
        for (const name of ['meta', 'summary', 'profile', 'body', 'sources']) {
            const section = element('section', `desktop-compendium-peek-${name}`);
            section.setAttribute(`data-compendium-peek-${name}`, '');
            content.append(section);
        }
        const footer = element('footer', 'desktop-compendium-peek-footer');
        const reference = button('加入写作引用', 'data-compendium-peek-reference', () => {
            if (!guard()) return;
            const included = (nativeEditorState.context && nativeEditorState.context.compendiumIds || []).includes(state.entryId);
            if (typeof window.setNativeCompendiumReference === 'function') window.setNativeCompendiumReference(state.entryId, !included);
            refresh();
        });
        const full = button('在资料库中打开', 'data-compendium-peek-open', () => {
            if (!guard() || typeof selectCompendiumEntry !== 'function' || !selectCompendiumEntry(state.entryId)) return;
            setView('compendium');
            if (document.getElementById('desktop-root')?.dataset.view !== 'compendium') return;
            close({ restoreFocus: false });
            const target = Array.from(document.querySelectorAll('[data-compendium-title], .desktop-compendium-item.is-active, [data-compendium-editor-title]'))
                .find(node => !node.disabled && node.getClientRects().length);
            if (target) {
                if (!target.matches('button, input, textarea, select, a, [tabindex]')) target.tabIndex = -1;
                target.focus({ preventScroll: true });
            }
        });
        const actions = element('div', 'desktop-compendium-peek-actions');
        actions.append(reference, full);
        const status = element('p', 'desktop-compendium-peek-reference-status');
        status.dataset.compendiumPeekReferenceStatus = '';
        status.setAttribute('role', 'status');
        footer.append(actions, status);
        panel.append(header, content, footer);
        document.body.append(panel);
        state.panel = panel;
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || panel.hidden) return;
            // A modal opened over the peek owns Escape until it closes.
            if (document.querySelector('dialog[open]')) return;
            event.preventDefault();
            close();
        });
        const root = document.getElementById('desktop-root');
        if (root) new MutationObserver(() => { if (!panel.hidden) refresh(); }).observe(root, { attributes: true, attributeFilter: ['data-view', 'data-compendium-appearance'] });
        return panel;
    }

    function sourceSummary(entry, container) {
        container.replaceChildren();
        container.append(element('h3', '', '来源'));
        const sources = Array.isArray(entry.sourceReferences) ? entry.sourceReferences : [];
        if (!sources.length) {
            container.append(element('p', '', '未记录来源'));
            return;
        }
        const names = { 'reader-transfer': '阅读摘录', 'writer-selection': '写作选段', summary: '正文摘要', workflow: '工作流', workshop: '讨论' };
        sources.slice(0, 3).forEach(source => {
            const scene = (state.snapshot?.scenes || []).find(item => item.id === source.sceneId);
            const chapter = (state.snapshot?.chapters || []).find(item => item.id === source.chapterId);
            const label = [names[source.kind] || source.kind || '资料来源', scene?.title || chapter?.title || (source.documentId ? '阅读文档' : '')].filter(Boolean).join(' · ');
            container.append(element('p', 'desktop-compendium-peek-source-label', label));
            if (source.excerpt) container.append(element('blockquote', '', String(source.excerpt).slice(0, 320)));
        });
        if (sources.length > 3) container.append(element('p', '', `另有 ${sources.length - 3} 条来源，可在资料库中查看。`));
    }

    function refresh(options = {}) {
        if (!state.panel || state.panel.hidden) return false;
        const entry = guard();
        if (!entry) return false;
        const panel = state.panel;
        const root = document.getElementById('desktop-root');
        panel.dataset.compendiumAppearance = root?.dataset.compendiumAppearance || 'paper';
        const field = name => panel.querySelector(`[data-compendium-peek-${name}]`);
        if (!options.referenceOnly) {
            field('title').textContent = entry.title || '未命名资料';
            const typeNames = { character: '人物', location: '地点', organization: '组织', item: '物品', lore: '设定', timeline: '时间线', note: '笔记' };
            field('meta').textContent = [typeNames[entry.type] || '资料', ...(entry.tags || []).slice(0, 5)].join(' · ');
            field('summary').textContent = entry.summary || '暂无摘要';
            const profile = field('profile');
            profile.replaceChildren();
            if (entry.type === 'character') Object.entries(profileNames).forEach(([key, name]) => {
                const value = entry.characterProfile && entry.characterProfile[key];
                if (!String(value || '').trim()) return;
                const row = element('div');
                row.append(element('strong', '', name), element('p', '', String(value)));
                profile.append(row);
            });
            profile.hidden = !profile.children.length;
            const body = field('body');
            body.replaceChildren();
            body.append(element('h3', '', '正文'), element('p', '', String(entry.body || '暂无正文').slice(0, BODY_LIMIT)));
            if (String(entry.body || '').length > BODY_LIMIT) body.append(element('small', '', '已显示前 2600 字，在资料库中查看完整内容。'));
            sourceSummary(entry, field('sources'));
        }
        const included = (nativeEditorState.context && nativeEditorState.context.compendiumIds || []).includes(entry.id);
        const writingProject = state.snapshot?.project?.id === state.projectId;
        const locked = !!nativeEditorState.generation?.inProgress;
        const reference = field('reference');
        reference.textContent = included ? '移出手动引用' : '加入写作引用';
        reference.setAttribute('aria-pressed', included ? 'true' : 'false');
        reference.disabled = !writingProject || locked || typeof window.setNativeCompendiumReference !== 'function';
        const automatic = entry.alwaysInContext || ['always', 'auto', 'mention'].includes(entry.contextPolicy?.mode);
        const tags = nativeEditorState.context?.compendiumTags || [];
        const tagMatch = (entry.tags || []).some(tag => tags.includes(tag));
        field('reference-status').textContent = !writingProject ? '打开对应的写作项目后可添加引用。' : locked ? '生成期间暂不能修改写作引用。' : included ? '已加入当前项目的手动引用。' : automatic || tagMatch ? '未手动引用；自动规则或已选标签仍可能引用此资料。' : '仅速览不会加入写作引用。';
        if (compendiumState.dirty && compendiumState.selectedId === entry.id) field('reference-status').textContent += ' 此处显示已保存内容，资料库中有未保存修改。';
        return true;
    }

    window.openCompendiumPeek = function openCompendiumPeek(entryId, options = {}) {
        const projectId = currentProjectId();
        const entry = (compendiumState.entries || []).find(item => item.id === entryId && (!item.projectId || item.projectId === projectId));
        if (!projectId || !entry) return false;
        const panel = ensurePanel();
        const identityChanged = state.entryId !== entryId || state.projectId !== projectId || state.snapshot !== nativeEditorState.snapshot;
        Object.assign(state, { entryId, projectId, snapshot: nativeEditorState.snapshot, trigger: options.trigger || document.activeElement, source: options.source || '' });
        panel.hidden = false;
        if (!refresh()) return false;
        if (identityChanged) panel.querySelector('.desktop-compendium-peek-content').scrollTop = 0;
        panel.focus({ preventScroll: true });
        return true;
    };
    window.closeCompendiumPeek = close;
    window.refreshCompendiumPeek = refresh;
})();
