    async function readerApi(path, options) {
        const response = await fetch(path, options);
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || '阅读器请求失败');
        return payload;
    }

    function renderReaderLibrary() {
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

    async function loadReaderLibrary() {
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
