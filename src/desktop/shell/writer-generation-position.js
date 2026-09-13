(() => {
    const NATIVE_GENERATION_OUTPUT_POSITION_KEY = 'draftharbor:nativeGenerationOutputPosition';
    const NATIVE_GENERATION_OUTPUT_POSITION_VERSION = 1;
    let manualPosition;

    function readNativeGenerationOutputPosition() {
        if (manualPosition !== undefined) return manualPosition;
        manualPosition = null;
        try {
            const value = JSON.parse(window.localStorage.getItem(NATIVE_GENERATION_OUTPUT_POSITION_KEY) || 'null');
            // Older releases also saved automatic positions. They cannot identify a user drag.
            if (value && value.version === NATIVE_GENERATION_OUTPUT_POSITION_VERSION && value.mode === 'manual'
                && Number.isFinite(value.left) && Number.isFinite(value.top)) {
                manualPosition = { left: value.left, top: value.top };
            }
        } catch (error) { return null; }
        return manualPosition;
    }

    function writeNativeGenerationOutputPosition(position) {
        if (!position) return;
        manualPosition = { left: Math.round(position.left), top: Math.round(position.top) };
        try {
            window.localStorage.setItem(NATIVE_GENERATION_OUTPUT_POSITION_KEY, JSON.stringify({
                version: NATIVE_GENERATION_OUTPUT_POSITION_VERSION, mode: 'manual', ...manualPosition
            }));
        } catch (error) { /* ignore */ }
    }

    function clearNativeGenerationOutputPosition() {
        manualPosition = null;
        try { window.localStorage.removeItem(NATIVE_GENERATION_OUTPUT_POSITION_KEY); } catch (error) { /* ignore */ }
    }

    function nativeGenerationOutputFooterReserve(bodyRect) {
        const footer = document.querySelector('[data-native-paper-footer]');
        if (!footer || window.getComputedStyle(footer).display === 'none') return 12;
        const footerRect = footer.getBoundingClientRect();
        return footerRect.height < 1 ? 12 : Math.max(12, bodyRect.bottom - footerRect.top + 8);
    }

    function clampNativeGenerationOutputPosition(position, bodyRect, outputRect) {
        const margin = 12;
        const bottomReserve = nativeGenerationOutputFooterReserve(bodyRect);
        const maxLeft = Math.max(margin, bodyRect.width - outputRect.width - margin);
        const maxTop = Math.max(margin, bodyRect.height - outputRect.height - bottomReserve);
        return {
            left: Math.min(maxLeft, Math.max(margin, Number(position.left) || 0)),
            top: Math.min(maxTop, Math.max(margin, Number(position.top) || 0))
        };
    }

    function defaultNativeGenerationOutputPosition(bodyRect, outputRect) {
        return clampNativeGenerationOutputPosition({
            left: bodyRect.width - outputRect.width - 12,
            top: 12
        }, bodyRect, outputRect);
    }

    function syncNativeGenerationOutputPosition(options = {}) {
        if (options.reset) clearNativeGenerationOutputPosition();
        const elements = nativeEditorElements();
        const output = elements.generationOutput;
        const body = elements.editorBody;
        if (!output || !body || output.hidden) return null;
        if (output.classList.contains('is-generation-output-dragging')) return null;
        const bodyRect = body.getBoundingClientRect();
        const outputRect = output.getBoundingClientRect();
        if (bodyRect.width < 1 || bodyRect.height < 1 || outputRect.width < 1 || outputRect.height < 1) return null;
        const position = readNativeGenerationOutputPosition() || defaultNativeGenerationOutputPosition(bodyRect, outputRect);
        const clamped = clampNativeGenerationOutputPosition(position, bodyRect, outputRect);
        output.style.left = `${Math.round(clamped.left)}px`;
        output.style.top = `${Math.round(clamped.top)}px`;
        output.style.right = 'auto';
        output.style.bottom = 'auto';
        output.style.transform = 'none';
        // A temporary clamp on a smaller window must not overwrite the user's preferred offset.
        return clamped;
    }

    function queueNativeGenerationOutputPosition() {
        const output = nativeEditorElements().generationOutput;
        if (!output || output.__nativeGenerationPositionFrame) return;
        const schedule = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : (callback) => window.setTimeout(callback, 0);
        output.__nativeGenerationPositionFrame = schedule(() => {
            output.__nativeGenerationPositionFrame = 0;
            syncNativeGenerationOutputPosition();
        });
    }

    function bindNativeGenerationOutputDrag() {
        const elements = nativeEditorElements();
        const output = elements.generationOutput;
        const body = elements.editorBody;
        const labeledHandle = elements.generationOutputDragHandle
            || (output && output.querySelector('.desktop-native-generation-output-header'));
        if (!output || !body || output.dataset.nativeGenerationDragBound === 'true') return;
        output.dataset.nativeGenerationDragBound = 'true';
        let dragState = null;

        const ignoreDragFrom = (target) => !!(target && target.closest && target.closest(
            'button, a, textarea, input, select, summary, [data-native-generation-result], [data-native-reasoning]'
        ));

        const applyDragPosition = (left, top) => {
            const bodyRect = body.getBoundingClientRect();
            const outputRect = output.getBoundingClientRect();
            const next = clampNativeGenerationOutputPosition({ left, top }, bodyRect, outputRect);
            output.style.left = `${Math.round(next.left)}px`;
            output.style.top = `${Math.round(next.top)}px`;
            output.style.right = 'auto';
            output.style.bottom = 'auto';
            output.style.transform = 'none';
            return next;
        };

        const currentOutputOffset = () => {
            const left = Number.parseFloat(output.style.left);
            const top = Number.parseFloat(output.style.top);
            if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
            const bodyRect = body.getBoundingClientRect();
            const outputRect = output.getBoundingClientRect();
            return {
                left: outputRect.left - bodyRect.left,
                top: outputRect.top - bodyRect.top
            };
        };

        const finishDrag = () => {
            if (!dragState) return;
            const moved = dragState.moved;
            const pointerId = dragState.pointerId;
            dragState = null;
            output.classList.remove('is-generation-output-dragging');
            if (labeledHandle) labeledHandle.setAttribute('aria-grabbed', 'false');
            if (output.releasePointerCapture && output.hasPointerCapture && output.hasPointerCapture(pointerId)) {
                try { output.releasePointerCapture(pointerId); } catch (error) { /* ignore */ }
            }
            const position = applyDragPosition(currentOutputOffset().left, currentOutputOffset().top);
            if (moved) writeNativeGenerationOutputPosition(position);
            else syncNativeGenerationOutputPosition();
        };

        const onPointerMove = (event) => {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            event.preventDefault();
            const position = applyDragPosition(
                dragState.position.left + event.clientX - dragState.clientX,
                dragState.position.top + event.clientY - dragState.clientY
            );
            if (position.left !== dragState.position.left || position.top !== dragState.position.top) dragState.moved = true;
        };

        const onPointerUp = (event) => {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            finishDrag();
        };

        output.addEventListener('pointerdown', (event) => {
            if (dragState || event.button !== 0 || output.hidden || ignoreDragFrom(event.target)) return;
            event.preventDefault();
            syncNativeGenerationOutputPosition();
            dragState = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                position: currentOutputOffset(),
                moved: false
            };
            output.classList.add('is-generation-output-dragging');
            if (labeledHandle) labeledHandle.setAttribute('aria-grabbed', 'true');
            if (output.setPointerCapture) {
                try { output.setPointerCapture(event.pointerId); } catch (error) { /* ignore synthetic pointer events */ }
            }
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });

        output.addEventListener('pointermove', onPointerMove);
        output.addEventListener('pointerup', onPointerUp);
        output.addEventListener('pointercancel', onPointerUp);
        output.addEventListener('dblclick', (event) => {
            if (ignoreDragFrom(event.target)) return;
            event.preventDefault();
            if (dragState) {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                finishDrag();
            }
            syncNativeGenerationOutputPosition({ reset: true });
        });
        window.addEventListener('resize', () => {
            if (!dragState) queueNativeGenerationOutputPosition();
        });
        if (typeof window.ResizeObserver === 'function') {
            const observer = new window.ResizeObserver(() => {
                if (!dragState) queueNativeGenerationOutputPosition();
            });
            observer.observe(body);
            observer.observe(output);
        }
    }

    window.bindNativeGenerationOutputDrag = bindNativeGenerationOutputDrag;
    window.queueNativeGenerationOutputPosition = queueNativeGenerationOutputPosition;
    window.syncNativeGenerationOutputPosition = syncNativeGenerationOutputPosition;
})();
