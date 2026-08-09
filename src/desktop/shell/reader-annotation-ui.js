/* global createReaderBookmarkAtCurrentPosition readerRevisionSnapshot */

function readerAnnotationElements() {
    const dialog = document.querySelector('[data-reader-annotation-dialog]');
    return {
        status: document.querySelector('[data-reader-annotation-status]'),
        annotations: document.querySelector('[data-reader-annotations]'),
        historyStatus: document.querySelector('[data-reader-history-status]'),
        history: document.querySelector('[data-reader-history]'),
        historyBack: document.querySelector('[data-reader-history-back]'),
        historyForward: document.querySelector('[data-reader-history-forward]'),
        dialog,
        type: dialog && dialog.querySelector('[data-reader-annotation-type]'),
        color: dialog && dialog.querySelector('[data-reader-annotation-color]'),
        note: dialog && dialog.querySelector('[data-reader-annotation-note]'),
        excerpt: dialog && dialog.querySelector('[data-reader-annotation-excerpt]'),
        dialogStatus: dialog && dialog.querySelector('[data-reader-annotation-dialog-status]'),
        save: dialog && dialog.querySelector('[data-reader-annotation-save]'),
        cancel: dialog && dialog.querySelector('[data-reader-annotation-cancel]'),
        close: dialog && dialog.querySelector('[data-reader-annotation-close]'),
        highlight: document.querySelector('[data-reader-selection-highlight]'),
        underline: document.querySelector('[data-reader-selection-underline]'),
        noteAction: document.querySelector('[data-reader-selection-note]'),
        bookmarkAction: document.querySelector('[data-reader-selection-bookmark]')
    };
}

function readerAnnotationStatus(message) {
    const elements = readerAnnotationElements();
    if (elements.status) elements.status.textContent = message;
}

function readerAnnotationHistoryStatus(message) {
    const elements = readerAnnotationElements();
    if (elements.historyStatus) elements.historyStatus.textContent = message;
}

function readerAnnotationId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `annotation-${window.crypto.randomUUID()}`;
    return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readerHistoryKey(locator) {
    if (!locator) return '';
    return [locator.documentId, locator.revisionId, locator.chapterId, locator.blockId, locator.offset].join(':');
}

function readerAnnotationExcerptFromRange(range) {
    const blocks = readerState.currentChapter && readerState.currentChapter.blocks || [];
    const start = range && range.start;
    const end = range && range.end;
    const startIndex = blocks.findIndex((block) => block.blockId === (start && start.blockId));
    const endIndex = blocks.findIndex((block) => block.blockId === (end && end.blockId));
    if (startIndex < 0 || endIndex < startIndex) return '';
    const excerpt = blocks.slice(startIndex, endIndex + 1).map((block, index) => {
        const text = String(block.text || '');
        const from = index === 0 ? Math.max(0, Number(start.offset) || 0) : 0;
        const to = index === endIndex - startIndex ? Math.min(text.length, Number(end.offset) || 0) : text.length;
        return text.slice(from, to);
    }).join('\n').trim();
    return excerpt.slice(0, 1000);
}

function readerAnnotationSelection() {
    const selection = readerState.transferSelection;
    if (!selection || !selection.start || !selection.end) return null;
    const nativeSelection = window.getSelection && window.getSelection();
    const excerpt = String(nativeSelection || '').replace(/\r\n?/g, '\n').trim()
        || readerAnnotationExcerptFromRange(selection);
    return {
        range: { start: structuredClone(selection.start), end: structuredClone(selection.end) },
        excerpt
    };
}

function readerAnnotationRangeResolution(annotation) {
    const range = annotation && annotation.range;
    const start = range && range.start;
    const end = range && range.end;
    if (!start || !end) return { resolution: 'unresolved', range: range || null };
    if (annotation.revisionId === readerState.activeRevisionId) return { resolution: 'exact', range };
    return { resolution: 'pending', range };
}

