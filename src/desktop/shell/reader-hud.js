(function () {
    const AUTO_IDLE_DELAY = 3600;
    const AUTO_HIDE_DELAY = 2600;
    let bound = false;
    let observer = null;

    function readerHudRoot() {
        return document.getElementById('desktop-root');
    }

    function readerHudShell() {
        return document.querySelector('[data-reader-shell]');
    }

    function readerHudContract() {
        return window.DraftHarborReaderHud;
    }

    function readerHudContext() {
        const shell = readerHudShell();
        const toolbar = shell && shell.querySelector('[data-reader-selection-toolbar]');
        const content = shell && shell.querySelector('[data-reader-content]');
        const active = document.activeElement;
        const dialogOpen = !!(shell && shell.querySelector('dialog[open]'));
        const selectionActive = !!readerState.transferSelection || !!(toolbar && !toolbar.hidden);
        const panelOpen = !!readerState.drawer || dialogOpen;
        return {
            panelOpen,
            dialogOpen,
            selectionActive,
            focusWithinInteractive: !!(active && shell && shell.contains(active) && (!content || !content.contains(active)))
        };
    }

    function readerHudCancelTimer() {
        if (readerState.hudTimer) window.clearTimeout(readerState.hudTimer);
        readerState.hudTimer = null;
    }

    function readerHudMoveFocusOutOfHiddenControls(shell) {
        if (!shell || !document.activeElement || !shell.contains(document.activeElement)) return;
        const active = document.activeElement;
        const content = shell.querySelector('[data-reader-content]');
        const topbar = shell.querySelector('[data-reader-topbar]');
        const readingBar = shell.querySelector('.desktop-reader-reading-bar');
        const bottombar = shell.querySelector('[data-reader-bottombar]');
        const drawer = shell.querySelector('[data-reader-left-drawer], [data-reader-settings-drawer]');
        const selectionToolbar = shell.querySelector('[data-reader-selection-toolbar]');
        const hiddenChrome = [topbar, readingBar, bottombar, drawer, selectionToolbar]
            .some((element) => element && element.contains(active));
        if (hiddenChrome && content && typeof content.focus === 'function') content.focus({ preventScroll: true });
    }

    function readerHudApply(model) {
        const shell = readerHudShell();
        if (!shell || !model) return;
        const state = model.state || 'visible';
        readerState.hudState = state;
        readerState.hudPreviousState = model.previousState || state;
        readerState.controlsVisible = state !== 'hidden';
        shell.dataset.readerHudState = state;
        shell.dataset.readerControlsVisible = readerState.controlsVisible ? 'true' : 'false';
        shell.dataset.readerFocusMode = readerState.focusMode ? 'true' : 'false';
        const root = readerHudRoot();
        if (root) root.dataset.readerFocusMode = readerState.focusMode ? 'true' : 'false';
        const focusToggle = shell.querySelector('[data-reader-focus-toggle]');
        if (focusToggle) {
            focusToggle.setAttribute('aria-pressed', readerState.focusMode ? 'true' : 'false');
            focusToggle.textContent = readerState.focusMode ? '退出专注' : '专注阅读';
            focusToggle.title = readerState.focusMode ? '退出专注阅读模式' : '隐藏阅读控件并收起桌面壳层';
        }
        if (state === 'hidden') readerHudMoveFocusOutOfHiddenControls(shell);
    }

    function readerHudTransition(event, context = readerHudContext()) {
        const contract = readerHudContract();
        const current = contract && typeof contract.createReaderHudState === 'function'
            ? contract.createReaderHudState({
                state: readerState.hudState || 'visible',
                previousState: readerState.hudPreviousState || readerState.hudState || 'visible'
            }) : { state: readerState.hudState || 'visible', previousState: readerState.hudPreviousState || 'visible' };
        const model = contract && typeof contract.transitionReaderHud === 'function'
            ? contract.transitionReaderHud(current, event, context)
            : { state: event === 'hide' ? 'hidden' : event === 'idle' ? 'idle' : 'visible', previousState: current.state };
        readerHudApply(model);
        return model;
    }

    function readerHudSyncContext() {
        const context = readerHudContext();
        if (context.selectionActive) {
            if (readerState.hudState !== 'selection-active') readerHudTransition('selection-start', context);
            readerHudCancelTimer();
            return;
        }
        if (context.panelOpen) {
            if (readerState.hudState !== 'panel-open') readerHudTransition('open-panel', context);
            readerHudCancelTimer();
            return;
        }
        if (readerState.hudState === 'panel-open') readerHudTransition('close-panel', context);
        if (readerState.hudState === 'selection-active') readerHudTransition('selection-end', context);
        readerHudSchedule();
    }

    function readerHudSchedule() {
        readerHudCancelTimer();
        const root = readerHudRoot();
        if (!root || root.dataset.view !== 'reader') return;
        if (readerState.hudMode === 'visible') {
            readerHudTransition('show');
            return;
        }
        const context = readerHudContext();
        if (readerState.hudMode === 'hidden' && !context.panelOpen && !context.selectionActive) {
            readerHudTransition('hide', context);
            return;
        }
        if (readerState.hudMode !== 'auto' || !readerState.apiMode || context.panelOpen || context.selectionActive) return;
        readerState.hudTimer = window.setTimeout(() => {
            readerState.hudTimer = null;
            const current = readerHudContext();
            if (current.panelOpen || current.selectionActive || readerState.hudMode !== 'auto') {
                readerHudSchedule();
                return;
            }
            readerHudTransition('idle', current);
            readerState.hudTimer = window.setTimeout(() => {
                readerState.hudTimer = null;
                const latest = readerHudContext();
                if (latest.panelOpen || latest.selectionActive || readerState.hudMode !== 'auto') {
                    readerHudSchedule();
                    return;
                }
                readerHudTransition('hide', latest);
            }, AUTO_HIDE_DELAY);
        }, AUTO_IDLE_DELAY);
    }

    function readerHudActivity() {
        const root = readerHudRoot();
        if (!root || root.dataset.view !== 'reader') return;
        const context = readerHudContext();
        readerHudTransition('activity', context);
        readerHudSchedule();
    }

    function readerHudShow() {
        readerHudCancelTimer();
        readerHudTransition('show', readerHudContext());
        readerHudSchedule();
    }

    function readerHudHide() {
        readerHudCancelTimer();
        readerHudTransition('hide', readerHudContext());
    }

    function readerHudNotifyPanel(open) {
        const context = readerHudContext();
        if (open) {
            readerHudCancelTimer();
            readerHudTransition('open-panel', { ...context, panelOpen: true });
        } else {
            readerHudSyncContext();
        }
    }

    function readerHudNotifySelection(active) {
        const context = readerHudContext();
        context.selectionActive = !!active;
        if (active) {
            readerHudCancelTimer();
            readerHudTransition('selection-start', context);
        } else {
            readerHudTransition('selection-end', context);
            readerHudSchedule();
        }
    }

    function readerHudHandleEscape() {
        const shell = readerHudShell();
        const dialog = shell && shell.querySelector('dialog[open]');
        if (dialog && typeof dialog.close === 'function') {
            dialog.close();
            return true;
        }
        if (readerState.drawer && typeof setReaderDrawer === 'function') {
            setReaderDrawer('');
            return true;
        }
        const selectionActive = !!readerState.transferSelection || !!(shell && shell.querySelector('[data-reader-selection-toolbar]:not([hidden])'));
        if (selectionActive) {
            if (typeof clearReaderTransferSelection === 'function') clearReaderTransferSelection();
            window.getSelection()?.removeAllRanges();
            readerHudNotifySelection(false);
            return true;
        }
        if (readerState.hudState === 'hidden' || readerState.hudState === 'idle') {
            readerHudShow();
            return true;
        }
        readerHudHide();
        return true;
    }

    function readerHudEnterFocusMode() {
        if (readerState.drawer && typeof setReaderDrawer === 'function') setReaderDrawer('');
        readerState.focusMode = true;
        if (typeof closeReaderAnnotationDialog === 'function') closeReaderAnnotationDialog();
        if (typeof clearReaderTransferSelection === 'function') clearReaderTransferSelection();
        window.getSelection()?.removeAllRanges();
        const root = readerHudRoot();
        if (root) root.dataset.readerFocusMode = 'true';
        window.syncReaderIllustrationControls?.();
        readerHudCancelTimer();
        readerHudTransition('hide', { panelOpen: false, dialogOpen: false, selectionActive: false, focusWithinInteractive: false });
        readerHudShell()?.querySelector('[data-reader-content]')?.focus({ preventScroll: true });
    }

    function readerHudExitFocusMode() {
        readerState.focusMode = false;
        const root = readerHudRoot();
        if (root) root.dataset.readerFocusMode = 'false';
        window.syncReaderIllustrationControls?.();
        readerHudShow();
    }

    function readerHudToggleFocusMode() {
        if (readerState.focusMode) readerHudExitFocusMode();
        else readerHudEnterFocusMode();
    }

    function readerHudLeaveReader() {
        readerHudCancelTimer();
        readerState.focusMode = false;
        const root = readerHudRoot();
        if (root) root.dataset.readerFocusMode = 'false';
        const shell = readerHudShell();
        if (shell) readerHudApply({ state: 'hidden', previousState: 'hidden' });
    }

    function initializeReaderHud() {
        const shell = readerHudShell();
        if (!shell || bound) return;
        bound = true;
        shell.addEventListener('pointermove', readerHudActivity, { passive: true });
        shell.addEventListener('mousemove', readerHudActivity, { passive: true });
        shell.addEventListener('touchstart', readerHudActivity, { passive: true });
        shell.addEventListener('focusin', readerHudActivity);
        document.addEventListener('keydown', (event) => {
            const root = readerHudRoot();
            if (!root || root.dataset.view !== 'reader' || event.key === 'Escape') return;
            readerHudActivity();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) readerHudCancelTimer();
            else readerHudSchedule();
        });
        observer = new MutationObserver(() => readerHudSyncContext());
        observer.observe(shell, {
            attributes: true,
            subtree: true,
            attributeFilter: ['open', 'hidden', 'aria-hidden', 'data-reader-drawer']
        });
        readerHudApply({ state: readerState.hudState || 'visible', previousState: readerState.hudPreviousState || 'visible' });
        readerHudSyncContext();
    }

    window.initializeReaderHud = initializeReaderHud;
    window.readerHudHandleEscape = readerHudHandleEscape;
    window.readerHudHide = readerHudHide;
    window.readerHudShow = readerHudShow;
    window.readerHudNotifyPanel = readerHudNotifyPanel;
    window.readerHudNotifySelection = readerHudNotifySelection;
    window.readerHudToggleFocusMode = readerHudToggleFocusMode;
    window.readerHudLeaveReader = readerHudLeaveReader;
})();
