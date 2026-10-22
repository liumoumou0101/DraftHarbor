/* global compendiumElements selectCompendiumEntry saveCompendiumEntry typeLabel compendiumCharacterFields
          compendiumEditorSession matchesCurrentCompendiumDraft selectOutlineTarget */
(function () {
    'use strict';

    const PREFIX = 'draftharbor.compendium.workspace.v1.';
    const TYPES = ['character', 'location', 'organization', 'item', 'lore', 'timeline', 'summary', 'note'];
    const state = { bound: false, projectId: null, snapshot: null, entryId: '', preferences: null,
        appearance: 'paper', pane: '', showEmpty: false, insightTimer: 0, scrollFrame: 0 };
    const query = selector => document.querySelector(selector);
    const view = () => query('[data-view-panel="compendium"]');
    const desktopRoot = () => query('#desktop-root');
    const listEntries = () => Array.isArray(compendiumState.entries) ? compendiumState.entries : [];
    const active = () => desktopRoot()?.dataset.view === 'compendium';
    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };

    function readPreference(key) {
        try { return JSON.parse(localStorage.getItem(PREFIX + key) || 'null'); } catch (_) { return null; }
    }

    function writePreference(key, value) {
        try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) { /* Storage can be unavailable in private/file contexts. */ }
    }

    function sanitizedPreferences(value) {
        const saved = value && typeof value === 'object' ? value : {};
        const scroll = Object.create(null);
        for (const [id, top] of Object.entries(saved.scroll || {}).slice(0, 2000)) {
            if (typeof top === 'number' && Number.isFinite(top)) scroll[id] = Math.min(1000000, Math.max(0, top));
        }
        return { sort: ['type', 'title', 'recent'].includes(saved.sort) ? saved.sort : 'type',
            favorites: Array.isArray(saved.favorites) ? [...new Set(saved.favorites.filter(id => typeof id === 'string'))].slice(0, 2000) : [],
            favoriteOnly: saved.favoriteOnly === true, selectedId: typeof saved.selectedId === 'string' ? saved.selectedId : '', scroll };
    }

    function persist() {
        if (state.projectId && state.preferences) writePreference(`project.${encodeURIComponent(state.projectId)}`, state.preferences);
    }

    function rememberScroll() {
        const scroll = query('[data-compendium-scroll]');
        if (!scroll || !scroll.getClientRects().length || !scroll.clientHeight || !state.preferences || !state.entryId) return;
        state.preferences.scroll[state.entryId] = Math.max(0, Math.min(1000000, scroll.scrollTop));
        persist();
    }

    function preferredCompendiumWorkspaceEntryId(entries, projectId = currentProjectId()) {
        const saved = projectId === state.projectId ? state.preferences?.selectedId
            : sanitizedPreferences(readPreference(`project.${encodeURIComponent(projectId)}`)).selectedId;
        return saved && entries.some(entry => entry.id === saved && (!entry.projectId || entry.projectId === projectId)) ? saved : '';
    }

    // Runs before the authoritative editor session binds form fields to a new identity.
    function syncCompendiumWorkspaceProject() {
        if (!view()) return;
        const projectId = currentProjectId();
        const snapshot = nativeEditorState.snapshot;
        const changed = projectId !== state.projectId || snapshot !== state.snapshot;
        if (changed || compendiumState.selectedId !== state.entryId) rememberScroll();
        if (!changed) {
            if (!compendiumState.dirty && !listEntries().some(entry => entry.id === compendiumState.selectedId)) {
                compendiumState.selectedId = preferredCompendiumWorkspaceEntryId(listEntries()) || compendiumState.selectedId;
            }
            return;
        }
        if (state.scrollFrame) cancelAnimationFrame(state.scrollFrame);
        state.scrollFrame = 0;
        clearTimeout(state.insightTimer);
        state.projectId = projectId;
        state.snapshot = snapshot;
        state.entryId = '';
        state.pane = '';
        state.showEmpty = false;
        state.preferences = sanitizedPreferences(readPreference(`project.${encodeURIComponent(projectId)}`));
        const entries = listEntries().filter(entry => !entry.projectId || entry.projectId === projectId);
        const saved = state.preferences.selectedId;
        if (!compendiumState.dirty && !entries.some(entry => entry.id === compendiumState.selectedId)
            && entries.some(entry => entry.id === saved)) compendiumState.selectedId = saved;
        // Do not prune a project's preferences against an intermediate empty loading snapshot.
        if (entries.length && entries.length === listEntries().length) {
            const ids = new Set(entries.map(entry => entry.id));
            state.preferences.favorites = state.preferences.favorites.filter(id => ids.has(id));
            for (const id of Object.keys(state.preferences.scroll)) if (!ids.has(id)) delete state.preferences.scroll[id];
        }
        applyAppearance();
    }

    function summary(entry, limit = 72) {
        const text = entry.summary || entry.body || '';
        if (window.DraftHarborCompendiumInsights?.excerpt) return window.DraftHarborCompendiumInsights.excerpt(text, { maxLength: limit });
        const plain = String(text).replace(/\s+/g, ' ').trim();
        return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
    }

    function entryType(entry) {
        return isCompendiumSummaryNote(entry) ? 'summary' : entry.type || 'lore';
    }

    function compendiumWorkspaceFilteredCount(entries) {
        if (!state.preferences?.favoriteOnly) return entries.length;
        const favorites = new Set(state.preferences.favorites);
        return entries.filter(entry => favorites.has(entry.id)).length;
    }

    function renderCompendiumWorkspaceList(entries) {
        const list = compendiumElements().list;
        if (!view() || !list || !state.preferences) return false;
        const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.compendiumEntryId : '';
        const favorites = new Set(state.preferences.favorites);
        const visible = entries.filter(entry => !state.preferences.favoriteOnly || favorites.has(entry.id)).slice();
        const titleSort = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN', { numeric: true });
        visible.sort(state.preferences.sort === 'recent'
            ? (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || titleSort(a, b)
            : state.preferences.sort === 'title' ? titleSort
                : (a, b) => TYPES.indexOf(entryType(a)) - TYPES.indexOf(entryType(b)) || titleSort(a, b));
        list.replaceChildren();
        const count = query('[data-compendium-list-count]');
        if (count) count.textContent = `${visible.length} / ${listEntries().length}`;
        if (!currentProjectId() || !visible.length) {
            const message = !currentProjectId() ? '从书库打开一个项目，开始整理故事。' : !listEntries().length ? '第一份资料，留给新的灵感。'
                : state.preferences.favoriteOnly && !favorites.size ? '还没有收藏。打开资料后，点击标题旁的「收藏」。' : '没有找到匹配的资料，试试其他关键词或类型。';
            list.append(node('p', 'compendium-empty', message));
        } else {
            let groupType = '';
            let group = list;
            for (const entry of visible) {
                const type = entryType(entry);
                if (state.preferences.sort === 'type' && type !== groupType) {
                    groupType = type;
                    group = node('section', 'compendium-list-group');
                    group.append(node('h3', 'compendium-list-group-title', type === 'summary' ? '摘要' : typeLabel(type)));
                    list.append(group);
                }
                const button = node('button', 'desktop-compendium-item');
                button.type = 'button';
                button.dataset.compendiumEntryId = entry.id;
                const selected = entry.id === compendiumState.selectedId;
                button.classList.toggle('is-active', selected);
                if (selected) button.setAttribute('aria-current', 'true');
                const heading = node('span', 'compendium-item-heading');
                heading.append(node('strong', 'compendium-item-title', entry.title || '未命名资料'));
                if (favorites.has(entry.id)) {
                    const pin = node('span', 'compendium-item-pin', '★');
                    pin.setAttribute('aria-label', '已收藏');
                    heading.append(pin);
                }
                button.append(heading);
                const preview = summary(entry);
                if (preview) button.append(node('span', 'compendium-item-summary', preview));
                button.append(node('span', 'compendium-item-meta', `${type === 'summary' ? '摘要' : typeLabel(type)}${entry.tags?.length ? ` · ${entry.tags.slice(0, 2).join(' / ')}` : ''}`));
                button.addEventListener('click', () => selectCompendiumEntry(entry.id));
                group.append(button);
            }
        }
        if (focusedId) Array.from(list.querySelectorAll('[data-compendium-entry-id]')).find(button => button.dataset.compendiumEntryId === focusedId)?.focus({ preventScroll: true });
        return true;
    }

    function applyAppearance() {
        if (view()) view().dataset.appearance = state.appearance;
        if (desktopRoot()) desktopRoot().dataset.compendiumAppearance = state.appearance;
        const button = query('button[data-compendium-appearance]');
        if (button) {
            button.textContent = state.appearance === 'ink' ? '墨色' : '纸色';
            button.setAttribute('aria-pressed', String(state.appearance === 'ink'));
            button.setAttribute('aria-label', state.appearance === 'ink' ? '切换为纸面模式' : '切换为墨色模式');
            button.title = state.appearance === 'ink' ? '切换为纸面模式' : '切换为墨色模式';
        }
    }

    function setDirectoryCollapsed(collapsed) {
        if (view()) view().dataset.directoryCollapsed = String(collapsed);
        const button = query('[data-compendium-sidebar-toggle]');
        if (!button) return;
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', collapsed ? '展开资料目录' : '收起资料目录');
        button.title = collapsed ? '展开资料目录' : '收起资料目录';
    }

    function restoreScroll() {
        const scroll = query('[data-compendium-scroll]');
        if (scroll?.getClientRects().length && state.preferences) scroll.scrollTop = Math.min(state.preferences.scroll[state.entryId] || 0, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
    }

    function autoheight(field) {
        if (!field || field.tagName !== 'TEXTAREA' || !field.getClientRects().length) return;
        const scroll = query('[data-compendium-scroll]');
        const top = scroll?.scrollTop || 0;
        field.style.height = 'auto';
        const style = getComputedStyle(field);
        const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
        field.style.height = `${field.scrollHeight + border}px`;
        if (scroll) scroll.scrollTop = top;
    }

    function refreshFields() {
        const elements = compendiumElements();
        document.querySelectorAll('[data-compendium-field]').forEach(label => {
            const field = label.querySelector('textarea, input');
            label.hidden = !state.showEmpty && !field?.value.trim() && !label.contains(document.activeElement);
        });
        const show = query('[data-compendium-show-empty]');
        if (show) {
            show.setAttribute('aria-expanded', String(state.showEmpty));
            show.textContent = state.showEmpty ? '收起空白项' : '补充人物侧写';
        }
        elements.form?.querySelectorAll('textarea').forEach(autoheight);
        const text = [elements.title, elements.summary, elements.body, ...compendiumCharacterFields(elements)].map(field => field?.value || '').join('');
        const count = query('[data-compendium-word-count]');
        if (count) count.textContent = `${Array.from(text.replace(/\s/g, '')).length.toLocaleString('zh-CN')} 字`;
        const heading = query('[data-compendium-heading-type]');
        if (heading) heading.textContent = typeLabel(elements.entryType?.value || 'lore');
        const meta = query('[data-compendium-heading-meta]');
        if (meta) {
            meta.replaceChildren();
            parseCommaList(elements.aliases?.value).slice(0, 8).forEach(alias => meta.append(node('span', 'compendium-meta-chip', `亦称 ${alias}`)));
            parseCommaList(elements.tags?.value).slice(0, 8).forEach(tag => meta.append(node('span', 'compendium-meta-chip', `#${tag}`)));
        }
        const caption = query('[data-compendium-policy-caption]');
        if (caption) caption.textContent = ({ disabled: 'AI · 不自动加入', manual: 'AI · 手动参考', mention: 'AI · 提及时参考', auto: 'AI · 场景匹配', always: 'AI · 始终参考' })[elements.policyMode?.value] || 'AI · 手动参考';
    }

    function renderPane() {
        const inspector = query('[data-compendium-inspector]');
        if (!inspector) return;
        inspector.hidden = !state.pane || !selectedCompendiumEntry() || !currentProjectId();
        if (view()) view().dataset.inspectorOpen = String(!inspector.hidden);
        document.querySelectorAll('[data-compendium-pane]').forEach(pane => { pane.hidden = pane.dataset.compendiumPane !== state.pane; });
        document.querySelectorAll('[data-compendium-pane-toggle]').forEach(button => button.setAttribute('aria-expanded', String(!inspector.hidden && button.dataset.compendiumPaneToggle === state.pane)));
        const title = query('[data-compendium-inspector-title]');
        if (title) title.textContent = state.pane === 'settings' ? '整理与 AI 使用' : '关联与来源';
    }

    function closePane() {
        state.pane = '';
        renderPane();
        state.paneTrigger?.focus({ preventScroll: true });
        refreshFields();
    }

    function closeEntryActions(focus = false) {
        const actions = query('.compendium-entry-actions');
        if (!actions?.open) return;
        actions.open = false;
        if (focus) actions.querySelector('summary')?.focus({ preventScroll: true });
    }

    function draftForInsights() {
        const selected = selectedCompendiumEntry();
        if (!selected) return null;
        const elements = compendiumElements();
        return { ...selected, title: elements.title?.value || '', summary: elements.summary?.value || '', body: elements.body?.value || '',
            tags: parseCommaList(elements.tags?.value), aliases: parseCommaList(elements.aliases?.value),
            characterProfile: { ...(selected.characterProfile || {}), ...Object.fromEntries(compendiumCharacterFields(elements).map((field, index) => [['role', 'goal', 'motivation', 'conflict', 'voice', 'currentState', 'knowledge', 'relationshipNotes'][index], field?.value || ''])) } };
    }

    function openScene(sceneId, projectId, snapshot) {
        const available = snapshot?.scenes?.some(scene => scene.id === sceneId && (!scene.projectId || scene.projectId === projectId));
        if (projectId !== currentProjectId() || nativeEditorState.snapshot !== snapshot || !available) return false;
        if (typeof setView !== 'function' || typeof selectOutlineTarget !== 'function') return false;
        setView('writer');
        // setView is deliberately void and can refuse navigation while saving/generating or after a declined guard.
        if (desktopRoot()?.dataset.view !== 'writer' || projectId !== currentProjectId() || nativeEditorState.snapshot !== snapshot) return false;
        return selectOutlineTarget('scene', sceneId) !== false;
    }

    function renderInsights() {
        if (state.pane !== 'connections') return;
        const entry = draftForInsights();
        const api = window.DraftHarborCompendiumInsights;
        const status = query('[data-compendium-insights-status]');
        const snapshot = nativeEditorState.snapshot;
        const projectId = currentProjectId();
        const result = entry && api?.analyzeEntry ? api.analyzeEntry(entry, snapshot, listEntries()) : null;
        if (status) status.textContent = !result ? '当前环境尚未加载关联分析。' : '根据当前项目正文、明确关联与已保存来源整理。';
        const labels = { explicit: '明确关联', text: '正文提及', cast: '场景人物', 'mentions-entry': '本条目提及', 'mentioned-by-entry': '对方条目提及', 'shared-tag': '共同标签' };
        for (const kind of ['mentions', 'related', 'sources']) {
            const container = query(`[data-compendium-insights-${kind}]`);
            if (!container) continue;
            container.replaceChildren();
            const items = result?.[kind] || [];
            if (!items.length) container.append(node('p', 'compendium-insight-empty', ({ mentions: '还没有发现对应的故事片段。', related: '暂未发现文字提及或共同标签。', sources: '这份资料没有保存来源记录。' })[kind]));
            for (const item of items) {
                const card = node('article', 'compendium-insight-card');
                card.append(node('strong', 'compendium-insight-title', kind === 'mentions' ? item.sceneTitle || '未命名场景' : kind === 'related' ? item.title || '未命名资料' : item.label || '来源记录'));
                const detail = kind === 'mentions' ? [item.chapterTitle, labels[item.matchKind]].filter(Boolean).join(' · ')
                    : kind === 'related' ? labels[item.reason] : item.sceneId && !item.sceneAvailable ? '原场景已不可用 · 保留历史摘录' : '已保存的来源摘录';
                card.append(node('span', 'compendium-insight-meta', detail));
                if (item.excerpt) card.append(node('p', 'compendium-insight-excerpt', item.excerpt));
                if (kind === 'related' || kind === 'mentions' || (kind === 'sources' && item.sceneAvailable)) {
                    const button = node('button', 'compendium-insight-action', kind === 'related' ? '速览资料' : '前往场景');
                    button.type = 'button';
                    button.addEventListener('click', () => {
                        if (projectId !== currentProjectId() || nativeEditorState.snapshot !== snapshot) return;
                        if (kind === 'related') {
                            if (!listEntries().some(candidate => candidate.id === item.entryId)) return;
                            if (typeof window.openCompendiumPeek === 'function') window.openCompendiumPeek(item.entryId, { trigger: button, source: 'compendium' });
                            else selectCompendiumEntry(item.entryId);
                        } else openScene(item.sceneId, projectId, snapshot);
                    });
                    card.append(button);
                }
                container.append(card);
            }
            if (result?.truncated?.[kind]) container.append(node('p', 'compendium-insight-empty', `显示 ${items.length} / ${result.totals[kind]} 条，更多内容可在项目中查阅。`));
        }
    }

    function renderCompendiumWorkspace({ identityChanged = false } = {}) {
        if (!view() || !state.preferences) return;
        const selected = selectedCompendiumEntry();
        const changed = identityChanged || state.entryId !== (selected?.id || '');
        state.entryId = selected?.id || '';
        if (changed) {
            state.showEmpty = false;
            if (state.scrollFrame) cancelAnimationFrame(state.scrollFrame);
            const identity = { projectId: state.projectId, snapshot: state.snapshot, entryId: state.entryId };
            state.scrollFrame = requestAnimationFrame(() => {
                state.scrollFrame = 0;
                if (identity.projectId !== state.projectId || identity.snapshot !== state.snapshot || identity.entryId !== state.entryId) return;
                restoreScroll();
            });
        }
        if (state.entryId) state.preferences.selectedId = state.entryId;
        if (listEntries().length) {
            const ids = new Set(listEntries().map(entry => entry.id));
            state.preferences.favorites = state.preferences.favorites.filter(id => ids.has(id));
            for (const id of Object.keys(state.preferences.scroll)) if (!ids.has(id)) delete state.preferences.scroll[id];
        }
        persist();
        const sort = query('[data-compendium-sort]');
        if (sort) sort.value = state.preferences.sort;
        const favorite = query('[data-compendium-favorites]');
        if (favorite) favorite.setAttribute('aria-pressed', String(state.preferences.favoriteOnly));
        const pin = query('[data-compendium-pin]');
        if (pin) {
            const pinned = state.preferences.favorites.includes(state.entryId);
            pin.disabled = !selected;
            pin.textContent = pinned ? '已收藏' : '收藏';
            pin.setAttribute('aria-pressed', String(pinned));
            pin.setAttribute('aria-label', pinned ? '取消收藏这份资料' : '收藏这份资料');
            pin.title = pinned ? '取消收藏' : '收藏';
        }
        const clear = query('[data-compendium-clear-search]');
        if (clear) clear.hidden = !compendiumState.query;
        if (!selected) setDirectoryCollapsed(false);
        const updated = query('[data-compendium-updated]');
        if (updated) {
            const date = new Date(selected?.updatedAt || '');
            updated.textContent = Number.isNaN(date.getTime()) ? '' : `更新于 ${date.toLocaleDateString('zh-CN')}`;
        }
        renderPane();
        refreshFields();
        renderInsights();
        refreshRevertButton();
    }

    function refreshRevertButton() {
        const revert = query('[data-compendium-revert]');
        if (revert) revert.disabled = !compendiumState.dirty || !selectedCompendiumEntry()
            || !!matchesCurrentCompendiumDraft(compendiumEditorSession.deleting)
            || Array.from(compendiumEditorSession.saves).some(matchesCurrentCompendiumDraft);
    }

    function compendiumWorkspaceDraftChanged() {
        if (!state.bound) return;
        refreshFields();
        refreshRevertButton();
        clearTimeout(state.insightTimer);
        if (state.pane === 'connections') state.insightTimer = setTimeout(renderInsights, 180);
    }

    function editable(target) {
        return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    }

    function keyboard(event) {
        if (!active() || event.defaultPrevented || event.isComposing || event.keyCode === 229 || document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')) return;
        const key = event.key.toLowerCase();
        if (key === 'escape') {
            if (query('[data-compendium-peek]:not([hidden])')) return;
            if (query('.compendium-entry-actions[open]')) {
                event.preventDefault();
                closeEntryActions(true);
            } else if (state.pane && query('[data-compendium-inspector]')?.contains(event.target)) {
                event.preventDefault();
                closePane();
            }
            return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 's') {
            event.preventDefault();
            saveCompendiumEntry();
            return;
        }
        if (!editable(event.target) && (((event.ctrlKey || event.metaKey) && !event.altKey && key === 'k') || (!event.ctrlKey && !event.metaKey && !event.altKey && key === '/'))) {
            event.preventDefault();
            setDirectoryCollapsed(false);
            compendiumElements().search?.focus();
            return;
        }
        const button = event.target instanceof Element ? event.target.closest('[data-compendium-entry-id]') : null;
        if (!button || event.ctrlKey || event.metaKey || event.altKey) return;
        const buttons = Array.from(compendiumElements().list.querySelectorAll('[data-compendium-entry-id]'));
        const index = buttons.indexOf(button);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            buttons[next]?.focus();
        } else if (event.key === ' ' && typeof window.openCompendiumPeek === 'function') {
            event.preventDefault();
            window.openCompendiumPeek(button.dataset.compendiumEntryId, { trigger: button, source: 'compendium' });
        }
    }

    function bindCompendiumWorkspace() {
        if (state.bound || !view()) return;
        state.bound = true;
        state.appearance = readPreference('appearance') === 'ink' ? 'ink' : 'paper';
        syncCompendiumWorkspaceProject();
        const on = (selector, event, listener) => query(selector)?.addEventListener(event, listener);
        document.querySelectorAll('[data-compendium-pane-toggle]').forEach(button => button.addEventListener('click', () => {
            state.paneTrigger = button.closest('.compendium-entry-actions')?.querySelector('summary') || button;
            state.pane = state.pane === button.dataset.compendiumPaneToggle ? '' : button.dataset.compendiumPaneToggle;
            renderPane();
            renderInsights();
            refreshFields();
        }));
        on('[data-compendium-inspector-close]', 'click', closePane);
        on('button[data-compendium-appearance]', 'click', () => {
            state.appearance = state.appearance === 'paper' ? 'ink' : 'paper';
            writePreference('appearance', state.appearance);
            applyAppearance();
        });
        on('[data-compendium-sidebar-toggle]', 'click', () => {
            const collapsed = view().dataset.directoryCollapsed !== 'true';
            setDirectoryCollapsed(collapsed);
            requestAnimationFrame(refreshFields);
        });
        on('[data-compendium-sort]', 'change', event => { state.preferences.sort = event.target.value; persist(); renderCompendium(); });
        on('[data-compendium-favorites]', 'click', () => { state.preferences.favoriteOnly = !state.preferences.favoriteOnly; persist(); renderCompendium(); window.setCompendiumCountStatus(); });
        on('[data-compendium-pin]', 'click', () => {
            const id = selectedCompendiumEntry()?.id;
            if (!id) return;
            state.preferences.favorites = state.preferences.favorites.includes(id) ? state.preferences.favorites.filter(value => value !== id) : [...state.preferences.favorites, id];
            persist();
            renderCompendium();
            window.setCompendiumCountStatus();
        });
        on('[data-compendium-clear-search]', 'click', () => { compendiumState.query = ''; renderCompendium(); window.setCompendiumCountStatus(); compendiumElements().search?.focus(); });
        on('[data-compendium-show-empty]', 'click', () => { state.showEmpty = !state.showEmpty; refreshFields(); });
        on('[data-compendium-title]', 'keydown', event => {
            if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) event.preventDefault();
        });
        on('[data-compendium-title]', 'paste', event => {
            const text = event.clipboardData?.getData('text/plain');
            if (!text || !/[\r\n]/.test(text)) return;
            event.preventDefault();
            const field = event.currentTarget;
            const remaining = field.maxLength < 0 ? Infinity : Math.max(0, field.maxLength - field.value.length + field.selectionEnd - field.selectionStart);
            field.setRangeText(text.replace(/[\r\n]+/g, ' ').slice(0, remaining), field.selectionStart, field.selectionEnd, 'end');
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        on('[data-compendium-scroll]', 'scroll', rememberScroll);
        on('[data-compendium-revert]', 'click', () => {
            refreshRevertButton();
            if (query('[data-compendium-revert]').disabled || !confirmAbandonCompendiumEdits()) return;
            renderCompendium();
        });
        document.addEventListener('keydown', keyboard);
        document.addEventListener('click', event => {
            const actions = query('.compendium-entry-actions');
            if (actions?.open && (!actions.contains(event.target) || event.target.closest('button'))) closeEntryActions();
        });
        window.addEventListener('resize', () => requestAnimationFrame(refreshFields));
        if (desktopRoot()) {
            new MutationObserver(() => {
                if (!active()) return;
                requestAnimationFrame(() => { if (active()) { refreshFields(); restoreScroll(); } });
            }).observe(desktopRoot(), { attributes: true, attributeFilter: ['data-view'] });
        }
        if (typeof ResizeObserver === 'function' && query('[data-compendium-scroll]')) {
            new ResizeObserver(() => requestAnimationFrame(refreshFields)).observe(query('[data-compendium-scroll]'));
        }
        compendiumElements().form?.addEventListener('toggle', event => {
            if (event.target.matches('[data-compendium-character-details]')) refreshFields();
        }, true);
    }

    Object.assign(window, { bindCompendiumWorkspace, syncCompendiumWorkspaceProject, renderCompendiumWorkspace,
        renderCompendiumWorkspaceList, compendiumWorkspaceDraftChanged, preferredCompendiumWorkspaceEntryId,
        compendiumWorkspaceFilteredCount, refreshCompendiumWorkspaceSaveStatus: refreshRevertButton });
})();
