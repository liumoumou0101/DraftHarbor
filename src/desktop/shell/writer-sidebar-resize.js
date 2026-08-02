    const NATIVE_SIDEBAR_WIDTHS_KEY = 'draftharbor:nativeSidebarWidths';
    const NATIVE_ASSISTANT_HEIGHT_KEY = 'draftharbor:nativeAssistantHeight';
    const NATIVE_OUTLINE_MIN_WIDTH = 210;
    const NATIVE_ASSISTANT_MIN_WIDTH = 320;
    const NATIVE_EDITOR_MIN_WIDTH = 420;
    const NATIVE_ASSISTANT_MIN_HEIGHT = 300;
    const NATIVE_ASSISTANT_MAX_HEIGHT = 760;

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

    function loadNativeAssistantHeight() {
        try {
            return Number(window.localStorage.getItem(NATIVE_ASSISTANT_HEIGHT_KEY)) || 0;
        } catch (_) {
            return 0;
        }
    }

    function saveNativeAssistantHeight(height) {
        try {
            window.localStorage.setItem(NATIVE_ASSISTANT_HEIGHT_KEY, String(Math.round(height)));
        } catch (_) { /* local preferences are optional */ }
    }

    function nativeAssistantHeightBounds(root) {
        const rootHeight = root.getBoundingClientRect().height;
        const availableHeight = rootHeight > 0 ? rootHeight - 220 : NATIVE_ASSISTANT_MAX_HEIGHT;
        const maxHeight = Math.max(
            NATIVE_ASSISTANT_MIN_HEIGHT,
            Math.min(NATIVE_ASSISTANT_MAX_HEIGHT, availableHeight)
        );
        return { min: NATIVE_ASSISTANT_MIN_HEIGHT, max: maxHeight };
    }

    function applyNativeAssistantHeight(root, requestedHeight = loadNativeAssistantHeight()) {
        if (!root) return 0;
        const height = Number(requestedHeight);
        if (!Number.isFinite(height) || height <= 0) {
            root.style.removeProperty('--native-assistant-height');
            return 0;
        }
        const bounds = nativeAssistantHeightBounds(root);
        const clamped = Math.min(bounds.max, Math.max(bounds.min, height));
        root.style.setProperty('--native-assistant-height', `${clamped}px`);
        return clamped;
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
        applyNativeAssistantHeight(root);
        assistantHandle.setAttribute('aria-orientation', root.classList.contains('is-assistant-bottom') ? 'horizontal' : 'vertical');
        assistantHandle.setAttribute('aria-label', root.classList.contains('is-assistant-bottom') ? '调整辅助栏高度' : '调整辅助栏宽度');

        function startBottomResize(event) {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            const assistant = root.querySelector('.desktop-native-assistant');
            const initialHeight = assistant ? assistant.getBoundingClientRect().height : 0;
            if (!initialHeight) return;
            const startY = event.clientY;
            const bounds = nativeAssistantHeightBounds(root);
            root.classList.add('is-bottom-resizing');
            const onMove = (moveEvent) => {
                const nextHeight = Math.min(bounds.max, Math.max(bounds.min, initialHeight + startY - moveEvent.clientY));
                root.style.setProperty('--native-assistant-height', `${nextHeight}px`);
            };
            const onEnd = () => {
                const current = Number.parseFloat(root.style.getPropertyValue('--native-assistant-height'));
                if (Number.isFinite(current)) saveNativeAssistantHeight(current);
                root.classList.remove('is-bottom-resizing');
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onEnd);
                document.removeEventListener('pointercancel', onEnd);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onEnd);
            document.addEventListener('pointercancel', onEnd);
        }

        function startResize(side, event) {
            if (event.button !== undefined && event.button !== 0) return;
            if (root.classList.contains('is-assistant-bottom')) {
                if (side === 'assistant') startBottomResize(event);
                return;
            }
            if (window.matchMedia('(max-width: 1100px)').matches) return;
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

        function resetAssistantHeight() {
            root.style.removeProperty('--native-assistant-height');
            try { window.localStorage.removeItem(NATIVE_ASSISTANT_HEIGHT_KEY); } catch (_) { /* ignore */ }
        }

        outlineHandle.addEventListener('pointerdown', (event) => startResize('outline', event));
        assistantHandle.addEventListener('pointerdown', (event) => startResize('assistant', event));
        outlineHandle.addEventListener('dblclick', () => resetWidth('outline'));
        assistantHandle.addEventListener('dblclick', () => {
            if (root.classList.contains('is-assistant-bottom')) resetAssistantHeight();
            else resetWidth('assistant');
        });
        window.addEventListener('resize', () => {
            Object.assign(widths, applyNativeSidebarWidths(widths));
            applyNativeAssistantHeight(root);
        });
    }
