    const NATIVE_SIDEBAR_WIDTHS_KEY = 'draftharbor:nativeSidebarWidths';
    const NATIVE_OUTLINE_MIN_WIDTH = 210;
    const NATIVE_ASSISTANT_MIN_WIDTH = 280;
    const NATIVE_EDITOR_MIN_WIDTH = 420;

    function clampNativeSidebarWidth(value, minimum, maximum, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(maximum, Math.max(minimum, number));
    }

    function loadNativeSidebarWidths() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(NATIVE_SIDEBAR_WIDTHS_KEY) || '{}');
            return { outline: Number(saved.outline) || 0, assistant: Number(saved.assistant) || 0 };
        } catch (_) {
            return { outline: 0, assistant: 0 };
        }
    }

    function saveNativeSidebarWidths(widths) {
        try {
            window.localStorage.setItem(NATIVE_SIDEBAR_WIDTHS_KEY, JSON.stringify(widths));
        } catch (_) { /* local preferences are optional */ }
    }

    function applyNativeSidebarWidths(widths) {
        const root = document.querySelector('[data-native-writer]');
        if (!root) return;
        const bounds = root.getBoundingClientRect();
        const outlineElement = root.querySelector('.desktop-native-outline');
        const assistantElement = root.querySelector('.desktop-native-assistant');
        const savedOutline = Number(widths.outline) || 0;
        const savedAssistant = Number(widths.assistant) || 0;
        const outline = savedOutline > 0
            ? clampNativeSidebarWidth(savedOutline, NATIVE_OUTLINE_MIN_WIDTH, Math.max(NATIVE_OUTLINE_MIN_WIDTH, bounds.width - NATIVE_ASSISTANT_MIN_WIDTH - NATIVE_EDITOR_MIN_WIDTH), NATIVE_OUTLINE_MIN_WIDTH)
            : (outlineElement ? outlineElement.getBoundingClientRect().width : NATIVE_OUTLINE_MIN_WIDTH);
        const assistant = savedAssistant > 0
            ? clampNativeSidebarWidth(savedAssistant, NATIVE_ASSISTANT_MIN_WIDTH, Math.max(NATIVE_ASSISTANT_MIN_WIDTH, bounds.width - outline - NATIVE_EDITOR_MIN_WIDTH), NATIVE_ASSISTANT_MIN_WIDTH)
            : (assistantElement ? assistantElement.getBoundingClientRect().width : NATIVE_ASSISTANT_MIN_WIDTH);
        if (savedOutline > 0) root.style.setProperty('--native-outline-width', `${outline}px`);
        else root.style.removeProperty('--native-outline-width');
        if (savedAssistant > 0) root.style.setProperty('--native-assistant-width', `${assistant}px`);
        else root.style.removeProperty('--native-assistant-width');
        return { outline, assistant };
    }

    function bindNativeSidebarResize() {
        const root = document.querySelector('[data-native-writer]');
        const outlineHandle = document.querySelector('[data-native-resize-outline]');
        const assistantHandle = document.querySelector('[data-native-resize-assistant]');
        if (!root || !outlineHandle || !assistantHandle) return;
        const widths = applyNativeSidebarWidths(loadNativeSidebarWidths());

        function startResize(side, event) {
            if (event.button !== undefined && event.button !== 0) return;
            if (window.matchMedia('(max-width: 1100px)').matches || root.classList.contains('is-assistant-bottom')) return;
            event.preventDefault();
            Object.assign(widths, applyNativeSidebarWidths(widths));
            const startX = event.clientX;
            const initial = { ...widths };
            root.classList.add('is-sidebar-resizing');
            const onMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                if (side === 'outline') widths.outline = initial.outline + delta;
                else widths.assistant = initial.assistant - delta;
                Object.assign(widths, applyNativeSidebarWidths(widths));
            };
            const onEnd = () => {
                root.classList.remove('is-sidebar-resizing');
                saveNativeSidebarWidths(widths);
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onEnd);
                document.removeEventListener('pointercancel', onEnd);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onEnd);
            document.addEventListener('pointercancel', onEnd);
        }

        function resetWidth(side) {
            widths[side] = 0;
            const variable = side === 'outline' ? '--native-outline-width' : '--native-assistant-width';
            root.style.removeProperty(variable);
            saveNativeSidebarWidths(widths);
        }

        outlineHandle.addEventListener('pointerdown', (event) => startResize('outline', event));
        assistantHandle.addEventListener('pointerdown', (event) => startResize('assistant', event));
        outlineHandle.addEventListener('dblclick', () => resetWidth('outline'));
        assistantHandle.addEventListener('dblclick', () => resetWidth('assistant'));
        window.addEventListener('resize', () => Object.assign(widths, applyNativeSidebarWidths(widths)));
    }