async function refreshReaderAnnotationResolutions() {
    readerState.annotationResolutions.clear();
    const annotations = Array.isArray(readerState.annotations) ? readerState.annotations : [];
    annotations.forEach((annotation) => readerState.annotationResolutions.set(annotation.annotationId, readerAnnotationRangeResolution(annotation)));
    const stale = annotations.filter((annotation) => annotation.revisionId !== readerState.activeRevisionId);
    if (!stale.length || typeof readerRevisionSnapshot !== 'function') {
        renderReaderAnnotations();
        renderReaderAnnotationMarks();
        return;
    }
    try {
        const revision = await readerRevisionSnapshot();
        stale.forEach((annotation) => {
            const start = window.DraftHarborReaderLocator.resolveReaderLocator(annotation.range.start, revision);
            const end = window.DraftHarborReaderLocator.resolveReaderLocator(annotation.range.end, revision);
            const resolution = start.resolution === 'unresolved' || end.resolution === 'unresolved' ? 'unresolved'
                : start.resolution === 'approximate' || end.resolution === 'approximate' ? 'approximate' : 'exact';
            readerState.annotationResolutions.set(annotation.annotationId, {
                resolution,
                range: { start: start.locator, end: end.locator }
            });
        });
    } catch (error) {
        readerAnnotationStatus(`批注精确度检查失败：${error.message || error}`);
    }
    renderReaderAnnotations();
    renderReaderAnnotationMarks();
}

async function loadReaderAnnotationDocument() {
    if (!readerState.activeDocumentId) return;
    try {
        const payload = await readerApi(`/api/reader/annotations?documentId=${encodeURIComponent(readerState.activeDocumentId)}`);
        const record = payload.record;
        readerState.annotations = record && Array.isArray(record.annotations) ? record.annotations : [];
        readerState.annotationRecordUpdatedAt = record && record.updatedAt || '';
        await refreshReaderAnnotationResolutions();
        readerAnnotationStatus(readerState.annotations.length ? `已加载 ${readerState.annotations.length} 条批注。` : '选中文本后可创建高亮、下划线或批注。');
    } catch (error) {
        readerState.annotations = [];
        readerState.annotationRecordUpdatedAt = '';
        readerAnnotationStatus(`批注加载失败：${error.message || error}`);
    }
}

function annotationPrecisionLabel(value) {
    return { exact: '精确', approximate: '近似', unresolved: '需确认', pending: '检查中' }[value] || '检查中';
}

function renderReaderAnnotations() {
    const container = readerAnnotationElements().annotations;
    if (!container) return;
    container.replaceChildren();
    const annotations = Array.isArray(readerState.annotations) ? readerState.annotations : [];
    if (!annotations.length) {
        const empty = document.createElement('p');
        empty.className = 'desktop-reader-hint';
        empty.textContent = '还没有批注。';
        container.appendChild(empty);
        return;
    }
    annotations.forEach((annotation) => {
        const resolution = readerState.annotationResolutions.get(annotation.annotationId) || readerAnnotationRangeResolution(annotation);
        const card = document.createElement('article');
        card.className = 'desktop-reader-annotation';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'desktop-reader-annotation-open';
        const title = document.createElement('strong');
        title.textContent = `${annotation.type === 'highlight' ? '高亮' : annotation.type === 'underline' ? '下划线' : '批注'} · ${annotation.excerpt || '已标记文本'}`;
        const note = document.createElement('span');
        note.textContent = annotation.note || '无附注';
        const meta = document.createElement('small');
        meta.className = 'desktop-reader-annotation-meta';
        meta.textContent = `${annotation.color} · 恢复：${annotationPrecisionLabel(resolution.resolution)}`;
        open.append(title, note, meta);
        open.addEventListener('click', async () => {
            const target = resolution.range && resolution.range.start || annotation.range.start;
            await navigateReaderToLocator(target, { highlight: true, historySource: 'annotation', historyLabel: title.textContent });
            setReaderDrawer('');
        });
        const actions = document.createElement('div');
        actions.className = 'desktop-reader-annotation-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'desktop-secondary-action';
        edit.textContent = '编辑';
        edit.addEventListener('click', () => openReaderAnnotationDialog(annotation.type, annotation));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'desktop-reader-tool';
        remove.textContent = '删除';
        remove.addEventListener('click', () => deleteReaderAnnotation(annotation.annotationId));
        actions.append(edit, remove);
        card.append(open, actions);
        container.appendChild(card);
    });
}

