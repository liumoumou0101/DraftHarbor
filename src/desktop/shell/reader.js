    function readerElements() {
        return {
            file: document.querySelector('[data-reader-file]'),
            fontSize: document.querySelector('[data-reader-font-size]'),
            lineHeight: document.querySelector('[data-reader-line-height]'),
            textWidth: document.querySelector('[data-reader-width]'),
            paragraphSpacing: document.querySelector('[data-reader-paragraph-spacing]'),
            fontFamily: document.querySelector('[data-reader-font-family]'),
            indent: document.querySelector('[data-reader-indent]'),
            theme: document.querySelector('[data-reader-theme]'),
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
            next: document.querySelector('[data-reader-next]')
        };
    }

    function readerDocumentTitle(fileName) {
        return String(fileName || '本地小说').replace(/\.(txt|md|markdown)$/i, '') || '本地小说';
    }

    function parseReaderChapters(text, fileName) {
        const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
        if (!normalized) {
            return {
                title: readerDocumentTitle(fileName),
                chapters: []
            };
        }

        const headingPattern = /^(?:#{1,3}\s+.+|第[零〇一二三四五六七八九十百千万\d]+[章节卷部集回].*|Chapter\s+\d+.*)$/i;
        const lines = normalized.split('\n');
        const chapters = [];
        let current = {
            title: readerDocumentTitle(fileName),
            lines: []
        };
        let foundHeading = false;

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (headingPattern.test(trimmed)) {
                if (foundHeading || current.lines.some((item) => item.trim())) {
                    chapters.push(current);
                }
                foundHeading = true;
                current = {
                    title: trimmed.replace(/^#{1,3}\s+/, '').trim() || `第 ${chapters.length + 1} 章`,
                    lines: []
                };
                return;
            }
            current.lines.push(line);
        });

        if (current.lines.some((line) => line.trim()) || !chapters.length) {
            chapters.push(current);
        }

        return {
            title: readerDocumentTitle(fileName),
            chapters: chapters.map((chapter, index) => ({
                id: `chapter-${index + 1}`,
                title: chapter.title || `第 ${index + 1} 章`,
                content: chapter.lines.join('\n').trim()
            })).filter((chapter) => chapter.title || chapter.content)
        };
    }

    function snapshotToReaderDocument(snapshot) {
        const project = snapshot && snapshot.project;
        if (!project || !project.id) return null;

        const chapters = Array.isArray(snapshot.chapters) ? [...snapshot.chapters] : [];
        const scenes = Array.isArray(snapshot.scenes) ? [...snapshot.scenes] : [];
        const sceneContents = snapshot.sceneContents && typeof snapshot.sceneContents === 'object'
            ? snapshot.sceneContents
            : {};

        if (window.DraftHarborReaderDocument && typeof window.DraftHarborReaderDocument.projectToReaderDocument === 'function') {
            try {
                const coreProject = {
                    id: String(project.id),
                    title: project.name || project.title || '当前作品',
                    chapters: chapters.map((chapter) => ({
                        id: chapter.id,
                        title: chapter.title,
                        order: chapter.order || 0
                    })),
                    scenes: scenes.map((scene) => ({
                        id: scene.id,
                        chapterId: scene.chapterId,
                        title: scene.title,
                        order: scene.order || 0,
                        content: String(sceneContents[scene.id] || '')
                    }))
                };
                const documentData = window.DraftHarborReaderDocument.projectToReaderDocument(coreProject);
                return {
                    source: 'project',
                    projectId: String(project.id),
                    title: documentData.title,
                    fileName: `${documentData.title || 'project'}.draftharbor`,
                    importedAt: snapshot.filesystemSavedAt || snapshot.exportedAt || new Date().toISOString(),
                    chapters: (documentData.chapters || []).map((chapter) => ({
                        id: chapter.id,
                        title: chapter.title,
                        content: (chapter.paragraphs || []).map((paragraph) => paragraph.text || '').filter(Boolean).join('\n\n')
                    }))
                };
            } catch (error) {
                console.warn('Core reader document conversion failed, falling back:', error);
            }
        }

        const sortedChapters = chapters.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const sortedScenes = scenes.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const readerChapters = sortedChapters.map((chapter, index) => {
            const chapterScenes = sortedScenes.filter((scene) => scene.chapterId === chapter.id);
            const content = chapterScenes.map((scene) => {
                const text = String(sceneContents[scene.id] || '').trim();
                if (!text) return '';
                return chapterScenes.length > 1 ? `${scene.title || '场景'}\n\n${text}` : text;
            }).filter(Boolean).join('\n\n');

            return {
                id: chapter.id || `project-chapter-${index + 1}`,
                title: chapter.title || `第 ${index + 1} 章`,
                content
            };
        }).filter((chapter) => chapter.title || chapter.content);

        if (!readerChapters.length && sortedScenes.length) {
            readerChapters.push({
                id: 'project-scenes',
                title: project.name || '当前作品',
                content: sortedScenes.map((scene) => String(sceneContents[scene.id] || '').trim()).filter(Boolean).join('\n\n')
            });
        }

        return {
            source: 'project',
            projectId: String(project.id),
            title: project.name || '当前作品',
            fileName: `${project.name || 'project'}.draftharbor`,
            importedAt: snapshot.filesystemSavedAt || snapshot.exportedAt || new Date().toISOString(),
            chapters: readerChapters
        };
    }

    function loadReaderFromProjectSnapshot(snapshot, options = {}) {
        const documentData = snapshotToReaderDocument(snapshot);
        if (!documentData) return false;

        const previous = readerState.document;
        const sameProject = previous && previous.source === 'project' && previous.projectId === documentData.projectId;
        readerState.document = documentData;
        readerState.chapterIndex = sameProject ? readerState.chapterIndex : 0;
        saveReaderState();
        renderReader();

        if (options.showReader) setView('reader');
        return true;
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
        if (readerState.fontFamily === 'serif') {
            return '"SimSun", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif';
        }
        if (readerState.fontFamily === 'yahei') {
            return '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif';
        }
        return '"Microsoft YaHei", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    }

    function updateReaderProgress() {
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
                readerState.fontFamily = saved.fontFamily || readerState.fontFamily;
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

    function clampReaderChapter() {
        const total = readerState.document ? readerState.document.chapters.length : 0;
        if (!total) {
            readerState.chapterIndex = 0;
            return;
        }
        readerState.chapterIndex = Math.max(0, Math.min(total - 1, readerState.chapterIndex));
    }

    function applyReaderSettings() {
        const elements = readerElements();
        if (elements.fontSize) elements.fontSize.value = String(readerState.fontSize);
        if (elements.lineHeight) elements.lineHeight.value = String(readerState.lineHeight);
        if (elements.textWidth) elements.textWidth.value = String(readerState.textWidth);
        if (elements.paragraphSpacing) elements.paragraphSpacing.value = String(readerState.paragraphSpacing);
        if (elements.fontFamily) elements.fontFamily.value = readerState.fontFamily;
        if (elements.indent) elements.indent.checked = !!readerState.indent;
        if (elements.theme) elements.theme.value = readerState.theme;
        if (elements.themePanel) {
            elements.themePanel.dataset.readerTheme = readerState.theme;
            elements.themePanel.dataset.readerIndentEnabled = readerState.indent ? 'true' : 'false';
            elements.themePanel.style.setProperty('--reader-font-size', `${readerState.fontSize}px`);
            elements.themePanel.style.setProperty('--reader-line-height', String(readerState.lineHeight));
            elements.themePanel.style.setProperty('--reader-width', `${readerState.textWidth}px`);
            elements.themePanel.style.setProperty('--reader-paragraph-spacing', `${readerState.paragraphSpacing}em`);
            elements.themePanel.style.setProperty('--reader-font-family', readerFontStack());
        }
    }

    function renderReader() {
        clampReaderChapter();
        applyReaderSettings();
        const elements = readerElements();
        if (!elements.content) return;

        const documentData = readerState.document;
        const chapters = documentData ? documentData.chapters : [];
        const chapter = chapters[readerState.chapterIndex];

        if (!documentData || !chapters.length || !chapter) {
            if (elements.title) elements.title.textContent = '还没有导入本地小说';
            if (elements.source) elements.source.textContent = 'Reader';
            if (elements.content) {
                elements.content.replaceChildren();
                const empty = document.createElement('p');
                empty.textContent = '选择左侧的 txt 或 md 文件后，这里会显示正文。阶段 1 先提供本地导入、章节识别、进度和排版控制。';
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

    function readReaderFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('请选择 txt 或 md 文件'));
                return;
            }
            const name = String(file.name || '');
            const isSupported = /\.(txt|md|markdown)$/i.test(name) || /^text\//.test(file.type || '');
            if (!isSupported) {
                reject(new Error('阅读器暂时只支持 txt / md 文件'));
                return;
            }
            if (file.size > 5000000) {
                reject(new Error('文件不能超过 5MB'));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file, 'utf-8');
        });
    }

    async function importReaderFile(file) {
        const text = await readReaderFile(file);
        const parsed = parseReaderChapters(text, file.name);
        readerState.document = {
            title: parsed.title,
            fileName: file.name,
            importedAt: new Date().toISOString(),
            chapters: parsed.chapters
        };
        readerState.chapterIndex = 0;
        saveReaderState();
        renderReader();
    }
