    function readerSelectionElements() {
        return {
            content: document.querySelector('[data-reader-content]'),
            toggle: document.querySelector('[data-reader-selection-toggle]'),
            toolbar: document.querySelector('[data-reader-selection-toolbar]'),
            toolbarLabel: document.querySelector('[data-reader-selection-toolbar-label]'),
            confirm: document.querySelector('[data-reader-selection-confirm]'),
            copy: document.querySelector('[data-reader-selection-copy]'),
            dialog: document.querySelector('[data-reader-transfer-dialog]'),
            close: document.querySelector('[data-reader-transfer-close]'),
            scope: document.querySelector('[data-reader-transfer-scope]'),
            chapters: document.querySelector('[data-reader-transfer-chapters]'),
            chapterList: document.querySelector('[data-reader-transfer-chapter-list]'),
            source: document.querySelector('[data-reader-transfer-source]'),
            counts: document.querySelector('[data-reader-transfer-counts]'),
            risk: document.querySelector('[data-reader-transfer-risk]'),
            status: document.querySelector('[data-reader-transfer-status]'),
            destinations: Array.from(document.querySelectorAll('[data-reader-transfer-destination]'))
        };
    }

    function readerSelectionBoundaryLocator(node, offset, affinity) {
        const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
        const blockNode = element && element.closest('[data-reader-block]');
        if (!blockNode || !readerState.currentChapter || !blockNode.closest('[data-reader-content]')) return null;
        const prefix = document.createRange();
        prefix.selectNodeContents(blockNode);
        try { prefix.setEnd(node, offset); } catch (_) { return null; }
        const localOffset = prefix.toString().length;
        const baseOffset = Math.max(0, Number(blockNode.dataset.readerStartOffset) || 0);
        const block = readerState.currentChapter.blocks.find((item) => item.blockId === blockNode.dataset.readerBlock);
        if (!block) return null;
        const absolute = Math.min(Number(blockNode.dataset.readerEndOffset) || block.text.length, baseOffset + localOffset);
        const snapped = window.DraftHarborReaderLocator.snapUtf16Offset(block.text, absolute, affinity);
        const locator = createReaderLocatorAt(block.blockId, snapped);
        return locator ? window.DraftHarborReaderLocator.createReaderLocator({ ...locator, affinity }) : null;
    }

    function readerDomSelectionRange() {
        if (!readerState.apiMode || !readerState.currentChapter || !window.DraftHarborReaderLocator) return null;
        const selection = window.getSelection();
        const content = document.querySelector('[data-reader-content]');
        if (!selection || selection.rangeCount !== 1 || selection.isCollapsed || !content) return null;
        const range = selection.getRangeAt(0);
        if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;
        const start = readerSelectionBoundaryLocator(range.startContainer, range.startOffset, 'before');
        const end = readerSelectionBoundaryLocator(range.endContainer, range.endOffset, 'after');
        if (!start || !end) return null;
        const text = String(selection.toString() || '').replace(/\r\n?/g, '\n');
        if (!text.trim()) return null;
        return { start, end, text, characterCount: text.length };
    }

    async function copyReaderSelection() {
        const elements = readerSelectionElements();
        const selection = readerState.transferSelection;
        const text = String(selection && selection.text || window.getSelection && window.getSelection() || '').replace(/\r\n?/g, '\n');
        if (!selection || !text) {
            if (elements.toolbarLabel) elements.toolbarLabel.textContent = '请先选择正文范围';
            return;
        }
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
            } else {
                const input = document.createElement('textarea');
                input.value = text;
                input.setAttribute('readonly', '');
                input.style.position = 'fixed';
                input.style.opacity = '0';
                document.body.appendChild(input);
                input.select();
                const copied = document.execCommand('copy');
                input.remove();
                if (!copied) throw new Error('剪贴板不可用');
            }
            if (elements.toolbarLabel) elements.toolbarLabel.textContent = `已复制 ${selection.characterCount.toLocaleString()} 个字符`;
        } catch (error) {
            if (elements.toolbarLabel) elements.toolbarLabel.textContent = `复制失败：${error.message || error}`;
        }
    }

    function clearReaderTransferSelection() {
        readerState.transferSelection = null;
        const elements = readerSelectionElements();
        if (elements.toolbar) elements.toolbar.hidden = true;
        if (typeof window.readerHudNotifySelection === 'function') window.readerHudNotifySelection(false);
    }

    function updateReaderSelectionToolbar() {
        const elements = readerSelectionElements();
        const range = readerDomSelectionRange();
        readerState.transferSelection = range;
        if (elements.toolbar) elements.toolbar.hidden = !range;
        if (elements.toolbarLabel && range) elements.toolbarLabel.textContent = `已选择 ${range.characterCount.toLocaleString()} 个字符`;
        if (typeof window.readerHudNotifySelection === 'function') window.readerHudNotifySelection(!!range);
    }

    function readerTransferCurrentSceneId() {
        const locator = readerState.transferSelection && readerState.transferSelection.start
            || (typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : null);
        return locator && locator.projectRef && locator.projectRef.sceneId || '';
    }

    function renderReaderTransferChapterChoices() {
        const elements = readerSelectionElements();
        if (!elements.chapterList) return;
        elements.chapterList.replaceChildren();
        if (!readerState.transferChapterIds.length && readerState.activeChapterId) {
            readerState.transferChapterIds = [readerState.activeChapterId];
        }
        readerState.contents.forEach((chapter) => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = chapter.chapterId;
            checkbox.dataset.readerTransferChapter = chapter.chapterId;
            checkbox.checked = readerState.transferChapterIds.includes(chapter.chapterId);
            checkbox.addEventListener('change', () => {
                readerState.transferChapterIds = Array.from(elements.chapterList.querySelectorAll('[data-reader-transfer-chapter]:checked')).map((input) => input.value);
                renderReaderTransferSummary();
            });
            const text = document.createElement('span');
            text.textContent = chapter.title;
            label.append(checkbox, text);
            elements.chapterList.appendChild(label);
        });
    }

    function readerTransferSummaryModel() {
        const scope = readerState.transferScope;
        const contents = readerState.contents || [];
        const current = contents.find((chapter) => chapter.chapterId === readerState.activeChapterId);
        let characterCount = 0;
        let chapterCount = 0;
        let sceneCount = 0;
        if (scope === 'selection' && readerState.transferSelection) {
            characterCount = readerState.transferSelection.characterCount;
            chapterCount = 1;
            sceneCount = readerTransferCurrentSceneId() ? 1 : 0;
        } else if (scope === 'scene') {
            const sceneId = readerTransferCurrentSceneId();
            const blocks = readerState.currentChapter && readerState.currentChapter.blocks || [];
            characterCount = blocks.filter((block) => block.sourceSceneId === sceneId).reduce((sum, block) => sum + block.text.length, 0);
            chapterCount = characterCount ? 1 : 0;
            sceneCount = characterCount ? 1 : 0;
        } else if (scope === 'chapter') {
            characterCount = Number(current && current.characterCount) || 0;
            chapterCount = current ? 1 : 0;
        } else if (scope === 'chapters') {
            const selected = new Set(readerState.transferChapterIds);
            const chapters = contents.filter((chapter) => selected.has(chapter.chapterId));
            characterCount = chapters.reduce((sum, chapter) => sum + (Number(chapter.characterCount) || 0), 0);
            chapterCount = chapters.length;
        } else {
            characterCount = contents.reduce((sum, chapter) => sum + (Number(chapter.characterCount) || 0), 0);
            chapterCount = contents.length;
        }
        return { characterCount, chapterCount, sceneCount };
    }

    function renderReaderTransferSummary() {
        const elements = readerSelectionElements();
        if (!elements.dialog) return;
        const selectionOption = elements.scope && elements.scope.querySelector('option[value="selection"]');
        const sceneOption = elements.scope && elements.scope.querySelector('option[value="scene"]');
        if (selectionOption) selectionOption.disabled = !readerState.transferSelection;
        if (sceneOption) sceneOption.disabled = !readerTransferCurrentSceneId() || readerState.documentMetadata && readerState.documentMetadata.sourceKind !== 'project';
        if (elements.chapters) elements.chapters.hidden = readerState.transferScope !== 'chapters';
        const summary = readerTransferSummaryModel();
        if (elements.source) elements.source.textContent = `${readerState.documentMetadata && readerState.documentMetadata.title || '当前文档'} · ${readerState.transferScope}`;
        if (elements.counts) elements.counts.textContent = `${summary.characterCount.toLocaleString()} 字符 · ${summary.chapterCount} 章 · ${summary.sceneCount} 场景`;
        if (elements.risk) elements.risk.textContent = summary.characterCount > 100000
            ? '超长范围：快照可以创建，目标模块必须分块处理。'
            : summary.characterCount > 20000 ? '长范围：目标模块可能需要分块处理。' : '范围适中，将创建不可变本地快照。';
        const valid = summary.characterCount > 0 && (readerState.transferScope !== 'chapters' || readerState.transferChapterIds.length > 0);
        elements.destinations.forEach((button) => { button.disabled = readerState.transferBusy || !valid; });
    }

    function openReaderTransferDialog(preferredScope) {
        const elements = readerSelectionElements();
        if (!elements.dialog || !readerState.apiMode) return;
        const requested = preferredScope || (readerState.transferSelection ? 'selection' : 'chapter');
        readerState.transferScope = requested === 'selection' && !readerState.transferSelection ? 'chapter' : requested;
        if (!readerState.transferChapterIds.length && readerState.activeChapterId) readerState.transferChapterIds = [readerState.activeChapterId];
        if (elements.scope) elements.scope.value = readerState.transferScope;
        if (elements.status) elements.status.textContent = '不会把正文放入路由、localStorage 或普通历史。';
        renderReaderTransferChapterChoices();
        renderReaderTransferSummary();
        if (!elements.dialog.open) elements.dialog.showModal();
        elements.scope && elements.scope.focus();
    }

    function closeReaderTransferDialog() {
        const elements = readerSelectionElements();
        if (elements.dialog && elements.dialog.open) elements.dialog.close();
        elements.toggle && elements.toggle.focus();
    }

    function readerTransferRequest(destination) {
        const revision = readerState.documentMetadata && readerState.documentMetadata.revisions.find((item) => item.revisionId === readerState.activeRevisionId);
        const request = {
            envelopeId: `reader-transfer:${crypto.randomUUID()}`,
            createdAt: new Date().toISOString(),
            destination,
            documentId: readerState.activeDocumentId,
            revisionId: readerState.activeRevisionId,
            sourceRevisionDigest: revision && revision.contentDigest || '',
            projectId: readerState.documentMetadata && readerState.documentMetadata.projectId || '',
            scope: readerState.transferScope
        };
        if (request.scope === 'selection') request.range = { start: readerState.transferSelection.start, end: readerState.transferSelection.end };
        if (request.scope === 'scene') request.sceneId = readerTransferCurrentSceneId();
        if (request.scope === 'chapter') request.chapterId = readerState.activeChapterId;
        if (request.scope === 'chapters') request.chapterIds = [...readerState.transferChapterIds];
        return request;
    }

    async function createReaderTransferFromDialog(destination) {
        const elements = readerSelectionElements();
        if (readerState.transferBusy) return;
        readerState.transferBusy = true;
        renderReaderTransferSummary();
        if (elements.status) elements.status.textContent = '正在冻结来源快照…';
        try {
            const response = await fetch('/api/reader/transfer/range', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(readerTransferRequest(destination))
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            readerState.transferLastEnvelopeId = payload.envelope.envelopeId;
            if (elements.status) elements.status.textContent = `快照已创建：${payload.summary.characterCount.toLocaleString()} 字符。正在安全跳转…`;
            if (elements.dialog && elements.dialog.open) elements.dialog.close();
            window.dispatchEvent(new CustomEvent('reader-transfer-created', {
                detail: { envelopeId: payload.envelope.envelopeId, destination }
            }));
        } catch (error) {
            if (elements.status) elements.status.textContent = `创建失败：${error.message || error}。范围和阅读位置已保留，可重试。`;
        } finally {
            readerState.transferBusy = false;
            renderReaderTransferSummary();
        }
    }

    function initializeReaderSelection() {
        const elements = readerSelectionElements();
        if (!elements.toggle || elements.toggle.dataset.readerSelectionBound === 'true') return;
        elements.toggle.dataset.readerSelectionBound = 'true';
        elements.toggle.addEventListener('click', () => openReaderTransferDialog());
        elements.confirm?.addEventListener('click', () => openReaderTransferDialog('selection'));
        elements.copy?.addEventListener('click', copyReaderSelection);
        elements.close?.addEventListener('click', closeReaderTransferDialog);
        elements.dialog?.addEventListener('cancel', (event) => { event.preventDefault(); closeReaderTransferDialog(); });
        elements.scope?.addEventListener('change', () => {
            readerState.transferScope = elements.scope.value;
            renderReaderTransferSummary();
        });
        elements.destinations.forEach((button) => button.addEventListener('click', () => createReaderTransferFromDialog(button.dataset.readerTransferDestination)));
        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection();
            const content = elements.content;
            if (!selection || !selection.rangeCount || !content) {
                updateReaderSelectionToolbar();
                return;
            }
            const range = selection.getRangeAt(0);
            if (!content.contains(range.startContainer) && !content.contains(range.endContainer)) return;
            updateReaderSelectionToolbar();
        });
    }
