(() => {
    const state = {
        draft: null,
        file: null,
        confirmed: false,
        busy: false
    };

    function elements() {
        return {
            file: document.querySelector('[data-reader-file]'),
            dialog: document.querySelector('[data-reader-import-dialog]'),
            close: document.querySelector('[data-reader-import-close]'),
            cancel: document.querySelector('[data-reader-import-cancel]'),
            confirm: document.querySelector('[data-reader-import-confirm]'),
            status: document.querySelector('[data-reader-import-status]'),
            fileName: document.querySelector('[data-reader-import-file-name]'),
            summary: document.querySelector('[data-reader-import-summary]'),
            title: document.querySelector('[data-reader-import-title]'),
            encodingWrap: document.querySelector('[data-reader-import-encoding-wrap]'),
            encoding: document.querySelector('[data-reader-import-encoding]'),
            encodingHint: document.querySelector('[data-reader-import-encoding-hint]'),
            chapters: document.querySelector('[data-reader-import-chapters]')
        };
    }

    function setStatus(message, tone = '') {
        const target = elements().status;
        if (target) {
            target.textContent = message;
            target.dataset.tone = tone;
        }
    }

    function setBusy(value) {
        state.busy = value;
        const current = elements();
        [current.close, current.cancel, current.confirm, current.encoding, current.title].forEach((item) => {
            if (item) item.disabled = value;
        });
        if (current.confirm && !value) current.confirm.disabled = !state.draft || !!state.draft.encodingPreview?.requiresEncodingConfirmation;
    }

    function toBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
    }

    async function post(path, body) {
        if (typeof readerApi === 'function') return readerApi(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || '阅读器请求失败');
        return payload;
    }

    function renderDraft() {
        const current = elements();
        const draft = state.draft;
        if (!draft) return;
        if (current.fileName) current.fileName.textContent = draft.originalFileName || '粘贴文本';
        if (current.summary) current.summary.textContent = `${draft.chapters.length} 章 · ${Number(draft.characterCount || 0).toLocaleString()} 字`;
        if (current.title) current.title.value = draft.title || '';
        if (current.encodingWrap && current.encodingHint) {
            const needsEncoding = !!draft.encodingPreview?.requiresEncodingConfirmation;
            current.encodingWrap.hidden = !needsEncoding;
            current.encodingHint.hidden = !needsEncoding;
            if (needsEncoding && current.encoding) {
                current.encoding.replaceChildren();
                (draft.encodingPreview.supportedEncodings || ['utf-8', 'utf-16le', 'utf-16be', 'gb18030']).forEach((encoding) => {
                    const option = document.createElement('option');
                    option.value = encoding;
                    option.textContent = encoding.toUpperCase();
                    current.encoding.appendChild(option);
                });
            }
        }
        if (current.chapters) {
            current.chapters.replaceChildren();
            draft.chapters.forEach((chapter, index) => {
                const row = document.createElement('label');
                row.className = 'desktop-reader-import-chapter';
                const chapterIndex = document.createElement('span');
                chapterIndex.className = 'desktop-reader-import-chapter-index';
                chapterIndex.textContent = `第 ${index + 1} 章`;
                const title = document.createElement('input');
                title.type = 'text';
                title.value = chapter.title || `第 ${index + 1} 章`;
                title.setAttribute('aria-label', `第 ${index + 1} 章标题`);
                title.addEventListener('input', () => { chapter.title = title.value; });
                const count = document.createElement('span');
                count.className = 'desktop-reader-import-chapter-count';
                count.textContent = `${chapter.blocks.reduce((sum, block) => sum + String(block.text || '').length, 0).toLocaleString()} 字`;
                row.append(chapterIndex, title, count);
                current.chapters.appendChild(row);
            });
        }
        if (current.confirm && !state.busy) current.confirm.disabled = !!draft.encodingPreview?.requiresEncodingConfirmation;
    }

    function openDialog() {
        const dialog = elements().dialog;
        if (!dialog) return;
        if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
        else dialog.setAttribute('open', 'open');
    }

    async function discardDraft() {
        if (!state.draft) return;
        const draftId = state.draft.draftId;
        state.draft = null;
        try { await post('/api/reader/import/discard', { draftId }); } catch (error) { console.warn('Failed to discard reader import draft:', error); }
    }

    async function closeDialog(discard = true) {
        if (discard && !state.confirmed) await discardDraft();
        const dialog = elements().dialog;
        if (dialog?.open) dialog.close();
        state.file = null;
        state.confirmed = false;
        setBusy(false);
    }

    async function previewFile(file) {
        if (!file) return;
        state.file = file;
        state.confirmed = false;
        state.draft = null;
        openDialog();
        setBusy(true);
        setStatus('正在读取文件并分析章节…');
        try {
            const payload = await post('/api/reader/import/file-preview-bytes', {
                originalFileName: file.name,
                bytes: toBase64(await file.arrayBuffer())
            });
            state.draft = payload.draft;
            renderDraft();
            setStatus(state.draft.encodingPreview?.requiresEncodingConfirmation ? '请选择正确编码后继续。' : '预览完成，可校正书名或章节标题。');
        } catch (error) {
            setStatus(error.message || String(error), 'error');
            state.draft = null;
        } finally {
            setBusy(false);
            const current = elements();
            if (current.confirm) current.confirm.disabled = !state.draft || !!state.draft.encodingPreview?.requiresEncodingConfirmation;
        }
    }

    async function retryWithEncoding(encoding) {
        if (!state.draft || !encoding || state.busy) return;
        setBusy(true);
        setStatus('正在按所选编码重新解析…');
        try {
            const payload = await post('/api/reader/import/retry', { draftId: state.draft.draftId, encoding });
            state.draft = payload.draft;
            renderDraft();
            setStatus(state.draft.encodingPreview?.requiresEncodingConfirmation ? '仍需确认编码。' : '编码已确认，可继续导入。');
        } catch (error) {
            setStatus(error.message || String(error), 'error');
        } finally {
            setBusy(false);
            renderDraft();
        }
    }

    async function confirmImport() {
        if (!state.draft || state.busy || state.draft.encodingPreview?.requiresEncodingConfirmation) return;
        const current = elements();
        setBusy(true);
        setStatus('正在写入本地书库…');
        try {
            const corrections = {
                title: current.title?.value || state.draft.title,
                chapters: state.draft.chapters,
                encodingConfirmed: true
            };
            const corrected = await post('/api/reader/import/correct', { draftId: state.draft.draftId, corrections });
            state.draft = corrected.draft;
            const committed = await post('/api/reader/import/confirm', {
                draftId: state.draft.draftId,
                title: state.draft.title,
                encodingConfirmed: true,
                expectedIndexVersion: Number((typeof readerState !== 'undefined' && readerState.libraryIndexVersion) || 0)
            });
            state.confirmed = true;
            setStatus('已加入书库，正在打开…');
            if (typeof loadReaderLibrary === 'function') await loadReaderLibrary();
            if (typeof openReaderLibraryDocument === 'function') await openReaderLibraryDocument(committed.documentId);
            const dialog = elements().dialog;
            if (dialog?.open) dialog.close();
            state.draft = null;
        } catch (error) {
            setStatus(error.message || String(error), 'error');
        } finally {
            setBusy(false);
            if (current.file) current.file.value = '';
        }
    }

    function initializeReaderImportWizard() {
        const current = elements();
        if (!current.file || !current.dialog || current.file.dataset.readerImportBound === 'true') return;
        current.file.dataset.readerImportBound = 'true';
        current.file.addEventListener('change', () => previewFile(current.file.files?.[0]));
        current.encoding?.addEventListener('change', () => retryWithEncoding(current.encoding.value));
        current.confirm?.addEventListener('click', confirmImport);
        current.cancel?.addEventListener('click', () => closeDialog(true));
        current.close?.addEventListener('click', () => closeDialog(true));
        current.dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(true); });
    }

    window.initializeReaderImportWizard = initializeReaderImportWizard;
})();
