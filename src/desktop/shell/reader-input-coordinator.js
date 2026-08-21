function readerHasTextSelection() {
    return !!String(window.getSelection && window.getSelection() || '').trim();
}

function readerCanPageTurn(source = 'keyboard') {
    if (source === 'keyboard' && readerState.keyboardPageTurn === false) return false;
    if (source === 'pointer' && readerState.pointerPageTurn === false) return false;
    if (source === 'touch' && readerState.touchPageTurn === false) return false;
    if (readerState.drawer || document.querySelector('dialog[open]')) return false;
    const selectionToolbar = document.querySelector('[data-reader-selection-toolbar]');
    if (selectionToolbar && !selectionToolbar.hidden) return false;
    const active = document.activeElement;
    const pageButton = active?.matches?.('[data-reader-page-prev], [data-reader-page-next], [data-reader-touch-prev], [data-reader-touch-next]');
    const chromeButton = active?.matches?.('[data-reader-settings-toggle], [data-reader-library-toggle], [data-reader-focus-toggle], [data-reader-exit]');
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && active !== document.body) return false;
    if (active?.tagName === 'BUTTON' && !pageButton && !chromeButton) return false;
    return !readerHasTextSelection();
}

function bindReaderContinuousInput(content) {
    if (!content) return;
    content.addEventListener('wheel', (event) => {
        if (readerState.effectiveLayoutMode === 'flow' || !readerCanPageTurn('pointer') || Math.abs(event.deltaY) < 8) return;
        event.preventDefault();
        readerState.wheelTurnAccumulator += event.deltaY;
        if (Math.abs(readerState.wheelTurnAccumulator) < 42) return;
        const direction = readerState.wheelTurnAccumulator > 0 ? 1 : -1;
        readerState.wheelTurnAccumulator = 0;
        queueReaderPageTurn(direction, { source: 'pointer' });
    }, { passive: false });
    content.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        readerState.pointerGesture = {
            pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            blocked: !readerCanPageTurn('touch') || readerHasTextSelection()
        };
    });
    content.addEventListener('pointerup', (event) => {
        const gesture = readerState.pointerGesture;
        readerState.pointerGesture = null;
        if (!gesture || gesture.blocked || gesture.pointerId !== event.pointerId || readerState.effectiveLayoutMode === 'flow') return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2 || readerHasTextSelection()) return;
        event.preventDefault();
        queueReaderPageTurn(deltaX < 0 ? 1 : -1, { source: 'touch' });
    });
    content.addEventListener('pointercancel', () => { readerState.pointerGesture = null; });
}

function bindReaderTouchZone(control, delta) {
    if (!control) return;
    control.addEventListener('pointerdown', (event) => {
        control.dataset.readerInputType = event.pointerType === 'touch' ? 'touch' : 'pointer';
        control.dataset.readerSelectionSuppressed = readerHasTextSelection() ? 'true' : 'false';
        if (control.dataset.readerSelectionSuppressed === 'true' || !readerCanPageTurn(control.dataset.readerInputType)) event.preventDefault();
    });
    control.addEventListener('click', (event) => {
        const inputType = control.dataset.readerInputType || 'pointer';
        if (control.dataset.readerSelectionSuppressed === 'true' || readerHasTextSelection() || !readerCanPageTurn(inputType)) {
            control.dataset.readerSelectionSuppressed = 'false';
            if (event.detail > 0) control.blur();
            event.preventDefault();
            return;
        }
        queueReaderPageTurn(delta, { source: inputType });
        if (event.detail > 0) control.blur();
    });
}
