(function () {
    'use strict';

    let ui = null;
    let composing = false;
    let previousTarget = null;
    let suppressedSelection = null;
    let invalidatedSelection = null;
    let frame = 0;

    function currentSelectionStamp(editor) {
        const scene = currentNativeScene();
        return { projectId: currentProjectId(), sceneId: scene && scene.id, value: editor.value,
            start: editor.selectionStart, end: editor.selectionEnd };
    }

    function capturedSelectionTarget() {
        const generation = nativeEditorState.generation || {};
        return generation.task === 'rewrite' || generation.task === 'regenerate-selection'
            ? generation.selectionTarget : null;
    }

    function resolveRange() {
        const editor = nativeEditorElements().editor;
        const scene = currentNativeScene();
        const generation = nativeEditorState.generation || {};
        const captured = capturedSelectionTarget();
        // Choose the source before validating it. A stale candidate must never
        // silently point at the writer's newer, unrelated live selection.
        if (!captured && (generation.inProgress || generation.text || generation.pendingSceneId)) return { reason: 'other-generation' };
        const rewrite = nativeEditorState.rewrite || {};
        const target = captured || { projectId: rewrite.selectionProjectId, sceneId: rewrite.selectionSceneId,
            baseText: rewrite.selectionBaseText, start: rewrite.selectionStart, end: rewrite.selectionEnd,
            selectedText: rewrite.originalText };
        if (!editor || !scene || target.sceneId !== scene.id || target.projectId !== currentProjectId()) return { reason: 'foreign-target' };
        if (!captured && suppressedSelection) return { reason: 'released' };
        if (!Number.isInteger(target.start) || !Number.isInteger(target.end) || target.start < 0
            || target.end <= target.start || typeof target.baseText !== 'string' || target.end > target.baseText.length) return { reason: 'no-range' };
        const result = { target, captured: !!captured, text: target.selectedText || '', reason: '' };
        if (composing || (!captured && rewrite.selectionInvalidated) || target.baseText !== editor.value
            || target.baseText.slice(target.start, target.end) !== target.selectedText) {
            result.reason = 'stale';
            return result;
        }
        result.range = { start: target.start, end: target.end, text: target.selectedText };
        return result;
    }

    function makeNode(tag, name, className) {
        const element = document.createElement(tag);
        element.setAttribute(`data-native-revision-${name}`, '');
        element.className = className || `desktop-native-revision-${name}`;
        return element;
    }

    function setText(element, value) {
        if (element.textContent !== value) element.textContent = value;
    }

    function syncScroll() {
        if (!ui || ui.layer.hidden) return;
        ui.content.style.transform = `translate(${-ui.editor.scrollLeft}px, ${-ui.editor.scrollTop}px)`;
    }

    function syncGeometry() {
        if (!ui) return false;
        const { editor, body, layer, content } = ui;
        const editorRect = editor.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        if (editorRect.width < 1 || editorRect.height < 1) return false;
        const computed = window.getComputedStyle(editor);
        const left = editorRect.left - bodyRect.left + (body.scrollLeft || 0) - (body.clientLeft || 0) + editor.clientLeft;
        const top = editorRect.top - bodyRect.top + (body.scrollTop || 0) - (body.clientTop || 0) + editor.clientTop;
        Object.assign(layer.style, { left: `${left}px`, top: `${top}px`, width: `${editor.clientWidth}px`, height: `${editor.clientHeight}px` });
        // A textarea's clientWidth includes its padding, but excludes borders
        // and its vertical scrollbar. Reproduce that exact line-wrapping box.
        Object.assign(content.style, { width: `${editor.clientWidth}px`, minHeight: `${Math.max(editor.clientHeight, editor.scrollHeight)}px`, boxSizing: 'border-box' });
        ['font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'fontKerning',
            'fontFeatureSettings', 'fontVariationSettings', 'lineHeight', 'letterSpacing', 'wordSpacing',
            'textAlign', 'textIndent', 'textTransform', 'textRendering', 'direction', 'writingMode',
            'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize', 'lineBreak', 'padding',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach(property => {
            if (computed[property] !== undefined) content.style[property] = computed[property];
        });
        return true;
    }

    function queueSync() {
        if (frame) return;
        const schedule = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
        frame = schedule(() => { frame = 0; sync(); });
    }

    function locate() {
        const result = resolveRange();
        if (!ui || !result.range || composing) return;
        const { editor, mark, content } = ui;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(result.range.start, result.range.end);
        sync();
        const markRect = mark.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const selectedTop = markRect.top - contentRect.top;
        editor.scrollTop = Math.max(0, selectedTop - editor.clientHeight * 0.3);
        syncScroll();
    }

    function reselect() {
        const generation = nativeEditorState.generation || {};
        if (!ui || composing || generation.inProgress || generation.text || generation.pendingSceneId) return;
        // Empty failed attempts can be released through the existing discard
        // path. Never discard a complete result or stop a stream implicitly.
        if (capturedSelectionTarget()) discardNativeGeneration();
        const rewrite = nativeEditorState.rewrite;
        rewrite.selectionStart = 0;
        rewrite.selectionEnd = 0;
        rewrite.originalText = '';
        rewrite.selectionBaseText = '';
        rewrite.selectionInvalidated = false;
        invalidatedSelection = null;
        ui.editor.focus({ preventScroll: true });
        const cursor = ui.editor.selectionStart || 0;
        ui.editor.setSelectionRange(cursor, cursor);
        suppressedSelection = currentSelectionStamp(ui.editor);
        sync();
        setNativeSaveStatus('请在正文中重新选择要修改的段落。', 'info');
    }

    function buildContext(host) {
        if (!ui || !host || ui.context) return;
        const context = makeNode('section', 'context');
        context.setAttribute('aria-label', '改稿原文范围');
        const heading = makeNode('div', 'heading');
        const status = makeNode('span', 'status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const actions = makeNode('div', 'actions');
        const locateButton = makeNode('button', 'locate');
        locateButton.type = 'button';
        locateButton.textContent = '定位原文';
        locateButton.addEventListener('click', locate);
        const reselectButton = makeNode('button', 'reselect');
        reselectButton.type = 'button';
        reselectButton.textContent = '重新选段';
        reselectButton.addEventListener('click', reselect);
        const excerpt = makeNode('blockquote', 'excerpt');
        actions.append(locateButton, reselectButton);
        heading.append(status, actions);
        context.append(heading, excerpt);
        host.append(context);
        Object.assign(ui, { context, status, excerpt, locateButton, reselectButton });
    }

    function sync() {
        if (!ui) return null;
        buildContext(document.querySelector('[data-native-desk-range-host]'));
        const captured = capturedSelectionTarget();
        if (previousTarget && !captured) suppressedSelection = currentSelectionStamp(ui.editor);
        previousTarget = captured;
        const result = resolveRange();
        const range = result.range;
        ui.layer.hidden = !range;
        if (range) {
            setText(ui.before, ui.editor.value.slice(0, range.start));
            setText(ui.mark, range.text);
            // Keep the terminal empty line measurable without changing offsets.
            setText(ui.after, ui.editor.value.slice(range.end) + '\u200b');
            ui.layer.hidden = !syncGeometry();
            syncScroll();
        }
        if (ui.context) {
            ui.context.hidden = !result.target;
            if (result.target) {
                const generation = nativeEditorState.generation || {};
                setText(ui.excerpt, result.text);
                setText(ui.status, range
                    ? `${result.captured ? '本次改稿原文' : '已选原文'} · ${range.end - range.start} 字符`
                    : '原文已变化，请重新选段');
                ui.locateButton.disabled = !range;
                ui.reselectButton.disabled = !!(composing || generation.inProgress || generation.text || generation.pendingSceneId);
                ui.reselectButton.title = ui.reselectButton.disabled ? '请先保留或撤回当前结果，再重新选段' : '';
            }
        }
        return result;
    }

    function onSelection(event) {
        if (!ui || composing) return;
        const generation = nativeEditorState.generation || {};
        if (generation.inProgress || generation.text || generation.pendingSceneId) { sync(); return; }
        const stamp = currentSelectionStamp(ui.editor);
        const blocked = suppressedSelection || invalidatedSelection;
        if (stamp.end > stamp.start && (!blocked || event.type === 'mouseup'
            || (event.type === 'keyup' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')
            || stamp.start !== blocked.start || stamp.end !== blocked.end
            || stamp.sceneId !== blocked.sceneId || stamp.projectId !== blocked.projectId)) {
            const failedTarget = capturedSelectionTarget();
            if (failedTarget && (failedTarget.start !== stamp.start || failedTarget.end !== stamp.end
                || failedTarget.baseText !== stamp.value || failedTarget.sceneId !== stamp.sceneId
                || failedTarget.projectId !== stamp.projectId)) {
                // There is no candidate or active request (guarded above).
                // Release an empty failed attempt through the existing path
                // so this new selection and the next request share one target.
                discardNativeGeneration();
            }
            suppressedSelection = null;
            invalidatedSelection = null;
            nativeEditorState.rewrite.selectionInvalidated = false;
            rememberNativeRewriteSelection();
            // Native selection listeners may have rendered disabled buttons
            // before this listener captures the new, valid snapshot.
            renderNativeRewrite();
        }
        sync();
    }

    function bind() {
        const elements = nativeEditorElements();
        if (!elements.editor || !elements.editorBody) return;
        if (ui) { sync(); return; }
        const layer = makeNode('div', 'layer');
        layer.hidden = true;
        layer.setAttribute('aria-hidden', 'true');
        Object.assign(layer.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', zIndex: '2', padding: '0' });
        const content = makeNode('div', 'content');
        Object.assign(content.style, { color: 'transparent', pointerEvents: 'none', margin: '0', border: '0' });
        const before = makeNode('span', 'before');
        const mark = makeNode('mark', 'mark');
        Object.assign(mark.style, { color: 'inherit', padding: '0', border: '0', font: 'inherit', lineHeight: 'inherit' });
        const after = makeNode('span', 'after');
        content.append(before, mark, after);
        layer.append(content);
        elements.editorBody.append(layer);
        ui = { editor: elements.editor, body: elements.editorBody, layer, content, before, mark, after };
        ui.editor.addEventListener('scroll', syncScroll, { passive: true });
        ['select', 'mouseup', 'keyup'].forEach(name => ui.editor.addEventListener(name, onSelection));
        ui.editor.addEventListener('input', () => {
            nativeEditorState.rewrite.selectionInvalidated = true;
            invalidatedSelection = currentSelectionStamp(ui.editor);
            suppressedSelection = null;
            sync();
        });
        ui.editor.addEventListener('compositionstart', () => { composing = true; sync(); });
        ui.editor.addEventListener('compositionend', () => { composing = false; sync(); });
        window.addEventListener('resize', queueSync);
        if (typeof window.ResizeObserver === 'function') {
            ui.observer = new window.ResizeObserver(queueSync);
            ui.observer.observe(ui.editor);
            ui.observer.observe(ui.body);
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueSync);
        sync();
    }

    const originalRenderRewrite = renderNativeRewrite;
    renderNativeRewrite = function () {
        const result = originalRenderRewrite.apply(this, arguments);
        sync();
        return result;
    };
    const originalRenderGeneration = renderNativeGeneration;
    renderNativeGeneration = function () {
        const result = originalRenderGeneration.apply(this, arguments);
        sync();
        return result;
    };
    window.bindNativeWriterRevisionRange = bind;
    window.syncNativeWriterRevisionRange = sync;
}());
