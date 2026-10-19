    const NATIVE_SIDEBAR_WIDTHS_KEY = 'draftharbor:nativeSidebarWidths';
    const NATIVE_ASSISTANT_HEIGHT_KEY = 'draftharbor:nativeAssistantHeight';
    const NATIVE_OUTLINE_MIN_WIDTH = 210;
    const NATIVE_ASSISTANT_MIN_WIDTH = 320;
    const NATIVE_EDITOR_MIN_WIDTH = 420;
    const NATIVE_ASSISTANT_MIN_HEIGHT = 280;
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
        const availableHeight = rootHeight > 0 ? rootHeight - 280 : NATIVE_ASSISTANT_MAX_HEIGHT;
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
        const widths = loadNativeSidebarWidths();
        applyNativeSidebarWidths(widths);
        applyNativeAssistantHeight(root);

        function syncResizeAccessibility() {
            const bottom = root.classList.contains('is-assistant-bottom');
            const outline = root.querySelector('.desktop-native-outline');
            const assistant = root.querySelector('.desktop-native-assistant');
            const outlineWidth = outline ? outline.getBoundingClientRect().width : NATIVE_OUTLINE_MIN_WIDTH;
            const assistantRect = assistant ? assistant.getBoundingClientRect() : { width: NATIVE_ASSISTANT_MIN_WIDTH, height: NATIVE_ASSISTANT_MIN_HEIGHT };
            const rootWidth = root.getBoundingClientRect().width;
            const heightBounds = nativeAssistantHeightBounds(root);
            const describe = (handle, min, max, value, orientation, label) => {
                handle.setAttribute('aria-orientation', orientation);
                handle.setAttribute('aria-label', label);
                handle.setAttribute('aria-valuemin', String(Math.round(min)));
                handle.setAttribute('aria-valuemax', String(Math.round(max)));
                handle.setAttribute('aria-valuenow', String(Math.round(Math.min(max, Math.max(min, value)))));
                handle.setAttribute('aria-valuetext', `${Math.round(value)} 像素`);
                handle.setAttribute('aria-keyshortcuts', orientation === 'vertical' ? 'ArrowLeft ArrowRight Home End Enter' : 'ArrowUp ArrowDown Home End Enter');
                handle.title = `${label}：方向键调整，Home/End 到最小/最大，Enter 或双击恢复默认`;
            };
            describe(outlineHandle, NATIVE_OUTLINE_MIN_WIDTH, Math.max(NATIVE_OUTLINE_MIN_WIDTH, rootWidth - NATIVE_ASSISTANT_MIN_WIDTH - NATIVE_EDITOR_MIN_WIDTH), outlineWidth, 'vertical', '调整目录宽度');
            describe(assistantHandle, bottom ? heightBounds.min : NATIVE_ASSISTANT_MIN_WIDTH,
                bottom ? heightBounds.max : Math.max(NATIVE_ASSISTANT_MIN_WIDTH, rootWidth - outlineWidth - NATIVE_EDITOR_MIN_WIDTH),
                bottom ? assistantRect.height : assistantRect.width, bottom ? 'horizontal' : 'vertical', bottom ? '调整辅助栏高度' : '调整辅助栏宽度');
        }
        window.syncNativeSidebarResizeA11y = syncResizeAccessibility;
        syncResizeAccessibility();

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
                syncResizeAccessibility();
            };
            const onEnd = () => {
                const current = Number.parseFloat(root.style.getPropertyValue('--native-assistant-height'));
                if (Number.isFinite(current)) saveNativeAssistantHeight(current);
                root.classList.remove('is-bottom-resizing');
                syncResizeAccessibility();
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
            const startX = event.clientX;
            const initial = applyNativeSidebarWidths(widths);
            root.classList.add('is-sidebar-resizing');
            const onMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                if (side === 'outline') widths.outline = initial.outline + delta;
                else widths.assistant = initial.assistant - delta;
                const applied = applyNativeSidebarWidths(widths);
                widths[side] = applied[side];
                syncResizeAccessibility();
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
            syncResizeAccessibility();
        }

        function resetAssistantHeight() {
            root.style.removeProperty('--native-assistant-height');
            try { window.localStorage.removeItem(NATIVE_ASSISTANT_HEIGHT_KEY); } catch (_) { /* ignore */ }
            syncResizeAccessibility();
        }

        function onResizeKeydown(side, event) {
            const bottom = root.classList.contains('is-assistant-bottom');
            if (side === 'outline' && bottom) return;
            if (!bottom && window.matchMedia('(max-width: 1100px)').matches) return;
            const allowed = bottom ? ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
            if (!allowed.includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Enter') {
                if (bottom) resetAssistantHeight();
                else resetWidth(side);
                return;
            }
            const step = event.shiftKey ? 40 : 20;
            if (bottom) {
                const assistant = root.querySelector('.desktop-native-assistant');
                const current = assistant ? assistant.getBoundingClientRect().height : NATIVE_ASSISTANT_MIN_HEIGHT;
                const bounds = nativeAssistantHeightBounds(root);
                const next = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max
                    : current + (event.key === 'ArrowUp' ? step : -step);
                saveNativeAssistantHeight(applyNativeAssistantHeight(root, next));
            } else {
                const current = applyNativeSidebarWidths(widths);
                const minimum = side === 'outline' ? NATIVE_OUTLINE_MIN_WIDTH : NATIVE_ASSISTANT_MIN_WIDTH;
                const maximum = Math.max(minimum, root.getBoundingClientRect().width - NATIVE_EDITOR_MIN_WIDTH
                    - (side === 'outline' ? NATIVE_ASSISTANT_MIN_WIDTH : current.outline));
                const increase = side === 'outline' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
                widths[side] = event.key === 'Home' ? minimum : event.key === 'End' ? maximum
                    : current[side] + (increase ? step : -step);
                const applied = applyNativeSidebarWidths(widths);
                widths[side] = applied[side];
                saveNativeSidebarWidths(widths);
            }
            syncResizeAccessibility();
        }

        outlineHandle.addEventListener('pointerdown', (event) => startResize('outline', event));
        assistantHandle.addEventListener('pointerdown', (event) => startResize('assistant', event));
        outlineHandle.addEventListener('keydown', (event) => onResizeKeydown('outline', event));
        assistantHandle.addEventListener('keydown', (event) => onResizeKeydown('assistant', event));
        outlineHandle.addEventListener('dblclick', () => resetWidth('outline'));
        assistantHandle.addEventListener('dblclick', () => {
            if (root.classList.contains('is-assistant-bottom')) resetAssistantHeight();
            else resetWidth('assistant');
        });
        window.addEventListener('resize', () => {
            applyNativeSidebarWidths(widths);
            applyNativeAssistantHeight(root);
            syncResizeAccessibility();
        });
    }
