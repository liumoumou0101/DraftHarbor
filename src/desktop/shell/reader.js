    function readerElements() {
        return {
            file: document.querySelector('[data-reader-file]'),
            fontSize: document.querySelector('[data-reader-font-size]'),
            lineHeight: document.querySelector('[data-reader-line-height]'),
            textWidth: document.querySelector('[data-reader-width]'),
            paragraphSpacing: document.querySelector('[data-reader-paragraph-spacing]'),
            fontFamily: document.querySelector('[data-reader-font-family]'),
            indent: document.querySelector('[data-reader-indent]'),
            theme: document.querySelector('select[data-reader-theme]'),
            themePanel: document.querySelector('[data-reader-theme-panel]'),
            title: document.querySelector('[data-reader-title]'),
            source: document.querySelector('[data-reader-source]'),
            content: document.querySelector('[data-reader-content]'),
            chapters: document.querySelector('[data-reader-chapters]'),
            progress: document.querySelector('[data-reader-progress]'),
            progressLabel: document.querySelector('[data-reader-progress-label]'),
            progressPercent: document.querySelector('[data-reader-progress-percent]'),
            positionLabel: document.querySelector('[data-reader-position-label]'),
            prev: document.querySelector('[data-reader-prev]'),
            next: document.querySelector('[data-reader-next]'),
            migration: document.querySelector('[data-reader-migration]'),
            migrationMessage: document.querySelector('[data-reader-migration-message]'),
            migrationActions: document.querySelector('[data-reader-migration-actions]'),
            migrationConfirm: document.querySelector('[data-reader-migration-confirm]'),
            migrationAbandon: document.querySelector('[data-reader-migration-abandon]'),
            shell: document.querySelector('[data-reader-shell]'),
            library: document.querySelector('[data-reader-library]'),
            leftDrawer: document.querySelector('[data-reader-left-drawer]'),
            settingsDrawer: document.querySelector('[data-reader-settings-drawer]')
        };
    }
    function readerParagraphs(content) {
        const blocks = String(content || '').split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean);
        if (blocks.length) return blocks;
        return String(content || '').split('\n').map((line) => line.trim()).filter(Boolean);
    }

    function readerDocumentKey() {
        const documentData = readerState.document || {};
        return documentData.source === 'project'
            ? `project:${documentData.projectId || documentData.title || ''}`
            : `file:${documentData.fileName || documentData.title || ''}`;
    }

    function readerChapterKey(index = readerState.chapterIndex) {
        const chapters = readerState.document ? readerState.document.chapters || [] : [];
        const chapter = chapters[index] || {};
        return `${readerDocumentKey()}:${chapter.id || index}`;
    }

    function readerScrollRatio() {
        const { content } = readerElements();
        if (!content) return 0;
        const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
        if (maxScroll <= 0) return 0;
        return Math.max(0, Math.min(1, content.scrollTop / maxScroll));
    }

    function rememberReaderScroll() {
        if (!readerState.document) return;
        readerState.scrollPositions[readerChapterKey()] = readerScrollRatio();
        saveReaderState();
    }

    function restoreReaderScroll() {
        const { content } = readerElements();
        if (!content || !readerState.document) return;
        const ratio = Number(readerState.scrollPositions[readerChapterKey()] || 0);
        window.requestAnimationFrame(() => {
            const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
            content.scrollTop = maxScroll * Math.max(0, Math.min(1, ratio));
            updateReaderProgress();
        });
    }

    function readerFontStack() {
        if (typeof window.readerFontResolution === 'function') {
            const managed = window.readerFontResolution(readerState.fontId || 'builtin:default');
            if (managed?.actual) {
                readerState.actualFontFamily = managed.actual.family;
                readerState.fontFallback = managed.fallback;
                readerState.fontCatalogVersion = managed.actual.catalogVersion || readerState.fontCatalogVersion || 1;
                return managed.actual.family;
            }
        }
        const providerApi = window.DraftHarborReaderFontProvider;
        if (providerApi && typeof providerApi.createReaderFontProvider === 'function') {
            if (!readerFontStack.provider) readerFontStack.provider = providerApi.createReaderFontProvider();
            const resolved = readerFontStack.provider.resolve(readerState.fontId || 'builtin:default');
            readerState.actualFontFamily = resolved.actual.displayName || resolved.actual.family;
            readerState.fontFallback = resolved.fallback;
            readerState.fontCatalogVersion = readerFontStack.provider.snapshot().catalogVersion;
            return resolved.actual.family;
        }
        if (readerState.fontFamily === 'serif') {
            return '"SimSun", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif';
        }
        if (readerState.fontFamily === 'sans-serif') {
            return '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif';
        }
        if (readerState.fontFamily === 'kai') {
            return '"KaiTi", "STKaiti", "Kaiti SC", "Noto Serif CJK SC", serif';
        }
        return '"Microsoft YaHei", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    }

    function updateReaderProgress() {
        if (readerState.apiMode && typeof updateReaderWorkspaceProgress === 'function') {
            updateReaderWorkspaceProgress();
            return;
        }
        const elements = readerElements();
        const chapters = readerState.document ? readerState.document.chapters || [] : [];
        if (!chapters.length) return;
        const chapterRatio = readerScrollRatio();
        const overall = Math.round(((readerState.chapterIndex + chapterRatio) / chapters.length) * 100);
        const chapterPercent = Math.round(chapterRatio * 100);
        if (elements.progress) elements.progress.value = Math.max(1, Math.min(100, overall || 1));
        if (elements.progressPercent) elements.progressPercent.textContent = `${Math.max(1, Math.min(100, overall || 1))}%`;
        if (elements.positionLabel) {
            elements.positionLabel.textContent = `本章 ${chapterPercent}% / 全书 ${Math.max(1, Math.min(100, overall || 1))}%`;
        }
    }

    function saveReaderState() {
        try {
            if (readerState.apiMode) {
                localStorage.removeItem(READER_STORAGE_KEY);
                return;
            }
            localStorage.setItem(READER_STORAGE_KEY, JSON.stringify({
                document: readerState.document,
                chapterIndex: readerState.chapterIndex,
                fontSize: readerState.fontSize,
                lineHeight: readerState.lineHeight,
                theme: readerState.theme,
                fontFamily: readerState.fontFamily,
                textWidth: readerState.textWidth,
                paragraphSpacing: readerState.paragraphSpacing,
                indent: readerState.indent,
                scrollPositions: readerState.scrollPositions
            }));
        } catch (error) {
            console.warn('Failed to save reader state:', error);
        }
    }

    function loadReaderState() {
        try {
            const saved = JSON.parse(localStorage.getItem(READER_STORAGE_KEY) || '{}');
            if (saved && typeof saved === 'object') {
                readerState.document = saved.document && Array.isArray(saved.document.chapters) ? saved.document : null;
                readerState.chapterIndex = Number(saved.chapterIndex) || 0;
                readerState.fontSize = Number(saved.fontSize) || readerState.fontSize;
                readerState.lineHeight = Number(saved.lineHeight) || readerState.lineHeight;
                readerState.theme = saved.theme || readerState.theme;
                readerState.fontFamily = saved.fontFamily === 'yahei' ? 'sans-serif' : saved.fontFamily || readerState.fontFamily;
                readerState.textWidth = Number(saved.textWidth) || readerState.textWidth;
                readerState.paragraphSpacing = Number(saved.paragraphSpacing) || readerState.paragraphSpacing;
                readerState.indent = typeof saved.indent === 'boolean' ? saved.indent : readerState.indent;
                readerState.scrollPositions = saved.scrollPositions && typeof saved.scrollPositions === 'object'
                    ? saved.scrollPositions
                    : {};
            }
        } catch (error) {
            console.warn('Failed to load reader state:', error);
        }
    }

    async function migrateLegacyReaderState(externalAction = '') {
        const raw = localStorage.getItem(READER_STORAGE_KEY);
        if (!raw) return null;
        const elements = readerElements();
        try {
            const response = await fetch('/api/reader/migration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ legacyRaw: raw, externalAction })
            });
            const payload = await response.json();
            const migration = payload && payload.migration;
            if (!response.ok || !migration) throw new Error(payload.error || '旧阅读数据迁移失败');
            if (elements.migration) elements.migration.hidden = migration.status === 'complete';
            if (elements.migrationActions) elements.migrationActions.hidden = migration.status !== 'pending-external';
            if (elements.migrationMessage) {
                elements.migrationMessage.textContent = migration.status === 'pending-external'
                    ? `检测到“${migration.externalSummary && migration.externalSummary.title || '旧外部文档'}”。确认加入新版书库，或仅放弃旧正文。`
                    : migration.status === 'failed'
                        ? '旧阅读数据暂未迁移，将在下次启动时重试。'
                        : '';
            }
            if (migration.status === 'complete' && migration.canClearLegacyState) {
                localStorage.removeItem(READER_STORAGE_KEY);
            }
            if (migration.status === 'complete' && typeof loadReaderLibrary === 'function') {
                loadReaderLibrary().then(() => {
                    if (migration.reason === 'external-imported' && migration.documentId && typeof openReaderLibraryDocument === 'function') {
                        openReaderLibraryDocument(migration.documentId);
                    }
                });
            }
            return migration;
        } catch (error) {
            if (elements.migration) elements.migration.hidden = false;
            if (elements.migrationActions) elements.migrationActions.hidden = true;
            if (elements.migrationMessage) elements.migrationMessage.textContent = '旧阅读数据暂未迁移，将在下次启动时重试。';
            console.warn('Failed to migrate legacy reader state:', error);
            return null;
        }
    }

    function clampReaderChapter() {
        const total = readerState.document ? readerState.document.chapters.length : 0;
        if (!total) {
            readerState.chapterIndex = 0;
            return;
        }
        readerState.chapterIndex = Math.max(0, Math.min(total - 1, readerState.chapterIndex));
    }

    function applyReaderSettings(options = {}) {
        const elements = readerElements();
        if (elements.fontSize) elements.fontSize.value = String(readerState.fontSize);
        if (elements.lineHeight) elements.lineHeight.value = String(readerState.lineHeight);
        if (elements.textWidth) elements.textWidth.value = String(readerState.textWidth);
        if (elements.paragraphSpacing) elements.paragraphSpacing.value = String(readerState.paragraphSpacing);
        if (elements.fontFamily) elements.fontFamily.value = readerState.fontFamily;
        if (elements.indent) elements.indent.checked = !!readerState.indent;
        if (elements.theme) elements.theme.value = readerState.theme;
        if (typeof syncReaderSettingsControls === 'function') syncReaderSettingsControls();
        if (elements.themePanel) {
            elements.themePanel.dataset.readerTheme = readerState.theme;
            elements.themePanel.dataset.readerIndentEnabled = readerState.indent ? 'true' : 'false';
            elements.themePanel.dataset.readerMaterial = readerState.paperMaterial || 'flat';
            elements.themePanel.dataset.readerPaperShadow = readerState.paperShadow === false ? 'false' : 'true';
            elements.themePanel.dataset.readerVignette = readerState.paperVignette === false ? 'false' : 'true';
            const themeApi = window.DraftHarborReaderTheme;
            try {
                const theme = themeApi && themeApi.createReaderTheme({ themeId: readerState.theme });
                if (theme && theme.tokens) {
                    Object.entries(theme.tokens).forEach(([key, value]) => elements.themePanel.style.setProperty(`--reader-${key}`, value));
                    const effect = String(theme.tokens.effect || '').replace(/^#/, '');
                    if (/^[0-9a-f]{6}$/i.test(effect)) {
                        const channels = [0, 2, 4].map((offset) => Number.parseInt(effect.slice(offset, offset + 2), 16));
                        elements.themePanel.style.setProperty('--reader-effect-rgb', channels.join(', '));
                    }
                }
            } catch (_) {
                // A user theme without a registered token set falls back to the last safe CSS theme.
            }
            elements.themePanel.style.setProperty('--reader-font-size', `${readerState.fontSize}px`);
            elements.themePanel.style.setProperty('--reader-font-weight', String(readerState.fontWeight || 400));
            elements.themePanel.style.setProperty('--reader-line-height', String(readerState.lineHeight));
            elements.themePanel.style.setProperty('--reader-width', `${readerState.textWidth}px`);
            elements.themePanel.style.setProperty('--reader-paragraph-spacing', `${readerState.paragraphSpacing}em`);
            elements.themePanel.style.setProperty('--reader-font-family', readerFontStack());
            elements.themePanel.style.setProperty('--reader-letter-spacing', `${readerState.letterSpacing || 0}em`);
            elements.themePanel.style.setProperty('--reader-page-margin', `${readerState.pageMargin || 48}px`);
            elements.themePanel.style.setProperty('--reader-text-align', readerState.textAlign || 'start');
        }
        if (options.reflow !== false && readerState.apiMode && typeof scheduleReaderReflow === 'function') scheduleReaderReflow();
    }

    function renderReader() {
        if (readerState.apiMode && typeof renderReaderWorkspace === 'function') {
            renderReaderWorkspace();
            return;
        }
        clampReaderChapter();
        applyReaderSettings();
        const elements = readerElements();
        if (!elements.content) return;

        const documentData = readerState.document;
        const chapters = documentData ? documentData.chapters : [];
        const chapter = chapters[readerState.chapterIndex];

        if (!documentData || !chapters.length || !chapter) {
            if (elements.title) elements.title.textContent = '选择一本书开始阅读';
            if (elements.source) elements.source.textContent = 'Reader';
            if (elements.content) {
                elements.content.replaceChildren();
                const empty = document.createElement('div');
                empty.className = 'desktop-reader-empty';
                const kicker = document.createElement('p');
                kicker.className = 'desktop-section-kicker';
                kicker.textContent = 'DraftHarbor Reader';
                const heading = document.createElement('h3');
                heading.textContent = '让正文成为唯一焦点';
                const detail = document.createElement('p');
                detail.textContent = '从书库选择已导入文档，或打开左侧面板导入 txt / md 文件。';
                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'desktop-primary-action';
                action.dataset.readerEmptyLibrary = '';
                action.textContent = '打开书库';
                empty.append(kicker, heading, detail, action);
                elements.content.appendChild(empty);
            }
            if (elements.chapters) elements.chapters.replaceChildren();
            if (elements.progress) elements.progress.value = 0;
            if (elements.progressLabel) elements.progressLabel.textContent = '未导入';
            if (elements.progressPercent) elements.progressPercent.textContent = '0%';
            if (elements.prev) elements.prev.disabled = true;
            if (elements.next) elements.next.disabled = true;
            return;
        }

        if (elements.title) elements.title.textContent = chapter.title;
        if (elements.source) elements.source.textContent = `${documentData.title} / ${readerState.chapterIndex + 1} / ${chapters.length}`;
        if (elements.progressLabel) elements.progressLabel.textContent = `${readerState.chapterIndex + 1} / ${chapters.length} 章`;
        if (elements.prev) elements.prev.disabled = readerState.chapterIndex <= 0;
        if (elements.next) elements.next.disabled = readerState.chapterIndex >= chapters.length - 1;

        elements.content.replaceChildren();
        const paragraphs = readerParagraphs(chapter.content);
        if (!paragraphs.length) {
            const empty = document.createElement('p');
            empty.textContent = '这一章暂时没有正文。';
            elements.content.appendChild(empty);
        } else {
            paragraphs.forEach((paragraph) => {
                const node = document.createElement('p');
                node.textContent = paragraph;
                elements.content.appendChild(node);
            });
        }

        if (elements.chapters) {
            elements.chapters.replaceChildren();
            chapters.forEach((item, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'desktop-reader-chapter';
                button.classList.toggle('is-active', index === readerState.chapterIndex);
                button.textContent = item.title || `第 ${index + 1} 章`;
                button.addEventListener('click', () => {
                    rememberReaderScroll();
                    readerState.chapterIndex = index;
                    saveReaderState();
                    renderReader();
                });
                elements.chapters.appendChild(button);
            });
        }

        restoreReaderScroll();
    }