function renderReaderAnnotationMarks() {
    const content = document.querySelector('[data-reader-content]');
    if (!content) return;
    const annotations = (readerState.annotations || []).map((annotation) => ({
        annotation,
        resolution: readerState.annotationResolutions.get(annotation.annotationId) || readerAnnotationRangeResolution(annotation)
    }));
    content.querySelectorAll('[data-reader-block]').forEach((node) => {
        const text = node.textContent || '';
        node.replaceChildren(document.createTextNode(text));
        const blockId = node.dataset.readerBlock;
        const base = Number(node.dataset.readerStartOffset) || 0;
        const end = Number(node.dataset.readerEndOffset) || base + text.length;
        const blockOrder = (readerState.currentChapter && readerState.currentChapter.blocks || []).findIndex((block) => block.blockId === blockId);
        const intervals = annotations.map(({ annotation, resolution }) => {
            const range = resolution.range || annotation.range;
            const start = range && range.start;
            const finish = range && range.end;
            if (!start || !finish || start.chapterId !== readerState.activeChapterId || finish.chapterId !== readerState.activeChapterId) return null;
            const startOrder = (readerState.currentChapter && readerState.currentChapter.blocks || []).findIndex((block) => block.blockId === start.blockId);
            const finishOrder = (readerState.currentChapter && readerState.currentChapter.blocks || []).findIndex((block) => block.blockId === finish.blockId);
            if (blockOrder < 0 || startOrder < 0 || finishOrder < 0 || blockOrder < startOrder || blockOrder > finishOrder) return null;
            const starts = blockOrder === startOrder ? Number(start.offset) : base;
            const finishes = blockOrder === finishOrder ? Number(finish.offset) : end;
            const localStart = Math.max(base, starts);
            const localEnd = Math.min(end, finishes);
            if (localEnd <= localStart) return null;
            return { start: localStart - base, end: localEnd - base, annotation };
        }).filter(Boolean).sort((left, right) => left.start - right.start || right.end - left.end);
        if (!intervals.length) return;
        const boundaries = [...new Set([0, text.length, ...intervals.flatMap((item) => [item.start, item.end])])].sort((left, right) => left - right);
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < boundaries.length - 1; index += 1) {
            const start = boundaries[index];
            const finish = boundaries[index + 1];
            if (finish <= start) continue;
            const mark = intervals.find((item) => item.start <= start && item.end >= finish);
            if (!mark) fragment.appendChild(document.createTextNode(text.slice(start, finish)));
            else {
                const element = document.createElement('mark');
                element.className = 'desktop-reader-annotation-mark';
                element.dataset.readerAnnotationId = mark.annotation.annotationId;
                element.dataset.readerAnnotationType = mark.annotation.type;
                element.dataset.readerAnnotationColor = mark.annotation.color;
                element.textContent = text.slice(start, finish);
                fragment.appendChild(element);
            }
        }
        node.replaceChildren(fragment);
    });
}

async function upsertReaderAnnotation(annotationInput) {
    if (readerState.focusMode) return null;
    const response = await readerApi('/api/reader/annotations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotation: annotationInput, expectedUpdatedAt: readerState.annotationRecordUpdatedAt || undefined })
    });
    const record = response.record;
    readerState.annotations = record.annotations || [];
    readerState.annotationRecordUpdatedAt = record.updatedAt || '';
    await refreshReaderAnnotationResolutions();
    return annotationInput;
}

function closeReaderAnnotationDialog() {
    const dialog = readerAnnotationElements().dialog;
    if (dialog && dialog.open) dialog.close();
}

function openReaderAnnotationDialog(type = 'note', existing = null) {
    if (readerState.focusMode) return;
    const elements = readerAnnotationElements();
    const selection = existing ? { range: structuredClone(existing.range), excerpt: existing.excerpt || '' } : readerAnnotationSelection();
    if (!selection) {
        readerAnnotationStatus('请先选择正文范围。');
        return;
    }
    readerState.annotationSelection = selection;
    elements.type.value = existing ? existing.type : type;
    elements.color.value = existing ? existing.color : 'yellow';
    elements.note.value = existing ? existing.note : '';
    elements.excerpt.textContent = selection.excerpt ? `选中：${selection.excerpt.slice(0, 180)}` : '已选择正文范围。';
    elements.dialogStatus.textContent = '';
    elements.dialog.dataset.readerEditingId = existing ? existing.annotationId : '';
    if (!elements.dialog.open) elements.dialog.showModal();
    elements.note.focus();
}

