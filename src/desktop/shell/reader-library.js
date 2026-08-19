    async function readerApi(path, options) {
        const response = await fetch(path, options);
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || '阅读器请求失败');
        return payload;
    }

    function renderReaderLibraryLegacy() {
        const container = document.querySelector('[data-reader-library]');
        if (!container) return;
        container.replaceChildren();
        if (!readerState.libraryDocuments.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-reader-coming-soon';
            const title = document.createElement('strong');
            title.textContent = '书库还是空的';
            const detail = document.createElement('p');
            detail.textContent = '导入一本 txt 或 md 文档后，它会显示在这里。';
            empty.append(title, detail);
            container.appendChild(empty);
            return;
        }
        readerState.libraryDocuments.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'desktop-reader-library-item';
            button.classList.toggle('is-active', item.documentId === readerState.activeDocumentId);
            const title = document.createElement('strong');
            title.textContent = item.title || '未命名文档';
            const meta = document.createElement('span');
            const source = item.sourceKind === 'project' ? '项目作品' : item.format === 'md' ? 'Markdown' : '本地文本';
            const count = Number(item.characterCount) > 0 ? ` · ${Number(item.characterCount).toLocaleString()} 字` : '';
            meta.textContent = `${source} · ${item.revisionCount || 1} 个版本${count}`;
            button.append(title, meta);
            button.addEventListener('click', () => openReaderLibraryDocument(item.documentId));
            container.appendChild(button);
        });
    }

    async function loadReaderLibraryLegacy() {
        const container = document.querySelector('[data-reader-library]');
        try {
            const payload = await readerApi('/api/reader/documents');
            readerState.libraryDocuments = Array.isArray(payload.documents) ? payload.documents : [];
            readerState.libraryIndexVersion = payload.index && Number(payload.index.version) || 0;
            renderReaderLibrary();
            return readerState.libraryDocuments;
        } catch (error) {
            if (container) container.textContent = `书库载入失败：${error.message || error}`;
            return [];
        }
    }

    function readerCurrentLibraryView() {
        const api = window.DraftHarborReaderLibraryView;
        return readerState.libraryView || (api ? api.createReaderLibraryView({}) : {
            schemaVersion: 1, viewMode: 'grid', sortBy: 'recent', sourceFilter: 'all', query: '',
            selectedShelfId: '', favoriteDocumentIds: [], hiddenDocumentIds: [], shelves: []
        });
    }

    function readerLibraryElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function readerLibrarySource(document) {
        if (document.sourceKind === 'project') return '项目作品';
        if (document.sourceKind === 'pasted-text') return '粘贴文本';
        return document.format === 'md' ? 'Markdown' : '本地文本';
    }

    function readerLibraryProgress(document) {
        return Math.max(0, Math.min(100, Number(document.reading && document.reading.progress) || 0));
    }

    let readerLibraryViewSaveTimer = null;

    async function persistReaderLibraryView(changes) {
        const api = window.DraftHarborReaderLibraryView;
        const current = readerCurrentLibraryView();
        const next = api && api.mergeReaderLibraryView
            ? api.mergeReaderLibraryView(current, changes || {})
            : { ...current, ...(changes || {}) };
        readerState.libraryView = next;
        try {
            const payload = await readerApi('/api/reader/library-view', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    view: next,
                    expectedUpdatedAt: readerState.libraryViewRecord && readerState.libraryViewRecord.updatedAt,
                    updatedAt: new Date().toISOString()
                })
            });
            readerState.libraryViewRecord = payload.record;
            readerState.libraryView = payload.record.view;
        } catch (error) {
            console.warn('Failed to save reader library view:', error);
        }
    }

    function scheduleReaderLibraryViewSave(changes) {
        readerState.libraryView = { ...readerCurrentLibraryView(), ...(changes || {}) };
        if (readerLibraryViewSaveTimer) window.clearTimeout(readerLibraryViewSaveTimer);
        readerLibraryViewSaveTimer = window.setTimeout(() => {
            readerLibraryViewSaveTimer = null;
            persistReaderLibraryView(changes);
        }, 220);
    }

    function renderReaderLibraryToolbar(container, documents) {
        const view = readerCurrentLibraryView();
        const toolbar = readerLibraryElement('div', 'desktop-reader-library-toolbar');
        const heading = readerLibraryElement('div', 'desktop-reader-library-heading');
        heading.append(
            readerLibraryElement('span', 'desktop-reader-library-count', String(documents.length) + ' 本书')
        );
        const controls = readerLibraryElement('div', 'desktop-reader-library-controls');
        const query = document.createElement('input');
        query.type = 'search';
        query.placeholder = '搜索书名或文件名';
        query.value = view.query || '';
        query.setAttribute('aria-label', '搜索书库');
        query.addEventListener('input', () => {
            const value = query.value;
            scheduleReaderLibraryViewSave({ query: value });
            renderReaderLibrary();
            const replacement = document.querySelector('[data-reader-library] input[aria-label="搜索书库"]');
            if (replacement) {
                replacement.focus();
                replacement.setSelectionRange(value.length, value.length);
            }
        });
        const source = document.createElement('select');
        source.setAttribute('aria-label', '筛选书籍来源');
        [['all', '全部来源'], ['project', '项目作品'], ['local-text', '本地文本'], ['pasted-text', '粘贴文本']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            source.appendChild(option);
        });
        source.value = view.sourceFilter || 'all';
        source.addEventListener('change', () => {
            persistReaderLibraryView({ sourceFilter: source.value });
            renderReaderLibrary();
        });
        const sort = document.createElement('select');
        sort.setAttribute('aria-label', '排序书籍');
        [['recent', '最近阅读'], ['title', '标题'], ['progress', '阅读进度'], ['source', '来源']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            sort.appendChild(option);
        });
        sort.value = view.sortBy || 'recent';
        sort.addEventListener('change', () => {
            persistReaderLibraryView({ sortBy: sort.value });
            renderReaderLibrary();
        });
        const mode = readerLibraryElement('button', 'desktop-reader-tool', view.viewMode === 'list' ? '网格视图' : '列表视图');
        mode.type = 'button';
        mode.addEventListener('click', () => {
            persistReaderLibraryView({ viewMode: view.viewMode === 'list' ? 'grid' : 'list' });
            renderReaderLibrary();
        });
        const shelf = document.createElement('select');
        shelf.setAttribute('aria-label', '筛选自定义书架');
        [['', '全部书籍'], ...(view.shelves || []).map((item) => [item.shelfId, item.title])].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            shelf.appendChild(option);
        });
        shelf.value = view.selectedShelfId || '';
        shelf.addEventListener('change', () => {
            persistReaderLibraryView({ selectedShelfId: shelf.value });
            renderReaderLibrary();
        });
        const createShelf = readerLibraryElement('button', 'desktop-reader-tool', '新建书架');
        createShelf.type = 'button';
        createShelf.addEventListener('click', () => {
            const title = window.prompt('新书架名称');
            const cleanTitle = String(title || '').trim().slice(0, 80);
            if (!cleanTitle) return;
            const slug = cleanTitle.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'custom';
            const shelfId = 'shelf:' + slug + '-' + Date.now().toString(36);
            persistReaderLibraryView({ shelves: [...(view.shelves || []), { shelfId, title: cleanTitle, documentIds: [] }] });
            renderReaderLibrary();
        });
        controls.append(query, source, sort, shelf, mode, createShelf);
        toolbar.append(heading, controls);
        container.appendChild(toolbar);
    }

    function renderReaderLibraryCard(documentSummary, view) {
        const card = readerLibraryElement('article', 'desktop-reader-library-card desktop-reader-library-item');
        card.tabIndex = 0;
        card.addEventListener('click', (event) => {
            if (!event.target.closest('button')) openReaderLibraryDocument(documentSummary.documentId);
        });
        card.addEventListener('keydown', (event) => {
            if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            openReaderLibraryDocument(documentSummary.documentId);
        });
        if (view.viewMode === 'list') card.classList.add('is-list');
        const cover = readerLibraryElement('div', 'desktop-reader-library-cover', (documentSummary.title || '未命名文档').slice(0, 1));
        cover.setAttribute('aria-hidden', 'true');
        const body = readerLibraryElement('div', 'desktop-reader-library-card-body');
        const progress = readerLibraryProgress(documentSummary);
        const progressWrap = readerLibraryElement('div', 'desktop-reader-card-progress');
        const progressBar = document.createElement('progress');
        progressBar.max = 100;
        progressBar.value = progress;
        progressWrap.append(progressBar, readerLibraryElement('span', '', documentSummary.reading && documentSummary.reading.hasState ? String(progress) + '%' : '未开始'));
        const actions = readerLibraryElement('div', 'desktop-reader-library-card-actions');
        const open = readerLibraryElement('button', 'desktop-secondary-action', documentSummary.reading && documentSummary.reading.hasState ? '继续' : '开始');
        open.type = 'button';
        open.addEventListener('click', () => openReaderLibraryDocument(documentSummary.documentId));
        const detail = readerLibraryElement('button', 'desktop-reader-tool', '详情');
        detail.type = 'button';
        detail.addEventListener('click', () => openReaderLibraryDetail(documentSummary.documentId));
        const favorite = view.favoriteDocumentIds.includes(documentSummary.documentId);
        const favoriteButton = readerLibraryElement('button', 'desktop-reader-tool', favorite ? '已收藏' : '收藏');
        favoriteButton.type = 'button';
        favoriteButton.setAttribute('aria-pressed', favorite ? 'true' : 'false');
        favoriteButton.addEventListener('click', () => {
            const ids = favorite
                ? view.favoriteDocumentIds.filter((id) => id !== documentSummary.documentId)
                : [...view.favoriteDocumentIds, documentSummary.documentId];
            persistReaderLibraryView({ favoriteDocumentIds: ids });
            renderReaderLibrary();
        });
        const shelfSelect = document.createElement('select');
        shelfSelect.className = 'desktop-reader-tool';
        shelfSelect.setAttribute('aria-label', '将书籍加入自定义书架');
        const selectedShelf = (view.shelves || []).find((shelf) => shelf.documentIds.includes(documentSummary.documentId));
        [['', '加入书架'], ...(view.shelves || []).map((shelf) => [shelf.shelfId, shelf.title])].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            shelfSelect.appendChild(option);
        });
        shelfSelect.value = selectedShelf ? selectedShelf.shelfId : '';
        shelfSelect.addEventListener('change', () => {
            const shelves = (view.shelves || []).map((shelf) => ({
                ...shelf,
                documentIds: shelf.documentIds.filter((id) => id !== documentSummary.documentId)
            }));
            const target = shelves.find((shelf) => shelf.shelfId === shelfSelect.value);
            if (target) target.documentIds.push(documentSummary.documentId);
            persistReaderLibraryView({ shelves });
            renderReaderLibrary();
        });
        const remove = readerLibraryElement('button', 'desktop-reader-tool', '移出');
        remove.type = 'button';
        remove.addEventListener('click', () => {
            persistReaderLibraryView({ hiddenDocumentIds: [...view.hiddenDocumentIds, documentSummary.documentId] });
            renderReaderLibrary();
        });
        actions.append(open, detail, favoriteButton, shelfSelect, remove);
        body.append(
            readerLibraryElement('span', 'desktop-reader-card-eyebrow', readerLibrarySource(documentSummary)),
            readerLibraryElement('h3', '', documentSummary.title || '未命名文档'),
            readerLibraryElement('p', 'desktop-reader-library-meta', String(documentSummary.chapterCount || 0) + ' 章 · ' + Number(documentSummary.characterCount || 0).toLocaleString() + ' 字 · ' + String(documentSummary.revisionCount || 1) + ' 个版本'),
            progressWrap,
            actions
        );
        card.append(cover, body);
        return card;
    }

    function renderReaderLibrary() {
        const container = document.querySelector('[data-reader-library]');
        if (!container) return;
        container.replaceChildren();
        const api = window.DraftHarborReaderLibraryView;
        const view = readerCurrentLibraryView();
        const documents = api && api.sortReaderLibraryDocuments
            ? api.sortReaderLibraryDocuments(readerState.libraryDocuments, view)
            : readerState.libraryDocuments.slice();
        renderReaderLibraryToolbar(container, documents);
        if (!documents.length) {
            const empty = readerLibraryElement('div', 'desktop-reader-library-empty');
            const hasDocuments = readerState.libraryDocuments.length > 0;
            empty.append(
                readerLibraryElement('strong', '', hasDocuments ? '没有符合条件的书籍' : '书库还是空的'),
                readerLibraryElement('p', '', hasDocuments ? '可以清空搜索或切换来源筛选。' : '导入一本 txt / md 文档，或先从项目作品开始阅读。')
            );
            if (hasDocuments) {
                const reset = readerLibraryElement('button', 'desktop-secondary-action', '清除筛选');
                reset.type = 'button';
                reset.addEventListener('click', () => {
                    persistReaderLibraryView({ query: '', sourceFilter: 'all', selectedShelfId: '' });
                    renderReaderLibrary();
                });
                empty.appendChild(reset);
            }
            container.appendChild(empty);
            return;
        }
        const candidate = documents.find((item) => item.reading && item.reading.hasState);
        if (candidate) {
            const continueSection = readerLibraryElement('section', 'desktop-reader-library-section');
            const action = readerLibraryElement('button', 'desktop-primary-action', '继续阅读');
            action.type = 'button';
            action.addEventListener('click', () => openReaderLibraryDocument(candidate.documentId));
            const progress = readerLibraryProgress(candidate);
            continueSection.append(
                readerLibraryElement('h4', '', '继续阅读'),
                readerLibraryElement('h3', '', candidate.title || '未命名文档'),
                readerLibraryElement('p', 'desktop-reader-hint', readerLibrarySource(candidate) + ' · 已读 ' + String(progress) + '%'),
                action
            );
            container.appendChild(continueSection);
        }
        const section = readerLibraryElement('section', 'desktop-reader-library-section');
        if (candidate) section.appendChild(readerLibraryElement('h4', '', '全部书籍'));
        const grid = readerLibraryElement('div', 'desktop-reader-library-grid' + (view.viewMode === 'list' ? ' is-list' : ''));
        documents.forEach((item) => grid.appendChild(renderReaderLibraryCard(item, view)));
        section.appendChild(grid);
        container.appendChild(section);
    }

    async function openReaderLibraryDetail(documentId) {
        const dialog = document.querySelector('[data-reader-detail-dialog]');
        const body = document.querySelector('[data-reader-detail-body]');
        const title = document.querySelector('[data-reader-detail-title]');
        const summary = readerState.libraryDocuments.find((item) => item.documentId === documentId);
        if (!dialog || !body || !title || !summary) return;
        readerState.libraryDetailDocumentId = documentId;
        title.textContent = summary.title || '书籍详情';
        body.replaceChildren(readerLibraryElement('p', 'desktop-reader-hint', '正在读取书籍详情…'));
        if (!dialog.open) dialog.showModal();
        try {
            const metadata = (await readerApi('/api/reader/document?documentId=' + encodeURIComponent(documentId))).metadata || summary;
            const contents = (await readerApi('/api/reader/contents?documentId=' + encodeURIComponent(documentId) + '&revisionId=' + encodeURIComponent(metadata.activeRevisionId || ''))).contents || {};
            const facts = readerLibraryElement('dl', 'desktop-reader-detail-facts');
            [['来源', readerLibrarySource(summary)], ['格式', summary.format === 'project' ? '项目投影' : String(summary.format || '本地文本').toUpperCase()], ['章节', String(summary.chapterCount || (contents.chapters && contents.chapters.length) || 0) + ' 章'], ['字数', Number(summary.characterCount || 0).toLocaleString() + ' 字'], ['版本', String(summary.revisionCount || (metadata.revisions && metadata.revisions.length) || 1) + ' 个'], ['状态', summary.reading && summary.reading.hasState ? '已读 ' + readerLibraryProgress(summary) + '%' : '未开始']].forEach(([label, value]) => {
                facts.append(readerLibraryElement('dt', '', label), readerLibraryElement('dd', '', value));
            });
            const chapters = readerLibraryElement('ol', 'desktop-reader-detail-chapters');
            (Array.isArray(contents.chapters) ? contents.chapters : []).slice(0, 20).forEach((chapter) => chapters.appendChild(readerLibraryElement('li', '', chapter.title || '未命名章节')));
            body.replaceChildren(facts, readerLibraryElement('h3', 'desktop-reader-detail-subtitle', '目录预览'), chapters, readerLibraryElement('p', 'desktop-reader-hint', summary.sourceKind === 'project' ? '项目作品为只读投影，正文仍由 Writer 项目管理。' : '正文保存在 Reader Store，详情页不会暴露正文。'));
            const open = document.querySelector('[data-reader-detail-open]');
            if (open) open.textContent = summary.reading && summary.reading.hasState ? '继续阅读' : '开始阅读';
            const reimport = document.querySelector('[data-reader-detail-reimport]');
            if (reimport) reimport.hidden = summary.sourceKind === 'project';
        } catch (error) {
            body.replaceChildren(readerLibraryElement('p', 'desktop-reader-hint', '详情暂不可用：' + (error.message || error)));
        }
    }

    function closeReaderLibraryDetail() {
        const dialog = document.querySelector('[data-reader-detail-dialog]');
        if (dialog && dialog.open) dialog.close();
        readerState.libraryDetailDocumentId = '';
    }

    function initializeReaderLibraryDetail() {
        document.querySelector('[data-reader-detail-close]')?.addEventListener('click', closeReaderLibraryDetail);
        document.querySelector('[data-reader-detail-open]')?.addEventListener('click', () => {
            const documentId = readerState.libraryDetailDocumentId;
            closeReaderLibraryDetail();
            if (documentId) openReaderLibraryDocument(documentId);
        });
        document.querySelector('[data-reader-detail-reimport]')?.addEventListener('click', () => {
            const summary = readerState.libraryDocuments.find((item) => item.documentId === readerState.libraryDetailDocumentId);
            if (!summary || summary.sourceKind === 'project') return;
            readerState.reimportDocumentId = summary.documentId;
            closeReaderLibraryDetail();
            document.querySelector('[data-reader-file]')?.click();
        });
        document.querySelector('[data-reader-detail-remove]')?.addEventListener('click', () => {
            const documentId = readerState.libraryDetailDocumentId;
            closeReaderLibraryDetail();
            if (documentId) {
                persistReaderLibraryView({ hiddenDocumentIds: [...readerCurrentLibraryView().hiddenDocumentIds, documentId] });
                renderReaderLibrary();
            }
        });
    }

    async function loadReaderLibrary() {
        const container = document.querySelector('[data-reader-library]');
        try {
            const results = await Promise.all([readerApi('/api/reader/documents'), readerApi('/api/reader/library-view')]);
            const documentsPayload = results[0];
            const viewPayload = results[1];
            readerState.libraryDocuments = Array.isArray(documentsPayload.documents) ? documentsPayload.documents : [];
            readerState.libraryIndexVersion = documentsPayload.index && Number(documentsPayload.index.version) || 0;
            readerState.libraryViewRecord = viewPayload.record;
            readerState.libraryView = viewPayload.record && viewPayload.record.view || readerCurrentLibraryView();
            renderReaderLibrary();
            return readerState.libraryDocuments;
        } catch (error) {
            if (container) container.textContent = '书库载入失败：' + (error.message || error);
            return [];
        }
    }

    window.initializeReaderLibraryDetail = initializeReaderLibraryDetail;
