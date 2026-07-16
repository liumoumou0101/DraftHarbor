    const READER_TRANSFER_TARGET_STORAGE_KEY = 'draftharbor:reader-transfer-targets';
    const readerTransferTargetState = {
        pointers: {},
        transfers: {},
        loading: {},
        errors: {}
    };

    function readerTransferTargetElements(destination) {
        const bar = document.querySelector(`[data-reader-source-bar="${destination}"]`);
        return {
            bar,
            title: bar && bar.querySelector('[data-reader-source-title]'),
            detail: bar && bar.querySelector('[data-reader-source-detail]'),
            use: bar && bar.querySelector('[data-reader-source-use]'),
            back: bar && bar.querySelector('[data-reader-source-return]'),
            dismiss: bar && bar.querySelector('[data-reader-source-dismiss]')
        };
    }

    function loadReaderTransferTargetPointers() {
        try {
            const parsed = JSON.parse(localStorage.getItem(READER_TRANSFER_TARGET_STORAGE_KEY) || '{}');
            readerTransferTargetState.pointers = Object.fromEntries(['writer', 'compendium', 'workflow']
                .filter((destination) => typeof parsed[destination] === 'string' && parsed[destination].trim())
                .map((destination) => [destination, parsed[destination].trim()]));
        } catch (_) {
            readerTransferTargetState.pointers = {};
        }
    }

    function saveReaderTransferTargetPointers() {
        try {
            localStorage.setItem(READER_TRANSFER_TARGET_STORAGE_KEY, JSON.stringify(readerTransferTargetState.pointers));
        } catch (_) { /* envelope ids remain recoverable from the Transfer Store */ }
    }

    function readerTransferFreshnessText(transfer) {
        const freshness = transfer && transfer.freshness || {};
        if (freshness.status === 'missing') return '原来源已缺失；仍可明确使用已冻结快照。';
        if (freshness.status === 'stale') return '项目来源已变化；可继续旧快照，或返回阅读器刷新范围。';
        if (freshness.newerRevisionAvailable) return '快照有效，但书库中存在较新修订，不会静默替换。';
        return '来源与创建时一致。';
    }

    function renderReaderTransferTarget(destination) {
        const elements = readerTransferTargetElements(destination);
        if (!elements.bar) return;
        const envelopeId = readerTransferTargetState.pointers[destination];
        const transfer = readerTransferTargetState.transfers[destination];
        const error = readerTransferTargetState.errors[destination];
        elements.bar.hidden = !envelopeId;
        if (!envelopeId) return;
        if (elements.title) elements.title.textContent = transfer
            ? `来自阅读器 · ${transfer.snapshot.sourceTitle}`
            : '来自阅读器';
        if (elements.detail) {
            elements.detail.textContent = error || (transfer
                ? `${transfer.envelope.characterCount.toLocaleString()} 字符 · ${readerTransferFreshnessText(transfer)}${transfer.envelope.suggestedProjectId ? ` 建议项目：${transfer.envelope.suggestedProjectId}（不会自动选择）` : ''}`
                : '正在读取指定 Envelope…');
        }
        const consumed = transfer && transfer.envelope.lifecycle === 'consumed';
        if (elements.use) {
            elements.use.disabled = !transfer || !!error || readerTransferTargetState.loading[destination];
            elements.use.textContent = consumed ? '重新载入此快照' : transfer && ['stale', 'missing'].includes(transfer.freshness.status) ? '继续使用旧快照' : '使用此快照';
        }
    }

    async function activateReaderTransferTarget(destination) {
        if (!['writer', 'compendium', 'workflow'].includes(destination)) return;
        const envelopeId = readerTransferTargetState.pointers[destination];
        renderReaderTransferTarget(destination);
        if (!envelopeId || readerTransferTargetState.loading[destination]) return;
        readerTransferTargetState.loading[destination] = true;
        readerTransferTargetState.errors[destination] = '';
        renderReaderTransferTarget(destination);
        try {
            const response = await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            if (payload.transfer.envelope.destination !== destination || payload.transfer.envelope.envelopeId !== envelopeId) {
                throw new Error('Envelope 与当前目标不匹配');
            }
            readerTransferTargetState.transfers[destination] = payload.transfer;
        } catch (error) {
            readerTransferTargetState.errors[destination] = `来源读取失败：${error.message || error}`;
            delete readerTransferTargetState.transfers[destination];
        } finally {
            readerTransferTargetState.loading[destination] = false;
            renderReaderTransferTarget(destination);
        }
    }

    function dismissReaderTransferTarget(destination) {
        delete readerTransferTargetState.pointers[destination];
        delete readerTransferTargetState.transfers[destination];
        delete readerTransferTargetState.errors[destination];
        saveReaderTransferTargetPointers();
        renderReaderTransferTarget(destination);
    }

    async function returnToReaderTransferSource(destination) {
        const transfer = readerTransferTargetState.transfers[destination];
        setView('reader');
        if (!transfer) return;
        const envelope = transfer.envelope;
        const locator = envelope.sourceLocators && envelope.sourceLocators[0];
        try {
            if (!envelope.documentId.startsWith('project:') && readerState.activeDocumentId !== envelope.documentId) {
                await openReaderLibraryDocument(envelope.documentId);
            }
            if (readerState.activeDocumentId === envelope.documentId && locator && typeof navigateReaderToLocator === 'function') {
                await navigateReaderToLocator(locator, { highlight: true });
            }
        } catch (error) {
            console.warn('Failed to return to reader transfer source:', error);
        }
    }

    function materializeReaderTransferInput(destination, transfer) {
        const projectId = typeof currentProjectId === 'function' ? currentProjectId() : '';
        if (!projectId) throw new Error('请先从书库打开目标项目；建议项目不会自动替你选择');
        const referenceId = `${destination}-input:${projectId}:${transfer.envelope.envelopeId}`;
        if (destination === 'writer') {
            const input = document.querySelector('[data-native-beat-input]');
            if (!input || input.disabled) throw new Error('请先在写作区选择一个场景');
            nativeEditorState.assistantPanel = 'generate';
            nativeEditorState.generation.beat = transfer.text;
            input.value = transfer.text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        } else if (destination === 'compendium') {
            const draftId = `reader-candidate:${transfer.envelope.envelopeId}`;
            const candidate = {
                id: draftId, type: 'lore', category: 'lore',
                title: `来自阅读器：${transfer.snapshot.sourceTitle}`,
                summary: `待审核来源快照，共 ${transfer.envelope.characterCount.toLocaleString()} 字符。`,
                tags: ['阅读器候选'], aliases: [], alwaysInContext: false,
                contextPolicy: { mode: 'manual', triggers: {} }, body: transfer.text,
                readerTransferEnvelopeId: transfer.envelope.envelopeId
            };
            compendiumState.entries = [candidate, ...compendiumState.entries.filter((entry) => entry.id !== draftId)];
            compendiumState.selectedId = draftId;
            compendiumState.dirty = true;
            renderCompendium();
            setCompendiumStatus('阅读器快照已形成未保存候选卡；审核后再保存。', 'ok');
        } else {
            const input = document.querySelector('[data-workflow-brief]');
            if (!input) throw new Error('工作流输入区不可用');
            workflowState.readerTransferInput = { envelopeId: transfer.envelope.envelopeId, referenceId };
            input.value = transfer.text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            setWorkflowStatus('阅读器快照已载入工作流输入；启动前仍可编辑。', 'ok');
        }
        return referenceId;
    }

    async function useReaderTransferTarget(destination) {
        const transfer = readerTransferTargetState.transfers[destination];
        if (!transfer || readerTransferTargetState.loading[destination]) return;
        if (destination === 'writer' && typeof openReaderWriterTransfer === 'function') {
            openReaderWriterTransfer(transfer);
            return;
        }
        if (destination === 'compendium' && typeof openReaderCompendiumTransfer === 'function') {
            openReaderCompendiumTransfer(transfer);
            return;
        }
        if (destination === 'workflow' && typeof openReaderWorkflowTransfer === 'function') {
            openReaderWorkflowTransfer(transfer);
            return;
        }
        readerTransferTargetState.loading[destination] = true;
        readerTransferTargetState.errors[destination] = '';
        renderReaderTransferTarget(destination);
        try {
            const referenceId = materializeReaderTransferInput(destination, transfer);
            const now = new Date().toISOString();
            const response = await fetch('/api/reader/transfer/consumer/materialize', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    envelopeId: transfer.envelope.envelopeId,
                    consumer: {
                        consumerId: `${destination}-input:${transfer.envelope.envelopeId}`,
                        destination, referenceId, createdAt: now, materializedAt: now
                    }
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            transfer.envelope = payload.envelope;
        } catch (error) {
            readerTransferTargetState.errors[destination] = `物化失败：${error.message || error}。Envelope 保持 active，可重试。`;
        } finally {
            readerTransferTargetState.loading[destination] = false;
            renderReaderTransferTarget(destination);
        }
    }

    function bindReaderTransferConsumers() {
        loadReaderTransferTargetPointers();
        ['writer', 'compendium', 'workflow'].forEach((destination) => {
            const elements = readerTransferTargetElements(destination);
            elements.use?.addEventListener('click', () => useReaderTransferTarget(destination));
            elements.back?.addEventListener('click', () => returnToReaderTransferSource(destination));
            elements.dismiss?.addEventListener('click', () => dismissReaderTransferTarget(destination));
            renderReaderTransferTarget(destination);
        });
        window.addEventListener('reader-transfer-created', (event) => {
            const detail = event.detail || {};
            if (!['writer', 'compendium', 'workflow'].includes(detail.destination) || !detail.envelopeId) return;
            readerTransferTargetState.pointers[detail.destination] = detail.envelopeId;
            delete readerTransferTargetState.transfers[detail.destination];
            delete readerTransferTargetState.errors[detail.destination];
            saveReaderTransferTargetPointers();
            setView(detail.destination);
            activateReaderTransferTarget(detail.destination);
        });
    }