async function saveReaderAnnotationFromDialog() {
    if (readerState.focusMode) return;
    const elements = readerAnnotationElements();
    const selection = readerState.annotationSelection;
    if (!selection) return;
    const editingId = elements.dialog.dataset.readerEditingId;
    const existing = (readerState.annotations || []).find((annotation) => annotation.annotationId === editingId);
    const now = new Date().toISOString();
    const annotation = {
        ...(existing || {}),
        annotationId: editingId || readerAnnotationId(),
        documentId: readerState.activeDocumentId,
        revisionId: existing && existing.revisionId || readerState.activeRevisionId,
        type: elements.type.value,
        color: elements.color.value,
        range: selection.range,
        excerpt: selection.excerpt,
        note: elements.note.value,
        createdAt: existing && existing.createdAt || now,
        updatedAt: now
    };
    elements.save.disabled = true;
    elements.dialogStatus.textContent = '正在保存…';
    try {
        await upsertReaderAnnotation(annotation);
        elements.dialogStatus.textContent = '已保存。';
        readerAnnotationStatus('批注已保存。');
        closeReaderAnnotationDialog();
        readerState.annotationSelection = null;
        clearReaderTransferSelection();
    } catch (error) {
        elements.dialogStatus.textContent = `保存失败：${error.message || error}。当前选区仍保留，可重试。`;
    } finally {
        elements.save.disabled = false;
    }
}

async function createReaderAnnotationFromSelection(type) {
    if (readerState.focusMode) return;
    const selection = readerAnnotationSelection();
    if (!selection) {
        readerAnnotationStatus('请先选择正文范围。');
        return;
    }
    if (type === 'note') {
        openReaderAnnotationDialog(type);
        return;
    }
    readerState.annotationSelection = selection;
    const now = new Date().toISOString();
    try {
        await upsertReaderAnnotation({
            annotationId: readerAnnotationId(), documentId: readerState.activeDocumentId, revisionId: readerState.activeRevisionId,
            type, color: 'yellow', range: selection.range, excerpt: selection.excerpt, note: '', createdAt: now, updatedAt: now
        });
        readerAnnotationStatus(`${type === 'highlight' ? '高亮' : '下划线'}已保存。`);
        clearReaderTransferSelection();
        readerState.annotationSelection = null;
    } catch (error) {
        readerAnnotationStatus(`保存失败：${error.message || error}。当前选区仍保留，可重试。`);
    }
}

async function deleteReaderAnnotation(annotationId) {
    if (readerState.focusMode) return;
    const annotation = (readerState.annotations || []).find((item) => item.annotationId === annotationId);
    if (!annotation) return;
    try {
        const response = await readerApi('/api/reader/annotations/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId: readerState.activeDocumentId, annotationId, expectedUpdatedAt: readerState.annotationRecordUpdatedAt || undefined })
        });
        readerState.annotations = response.record && response.record.annotations || [];
        readerState.annotationRecordUpdatedAt = response.record && response.record.updatedAt || '';
        await refreshReaderAnnotationResolutions();
        readerAnnotationStatus('批注已删除。');
    } catch (error) {
        readerAnnotationStatus(`删除失败：${error.message || error}`);
    }
}

async function loadReaderPositionHistory() {
    if (!readerState.activeDocumentId) return;
    try {
        const payload = await readerApi(`/api/reader/history?documentId=${encodeURIComponent(readerState.activeDocumentId)}`);
        const record = payload.record;
        readerState.historyItems = record && record.history && Array.isArray(record.history.items) ? record.history.items : [];
        readerState.historyCursor = readerState.historyItems.length - 1;
        readerState.historyRecordUpdatedAt = record && record.updatedAt || '';
        renderReaderHistory();
    } catch (error) {
        readerState.historyItems = [];
        readerState.historyCursor = -1;
        readerAnnotationHistoryStatus(`历史加载失败：${error.message || error}`);
    }
}

