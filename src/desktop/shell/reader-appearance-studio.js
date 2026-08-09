(function () {
    const THEME_LABELS = Object.freeze({
        white: '白纸', paper: '书籍纸', warm: '暖黄', eye: '护眼', ink: '墨灰', oled: 'OLED', dark: '深色（兼容）', sepia: '旧版护眼（兼容）'
    });
    let bound = false;

    function appearanceSnapshot() {
        return typeof window.readerPreferenceSnapshot === 'function'
            ? window.readerPreferenceSnapshot()
            : null;
    }

    function appearanceSetStatus(message) {
        if (typeof window.updateReaderPreferenceStatus === 'function') window.updateReaderPreferenceStatus(message);
    }

    function appearanceBeginSession() {
        const snapshot = appearanceSnapshot();
        if (snapshot) readerState.appearanceStudioBaseline = structuredClone(snapshot);
    }

    function appearanceMutate(mutator, options = {}) {
        if (!readerState.appearanceStudioBaseline) appearanceBeginSession();
        const locator = typeof window.captureReaderPositionLocator === 'function' ? window.captureReaderPositionLocator() : null;
        window.stopReaderPageFlip?.();
        mutator();
        readerState.appearanceProfileId = 'custom';
        readerState.anchorLocator = locator || readerState.anchorLocator;
        if (typeof window.applyReaderSettings === 'function') window.applyReaderSettings({ reflow: options.reflow !== false });
        if (options.reflow !== false && !readerState.apiMode && readerState.document && typeof window.renderReader === 'function') window.renderReader();
        if (typeof window.syncReaderSettingsControls === 'function') window.syncReaderSettingsControls();
        if (typeof window.saveReaderState === 'function') window.saveReaderState();
        if (typeof window.scheduleReaderPreferenceSave === 'function') window.scheduleReaderPreferenceSave();
        if (options.releaseFocus && options.control === document.activeElement) options.control.blur();
    }

    function setReaderAppearanceStudioSection(section) {
        document.querySelectorAll('[data-reader-studio-tab]').forEach((tab) => {
            const selected = tab.dataset.readerStudioTab === section;
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
            tab.tabIndex = selected ? 0 : -1;
        });
        document.querySelectorAll('[data-reader-studio-section]').forEach((panel) => {
            const selected = panel.dataset.readerStudioSection === section;
            panel.hidden = !selected;
            panel.setAttribute('aria-hidden', selected ? 'false' : 'true');
        });
    }

    function syncQuickAppearance() {
        const theme = document.querySelector('[data-reader-quick-theme]');
        if (theme) theme.value = THEME_LABELS[readerState.theme] ? readerState.theme : 'ink';
        const family = document.querySelector('[data-reader-quick-font-family]');
        if (family) family.value = readerState.fontFamily || 'system';
        const layout = document.querySelector('[data-reader-quick-layout]');
        if (layout) layout.value = readerState.layoutMode || 'flow';
        const size = document.querySelector('[data-reader-quick-font-size]');
        if (size) size.textContent = `${readerState.fontSize} px`;
    }

    async function saveReaderAppearanceProfile() {
        const name = window.prompt('方案名称', '我的阅读方案');
        if (!name || !name.trim()) return;
        const preferences = appearanceSnapshot();
        if (!preferences) return;
        const response = await window.readerApi('/api/reader/appearances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profile: { name: name.trim(), preferences: { ...preferences, appearanceProfileId: 'user:pending' } },
                expectedUpdatedAt: readerState.appearanceRecordUpdatedAt || ''
            })
        });
        const profile = response.profile;
        readerState.appearanceRecordUpdatedAt = response.record && response.record.updatedAt || '';
        readerState.appearanceProfiles = response.record && response.record.profiles || [];
        if (typeof window.renderReaderAppearanceProfileOptions === 'function') window.renderReaderAppearanceProfileOptions();
        readerState.appearanceProfileId = profile.profileId;
        if (typeof window.syncReaderSettingsControls === 'function') window.syncReaderSettingsControls();
        if (typeof window.saveReaderState === 'function') window.saveReaderState();
        if (typeof window.scheduleReaderPreferenceSave === 'function') window.scheduleReaderPreferenceSave();
        appearanceSetStatus(`方案“${profile.name}”已保存。`);
    }

    async function deleteReaderAppearanceProfile() {
        const profileId = readerState.appearanceProfileId;
        if (!/^user:/.test(profileId)) return;
        if (!window.confirm('删除当前用户方案？当前阅读设置不会被删除。')) return;
        const params = new URLSearchParams({ profileId });
        if (readerState.appearanceRecordUpdatedAt) params.set('expectedUpdatedAt', readerState.appearanceRecordUpdatedAt);
        const response = await window.readerApi(`/api/reader/appearances?${params.toString()}`, { method: 'DELETE' });
        readerState.appearanceRecordUpdatedAt = response.record && response.record.updatedAt || '';
        readerState.appearanceProfiles = response.record && response.record.profiles || [];
        if (typeof window.applyReaderAppearanceProfile === 'function') window.applyReaderAppearanceProfile('default');
        if (typeof window.renderReaderAppearanceProfileOptions === 'function') window.renderReaderAppearanceProfileOptions();
        if (typeof window.syncReaderSettingsControls === 'function') window.syncReaderSettingsControls();
        if (typeof window.saveReaderState === 'function') window.saveReaderState();
        if (typeof window.scheduleReaderPreferenceSave === 'function') window.scheduleReaderPreferenceSave();
        appearanceSetStatus('当前用户方案已删除，已回到默认阅读。');
    }

    function undoReaderAppearanceSession() {
        if (!readerState.appearanceStudioBaseline || typeof window.restoreReaderPreferenceSnapshot !== 'function') return;
        window.restoreReaderPreferenceSnapshot(readerState.appearanceStudioBaseline);
        syncQuickAppearance();
        appearanceSetStatus('本次外观修改已撤销。');
    }

    function bindQuickSelect(selector, mutator, options) {
        document.querySelector(selector)?.addEventListener('change', (event) => appearanceMutate(
            () => mutator(event.currentTarget.value),
            { ...(options || {}), control: event.currentTarget }
        ));
    }

    function initializeReaderAppearanceStudio() {
        if (bound) return;
        bound = true;
        document.querySelectorAll('[data-reader-studio-tab]').forEach((tab) => {
            tab.addEventListener('click', () => setReaderAppearanceStudioSection(tab.dataset.readerStudioTab));
            tab.addEventListener('keydown', (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                const tabs = Array.from(document.querySelectorAll('[data-reader-studio-tab]'));
                const current = tabs.indexOf(tab);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                event.preventDefault();
                tabs[next].focus();
                tabs[next].click();
            });
        });
        bindQuickSelect('[data-reader-quick-theme]', (value) => { readerState.theme = value; }, { reflow: false });
        bindQuickSelect('[data-reader-quick-font-family]', (value) => {
            const control = document.querySelector('[data-reader-quick-font-family]');
            readerState.fontId = window.readerFontIdForSelection?.(control) || value;
            readerState.fontFamily = window.readerFontFamilyForSelection?.(control) || value;
        });
        bindQuickSelect('[data-reader-quick-layout]', (value) => { readerState.layoutMode = value; }, { releaseFocus: true });
        document.querySelector('[data-reader-font-decrease]')?.addEventListener('click', () => appearanceMutate(() => { readerState.fontSize = Math.max(15, readerState.fontSize - 1); }));
        document.querySelector('[data-reader-font-increase]')?.addEventListener('click', () => appearanceMutate(() => { readerState.fontSize = Math.min(26, readerState.fontSize + 1); }));
        document.querySelector('[data-reader-quick-more]')?.addEventListener('click', () => {
            appearanceBeginSession();
            if (typeof window.setReaderDrawer === 'function') window.setReaderDrawer('right');
        });
        document.querySelector('[data-reader-appearance-save]')?.addEventListener('click', () => saveReaderAppearanceProfile().catch((error) => appearanceSetStatus(`方案保存失败：${error.message || error}`)));
        document.querySelector('[data-reader-appearance-delete]')?.addEventListener('click', () => deleteReaderAppearanceProfile().catch((error) => appearanceSetStatus(`方案删除失败：${error.message || error}`)));
        document.querySelector('[data-reader-appearance-undo]')?.addEventListener('click', undoReaderAppearanceSession);
        setReaderAppearanceStudioSection('scheme');
        syncQuickAppearance();
    }

    window.initializeReaderAppearanceStudio = initializeReaderAppearanceStudio;
    window.readerAppearanceStudioBeginSession = appearanceBeginSession;
    window.setReaderAppearanceStudioSection = setReaderAppearanceStudioSection;
    window.syncReaderQuickAppearance = syncQuickAppearance;
})();
