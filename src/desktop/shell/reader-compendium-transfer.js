    /* global parseCommaList, currentProjectId, loadCompendium, renderCompendium, activateReaderTransferTarget */
    const readerCompendiumTransferState = { transfer: null, batch: null, busy: false };

    function readerCompendiumTransferElements() {
        const dialog = document.querySelector('[data-reader-compendium-dialog]');
        return {
            dialog, close: dialog && dialog.querySelector('[data-reader-compendium-close]'),
            source: dialog && dialog.querySelector('[data-reader-compendium-source]'),
            summary: dialog && dialog.querySelector('[data-reader-compendium-summary]'),
            cards: dialog && dialog.querySelector('[data-reader-compendium-cards]'),
            confirm: dialog && dialog.querySelector('[data-reader-compendium-confirm]'),
            status: dialog && dialog.querySelector('[data-reader-compendium-status]'),
            extract: dialog && dialog.querySelector('[data-reader-compendium-extract]'),
            apply: dialog && dialog.querySelector('[data-reader-compendium-apply]')
        };
    }

    function compendiumCandidateLabel(candidate) {
        if (candidate.classification === 'update') return `将更新现有卡片 · ${candidate.existingEntryId}`;
        if (candidate.classification === 'suspected-duplicate') return `疑似重复 · ${candidate.suspectedEntryIds.join('、')}`;
        return '新资料卡';
    }

    function readerCompendiumCardField(label, value, field, options = {}) {
        const wrapper = document.createElement('label');
        if (options.wide) wrapper.className = 'wide';
        const caption = document.createElement('span'); caption.textContent = label;
        let input;
        if (options.select) {
            input = document.createElement('select');
            options.select.forEach(([key, title]) => { const option = document.createElement('option'); option.value = key; option.textContent = title; input.append(option); });
        } else if (options.rows) {
            input = document.createElement('textarea'); input.rows = options.rows;
        } else input = document.createElement('input');
        input.value = Array.isArray(value) ? value.join(', ') : value || '';
        input.dataset.readerCompendiumField = field;
        wrapper.append(caption, input);
        return wrapper;
    }

    function renderReaderCompendiumBatch() {
        const elements = readerCompendiumTransferElements();
        const batch = readerCompendiumTransferState.batch;
        if (!batch) {
            elements.summary.hidden = true; elements.cards.replaceChildren(); elements.apply.disabled = true; return;
        }
        const counts = batch.candidates.reduce((result, candidate) => { result[candidate.classification] = (result[candidate.classification] || 0) + 1; return result; }, {});
        elements.summary.hidden = false;
        elements.summary.textContent = `${batch.chunkCount} 个分块 · ${batch.candidates.length} 张候选 · 新建 ${counts.new || 0} · 更新 ${counts.update || 0} · 疑似重复 ${counts['suspected-duplicate'] || 0}`;
        elements.cards.replaceChildren(...batch.candidates.map((candidate) => {
            const card = candidate.modifiedCard || candidate.card;
            const article = document.createElement('article'); article.className = 'desktop-reader-compendium-card'; article.dataset.readerCompendiumCandidate = candidate.candidateId;
            const heading = document.createElement('div'); heading.className = 'desktop-reader-compendium-card-heading';
            const copy = document.createElement('div'); const title = document.createElement('h3'); title.textContent = card.title; const detail = document.createElement('p'); detail.textContent = compendiumCandidateLabel(candidate); copy.append(title, detail);
            const decision = document.createElement('select'); decision.className = 'desktop-reader-compendium-decision'; decision.dataset.readerCompendiumDecision = '';
            [['', '请选择审核决定'], ['approved', '通过'], ['approved-modified', '修改后通过'], ['abandoned', '放弃']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; decision.append(option); });
            decision.value = candidate.decision || ''; decision.addEventListener('change', renderReaderCompendiumApplyState); heading.append(copy, decision);
            const fields = document.createElement('div'); fields.className = 'desktop-reader-compendium-fields';
            fields.append(
                readerCompendiumCardField('类型', card.type, 'type', { select: [['character', '人物'], ['location', '地点'], ['organization', '势力'], ['item', '物品'], ['lore', '设定'], ['timeline', '事件'], ['note', '笔记']] }),
                readerCompendiumCardField('标题', card.title, 'title'),
                readerCompendiumCardField('摘要', card.summary, 'summary', { wide: true }),
                readerCompendiumCardField('标签', card.tags, 'tags'), readerCompendiumCardField('别名', card.aliases, 'aliases'),
                readerCompendiumCardField('卡片内容', card.body, 'body', { wide: true, rows: 4 })
            );
            const evidence = document.createElement('ul'); evidence.className = 'desktop-reader-compendium-evidence';
            (card.evidence || candidate.card.evidence || []).forEach((item) => { const li = document.createElement('li'); li.textContent = `分块 ${Number(item.chunkIndex) + 1}：${item.excerpt || '已记录来源范围'}`; evidence.append(li); });
            article.append(heading, fields, evidence); return article;
        }));
        renderReaderCompendiumApplyState();
    }

    function renderReaderCompendiumApplyState() {
        const elements = readerCompendiumTransferElements();
        const decisions = Array.from(elements.cards.querySelectorAll('[data-reader-compendium-decision]'));
        const fullyReviewed = decisions.length > 0 && decisions.every((select) => select.value);
        elements.apply.disabled = readerCompendiumTransferState.busy || !fullyReviewed || !elements.confirm.checked;
    }

    function readCandidateCard(article, candidate) {
        const value = (field) => article.querySelector(`[data-reader-compendium-field="${field}"]`).value;
        return {
            type: value('type'), title: value('title').trim(), summary: value('summary').trim(), body: value('body'),
            tags: parseCommaList(value('tags')), aliases: parseCommaList(value('aliases')),
            characterProfile: candidate.card.characterProfile
        };
    }

    async function extractReaderCompendiumCandidates() {
        const elements = readerCompendiumTransferElements(); const transfer = readerCompendiumTransferState.transfer;
        const projectId = typeof currentProjectId === 'function' ? currentProjectId() : '';
        if (!transfer || readerCompendiumTransferState.busy) return;
        if (!projectId) { elements.status.textContent = '请先从书库打开目标项目；建议项目不会被自动选择。'; return; }
        readerCompendiumTransferState.busy = true; elements.extract.disabled = true; elements.status.textContent = '正在分块提取并合并候选；资料库磁盘仍未修改…';
        try {
            const response = await fetch('/api/compendium/reader-transfer/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envelopeId: transfer.envelope.envelopeId, projectId }) });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            readerCompendiumTransferState.batch = payload.batch; elements.confirm.checked = false;
            elements.status.textContent = '候选已生成。必须为每张卡片选择明确决定，未审核项不能批量保存。';
        } catch (error) { elements.status.textContent = `提取失败：${error.message || error}`; }
        finally { readerCompendiumTransferState.busy = false; elements.extract.disabled = false; renderReaderCompendiumBatch(); }
    }

    async function applyReaderCompendiumBatch() {
        const elements = readerCompendiumTransferElements(); const batch = readerCompendiumTransferState.batch;
        if (!batch || readerCompendiumTransferState.busy || !elements.confirm.checked) return;
        const decisions = Array.from(elements.cards.querySelectorAll('[data-reader-compendium-candidate]')).map((article) => {
            const candidate = batch.candidates.find((item) => item.candidateId === article.dataset.readerCompendiumCandidate);
            const decision = article.querySelector('[data-reader-compendium-decision]').value;
            return { candidateId: candidate.candidateId, decision, card: decision === 'approved-modified' ? readCandidateCard(article, candidate) : undefined };
        });
        if (decisions.some((item) => !item.decision)) { elements.status.textContent = '仍有候选未审核，不能保存。'; return; }
        readerCompendiumTransferState.busy = true; elements.status.textContent = '正在整批校验并创建写前备份…'; renderReaderCompendiumApplyState();
        try {
            let response = await fetch('/api/compendium/reader-transfer/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: batch.projectId, batchId: batch.batchId, expectedUpdatedAt: batch.updatedAt, decisions }) });
            let payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            readerCompendiumTransferState.batch = payload.batch;
            response = await fetch('/api/compendium/reader-transfer/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: batch.projectId, batchId: batch.batchId, expectedProjectUpdatedAt: batch.projectUpdatedAt, confirmed: true }) });
            payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            readerCompendiumTransferState.batch = payload.batch;
            await loadCompendium(); renderCompendium();
            elements.status.textContent = `已保存 ${payload.batch.savedEntryIds.length} 张资料卡${payload.backup && payload.backup.backupId ? `；备份 ${payload.backup.backupId}` : ''}${payload.idempotent ? '（重复提交未再次写入）' : ''}。`;
            if (typeof activateReaderTransferTarget === 'function') await activateReaderTransferTarget('compendium');
            if (elements.dialog.open) elements.dialog.close();
        } catch (error) { elements.status.textContent = `保存失败：${error.message || error}。整批审核不会绕过，重新核对后可重试。`; }
        finally { readerCompendiumTransferState.busy = false; renderReaderCompendiumApplyState(); }
    }

    function openReaderCompendiumTransfer(transfer) {
        const elements = readerCompendiumTransferElements(); if (!elements.dialog) return;
        readerCompendiumTransferState.transfer = transfer; readerCompendiumTransferState.batch = null;
        elements.source.textContent = `${transfer.snapshot.sourceTitle} · ${transfer.envelope.characterCount.toLocaleString()} 字符`;
        elements.status.textContent = '点击“开始提取”后调用资料库专用 Provider；确认前不会写入资料库。'; elements.confirm.checked = false;
        renderReaderCompendiumBatch(); if (!elements.dialog.open) elements.dialog.showModal();
    }

    function bindReaderCompendiumTransfer() {
        const elements = readerCompendiumTransferElements(); if (!elements.dialog || elements.dialog.dataset.readerCompendiumBound === 'true') return;
        elements.dialog.dataset.readerCompendiumBound = 'true';
        elements.close.addEventListener('click', () => elements.dialog.close());
        elements.dialog.addEventListener('cancel', (event) => { event.preventDefault(); elements.dialog.close(); });
        elements.extract.addEventListener('click', extractReaderCompendiumCandidates); elements.apply.addEventListener('click', applyReaderCompendiumBatch);
        elements.confirm.addEventListener('change', renderReaderCompendiumApplyState);
    }
