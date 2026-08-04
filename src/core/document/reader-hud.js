(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderHud = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const HUD_STATES = Object.freeze(['visible', 'idle', 'hidden', 'panel-open', 'selection-active']);
    const HUD_EVENTS = Object.freeze([
        'activity', 'idle', 'hide', 'show', 'open-panel', 'close-panel',
        'selection-start', 'selection-end', 'leave-reader'
    ]);

    function stateValue(value, fallback = 'visible') {
        return HUD_STATES.includes(value) ? value : fallback;
    }

    function createReaderHudState(input = {}) {
        const state = stateValue(input.state);
        return {
            state,
            previousState: stateValue(input.previousState, state === 'panel-open' || state === 'selection-active' ? 'visible' : state),
            revision: Math.max(0, Math.floor(Number(input.revision) || 0))
        };
    }

    function canAutoHide(context = {}) {
        return !context.panelOpen
            && !context.selectionActive
            && !context.dialogOpen
            && !context.focusWithinInteractive;
    }

    function stableVisibleState(context = {}) {
        if (context.panelOpen || context.dialogOpen) return 'panel-open';
        if (context.selectionActive) return 'selection-active';
        return 'visible';
    }

    function transitionReaderHud(input, event, context = {}) {
        const current = createReaderHudState(input);
        const type = typeof event === 'string' ? event : event && event.type;
        if (!HUD_EVENTS.includes(type)) return current;

        let next = current.state;
        let previousState = current.previousState;
        if (type === 'leave-reader') {
            return { state: 'hidden', previousState: 'hidden', revision: current.revision + 1 };
        }
        if (type === 'open-panel') {
            if (current.state !== 'panel-open') previousState = current.state;
            next = 'panel-open';
        } else if (type === 'close-panel') {
            next = stableVisibleState(context);
            if (next === 'panel-open') next = 'visible';
            if (!context.panelOpen && !context.dialogOpen && current.previousState === 'hidden') next = 'hidden';
            previousState = next;
        } else if (type === 'selection-start') {
            if (current.state !== 'selection-active') previousState = current.state;
            next = 'selection-active';
        } else if (type === 'selection-end') {
            next = stableVisibleState(context);
            if (next === 'selection-active') next = 'visible';
            previousState = next;
        } else if (type === 'activity' || type === 'show') {
            next = stableVisibleState(context);
            previousState = next;
        } else if (type === 'idle') {
            if (canAutoHide(context) && ['visible', 'idle'].includes(current.state)) next = 'idle';
        } else if (type === 'hide') {
            if (canAutoHide(context)) next = 'hidden';
        }
        return { state: stateValue(next), previousState: stateValue(previousState, 'visible'), revision: current.revision + 1 };
    }

    return {
        HUD_STATES,
        HUD_EVENTS,
        createReaderHudState,
        canAutoHide,
        transitionReaderHud
    };
});