async function recordReaderPositionHistory(locator, options = {}) {
    if (!readerState.activeDocumentId || !locator || readerState.historyNavigating) return;
    const last = readerState.historyItems[readerState.historyCursor] || readerState.historyItems[readerState.historyItems.length - 1];
    if (last && readerHistoryKey(last.locator) === readerHistoryKey(locator)) return;
    const entry = {
        documentId: readerState.activeDocumentId,
        revisionId: readerState.activeRevisionId,
        locator,
        source: options.source || 'navigation',
        label: options.label || '',
        visitedAt: new Date().toISOString()
    };
    try {
        const response = await readerApi('/api/reader/history', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entry, expectedUpdatedAt: readerState.historyRecordUpdatedAt || undefined })
        });
        const record = response.record;
        readerState.historyRecordUpdatedAt = record.updatedAt || '';
        readerState.historyItems = (record.history.items || []).filter((item) => item.documentId === readerState.activeDocumentId);
        readerState.historyCursor = readerState.historyItems.length - 1;
        renderReaderHistory();
    } catch (error) {
        readerAnnotationHistoryStatus(`历史保存失败：${error.message || error}`);
    }
}

async function navigateReaderHistory(index) {
    const entry = readerState.historyItems[index];
    if (!entry || !entry.locator) return;
    readerState.historyNavigating = true;
    try {
        await navigateReaderToLocator(entry.locator, { highlight: true, skipHistory: true });
        readerState.historyCursor = index;
        renderReaderHistory();
    } finally {
        readerState.historyNavigating = false;
    }
}

function renderReaderHistory() {
    const elements = readerAnnotationElements();
    if (!elements.history) return;
    elements.history.replaceChildren();
    const items = readerState.historyItems || [];
    if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'desktop-reader-hint';
        empty.textContent = '还没有导航历史。';
        elements.history.appendChild(empty);
    }
    [...items].reverse().forEach((entry, reverseIndex) => {
        const index = items.length - 1 - reverseIndex;
        const item = document.createElement('article');
        item.className = 'desktop-reader-history-item';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'desktop-reader-history-open';
        const title = document.createElement('strong');
        title.textContent = entry.label || `${entry.locator && entry.locator.chapterId || '阅读位置'} · ${entry.source || '导航'}`;
        const meta = document.createElement('span');
        meta.textContent = new Date(entry.visitedAt).toLocaleString();
        open.append(title, meta);
        open.addEventListener('click', () => navigateReaderHistory(index));
        item.appendChild(open);
        elements.history.appendChild(item);
    });
    if (elements.historyBack) {
        elements.historyBack.disabled = readerState.historyCursor <= 0;
        elements.historyBack.onclick = () => navigateReaderHistory(readerState.historyCursor - 1);
    }
    if (elements.historyForward) {
        elements.historyForward.disabled = readerState.historyCursor < 0 || readerState.historyCursor >= items.length - 1;
        elements.historyForward.onclick = () => navigateReaderHistory(readerState.historyCursor + 1);
    }
}

function renderReaderAnnotationUi() {
    renderReaderAnnotations();
    renderReaderHistory();
    renderReaderAnnotationMarks();
}

function initializeReaderAnnotationUi() {
    const elements = readerAnnotationElements();
    elements.highlight?.addEventListener('click', () => createReaderAnnotationFromSelection('highlight'));
    elements.underline?.addEventListener('click', () => createReaderAnnotationFromSelection('underline'));
    elements.noteAction?.addEventListener('click', () => openReaderAnnotationDialog('note'));
    elements.bookmarkAction?.addEventListener('click', () => createReaderBookmarkAtCurrentPosition());
    elements.close?.addEventListener('click', closeReaderAnnotationDialog);
    elements.cancel?.addEventListener('click', closeReaderAnnotationDialog);
    elements.save?.addEventListener('click', saveReaderAnnotationFromDialog);
    elements.dialog?.addEventListener('cancel', (event) => { event.preventDefault(); closeReaderAnnotationDialog(); });
    renderReaderAnnotationUi();
}

window.initializeReaderAnnotationUi = initializeReaderAnnotationUi;
window.loadReaderAnnotationDocument = loadReaderAnnotationDocument;
window.loadReaderPositionHistory = loadReaderPositionHistory;
window.renderReaderAnnotationUi = renderReaderAnnotationUi;
window.renderReaderAnnotationMarks = renderReaderAnnotationMarks;
window.recordReaderPositionHistory = recordReaderPositionHistory;
