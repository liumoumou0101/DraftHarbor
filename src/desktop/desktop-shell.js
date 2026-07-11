(function () {
    const viewTitles = {
        bookshelf: '书库',
        writer: '写作',
        reader: '阅读',
        compendium: '资料',
        workshop: '讨论',
        workflow: '工作流',
        recovery: '恢复中心',
        settings: '设置'
    };
    const projectLibraryState = {
        projects: [],
        projectSaveLocation: '',
        query: '',
        sort: 'recent',
        editingProject: null,
        editingCoverImage: ''
    };
    const READER_STORAGE_KEY = 'draftharbor:desktop:reader';
    const NATIVE_EDITOR_PREFS_STORAGE_KEY = 'draftharbor:desktop:nativeEditorPrefs';
    const EXPORT_OPTIONS_STORAGE_KEY = 'draftharbor:desktop:nativeExportOptions';
    const TTS_VOICE_KEY = 'draftharbor:ttsVoice';
    const TTS_SPEED_KEY = 'draftharbor:ttsSpeed';
    const DESKTOP_THEME_KEY = 'draftharbor:desktop:theme';
    const DESKTOP_THEMES = new Set(['morandi-ink', 'mist-library', 'ash-rose']);
    const readerState = {
        document: null,
        chapterIndex: 0,
        fontSize: 18,
        lineHeight: 1.8,
        theme: 'dark',
        fontFamily: 'system',
        textWidth: 760,
        paragraphSpacing: 1.05,
        indent: true,
        scrollPositions: {}
    };
    const nativeEditorState = {
        snapshot: null,
        activeSceneId: '',
        activeChapterId: '',
        projectSource: '',
        searchQuery: '',
        searchMatchIndex: -1,
        searchMatchPositions: [],
        assistantPanel: 'generate',
        assistantPlacement: 'right',
        typographyOpen: false,
        editorPrefs: {
            fontSize: 18,
            lineHeight: 1.9,
            textWidth: 760,
            paragraphSpacing: 0,
            fontFamily: 'system',
            wordGoal: 0
        },
        titleEditing: false,
        titleEditingOriginal: '',
        focusMode: false,
        outlineCollapsed: false,
        assistantCollapsed: false,
        expandedChapterIds: new Set(),
        dirty: false,
        autosaveTimer: null,
        isSaving: false,
        generation: {
            beat: '',
            text: '',
            reasoning: '',
            prompt: null,
            record: null,
            aiTaskRecord: null,
            aiTaskTargetKey: '',
            inProgress: false,
            abortController: null,
            lastAcceptedSceneId: '',
            inlineBaseText: '',
            insertionStart: 0,
            insertionEnd: 0,
            pendingSceneId: '',
            task: 'fiction-prose',
            genTask: 'continue'
        },
        rewrite: {
            preset: 'balanced-polish',
            instruction: '',
            rewriteTask: 'polish',
            savedPromptId: '',
            originalText: '',
            selectionStart: 0,
            selectionEnd: 0,
            regenerateUseContext: true
        },
        context: {
            compendiumIds: [],
            compendiumTags: [],
            chapterModes: {},
            sceneModes: {}
        },
        tts: {
            reading: false,
            rate: 1
        },
        historySceneFilter: false
    };
    const promptState = {
        prompts: [],
        selectedId: 'default-prose'
    };
    const rewritePromptState = {
        prompts: [],
        selectedId: ''
    };
    const workshopState = {
        sessions: [],
        selectedId: '',
        input: '',
        generating: false,
        selectedAssistantMessageId: ''
    };
    const workflowState = {
        runs: [],
        selectedId: '',
        events: [],
        generating: false,
        generatedText: ''
    };
    const recoveryState = {
        backups: [],
        backupLocation: '',
        query: '',
        filter: 'all',
        selected: null,
        selectedBackup: null,
        selectedDiff: null
    };
    const compendiumState = {
        entries: [],
        selectedId: '',
        query: '',
        type: '',
        loading: false,
        dirty: false
    };
    const settingsState = {
        settings: null,
        runtimeProvider: null,
        runtimeProviderProfiles: null,
        storageLocations: null,
        loading: false,
        loadPromise: null,
        saving: false,
        activeSection: 'provider'
    };
    const profileEditState = {
        editingId: '',
        editingProfile: null
    };
    const profileTestState = {};
    const WRITER_MODEL_KEY = 'draftharbor:desktop:writerModelOverride';
    const writerModelOverride = {
        profileId: 'inherit',
        model: 'inherit',
        customModel: '',
        thinking: false
    };
    const shellUiState = {
        railCollapsed: false
    };

    function normalizeDesktopTheme(theme) {
        theme = String(theme || 'morandi-ink');
        return DESKTOP_THEMES.has(theme) ? theme : 'morandi-ink';
    }

    function applyDesktopTheme(theme) {
        theme = normalizeDesktopTheme(theme);
        var root = document.getElementById('desktop-root');
        document.documentElement.dataset.desktopTheme = theme;
        if (root) root.dataset.desktopTheme = theme;
        try {
            localStorage.setItem(DESKTOP_THEME_KEY, theme);
        } catch (e) { /* ignore */ }
    }

    function loadDesktopTheme() {
        var theme = 'morandi-ink';
        try {
            theme = localStorage.getItem(DESKTOP_THEME_KEY) || 'morandi-ink';
        } catch (e) { /* ignore */ }
        return normalizeDesktopTheme(theme);
    }

    function applyDesktopThemeFromStorage() {
        applyDesktopTheme(loadDesktopTheme());
    }

    function getState() {
        return window.DraftHarborDesktopState;
    }

    function setView(view) {
        const state = getState();
        const nextView = state ? state.normalizeView(view) : 'bookshelf';
        const root = document.getElementById('desktop-root');
        if (!root) return;

        root.dataset.view = nextView;
        root.classList.toggle('is-rail-collapsed', shellUiState.railCollapsed);

        document.querySelectorAll('[data-view-target]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.viewTarget === nextView);
        });

        document.querySelectorAll('[data-view-panel]').forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.viewPanel === nextView);
        });

        const title = document.getElementById('desktop-view-title');
        if (title) title.textContent = viewTitles[nextView] || '稿湾';
        const railToggle = document.querySelector('[data-toggle-rail]');
        if (railToggle) railToggle.textContent = shellUiState.railCollapsed ? '显示导航' : '隐藏导航';

        if (state) state.saveView(nextView);
        renderContextStrip();
    }

    function contextStripElements() {
        return {
            strip: document.querySelector('[data-context-strip]'),
            projectTitle: document.querySelector('[data-context-project-title]'),
            sceneTitle: document.querySelector('[data-context-scene-title]'),
            wordCount: document.querySelector('[data-context-word-count]'),
            compendiumSummary: document.querySelector('[data-context-compendium-summary]'),
            gotoWriter: document.querySelector('[data-context-goto-writer]'),
            gotoCompendium: document.querySelector('[data-context-goto-compendium]'),
            gotoWorkshop: document.querySelector('[data-context-goto-workshop]'),
            gotoBookshelf: document.querySelector('[data-context-goto-bookshelf]')
        };
    }

    function contextPolicyMode(entry) {
        if (entry && entry.alwaysInContext) return 'always';
        const policy = entry && entry.contextPolicy;
        const mode = policy && policy.mode;
        return ['disabled', 'manual', 'mention', 'auto', 'always'].includes(mode) ? mode : 'manual';
    }

    function contextPolicyLabel(entry) {
        return {
            always: '总是注入',
            auto: '条件注入',
            mention: '提及时注入',
            manual: '手动',
            disabled: '不自动注入'
        }[contextPolicyMode(entry)] || '手动';
    }

    function renderContextStrip() {
        const elements = contextStripElements();
        if (!elements.strip) return;
        const root = document.getElementById('desktop-root');
        const view = root && root.dataset.view ? root.dataset.view : 'bookshelf';
        const coreViews = new Set(['writer', 'compendium', 'workshop', 'workflow']);
        const projectId = currentProjectId();
        const scene = currentNativeScene();
        const content = scene ? nativeSceneContent(scene.id) : '';
        const entries = compendiumState.entries || [];
        const autoCount = entries.filter((entry) => !['manual', 'disabled'].includes(contextPolicyMode(entry))).length;

        elements.strip.hidden = !coreViews.has(view);
        if (elements.projectTitle) elements.projectTitle.textContent = projectId ? currentProjectName() : '未打开项目';
        if (elements.sceneTitle) elements.sceneTitle.textContent = scene ? `场景：${scene.title || '未命名场景'}` : (projectId ? '未选择场景' : '从书库打开项目');
        if (elements.wordCount) elements.wordCount.textContent = scene ? `${String(content || '').length} 字` : '';
        if (elements.compendiumSummary) {
            elements.compendiumSummary.textContent = projectId
                ? `资料 ${entries.length} 张${autoCount ? ` / 自动上下文 ${autoCount} 张` : ''}`
                : '请先打开项目';
        }
        if (elements.gotoBookshelf) elements.gotoBookshelf.hidden = !!projectId;
        [elements.gotoWriter, elements.gotoCompendium, elements.gotoWorkshop].forEach((button) => {
            if (button) button.disabled = !projectId;
        });
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
    }

    function formatDate(value) {
        if (!value) return '未知时间';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '未知时间';
        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function firstBookGlyph(name) {
        const text = String(name || '书').trim();
        return Array.from(text)[0] || '书';
    }

    function setProjectLibraryStatus(message, tone) {
        const status = document.querySelector('[data-project-library-status]');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone || 'info';
        status.hidden = !message;
    }

    function setProjectLibraryMeta(message) {
        const meta = document.querySelector('[data-project-library-meta]');
        if (meta) {
            meta.textContent = message || '';
            meta.title = message || '';
        }
    }

    function setProjectLibraryCount(message) {
        const count = document.querySelector('[data-project-library-count]');
        if (count) count.textContent = message || '—';
    }

    function setShelfStatus(message) {
        const status = document.querySelector('[data-project-library-meta-secondary]');
        if (!status) return;
        status.textContent = message || '';
        status.hidden = !message;
    }

    function createProjectCard(project) {
        const card = document.createElement('article');
        card.className = 'desktop-project-card';
        card.dataset.projectId = project.id || '';
        card.dataset.projectFilename = project.filename || '';
        card.dataset.projectSource = project.source || 'legacy-snapshot';
        card.title = project.name || '未命名项目';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');

        const cover = document.createElement('div');
        cover.className = 'desktop-project-cover';
        if (project.coverImage) {
            const image = document.createElement('img');
            image.src = project.coverImage;
            image.alt = '';
            cover.appendChild(image);
        } else {
            const glyph = document.createElement('span');
            glyph.className = 'desktop-project-cover-glyph';
            glyph.textContent = firstBookGlyph(project.name);
            cover.appendChild(glyph);
        }

        const body = document.createElement('div');
        body.className = 'desktop-project-card-body';

        const name = document.createElement('strong');
        name.className = 'desktop-project-card-name';
        name.textContent = project.name || '未命名项目';

        const badges = document.createElement('div');
        badges.className = 'desktop-project-badges';
        const sourceBadge = document.createElement('span');
        sourceBadge.className = 'desktop-project-badge desktop-project-source-badge';
        sourceBadge.dataset.projectSourceBadge = project.source || 'legacy-snapshot';
        sourceBadge.textContent = project.source === 'project-directory' ? '项目目录' : '旧快照';
        badges.appendChild(sourceBadge);
        if (project.status) {
            const status = document.createElement('span');
            status.className = 'desktop-project-badge';
            status.textContent = project.status;
            badges.appendChild(status);
        }
        (project.tags || []).slice(0, 3).forEach((tag) => {
            const tagBadge = document.createElement('span');
            tagBadge.className = 'desktop-project-badge';
            tagBadge.textContent = tag;
            badges.appendChild(tagBadge);
        });

        const description = document.createElement('p');
        description.className = 'desktop-project-description';
        description.textContent = project.description || '还没有简介。';

        const stats = document.createElement('div');
        stats.className = 'desktop-project-stats';
        stats.innerHTML = [
            `<span class="desktop-project-stat"><span class="desktop-project-stat-value">${formatNumber(project.wordCount)}</span><span class="desktop-project-stat-label">字</span></span>`,
            `<span class="desktop-project-stat"><span class="desktop-project-stat-value">${formatNumber(project.chapterCount)}</span><span class="desktop-project-stat-label">章</span></span>`,
            `<span class="desktop-project-stat"><span class="desktop-project-stat-value">${formatNumber(project.sceneCount)}</span><span class="desktop-project-stat-label">场</span></span>`
        ].join('');

        const time = document.createElement('time');
        time.className = 'desktop-project-time';
        time.textContent = formatDate(project.timestamp);
        time.dateTime = project.timestamp || '';

        const path = document.createElement('small');
        path.className = 'desktop-project-path';
        path.textContent = project.health === 'invalid' ? `文件异常：${project.healthMessage || '无法读取'}` : (project.filename || project.path || '');
        if (project.health === 'invalid') path.dataset.tone = 'error';

        const actions = document.createElement('div');
        actions.className = 'desktop-project-actions';

        const continueButton = document.createElement('button');
        continueButton.type = 'button';
        continueButton.className = 'desktop-project-continue';
        continueButton.textContent = '继续写作';
        continueButton.dataset.projectContinue = '';
        continueButton.addEventListener('click', (event) => {
            event.stopPropagation();
            card.setAttribute('aria-disabled', 'true');
            try {
                openDesktopProject(project).catch((error) => {
                    console.error('Failed to open desktop project:', error);
                    setProjectLibraryStatus(`打开失败：${error.message || error}`, 'error');
                }).finally(() => {
                    card.removeAttribute('aria-disabled');
                });
            } catch (error) {
                console.error('Failed to open desktop project:', error);
                setProjectLibraryStatus(`打开失败：${error.message || error}`, 'error');
                card.removeAttribute('aria-disabled');
            }
        });
        actions.appendChild(continueButton);

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'desktop-mini-action';
        editButton.textContent = '编辑信息';
        editButton.addEventListener('click', (event) => {
            event.stopPropagation();
            openProjectEditor(project);
        });
        actions.appendChild(editButton);

        const moreButton = document.createElement('button');
        moreButton.type = 'button';
        moreButton.className = 'desktop-mini-action desktop-project-more-toggle';
        moreButton.textContent = '更多';
        moreButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const drawer = actions.querySelector('[data-project-more-drawer]');
            if (drawer) {
                const hidden = !drawer.hidden;
                drawer.hidden = hidden;
                moreButton.classList.toggle('is-expanded', !hidden);
                moreButton.textContent = hidden ? '更多' : '收起';
            }
        });

        const moreDrawer = document.createElement('div');
        moreDrawer.className = 'desktop-project-more-drawer';
        moreDrawer.hidden = true;
        moreDrawer.dataset.projectMoreDrawer = '';

        const revealButton = document.createElement('button');
        revealButton.type = 'button';
        revealButton.className = 'desktop-mini-action';
        revealButton.textContent = '定位文件';
        revealButton.dataset.action = 'reveal-file';
        revealButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            await revealProjectFile(project);
        });

        const copyPathButton = document.createElement('button');
        copyPathButton.type = 'button';
        copyPathButton.className = 'desktop-mini-action';
        copyPathButton.textContent = '复制路径';
        copyPathButton.dataset.action = 'copy-path';
        copyPathButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            await copyProjectPath(project);
        });

        const exportPackageButton = document.createElement('button');
        exportPackageButton.type = 'button';
        exportPackageButton.className = 'desktop-mini-action';
        exportPackageButton.textContent = '导出包';
        exportPackageButton.addEventListener('click', (event) => {
            event.stopPropagation();
            exportProjectPackage(project);
        });

        const backupButton = document.createElement('button');
        backupButton.type = 'button';
        backupButton.className = 'desktop-mini-action';
        backupButton.textContent = '备份';
        backupButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            await openProjectBackupSettings(project);
        });

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'desktop-mini-action desktop-mini-action-danger';
        removeButton.textContent = '移出书库';
        removeButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            await removeProjectFromLibrary(project);
        });

        moreDrawer.append(revealButton, copyPathButton, exportPackageButton, backupButton);

        actions.append(moreButton, moreDrawer);

        const removeRow = document.createElement('div');
        removeRow.className = 'desktop-project-remove-row';
        removeRow.appendChild(removeButton);

        body.append(name, badges, description, stats, time, path, actions, removeRow);
        card.append(cover, body);

        const openProject = async () => {
            card.setAttribute('aria-disabled', 'true');
            try {
                await openDesktopProject(project);
            } catch (error) {
                console.error('Failed to open desktop project:', error);
                setProjectLibraryStatus(`打开失败：${error.message || error}`, 'error');
            } finally {
                card.removeAttribute('aria-disabled');
            }
        };

        card.addEventListener('click', openProject);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openProject();
            }
        });

        return card;
    }

    function getFilteredProjects() {
        const query = projectLibraryState.query.trim().toLowerCase();
        const projects = projectLibraryState.projects.filter((project) => {
            if (!query) return true;
            return [
                project.name,
                project.filename,
                project.path,
                project.description,
                project.status,
                ...(project.tags || [])
            ].some((value) => String(value || '').toLowerCase().includes(query));
        });

        const sorted = [...projects];
        sorted.sort((a, b) => {
            if (projectLibraryState.sort === 'name') {
                return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
            }
            if (projectLibraryState.sort === 'words') {
                return (Number(b.wordCount) || 0) - (Number(a.wordCount) || 0);
            }
            if (projectLibraryState.sort === 'chapters') {
                return (Number(b.chapterCount) || 0) - (Number(a.chapterCount) || 0);
            }

            return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
        });

        return sorted;
    }

    function renderProjectLibrary() {
        const grid = document.querySelector('[data-project-grid]');
        if (!grid) return;

        grid.replaceChildren();
        const projects = getFilteredProjects();
        const total = projectLibraryState.projects.length;
        const projectSaveLocation = projectLibraryState.projectSaveLocation;

        setProjectLibraryCount(total === 0 ? '—' : `${total} 本作品`);
        setProjectLibraryMeta(projectSaveLocation ? `保存位置：${projectSaveLocation}` : '项目目录尚未建立');

        if (total === 0) {
            const status = document.querySelector('[data-project-library-status]');
            if (status) {
                status.dataset.tone = 'empty';
                status.hidden = false;
                status.replaceChildren();
                const msg = document.createElement('p');
                msg.className = 'desktop-library-status-text';
                msg.textContent = '还没有作品。开始你的创作之旅吧。';
                status.appendChild(msg);
                const actions = document.createElement('div');
                actions.className = 'desktop-library-status-actions';
                const newBtn = document.createElement('button');
                newBtn.className = 'desktop-primary-action';
                newBtn.type = 'button';
                newBtn.textContent = '新建作品';
                newBtn.addEventListener('click', (e) => { e.stopPropagation(); openProjectCreator(); });
                const importBtn = document.createElement('button');
                importBtn.className = 'desktop-secondary-action';
                importBtn.type = 'button';
                importBtn.textContent = '导入项目';
                importBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const input = document.querySelector('[data-import-project-snapshot-file]');
                    if (input) input.click();
                });
                actions.appendChild(newBtn);
                actions.appendChild(importBtn);
                status.appendChild(actions);
            }
            setShelfStatus('');
            return;
        }

        if (projects.length === 0) {
            setProjectLibraryStatus('没有找到匹配的作品。换个关键词试试，或者清空搜索框。', 'empty');
            setShelfStatus(`共 ${total} 本 · 已筛选`);
            return;
        }

        setProjectLibraryStatus('', 'ok');
        const shownText = projects.length === total ? `共 ${total} 本作品` : `显示 ${projects.length} / ${total} 本`;
        setShelfStatus(shownText);
        projects.forEach((project) => {
            grid.appendChild(createProjectCard(project));
        });
    }

    async function loadProjectLibrary() {
        setProjectLibraryStatus('正在读取项目...', 'info');
        try {
            const response = await fetch('/api/list-projects', { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            projectLibraryState.projects = result.projects || [];
            projectLibraryState.projectSaveLocation = result.projectSaveLocation || '';
            renderProjectLibrary();
        } catch (error) {
            console.warn('Failed to load desktop project library:', error);
            projectLibraryState.projects = [];
            projectLibraryState.projectSaveLocation = '';
            renderProjectLibrary();
            setProjectLibraryStatus(`读取书库失败：${error.message || error}`, 'error');
            setProjectLibraryCount('—');
            setProjectLibraryMeta('请确认桌面本地服务正在运行。');
        }
    }

    async function openProjectFolder() {
        setProjectLibraryStatus('正在打开项目目录...', 'info');
        try {
            const response = await fetch('/api/open-project-save-folder', { method: 'POST' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            setProjectLibraryStatus('', 'ok');
        } catch (error) {
            console.warn('Failed to open project folder:', error);
            setProjectLibraryStatus(`打开项目目录失败：${error.message || error}`, 'error');
        }
    }

    function parseTags(value) {
        return String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean);
    }

    async function revealProjectFile(project) {
        setProjectLibraryStatus('正在定位项目文件...', 'info');
        try {
            const response = await fetch('/api/reveal-project-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: project.id,
                    filename: project.filename
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            setProjectLibraryStatus('已在文件管理器中定位项目文件。', 'ok');
        } catch (error) {
            console.warn('Failed to reveal project file:', error);
            setProjectLibraryStatus(`定位项目文件失败：${error.message || error}`, 'error');
        }
    }

    async function copyProjectPath(project) {
        const path = project.absolutePath || project.path || project.filename || '';
        if (!path) {
            setProjectLibraryStatus('没有可复制的项目路径。', 'error');
            return;
        }

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(path);
            } else {
                const input = document.createElement('textarea');
                input.value = path;
                input.style.position = 'fixed';
                input.style.opacity = '0';
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                input.remove();
            }
            setProjectLibraryStatus('项目路径已复制。', 'ok');
        } catch (error) {
            console.warn('Failed to copy project path:', error);
            setProjectLibraryStatus(`复制路径失败：${error.message || error}`, 'error');
        }
    }

    function triggerDownload(url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function exportProjectPackage(project) {
        if (!project || !project.id) {
            setProjectLibraryStatus('没有可导出的项目。', 'error');
            return;
        }
        triggerDownload(`/api/export-project-package?${new URLSearchParams({ projectId: project.id }).toString()}`);
        setProjectLibraryStatus('项目包导出已开始。', 'ok');
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file);
        });
    }

    async function importProjectSnapshotFile(file) {
        if (!file) return;
        setProjectLibraryStatus('正在导入旧 JSON...', 'info');
        try {
            const snapshot = JSON.parse(await readFileAsText(file));
            const response = await fetch('/api/import-project-snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ snapshot })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadProjectLibrary();
            setProjectLibraryStatus(`已导入：${result.summary && result.summary.name ? result.summary.name : '旧项目'}`, 'ok');
        } catch (error) {
            console.warn('Failed to import project snapshot:', error);
            setProjectLibraryStatus(`导入旧 JSON 失败：${error.message || error}`, 'error');
        }
    }

    async function importProjectPackageFile(file) {
        if (!file) return;
        setProjectLibraryStatus('正在导入项目包...', 'info');
        try {
            const response = await fetch('/api/import-project-package', {
                method: 'POST',
                headers: { 'Content-Type': 'application/zip' },
                body: await file.arrayBuffer()
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadProjectLibrary();
            setProjectLibraryStatus(`已导入：${result.summary && result.summary.name ? result.summary.name : '项目包'}`, 'ok');
        } catch (error) {
            console.warn('Failed to import project package:', error);
            setProjectLibraryStatus(`导入项目包失败：${error.message || error}`, 'error');
        }
    }

    async function importWritingway1Files(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setProjectLibraryStatus('正在读取 Writingway 1 文件夹...', 'info');
        try {
            const payloadFiles = [];
            for (const file of files) {
                if (!/\.(json|html|txt)$/i.test(file.name)) continue;
                payloadFiles.push({
                    path: file.webkitRelativePath || file.name,
                    text: await readFileAsText(file)
                });
            }
            const response = await fetch('/api/import-writingway1', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: payloadFiles })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadProjectLibrary();
            setProjectLibraryStatus(`已导入 W1 项目：${result.chapterCount || 0} 章 / ${result.sceneCount || 0} 场`, 'ok');
        } catch (error) {
            console.warn('Failed to import Writingway 1 project:', error);
            setProjectLibraryStatus(`导入 W1 项目失败：${error.message || error}`, 'error');
        }
    }

    async function openProjectBackupSettings(project) {
        try {
            if (project) recoveryState.query = project.name || project.id || '';
            setView('recovery');
            await loadRecoveryList();
            setProjectLibraryStatus('已打开原生恢复中心。', 'ok');
        } catch (error) {
            console.warn('Failed to open project backup settings:', error);
            setProjectLibraryStatus(`打开恢复中心失败：${error.message || error}`, 'error');
        }
    }

    async function removeProjectFromLibrary(project) {
        const confirmed = window.confirm(`确定要把《${project.name || '未命名项目'}》移出书库吗？\n\n项目文件不会被删除，只会移动到项目目录下的 .removed-projects 文件夹。`);
        if (!confirmed) return;

        setProjectLibraryStatus('正在移出书库...', 'info');
        try {
            const response = await fetch('/api/remove-project-from-library', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: project.id,
                    filename: project.filename
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            await loadProjectLibrary();
            setProjectLibraryStatus('已移出书库，文件仍保留在 .removed-projects 文件夹。', 'ok');
        } catch (error) {
            console.warn('Failed to remove project from library:', error);
            setProjectLibraryStatus(`移出书库失败：${error.message || error}`, 'error');
        }
    }

    function projectEditorElements() {
        return {
            modal: document.querySelector('[data-project-edit-modal]'),
            form: document.querySelector('[data-project-edit-form]'),
            name: document.querySelector('[data-project-edit-name]'),
            status: document.querySelector('[data-project-edit-status]'),
            tags: document.querySelector('[data-project-edit-tags]'),
            description: document.querySelector('[data-project-edit-description]'),
            cover: document.querySelector('[data-project-edit-cover]'),
            coverPreview: document.querySelector('[data-project-edit-cover-preview]'),
            statusMessage: document.querySelector('[data-project-edit-status-message]')
        };
    }

    function renderCoverPreview(coverImage) {
        const { coverPreview } = projectEditorElements();
        if (!coverPreview) return;
        coverPreview.replaceChildren();

        if (!coverImage) {
            coverPreview.textContent = '未设置封面';
            coverPreview.dataset.empty = 'true';
            return;
        }

        delete coverPreview.dataset.empty;
        const image = document.createElement('img');
        image.src = coverImage;
        image.alt = '封面预览';
        coverPreview.appendChild(image);
    }

    function setProjectEditorStatus(message, tone) {
        const { statusMessage } = projectEditorElements();
        if (!statusMessage) return;
        statusMessage.textContent = message || '';
        statusMessage.dataset.tone = tone || 'info';
    }

    function openProjectEditor(project) {
        const elements = projectEditorElements();
        if (!elements.modal || !elements.form) return;

        projectLibraryState.editingProject = project;
        projectLibraryState.editingCoverImage = project.coverImage || '';

        elements.name.value = project.name || '';
        elements.status.value = project.status || '';
        elements.tags.value = (project.tags || []).join(', ');
        elements.description.value = project.description || '';
        if (elements.cover) elements.cover.value = '';
        setProjectEditorStatus('', 'info');
        renderCoverPreview(projectLibraryState.editingCoverImage);

        elements.modal.hidden = false;
        window.setTimeout(() => elements.name && elements.name.focus(), 0);
    }

    function closeProjectEditor() {
        const { modal } = projectEditorElements();
        if (modal) modal.hidden = true;
        projectLibraryState.editingProject = null;
        projectLibraryState.editingCoverImage = '';
    }

    function readCoverFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                resolve('');
                return;
            }
            if (!file.type || !file.type.startsWith('image/')) {
                reject(new Error('请选择图片文件'));
                return;
            }
            if (file.size > 2500000) {
                reject(new Error('封面图片不能超过 2.5MB'));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取封面失败'));
            reader.readAsDataURL(file);
        });
    }

    async function saveProjectEditor() {
        const project = projectLibraryState.editingProject;
        const elements = projectEditorElements();
        if (!project || !elements.form) return;

        const metadata = {
            name: elements.name.value,
            status: elements.status.value,
            tags: parseTags(elements.tags.value),
            description: elements.description.value,
            coverImage: projectLibraryState.editingCoverImage
        };

        setProjectEditorStatus('正在保存...', 'info');
        const response = await fetch('/api/update-project-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId: project.id,
                filename: project.filename,
                metadata
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }

        closeProjectEditor();
        await loadProjectLibrary();
        setProjectLibraryStatus('作品信息已保存。', 'ok');
    }

    function projectCreatorElements() {
        return {
            modal: document.querySelector('[data-project-create-modal]'),
            form: document.querySelector('[data-project-create-form]'),
            name: document.querySelector('[data-project-create-name]'),
            status: document.querySelector('[data-project-create-status]'),
            tags: document.querySelector('[data-project-create-tags]'),
            description: document.querySelector('[data-project-create-description]'),
            statusMessage: document.querySelector('[data-project-create-status-message]')
        };
    }

    function setProjectCreatorStatus(message, tone) {
        const { statusMessage } = projectCreatorElements();
        if (!statusMessage) return;
        statusMessage.textContent = message || '';
        statusMessage.dataset.tone = tone || 'info';
    }

    function openProjectCreator() {
        const elements = projectCreatorElements();
        if (!elements.modal || !elements.form) return;
        elements.form.reset();
        if (elements.status) elements.status.value = '构思中';
        setProjectCreatorStatus('', 'info');
        elements.modal.hidden = false;
        window.setTimeout(() => elements.name && elements.name.focus(), 0);
    }

    function closeProjectCreator() {
        const { modal } = projectCreatorElements();
        if (modal) modal.hidden = true;
    }

    async function createProjectFromDesktop() {
        const elements = projectCreatorElements();
        const metadata = {
            name: elements.name.value,
            status: elements.status.value,
            tags: parseTags(elements.tags.value),
            description: elements.description.value,
            coverImage: ''
        };

        setProjectCreatorStatus('正在创建...', 'info');
        const response = await fetch('/api/create-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }

        closeProjectCreator();
        await loadProjectLibrary();
        await openDesktopProject(result.summary);
    }

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
                    fileName: `${documentData.title || 'project'}.writingway`,
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
            fileName: `${project.name || 'project'}.writingway`,
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

    function recoveryElements() {
        return {
            status: document.querySelector('[data-recovery-status]'),
            location: document.querySelector('[data-recovery-location]'),
            search: document.querySelector('[data-recovery-search]'),
            filter: document.querySelector('[data-recovery-filter]'),
            list: document.querySelector('[data-recovery-list]'),
            previewTitle: document.querySelector('[data-recovery-preview-title]'),
            previewMeta: document.querySelector('[data-recovery-preview-meta]'),
            previewHealth: document.querySelector('[data-recovery-preview-health]'),
            diff: document.querySelector('[data-recovery-diff]'),
            previewText: document.querySelector('[data-recovery-preview-text]'),
            restoreScene: document.querySelector('[data-recovery-restore-scene]'),
            restoreNew: document.querySelector('[data-recovery-restore-new]'),
            restoreReplace: document.querySelector('[data-recovery-restore-replace]')
        };
    }

    function filteredRecoveryBackups() {
        const query = recoveryState.query.trim().toLowerCase();
        return recoveryState.backups.filter((backup) => {
            if (recoveryState.filter === 'ok' && backup.health !== 'ok') return false;
            if (recoveryState.filter === 'invalid' && backup.health === 'ok') return false;
            if (recoveryState.filter === 'pinned' && !backup.pinned) return false;
            if (!query) return true;
            return [
                backup.projectName,
                backup.projectId,
                backup.id,
                backup.reason,
                backup.note,
                backup.health
            ].some((value) => String(value || '').toLowerCase().includes(query));
        });
    }

    function recoveryReasonLabel(reason) {
        const labels = {
            manual: '手动备份',
            auto: '自动备份',
            autosave: '自动备份',
            'before-restore': '恢复前保护',
            'before-delete': '删除前保护',
            import: '导入备份'
        };
        return labels[String(reason || '').toLowerCase()] || String(reason || '普通备份');
    }

    function recoveryHealthLabel(health) {
        return health === 'ok' ? '状态正常' : '需要检查';
    }

    function renderRecoveryList() {
        const elements = recoveryElements();
        const backups = filteredRecoveryBackups();
        if (elements.status) {
            const invalidCount = recoveryState.backups.filter((backup) => backup.health !== 'ok').length;
            elements.status.textContent = `${backups.length} / ${recoveryState.backups.length} 个备份${invalidCount ? ` · ${invalidCount} 个异常` : ' · 全部正常'}`;
        }
        if (elements.location) elements.location.textContent = recoveryState.backupLocation || '默认书库备份目录';
        if (!elements.list) return;
        elements.list.replaceChildren();
        if (recoveryState.backups.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'desktop-recovery-empty';
            const location = recoveryState.backupLocation || '默认书库备份目录';
            empty.innerHTML = `<strong>还没有本地备份</strong><span>从书库为作品创建第一个备份。<br>备份位置：${location}</span>`;
            elements.list.appendChild(empty);
            return;
        }
        let lastGroup = '';
        backups
            .sort((a, b) => {
                const groupCompare = String(a.projectName || a.projectId || '').localeCompare(String(b.projectName || b.projectId || ''), 'zh-CN');
                if (groupCompare) return groupCompare;
                return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
            })
            .forEach((backup) => {
            const group = backup.projectName || backup.projectId || '未命名项目';
            if (group !== lastGroup) {
                lastGroup = group;
                const heading = document.createElement('div');
                heading.className = 'desktop-recovery-group';
                heading.textContent = group;
                elements.list.appendChild(heading);
            }
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'desktop-recovery-item';
            item.classList.toggle('is-active', recoveryState.selected && recoveryState.selected.id === backup.id && recoveryState.selected.projectId === backup.projectId);
            const title = document.createElement('strong');
            title.textContent = backup.projectName || backup.projectId || backup.id || '未命名备份';
            const meta = document.createElement('span');
            const created = backup.timestamp ? formatDate(backup.timestamp) : '未知时间';
            const pin = backup.pinned ? ' · 已固定' : '';
            meta.textContent = `${created} · ${recoveryReasonLabel(backup.reason)} · ${recoveryHealthLabel(backup.health)}${pin}`;
            const note = document.createElement('span');
            note.textContent = backup.note || `${backup.sceneCount || 0} 场 · ${formatNumber(backup.wordCount || 0)} 字`;
            item.title = backup.id || '';
            item.append(title, meta, note);
            item.addEventListener('click', () => selectRecoveryBackup(backup));
            elements.list.appendChild(item);
        });
    }

    function firstBackupPreviewText(backup) {
        const entries = Object.entries(backup.sceneContents || {});
        if (!entries.length) return '这个备份没有正文内容。';
        const [sceneId, text] = entries[0];
        const scene = (backup.scenes || []).find((item) => item.id === sceneId);
        return `${scene && scene.title ? scene.title : sceneId}\n\n${String(text || '').slice(0, 2400)}`;
    }

    function firstBackupSceneId(backup) {
        return Object.keys((backup && backup.sceneContents) || {})[0] || '';
    }

    function renderRecoveryPreview() {
        const elements = recoveryElements();
        const summary = recoveryState.selected;
        const backup = recoveryState.selectedBackup;
        const diff = recoveryState.selectedDiff;
        if (!summary || !backup) {
            if (elements.previewTitle) elements.previewTitle.textContent = summary ? (summary.projectName || summary.projectId || '正在读取备份') : '选择一个备份';
            if (elements.previewMeta) {
                elements.previewMeta.textContent = summary
                    ? '正在读取备份正文与差异...'
                    : recoveryState.backups.length
                    ? '从左侧备份列表选择后查看内容和恢复选项。'
                    : '还没有任何项目备份。使用书库中的备份功能创建第一个。';
            }
            if (elements.previewHealth) {
                elements.previewHealth.textContent = summary ? recoveryHealthLabel(summary.health) : '等待选择';
                elements.previewHealth.dataset.tone = summary && summary.health === 'ok' ? 'ok' : 'info';
            }
            if (elements.diff) elements.diff.replaceChildren();
            if (elements.previewText) {
                elements.previewText.textContent = '';
                elements.previewText.classList.add('desktop-recovery-preview-empty');
            }
            if (elements.restoreScene) elements.restoreScene.disabled = true;
            if (elements.restoreNew) elements.restoreNew.disabled = true;
            if (elements.restoreReplace) elements.restoreReplace.disabled = true;
            return;
        }
        if (elements.previewTitle) elements.previewTitle.textContent = summary.projectName || summary.projectId || summary.id;
        if (elements.previewMeta) {
            const created = summary.timestamp ? formatDate(summary.timestamp) : '未知时间';
            elements.previewMeta.textContent = `${summary.sceneCount || 0} 场 · ${formatNumber(summary.wordCount || 0)} 字 · ${recoveryReasonLabel(summary.reason)} · ${created}`;
            elements.previewMeta.title = summary.id || '';
        }
        if (elements.previewHealth) {
            elements.previewHealth.textContent = recoveryHealthLabel(summary.health);
            elements.previewHealth.dataset.tone = summary.health === 'ok' ? 'ok' : 'error';
        }
        if (elements.diff) {
            elements.diff.replaceChildren();
            const values = diff ? [
                `变更 ${diff.changed || 0}`,
                `新增 ${diff.added || 0}`,
                `移除 ${diff.removed || 0}`,
                `不变 ${diff.unchanged || 0}`
            ] : ['没有当前项目可比较'];
            values.forEach((text) => {
                const item = document.createElement('span');
                item.textContent = text;
                elements.diff.appendChild(item);
            });
        }
        if (elements.previewText) {
            elements.previewText.textContent = firstBackupPreviewText(backup);
            elements.previewText.classList.remove('desktop-recovery-preview-empty');
        }
        if (elements.restoreScene) elements.restoreScene.disabled = summary.health !== 'ok' || !Object.keys(backup.sceneContents || {}).length;
        if (elements.restoreNew) elements.restoreNew.disabled = summary.health !== 'ok';
        if (elements.restoreReplace) elements.restoreReplace.disabled = summary.health !== 'ok';
    }

    async function loadRecoveryList() {
        const elements = recoveryElements();
        if (elements.status) elements.status.textContent = '正在读取本地备份...';
        if (elements.list) elements.list.replaceChildren();
        try {
            const response = await fetch('/api/list-all-backups', { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            recoveryState.backups = result.backups || [];
            recoveryState.backupLocation = result.backupLocation || '';
            renderRecoveryList();
            renderRecoveryPreview();
        } catch (error) {
            if (elements.status) elements.status.textContent = `读取备份失败：${error.message || error}`;
        }
    }

    async function selectRecoveryBackup(summary) {
        recoveryState.selected = summary;
        recoveryState.selectedBackup = null;
        recoveryState.selectedDiff = null;
        renderRecoveryList();
        renderRecoveryPreview();
        try {
            const params = new URLSearchParams({ projectId: summary.projectId, backupId: summary.id });
            const response = await fetch(`/api/get-backup?${params.toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            recoveryState.selectedBackup = result.backup;
            if (summary.health === 'ok') {
                const diffResponse = await fetch(`/api/backup-diff?${params.toString()}`, { cache: 'no-store' });
                const diffResult = await diffResponse.json().catch(() => ({}));
                if (diffResponse.ok && diffResult.ok) recoveryState.selectedDiff = diffResult.diff;
            }
            renderRecoveryPreview();
        } catch (error) {
            const elements = recoveryElements();
            if (elements.previewMeta) elements.previewMeta.textContent = `读取备份失败：${error.message || error}`;
        }
    }

    async function restoreSelectedBackup(mode) {
        const selected = recoveryState.selected;
        if (!selected) return;
        const message = mode === 'new-project'
            ? `将“${selected.projectName || selected.projectId}”恢复为一个新项目？`
            : `用该备份替换“${selected.projectName || selected.projectId}”？恢复前会自动创建快照。`;
        if (!window.confirm(message)) return;
        const elements = recoveryElements();
        if (elements.status) elements.status.textContent = '正在恢复备份...';
        try {
            const response = await fetch('/api/restore-backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: selected.projectId, backupId: selected.id, mode })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            const successMessage = mode === 'new-project'
                ? '已恢复为新项目'
                : `已替换原项目${result.preRestoreBackup ? '，恢复前快照已创建' : ''}`;
            await loadProjectLibrary();
            await loadRecoveryList();
            if (elements.status) {
                elements.status.textContent = successMessage;
            }
        } catch (error) {
            if (elements.status) elements.status.textContent = `恢复失败：${error.message || error}`;
        }
    }

    async function restoreSelectedBackupScene() {
        const selected = recoveryState.selected;
        const backup = recoveryState.selectedBackup;
        const sceneId = firstBackupSceneId(backup);
        if (!selected || !sceneId) return;
        if (!window.confirm(`只恢复当前预览场景？恢复前会自动创建快照。`)) return;
        const elements = recoveryElements();
        if (elements.status) elements.status.textContent = '正在恢复场景...';
        try {
            const response = await fetch('/api/restore-backup-scene', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: selected.projectId, backupId: selected.id, sceneId })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadProjectLibrary();
            await loadRecoveryList();
            if (elements.status) elements.status.textContent = '已恢复预览场景，恢复前快照已创建';
        } catch (error) {
            if (elements.status) elements.status.textContent = `恢复场景失败：${error.message || error}`;
        }
    }

    function bindRecovery() {
        document.querySelectorAll('[data-refresh-recovery]').forEach((button) => {
            button.addEventListener('click', loadRecoveryList);
        });
        const elements = recoveryElements();
        if (elements.search) {
            elements.search.addEventListener('input', () => {
                recoveryState.query = elements.search.value || '';
                renderRecoveryList();
            });
        }
        if (elements.filter) {
            elements.filter.addEventListener('change', () => {
                recoveryState.filter = elements.filter.value || 'all';
                renderRecoveryList();
            });
        }
        if (elements.restoreScene) elements.restoreScene.addEventListener('click', restoreSelectedBackupScene);
        if (elements.restoreNew) elements.restoreNew.addEventListener('click', () => restoreSelectedBackup('new-project'));
        if (elements.restoreReplace) elements.restoreReplace.addEventListener('click', () => restoreSelectedBackup('replace'));
    }

    function bindReader() {
        loadReaderState();
        renderReader();
        const elements = readerElements();

        if (elements.file) {
            elements.file.addEventListener('change', async () => {
                try {
                    await importReaderFile(elements.file.files && elements.file.files[0]);
                } catch (error) {
                    console.warn('Failed to import reader file:', error);
                    if (elements.content) {
                        elements.content.replaceChildren();
                        const message = document.createElement('p');
                        message.textContent = error.message || String(error);
                        elements.content.appendChild(message);
                    }
                } finally {
                    elements.file.value = '';
                }
            });
        }

        let scrollSaveTimer = null;
        if (elements.content) {
            elements.content.addEventListener('scroll', () => {
                updateReaderProgress();
                if (scrollSaveTimer) window.clearTimeout(scrollSaveTimer);
                scrollSaveTimer = window.setTimeout(() => {
                    rememberReaderScroll();
                    scrollSaveTimer = null;
                }, 220);
            });
        }

        if (elements.fontSize) {
            elements.fontSize.addEventListener('input', () => {
                readerState.fontSize = Number(elements.fontSize.value) || 18;
                applyReaderSettings();
                saveReaderState();
            });
        }

        if (elements.textWidth) {
            elements.textWidth.addEventListener('input', () => {
                readerState.textWidth = Number(elements.textWidth.value) || 760;
                applyReaderSettings();
                saveReaderState();
            });
        }

        if (elements.paragraphSpacing) {
            elements.paragraphSpacing.addEventListener('input', () => {
                readerState.paragraphSpacing = Number(elements.paragraphSpacing.value) || 1.05;
                applyReaderSettings();
                saveReaderState();
            });
        }

        if (elements.fontFamily) {
            elements.fontFamily.addEventListener('change', () => {
                readerState.fontFamily = elements.fontFamily.value || 'system';
                applyReaderSettings();
                saveReaderState();
            });
        }

        if (elements.indent) {
            elements.indent.addEventListener('change', () => {
                readerState.indent = !!elements.indent.checked;
                applyReaderSettings();
                saveReaderState();
            });
        }

        if (elements.lineHeight) {
            elements.lineHeight.addEventListener('input', () => {
                readerState.lineHeight = Number(elements.lineHeight.value) || 1.8;
                applyReaderSettings();
                saveReaderState();
            });
        }

        if (elements.theme) {
            elements.theme.addEventListener('change', () => {
                readerState.theme = elements.theme.value || 'dark';
                applyReaderSettings();
                saveReaderState();
            });
        }

        if (elements.prev) {
            elements.prev.addEventListener('click', () => {
                rememberReaderScroll();
                readerState.chapterIndex -= 1;
                saveReaderState();
                renderReader();
            });
        }

        if (elements.next) {
            elements.next.addEventListener('click', () => {
                rememberReaderScroll();
                readerState.chapterIndex += 1;
                saveReaderState();
                renderReader();
            });
        }

        document.addEventListener('keydown', (event) => {
            const root = document.getElementById('desktop-root');
            if (!root || root.dataset.view !== 'reader') return;
            const target = event.target;
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

            if (event.key === 'ArrowLeft' && elements.prev && !elements.prev.disabled) {
                event.preventDefault();
                elements.prev.click();
                return;
            }
            if (event.key === 'ArrowRight' && elements.next && !elements.next.disabled) {
                event.preventDefault();
                elements.next.click();
                return;
            }
            if ((event.key === ' ' || event.key === 'PageDown') && elements.content) {
                event.preventDefault();
                elements.content.scrollBy({ top: Math.max(220, elements.content.clientHeight * 0.82), behavior: 'smooth' });
                return;
            }
            if (event.key === 'PageUp' && elements.content) {
                event.preventDefault();
                elements.content.scrollBy({ top: -Math.max(220, elements.content.clientHeight * 0.82), behavior: 'smooth' });
            }
        });
    }

    async function toggleFullscreen() {
        if (window.writingwayDesktop && typeof window.writingwayDesktop.toggleFullscreen === 'function') {
            await window.writingwayDesktop.toggleFullscreen();
            return;
        }

        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
            return;
        }

        if (document.fullscreenElement && document.exitFullscreen) {
            await document.exitFullscreen();
        }
    }

    function bindNavigation() {
        document.querySelectorAll('[data-view-target]').forEach((button) => {
            button.addEventListener('click', () => {
                setView(button.dataset.viewTarget);
            });
        });
        document.querySelectorAll('[data-toggle-rail]').forEach((button) => {
            button.addEventListener('click', () => {
                shellUiState.railCollapsed = !shellUiState.railCollapsed;
                const root = document.getElementById('desktop-root');
                setView((root && root.dataset.view) || 'bookshelf');
            });
        });
    }

    function bindProjectLibrary() {
        document.querySelectorAll('[data-refresh-projects]').forEach((button) => {
            button.addEventListener('click', () => {
                loadProjectLibrary();
            });
        });

        document.querySelectorAll('[data-open-new-project]').forEach((button) => {
            button.addEventListener('click', openProjectCreator);
        });

        document.querySelectorAll('[data-open-project-folder]').forEach((button) => {
            button.addEventListener('click', () => {
                openProjectFolder();
            });
        });

        const snapshotInput = document.querySelector('[data-import-project-snapshot-file]');
        const packageInput = document.querySelector('[data-import-project-package-file]');
        const w1Input = document.querySelector('[data-import-writingway1-files]');

        document.querySelectorAll('[data-import-project-snapshot]').forEach((button) => {
            button.addEventListener('click', () => {
                if (snapshotInput) snapshotInput.click();
            });
        });

        document.querySelectorAll('[data-import-project-package]').forEach((button) => {
            button.addEventListener('click', () => {
                if (packageInput) packageInput.click();
            });
        });

        document.querySelectorAll('[data-import-writingway1]').forEach((button) => {
            button.addEventListener('click', () => {
                if (w1Input) w1Input.click();
            });
        });

        if (snapshotInput) {
            snapshotInput.addEventListener('change', async () => {
                await importProjectSnapshotFile(snapshotInput.files && snapshotInput.files[0]);
                snapshotInput.value = '';
            });
        }

        if (packageInput) {
            packageInput.addEventListener('change', async () => {
                await importProjectPackageFile(packageInput.files && packageInput.files[0]);
                packageInput.value = '';
            });
        }

        if (w1Input) {
            w1Input.addEventListener('change', async () => {
                await importWritingway1Files(w1Input.files);
                w1Input.value = '';
            });
        }

        const search = document.querySelector('[data-project-search]');
        if (search) {
            search.addEventListener('input', () => {
                projectLibraryState.query = search.value || '';
                renderProjectLibrary();
            });
        }

        const sort = document.querySelector('[data-project-sort]');
        if (sort) {
            sort.addEventListener('change', () => {
                projectLibraryState.sort = sort.value || 'recent';
                renderProjectLibrary();
            });
        }
    }

    function bindProjectCreator() {
        const elements = projectCreatorElements();
        if (!elements.modal || !elements.form) return;

        elements.form.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await createProjectFromDesktop();
            } catch (error) {
                console.error('Failed to create desktop project:', error);
                setProjectCreatorStatus(`创建失败：${error.message || error}`, 'error');
            }
        });

        document.querySelectorAll('[data-close-project-creator]').forEach((button) => {
            button.addEventListener('click', closeProjectCreator);
        });

        elements.modal.addEventListener('click', (event) => {
            if (event.target === elements.modal) closeProjectCreator();
        });
    }

    function bindProjectEditor() {
        const elements = projectEditorElements();
        if (!elements.modal || !elements.form) return;

        elements.form.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await saveProjectEditor();
            } catch (error) {
                console.error('Failed to save project metadata:', error);
                setProjectEditorStatus(`保存失败：${error.message || error}`, 'error');
            }
        });

        document.querySelectorAll('[data-close-project-editor]').forEach((button) => {
            button.addEventListener('click', closeProjectEditor);
        });

        elements.modal.addEventListener('click', (event) => {
            if (event.target === elements.modal) closeProjectEditor();
        });

        const clearCover = document.querySelector('[data-clear-project-cover]');
        if (clearCover) {
            clearCover.addEventListener('click', () => {
                projectLibraryState.editingCoverImage = '';
                if (elements.cover) elements.cover.value = '';
                renderCoverPreview('');
            });
        }

        if (elements.cover) {
            elements.cover.addEventListener('change', async () => {
                try {
                    const image = await readCoverFile(elements.cover.files && elements.cover.files[0]);
                    projectLibraryState.editingCoverImage = image;
                    renderCoverPreview(image);
                    setProjectEditorStatus('', 'info');
                } catch (error) {
                    setProjectEditorStatus(error.message || String(error), 'error');
                    elements.cover.value = '';
                }
            });
        }
    }

    function bindWindowControls() {
        document.querySelectorAll('[data-toggle-fullscreen]').forEach((button) => {
            button.addEventListener('click', async () => {
                try {
                    await toggleFullscreen();
                } catch (error) {
                    console.warn('Failed to toggle fullscreen:', error);
                }
            });
        });
    }

    async function fetchProjectSnapshot(project) {
        const params = new URLSearchParams();
        if (project && project.id) params.set('projectId', project.id);
        if (project && project.filename) params.set('filename', project.filename);

        const response = await fetch(`/api/get-project?${params.toString()}`, { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        return result.project;
    }

    function nativeEditorElements() {
        return {
            root: document.querySelector('[data-native-writer]'),
            projectSource: document.querySelector('[data-native-project-source]'),
            projectTitle: document.querySelector('[data-native-project-title]'),
            projectMeta: document.querySelector('[data-native-project-meta]'),
            newProject: document.querySelector('[data-native-new-project]'),
            showBookshelf: document.querySelector('[data-native-show-bookshelf]'),
            search: document.querySelector('[data-native-search]'),
            replace: document.querySelector('[data-native-replace]'),
            replaceCurrent: document.querySelector('[data-native-replace-current]'),
            replaceAll: document.querySelector('[data-native-replace-all]'),
            searchStatus: document.querySelector('[data-native-search-status]'),
            searchPrev: document.querySelector('[data-native-search-prev]'),
            searchNext: document.querySelector('[data-native-search-next]'),
            sceneList: document.querySelector('[data-native-scene-list]'),
            chapterTitle: document.querySelector('[data-native-chapter-title]'),
            sceneTitle: document.querySelector('[data-native-scene-title]'),
            paperHeading: document.querySelector('[data-native-paper-heading]'),
            paperChapter: document.querySelector('[data-native-paper-chapter]'),
            paperTitle: document.querySelector('[data-native-paper-title]'),
            paperStats: document.querySelector('[data-native-paper-stats]'),
            paperPosition: document.querySelector('[data-native-paper-position]'),
            paperStatus: document.querySelector('[data-native-paper-status]'),
            editorBody: document.querySelector('.desktop-native-editor-body'),
            editor: document.querySelector('[data-native-scene-editor]'),
            summary: document.querySelector('[data-native-scene-summary]'),
            generateSceneSummary: document.querySelector('[data-native-generate-scene-summary]'),
            generateChapterSummary: document.querySelector('[data-native-generate-chapter-summary]'),
            tags: document.querySelector('[data-native-scene-tags]'),
            pov: document.querySelector('[data-native-scene-pov]'),
            tense: document.querySelector('[data-native-scene-tense]'),
            stats: document.querySelector('[data-native-editor-stats]'),
            sendToWorkshop: document.querySelector('[data-native-send-to-workshop]'),
            saveToCompendium: document.querySelector('[data-native-save-to-compendium]'),
            saveStatus: document.querySelector('[data-native-save-status]'),
            saveButton: document.querySelector('[data-native-save-scene]'),
            readAloud: document.querySelector('[data-native-read-aloud]'),
            stopReading: document.querySelector('[data-native-stop-reading]'),
            toggleOutline: document.querySelector('[data-native-toggle-outline]'),
            toggleAssistant: document.querySelector('[data-native-toggle-assistant]'),
            assistantPlacement: document.querySelector('[data-native-assistant-placement]'),
            toggleSpecials: document.querySelector('[data-native-toggle-specials]'),
            specials: document.querySelector('[data-native-specials]'),
            specialButtons: Array.from(document.querySelectorAll('[data-native-special-char]')),
            toggleTypography: document.querySelector('[data-native-toggle-typography]'),
            typography: document.querySelector('[data-native-typography]'),
            editorFontSize: document.querySelector('[data-native-editor-font-size]'),
            editorFontSizeValue: document.querySelector('[data-native-editor-font-size-value]'),
            editorLineHeight: document.querySelector('[data-native-editor-line-height]'),
            editorLineHeightValue: document.querySelector('[data-native-editor-line-height-value]'),
            editorTextWidth: document.querySelector('[data-native-editor-text-width]'),
            editorTextWidthValue: document.querySelector('[data-native-editor-text-width-value]'),
            editorParagraphSpacing: document.querySelector('[data-native-editor-paragraph-spacing]'),
            editorParagraphSpacingValue: document.querySelector('[data-native-editor-paragraph-spacing-value]'),
            editorFontFamily: document.querySelector('[data-native-editor-font-family]'),
            editorWordGoal: document.querySelector('[data-native-editor-word-goal]'),
            focusMode: document.querySelector('[data-native-focus-mode]'),
            addChapter: document.querySelector('[data-native-add-chapter]'),
            renameChapter: document.querySelector('[data-native-rename-chapter]'),
            deleteChapter: document.querySelector('[data-native-delete-chapter]'),
            addScene: document.querySelector('[data-native-add-scene]'),
            renameScene: document.querySelector('[data-native-rename-scene]'),
            deleteScene: document.querySelector('[data-native-delete-scene]'),
            moveSceneUp: document.querySelector('[data-native-move-scene-up]'),
            moveSceneDown: document.querySelector('[data-native-move-scene-down]'),
            exportMarkdown: document.querySelector('[data-native-export-md]'),
            exportText: document.querySelector('[data-native-export-txt]'),
            exportHtml: document.querySelector('[data-native-export-html]'),
            exportEpub: document.querySelector('[data-native-export-epub]'),
            exportPackage: document.querySelector('[data-native-export-package]'),
            exportIncludeSceneTitles: document.querySelector('[data-native-export-include-scene-titles]'),
            promptTemplate: document.querySelector('[data-native-prompt-template]'),
            managePrompts: document.querySelector('[data-native-manage-prompts]'),
            genTaskButtons: Array.from(document.querySelectorAll('[data-native-gen-task]')),
            beatInput: document.querySelector('[data-native-beat-input]'),
            insertMode: document.querySelector('[data-native-generation-insert-mode]'),
            previewPrompt: document.querySelector('[data-native-preview-prompt]'),
            generate: document.querySelector('[data-native-generate]'),
            cancelGeneration: document.querySelector('[data-native-cancel-generation]'),
            generationOutput: document.querySelector('[data-native-generation-output]'),
            generationOutputStatus: document.querySelector('[data-native-generation-output-status]'),
            generationResult: document.querySelector('[data-native-generation-result]'),
            reasoning: document.querySelector('[data-native-reasoning]'),
            reasoningText: document.querySelector('[data-native-reasoning-text]'),
            acceptGeneration: document.querySelector('[data-native-accept-generation]'),
            retryGeneration: document.querySelector('[data-native-retry-generation]'),
            discardGeneration: document.querySelector('[data-native-discard-generation]'),
            rewriteOriginalText: document.querySelector('[data-native-rewrite-original-text]'),
            rewritePreset: document.querySelector('[data-native-rewrite-preset]'),
            rewritePresetDescription: document.querySelector('[data-native-rewrite-preset-description]'),
            rewriteSavedPrompt: document.querySelector('[data-native-rewrite-saved-prompt]'),
            rewriteInstruction: document.querySelector('[data-native-rewrite-instruction]'),
            previewRewrite: document.querySelector('[data-native-preview-rewrite]'),
            startRewrite: document.querySelector('[data-native-start-rewrite]'),
            regenerateSelection: document.querySelector('[data-native-regenerate-selection]'),
            rewriteTaskButtons: Array.from(document.querySelectorAll('[data-native-rewrite-task]')),
            regenerateUseContext: document.querySelector('[data-native-regenerate-use-context]'),
            newCharacter: document.querySelector('[data-native-new-character]'),
            openCompendium: document.querySelector('[data-native-open-compendium]'),
            characterList: document.querySelector('[data-native-character-list]'),
            contextSummary: document.querySelector('[data-native-context-summary]'),
            contextCompendium: document.querySelector('[data-native-context-compendium]'),
            contextCompendiumTags: document.querySelector('[data-native-context-compendium-tags]'),
            contextChapters: document.querySelector('[data-native-context-chapters]'),
            contextScenes: document.querySelector('[data-native-context-scenes]'),
            promptDialog: document.querySelector('[data-native-prompt-dialog]'),
            promptPreview: document.querySelector('[data-native-prompt-preview]'),
            closePrompt: document.querySelector('[data-native-close-prompt]'),
            promptManagerDialog: document.querySelector('[data-prompt-manager-dialog]'),
            promptManagerForm: document.querySelector('[data-prompt-manager-form]'),
            promptManagerList: document.querySelector('[data-prompt-manager-list]'),
            promptManagerCount: document.querySelector('[data-prompt-manager-count]'),
            promptManagerStatus: document.querySelector('[data-prompt-manager-status]'),
            promptManagerTitle: document.querySelector('[data-prompt-manager-title]'),
            promptManagerCategory: document.querySelector('[data-prompt-manager-category]'),
            promptManagerSystem: document.querySelector('[data-prompt-manager-system]'),
            promptManagerContent: document.querySelector('[data-prompt-manager-content]'),
            promptManagerNew: document.querySelector('[data-prompt-manager-new]'),
            promptManagerDelete: document.querySelector('[data-prompt-manager-delete]'),
            promptManagerClose: document.querySelector('[data-prompt-manager-close]'),
            panelTabs: Array.from(document.querySelectorAll('[data-native-panel-tab]')),
            panels: Array.from(document.querySelectorAll('[data-native-panel]')),
            generationHistory: document.querySelector('[data-native-generation-history]'),
            historyToolbar: document.querySelector('[data-native-history-toolbar]'),
            copilotGreeting: document.querySelector('[data-native-copilot-greeting]'),
            copilotBrief: document.querySelector('[data-native-copilot-brief]'),
            copilotContextNote: document.querySelector('[data-native-copilot-context-note]'),
            copilotScene: document.querySelector('[data-native-copilot-scene]'),
            copilotChapter: document.querySelector('[data-native-copilot-chapter]'),
            copilotWords: document.querySelector('[data-native-copilot-words]'),
            copilotSuggestionButtons: Array.from(document.querySelectorAll('[data-native-copilot-suggestion]')),
            nameModal: document.querySelector('[data-native-name-modal]'),
            nameForm: document.querySelector('[data-native-name-form]'),
            nameKicker: document.querySelector('[data-native-name-kicker]'),
            nameTitle: document.querySelector('[data-native-name-title]'),
            nameLabel: document.querySelector('[data-native-name-label]'),
            nameInput: document.querySelector('[data-native-name-input]'),
            nameStatus: document.querySelector('[data-native-name-status]'),
            nameCancelButtons: Array.from(document.querySelectorAll('[data-native-name-cancel]')),
            modelControl: document.querySelector('[data-native-model-control]'),
            modelControlHint: document.querySelector('[data-native-model-control-hint]'),
            modelSelect: document.querySelector('[data-native-model-select]'),
            profileSelect: document.querySelector('[data-native-profile-select]'),
            customModelInput: document.querySelector('[data-native-custom-model]'),
            customModelGroup: document.querySelector('[data-native-custom-model-group]'),
            thinkingToggle: document.querySelector('[data-native-thinking-toggle]'),
            writerTemperature: document.querySelector('[data-native-temperature]'),
            writerMaxTokens: document.querySelector('[data-native-max-tokens]'),
            writerProviderDefaults: document.querySelector('[data-native-provider-defaults]'),
            writerSamplingHint: document.querySelector('[data-native-sampling-hint]')
        };
    }

    function nativeSceneContent(sceneId) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !snapshot.sceneContents) return '';
        return String(snapshot.sceneContents[sceneId] || '');
    }

    function settingsElements() {
        return {
            form: document.querySelector('[data-settings-form]'),
            status: document.querySelector('[data-settings-status]'),
            mode: document.querySelector('[data-settings-mode]'),
            provider: document.querySelector('[data-settings-provider]'),
            endpoint: document.querySelector('[data-settings-endpoint]'),
            model: document.querySelector('[data-settings-model]'),
            apiKey: document.querySelector('[data-settings-api-key]'),
            temperature: document.querySelector('[data-settings-temperature]'),
            maxTokens: document.querySelector('[data-settings-max-tokens]'),
            providerDefaults: document.querySelector('[data-settings-provider-defaults]'),
            test: document.querySelector('[data-settings-test]'),
            refresh: document.querySelector('[data-settings-refresh]'),
            ttsVoice: document.querySelector('[data-settings-tts-voice]'),
            ttsRate: document.querySelector('[data-settings-tts-rate]'),
            ttsRateValue: document.querySelector('[data-settings-tts-rate-value]'),
            ttsRefreshVoices: document.querySelector('[data-settings-tts-refresh-voices]'),
            theme: document.querySelector('[data-settings-theme]'),
            themeSave: document.querySelector('[data-settings-theme-save]'),
            profilesList: document.querySelector('[data-settings-profiles-list]'),
            profileEditor: document.querySelector('[data-settings-profile-editor]'),
            profileName: document.querySelector('[data-settings-profile-name]'),
            profileProvider: document.querySelector('[data-settings-profile-provider]'),
            profileEndpoint: document.querySelector('[data-settings-profile-endpoint]'),
            profileModel: document.querySelector('[data-settings-profile-model]'),
            profileApiKey: document.querySelector('[data-settings-profile-api-key]'),
            profileSave: document.querySelector('[data-settings-profile-save]'),
            profileCancel: document.querySelector('[data-settings-profile-cancel]'),
            profileDelete: document.querySelector('[data-settings-profile-delete]'),
            profileAdd: document.querySelector('[data-settings-profile-add]'),
            projectLocation: document.querySelector('[data-settings-project-location]'),
            backupLocation: document.querySelector('[data-settings-backup-location]'),
            openProjectLocation: document.querySelector('[data-settings-open-project-location]'),
            chooseProjectLocation: document.querySelector('[data-settings-choose-project-location]'),
            openBackupLocation: document.querySelector('[data-settings-open-backup-location]'),
            chooseBackupLocation: document.querySelector('[data-settings-choose-backup-location]')
        };
    }

    function normalizeDesktopSettings(settings) {
        if (window.DraftHarborSettingsSchema && typeof window.DraftHarborSettingsSchema.normalizeDesktopSettings === 'function') {
            return window.DraftHarborSettingsSchema.normalizeDesktopSettings(settings || {});
        }
        return settings || {};
    }

    function runtimeProviderConfig(extras = {}) {
        if (extras && extras.profileId && extras.profileId !== 'inherit'
            && window.DraftHarborSettingsSchema && typeof window.DraftHarborSettingsSchema.providerRuntimeConfig === 'function') {
            return window.DraftHarborSettingsSchema.providerRuntimeConfig(settingsWithRuntimeProfiles(), extras);
        }
        if (settingsState.runtimeProvider) {
            return {
                ...settingsState.runtimeProvider,
                ...extras
            };
        }
        if (window.DraftHarborSettingsSchema && typeof window.DraftHarborSettingsSchema.providerRuntimeConfig === 'function') {
            return window.DraftHarborSettingsSchema.providerRuntimeConfig(settingsState.settings || {}, extras);
        }
        return {
            mode: 'local',
            endpoint: 'http://localhost:8080',
            temperature: 0.8,
            maxTokens: 2000,
            ...extras
        };
    }

    function setSettingsStatus(message, tone = 'info') {
        const { status } = settingsElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function renderSettingsForm() {
        const elements = settingsElements();
        if (!elements.form) return;
        const settings = normalizeDesktopSettings(settingsState.settings);
        const provider = settings.providerSettings || {};
        const defaults = settings.generationDefaults || {};
        const local = settings.localModelSettings || {};

        if (elements.mode) elements.mode.value = provider.mode || 'local';
        if (elements.provider) elements.provider.value = provider.provider || (provider.mode === 'local' ? 'lmstudio' : 'openai-compatible');
        if (elements.endpoint) elements.endpoint.value = provider.mode === 'local' ? (local.endpoint || provider.endpoint || '') : (provider.endpoint || '');
        if (elements.model) elements.model.value = provider.model || local.model || '';
        if (elements.apiKey) {
            elements.apiKey.value = '';
            elements.apiKey.placeholder = provider.hasApiKey ? '已保存密钥，留空表示保持不变' : 'API key';
            elements.apiKey.disabled = provider.mode === 'local';
        }
        if (elements.temperature) elements.temperature.value = defaults.temperature === undefined ? 0.8 : defaults.temperature;
        if (elements.maxTokens) elements.maxTokens.value = defaults.maxTokens || 300;
        if (elements.providerDefaults) elements.providerDefaults.checked = !!defaults.useProviderDefaults;

        const isBusy = settingsState.loading || settingsState.saving;
        [elements.mode, elements.provider, elements.endpoint, elements.model, elements.apiKey, elements.temperature, elements.maxTokens, elements.providerDefaults, elements.test, elements.refresh, elements.theme, elements.themeSave].forEach((field) => {
            if (field) field.disabled = isBusy || (field === elements.apiKey && provider.mode === 'local');
        });
        renderSettingsProfiles();
        renderSettingsAppearance();
        renderSettingsStorage();
        renderSettingsCategorySummaries();
        setSettingsCategory(settingsState.activeSection);
    }

    function setSettingsCategory(target) {
        const allowed = new Set(['provider', 'profiles', 'generation', 'appearance', 'tts', 'storage']);
        const next = allowed.has(target) ? target : 'provider';
        settingsState.activeSection = next;
        document.querySelectorAll('[data-settings-cat-target]').forEach((button) => {
            const active = button.dataset.settingsCatTarget === next;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('[data-settings-section]').forEach((section) => {
            section.hidden = section.dataset.settingsSection !== next;
        });
    }

    function settingsProviderLabel(provider) {
        const meta = modelCatalog().getProviderMetadata(provider || '');
        return meta && meta.label ? meta.label : String(provider || '未配置');
    }

    function renderSettingsCategorySummaries() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const provider = settings.providerSettings || {};
        const profiles = settings.providerProfiles || [];
        const defaults = settings.generationDefaults || {};
        const themeLabels = {
            'morandi-ink': '墨灰书房',
            'mist-library': '雾光书库',
            'ash-rose': '灰玫瑰工作室'
        };
        const summaries = {
            provider: `${provider.mode === 'api' ? '云端' : '本地'} · ${settingsProviderLabel(provider.provider)}`,
            profiles: profiles.length ? `${profiles.filter((profile) => profile.hasApiKey && modelCatalog().isApiCompatibleProvider(profile.provider)).length} 个可用于写作` : '尚未添加云端档案',
            generation: defaults.useProviderDefaults ? '跟随模型默认值' : `${defaults.temperature ?? 0.8} · ${formatNumber(defaults.maxTokens || 2000)} tokens`,
            appearance: themeLabels[(settings.appearance || {}).theme] || '墨灰书房',
            tts: settingsElements().ttsVoice && settingsElements().ttsVoice.value ? '已选择本机声音' : '本机语音',
            storage: settings.projectSaveLocation ? '自定义书库位置' : '默认本地书库'
        };
        Object.entries(summaries).forEach(([key, value]) => {
            const element = document.querySelector(`[data-settings-cat-summary="${key}"]`);
            if (element) element.textContent = value;
        });
    }

    function renderSettingsStorage() {
        const elements = settingsElements();
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const resolved = settingsState.storageLocations || {};
        const projectLocation = resolved.projectSaveLocation || settings.projectSaveLocation || projectLibraryState.projectSaveLocation || '默认：应用数据目录中的 projects';
        const backupLocation = resolved.backupLocation || settings.backupLocation || (projectLocation && !projectLocation.startsWith('默认：') ? `${projectLocation}\\backups` : '默认：作品书库中的 backups');
        if (elements.projectLocation) elements.projectLocation.textContent = projectLocation;
        if (elements.backupLocation) elements.backupLocation.textContent = backupLocation;
    }

    async function runSettingsStorageAction(endpoint, successMessage, reloadAfter = false) {
        setSettingsStatus('正在处理存储位置...', 'info');
        try {
            const response = await fetch(endpoint, { method: 'POST' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            if (result.canceled) {
                setSettingsStatus('已取消更改', 'info');
                return;
            }
            if (reloadAfter) {
                await loadSettings();
                await loadProjectLibrary();
                await loadRecoveryList();
            }
            setSettingsStatus(successMessage, 'ok');
            renderSettingsStorage();
            renderSettingsCategorySummaries();
        } catch (error) {
            setSettingsStatus(`操作失败：${error.message || error}`, 'error');
        }
    }

    function renderSettingsAppearance() {
        var settings = normalizeDesktopSettings(settingsState.settings);
        var appearance = settings.appearance || {};
        var theme = normalizeDesktopTheme(appearance.theme || 'morandi-ink');
        if (settingsElements().theme) settingsElements().theme.value = theme;
        document.querySelectorAll('[data-settings-theme-choice]').forEach(function (card) {
            card.classList.toggle('is-active', card.dataset.settingsThemeChoice === theme);
        });
    }

    function modelCatalog() {
        if (window.DraftHarborModelCatalog) return window.DraftHarborModelCatalog;
        return {
            getProviderModels: function () { return [{ id: '__custom__', label: '自定义模型...' }]; },
            getProviderMetadata: function (provider) { return { label: provider, defaultEndpoint: '', defaultModelHint: '' }; },
            isThinkingSupported: function () { return false; },
            isKnownDefaultEndpoint: function () { return false; },
            isKnownDefaultModelHint: function () { return false; },
            isApiCompatibleProvider: function (provider) {
                return ['deepseek', 'openai', 'openrouter', 'nanogpt', 'openai-compatible', 'custom'].indexOf(provider) >= 0;
            }
        };
    }

    function settingsWithRuntimeProfiles() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const runtimeProfiles = Array.isArray(settingsState.runtimeProviderProfiles)
            ? settingsState.runtimeProviderProfiles
            : [];
        if (!runtimeProfiles.length) return settings;
        const profileMap = new Map((settings.providerProfiles || []).map((profile) => [profile.id, { ...profile }]));
        runtimeProfiles.forEach((runtimeProfile) => {
            if (!runtimeProfile || !runtimeProfile.id) return;
            profileMap.set(runtimeProfile.id, {
                ...(profileMap.get(runtimeProfile.id) || {}),
                ...runtimeProfile,
                hasApiKey: !!(runtimeProfile.apiKey || runtimeProfile.hasApiKey)
            });
        });
        return {
            ...settings,
            providerProfiles: Array.from(profileMap.values())
        };
    }

    function renderSettingsProfiles() {
        const elements = settingsElements();
        if (!elements.profilesList) return;
        const settings = normalizeDesktopSettings(settingsState.settings);
        const profiles = settings.providerProfiles || [];
        elements.profilesList.replaceChildren();
        if (!profiles.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-settings-profile-empty';
            empty.innerHTML = '<strong>还没有云端模型档案</strong><span>添加 DeepSeek、OpenAI 或其他兼容接口后，可直接在写作页切换。</span>';
            elements.profilesList.appendChild(empty);
        } else {
            profiles.forEach((profile) => {
                const item = document.createElement('div');
                item.className = 'desktop-settings-profile-item';
                const info = document.createElement('div');
                info.className = 'desktop-settings-profile-info';
                const name = document.createElement('strong');
                name.textContent = profile.name || profile.provider || 'API 配置组';
                const meta = document.createElement('span');
                let endpointLabel = profile.endpoint || '未设置接口地址';
                try { endpointLabel = profile.endpoint ? new URL(profile.endpoint).host : endpointLabel; } catch (error) { /* keep original */ }
                meta.textContent = `${settingsProviderLabel(profile.provider)} · ${profile.model || '默认模型'} · ${endpointLabel}`;
                const badges = document.createElement('div');
                badges.className = 'desktop-settings-profile-badges';
                const keyBadge = document.createElement('span');
                keyBadge.dataset.tone = profile.hasApiKey ? 'ok' : 'warn';
                keyBadge.textContent = profile.hasApiKey ? '密钥已保存' : '缺少密钥';
                const compatible = modelCatalog().isApiCompatibleProvider(profile.provider);
                const useBadge = document.createElement('span');
                useBadge.dataset.tone = compatible && profile.hasApiKey ? 'ok' : 'info';
                useBadge.textContent = compatible && profile.hasApiKey ? '可用于写作' : '暂不可用于写作';
                badges.append(keyBadge, useBadge);
                info.append(name, meta, badges);
                const testState = profileTestState[profile.id];
                if (testState) {
                    const status = document.createElement('span');
                    status.className = 'desktop-settings-profile-status';
                    status.dataset.tone = testState.tone || 'info';
                    status.textContent = testState.message || '';
                    info.appendChild(status);
                }
                const actions = document.createElement('div');
                actions.className = 'desktop-settings-profile-actions';
                const test = document.createElement('button');
                test.type = 'button';
                test.className = 'desktop-secondary-action';
                test.textContent = testState && testState.running ? '测试中...' : '测试';
                test.disabled = !!(testState && testState.running);
                test.addEventListener('click', () => testProviderProfile(profile.id));
                const edit = document.createElement('button');
                edit.type = 'button';
                edit.className = 'desktop-secondary-action';
                edit.textContent = '编辑';
                edit.addEventListener('click', () => openProviderProfileEditor(profile));
                actions.append(test, edit);
                item.append(info, actions);
                elements.profilesList.appendChild(item);
            });
        }
        if (elements.profileEditor) elements.profileEditor.hidden = !profileEditState.editingProfile;
        if (profileEditState.editingProfile) {
            const profile = profileEditState.editingProfile;
            if (elements.profileName) elements.profileName.value = profile.name || '';
            if (elements.profileProvider) elements.profileProvider.value = profile.provider || 'deepseek';
            if (elements.profileEndpoint) elements.profileEndpoint.value = profile.endpoint || '';
            if (elements.profileModel) elements.profileModel.value = profile.model || '';
            if (elements.profileApiKey) {
                elements.profileApiKey.value = '';
                elements.profileApiKey.placeholder = profile.hasApiKey ? '已保存密钥，留空表示保持现有密钥' : 'API Key';
            }
            if (elements.profileDelete) elements.profileDelete.hidden = !profileEditState.editingId;
        }
        renderSettingsCategorySummaries();
    }

    function profileDefaults(provider) {
        const meta = modelCatalog().getProviderMetadata(provider || 'deepseek');
        return {
            endpoint: meta.defaultEndpoint || '',
            model: meta.defaultModelHint || ''
        };
    }

    function openProviderProfileEditor(profile) {
        const provider = (profile && profile.provider) || 'deepseek';
        const defaults = profileDefaults(provider);
        profileEditState.editingId = (profile && profile.id) || '';
        profileEditState.editingProfile = {
            id: (profile && profile.id) || '',
            name: (profile && profile.name) || '',
            provider,
            endpoint: (profile && profile.endpoint) || defaults.endpoint,
            model: (profile && profile.model) || defaults.model,
            hasApiKey: !!(profile && profile.hasApiKey)
        };
        renderSettingsProfiles();
    }

    function closeProviderProfileEditor() {
        profileEditState.editingId = '';
        profileEditState.editingProfile = null;
        renderSettingsProfiles();
    }

    async function saveProviderProfile() {
        const elements = settingsElements();
        const profile = {
            id: profileEditState.editingId || undefined,
            name: elements.profileName ? elements.profileName.value.trim() : '',
            provider: elements.profileProvider ? elements.profileProvider.value : 'deepseek',
            endpoint: elements.profileEndpoint ? elements.profileEndpoint.value.trim() : '',
            model: elements.profileModel ? elements.profileModel.value.trim() : '',
            apiKey: elements.profileApiKey ? elements.profileApiKey.value : ''
        };
        const response = await fetch('/api/settings/provider-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        settingsState.settings = normalizeDesktopSettings(result.settings || {});
        settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
        closeProviderProfileEditor();
        setSettingsStatus('配置组已保存', 'ok');
        renderWriterModelControl();
    }

    async function deleteProviderProfile() {
        if (!profileEditState.editingId) return;
        const response = await fetch('/api/settings/delete-provider-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: profileEditState.editingId })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        settingsState.settings = normalizeDesktopSettings(result.settings || {});
        settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
        closeProviderProfileEditor();
        setSettingsStatus('配置组已删除', 'ok');
        renderWriterModelControl();
    }

    async function testProviderProfile(profileId) {
        profileTestState[profileId] = { running: true, tone: 'info', message: '测试中...' };
        renderSettingsProfiles();
        try {
            const response = await fetch('/api/settings/test-provider-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profileId, live: false })
            });
            const result = await response.json().catch(() => ({}));
            const detail = result.result || result;
            profileTestState[profileId] = {
                running: false,
                tone: result.ok ? 'ok' : 'error',
                message: result.ok ? '配置可用' : (detail.error || result.error || '测试失败')
            };
        } catch (error) {
            profileTestState[profileId] = { running: false, tone: 'error', message: error.message || String(error) };
        }
        renderSettingsProfiles();
    }

    function getTtsVoices() {
        if (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function') {
            return window.speechSynthesis.getVoices();
        }
        return [];
    }

    function populateTtsVoiceSelect() {
        const elements = settingsElements();
        if (!elements.ttsVoice) return;
        const voices = getTtsVoices();
        const savedVoice = (function () {
            try { return window.localStorage.getItem(TTS_VOICE_KEY) || ''; } catch (e) { return ''; }
        })();
        elements.ttsVoice.replaceChildren();
        voices.forEach(function (voice) {
            var option = document.createElement('option');
            option.value = voice.name;
            option.textContent = voice.name + ' (' + (voice.lang || 'unknown') + ')';
            if (voice.name === savedVoice) option.selected = true;
            elements.ttsVoice.appendChild(option);
        });
        if (!voices.some(function (v) { return v.name === savedVoice; }) && savedVoice) {
            var option = document.createElement('option');
            option.value = savedVoice;
            option.textContent = savedVoice + ' (不可用)';
            option.selected = true;
            option.disabled = true;
            elements.ttsVoice.appendChild(option);
        }
        renderSettingsCategorySummaries();
    }

    function loadTtsPrefs() {
        var elements = settingsElements();
        try {
            var savedVoice = window.localStorage.getItem(TTS_VOICE_KEY) || '';
            var savedRate = Number(window.localStorage.getItem(TTS_SPEED_KEY) || '1');
            if (elements.ttsRate) {
                elements.ttsRate.value = String(Number.isFinite(savedRate) ? Math.min(2, Math.max(0.5, savedRate)) : 1);
            }
            if (elements.ttsRateValue) {
                elements.ttsRateValue.textContent = elements.ttsRate ? String(Number(elements.ttsRate.value).toFixed(1)) : '1.0';
            }
            populateTtsVoiceSelect();
        } catch (e) { /* ignore */ }
    }

    function saveTtsVoicePref(name) {
        try { window.localStorage.setItem(TTS_VOICE_KEY, String(name || '')); } catch (e) { /* ignore */ }
    }

    function saveTtsSpeedPref(rate) {
        try { window.localStorage.setItem(TTS_SPEED_KEY, String(rate)); } catch (e) { /* ignore */ }
    }

    function collectSettingsForm() {
        const elements = settingsElements();
        const current = normalizeDesktopSettings(settingsState.settings);
        const mode = elements.mode ? elements.mode.value : 'local';
        const endpoint = elements.endpoint ? elements.endpoint.value.trim() : '';
        const model = elements.model ? elements.model.value.trim() : '';
        var theme = normalizeDesktopTheme(elements.theme ? elements.theme.value : 'morandi-ink');
        return {
            providerSettings: {
                mode,
                provider: elements.provider ? elements.provider.value : (mode === 'local' ? 'lmstudio' : 'openai-compatible'),
                endpoint,
                model,
                apiKey: elements.apiKey ? elements.apiKey.value.trim() : ''
            },
            generationDefaults: {
                temperature: elements.temperature ? Number(elements.temperature.value) : 0.8,
                maxTokens: elements.maxTokens ? Number(elements.maxTokens.value) : 2000,
                useProviderDefaults: !!(elements.providerDefaults && elements.providerDefaults.checked)
            },
            localModelSettings: {
                ...(current.localModelSettings || {}),
                endpoint: mode === 'local' ? (endpoint || 'http://localhost:8080') : ((current.localModelSettings && current.localModelSettings.endpoint) || 'http://localhost:8080'),
                model: mode === 'local' ? model : ((current.localModelSettings && current.localModelSettings.model) || '')
            },
            appearance: {
                theme: theme
            }
        };
    }

    function refreshSettingsProviderDefaults() {
        const elements = settingsElements();
        if (!elements.mode || !elements.provider || !elements.endpoint || !elements.model) return;
        const mode = elements.mode.value;
        const provider = elements.provider.value;
        const endpoint = elements.endpoint.value.trim();
        const endpointLooksLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(endpoint);
        if (mode === 'api' && provider === 'deepseek' && (!endpoint || endpointLooksLocal)) {
            elements.endpoint.value = 'https://api.deepseek.com/chat/completions';
        }
        if (mode === 'api' && provider === 'deepseek' && !elements.model.value.trim()) {
            elements.model.value = 'deepseek-v4-pro';
        }
    }

    async function loadSettings() {
        if (settingsState.loading && settingsState.loadPromise) return settingsState.loadPromise;
        settingsState.loading = true;
        setSettingsStatus('正在读取设置...', 'info');
        renderSettingsForm();
        settingsState.loadPromise = (async () => {
            const response = await fetch('/api/settings', { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            settingsState.settings = normalizeDesktopSettings(result.settings || {});
            settingsState.runtimeProvider = result.runtimeProvider || runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
            settingsState.storageLocations = result.storageLocations || null;
            var appearance = normalizeDesktopSettings(settingsState.settings).appearance || {};
            applyDesktopTheme(appearance.theme || 'morandi-ink');
            setSettingsStatus('设置已读取', 'ok');
            return settingsState.settings;
        })();
        try {
            return await settingsState.loadPromise;
        } catch (error) {
            console.warn('Failed to load settings:', error);
            settingsState.settings = normalizeDesktopSettings();
            settingsState.runtimeProvider = runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = null;
            settingsState.storageLocations = null;
            setSettingsStatus(`读取设置失败：${error.message || error}`, 'error');
            return settingsState.settings;
        } finally {
            settingsState.loading = false;
            settingsState.loadPromise = null;
            renderSettingsForm();
            renderWriterModelControl();
            renderNativeGeneration();
        }
    }

    async function saveSettings(event) {
        if (event) event.preventDefault();
        const nextSettings = collectSettingsForm();
        settingsState.saving = true;
        setSettingsStatus('正在保存设置...', 'info');
        renderSettingsForm();
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: nextSettings })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            settingsState.settings = normalizeDesktopSettings(result.settings || {});
            settingsState.runtimeProvider = result.runtimeProvider || runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
            settingsState.storageLocations = result.storageLocations || settingsState.storageLocations;
            var appearance = normalizeDesktopSettings(settingsState.settings).appearance || {};
            applyDesktopTheme(appearance.theme || 'morandi-ink');
            setSettingsStatus('设置已保存', 'ok');
        } catch (error) {
            console.warn('Failed to save settings:', error);
            setSettingsStatus(`保存失败：${error.message || error}`, 'error');
        } finally {
            settingsState.saving = false;
            renderSettingsForm();
            renderWriterModelControl();
            renderNativeGeneration();
        }
    }

    async function saveWriterGenerationDefaults(patch) {
        const current = normalizeDesktopSettings(settingsState.settings || {});
        const defaults = {
            ...(current.generationDefaults || {}),
            ...(patch || {})
        };
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { generationDefaults: defaults } })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            settingsState.settings = normalizeDesktopSettings(result.settings || {});
            settingsState.runtimeProvider = result.runtimeProvider || runtimeProviderConfig();
            settingsState.runtimeProviderProfiles = result.runtimeProviderProfiles || null;
            renderSettingsForm();
            renderWriterModelControl();
            renderNativeGeneration();
            setNativeSaveStatus('生成参数已更新', 'ok');
        } catch (error) {
            console.warn('Failed to save writer generation defaults:', error);
            setNativeSaveStatus(`生成参数保存失败：${error.message || error}`, 'error');
            renderWriterModelControl();
        }
    }

    async function testSettingsProvider() {
        setSettingsStatus('正在检查配置...', 'info');
        try {
            const response = await fetch('/api/settings/test-provider', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: collectSettingsForm(), live: false })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            if (!result.ok) {
                throw new Error(result.result && result.result.error ? result.result.error : '配置不可用');
            }
            const checked = result.result && result.result.checked === 'configuration' ? '配置格式可用' : '连接可用';
            setSettingsStatus(checked, 'ok');
        } catch (error) {
            setSettingsStatus(`检查失败：${error.message || error}`, 'error');
        }
    }

    function bindSettings() {
        const elements = settingsElements();
        if (elements.form) elements.form.addEventListener('submit', saveSettings);
        if (elements.test) elements.test.addEventListener('click', testSettingsProvider);
        if (elements.refresh) elements.refresh.addEventListener('click', loadSettings);

        document.querySelectorAll('[data-settings-cat-target]').forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.settingsCatTarget;
                setSettingsCategory(target);
            });
        });

        [elements.mode, elements.provider].forEach((field) => {
            if (!field) return;
            field.addEventListener('change', () => {
                const current = normalizeDesktopSettings(settingsState.settings);
                const patch = collectSettingsForm();
                settingsState.settings = normalizeDesktopSettings({
                    ...current,
                    ...patch
                });
                renderSettingsForm();
                refreshSettingsProviderDefaults();
            });
        });
        if (elements.ttsVoice) {
            elements.ttsVoice.addEventListener('change', function () {
                saveTtsVoicePref(elements.ttsVoice.value);
            });
        }
        if (elements.ttsRate) {
            elements.ttsRate.addEventListener('input', function () {
                var rate = Number(elements.ttsRate.value);
                if (elements.ttsRateValue) elements.ttsRateValue.textContent = rate.toFixed(1);
                saveTtsSpeedPref(rate);
            });
        }
        if (elements.ttsRefreshVoices) {
            elements.ttsRefreshVoices.addEventListener('click', function () {
                populateTtsVoiceSelect();
            });
        }
        if (elements.openProjectLocation) elements.openProjectLocation.addEventListener('click', () => runSettingsStorageAction('/api/open-project-save-folder', '已打开作品书库'));
        if (elements.chooseProjectLocation) elements.chooseProjectLocation.addEventListener('click', () => runSettingsStorageAction('/api/choose-project-save-folder', '作品书库位置已更新', true));
        if (elements.openBackupLocation) elements.openBackupLocation.addEventListener('click', () => runSettingsStorageAction('/api/open-backup-folder', '已打开备份目录'));
        if (elements.chooseBackupLocation) elements.chooseBackupLocation.addEventListener('click', () => runSettingsStorageAction('/api/choose-backup-folder', '备份目录已更新', true));
        if (elements.theme) {
            elements.theme.addEventListener('change', function () {
                var current = normalizeDesktopSettings(settingsState.settings || {});
                var theme = normalizeDesktopTheme(elements.theme.value);
                settingsState.settings = normalizeDesktopSettings({
                    ...current,
                    appearance: {
                        ...(current.appearance || {}),
                        theme: theme
                    }
                });
                applyDesktopTheme(theme);
                renderSettingsAppearance();
            });
        }
        if (elements.themeSave) elements.themeSave.addEventListener('click', saveSettings);
        if (elements.profileAdd) elements.profileAdd.addEventListener('click', () => openProviderProfileEditor(null));
        if (elements.profileCancel) elements.profileCancel.addEventListener('click', closeProviderProfileEditor);
        if (elements.profileSave) {
            elements.profileSave.addEventListener('click', async () => {
                try {
                    await saveProviderProfile();
                } catch (error) {
                    setSettingsStatus(`配置组保存失败：${error.message || error}`, 'error');
                }
            });
        }
        if (elements.profileDelete) {
            elements.profileDelete.addEventListener('click', async () => {
                try {
                    await deleteProviderProfile();
                } catch (error) {
                    setSettingsStatus(`配置组删除失败：${error.message || error}`, 'error');
                }
            });
        }
        if (elements.profileProvider) {
            elements.profileProvider.addEventListener('change', () => {
                const provider = elements.profileProvider.value || 'deepseek';
                const defaults = profileDefaults(provider);
                if (elements.profileEndpoint && (!elements.profileEndpoint.value.trim() || modelCatalog().isKnownDefaultEndpoint(elements.profileEndpoint.value.trim()))) {
                    elements.profileEndpoint.value = defaults.endpoint;
                }
                if (elements.profileModel && (!elements.profileModel.value.trim() || modelCatalog().isKnownDefaultModelHint(elements.profileModel.value.trim()))) {
                    elements.profileModel.value = defaults.model;
                }
            });
        }
        document.querySelectorAll('[data-settings-theme-choice]').forEach(function (card) {
            card.addEventListener('click', function () {
                var current = normalizeDesktopSettings(settingsState.settings || {});
                var theme = normalizeDesktopTheme(card.dataset.settingsThemeChoice || 'morandi-ink');
                settingsState.settings = normalizeDesktopSettings({
                    ...current,
                    appearance: {
                        ...(current.appearance || {}),
                        theme: theme
                    }
                });
                if (elements.theme) elements.theme.value = theme;
                applyDesktopTheme(theme);
                renderSettingsAppearance();
            });
        });
        if (window.speechSynthesis) {
            window.speechSynthesis.addEventListener('voiceschanged', function () {
                populateTtsVoiceSelect();
            });
        }
        loadTtsPrefs();
        renderSettingsForm();
    }

    function compendiumElements() {
        return {
            projectLabel: document.querySelector('[data-compendium-project-label]'),
            status: document.querySelector('[data-compendium-status]'),
            search: document.querySelector('[data-compendium-search]'),
            typeFilter: document.querySelector('[data-compendium-type]'),
            list: document.querySelector('[data-compendium-list]'),
            newButton: document.querySelector('[data-compendium-new]'),
            form: document.querySelector('[data-compendium-form]'),
            editorTitle: document.querySelector('[data-compendium-editor-title]'),
            entryType: document.querySelector('[data-compendium-entry-type]'),
            title: document.querySelector('[data-compendium-title]'),
            summary: document.querySelector('[data-compendium-summary]'),
            tags: document.querySelector('[data-compendium-tags]'),
            aliases: document.querySelector('[data-compendium-aliases]'),
            always: document.querySelector('[data-compendium-always]'),
            policyMode: document.querySelector('[data-compendium-policy-mode]'),
            triggerTitle: document.querySelector('[data-compendium-trigger-title]'),
            triggerAliases: document.querySelector('[data-compendium-trigger-aliases]'),
            triggerTags: document.querySelector('[data-compendium-trigger-tags]'),
            triggerPov: document.querySelector('[data-compendium-trigger-pov]'),
            triggerSceneCharacters: document.querySelector('[data-compendium-trigger-scene-characters]'),
            character: document.querySelector('[data-compendium-character]'),
            characterRole: document.querySelector('[data-compendium-character-role]'),
            characterGoal: document.querySelector('[data-compendium-character-goal]'),
            characterMotivation: document.querySelector('[data-compendium-character-motivation]'),
            characterConflict: document.querySelector('[data-compendium-character-conflict]'),
            characterVoice: document.querySelector('[data-compendium-character-voice]'),
            characterCurrentState: document.querySelector('[data-compendium-character-current-state]'),
            characterKnowledge: document.querySelector('[data-compendium-character-knowledge]'),
            characterRelationship: document.querySelector('[data-compendium-character-relationship]'),
            body: document.querySelector('[data-compendium-body]'),
            save: document.querySelector('[data-compendium-save]'),
            deleteButton: document.querySelector('[data-compendium-delete]')
        };
    }

    function currentProjectId() {
        return nativeEditorState.snapshot && nativeEditorState.snapshot.project
            ? nativeEditorState.snapshot.project.id
            : '';
    }

    function currentProjectName() {
        return nativeEditorState.snapshot && nativeEditorState.snapshot.project
            ? nativeEditorState.snapshot.project.name || nativeEditorState.snapshot.project.title || '未命名项目'
            : '';
    }

    function selectedCompendiumEntry() {
        return compendiumState.entries.find((entry) => entry.id === compendiumState.selectedId) || null;
    }

    function typeLabel(type) {
        return {
            character: '角色',
            location: '地点',
            organization: '组织',
            item: '物品',
            lore: '设定',
            timeline: '时间线',
            note: '笔记'
        }[type] || '资料';
    }

    function setCompendiumStatus(message, tone = 'info') {
        const { status } = compendiumElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function setCompendiumCountStatus() {
        if (!currentProjectId()) {
            setCompendiumStatus('未打开项目', 'info');
            return;
        }
        setCompendiumStatus(`${filteredCompendiumEntries().length} / ${compendiumState.entries.length} 条资料`, 'ok');
    }

    function parseCommaList(value) {
        return String(value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    }

    function filteredCompendiumEntries() {
        const query = compendiumState.query.trim().toLowerCase();
        return compendiumState.entries.filter((entry) => {
            if (compendiumState.type && entry.type !== compendiumState.type) return false;
            if (!query) return true;
            const haystack = [
                entry.title,
                entry.summary,
                entry.body,
                entry.category,
                ...(entry.tags || []),
                ...(entry.aliases || [])
            ].join('\n').toLowerCase();
            return haystack.includes(query);
        });
    }

    function normalizedContextPolicy(entry) {
        if (window.DraftHarborCompendiumSchema && typeof window.DraftHarborCompendiumSchema.normalizeContextPolicy === 'function') {
            return window.DraftHarborCompendiumSchema.normalizeContextPolicy(
                entry && entry.contextPolicy
                    ? entry.contextPolicy
                    : { mode: entry && entry.alwaysInContext ? 'always' : 'manual' }
            );
        }
        const policy = entry && entry.contextPolicy && typeof entry.contextPolicy === 'object'
            ? entry.contextPolicy
            : {};
        const mode = ['disabled', 'manual', 'mention', 'auto', 'always'].includes(policy.mode) ? policy.mode : (entry && entry.alwaysInContext ? 'always' : 'manual');
        const triggers = policy.triggers && typeof policy.triggers === 'object' ? policy.triggers : {};
        return {
            mode,
            triggers: {
                title: triggers.title !== false,
                aliases: triggers.aliases !== false,
                tags: triggers.tags !== false,
                pov: triggers.pov !== false,
                sceneCharacters: triggers.sceneCharacters !== false
            }
        };
    }

    function compendiumCharacterFields(elements) {
        return [
            elements.characterRole,
            elements.characterGoal,
            elements.characterMotivation,
            elements.characterConflict,
            elements.characterVoice,
            elements.characterCurrentState,
            elements.characterKnowledge,
            elements.characterRelationship
        ];
    }

    function compendiumPolicyFields(elements) {
        return [
            elements.policyMode,
            elements.triggerTitle,
            elements.triggerAliases,
            elements.triggerTags,
            elements.triggerPov,
            elements.triggerSceneCharacters
        ];
    }

    function renderCompendium() {
        const elements = compendiumElements();
        const projectId = currentProjectId();
        const projectName = currentProjectName();
        const selected = selectedCompendiumEntry();
        const hasProject = !!projectId;

        if (elements.projectLabel) {
            elements.projectLabel.textContent = hasProject ? `当前项目：${projectName}` : '从书库打开项目后编辑资料。';
        }
        if (elements.search && elements.search.value !== compendiumState.query) elements.search.value = compendiumState.query;
        if (elements.typeFilter && elements.typeFilter.value !== compendiumState.type) elements.typeFilter.value = compendiumState.type;
        if (elements.newButton) elements.newButton.disabled = !hasProject || compendiumState.loading;

        const compendiumTools = document.querySelector('.desktop-compendium-tools');
        if (compendiumTools) compendiumTools.hidden = !hasProject;

        if (elements.list) {
            elements.list.replaceChildren();
            const entries = filteredCompendiumEntries();
            if (!hasProject) {
                const empty = document.createElement('div');
                empty.className = 'desktop-compendium-item';
                empty.textContent = '先从书库打开一个项目。';
                elements.list.appendChild(empty);
            } else if (!entries.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-compendium-item';
                empty.textContent = compendiumState.entries.length ? '没有匹配的资料。' : '这个项目还没有资料。';
                elements.list.appendChild(empty);
            } else {
                entries.forEach((entry) => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'desktop-compendium-item';
                    item.classList.toggle('is-active', entry.id === compendiumState.selectedId);
                    const title = document.createElement('strong');
                    title.textContent = entry.title || '未命名资料';
                    const meta = document.createElement('span');
                    meta.textContent = `${typeLabel(entry.type)}${entry.tags && entry.tags.length ? ` / ${entry.tags.slice(0, 3).join(', ')}` : ''}`;
                    const badge = document.createElement('span');
                    badge.className = 'desktop-compendium-injection-badge';
                    badge.dataset.mode = contextPolicyMode(entry);
                    badge.textContent = contextPolicyLabel(entry);
                    const summary = document.createElement('small');
                    summary.textContent = entry.summary || String(entry.body || '').slice(0, 80) || '没有摘要';
                    item.append(title, meta, badge, summary);
                    item.addEventListener('click', () => {
                        compendiumState.selectedId = entry.id;
                        compendiumState.dirty = false;
                        renderCompendium();
                    });
                    elements.list.appendChild(item);
                });
            }
        }

        if (elements.editorTitle) elements.editorTitle.textContent = selected ? selected.title : '选择资料条目';

        const editorEmpty = document.querySelector('[data-compendium-editor-empty]');
        const compendiumForm = document.querySelector('[data-compendium-form]');
        const emptyTitle = document.querySelector('[data-compendium-empty-title]');
        const emptyDesc = document.querySelector('[data-compendium-empty-desc]');
        if (!hasProject) {
            if (compendiumForm) compendiumForm.hidden = true;
            if (editorEmpty) {
                editorEmpty.hidden = false;
                if (emptyTitle) emptyTitle.textContent = '未打开项目';
                if (emptyDesc) emptyDesc.textContent = '从书库打开一个项目，即可编辑该项目的资料。';
            }
        } else if (!selected) {
            if (compendiumForm) compendiumForm.hidden = true;
            if (editorEmpty) {
                editorEmpty.hidden = false;
                if (emptyTitle) emptyTitle.textContent = '选择资料条目';
                if (emptyDesc) emptyDesc.textContent = '从左侧列表中选择资料卡进行编辑，或点击「新资料」创建资料卡。';
            }
        } else {
            if (editorEmpty) editorEmpty.hidden = true;
            if (compendiumForm) compendiumForm.hidden = false;
        }

        const fields = [
            elements.entryType,
            elements.title,
            elements.summary,
            elements.tags,
            elements.aliases,
            elements.always,
            elements.body,
            ...compendiumPolicyFields(elements),
            ...compendiumCharacterFields(elements)
        ];
        fields.forEach((field) => {
            if (field) field.disabled = !selected;
        });
        if (elements.save) elements.save.disabled = !selected;
        if (elements.deleteButton) elements.deleteButton.disabled = !selected;
        if (selected) {
            const policy = normalizedContextPolicy(selected);
            const triggers = policy.triggers || {};
            const characterProfile = selected.characterProfile || {};
            if (elements.entryType) elements.entryType.value = selected.type || 'lore';
            if (elements.title) elements.title.value = selected.title || '';
            if (elements.summary) elements.summary.value = selected.summary || '';
            if (elements.tags) elements.tags.value = (selected.tags || []).join(', ');
            if (elements.aliases) elements.aliases.value = (selected.aliases || []).join(', ');
            if (elements.always) elements.always.checked = policy.mode === 'always';
            if (elements.policyMode) elements.policyMode.value = policy.mode || 'manual';
            if (elements.triggerTitle) elements.triggerTitle.checked = triggers.title !== false;
            if (elements.triggerAliases) elements.triggerAliases.checked = triggers.aliases !== false;
            if (elements.triggerTags) elements.triggerTags.checked = triggers.tags !== false;
            if (elements.triggerPov) elements.triggerPov.checked = triggers.pov !== false;
            if (elements.triggerSceneCharacters) elements.triggerSceneCharacters.checked = triggers.sceneCharacters !== false;
            if (elements.character) elements.character.hidden = (selected.type || 'lore') !== 'character';
            if (elements.characterRole) elements.characterRole.value = characterProfile.role || '';
            if (elements.characterGoal) elements.characterGoal.value = characterProfile.goal || '';
            if (elements.characterMotivation) elements.characterMotivation.value = characterProfile.motivation || '';
            if (elements.characterConflict) elements.characterConflict.value = characterProfile.conflict || '';
            if (elements.characterVoice) elements.characterVoice.value = characterProfile.voice || '';
            if (elements.characterCurrentState) elements.characterCurrentState.value = characterProfile.currentState || '';
            if (elements.characterKnowledge) elements.characterKnowledge.value = characterProfile.knowledge || '';
            if (elements.characterRelationship) elements.characterRelationship.value = characterProfile.relationshipNotes || '';
            if (elements.body) elements.body.value = selected.body || '';
        } else {
            if (elements.character) elements.character.hidden = true;
            fields.forEach((field) => {
                if (!field) return;
                if (field.type === 'checkbox') field.checked = false;
                else field.value = '';
            });
        }
        renderContextStrip();
    }

    async function loadCompendium() {
        const projectId = currentProjectId();
        if (!projectId) {
            compendiumState.entries = [];
            compendiumState.selectedId = '';
            setCompendiumStatus('未打开项目', 'info');
            renderCompendium();
            return;
        }
        compendiumState.loading = true;
        setCompendiumStatus('正在读取资料...', 'info');
        renderCompendium();
        let failed = false;
        try {
            const params = new URLSearchParams({ projectId });
            const response = await fetch(`/api/compendium?${params.toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumState.entries = result.entries || [];
            if (!compendiumState.entries.some((entry) => entry.id === compendiumState.selectedId)) {
                compendiumState.selectedId = compendiumState.entries[0] ? compendiumState.entries[0].id : '';
            }
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.compendium = compendiumState.entries;
        } catch (error) {
            console.warn('Failed to load compendium:', error);
            compendiumState.entries = [];
            compendiumState.selectedId = '';
            failed = true;
            setCompendiumStatus(`读取资料失败：${error.message || error}`, 'error');
        } finally {
            compendiumState.loading = false;
            renderCompendium();
            if (!failed) setCompendiumCountStatus();
        }
    }

    function collectCompendiumForm() {
        const elements = compendiumElements();
        const selected = selectedCompendiumEntry();
        const mode = elements.policyMode ? (elements.policyMode.value || 'manual') : (elements.always && elements.always.checked ? 'always' : 'manual');
        const type = elements.entryType ? elements.entryType.value : 'lore';
        const characterProfile = {
            role: elements.characterRole ? elements.characterRole.value.trim() : '',
            goal: elements.characterGoal ? elements.characterGoal.value.trim() : '',
            motivation: elements.characterMotivation ? elements.characterMotivation.value.trim() : '',
            conflict: elements.characterConflict ? elements.characterConflict.value.trim() : '',
            voice: elements.characterVoice ? elements.characterVoice.value.trim() : '',
            currentState: elements.characterCurrentState ? elements.characterCurrentState.value.trim() : '',
            knowledge: elements.characterKnowledge ? elements.characterKnowledge.value.trim() : '',
            relationshipNotes: elements.characterRelationship ? elements.characterRelationship.value.trim() : ''
        };
        return {
            id: selected && selected.id,
            type,
            category: type,
            title: elements.title ? elements.title.value : '',
            summary: elements.summary ? elements.summary.value : '',
            tags: elements.tags ? parseCommaList(elements.tags.value) : [],
            aliases: elements.aliases ? parseCommaList(elements.aliases.value) : [],
            alwaysInContext: mode === 'always',
            contextPolicy: {
                mode,
                triggers: {
                    title: !elements.triggerTitle || elements.triggerTitle.checked,
                    aliases: !elements.triggerAliases || elements.triggerAliases.checked,
                    tags: !elements.triggerTags || elements.triggerTags.checked,
                    pov: !elements.triggerPov || elements.triggerPov.checked,
                    sceneCharacters: !elements.triggerSceneCharacters || elements.triggerSceneCharacters.checked
                }
            },
            characterProfile: type === 'character' ? characterProfile : undefined,
            body: elements.body ? elements.body.value : ''
        };
    }

    async function saveCompendiumEntry(event) {
        if (event) event.preventDefault();
        const projectId = currentProjectId();
        if (!projectId || !selectedCompendiumEntry()) return;
        try {
            const response = await fetch('/api/compendium', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, entry: collectCompendiumForm() })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await loadCompendium();
            compendiumState.selectedId = result.entry.id;
            renderCompendium();
            setCompendiumStatus('资料已保存', 'ok');
        } catch (error) {
            setCompendiumStatus(`保存失败：${error.message || error}`, 'error');
        }
    }

    async function createCompendiumEntry(typeOverride) {
        const projectId = currentProjectId();
        if (!projectId) return;
        const entryType = typeOverride || compendiumState.type || 'lore';
        try {
            const response = await fetch('/api/compendium', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    entry: {
                        type: entryType,
                        category: entryType,
                        title: entryType === 'character' ? '新人物' : '新资料',
                        body: ''
                    }
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumState.selectedId = result.entry.id;
            await loadCompendium();
            setCompendiumStatus(entryType === 'character' ? '已创建新人物卡' : '已创建新资料', 'ok');
        } catch (error) {
            setCompendiumStatus(`创建失败：${error.message || error}`, 'error');
        }
    }

    async function deleteCompendiumEntry() {
        const projectId = currentProjectId();
        const selected = selectedCompendiumEntry();
        if (!projectId || !selected) return;
        if (!window.confirm(`删除资料“${selected.title || '未命名资料'}”？`)) return;
        try {
            const response = await fetch('/api/delete-compendium-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, entryId: selected.id })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            compendiumState.selectedId = '';
            await loadCompendium();
            setCompendiumStatus('资料已删除', 'ok');
        } catch (error) {
            setCompendiumStatus(`删除失败：${error.message || error}`, 'error');
        }
    }

    function bindCompendium() {
        const elements = compendiumElements();
        if (elements.search) {
            elements.search.addEventListener('input', () => {
            compendiumState.query = elements.search.value || '';
            renderCompendium();
            setCompendiumCountStatus();
        });
        }
        if (elements.typeFilter) {
            elements.typeFilter.addEventListener('change', () => {
            compendiumState.type = elements.typeFilter.value || '';
            renderCompendium();
            setCompendiumCountStatus();
        });
        }
        if (elements.newButton) elements.newButton.addEventListener('click', createCompendiumEntry);
        if (elements.form) elements.form.addEventListener('submit', saveCompendiumEntry);
        if (elements.deleteButton) elements.deleteButton.addEventListener('click', deleteCompendiumEntry);
        [
            elements.entryType,
            elements.title,
            elements.summary,
            elements.tags,
            elements.aliases,
            elements.always,
            elements.body,
            ...compendiumPolicyFields(elements),
            ...compendiumCharacterFields(elements)
        ].forEach((field) => {
            if (!field) return;
            field.addEventListener('input', () => { compendiumState.dirty = true; });
            field.addEventListener('change', () => { compendiumState.dirty = true; });
        });
        if (elements.policyMode) {
            elements.policyMode.addEventListener('change', () => {
                if (elements.always) elements.always.checked = elements.policyMode.value === 'always';
            });
        }
        if (elements.always) {
            elements.always.addEventListener('change', () => {
                if (elements.policyMode) elements.policyMode.value = elements.always.checked ? 'always' : 'manual';
            });
        }
        if (elements.entryType) {
            elements.entryType.addEventListener('change', () => {
                if (elements.character) elements.character.hidden = elements.entryType.value !== 'character';
            });
        }
        renderCompendium();
    }

    function workshopElements() {
        return {
            projectLabel: document.querySelector('[data-workshop-project-label]'),
            projectSummary: document.querySelector('[data-workshop-project-summary]'),
            projectName: document.querySelector('[data-workshop-project-name]'),
            projectStats: document.querySelector('[data-workshop-project-stats]'),
            status: document.querySelector('[data-workshop-status]'),
            newButton: document.querySelector('[data-workshop-new]'),
            list: document.querySelector('[data-workshop-session-list]'),
            title: document.querySelector('[data-workshop-title]'),
            deleteButton: document.querySelector('[data-workshop-delete]'),
            messages: document.querySelector('[data-workshop-messages]'),
            emptyState: document.querySelector('[data-workshop-empty]'),
            emptyContent: document.querySelector('[data-workshop-empty-content]'),
            input: document.querySelector('[data-workshop-input]'),
            inputRow: document.querySelector('.desktop-workshop-input-row'),
            send: document.querySelector('[data-workshop-send]'),
            toCompendium: document.querySelector('[data-workshop-to-compendium]'),
            toSummary: document.querySelector('[data-workshop-to-summary]'),
            insertDraft: document.querySelector('[data-workshop-insert-draft]'),
            outputActions: document.querySelector('[data-workshop-output-actions]')
        };
    }

    function selectedWorkshopSession() {
        return workshopState.sessions.find((session) => session.id === workshopState.selectedId) || null;
    }

    function selectedAssistantMessage() {
        const session = selectedWorkshopSession();
        if (!session) return null;
        if (workshopState.selectedAssistantMessageId) {
            const selected = (session.messages || []).find((message) => message.id === workshopState.selectedAssistantMessageId);
            if (selected && selected.role === 'assistant') return selected;
        }
        return [...(session.messages || [])].reverse().find((message) => message.role === 'assistant' && message.content) || null;
    }

    function setWorkshopStatus(message, tone = 'info') {
        const { status } = workshopElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function renderWorkshop() {
        const elements = workshopElements();
        const projectId = currentProjectId();
        const projectName = currentProjectName();
        const session = selectedWorkshopSession();
        const assistant = selectedAssistantMessage();
        if (elements.projectLabel) elements.projectLabel.textContent = projectId ? `当前项目：${projectName}` : '请先在书库打开或新建一个项目。';
        if (elements.projectSummary) {
            elements.projectSummary.hidden = !projectId;
            if (projectId) {
                if (elements.projectName) elements.projectName.textContent = projectName;
                const scene = currentNativeScene();
                const entries = compendiumState.entries || [];
                if (elements.projectStats) elements.projectStats.textContent = `${workshopState.sessions.length} 个对话${entries.length ? ` · ${entries.length} 张资料` : ''}${scene ? ` · 当前场景：${scene.title || '未命名'}` : ''}`;
            }
        }
        if (elements.newButton) elements.newButton.disabled = !projectId || workshopState.generating;
        if (elements.deleteButton) elements.deleteButton.disabled = !session || workshopState.generating;
        if (elements.title) elements.title.textContent = session ? session.title : '选择或新建对话';
        if (elements.input && elements.input.value !== workshopState.input) elements.input.value = workshopState.input;
        if (elements.input) elements.input.disabled = !session || workshopState.generating;
        if (elements.inputRow) elements.inputRow.hidden = !session;
        if (elements.send) elements.send.disabled = !session || workshopState.generating || !workshopState.input.trim();
        [elements.toCompendium, elements.toSummary, elements.insertDraft].forEach((button) => {
            if (button) {
                button.disabled = !assistant || workshopState.generating;
            }
        });
        if (elements.outputActions) elements.outputActions.hidden = !assistant;

        if (elements.list) {
            elements.list.replaceChildren();
            if (!projectId) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workshop-session';
                empty.textContent = '打开项目后创建对话。';
                elements.list.appendChild(empty);
            } else if (!workshopState.sessions.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workshop-session';
                empty.textContent = '还没有对话。';
                elements.list.appendChild(empty);
            } else {
                workshopState.sessions.forEach((item) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-workshop-session';
                    button.classList.toggle('is-active', item.id === workshopState.selectedId);
                    const title = document.createElement('strong');
                    title.textContent = item.title || '新对话';
                    const meta = document.createElement('span');
                    meta.textContent = `${(item.messages || []).length} 条消息`;
                    button.append(title, meta);
                    button.addEventListener('click', () => {
                        workshopState.selectedId = item.id;
                        workshopState.selectedAssistantMessageId = '';
                        renderWorkshop();
                    });
                    elements.list.appendChild(button);
                });
            }
        }

        if (elements.emptyState && elements.emptyContent) {
            const hasMessages = session && (session.messages || []).length > 0;
            if (!projectId) {
                elements.emptyState.hidden = false;
                elements.emptyContent.replaceChildren();
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\uD83D\uDCAC';
                const heading = document.createElement('h3');
                heading.textContent = '创作讨论空间';
                const desc = document.createElement('p');
                desc.textContent = '在 Workshop 中与 AI 讨论角色、情节、设定，并将讨论结果转化为资料、摘要或正文。';
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '去书库打开项目';
                action.addEventListener('click', () => setView('bookshelf'));
                elements.emptyContent.append(icon, heading, desc, action);
            } else if (!workshopState.sessions.length) {
                elements.emptyState.hidden = false;
                elements.emptyContent.replaceChildren();
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\u270D\uFE0F';
                const heading = document.createElement('h3');
                heading.textContent = '创建第一场讨论';
                const desc = document.createElement('p');
                desc.textContent = `在《${projectName}》的创作讨论中，与 AI 协作推进故事。`;
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '开始新对话';
                action.addEventListener('click', () => createWorkshopSession());
                action.disabled = workshopState.generating;
                elements.emptyContent.append(icon, heading, desc, action);
            } else if (!session) {
                elements.emptyState.hidden = false;
                elements.emptyContent.replaceChildren();
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\uD83D\uDCDD';
                const heading = document.createElement('h3');
                heading.textContent = '选择对话';
                const desc = document.createElement('p');
                const count = workshopState.sessions.length;
                desc.textContent = `共有 ${count} 个对话。从左侧列表选择或新建。`;
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '新建对话';
                action.addEventListener('click', () => createWorkshopSession());
                action.disabled = workshopState.generating;
                elements.emptyContent.append(icon, heading, desc, action);
            } else {
                elements.emptyState.hidden = true;
            }
        }

        if (elements.messages) {
            elements.messages.replaceChildren();
            if (!session || !(session.messages || []).length) {
                if (elements.emptyState && !elements.emptyState.hidden) {
                    /* empty state is already shown */
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'desktop-workshop-message';
                    empty.textContent = '输入一个问题开始讨论。';
                    elements.messages.appendChild(empty);
                }
            } else {
                (session.messages || []).forEach((message) => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'desktop-workshop-message';
                    item.dataset.role = message.role;
                    const isAssistant = message.role === 'assistant';
                    if (isAssistant && message.id === workshopState.selectedAssistantMessageId) {
                        item.classList.add('is-selected');
                    }
                    const avatar = document.createElement('span');
                    avatar.className = 'desktop-workshop-message-avatar';
                    avatar.textContent = isAssistant ? '助' : '我';
                    const body = document.createElement('div');
                    body.className = 'desktop-workshop-message-body';
                    const role = document.createElement('strong');
                    role.className = 'desktop-workshop-message-role';
                    role.textContent = isAssistant ? '助手' : '你';
                    const content = document.createElement('div');
                    content.className = 'desktop-workshop-message-text';
                    content.textContent = message.content || (isAssistant && workshopState.generating ? '生成中...' : '');
                    body.append(role, content);
                    item.append(avatar, body);
                    item.addEventListener('click', () => {
                        if (isAssistant) {
                            workshopState.selectedAssistantMessageId = message.id;
                            renderWorkshop();
                        }
                    });
                    elements.messages.appendChild(item);
                });
                elements.messages.scrollTop = elements.messages.scrollHeight;
            }
        }
        if (projectId && !workshopState.generating) setWorkshopStatus(`${workshopState.sessions.length} 个对话`, 'ok');
        renderContextStrip();
    }

    async function loadWorkshopSessions() {
        const projectId = currentProjectId();
        if (!projectId) {
            workshopState.sessions = [];
            workshopState.selectedId = '';
            setWorkshopStatus('未打开项目', 'info');
            renderWorkshop();
            return;
        }
        try {
            const response = await fetch(`/api/workshop-sessions?${new URLSearchParams({ projectId }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workshopState.sessions = result.sessions || [];
            if (!workshopState.sessions.some((session) => session.id === workshopState.selectedId)) {
                workshopState.selectedId = workshopState.sessions[0] ? workshopState.sessions[0].id : '';
            }
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workshopSessions = workshopState.sessions;
        } catch (error) {
            console.warn('Failed to load workshop sessions:', error);
            setWorkshopStatus(`读取对话失败：${error.message || error}`, 'error');
        }
        renderWorkshop();
    }

    async function saveWorkshopSession(session) {
        const projectId = currentProjectId();
        if (!projectId || !session) return null;
        const response = await fetch('/api/workshop-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, session })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        return result.session;
    }

    async function createWorkshopSession() {
        const projectId = currentProjectId();
        if (!projectId || !window.DraftHarborWorkshopSchema) return;
        const session = window.DraftHarborWorkshopSchema.createWorkshopSession({
            projectId,
            title: `对话 ${workshopState.sessions.length + 1}`
        });
        const saved = await saveWorkshopSession(session);
        workshopState.sessions = [saved, ...workshopState.sessions];
        workshopState.selectedId = saved.id;
        workshopState.selectedAssistantMessageId = '';
        renderWorkshop();
    }

    async function sendWorkshopMessage() {
        const projectId = currentProjectId();
        const session = selectedWorkshopSession();
        const text = workshopState.input.trim();
        if (!projectId || !session || !text || workshopState.generating) return;
        const userMessage = window.DraftHarborWorkshopSchema.createWorkshopMessage({ role: 'user', content: text });
        const assistantMessage = window.DraftHarborWorkshopSchema.createWorkshopMessage({ role: 'assistant', content: '' });
        session.messages = [...(session.messages || []), userMessage, assistantMessage];
        session.updatedAt = new Date().toISOString();
        workshopState.input = '';
        workshopState.generating = true;
        setWorkshopStatus('生成中...', 'info');
        renderWorkshop();
        try {
            const workshopPrompts = (nativeEditorState.snapshot && nativeEditorState.snapshot.prompts || []).filter((prompt) => prompt.category === 'workshop');
            const prompt = window.DraftHarborWorkshopPrompt.buildWorkshopPrompt({
                project: {
                    ...nativeEditorState.snapshot,
                    currentSceneId: nativeEditorState.activeSceneId
                },
                session: {
                    ...session,
                    messages: session.messages.slice(0, -2)
                },
                template: workshopPrompts[0] || {},
                message: text,
                currentSceneId: nativeEditorState.activeSceneId
            });
            if (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function') {
                throw new Error('Provider stream is not loaded');
            }
            await window.DraftHarborProviderStream.streamGeneration(prompt, (token) => {
                assistantMessage.content += token;
                renderWorkshop();
            }, runtimeProviderConfig());
            const saved = await saveWorkshopSession(session);
            const index = workshopState.sessions.findIndex((item) => item.id === saved.id);
            if (index >= 0) workshopState.sessions[index] = saved;
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workshopSessions = workshopState.sessions;
            setWorkshopStatus('对话已保存', 'ok');
        } catch (error) {
            assistantMessage.content = `Error: ${error.message || error}`;
            assistantMessage.isError = true;
            try { await saveWorkshopSession(session); } catch {}
            setWorkshopStatus(`生成失败：${error.message || error}`, 'error');
        } finally {
            workshopState.generating = false;
            renderWorkshop();
        }
    }

    async function deleteWorkshopSession() {
        const projectId = currentProjectId();
        const session = selectedWorkshopSession();
        if (!projectId || !session) return;
        if (!window.confirm(`删除对话“${session.title || '新对话'}”？`)) return;
        const response = await fetch('/api/delete-workshop-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, sessionId: session.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setWorkshopStatus(`删除失败：${result.error || response.status}`, 'error');
            return;
        }
        workshopState.sessions = workshopState.sessions.filter((item) => item.id !== session.id);
        workshopState.selectedId = workshopState.sessions[0] ? workshopState.sessions[0].id : '';
        renderWorkshop();
    }

    async function workshopOutputToCompendium() {
        const message = selectedAssistantMessage();
        const projectId = currentProjectId();
        if (!message || !projectId) return;
        const scene = currentNativeScene();
        const sceneTitle = scene && scene.title ? scene.title : '';
        const title = sceneTitle ? `Workshop 讨论：${sceneTitle}` : `Workshop 讨论 ${new Date().toLocaleDateString('zh-CN')}`;
        const response = await fetch('/api/compendium', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                entry: {
                    type: 'note',
                    title,
                    summary: message.content.slice(0, 140),
                    body: message.content,
                    tags: ['workshop', sceneTitle].filter(Boolean),
                    contextPolicy: { mode: 'manual' },
                    alwaysInContext: false
                }
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setWorkshopStatus(`转资料失败：${result.error || response.status}`, 'error');
            return;
        }
        await loadCompendium();
        setWorkshopStatus(`已转为资料条目：${title}`, 'ok');
    }

    function workshopOutputToSummary() {
        const message = selectedAssistantMessage();
        const scene = currentNativeScene();
        if (!message || !scene) return;
        scene.summary = message.content.slice(0, 600);
        const elements = nativeEditorElements();
        if (elements.summary) elements.summary.value = scene.summary;
        renderNativeEditor();
        markNativeDirty('已写入场景摘要，未保存');
        setWorkshopStatus('已写入当前场景摘要', 'ok');
    }

    function workshopOutputInsertDraft() {
        const message = selectedAssistantMessage();
        const elements = nativeEditorElements();
        if (!message || !elements.editor) return;
        elements.editor.value = elements.editor.value ? `${elements.editor.value}\n\n${message.content}` : message.content;
        flushNativeEditorFields();
        renderNativeEditor();
        markNativeDirty('已插入正文，未保存');
        setWorkshopStatus('已插入当前正文', 'ok');
    }

    function nativeSelectedOrSceneExcerpt() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const text = elements.editor ? String(elements.editor.value || '') : (scene ? nativeSceneContent(scene.id) : '');
        let selected = '';
        if (elements.editor && elements.editor.selectionStart !== elements.editor.selectionEnd) {
            selected = text.slice(elements.editor.selectionStart, elements.editor.selectionEnd).trim();
        }
        const fallback = (scene && scene.summary ? scene.summary : text).trim();
        return {
            scene,
            selected,
            text: selected || fallback.slice(0, 1200),
            fullText: text
        };
    }

    async function ensureWorkshopSession() {
        let session = selectedWorkshopSession();
        if (session) return session;
        await createWorkshopSession();
        return selectedWorkshopSession();
    }

    async function sendNativeSelectionToWorkshop() {
        const projectId = currentProjectId();
        const payload = nativeSelectedOrSceneExcerpt();
        if (!projectId || !payload.scene || !payload.text) return;
        const session = await ensureWorkshopSession();
        if (!session) return;
        const sceneTitle = payload.scene.title || '当前场景';
        workshopState.input = [
            `请基于《${sceneTitle}》帮我讨论这段内容的下一步处理。`,
            '',
            payload.selected ? '选中片段：' : '场景片段：',
            payload.text
        ].join('\n');
        setView('workshop');
        renderWorkshop();
        const elements = workshopElements();
        if (elements.input) {
            elements.input.focus();
            elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
        }
    }

    async function saveNativeSelectionToCompendium() {
        const projectId = currentProjectId();
        const payload = nativeSelectedOrSceneExcerpt();
        if (!projectId || !payload.scene || !payload.text) return;
        const sceneTitle = payload.scene.title || '当前场景';
        const title = `来自《${sceneTitle}》的片段`;
        const response = await fetch('/api/compendium', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                entry: {
                    type: 'note',
                    title,
                    summary: payload.text.slice(0, 140),
                    body: payload.text,
                    tags: ['writer-fragment', sceneTitle].filter(Boolean),
                    contextPolicy: { mode: 'manual' },
                    alwaysInContext: false
                }
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setNativeSaveStatus(`保存资料失败：${result.error || response.status}`, 'error');
            return;
        }
        await loadCompendium();
        setNativeSaveStatus(`片段已保存为资料：${title}`, 'ok');
        setView('compendium');
    }

    function bindWorkshop() {
        const elements = workshopElements();
        if (elements.newButton) elements.newButton.addEventListener('click', createWorkshopSession);
        if (elements.deleteButton) elements.deleteButton.addEventListener('click', deleteWorkshopSession);
        if (elements.input) {
            elements.input.addEventListener('input', () => {
                workshopState.input = elements.input.value;
                renderWorkshop();
            });
            elements.input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendWorkshopMessage();
                }
            });
        }
        if (elements.send) elements.send.addEventListener('click', sendWorkshopMessage);
        if (elements.toCompendium) elements.toCompendium.addEventListener('click', workshopOutputToCompendium);
        if (elements.toSummary) elements.toSummary.addEventListener('click', workshopOutputToSummary);
        if (elements.insertDraft) elements.insertDraft.addEventListener('click', workshopOutputInsertDraft);
        renderWorkshop();
    }

    function workflowElements() {
        return {
            projectLabel: document.querySelector('[data-workflow-project-label]'),
            brief: document.querySelector('[data-workflow-brief]'),
            start: document.querySelector('[data-workflow-start]'),
            status: document.querySelector('[data-workflow-status]'),
            runList: document.querySelector('[data-workflow-run-list]'),
            title: document.querySelector('[data-workflow-title]'),
            generate: document.querySelector('[data-workflow-generate]'),
            applyArtifact: document.querySelector('[data-workflow-apply-artifact]'),
            approve: document.querySelector('[data-workflow-approve]'),
            reject: document.querySelector('[data-workflow-reject]'),
            cancel: document.querySelector('[data-workflow-cancel]'),
            steps: document.querySelector('[data-workflow-steps]'),
            stageActions: document.querySelector('[data-workflow-stage-actions]'),
            artifacts: document.querySelector('[data-workflow-artifacts]'),
            events: document.querySelector('[data-workflow-events]'),
            eventsDetails: document.querySelector('[data-workflow-events-details]'),
            eventsSummary: document.querySelector('[data-workflow-events-summary]'),
            eventsCount: document.querySelector('[data-workflow-events-count]')
        };
    }

    function selectedWorkflowRun() {
        return workflowState.runs.find((run) => run.id === workflowState.selectedId) || null;
    }

    function activeWorkflowStep(run = selectedWorkflowRun()) {
        if (!run) return null;
        return (run.steps || []).find((step) => step.id === run.activeStepId)
            || (run.steps || []).find((step) => ['ready', 'waiting_user'].includes(step.status))
            || null;
    }

    function latestWorkflowArtifact(run, type) {
        const artifacts = (run && run.artifacts) || [];
        const matches = artifacts.filter((artifact) => !type || artifact.type === type);
        return matches[matches.length - 1] || null;
    }

    function setWorkflowStatus(message, tone = 'info') {
        const { status } = workflowElements();
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function renderWorkflow() {
        const elements = workflowElements();
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        const isTerminalRun = run && ['completed', 'cancelled', 'failed'].includes(run.status);
        const draftArtifact = latestWorkflowArtifact(run, 'draft_text');
        if (elements.projectLabel) {
            const project = nativeEditorState.snapshot && nativeEditorState.snapshot.project;
            elements.projectLabel.textContent = project ? `当前项目：${project.name || project.title || project.id}` : '请先在书库打开或新建一个项目。';
        }
        if (elements.start) elements.start.disabled = !projectId || workflowState.generating;
        if (elements.title) {
            if (!projectId) {
                elements.title.textContent = '请先打开项目';
            } else if (!run) {
                elements.title.textContent = '创建你的第一个创作流程';
            } else {
                const stepTitle = step ? (step.id || step.title || '当前步骤') : '完成';
                elements.title.textContent = `${run.title || '创作流程'} · ${stepTitle}`;
            }
        }
        if (elements.runList) {
            elements.runList.replaceChildren();
            if (!projectId) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workflow-run';
                empty.textContent = '打开项目后启动创作流程。';
                elements.runList.appendChild(empty);
            } else if (!workflowState.runs.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-workflow-run';
                empty.textContent = '还没有创作流程。在下方写出你的想法。';
                elements.runList.appendChild(empty);
            } else {
                workflowState.runs.forEach((item) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-workflow-run';
                    button.classList.toggle('is-active', item.id === workflowState.selectedId);
                    const statusLabels = { completed: '已完成', cancelled: '已取消', failed: '异常', in_progress: '进行中' };
                    const statusText = statusLabels[item.status] || item.status;
                    button.innerHTML = `<strong>${item.title || '创作流程'}</strong><span>${statusText}${item.activeStepId ? ` · ${item.activeStepId}` : ''}</span>`;
                    button.addEventListener('click', async () => {
                        workflowState.selectedId = item.id;
                        await loadWorkflowEvents();
                        renderWorkflow();
                    });
                    elements.runList.appendChild(button);
                });
            }
        }
        if (elements.steps) {
            elements.steps.replaceChildren();
            const hasSteps = run && run.steps && run.steps.length;
            if (!projectId) {
                const guideDiv = document.createElement('div');
                guideDiv.className = 'desktop-workflow-steps-guide';
                guideDiv.dataset.workflowGuide = '';
                const icon = document.createElement('p');
                icon.className = 'desktop-workshop-empty-icon';
                icon.textContent = '\uD83D\uDCCB';
                const heading = document.createElement('h3');
                heading.textContent = '创作流程看板';
                const desc = document.createElement('p');
                desc.textContent = '打开项目后，在这里设置创作 Brief，启动按步骤引导的写作流程。';
                const action = document.createElement('button');
                action.className = 'desktop-primary-action';
                action.type = 'button';
                action.textContent = '去书库打开项目';
                action.addEventListener('click', () => setView('bookshelf'));
                guideDiv.append(icon, heading, desc, action);
                elements.steps.appendChild(guideDiv);
            } else if (!hasSteps) {
                const guideDiv = document.createElement('div');
                guideDiv.className = 'desktop-workflow-steps-guide';
                guideDiv.dataset.workflowGuide = '';
                const kicker = document.createElement('p');
                kicker.className = 'desktop-section-kicker';
                kicker.textContent = '创作流程指引';
                guideDiv.appendChild(kicker);

                const timeline = document.createElement('div');
                timeline.className = 'desktop-workflow-steps-timeline';
                const milestones = [
                    { num: 1, title: '设定 Brief', desc: '在左侧写下题材、主线、角色、限制和目标' },
                    { num: 2, title: '启动流程', desc: '点击「开始创作流程」按钮进入引导步骤' },
                    { num: 3, title: '逐步执行', desc: '按顺序批准、退回或重新生成每个步骤' },
                    { num: 4, title: '采纳产物', desc: '将生成的正文草稿写入当前项目' }
                ];
                milestones.forEach((m) => {
                    const item = document.createElement('div');
                    item.className = 'desktop-workflow-milestone';
                    const mark = document.createElement('span');
                    mark.className = 'desktop-workflow-milestone-mark';
                    mark.textContent = String(m.num);
                    const body = document.createElement('div');
                    const strong = document.createElement('strong');
                    strong.textContent = m.title;
                    const span = document.createElement('span');
                    span.textContent = m.desc;
                    body.append(strong, span);
                    item.append(mark, body);
                    timeline.appendChild(item);
                });
                guideDiv.appendChild(timeline);
                elements.steps.appendChild(guideDiv);
            }
            (run && run.steps || []).forEach((item, index) => {
                const card = document.createElement('article');
                card.className = 'desktop-workflow-step-card';
                card.classList.toggle('is-active', item.id === (step && step.id));
                const statusClass = item.status === 'completed' ? 'is-done' : (item.status === 'failed' ? 'is-failed' : (item.status === 'in_progress' ? 'is-progress' : ''));
                if (statusClass) card.classList.add(statusClass);

                const header = document.createElement('div');
                header.className = 'desktop-workflow-step-card-header';
                const mark = document.createElement('span');
                mark.className = 'desktop-workflow-step-mark';
                mark.textContent = String(index + 1);
                const meta = document.createElement('div');
                meta.className = 'desktop-workflow-step-card-meta';
                const title = document.createElement('strong');
                title.textContent = item.title || item.id;
                const statusText = document.createElement('span');
                const stepStatusLabels = { completed: '已完成', failed: '失败', in_progress: '生成中', waiting_user: '等待审批', ready: '准备执行', pending: '待处理' };
                statusText.textContent = `${stepStatusLabels[item.status] || item.status} · ${item.kind || ''}`;
                meta.append(title, statusText);
                header.append(mark, meta);
                card.appendChild(header);

                if (item.description) {
                    const desc = document.createElement('p');
                    desc.className = 'desktop-workflow-step-card-desc';
                    desc.textContent = item.description;
                    card.appendChild(desc);
                }
                elements.steps.appendChild(card);
            });
        }

        if (elements.stageActions) {
            elements.stageActions.replaceChildren();
            elements.stageActions.hidden = !run;
            if (run) {
                const hasActiveStep = step && !isTerminalRun;
                const generateActionBtn = document.createElement('button');
                generateActionBtn.className = 'desktop-primary-action';
                generateActionBtn.type = 'button';
                generateActionBtn.dataset.workflowGenerate = '';
                generateActionBtn.textContent = `生成：${step ? (step.title || step.id) : '当前步骤'}`;
                generateActionBtn.disabled = !hasActiveStep || step.kind !== 'generation' || workflowState.generating || step.status === 'completed';
                generateActionBtn.addEventListener('click', generateWorkflowStep);

                const approveBtn = document.createElement('button');
                approveBtn.className = 'desktop-secondary-action';
                approveBtn.type = 'button';
                approveBtn.dataset.workflowApprove = '';
                approveBtn.textContent = '批准';
                approveBtn.disabled = !hasActiveStep || workflowState.generating || !['waiting_user', 'ready'].includes(step.status);
                approveBtn.addEventListener('click', () => approveWorkflowStep().catch((error) => setWorkflowStatus(`批准失败：${error.message || error}`, 'error')));

                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'desktop-secondary-action';
                rejectBtn.type = 'button';
                rejectBtn.dataset.workflowReject = '';
                rejectBtn.textContent = '退回';
                rejectBtn.disabled = !hasActiveStep || workflowState.generating || step.status === 'completed';
                rejectBtn.addEventListener('click', () => rejectWorkflowStep().catch((error) => setWorkflowStatus(`退回失败：${error.message || error}`, 'error')));

                const adoptBtn = document.createElement('button');
                adoptBtn.className = 'desktop-secondary-action';
                adoptBtn.type = 'button';
                adoptBtn.dataset.workflowApplyArtifact = '';
                adoptBtn.textContent = '采纳草稿';
                adoptBtn.disabled = !projectId || isTerminalRun || !draftArtifact || workflowState.generating;
                adoptBtn.addEventListener('click', () => applyWorkflowArtifact().catch((error) => setWorkflowStatus(`采纳失败：${error.message || error}`, 'error')));

                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'desktop-mini-action';
                cancelBtn.type = 'button';
                cancelBtn.dataset.workflowCancel = '';
                cancelBtn.textContent = '取消流程';
                cancelBtn.disabled = isTerminalRun || workflowState.generating;
                cancelBtn.addEventListener('click', () => cancelWorkflowRun().catch((error) => setWorkflowStatus(`取消失败：${error.message || error}`, 'error')));

                elements.stageActions.append(generateActionBtn, approveBtn, rejectBtn, adoptBtn, cancelBtn);
            }
        }

        if (elements.artifacts) {
            elements.artifacts.replaceChildren();
            const hasArtifacts = run && run.artifacts && run.artifacts.length > 0;
            elements.artifacts.hidden = !hasArtifacts;
            if (hasArtifacts) {
                const label = document.createElement('p');
                label.className = 'desktop-workflow-artifacts-label';
                label.textContent = '最新产物';
                elements.artifacts.appendChild(label);
                (run.artifacts || []).slice().reverse().slice(0, 1).forEach((artifact) => {
                    const card = document.createElement('article');
                    card.className = 'desktop-workflow-artifact';
                    const content = document.createElement('pre');
                    content.textContent = artifact.content || '';
                    card.innerHTML = `<strong>${artifact.title || artifact.type}</strong><span>${artifact.type} / ${artifact.stepId || ''}</span>`;
                    card.appendChild(content);
                    elements.artifacts.appendChild(card);
                });
            }
        }
        if (elements.events) {
            elements.events.replaceChildren();
            const eventCount = workflowState.events.length;
            if (elements.eventsCount) elements.eventsCount.textContent = eventCount ? `${eventCount} 条` : '';
            workflowState.events.slice().reverse().forEach((event) => {
                const card = document.createElement('div');
                card.className = 'desktop-workflow-event';
                card.textContent = `${formatDate(event.createdAt)} / ${event.type}${event.stepId ? ` / ${event.stepId}` : ''}`;
                elements.events.appendChild(card);
            });
            if (elements.eventsDetails && !run) {
                elements.eventsDetails.hidden = true;
            } else if (elements.eventsDetails) {
                elements.eventsDetails.hidden = false;
                if (eventCount === 0) {
                    elements.eventsDetails.open = false;
                }
            }
        }
        if (projectId && !workflowState.generating) setWorkflowStatus(`${workflowState.runs.length} 个运行`, 'ok');
    }

    async function loadWorkflowRuns() {
        const projectId = currentProjectId();
        if (!projectId) {
            workflowState.runs = [];
            workflowState.selectedId = '';
            workflowState.events = [];
            renderWorkflow();
            return;
        }
        try {
            const response = await fetch(`/api/workflows?${new URLSearchParams({ projectId }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            workflowState.runs = result.runs || [];
            if (!workflowState.runs.some((run) => run.id === workflowState.selectedId)) {
                workflowState.selectedId = workflowState.runs[0] ? workflowState.runs[0].id : '';
            }
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
            await loadWorkflowEvents();
        } catch (error) {
            console.warn('Failed to load workflows:', error);
            workflowState.runs = [];
            workflowState.selectedId = '';
            workflowState.events = [];
            setWorkflowStatus(`读取工作流失败：${error.message || error}`, 'error');
        }
        renderWorkflow();
    }

    async function loadWorkflowEvents() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run) {
            workflowState.events = [];
            return;
        }
        const response = await fetch(`/api/workflow-events?${new URLSearchParams({ projectId, runId: run.id }).toString()}`, { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        workflowState.events = response.ok && result.ok ? (result.events || []) : [];
    }

    async function startWorkflowRun() {
        const projectId = currentProjectId();
        const elements = workflowElements();
        if (!projectId) return;
        setWorkflowStatus('正在创建运行前快照...', 'info');
        const response = await fetch('/api/workflows/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                brief: elements.brief ? elements.brief.value : ''
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = [result.run, ...workflowState.runs.filter((run) => run.id !== result.run.id)];
        workflowState.selectedId = result.run.id;
        if (nativeEditorState.snapshot) nativeEditorState.snapshot.workflowRuns = workflowState.runs;
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('工作流已启动，运行前快照已创建。', 'ok');
    }

    async function generateWorkflowStep() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step || step.kind !== 'generation' || workflowState.generating) return;
        workflowState.generating = true;
        workflowState.generatedText = '';
        setWorkflowStatus(`正在生成：${step.title || step.id}`, 'info');
        renderWorkflow();
        try {
            const prepareResponse = await fetch('/api/workflows/prepare-step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, runId: run.id, stepId: step.id })
            });
            const prepared = await prepareResponse.json().catch(() => ({}));
            if (!prepareResponse.ok || !prepared.ok) throw new Error(prepared.error || `HTTP ${prepareResponse.status}`);
            if (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function') {
                throw new Error('Native generation provider stream is not loaded.');
            }
            await window.DraftHarborProviderStream.streamGeneration(prepared.prompt, (token) => {
                workflowState.generatedText += token;
                const currentRun = selectedWorkflowRun();
                const existing = latestWorkflowArtifact(currentRun, 'generation_result');
                if (!existing && currentRun) {
                    currentRun.artifacts = currentRun.artifacts || [];
                    currentRun.artifacts.push({
                        id: 'workflow-live-generation',
                        type: 'generation_result',
                        title: '生成中',
                        stepId: step.id,
                        content: workflowState.generatedText,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                } else if (existing && existing.id === 'workflow-live-generation') {
                    existing.content = workflowState.generatedText;
                }
                renderWorkflow();
            }, runtimeProviderConfig());
            const completeResponse = await fetch('/api/workflows/complete-generation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    runId: run.id,
                    stepId: step.id,
                    result: {
                        text: workflowState.generatedText,
                        prompt: prepared.prompt
                    }
                })
            });
            const completed = await completeResponse.json().catch(() => ({}));
            if (!completeResponse.ok || !completed.ok) throw new Error(completed.error || `HTTP ${completeResponse.status}`);
            workflowState.runs = workflowState.runs.map((item) => item.id === completed.run.id ? completed.run : item);
            await loadWorkflowEvents();
            setWorkflowStatus('步骤已生成，等待人工确认。', 'ok');
        } catch (error) {
            console.warn('Workflow generation failed:', error);
            setWorkflowStatus(`工作流生成失败：${error.message || error}`, 'error');
        } finally {
            workflowState.generating = false;
            workflowState.generatedText = '';
            renderWorkflow();
        }
    }

    async function approveWorkflowStep() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step) return;
        const response = await fetch('/api/workflows/approve-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, stepId: step.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        if (result.applyResult && result.applyResult.applied) {
            const refreshed = await fetchProjectSnapshot({ id: projectId });
            loadNativeProjectEditor(refreshed, { id: projectId, source: 'project-directory' });
            loadReaderFromProjectSnapshot(refreshed);
            await loadProjectLibrary();
        }
        renderWorkflow();
        setWorkflowStatus(result.run.status === 'completed' ? '工作流已完成，草稿已写入项目。' : '步骤已批准。', 'ok');
    }

    async function rejectWorkflowStep() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const step = activeWorkflowStep(run);
        if (!projectId || !run || !step) return;
        const reason = window.prompt('退回原因', '需要调整后重新生成。') || '';
        const response = await fetch('/api/workflows/reject-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, stepId: step.id, reason })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('步骤已退回，可重新生成。', 'ok');
    }

    async function applyWorkflowArtifact() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const draftArtifact = latestWorkflowArtifact(run, 'draft_text');
        if (!projectId || !run || !draftArtifact) return;
        const response = await fetch('/api/workflows/apply-artifact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, artifactId: draftArtifact.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        if (result.applyResult && result.applyResult.applied) {
            const refreshed = await fetchProjectSnapshot({ id: projectId });
            loadNativeProjectEditor(refreshed, { id: projectId, source: 'project-directory' });
            loadReaderFromProjectSnapshot(refreshed);
            await loadProjectLibrary();
        }
        renderWorkflow();
        setWorkflowStatus('草稿已采纳到当前项目，工作流仍可继续调整。', 'ok');
    }

    async function cancelWorkflowRun() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        if (!projectId || !run) return;
        const reason = window.prompt('取消原因', '用户取消此工作流。') || '';
        const response = await fetch('/api/workflows/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, reason })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === result.run.id ? result.run : item);
        await loadWorkflowEvents();
        renderWorkflow();
        setWorkflowStatus('工作流已取消。', 'ok');
    }

    function bindWorkflow() {
        const elements = workflowElements();
        if (elements.start) elements.start.addEventListener('click', () => startWorkflowRun().catch((error) => setWorkflowStatus(`启动失败：${error.message || error}`, 'error')));
        renderWorkflow();
    }

    function setNativeSaveStatus(message, tone = 'info') {
        const { saveStatus, paperStatus } = nativeEditorElements();
        if (!saveStatus) return;
        saveStatus.textContent = message || '';
        saveStatus.dataset.tone = tone;
        if (paperStatus) {
            paperStatus.textContent = message || (currentNativeScene() ? '本地草稿' : '未选择场景');
            paperStatus.dataset.tone = tone;
        }
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    function loadNativeEditorPrefs() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(NATIVE_EDITOR_PREFS_STORAGE_KEY) || '{}');
            nativeEditorState.editorPrefs = {
                fontSize: clampNumber(saved.fontSize, 15, 24, nativeEditorState.editorPrefs.fontSize),
                lineHeight: clampNumber(saved.lineHeight, 1.45, 2.2, nativeEditorState.editorPrefs.lineHeight),
                textWidth: clampNumber(saved.textWidth, 620, 1040, nativeEditorState.editorPrefs.textWidth),
                paragraphSpacing: clampNumber(saved.paragraphSpacing, 0, 1.5, nativeEditorState.editorPrefs.paragraphSpacing),
                fontFamily: ['system', 'serif', 'yahei'].includes(saved.fontFamily) ? saved.fontFamily : nativeEditorState.editorPrefs.fontFamily,
                wordGoal: clampNumber(saved.wordGoal, 0, 999999, nativeEditorState.editorPrefs.wordGoal)
            };
        } catch (error) {
            nativeEditorState.editorPrefs = { fontSize: 18, lineHeight: 1.9, textWidth: 760, paragraphSpacing: 0, fontFamily: 'system', wordGoal: 0 };
        }
    }

    function saveNativeEditorPrefs() {
        try {
            window.localStorage.setItem(NATIVE_EDITOR_PREFS_STORAGE_KEY, JSON.stringify(nativeEditorState.editorPrefs));
        } catch (error) {
            /* ignore local preference persistence errors */
        }
    }

    function loadExportOptions() {
        try {
            const elements = nativeEditorElements();
            const saved = JSON.parse(window.localStorage.getItem(EXPORT_OPTIONS_STORAGE_KEY) || '{}');
            if (elements.exportIncludeSceneTitles) {
                elements.exportIncludeSceneTitles.checked = saved.includeSceneTitles !== false;
            }
        } catch (error) {
            /* ignore */
        }
    }

    function saveExportOptions() {
        try {
            const elements = nativeEditorElements();
            window.localStorage.setItem(EXPORT_OPTIONS_STORAGE_KEY, JSON.stringify({
                includeSceneTitles: elements.exportIncludeSceneTitles ? elements.exportIncludeSceneTitles.checked : true
            }));
        } catch (error) {
            /* ignore local preference persistence errors */
        }
    }

    function editorFontStack() {
        const family = nativeEditorState.editorPrefs.fontFamily;
        if (family === 'serif') {
            return '"SimSun", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif';
        }
        if (family === 'yahei') {
            return '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif';
        }
        return '"Microsoft YaHei", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    }

    function applyNativeEditorPrefs() {
        const elements = nativeEditorElements();
        const prefs = nativeEditorState.editorPrefs;
        if (elements.root) {
            elements.root.style.setProperty('--native-editor-font-size', `${prefs.fontSize}px`);
            elements.root.style.setProperty('--native-editor-line-height', String(prefs.lineHeight));
            elements.root.style.setProperty('--native-editor-text-width', `${prefs.textWidth}px`);
            elements.root.style.setProperty('--native-editor-paragraph-spacing', `${prefs.paragraphSpacing}em`);
            elements.root.style.setProperty('--native-editor-font-family', editorFontStack());
        }
        if (elements.editorFontSize) elements.editorFontSize.value = String(prefs.fontSize);
        if (elements.editorFontSizeValue) elements.editorFontSizeValue.textContent = String(prefs.fontSize);
        if (elements.editorLineHeight) elements.editorLineHeight.value = String(prefs.lineHeight);
        if (elements.editorLineHeightValue) elements.editorLineHeightValue.textContent = prefs.lineHeight.toFixed(2);
        if (elements.editorTextWidth) elements.editorTextWidth.value = String(prefs.textWidth);
        if (elements.editorTextWidthValue) elements.editorTextWidthValue.textContent = String(prefs.textWidth);
        if (elements.editorParagraphSpacing) elements.editorParagraphSpacing.value = String(prefs.paragraphSpacing);
        if (elements.editorParagraphSpacingValue) elements.editorParagraphSpacingValue.textContent = prefs.paragraphSpacing.toFixed(1);
        if (elements.editorFontFamily) elements.editorFontFamily.value = String(prefs.fontFamily);
        if (elements.editorWordGoal) {
            const goal = prefs.wordGoal || 0;
            if (elements.editorWordGoal.value !== String(goal)) elements.editorWordGoal.value = String(goal);
        }
        if (elements.typography) elements.typography.hidden = !nativeEditorState.typographyOpen;
        if (elements.toggleTypography) {
            elements.toggleTypography.setAttribute('aria-pressed', nativeEditorState.typographyOpen ? 'true' : 'false');
        }
        if (elements.toggleSpecials) {
            elements.toggleSpecials.setAttribute('aria-pressed', elements.specials && !elements.specials.hidden ? 'true' : 'false');
        }
    }

    function closeNativeWriterPopovers(options = {}) {
        const elements = nativeEditorElements();
        if (options.keep !== 'typography') {
            nativeEditorState.typographyOpen = false;
            if (elements.typography) elements.typography.hidden = true;
            if (elements.toggleTypography) elements.toggleTypography.setAttribute('aria-pressed', 'false');
        }
        if (options.keep !== 'specials') {
            if (elements.specials) elements.specials.hidden = true;
            if (elements.toggleSpecials) elements.toggleSpecials.setAttribute('aria-pressed', 'false');
        }
    }

    function countNativeWords(text) {
        const normalized = String(text || '').trim();
        if (!normalized) return 0;
        const cjk = normalized.match(/[\u3400-\u9fff]/g) || [];
        const words = normalized.replace(/[\u3400-\u9fff]/g, ' ')
            .split(/[\s,.;:!?()[\]{}"'，。！？、；：（）《》]+/)
            .filter(Boolean);
        return cjk.length + words.length;
    }

    function nativeSceneTags(scene) {
        if (!scene) return [];
        if (Array.isArray(scene.tags)) return scene.tags.filter(Boolean);
        if (typeof scene.tags === 'string') {
            return scene.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        }
        return [];
    }

    function flushNativeEditorFields() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;

        snapshot.sceneContents = snapshot.sceneContents || {};
        if (elements.editor) snapshot.sceneContents[scene.id] = elements.editor.value;
        if (elements.summary) scene.summary = elements.summary.value.trim();
        if (elements.tags) scene.tags = elements.tags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        if (elements.pov) scene.povCharacter = elements.pov.value.trim();
        if (elements.tense) scene.tense = elements.tense.value;
    }

    function beginNativeSceneTitleEdit() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!elements.sceneTitle || !scene || nativeEditorState.titleEditing) return;
        nativeEditorState.titleEditing = true;
        nativeEditorState.titleEditingOriginal = scene.title || '';
        elements.sceneTitle.contentEditable = 'true';
        elements.sceneTitle.classList.add('is-editing');
        elements.sceneTitle.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(elements.sceneTitle);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function finishNativeSceneTitleEdit(options = {}) {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!elements.sceneTitle || !nativeEditorState.titleEditing) return;
        const nextTitle = options.cancel
            ? nativeEditorState.titleEditingOriginal
            : (elements.sceneTitle.textContent || '').trim();
        const finalTitle = nextTitle || nativeEditorState.titleEditingOriginal || '未命名场景';
        nativeEditorState.titleEditing = false;
        nativeEditorState.titleEditingOriginal = '';
        elements.sceneTitle.contentEditable = 'false';
        elements.sceneTitle.classList.remove('is-editing');
        if (!scene) {
            renderNativeEditor();
            return;
        }
        if (!options.cancel && finalTitle !== (scene.title || '')) {
            scene.title = finalTitle;
            markNativeDirty('标题未保存');
        }
        renderNativeEditor();
    }

    function updateNativeStats() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        const text = elements.editor ? elements.editor.value : '';
        const wordCount = countNativeWords(text);
        const goal = nativeEditorState.editorPrefs.wordGoal || 0;
        if (elements.stats) {
            if (scene && goal > 0) {
                elements.stats.textContent = `${formatNumber(wordCount)} / ${formatNumber(goal)} 字`;
                elements.stats.dataset.tone = wordCount >= goal ? 'goal-met' : '';
            } else if (scene) {
                elements.stats.textContent = `${formatNumber(wordCount)} 字`;
                delete elements.stats.dataset.tone;
            } else {
                elements.stats.textContent = '0 字';
                delete elements.stats.dataset.tone;
            }
        }
        if (elements.paperStats) {
            if (scene && goal > 0) {
                elements.paperStats.textContent = `${formatNumber(wordCount)} / ${formatNumber(goal)} 字`;
                elements.paperStats.dataset.tone = wordCount >= goal ? 'goal-met' : '';
            } else {
                elements.paperStats.textContent = scene ? `${formatNumber(wordCount)} 字` : '0 字';
                delete elements.paperStats.dataset.tone;
            }
        }
        if (elements.paperPosition) {
            const chapters = snapshot && Array.isArray(snapshot.chapters) ? snapshot.chapters : [];
            const scenes = snapshot && Array.isArray(snapshot.scenes) ? snapshot.scenes : [];
            const chapter = scene ? chapters.find((item) => item.id === scene.chapterId) : null;
            const chapterScenes = chapter ? scenes.filter((item) => item.chapterId === chapter.id) : [];
            const sceneIndex = scene ? chapterScenes.findIndex((item) => item.id === scene.id) : -1;
            elements.paperPosition.textContent = scene && sceneIndex >= 0
                ? `场景 ${sceneIndex + 1} / ${chapterScenes.length || 1}`
                : '未选择场景';
        }
    }

    function markNativeDirty(message = '未保存') {
        nativeEditorState.dirty = true;
        flushNativeEditorFields();
        updateNativeStats();
        setNativeSaveStatus(message, 'warn');
        scheduleNativeAutosave();
    }

    function scheduleNativeAutosave() {
        if (nativeEditorState.autosaveTimer) {
            window.clearTimeout(nativeEditorState.autosaveTimer);
        }
        nativeEditorState.autosaveTimer = window.setTimeout(() => {
            if (nativeEditorState.dirty && nativeEditorState.snapshot) {
                saveNativeScene({ reason: 'autosave' });
            }
        }, 1600);
    }

    function normalizeNativeOrders() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return;
        (snapshot.chapters || [])
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
            .forEach((chapter, index) => { chapter.order = index; });
        const chapterIds = new Set((snapshot.chapters || []).map((chapter) => chapter.id));
        (snapshot.scenes || []).forEach((scene) => {
            if (!chapterIds.has(scene.chapterId) && snapshot.chapters && snapshot.chapters[0]) {
                scene.chapterId = snapshot.chapters[0].id;
            }
        });
        (snapshot.chapters || []).forEach((chapter) => {
            (snapshot.scenes || [])
                .filter((scene) => scene.chapterId === chapter.id)
                .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
                .forEach((scene, index) => { scene.order = index; });
        });
    }

    function currentNativeScene() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return null;
        return (snapshot.scenes || []).find((scene) => scene.id === nativeEditorState.activeSceneId) || null;
    }

    function currentNativeChapter(scene) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !scene) return null;
        return (snapshot.chapters || []).find((chapter) => chapter.id === scene.chapterId) || null;
    }

    function setNativeToolbarButton(button, label, mark) {
        if (!button) return;
        const labelElement = button.querySelector('.desktop-native-tool-label');
        const markElement = button.querySelector('.desktop-native-tool-mark');
        if (labelElement) {
            labelElement.textContent = label;
        } else {
            button.textContent = label;
        }
        if (markElement && mark) markElement.textContent = mark;
    }

    function renderNativeEditor() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const project = snapshot && snapshot.project ? snapshot.project : null;
        if (!elements.root) return;
        elements.root.classList.toggle('is-focus-mode', nativeEditorState.focusMode);
        elements.root.classList.toggle('is-outline-collapsed', nativeEditorState.outlineCollapsed);
        elements.root.classList.toggle('is-assistant-collapsed', nativeEditorState.assistantCollapsed);
        elements.root.classList.toggle('is-assistant-bottom', nativeEditorState.assistantPlacement === 'bottom');
        applyNativeEditorPrefs();
        if (elements.assistantPlacement) {
            setNativeToolbarButton(elements.assistantPlacement, nativeEditorState.assistantPlacement === 'bottom' ? '辅助在右' : '辅助在下', nativeEditorState.assistantPlacement === 'bottom' ? '右' : '下');
            elements.assistantPlacement.setAttribute('aria-pressed', nativeEditorState.assistantPlacement === 'bottom' ? 'true' : 'false');
        }
        if (elements.focusMode) {
            setNativeToolbarButton(elements.focusMode, nativeEditorState.focusMode ? '退出专注' : '专注', nativeEditorState.focusMode ? '退' : '专');
            elements.focusMode.setAttribute('aria-pressed', nativeEditorState.focusMode ? 'true' : 'false');
        }
        if (elements.toggleOutline) {
            setNativeToolbarButton(elements.toggleOutline, nativeEditorState.outlineCollapsed ? '显示结构' : '隐藏结构', '纲');
            elements.toggleOutline.setAttribute('aria-pressed', nativeEditorState.outlineCollapsed ? 'true' : 'false');
        }
        if (elements.toggleAssistant) {
            setNativeToolbarButton(elements.toggleAssistant, nativeEditorState.assistantCollapsed ? '显示辅助' : '隐藏辅助', '助');
            elements.toggleAssistant.setAttribute('aria-pressed', nativeEditorState.assistantCollapsed ? 'true' : 'false');
        }
        elements.panelTabs.forEach((tab) => {
            tab.classList.toggle('is-active', tab.dataset.nativePanelTab === nativeEditorState.assistantPanel);
        });
        elements.panels.forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.nativePanel === nativeEditorState.assistantPanel);
        });

        if (!snapshot || !project) {
            if (elements.projectTitle) elements.projectTitle.textContent = '未打开项目';
            if (elements.projectMeta) elements.projectMeta.textContent = '从书架打开项目后开始编辑。';
            if (elements.projectSource) elements.projectSource.textContent = '项目';
            if (elements.search) {
                elements.search.value = '';
                elements.search.disabled = true;
            }
            if (elements.replace) {
                elements.replace.value = '';
                elements.replace.disabled = true;
            }
            if (elements.replaceCurrent) elements.replaceCurrent.disabled = true;
            if (elements.replaceAll) elements.replaceAll.disabled = true;
            if (elements.searchStatus) elements.searchStatus.textContent = '';
            if (elements.searchPrev) elements.searchPrev.disabled = true;
            if (elements.searchNext) elements.searchNext.disabled = true;
            if (elements.sceneList) elements.sceneList.replaceChildren();
            if (elements.chapterTitle) elements.chapterTitle.textContent = '场景编辑';
            if (elements.sceneTitle && !nativeEditorState.titleEditing) elements.sceneTitle.textContent = '选择一个场景';
            if (elements.editor) {
                elements.editor.value = '';
                elements.editor.disabled = true;
            }
            [elements.summary, elements.tags, elements.pov, elements.tense].forEach((field) => {
                if (!field) return;
                field.value = '';
                field.disabled = true;
            });
            if (elements.stats) {
                elements.stats.textContent = '0 字';
                delete elements.stats.dataset.tone;
            }
            if (elements.saveButton) elements.saveButton.disabled = true;
            [elements.sendToWorkshop, elements.saveToCompendium].forEach((button) => {
                if (!button) return;
                button.hidden = true;
                button.disabled = true;
            });
            if (elements.readAloud) {
                elements.readAloud.disabled = true;
                elements.readAloud.hidden = false;
            }
            if (elements.stopReading) elements.stopReading.hidden = true;
            if (elements.addChapter) elements.addChapter.disabled = true;
            if (elements.renameChapter) elements.renameChapter.disabled = true;
            if (elements.deleteChapter) elements.deleteChapter.disabled = true;
            if (elements.addScene) elements.addScene.disabled = true;
            if (elements.renameScene) elements.renameScene.disabled = true;
            if (elements.deleteScene) elements.deleteScene.disabled = true;
            if (elements.moveSceneUp) elements.moveSceneUp.disabled = true;
            if (elements.moveSceneDown) elements.moveSceneDown.disabled = true;
            if (elements.exportMarkdown) elements.exportMarkdown.disabled = true;
            if (elements.exportText) elements.exportText.disabled = true;
            if (elements.exportHtml) elements.exportHtml.disabled = true;
            if (elements.exportEpub) elements.exportEpub.disabled = true;
            if (elements.exportPackage) elements.exportPackage.disabled = true;
            if (elements.exportIncludeSceneTitles) elements.exportIncludeSceneTitles.disabled = true;
            if (elements.beatInput) {
                elements.beatInput.value = '';
                elements.beatInput.disabled = true;
            }
            if (elements.previewPrompt) elements.previewPrompt.disabled = true;
            if (elements.generate) elements.generate.disabled = true;
            setNativeSaveStatus('', 'info');
            renderNativeRewrite();
            renderNativeCharacters();
            renderNativeContext();
            renderNativeGeneration();
            return;
        }

        normalizeNativeOrders();
        const chapters = [...(snapshot.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        const scenes = [...(snapshot.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        if (!nativeEditorState.activeSceneId && scenes[0]) nativeEditorState.activeSceneId = scenes[0].id;
        const activeScene = currentNativeScene();
        const activeSceneChapter = currentNativeChapter(activeScene);
        if (activeSceneChapter) nativeEditorState.activeChapterId = activeSceneChapter.id;
        if (!nativeEditorState.activeChapterId && chapters[0]) nativeEditorState.activeChapterId = chapters[0].id;
        const activeChapterId = nativeEditorState.activeChapterId;
        const activeChapter = currentNativeChapterByState();
        const query = nativeEditorState.searchQuery.trim().toLowerCase();

        if (elements.projectTitle) elements.projectTitle.textContent = project.name || '未命名项目';
        if (elements.projectSource) elements.projectSource.textContent = nativeEditorState.projectSource === 'project-directory' ? '项目目录' : '旧快照';
        if (elements.projectMeta) {
            elements.projectMeta.textContent = `${scenes.length} 场 / ${chapters.length} 章`;
        }
        if (elements.search) {
            elements.search.disabled = false;
            if (elements.search.value !== nativeEditorState.searchQuery) elements.search.value = nativeEditorState.searchQuery;
        }
        if (elements.replace) elements.replace.disabled = false;
        if (elements.replaceCurrent) elements.replaceCurrent.disabled = !activeScene || !nativeEditorState.searchQuery;
        if (elements.replaceAll) elements.replaceAll.disabled = !nativeEditorState.searchQuery;

        if (elements.sceneList) {
            elements.sceneList.replaceChildren();
            chapters.forEach((chapter) => {
                const chapterScenes = scenes.filter((scene) => scene.chapterId === chapter.id);
                const visibleScenes = chapterScenes.filter((scene) => {
                    if (!query) return true;
                    const haystack = [
                        chapter.title,
                        scene.title,
                        scene.summary,
                        nativeSceneTags(scene).join(' '),
                        nativeSceneContent(scene.id)
                    ].join(' ').toLowerCase();
                    return haystack.includes(query);
                });
                if (query && !visibleScenes.length && !String(chapter.title || '').toLowerCase().includes(query)) {
                    return;
                }

                const chapterGroup = document.createElement('details');
                const chapterExpanded = !!query || nativeEditorState.expandedChapterIds.has(chapter.id);
                chapterGroup.className = 'desktop-native-chapter-group';
                chapterGroup.open = chapterExpanded;
                chapterGroup.classList.toggle('is-active', chapter.id === activeChapterId);

                const chapterLabel = document.createElement('summary');
                chapterLabel.className = 'desktop-native-chapter';
                chapterLabel.classList.toggle('is-active', chapter.id === activeChapterId);
                chapterLabel.dataset.nativeChapterId = chapter.id;
                chapterLabel.setAttribute('aria-expanded', String(chapterExpanded));
                chapterLabel.draggable = true;
                const chapterName = document.createElement('span');
                chapterName.textContent = chapter.title || '未命名章节';
                const chapterCount = document.createElement('span');
                chapterCount.className = 'desktop-native-chapter-count';
                chapterCount.textContent = `${chapterScenes.length}`;
                chapterLabel.append(chapterName, chapterCount);
                chapterLabel.addEventListener('click', (event) => {
                    event.preventDefault();
                    finishNativeSceneTitleEdit();
                    flushNativeEditorFields();
                    nativeEditorState.activeChapterId = chapter.id;
                    if (!query) {
                        if (chapterExpanded) nativeEditorState.expandedChapterIds.delete(chapter.id);
                        else nativeEditorState.expandedChapterIds.add(chapter.id);
                    }
                    if (!chapterScenes.some((scene) => scene.id === nativeEditorState.activeSceneId) && chapterScenes[0]) {
                        nativeEditorState.activeSceneId = chapterScenes[0].id;
                    }
                    renderNativeEditor();
                });
                chapterLabel.addEventListener('dragstart', (event) => {
                    event.dataTransfer.setData('text/plain', `chapter:${chapter.id}`);
                });
                chapterLabel.addEventListener('dragover', (event) => event.preventDefault());
                chapterLabel.addEventListener('drop', (event) => {
                    event.preventDefault();
                    const value = event.dataTransfer.getData('text/plain') || '';
                    if (!value.startsWith('chapter:')) return;
                    reorderNativeChapter(value.slice('chapter:'.length), chapter.id);
                });
                chapterGroup.appendChild(chapterLabel);

                visibleScenes.forEach((scene) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'desktop-native-scene';
                    button.classList.toggle('is-active', scene.id === nativeEditorState.activeSceneId);
                    button.dataset.nativeSceneId = scene.id;
                    button.draggable = true;
                    const title = document.createElement('span');
                    title.textContent = scene.title || '未命名场景';
                    const meta = document.createElement('small');
                    const wordCountLabel = `${formatNumber(countNativeWords(nativeSceneContent(scene.id)))} 字`;
                    const detailParts = [wordCountLabel];
                    if (scene.summary) detailParts.push('已有摘要');
                    if (nativeSceneTags(scene).length) detailParts.push(nativeSceneTags(scene).join('/'));
                    meta.textContent = wordCountLabel;
                    button.title = detailParts.join(' · ');
                    button.append(title, meta);
                    button.addEventListener('click', () => {
                        finishNativeSceneTitleEdit();
                        flushNativeEditorFields();
                        nativeEditorState.activeSceneId = scene.id;
                        nativeEditorState.activeChapterId = scene.chapterId;
                        nativeEditorState.expandedChapterIds.add(scene.chapterId);
                        renderNativeEditor();
                    });
                    button.addEventListener('dragstart', (event) => {
                        event.dataTransfer.setData('text/plain', `scene:${scene.id}`);
                    });
                    button.addEventListener('dragover', (event) => event.preventDefault());
                    button.addEventListener('drop', (event) => {
                        event.preventDefault();
                        const value = event.dataTransfer.getData('text/plain') || '';
                        if (!value.startsWith('scene:')) return;
                        reorderNativeScene(value.slice('scene:'.length), scene.id);
                    });
                    chapterGroup.appendChild(button);
                });
                elements.sceneList.appendChild(chapterGroup);
            });
        }

        if (elements.chapterTitle) elements.chapterTitle.textContent = activeChapter ? activeChapter.title : '场景编辑';
        if (elements.sceneTitle && !nativeEditorState.titleEditing) {
            elements.sceneTitle.textContent = activeScene ? (activeScene.title || '未命名场景') : '选择一个场景';
            elements.sceneTitle.contentEditable = 'false';
            elements.sceneTitle.classList.remove('is-editing');
        }
        if (elements.paperHeading) elements.paperHeading.hidden = !activeScene;
        if (elements.paperChapter) elements.paperChapter.textContent = activeChapter ? activeChapter.title : '场景编辑';
        if (elements.paperTitle) elements.paperTitle.textContent = activeScene ? (activeScene.title || '未命名场景') : '选择一个场景';
        if (elements.editor) {
            elements.editor.disabled = !activeScene;
            elements.editor.value = activeScene ? nativeSceneContent(activeScene.id) : '';
        }
        if (query && activeScene) {
            updateNativeSearchMatchState();
        } else {
            nativeEditorState.searchMatchPositions = [];
            nativeEditorState.searchMatchIndex = -1;
            renderNativeSearchStatus();
        }
        if (elements.summary) {
            elements.summary.disabled = !activeScene;
            elements.summary.value = activeScene ? (activeScene.summary || '') : '';
        }
        if (elements.tags) {
            elements.tags.disabled = !activeScene;
            elements.tags.value = activeScene ? nativeSceneTags(activeScene).join(', ') : '';
        }
        if (elements.pov) {
            elements.pov.disabled = !activeScene;
            elements.pov.value = activeScene ? (activeScene.povCharacter || activeScene.pov || '') : '';
        }
        if (elements.tense) {
            elements.tense.disabled = !activeScene;
            elements.tense.value = activeScene ? (activeScene.tense || '') : '';
        }
        updateNativeStats();
        if (elements.saveButton) elements.saveButton.disabled = !activeScene;
        [elements.sendToWorkshop, elements.saveToCompendium].forEach((button) => {
            if (!button) return;
            button.hidden = !activeScene;
            button.disabled = !activeScene;
        });
        if (elements.readAloud) {
            elements.readAloud.disabled = !activeScene;
            elements.readAloud.hidden = nativeEditorState.tts.reading;
        }
        if (elements.stopReading) elements.stopReading.hidden = !nativeEditorState.tts.reading;
        if (elements.addChapter) elements.addChapter.disabled = false;
        if (elements.renameChapter) elements.renameChapter.disabled = !activeChapterId;
        if (elements.deleteChapter) elements.deleteChapter.disabled = !activeChapterId || chapters.length <= 1;
        if (elements.addScene) elements.addScene.disabled = !activeChapterId;
        if (elements.renameScene) elements.renameScene.disabled = !activeScene;
        if (elements.deleteScene) elements.deleteScene.disabled = !activeScene || scenes.length <= 1;
        const siblingScenes = activeScene ? scenes.filter((scene) => scene.chapterId === activeScene.chapterId) : [];
        const activeIndex = activeScene ? siblingScenes.findIndex((scene) => scene.id === activeScene.id) : -1;
        if (elements.moveSceneUp) elements.moveSceneUp.disabled = activeIndex <= 0;
        if (elements.moveSceneDown) elements.moveSceneDown.disabled = activeIndex < 0 || activeIndex >= siblingScenes.length - 1;
        if (elements.exportMarkdown) elements.exportMarkdown.disabled = !scenes.length;
        if (elements.exportText) elements.exportText.disabled = !scenes.length;
        if (elements.exportHtml) elements.exportHtml.disabled = !scenes.length;
        if (elements.exportEpub) elements.exportEpub.disabled = !scenes.length;
        if (elements.exportPackage) elements.exportPackage.disabled = !scenes.length;
        if (elements.exportIncludeSceneTitles) elements.exportIncludeSceneTitles.disabled = !scenes.length;
        if (elements.generateSceneSummary) elements.generateSceneSummary.disabled = !activeScene || nativeEditorState.generation.inProgress;
        if (elements.generateChapterSummary) elements.generateChapterSummary.disabled = !activeChapter || nativeEditorState.generation.inProgress;
        if (!nativeEditorState.dirty) setNativeSaveStatus('', 'info');
        if (elements.beatInput) elements.beatInput.disabled = !activeScene;
        renderNativeRewrite();
        renderNativeCharacters();
        renderNativeContext();
        renderWriterModelControl();
        renderNativeGeneration();
        renderContextStrip();
    }

    function loadNativeProjectEditor(snapshot, projectSummary = {}) {
        if (nativeEditorState.autosaveTimer) {
            window.clearTimeout(nativeEditorState.autosaveTimer);
            nativeEditorState.autosaveTimer = null;
        }
        nativeEditorState.snapshot = JSON.parse(JSON.stringify(snapshot || {}));
        const scenes = Array.isArray(snapshot && snapshot.scenes) ? snapshot.scenes : [];
        const chapters = Array.isArray(snapshot && snapshot.chapters) ? snapshot.chapters : [];
        const preferredScene = scenes.find((scene) => scene.id === snapshot.currentSceneId) || scenes[0] || null;
        nativeEditorState.activeSceneId = preferredScene ? preferredScene.id : '';
        nativeEditorState.activeChapterId = snapshot.currentChapterId || (preferredScene && preferredScene.chapterId) || (chapters[0] && chapters[0].id) || '';
        nativeEditorState.expandedChapterIds = new Set(nativeEditorState.activeChapterId ? [nativeEditorState.activeChapterId] : []);
        nativeEditorState.projectSource = projectSummary.source || 'legacy-snapshot';
        nativeEditorState.searchQuery = '';
        nativeEditorState.searchMatchIndex = -1;
        nativeEditorState.searchMatchPositions = [];
        loadNativeContextPrefs();
        nativeEditorState.dirty = false;
        nativeEditorState.isSaving = false;
        nativeEditorState.generation = {
            beat: '',
            text: '',
            reasoning: '',
            prompt: null,
            record: null,
            aiTaskRecord: null,
            aiTaskTargetKey: '',
            inProgress: false,
            abortController: null,
            lastAcceptedSceneId: '',
            inlineBaseText: '',
            insertionStart: 0,
            insertionEnd: 0,
            pendingSceneId: '',
            task: 'fiction-prose'
        };
        compendiumState.entries = Array.isArray(nativeEditorState.snapshot.compendium) ? nativeEditorState.snapshot.compendium : [];
        compendiumState.selectedId = compendiumState.entries[0] ? compendiumState.entries[0].id : '';
        compendiumState.query = '';
        compendiumState.type = '';
        compendiumState.dirty = false;
        promptState.prompts = Array.isArray(nativeEditorState.snapshot.prompts) ? nativeEditorState.snapshot.prompts : [];
        promptState.selectedId = promptState.prompts[0] ? promptState.prompts[0].id : 'default-prose';
        renderNativeEditor();
        renderCompendium();
    }

    async function saveNativeScene(options = {}) {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene || !elements.editor || nativeEditorState.isSaving) return;

        flushNativeEditorFields();
        normalizeNativeOrders();
        const now = new Date().toISOString();
        snapshot.filesystemSavedAt = now;
        snapshot.exportedAt = snapshot.exportedAt || now;
        if (snapshot.project) {
            snapshot.project.modified = now;
            snapshot.project.updatedAt = Date.now();
        }
        scene.modified = now;
        scene.updatedAt = Date.now();

        nativeEditorState.isSaving = true;
        setNativeSaveStatus(options.reason === 'autosave' ? '自动保存中...' : '保存中...', 'busy');
        if (elements.saveButton) elements.saveButton.disabled = true;
        try {
            const response = await fetch('/api/save-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            nativeEditorState.projectSource = result.source || nativeEditorState.projectSource;
            loadReaderFromProjectSnapshot(snapshot);
            await loadProjectLibrary();
            nativeEditorState.dirty = false;
            setNativeSaveStatus(options.reason === 'autosave' ? '已自动保存' : '已保存', 'ok');
        } catch (error) {
            console.error('Native editor save failed:', error);
            setNativeSaveStatus(`保存失败：${error.message || error}`, 'error');
        } finally {
            nativeEditorState.isSaving = false;
            if (elements.saveButton) elements.saveButton.disabled = false;
        }
    }

    function nativeId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function requestNativeName(options = {}) {
        const elements = nativeEditorElements();
        if (!elements.nameModal || !elements.nameForm || !elements.nameInput) {
            return Promise.resolve(window.prompt(options.title || '名称', options.defaultValue || '') || '');
        }
        return new Promise((resolve) => {
            let settled = false;
            const cleanup = () => {
                elements.nameForm.removeEventListener('submit', onSubmit);
                elements.nameCancelButtons.forEach((button) => button.removeEventListener('click', onCancel));
                elements.nameModal.hidden = true;
            };
            const settle = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(String(value || '').trim());
            };
            const onSubmit = (event) => {
                event.preventDefault();
                const value = elements.nameInput.value.trim();
                if (!value) {
                    if (elements.nameStatus) {
                        elements.nameStatus.textContent = '请输入名称。';
                        elements.nameStatus.dataset.tone = 'error';
                    }
                    elements.nameInput.focus();
                    return;
                }
                settle(value);
            };
            const onCancel = () => settle('');

            if (elements.nameKicker) elements.nameKicker.textContent = options.kicker || 'Writer';
            if (elements.nameTitle) elements.nameTitle.textContent = options.title || '命名';
            if (elements.nameLabel) elements.nameLabel.textContent = options.label || '名称';
            if (elements.nameStatus) elements.nameStatus.textContent = '';
            elements.nameInput.value = options.defaultValue || '';
            elements.nameForm.addEventListener('submit', onSubmit);
            elements.nameCancelButtons.forEach((button) => button.addEventListener('click', onCancel));
            elements.nameModal.hidden = false;
            window.setTimeout(() => {
                elements.nameInput.focus();
                elements.nameInput.select();
            }, 0);
        });
    }

    function activeChapterIdForNativeEditor() {
        if (nativeEditorState.activeChapterId) return nativeEditorState.activeChapterId;
        const scene = currentNativeScene();
        if (scene && scene.chapterId) return scene.chapterId;
        const snapshot = nativeEditorState.snapshot;
        return snapshot && snapshot.chapters && snapshot.chapters[0] ? snapshot.chapters[0].id : '';
    }

    async function addNativeChapter() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !snapshot.project) return;
        const chapterTitle = await requestNativeName({
            kicker: '章节',
            title: '新建章节',
            label: '章节名称',
            defaultValue: `第 ${(snapshot.chapters || []).length + 1} 章`
        });
        if (!chapterTitle) return;
        const now = new Date().toISOString();
        const chapterId = nativeId('chapter');
        const sceneId = nativeId('scene');
        snapshot.chapters = snapshot.chapters || [];
        snapshot.scenes = snapshot.scenes || [];
        snapshot.sceneContents = snapshot.sceneContents || {};
        snapshot.chapters.push({
            id: chapterId,
            projectId: snapshot.project.id,
            title: chapterTitle.trim(),
            order: snapshot.chapters.length,
            created: now,
            modified: now,
            updatedAt: Date.now()
        });
        snapshot.scenes.push({
            id: sceneId,
            projectId: snapshot.project.id,
            chapterId,
            title: '新场景',
            order: 0,
            created: now,
            modified: now,
            updatedAt: Date.now()
        });
        snapshot.sceneContents[sceneId] = '';
        nativeEditorState.activeSceneId = sceneId;
        nativeEditorState.activeChapterId = chapterId;
        nativeEditorState.expandedChapterIds.add(chapterId);
        renderNativeEditor();
        markNativeDirty();
    }

    async function addNativeScene() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !snapshot.project) return;
        const chapterId = activeChapterIdForNativeEditor();
        if (!chapterId) return;
        const sceneTitle = await requestNativeName({
            kicker: '场景',
            title: '新建场景',
            label: '场景名称',
            defaultValue: `场景 ${(snapshot.scenes || []).filter((scene) => scene.chapterId === chapterId).length + 1}`
        });
        if (!sceneTitle) return;
        const now = new Date().toISOString();
        const sceneId = nativeId('scene');
        const chapterScenes = (snapshot.scenes || []).filter((scene) => scene.chapterId === chapterId);
        snapshot.scenes = snapshot.scenes || [];
        snapshot.sceneContents = snapshot.sceneContents || {};
        snapshot.scenes.push({
            id: sceneId,
            projectId: snapshot.project.id,
            chapterId,
            title: sceneTitle.trim(),
            order: chapterScenes.length,
            created: now,
            modified: now,
            updatedAt: Date.now()
        });
        snapshot.sceneContents[sceneId] = '';
        nativeEditorState.activeSceneId = sceneId;
        nativeEditorState.activeChapterId = chapterId;
        nativeEditorState.expandedChapterIds.add(chapterId);
        renderNativeEditor();
        markNativeDirty();
    }

    function currentNativeChapterByState() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return null;
        const activeScene = currentNativeScene();
        const chapterId = nativeEditorState.activeChapterId || (activeScene && activeScene.chapterId);
        return (snapshot.chapters || []).find((chapter) => chapter.id === chapterId) || null;
    }

    async function renameNativeChapter() {
        const chapter = currentNativeChapterByState();
        if (!chapter) return;
        const nextTitle = await requestNativeName({
            kicker: '章节',
            title: '重命名章节',
            label: '章节名称',
            defaultValue: chapter.title || ''
        });
        if (!nextTitle || !nextTitle.trim()) return;
        chapter.title = nextTitle.trim();
        chapter.modified = new Date().toISOString();
        chapter.updatedAt = Date.now();
        renderNativeEditor();
        markNativeDirty();
    }

    function deleteNativeChapter() {
        const snapshot = nativeEditorState.snapshot;
        const chapter = currentNativeChapterByState();
        if (!snapshot || !chapter) return;
        if ((snapshot.chapters || []).length <= 1) {
            setNativeSaveStatus('至少保留一个章节', 'error');
            return;
        }
        const chapterScenes = (snapshot.scenes || []).filter((scene) => scene.chapterId === chapter.id);
        const message = chapterScenes.length
            ? `删除章节“${chapter.title || '未命名章节'}”及其中 ${chapterScenes.length} 个场景？`
            : `删除章节“${chapter.title || '未命名章节'}”？`;
        if (!window.confirm(message)) return;
        const deletedSceneIds = new Set(chapterScenes.map((scene) => scene.id));
        snapshot.chapters = (snapshot.chapters || []).filter((item) => item.id !== chapter.id);
        snapshot.scenes = (snapshot.scenes || []).filter((scene) => !deletedSceneIds.has(scene.id));
        if (snapshot.sceneContents) {
            deletedSceneIds.forEach((sceneId) => delete snapshot.sceneContents[sceneId]);
        }
        normalizeNativeOrders();
        const nextChapter = (snapshot.chapters || [])[0] || null;
        const nextScene = nextChapter ? (snapshot.scenes || []).find((scene) => scene.chapterId === nextChapter.id) : null;
        nativeEditorState.activeChapterId = nextChapter ? nextChapter.id : '';
        nativeEditorState.activeSceneId = nextScene ? nextScene.id : '';
        nativeEditorState.expandedChapterIds.delete(chapter.id);
        if (nextChapter) nativeEditorState.expandedChapterIds.add(nextChapter.id);
        renderNativeEditor();
        markNativeDirty();
    }

    async function renameNativeScene() {
        const scene = currentNativeScene();
        if (!scene) return;
        const nextTitle = await requestNativeName({
            kicker: '场景',
            title: '重命名场景',
            label: '场景名称',
            defaultValue: scene.title || ''
        });
        if (!nextTitle) return;
        scene.title = nextTitle.trim();
        scene.modified = new Date().toISOString();
        scene.updatedAt = Date.now();
        renderNativeEditor();
        markNativeDirty();
    }

    function deleteNativeScene() {
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;
        if ((snapshot.scenes || []).length <= 1) {
            setNativeSaveStatus('至少保留一个场景', 'error');
            return;
        }
        if (!window.confirm(`删除场景“${scene.title || '未命名场景'}”？`)) return;
        snapshot.scenes = (snapshot.scenes || []).filter((item) => item.id !== scene.id);
        if (snapshot.sceneContents) delete snapshot.sceneContents[scene.id];
        nativeEditorState.activeSceneId = snapshot.scenes[0] ? snapshot.scenes[0].id : '';
        nativeEditorState.activeChapterId = snapshot.scenes[0] ? snapshot.scenes[0].chapterId : activeChapterIdForNativeEditor();
        if (nativeEditorState.activeChapterId) nativeEditorState.expandedChapterIds.add(nativeEditorState.activeChapterId);
        normalizeNativeOrders();
        renderNativeEditor();
        markNativeDirty();
    }

    function moveNativeScene(direction) {
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;
        flushNativeEditorFields();
        const chapterScenes = (snapshot.scenes || [])
            .filter((item) => item.chapterId === scene.chapterId)
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const index = chapterScenes.findIndex((item) => item.id === scene.id);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= chapterScenes.length) return;
        const other = chapterScenes[nextIndex];
        const originalOrder = scene.order;
        scene.order = other.order;
        other.order = originalOrder;
        normalizeNativeOrders();
        renderNativeEditor();
        markNativeDirty();
    }

    function switchNativeScene(direction) {
        const snapshot = nativeEditorState.snapshot;
        const scene = currentNativeScene();
        if (!snapshot || !scene) return;
        flushNativeEditorFields();
        const orderedScenes = [...(snapshot.scenes || [])]
            .sort((a, b) => {
                const chapterA = (snapshot.chapters || []).find((chapter) => chapter.id === a.chapterId);
                const chapterB = (snapshot.chapters || []).find((chapter) => chapter.id === b.chapterId);
                const chapterOrder = (Number(chapterA && chapterA.order) || 0) - (Number(chapterB && chapterB.order) || 0);
                return chapterOrder || ((Number(a.order) || 0) - (Number(b.order) || 0));
            });
        const index = orderedScenes.findIndex((item) => item.id === scene.id);
        const next = orderedScenes[index + direction];
        if (!next) return;
        nativeEditorState.activeSceneId = next.id;
        nativeEditorState.activeChapterId = next.chapterId;
        nativeEditorState.expandedChapterIds.add(next.chapterId);
        renderNativeEditor();
    }

    function reorderNativeChapter(sourceId, targetId) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || sourceId === targetId) return;
        flushNativeEditorFields();
        const chapters = [...(snapshot.chapters || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const sourceIndex = chapters.findIndex((chapter) => chapter.id === sourceId);
        const targetIndex = chapters.findIndex((chapter) => chapter.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [source] = chapters.splice(sourceIndex, 1);
        chapters.splice(targetIndex, 0, source);
        chapters.forEach((chapter, index) => { chapter.order = index; });
        renderNativeEditor();
        markNativeDirty();
    }

    function reorderNativeScene(sourceId, targetId) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || sourceId === targetId) return;
        flushNativeEditorFields();
        const source = (snapshot.scenes || []).find((scene) => scene.id === sourceId);
        const target = (snapshot.scenes || []).find((scene) => scene.id === targetId);
        if (!source || !target || source.chapterId !== target.chapterId) return;
        const scenes = (snapshot.scenes || [])
            .filter((scene) => scene.chapterId === target.chapterId)
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const sourceIndex = scenes.findIndex((scene) => scene.id === sourceId);
        const targetIndex = scenes.findIndex((scene) => scene.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [item] = scenes.splice(sourceIndex, 1);
        scenes.splice(targetIndex, 0, item);
        scenes.forEach((scene, index) => { scene.order = index; });
        nativeEditorState.activeSceneId = sourceId;
        nativeEditorState.activeChapterId = target.chapterId;
        nativeEditorState.expandedChapterIds.add(target.chapterId);
        renderNativeEditor();
        markNativeDirty();
    }

    function escapeRegExp(text) {
        return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function nativeSceneMatches(query) {
        const editor = nativeEditorElements().editor;
        if (!editor || !query) return [];
        const text = editor.value || '';
        if (!text) return [];
        const pattern = new RegExp(escapeRegExp(query), 'gi');
        const matches = [];
        let match;
        while ((match = pattern.exec(text)) !== null) {
            matches.push({ start: match.index, end: match.index + match[0].length });
        }
        return matches;
    }

    function updateNativeSearchMatchState() {
        const elements = nativeEditorElements();
        const query = nativeEditorState.searchQuery.trim();
        const matches = query ? nativeSceneMatches(query) : [];
        nativeEditorState.searchMatchPositions = matches;
        nativeEditorState.searchMatchIndex = matches.length > 0 ? 0 : -1;
        renderNativeSearchStatus();
    }

    function renderNativeSearchStatus() {
        const elements = nativeEditorElements();
        const query = nativeEditorState.searchQuery.trim();
        const matches = nativeEditorState.searchMatchPositions;
        const count = matches.length;
        if (!query) {
            if (elements.searchStatus) elements.searchStatus.textContent = '';
            if (elements.searchPrev) elements.searchPrev.disabled = true;
            if (elements.searchNext) elements.searchNext.disabled = true;
            return;
        }
        if (count === 0) {
            if (elements.searchStatus) elements.searchStatus.textContent = '没有匹配项';
            if (elements.searchPrev) elements.searchPrev.disabled = true;
            if (elements.searchNext) elements.searchNext.disabled = true;
            return;
        }
        const idx = nativeEditorState.searchMatchIndex;
        if (elements.searchStatus) elements.searchStatus.textContent = `第 ${idx + 1}/${count} 个匹配`;
        if (elements.searchPrev) elements.searchPrev.disabled = count <= 1;
        if (elements.searchNext) elements.searchNext.disabled = count <= 1;
        selectNativeSearchMatch(idx);
    }

    function selectNativeSearchMatch(index) {
        const editor = nativeEditorElements().editor;
        const matches = nativeEditorState.searchMatchPositions;
        if (!editor || index < 0 || index >= matches.length) return;
        const match = matches[index];
        editor.focus();
        editor.setSelectionRange(match.start, match.end);
        const textBefore = editor.value.slice(0, match.start);
        const lines = textBefore.split('\n').length;
        const lineHeight = 20;
        editor.scrollTop = Math.max(0, (lines - 4) * lineHeight);
    }

    function navigateNativeSearchMatch(direction) {
        const matches = nativeEditorState.searchMatchPositions;
        if (!matches.length) return;
        let idx = nativeEditorState.searchMatchIndex + direction;
        if (idx < 0) idx = matches.length - 1;
        if (idx >= matches.length) idx = 0;
        nativeEditorState.searchMatchIndex = idx;
        renderNativeSearchStatus();
    }

    function replaceNativeText(scope) {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        const query = nativeEditorState.searchQuery;
        if (!snapshot || !query) return;
        const replacement = elements.replace ? elements.replace.value : '';
        flushNativeEditorFields();
        const pattern = new RegExp(escapeRegExp(query), 'gi');
        const replaceScene = (scene) => {
            const current = nativeSceneContent(scene.id);
            const next = current.replace(pattern, replacement);
            if (next !== current) {
                snapshot.sceneContents = snapshot.sceneContents || {};
                snapshot.sceneContents[scene.id] = next;
                scene.modified = new Date().toISOString();
                scene.updatedAt = Date.now();
                return 1;
            }
            return 0;
        };
        let count = 0;
        if (scope === 'all') {
            (snapshot.scenes || []).forEach((scene) => { count += replaceScene(scene); });
        } else {
            const scene = currentNativeScene();
            if (!scene) return;
            const matches = nativeEditorState.searchMatchPositions;
            const matchIndex = nativeEditorState.searchMatchIndex;
            if (matches.length > 0 && matchIndex >= 0 && matchIndex < matches.length) {
                const match = matches[matchIndex];
                const current = nativeSceneContent(scene.id);
                if (match.start >= 0 && match.end <= current.length) {
                    const next = current.slice(0, match.start) + replacement + current.slice(match.end);
                    if (next !== current) {
                        snapshot.sceneContents = snapshot.sceneContents || {};
                        snapshot.sceneContents[scene.id] = next;
                        scene.modified = new Date().toISOString();
                        scene.updatedAt = Date.now();
                        count = 1;
                    }
                }
            } else {
                count += replaceScene(scene);
            }
        }
        if (!count) {
            setNativeSaveStatus('没有匹配项', 'info');
            return;
        }
        renderNativeEditor();
        markNativeDirty(`已替换 ${count} 处`);
    }

    function projectExportName(extension) {
        const project = nativeEditorState.snapshot && nativeEditorState.snapshot.project;
        const base = String(project && project.name ? project.name : 'DraftHarbor Project')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'DraftHarbor Project';
        return `${base}.${extension}`;
    }

    function buildNativeExport(format) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return '';
        flushNativeEditorFields();
        normalizeNativeOrders();
        const chapters = [...(snapshot.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        const scenes = [...(snapshot.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        const markdown = format === 'markdown';
        const lines = [];
        chapters.forEach((chapter) => {
            lines.push(markdown ? `# ${chapter.title || '未命名章节'}` : (chapter.title || '未命名章节'));
            scenes.filter((scene) => scene.chapterId === chapter.id).forEach((scene) => {
                const content = nativeSceneContent(scene.id).trim();
                if (scene.title) lines.push('', markdown ? `## ${scene.title}` : scene.title);
                if (content) lines.push('', content);
            });
            lines.push('');
        });
        return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
    }

    async function downloadNativeExport(format) {
        const elements = nativeEditorElements();
        const projectId = currentProjectId();
        if (!projectId) {
            setNativeSaveStatus('没有可导出的项目', 'error');
            return;
        }
        if (nativeEditorState.dirty) {
            await saveNativeScene();
        } else {
            flushNativeEditorFields();
        }
        const extensionMap = { markdown: 'md', text: 'txt', html: 'html', epub: 'epub' };
        const extension = extensionMap[format] || format;
        const includeSceneTitles = elements.exportIncludeSceneTitles ? elements.exportIncludeSceneTitles.checked : true;
        triggerDownload(`/api/export-project-document?${new URLSearchParams({ projectId, format, includeSceneTitles }).toString()}`);
        setNativeSaveStatus(`已开始导出 ${extension.toUpperCase()}`, 'ok');
    }

    async function downloadNativeProjectPackage() {
        const projectId = currentProjectId();
        if (!projectId) {
            setNativeSaveStatus('没有可导出的项目', 'error');
            return;
        }
        if (nativeEditorState.dirty) {
            await saveNativeScene();
        } else {
            flushNativeEditorFields();
        }
        triggerDownload(`/api/export-project-package?${new URLSearchParams({ projectId }).toString()}`);
        setNativeSaveStatus('已开始导出项目包', 'ok');
    }

    function nativeGenerationHistory() {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return [];
        return Array.isArray(snapshot.promptHistory) ? snapshot.promptHistory : [];
    }

    function selectedPromptTemplate() {
        return promptState.prompts.find((prompt) => prompt.id === promptState.selectedId)
            || promptState.prompts[0]
            || { id: 'default-prose', title: '正文续写：均衡扩写', category: 'prose', content: '', systemContent: '' };
    }

    function isNativeDefaultPrompt(prompt) {
        if (!prompt) return false;
        return !!prompt.isDefault || String(prompt.id || '').indexOf('default-') === 0;
    }

    function promptCategoryLabel(category) {
        const labels = {
            prose: '正文',
            rewrite: '改写',
            summary: '摘要',
            workshop: '讨论',
            workflow: '工作流'
        };
        return labels[category] || '正文';
    }

    function promptManagerSummary(prompt) {
        if (!prompt) return '选择或新建一个提示词';
        if (isNativeDefaultPrompt(prompt)) return '内置模板，可另存为自定义提示词';
        return `${promptCategoryLabel(prompt.category)}自定义模板`;
    }

    async function loadPrompts() {
        const projectId = currentProjectId();
        if (!projectId) {
            promptState.prompts = [];
            promptState.selectedId = 'default-prose';
            renderNativeGeneration();
            return;
        }
        try {
            const response = await fetch(`/api/prompts?${new URLSearchParams({ projectId, category: 'prose' }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            promptState.prompts = result.prompts || [];
            if (!promptState.prompts.some((prompt) => prompt.id === promptState.selectedId)) {
                promptState.selectedId = promptState.prompts[0] ? promptState.prompts[0].id : 'default-prose';
            }
            if (nativeEditorState.snapshot) nativeEditorState.snapshot.prompts = promptState.prompts.filter((prompt) => !isNativeDefaultPrompt(prompt));
        } catch (error) {
            console.warn('Failed to load prompts:', error);
            promptState.prompts = [{ id: 'default-prose', title: '正文续写：均衡扩写', category: 'prose', content: '', systemContent: '' }];
        }
        renderNativeGeneration();
    }

    function renderPromptManager() {
        const elements = nativeEditorElements();
        const prompt = selectedPromptTemplate();
        if (elements.promptManagerList) {
            elements.promptManagerList.replaceChildren();
            const prompts = promptState.prompts.length ? promptState.prompts : [prompt];
            prompts.forEach((item) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.promptManagerSelect = item.id || '';
                button.className = 'desktop-prompt-manager-item';
                button.classList.toggle('is-active', item.id === prompt.id);
                const title = document.createElement('strong');
                title.textContent = item.title || '未命名提示词';
                const meta = document.createElement('span');
                meta.textContent = `${promptCategoryLabel(item.category)} · ${isNativeDefaultPrompt(item) ? '内置' : '自定义'}`;
                button.append(title, meta);
                elements.promptManagerList.appendChild(button);
            });
        }
        if (elements.promptManagerCount) {
            const customCount = promptState.prompts.filter((item) => !isNativeDefaultPrompt(item)).length;
            elements.promptManagerCount.textContent = `${customCount} 个自定义`;
        }
        if (elements.promptManagerStatus) elements.promptManagerStatus.textContent = promptManagerSummary(prompt);
        if (elements.promptManagerTitle) elements.promptManagerTitle.value = prompt.title || '';
        if (elements.promptManagerCategory) elements.promptManagerCategory.value = prompt.category || 'prose';
        if (elements.promptManagerSystem) elements.promptManagerSystem.value = prompt.systemContent || '';
        if (elements.promptManagerContent) elements.promptManagerContent.value = prompt.content || '';
        if (elements.promptManagerDelete) elements.promptManagerDelete.disabled = !prompt || isNativeDefaultPrompt(prompt);
    }

    async function savePromptTemplate(event) {
        if (event) event.preventDefault();
        const projectId = currentProjectId();
        if (!projectId) return;
        const elements = nativeEditorElements();
        const current = selectedPromptTemplate();
        const prompt = {
            id: current && !isNativeDefaultPrompt(current) ? current.id : undefined,
            category: elements.promptManagerCategory ? elements.promptManagerCategory.value : 'prose',
            title: elements.promptManagerTitle ? elements.promptManagerTitle.value : '新提示词',
            systemContent: elements.promptManagerSystem ? elements.promptManagerSystem.value : '',
            content: elements.promptManagerContent ? elements.promptManagerContent.value : ''
        };
        const response = await fetch('/api/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, prompt })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setNativeSaveStatus(`提示词保存失败：${result.error || response.status}`, 'error');
            return;
        }
        promptState.selectedId = result.prompt.id;
        await loadPrompts();
        await loadRewritePrompts();
        renderPromptManager();
        setNativeSaveStatus('提示词已保存', 'ok');
    }

    async function deletePromptTemplate() {
        const projectId = currentProjectId();
        const prompt = selectedPromptTemplate();
        if (!projectId || !prompt || isNativeDefaultPrompt(prompt)) return;
        if (!window.confirm(`删除提示词“${prompt.title || '未命名'}”？`)) return;
        const response = await fetch('/api/delete-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, promptId: prompt.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            setNativeSaveStatus(`提示词删除失败：${result.error || response.status}`, 'error');
            return;
        }
        promptState.selectedId = 'default-prose';
        await loadPrompts();
        await loadRewritePrompts();
        renderPromptManager();
        setNativeSaveStatus('提示词已删除', 'ok');
    }

    function newPromptTemplate() {
        promptState.selectedId = 'default-prose';
        const elements = nativeEditorElements();
        if (elements.promptManagerTitle) elements.promptManagerTitle.value = '新正文提示词';
        if (elements.promptManagerCategory) elements.promptManagerCategory.value = 'prose';
        if (elements.promptManagerSystem) elements.promptManagerSystem.value = '';
        if (elements.promptManagerContent) elements.promptManagerContent.value = '';
        if (elements.promptManagerDelete) elements.promptManagerDelete.disabled = true;
        if (elements.promptManagerStatus) elements.promptManagerStatus.textContent = '正在创建自定义提示词';
        if (elements.promptManagerList) {
            elements.promptManagerList.querySelectorAll('[data-prompt-manager-select]').forEach((button) => {
                button.classList.remove('is-active');
            });
        }
    }

    function renderNativeRewrite() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (elements.rewriteTaskButtons && elements.rewriteTaskButtons.length) {
            elements.rewriteTaskButtons.forEach((btn) => {
                const task = btn.getAttribute('data-native-rewrite-task');
                btn.classList.toggle('is-active', task === nativeEditorState.rewrite.rewriteTask);
            });
        }
        if (elements.rewritePreset && elements.rewritePreset.value !== nativeEditorState.rewrite.preset) {
            elements.rewritePreset.value = nativeEditorState.rewrite.preset;
        }
        if (elements.rewriteInstruction && elements.rewriteInstruction.value !== nativeEditorState.rewrite.instruction) {
            elements.rewriteInstruction.value = nativeEditorState.rewrite.instruction;
        }
        if (elements.regenerateUseContext) {
            if (elements.regenerateUseContext.checked !== nativeEditorState.rewrite.regenerateUseContext) {
                elements.regenerateUseContext.checked = nativeEditorState.rewrite.regenerateUseContext;
            }
        }
        var hasSelection = !!(elements.editor && elements.editor.selectionStart !== elements.editor.selectionEnd);
        if (elements.rewriteOriginalText && hasSelection && elements.editor) {
            var originalText = elements.editor.value.slice(elements.editor.selectionStart, elements.editor.selectionEnd);
            if (elements.rewriteOriginalText.value !== originalText) {
                elements.rewriteOriginalText.value = originalText;
            }
        } else if (elements.rewriteOriginalText && !hasSelection) {
            if (elements.rewriteOriginalText.value) elements.rewriteOriginalText.value = '';
        }
        updateRewritePresetDescription();
        renderRewriteSavedPrompts();
        if (elements.previewRewrite) elements.previewRewrite.disabled = !scene || !hasSelection || nativeEditorState.generation.inProgress;
        if (elements.startRewrite) elements.startRewrite.disabled = !scene || !hasSelection || nativeEditorState.generation.inProgress;
        if (elements.regenerateSelection) elements.regenerateSelection.disabled = !scene || !hasSelection || nativeEditorState.generation.inProgress;
    }

    function renderNativeCharacters() {
        const elements = nativeEditorElements();
        if (elements.newCharacter) elements.newCharacter.disabled = !currentProjectId();
        if (elements.openCompendium) elements.openCompendium.disabled = !currentProjectId();
        if (!elements.characterList) return;
        elements.characterList.replaceChildren();
        const characters = (compendiumState.entries || [])
            .filter((entry) => entry.type === 'character' || entry.category === 'character')
            .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'));
        if (!characters.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-native-character-card';
            empty.textContent = currentProjectId() ? '还没有人物卡。' : '打开项目后可创建人物卡。';
            elements.characterList.appendChild(empty);
            return;
        }
        characters.forEach((entry) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'desktop-native-character-card';
            const title = document.createElement('strong');
            title.textContent = entry.title || '未命名人物';
            const summary = document.createElement('span');
            summary.textContent = entry.summary || entry.body || '暂无简介';
            item.append(title, summary);
            item.addEventListener('click', () => {
                compendiumState.selectedId = entry.id;
                setView('compendium');
                renderCompendium();
            });
            elements.characterList.appendChild(item);
        });
    }

    function nativeContextStorageKey() {
        return currentProjectId() ? `draftharbor:nativeContext:${currentProjectId()}` : '';
    }

    function saveNativeContextPrefs() {
        const key = nativeContextStorageKey();
        if (!key) return;
        try {
            window.localStorage.setItem(key, JSON.stringify(nativeEditorState.context));
        } catch (error) { /* ignore */ }
    }

    function loadNativeContextPrefs() {
        const key = nativeContextStorageKey();
        nativeEditorState.context = { compendiumIds: [], sceneModes: {} };
        if (!key) return;
        try {
            const parsed = JSON.parse(window.localStorage.getItem(key) || '{}');
            nativeEditorState.context = {
                compendiumIds: Array.isArray(parsed.compendiumIds) ? parsed.compendiumIds : [],
                compendiumTags: Array.isArray(parsed.compendiumTags) ? parsed.compendiumTags : [],
                chapterModes: parsed.chapterModes && typeof parsed.chapterModes === 'object' ? parsed.chapterModes : {},
                sceneModes: parsed.sceneModes && typeof parsed.sceneModes === 'object' ? parsed.sceneModes : {}
            };
        } catch (error) { /* ignore */ }
    }

    function renderNativeContext() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        if (!elements.contextCompendium || !elements.contextScenes) return;
        elements.contextCompendium.replaceChildren();
        if (elements.contextCompendiumTags) elements.contextCompendiumTags.replaceChildren();
        if (elements.contextChapters) elements.contextChapters.replaceChildren();
        elements.contextScenes.replaceChildren();
        if (!snapshot || !snapshot.project) {
            elements.contextCompendium.textContent = '打开项目后选择资料。';
            if (elements.contextCompendiumTags) elements.contextCompendiumTags.textContent = '打开项目后选择资料标签。';
            if (elements.contextChapters) elements.contextChapters.textContent = '打开项目后选择章节。';
            elements.contextScenes.textContent = '打开项目后选择场景。';
            renderNativeContextSummary();
            return;
        }
        const compendium = compendiumState.entries || snapshot.compendium || [];
        if (!compendium.length) {
            elements.contextCompendium.textContent = '暂无资料。';
        } else {
            compendium.forEach((entry) => {
                const label = document.createElement('label');
                label.className = 'desktop-native-context-row';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = nativeEditorState.context.compendiumIds.includes(entry.id);
                input.addEventListener('change', () => {
                    const set = new Set(nativeEditorState.context.compendiumIds);
                    if (input.checked) set.add(entry.id); else set.delete(entry.id);
                    nativeEditorState.context.compendiumIds = Array.from(set);
                    saveNativeContextPrefs();
                    renderNativeContextSummary();
                });
                const text = document.createElement('span');
                text.textContent = `${entry.title || '未命名资料'}${entry.type ? ` · ${entry.type}` : ''}`;
                label.append(input, text);
                elements.contextCompendium.appendChild(label);
            });
        }
        const tagSet = new Set();
        compendium.forEach((entry) => {
            (entry.tags || []).forEach((tag) => {
                const normalized = String(tag || '').trim();
                if (normalized) tagSet.add(normalized);
            });
        });
        if (elements.contextCompendiumTags) {
            const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
            if (!tags.length) {
                elements.contextCompendiumTags.textContent = '暂无资料标签。';
            } else {
                tags.forEach((tag) => {
                    const label = document.createElement('label');
                    label.className = 'desktop-native-context-row';
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = nativeEditorState.context.compendiumTags.includes(tag);
                    input.addEventListener('change', () => {
                        const set = new Set(nativeEditorState.context.compendiumTags);
                        if (input.checked) set.add(tag); else set.delete(tag);
                        nativeEditorState.context.compendiumTags = Array.from(set);
                        saveNativeContextPrefs();
                        renderNativeContextSummary();
                    });
                    const text = document.createElement('span');
                    text.textContent = tag;
                    label.append(input, text);
                    elements.contextCompendiumTags.appendChild(label);
                });
            }
        }
        if (elements.contextChapters) {
            const chapters = [...(snapshot.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
            if (!chapters.length) {
                elements.contextChapters.textContent = '暂无章节。';
            } else {
                chapters.forEach((chapter) => {
                    const row = document.createElement('label');
                    row.className = 'desktop-native-context-row';
                    const select = document.createElement('select');
                    select.value = nativeEditorState.context.chapterModes[chapter.id] || '';
                    [['', '不引用'], ['summary', '摘要'], ['full', '全文']].forEach(([value, label]) => {
                        const option = document.createElement('option');
                        option.value = value;
                        option.textContent = label;
                        select.appendChild(option);
                    });
                    select.addEventListener('change', () => {
                        if (select.value) nativeEditorState.context.chapterModes[chapter.id] = select.value;
                        else delete nativeEditorState.context.chapterModes[chapter.id];
                        saveNativeContextPrefs();
                        renderNativeContextSummary();
                    });
                    const text = document.createElement('span');
                    text.textContent = chapter.title || '未命名章节';
                    row.append(select, text);
                    elements.contextChapters.appendChild(row);
                });
            }
        }
        const scenes = [...(snapshot.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        if (!scenes.length) {
            elements.contextScenes.textContent = '暂无场景。';
        } else {
            scenes.forEach((scene) => {
                const row = document.createElement('label');
                row.className = 'desktop-native-context-row';
                const select = document.createElement('select');
                select.value = nativeEditorState.context.sceneModes[scene.id] || '';
                [['', '不引用'], ['summary', '摘要'], ['full', '全文']].forEach(([value, label]) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    select.appendChild(option);
                });
                select.addEventListener('change', () => {
                    if (select.value) nativeEditorState.context.sceneModes[scene.id] = select.value;
                    else delete nativeEditorState.context.sceneModes[scene.id];
                    saveNativeContextPrefs();
                    renderNativeContextSummary();
                });
                const text = document.createElement('span');
                text.textContent = scene.title || '未命名场景';
                row.append(select, text);
                elements.contextScenes.appendChild(row);
            });
        }
        renderNativeContextSummary();
    }

    function renderNativeContextSummary() {
        const elements = nativeEditorElements();
        const snapshot = nativeEditorState.snapshot;
        if (!elements.contextSummary) return;
        if (!snapshot || !snapshot.project) {
            elements.contextSummary.textContent = '打开项目后选择引用的上下文。';
            return;
        }
        const ctx = nativeEditorState.context;
        const compendium = compendiumState.entries || snapshot.compendium || [];
        const selectedEntryIds = new Set(ctx.compendiumIds || []);
        const selectedTagSet = new Set(ctx.compendiumTags || []);
        const tagMatchedIds = new Set();
        const entryMap = new Map();
        compendium.forEach((entry) => {
            entryMap.set(entry.id, entry);
            if (!selectedEntryIds.has(entry.id)) {
                const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t || '').trim()).filter(Boolean) : [];
                if (tags.some((t) => selectedTagSet.has(t))) tagMatchedIds.add(entry.id);
            }
        });
        const chapterModes = ctx.chapterModes || {};
        const sceneModes = ctx.sceneModes || {};
        const selectedChapters = Object.entries(chapterModes).filter(([, mode]) => mode);
        const selectedScenes = Object.entries(sceneModes).filter(([, mode]) => mode);
        const parts = [];
        const directCount = selectedEntryIds.size;
        const tagCount = tagMatchedIds.size;
        if (directCount > 0 || tagCount > 0) {
            const names = [];
            selectedEntryIds.forEach((id) => {
                const entry = entryMap.get(id);
                if (entry) names.push(entry.title || '未命名资料');
            });
            tagMatchedIds.forEach((id) => {
                const entry = entryMap.get(id);
                if (entry) names.push(entry.title || '未命名资料');
            });
            const label = [];
            if (directCount > 0) label.push(`${directCount}条直接引用`);
            if (tagCount > 0) label.push(`${tagCount}条标签匹配`);
            const preview = names.slice(0, 3).join('、');
            const suffix = names.length > 3 ? ` 等${names.length}条` : '';
            parts.push(`资料: ${label.join('，')}（${preview}${suffix}）`);
        }
        if (selectedChapters.length > 0) {
            const modeLabels = { summary: '摘要', full: '全文' };
            const list = selectedChapters.map(([id, mode]) => {
                const chapter = (snapshot.chapters || []).find((c) => c.id === id);
                return `${chapter ? chapter.title || '未命名章节' : '未命名章节'}（${modeLabels[mode] || mode}）`;
            }).join(', ');
            parts.push(`章节引用: ${list}`);
        }
        if (selectedScenes.length > 0) {
            const modeLabels = { summary: '摘要', full: '全文' };
            const list = selectedScenes.map(([id, mode]) => {
                const scene = (snapshot.scenes || []).find((s) => s.id === id);
                return `${scene ? scene.title || '未命名场景' : '未命名场景'}（${modeLabels[mode] || mode}）`;
            }).join(', ');
            parts.push(`场景引用: ${list}`);
        }
        if (parts.length === 0) {
            elements.contextSummary.textContent = '未选择引用上下文。';
            return;
        }
        elements.contextSummary.textContent = parts.join(' | ');
    }

    function updateRewritePresetDescription() {
        var elements = nativeEditorElements();
        if (!elements.rewritePresetDescription) return;
        var preset = nativeEditorState.rewrite.preset || 'balanced-polish';
        var descriptions = {
            'balanced-polish': '使语言更自然、流畅、有画面感，保留原意。长度接近原文。',
            tighten: '压缩并精炼，删去重复拖沓，表达更干净有力。长度约原文 60%-80%。',
            expand: '适度扩写，补足动作、心理和环境细节。长度约原文 1.3-1.8 倍。',
            'show-dont-tell': '把直白说明改写为具体动作、感官细节和场景表现。',
            sensory: '增强感官描写和空间感，优先使用视觉、声音、触感等细节。',
            tension: '提高紧张感和压迫感，加强动作节奏和未知感。',
            'pace-fast': '让节奏更快利落，减少解释，使用更短句子和直接冲突。',
            'pace-slow': '放慢节奏，增加停顿、细微动作和情绪层次。',
            'dialogue-natural': '对白更自然有角色感，减少书面腔，加入动作承载潜台词。',
            subtext: '增加潜台词，把真实想法藏在措辞、停顿和反应里。',
            'emotion-deeper': '通过身体反应、记忆闪回、细微动作表现情绪，避免堆砌标签。',
            'character-voice': '贴合当前视角人物的性格、年龄和情绪，使角色声音更鲜明。',
            literary: '语言更凝练，意象更准确，节奏有余韵，避免华丽堆砌。',
            webnovel: '适合中文网文连载，节奏明确，情绪外放，冲突清楚。',
            cinematic: '增强电影镜头感，用清晰画面调度和动作顺序呈现。',
            clarity: '理清句子逻辑、人物指代和因果关系，让读者更容易理解。',
            continuity: '更自然衔接上下文，注意代词、时间和叙述视角一致性。',
            'remove-cliche': '去掉陈词滥调和套路化表达，换成更具体的表达。',
            'grammar-copyedit': '只做校对级修改：错别字、病句、标点，尽量保留原句结构。',
            'same-meaning-alt': '不改变原意，换一种更自然、更有可读性的写法。长度接近原文。',
            custom: '手动输入改写要求。'
        };
        elements.rewritePresetDescription.textContent = descriptions[preset] || '';
    }

    function rewriteInstructionText() {
        const preset = nativeEditorState.rewrite.preset || 'polish';
        const custom = (nativeEditorState.rewrite.instruction || '').trim();
        const presets = {
            'balanced-polish': '重写选中文本，使语言更自然、流畅、有画面感，同时保留原意、事实信息、人物关系和叙事视角。不要扩写过多，长度尽量接近原文。',
            tighten: '压缩并精炼选中文本，删去重复、拖沓、解释过度的句子，让表达更干净有力。保留关键动作、信息和情绪，长度约为原文的 60%-80%。',
            expand: '适度扩写选中文本，补足必要的动作衔接、心理反应、环境细节和节奏停顿。不要改变剧情走向和人物意图，长度约为原文的 1.3-1.8 倍。',
            'show-dont-tell': '把选中文本中的直白说明、总结性描述和情绪标签，改写成具体动作、感官细节、人物反应和可观察的场景表现。',
            sensory: '增强选中文本的感官描写和空间感，优先使用视觉、声音、触感、气味或温度等细节，让场景更可感。',
            tension: '提高选中文本的紧张感和压迫感。加强动作节奏、停顿、未知感、人物警觉或危险暗示。不要提前揭示答案。',
            'pace-fast': '让选中文本节奏更快、更利落。减少解释和内心独白，使用更短的句子、更清晰的动作链和更直接的冲突推进。',
            'pace-slow': '放慢选中文本叙事节奏，增加停顿、观察、细微动作和情绪层次，让读者更充分地感受到这一刻的重要性。',
            'dialogue-natural': '重写选中文本中的对白，让台词更自然、有角色感，减少书面腔和信息直给，并加入适量动作或停顿承载潜台词。',
            subtext: '增加潜台词。让人物少直接说出真实想法，把矛盾、犹豫、亲近或敌意藏在措辞、停顿、动作和反应里。',
            'emotion-deeper': '加深人物情绪层次。通过身体反应、记忆闪回、细微动作或自我克制表现情绪，避免直接堆砌情绪标签。',
            'character-voice': '让语言更贴合当前视角人物的性格、身份、年龄、经历和情绪状态。调整用词、观察重点和反应方式，使角色声音更鲜明。',
            literary: '将选中文本重写得更文学化：语言更凝练，意象更准确，节奏更有余韵。避免华丽堆砌和空泛比喻。',
            webnovel: '将选中文本重写得更适合中文网文连载：节奏明确，情绪更外放，冲突更清楚，句子更有推进力。',
            cinematic: '增强电影镜头感。用清晰的画面调度、动作顺序、视线移动和环境反应呈现场景，直接写成小说正文。',
            clarity: '理清句子逻辑、人物指代、动作先后和因果关系。不要改变剧情，只让读者更容易理解正在发生什么。',
            continuity: '让选中文本更自然地衔接上下文。注意代词、时间、动作连续性、情绪延续和叙述视角一致性。',
            'remove-cliche': '去掉陈词滥调、套路化形容和常见套话，换成更具体、更贴合当前场景和人物的表达。',
            'grammar-copyedit': '只做校对级修改：修正错别字、病句、标点、重复和明显不顺的表达。尽量保留原句结构、风格和长度。',
            'same-meaning-alt': '在不改变原意、不增删剧情信息的前提下，把选中文本换一种更自然、更有可读性的写法。长度接近原文。'
        };
        return custom || presets[preset] || presets['balanced-polish'];
    }

    async function loadRewritePrompts() {
        const projectId = currentProjectId();
        if (!projectId) {
            rewritePromptState.prompts = [];
            rewritePromptState.selectedId = '';
            renderRewriteSavedPrompts();
            return;
        }
        try {
            const response = await fetch(`/api/prompts?${new URLSearchParams({ projectId, category: 'rewrite' }).toString()}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            rewritePromptState.prompts = result.prompts || [];
            if (rewritePromptState.selectedId && !rewritePromptState.prompts.some(function (p) { return p.id === rewritePromptState.selectedId; })) {
                rewritePromptState.selectedId = '';
                nativeEditorState.rewrite.savedPromptId = '';
            }
        } catch (error) {
            console.warn('Failed to load rewrite prompts:', error);
            rewritePromptState.prompts = [];
        }
        renderRewriteSavedPrompts();
    }

    function renderRewriteSavedPrompts() {
        var elements = nativeEditorElements();
        if (!elements.rewriteSavedPrompt) return;
        elements.rewriteSavedPrompt.replaceChildren();
        var defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '不使用已保存的 Prompt...';
        elements.rewriteSavedPrompt.appendChild(defaultOption);
        rewritePromptState.prompts.forEach(function (prompt) {
            var option = document.createElement('option');
            option.value = prompt.id;
            option.textContent = prompt.title || '未命名 Prompt';
            if (prompt.id === nativeEditorState.rewrite.savedPromptId) option.selected = true;
            elements.rewriteSavedPrompt.appendChild(option);
        });
        if (elements.rewriteSavedPrompt.value !== (nativeEditorState.rewrite.savedPromptId || '')) {
            elements.rewriteSavedPrompt.value = nativeEditorState.rewrite.savedPromptId || '';
        }
    }

    function buildNativeRewritePrompt() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!scene || !elements.editor) return null;
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || 0;
        if (start === end) return null;
        const selectedText = elements.editor.value.slice(start, end);
        nativeEditorState.rewrite.originalText = selectedText;
        nativeEditorState.rewrite.selectionStart = start;
        nativeEditorState.rewrite.selectionEnd = end;
        const instruction = rewriteInstructionText();
        return {
            messages: [
                {
                    role: 'system',
                    content: '你是小说编辑助手。只输出改写后的正文，不要解释，不要加标题。'
                },
                {
                    role: 'user',
                    content: [
                        `改写要求：${instruction}`,
                        '',
                        `当前场景上下文：\n${elements.editor.value.slice(Math.max(0, start - 1200), Math.min(elements.editor.value.length, end + 1200))}`,
                        '',
                        `需要改写的文本：\n${selectedText}`,
                        '',
                        '请只输出改写后的文本：'
                    ].join('\n')
                }
            ],
            asString() {
                return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n');
            },
            selection: { start, end, selectedText },
            instruction
        };
    }

    function buildNativeRegenerateSelectionPrompt() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!scene || !elements.editor) return null;
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || 0;
        if (start === end) return null;
        const value = elements.editor.value || '';
        const selectedText = value.slice(start, end);
        nativeEditorState.rewrite.originalText = selectedText;
        nativeEditorState.rewrite.selectionStart = start;
        nativeEditorState.rewrite.selectionEnd = end;
        var useContext = nativeEditorState.rewrite.regenerateUseContext !== false;
        const instruction = (nativeEditorState.rewrite.instruction || '').trim() || '重新生成选中文段，使它自然衔接前后文，并保留当前剧情意图。';
        const contextBefore = useContext ? value.slice(Math.max(0, start - 8000), start) : '[用户选择不发送上下文]';
        const contextAfter = useContext ? value.slice(end, Math.min(value.length, end + 8000)) : '[用户选择不发送上下文]';
        const contextInstruction = useContext
            ? '必须使用前后文保持连续性，替换文本要能自然插回原位置。'
            : '请根据用户要求重新生成选中文段。';
        return {
            messages: [
                {
                    role: 'system',
                    content: '你是小说共同写作助手。只输出用于替换选区的小说正文，不要解释，不要加标题，不要使用 Markdown。'
                },
                {
                    role: 'user',
                    content: [
                        '请重新生成选中文段。',
                        contextInstruction,
                        '不要输出前文、后文、标签、分析或说明。',
                        '',
                        `用户要求：${instruction}`,
                        '',
                        `前文：\n${contextBefore}`,
                        '',
                        `需要替换的选中文段：\n${selectedText}`,
                        '',
                        `后文：\n${contextAfter}`,
                        '',
                        '替换后的正文：'
                    ].join('\n')
                }
            ],
            asString() {
                return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n');
            },
            selection: { start, end, selectedText },
            instruction
        };
    }

    function saveWriterModelOverride() {
        try {
            localStorage.setItem(WRITER_MODEL_KEY, JSON.stringify({
                profileId: writerModelOverride.profileId || 'inherit',
                model: writerModelOverride.model || 'inherit',
                customModel: writerModelOverride.customModel || '',
                thinking: !!writerModelOverride.thinking
            }));
        } catch (error) { /* ignore */ }
    }

    function loadWriterModelOverride() {
        try {
            var saved = JSON.parse(localStorage.getItem(WRITER_MODEL_KEY) || '{}');
            if (saved && typeof saved === 'object') {
                writerModelOverride.profileId = saved.profileId || 'inherit';
                writerModelOverride.customModel = String(saved.customModel || '').trim();
                if (saved.model === '__custom__') {
                    writerModelOverride.model = '__custom__';
                } else if (saved.model && saved.model !== 'inherit' && saved.model !== 'deepseek-v4-flash' && saved.model !== 'deepseek-v4-pro') {
                    writerModelOverride.model = '__custom__';
                    writerModelOverride.customModel = String(saved.model || '').trim();
                } else if (saved.model === 'inherit' || saved.model === 'deepseek-v4-flash' || saved.model === 'deepseek-v4-pro') {
                    writerModelOverride.model = saved.model;
                }
                writerModelOverride.thinking = !!saved.thinking;
            }
        } catch (error) { /* ignore */ }
    }

    function writerApiProfiles() {
        const settings = settingsWithRuntimeProfiles();
        return (settings.providerProfiles || []).filter((profile) => {
            return profile && profile.id && profile.hasApiKey && modelCatalog().isApiCompatibleProvider(profile.provider);
        });
    }

    function writerEffectiveProfile() {
        const settings = settingsWithRuntimeProfiles();
        const profiles = writerApiProfiles();
        const selectedProfile = profiles.find((profile) => profile.id === writerModelOverride.profileId);
        if (selectedProfile) {
            return {
                id: selectedProfile.id,
                label: selectedProfile.name || selectedProfile.provider || 'API 配置组',
                mode: 'api',
                provider: selectedProfile.provider,
                model: selectedProfile.model || ''
            };
        }
        const provider = settings.providerSettings || {};
        return {
            id: 'inherit',
            label: '继承全局',
            mode: provider.mode || 'local',
            provider: provider.provider || (provider.mode === 'local' ? 'lmstudio' : 'openai-compatible'),
            model: provider.model || ''
        };
    }

    function writerSelectedModelId(effectiveProfile) {
        if (writerModelOverride.model === '__custom__') return writerModelOverride.customModel || '';
        if (writerModelOverride.model && writerModelOverride.model !== 'inherit') return writerModelOverride.model;
        return effectiveProfile.model || '';
    }

    function renderWriterModelControl() {
        var elements = nativeEditorElements();
        if (!elements.modelSelect || !elements.modelControl) return;
        var catalog = modelCatalog();
        var profiles = writerApiProfiles();
        var effectiveProfile = writerEffectiveProfile();
        if (writerModelOverride.profileId !== 'inherit' && !profiles.some((profile) => profile.id === writerModelOverride.profileId)) {
            writerModelOverride.profileId = 'inherit';
            writerModelOverride.model = 'inherit';
            writerModelOverride.customModel = '';
            writerModelOverride.thinking = false;
            saveWriterModelOverride();
            effectiveProfile = writerEffectiveProfile();
        }

        if (elements.profileSelect) {
            elements.profileSelect.replaceChildren();
            const inherit = document.createElement('option');
            inherit.value = 'inherit';
            inherit.textContent = '继承全局设置';
            elements.profileSelect.appendChild(inherit);
            profiles.forEach((profile) => {
                const option = document.createElement('option');
                option.value = profile.id;
                option.textContent = `${profile.name || profile.provider} · ${catalog.getProviderMetadata(profile.provider).label || profile.provider}`;
                elements.profileSelect.appendChild(option);
            });
            elements.profileSelect.value = writerModelOverride.profileId || 'inherit';
        }

        const canSelectModel = effectiveProfile.mode === 'api' && catalog.isApiCompatibleProvider(effectiveProfile.provider);
        elements.modelControl.classList.toggle('is-disabled', !canSelectModel);
        if (elements.modelControlHint) {
            elements.modelControlHint.textContent = canSelectModel
                ? `${catalog.getProviderMetadata(effectiveProfile.provider).label || effectiveProfile.provider} · 只显示已添加 API 可用的模型`
                : '当前继承的是本地模型；如需切换云端模型，请先在设置中添加 API 配置组';
        }

        elements.modelSelect.replaceChildren();
        const inheritModel = document.createElement('option');
        inheritModel.value = 'inherit';
        inheritModel.textContent = '继承该配置默认模型';
        elements.modelSelect.appendChild(inheritModel);
        if (canSelectModel) {
            catalog.getProviderModels(effectiveProfile.provider).forEach((model) => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.label || model.id;
                elements.modelSelect.appendChild(option);
            });
        }
        elements.modelSelect.disabled = !canSelectModel;
        elements.modelSelect.value = writerModelOverride.model || 'inherit';
        if (elements.modelSelect.value !== (writerModelOverride.model || 'inherit')) {
            elements.modelSelect.value = 'inherit';
            writerModelOverride.model = 'inherit';
            writerModelOverride.customModel = '';
            writerModelOverride.thinking = false;
            saveWriterModelOverride();
        }

        if (elements.customModelGroup) elements.customModelGroup.hidden = writerModelOverride.model !== '__custom__';
        if (elements.customModelInput) {
            elements.customModelInput.value = writerModelOverride.customModel || '';
            elements.customModelInput.disabled = !canSelectModel || writerModelOverride.model !== '__custom__';
        }

        const selectedModel = writerSelectedModelId(effectiveProfile);
        const thinkingAllowed = canSelectModel && catalog.isThinkingSupported(effectiveProfile.provider, selectedModel);
        if (elements.thinkingToggle) {
            elements.thinkingToggle.disabled = !thinkingAllowed;
            if (!thinkingAllowed) writerModelOverride.thinking = false;
            elements.thinkingToggle.checked = !!writerModelOverride.thinking && thinkingAllowed;
        }

        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const defaults = settings.generationDefaults || {};
        const useProviderDefaults = !!defaults.useProviderDefaults;
        const thinkingActive = !!writerModelOverride.thinking && canSelectModel && catalog.isThinkingSupported(effectiveProfile.provider, selectedModel || effectiveProfile.model);
        const temperatureDisabled = useProviderDefaults || (effectiveProfile.provider === 'deepseek' && thinkingActive);
        if (elements.writerTemperature) {
            elements.writerTemperature.value = defaults.temperature === undefined ? 0.8 : defaults.temperature;
            elements.writerTemperature.disabled = temperatureDisabled;
        }
        if (elements.writerMaxTokens) {
            elements.writerMaxTokens.value = defaults.maxTokens || 2000;
            elements.writerMaxTokens.disabled = useProviderDefaults;
        }
        if (elements.writerProviderDefaults) {
            elements.writerProviderDefaults.checked = useProviderDefaults;
        }
        if (elements.writerSamplingHint) {
            if (useProviderDefaults) {
                elements.writerSamplingHint.textContent = '已交给服务商默认参数';
            } else if (effectiveProfile.provider === 'deepseek' && thinkingActive) {
                elements.writerSamplingHint.textContent = 'DeepSeek Thinking 不发送温度参数';
            } else {
                const maxTokens = defaults.maxTokens || 2000;
                elements.writerSamplingHint.textContent = maxTokens <= 800 ? '输出偏短，适合短句测试' : `约 ${maxTokens} tokens`;
            }
        }
    }

    function renderNativeGeneration() {
        const elements = nativeEditorElements();
        const generation = nativeEditorState.generation;
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        const activeChapter = scene && snapshot && Array.isArray(snapshot.chapters)
            ? snapshot.chapters.find((chapter) => chapter.id === scene.chapterId)
            : null;
        const currentText = scene
            ? (elements.editor ? String(elements.editor.value || '') : nativeSceneContent(scene.id))
            : '';
        const wordCount = countNativeWords(currentText);
        if (elements.copilotGreeting) {
            elements.copilotGreeting.textContent = scene
                ? `继续处理《${scene.title || '未命名场景'}》`
                : '打开一个场景后开始创作';
        }
        if (elements.copilotBrief) {
            elements.copilotBrief.textContent = scene
                ? '选择一个创作动作，或直接写下下一段的方向。'
                : '从书库打开项目并选择场景后，AI 写作动作会在这里启用。';
        }
        if (elements.copilotScene) {
            elements.copilotScene.textContent = scene ? (scene.title || '未命名场景') : '未选择场景';
        }
        if (elements.copilotChapter) {
            elements.copilotChapter.textContent = activeChapter ? (activeChapter.title || '未命名章节') : '未选择章节';
        }
        if (elements.copilotWords) {
            elements.copilotWords.textContent = scene ? `${formatNumber(wordCount)} 字` : '0 字';
        }
        if (elements.copilotContextNote) {
            const context = nativeEditorState.context || {};
            const extraCount = (context.compendiumIds || []).length
                + (context.compendiumTags || []).length
                + Object.values(context.chapterModes || {}).filter(Boolean).length
                + Object.values(context.sceneModes || {}).filter(Boolean).length;
            elements.copilotContextNote.textContent = extraCount > 0 ? `${extraCount} 项额外引用` : '未选择额外引用';
        }
        const isPreviewTask = generation.task === 'rewrite' || generation.task === 'regenerate-selection';
        if (elements.genTaskButtons && elements.genTaskButtons.length) {
            elements.genTaskButtons.forEach((btn) => {
                const task = btn.getAttribute('data-native-gen-task');
                btn.classList.toggle('is-active', task === generation.genTask);
            });
        }
        if (elements.beatInput) {
            if (elements.beatInput.value !== generation.beat) {
                elements.beatInput.value = generation.beat;
            }
            const placeholders = {
                'continue': '输入这一段要发生什么，或写下续写方向（可选）',
                'beat': '输入节拍描述（必填）',
                'summary': '无需输入，直接生成场景摘要'
            };
            elements.beatInput.placeholder = placeholders[generation.genTask] || '输入这一段要发生什么，或写下续写方向（可选）';
        }
        const isBeat = generation.genTask === 'beat';
        const canGenerate = !!scene && !generation.inProgress && (isBeat ? !!generation.beat.trim() : true);
        if (elements.previewPrompt) {
            const isSummary = generation.genTask === 'summary';
            elements.previewPrompt.disabled = !scene || generation.inProgress || isSummary || (isBeat && !generation.beat.trim());
        }
        if (elements.generate) elements.generate.disabled = !canGenerate;
        if (elements.cancelGeneration) {
            elements.cancelGeneration.hidden = !generation.inProgress;
            elements.cancelGeneration.disabled = !generation.inProgress;
        }
        const showGenerationOutput = !!generation.text || generation.inProgress;
        if (elements.editorBody) elements.editorBody.classList.toggle('has-generation-output', showGenerationOutput);
        if (elements.generationOutput) {
            elements.generationOutput.hidden = !showGenerationOutput;
            elements.generationOutput.classList.toggle('is-inline-confirmation', showGenerationOutput && !isPreviewTask);
        }
        if (elements.generationOutputStatus) {
            if (generation.inProgress) {
                if (generation.reasoning && !generation.text) {
                    elements.generationOutputStatus.textContent = '正在思考...';
                } else if (generation.inProgress && generation.text && !isPreviewTask) {
                    elements.generationOutputStatus.textContent = '正在正文中生成，生成段落已选中。';
                } else if (generation.inProgress && generation.text) {
                    elements.generationOutputStatus.textContent = '正在生成预览...';
                } else {
                    elements.generationOutputStatus.textContent = '正在生成，完成后可保留、重试或撤回。';
                }
            } else if (isPreviewTask) {
                elements.generationOutputStatus.textContent = '预览结果后点击"保留"替换原文，撤回会保持原文。';
            } else {
                elements.generationOutputStatus.textContent = '生成内容已在正文中选中，保留后会变为普通正文。';
            }
        }
        if (elements.generationResult) {
            elements.generationResult.hidden = !isPreviewTask;
            elements.generationResult.textContent = generation.text || (generation.inProgress && isPreviewTask ? '生成中...' : '');
        }
        if (elements.reasoning) {
            var effectiveThinking = writerModelOverride.thinking;
            if (writerModelOverride.model === 'inherit') {
                var globalConfig = runtimeProviderConfig();
                effectiveThinking = !!(globalConfig && globalConfig.enableThinking);
            }
            elements.reasoning.hidden = !(effectiveThinking && generation.inProgress) && !generation.reasoning;
        }
        if (elements.reasoningText) {
            if (generation.reasoning) {
                elements.reasoningText.textContent = generation.reasoning;
            } else if (generation.inProgress && writerModelOverride.thinking) {
                elements.reasoningText.textContent = '等待思考流...';
            } else if (generation.inProgress && writerModelOverride.model === 'inherit') {
                var globalConfig = runtimeProviderConfig();
                if (globalConfig && globalConfig.enableThinking) {
                    elements.reasoningText.textContent = '等待思考流...';
                } else {
                    elements.reasoningText.textContent = '';
                }
            } else {
                elements.reasoningText.textContent = '';
            }
        }
        if (elements.acceptGeneration) elements.acceptGeneration.disabled = !generation.text || generation.inProgress;
        if (elements.retryGeneration) {
            const needsBeat = generation.genTask === 'beat';
            elements.retryGeneration.disabled = generation.inProgress || (needsBeat && !generation.beat.trim());
        }
        if (elements.discardGeneration) elements.discardGeneration.disabled = generation.inProgress || !generation.text;
        if (elements.insertMode) elements.insertMode.disabled = generation.inProgress || !generation.text;
        if (elements.promptTemplate) {
            elements.promptTemplate.replaceChildren();
            const prompts = promptState.prompts.length ? promptState.prompts : [{ id: 'default-prose', title: '正文续写：均衡扩写' }];
            prompts.forEach((prompt) => {
                const option = document.createElement('option');
                option.value = prompt.id;
                option.textContent = prompt.title || '未命名提示词';
                elements.promptTemplate.appendChild(option);
            });
            elements.promptTemplate.value = promptState.selectedId;
            elements.promptTemplate.disabled = !currentProjectId();
        }
        if (elements.managePrompts) elements.managePrompts.disabled = !currentProjectId();

        if (elements.generationHistory) {
            const allRecords = nativeGenerationHistory();
            const scene = currentNativeScene();
            const filtered = nativeEditorState.historySceneFilter && scene
                ? allRecords.filter((r) => r.sceneId === scene.id)
                : allRecords;
            const records = filtered.slice(-5).reverse();
            elements.generationHistory.replaceChildren();
            if (elements.historyToolbar) {
                elements.historyToolbar.replaceChildren();
                const filterToggle = document.createElement('button');
                filterToggle.type = 'button';
                filterToggle.className = 'desktop-native-history-filter-toggle';
                filterToggle.setAttribute('data-native-history-filter', '');
                filterToggle.textContent = '当前场景';
                filterToggle.setAttribute('aria-pressed', nativeEditorState.historySceneFilter ? 'true' : 'false');
                if (nativeEditorState.historySceneFilter) filterToggle.classList.add('is-active');
                filterToggle.addEventListener('click', () => {
                    nativeEditorState.historySceneFilter = !nativeEditorState.historySceneFilter;
                    renderNativeGeneration();
                });
                elements.historyToolbar.appendChild(filterToggle);
            }
            if (!records.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-native-history-item';
                empty.textContent = '暂无生成记录';
                elements.generationHistory.appendChild(empty);
            } else {
                const snapshot = nativeEditorState.snapshot;
                const scenes = (snapshot && Array.isArray(snapshot.scenes)) ? snapshot.scenes : [];
                const TASK_LABELS = {
                    'fiction-prose': '正文扩写',
                    'summary': '场景摘要',
                    'continue': '续写',
                    'beat': '节拍生成'
                };
                records.forEach((record) => {
                    const item = document.createElement('div');
                    item.className = 'desktop-native-history-item';
                    const taskLabel = document.createElement('div');
                    taskLabel.className = 'desktop-native-history-task-label';
                    taskLabel.setAttribute('data-native-history-task', '');
                    taskLabel.textContent = TASK_LABELS[record.task] || record.task || '生成';
                    const sceneName = scenes.find((s) => s.id === record.sceneId);
                    if (sceneName) {
                        taskLabel.textContent += ` · ${sceneName.title || sceneName.id}`;
                        taskLabel.title = sceneName.title || sceneName.id;
                    }
                    const title = document.createElement('strong');
                    title.textContent = record.beat || '未命名生成';
                    const meta = document.createElement('span');
                    meta.className = 'desktop-native-history-meta';
                    meta.setAttribute('data-native-history-meta', '');
                    const wc = countNativeWords(record.resultText || '');
                    meta.textContent = `${new Date(record.createdAt || Date.now()).toLocaleString('zh-CN')} · ${wc} 字`;
                    const preview = document.createElement('div');
                    preview.className = 'desktop-native-history-preview';
                    preview.setAttribute('data-native-history-preview', '');
                    const previewText = (record.resultText || '').trim();
                    preview.textContent = previewText.slice(0, 60) + (previewText.length > 60 ? '...' : '');
                    const actions = document.createElement('div');
                    actions.className = 'desktop-native-history-actions';
                    const reuse = document.createElement('button');
                    reuse.type = 'button';
                    reuse.textContent = '复用提示';
                    reuse.setAttribute('data-native-history-reuse', '');
                    reuse.addEventListener('click', () => {
                        generation.beat = record.beat || '';
                        generation.text = record.resultText || '';
                        generation.reasoning = record.reasoning || '';
                        generation.prompt = { messages: record.messages || [], asString: () => record.promptText || '' };
                        renderNativeGeneration();
                    });
                    const copy = document.createElement('button');
                    copy.type = 'button';
                    copy.textContent = '复制';
                    copy.setAttribute('data-native-history-copy', '');
                    copy.disabled = !record.resultText;
                    copy.addEventListener('click', () => copyNativeHistoryRecord(record));
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.textContent = '重试';
                    retry.setAttribute('data-native-history-retry', '');
                    retry.disabled = !scene;
                    retry.addEventListener('click', () => retryNativeHistoryRecord(record));
                    const insert = document.createElement('button');
                    insert.type = 'button';
                    insert.textContent = '写入';
                    insert.setAttribute('data-native-history-insert', '');
                    insert.disabled = !scene || !record.resultText;
                    insert.addEventListener('click', () => insertNativeHistoryRecord(record));
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.textContent = '删除';
                    remove.setAttribute('data-native-history-delete', '');
                    remove.addEventListener('click', () => deleteNativeHistoryRecord(record));
                    actions.append(reuse, copy, retry, insert, remove);
                    item.append(taskLabel, title, meta, preview, actions);
                    elements.generationHistory.appendChild(item);
                });
            }
        }
    }

    function insertNativeHistoryRecord(record) {
        const generation = nativeEditorState.generation;
        if (!record || !record.resultText) return;
        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.beat = record.beat || '';
        generation.text = record.resultText || '';
        generation.reasoning = record.reasoning || '';
        generation.prompt = { messages: record.messages || [], asString: () => record.promptText || '' };
        generation.record = record;
        if (!prepareInlineGeneration('fiction-prose', null)) return;
        syncInlineGenerationToEditor();
        flushNativeEditorFields();
        markNativeDirty('历史生成已写入正文，未保存');
        renderNativeGeneration();
    }

    function deleteNativeHistoryRecord(record) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !Array.isArray(snapshot.promptHistory) || !record) return;
        snapshot.promptHistory = snapshot.promptHistory.filter((item) => item.id !== record.id);
        if (nativeEditorState.generation.record && nativeEditorState.generation.record.id === record.id) {
            nativeEditorState.generation.record = null;
        }
        markNativeDirty('历史记录已删除，未保存');
        renderNativeGeneration();
    }

    async function copyNativeHistoryRecord(record) {
        if (!record || !record.resultText) return;
        window.__draftHarborAuditClipboard = record.resultText;
        try {
            if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(record.resultText);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = record.resultText;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            setNativeSaveStatus('已复制到剪贴板', 'ok');
        } catch (error) {
            setNativeSaveStatus('复制失败', 'error');
        }
    }

    async function retryNativeHistoryRecord(record) {
        if (!record || !record.beat) return;
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!scene) {
            setNativeSaveStatus('请先选择一个场景', 'error');
            return;
        }
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        const generation = nativeEditorState.generation;
        if (generation.inProgress) return;
        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.text = '';
        generation.reasoning = '';
        generation.record = null;
        generation.prompt = null;
        generation.beat = record.beat || '';
        if (elements.beatInput) elements.beatInput.value = generation.beat;
        if (elements.generationResult) elements.generationResult.textContent = '';
        if (elements.generationOutput) elements.generationOutput.hidden = false;
        setNativeSaveStatus('正在重试...', 'info');
        nativeEditorState.assistantPanel = 'generate';
        renderNativeEditor();
        await startNativeGeneration();
    }

    function buildNativePrompt() {
        const elements = nativeEditorElements();
        if (elements.beatInput) nativeEditorState.generation.beat = elements.beatInput.value;
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        if (!scene || !snapshot || !window.DraftHarborPromptBuilder) return null;
        flushNativeEditorFields();
        const chapter = currentNativeChapter(scene);
        const template = selectedPromptTemplate();
        const context = window.DraftHarborContextResolver && typeof window.DraftHarborContextResolver.resolveContext === 'function'
            ? window.DraftHarborContextResolver.resolveContext({
                project: {
                    ...snapshot,
                    currentSceneId: scene.id
                },
                beat: nativeEditorState.generation.beat,
                selection: {
                    currentSceneId: scene.id,
                    recentSceneLimit: 6,
                    maxChars: 6000
                }
            })
            : { compendiumEntries: [], sceneSummaries: [] };
        const compendiumMap = new Map((context.compendiumEntries || []).map((entry) => [entry.id, entry]));
        (snapshot.compendium || []).forEach((entry) => {
            if (nativeEditorState.context.compendiumIds.includes(entry.id)) compendiumMap.set(entry.id, entry);
            const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
            if (tags.some((tag) => nativeEditorState.context.compendiumTags.includes(tag))) compendiumMap.set(entry.id, entry);
        });
        const sceneSummaryMap = new Map((context.sceneSummaries || []).map((item) => [item.title, item]));
        Object.entries(nativeEditorState.context.chapterModes || {}).forEach(([chapterId, mode]) => {
            const chapter = (snapshot.chapters || []).find((item) => item.id === chapterId);
            if (!chapter) return;
            const chapterScenes = (snapshot.scenes || [])
                .filter((item) => item.chapterId === chapterId && item.id !== scene.id)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
            const summary = mode === 'full'
                ? chapterScenes.map((item) => `${item.title || '未命名场景'}\n${nativeSceneContent(item.id)}`).join('\n\n')
                : (chapter.summary || chapterScenes.map((item) => `${item.title || '未命名场景'}：${item.summary || nativeSceneContent(item.id).slice(0, 600)}`).join('\n'));
            if (summary.trim()) {
                sceneSummaryMap.set(chapter.title || chapter.id, {
                    title: chapter.title || '未命名章节',
                    summary
                });
            }
        });
        Object.entries(nativeEditorState.context.sceneModes || {}).forEach(([sceneId, mode]) => {
            const referenced = (snapshot.scenes || []).find((item) => item.id === sceneId);
            if (!referenced || referenced.id === scene.id) return;
            sceneSummaryMap.set(referenced.title || referenced.id, {
                title: referenced.title || '未命名场景',
                summary: mode === 'full' ? nativeSceneContent(referenced.id) : (referenced.summary || nativeSceneContent(referenced.id).slice(0, 600))
            });
        });
        return window.DraftHarborPromptBuilder.buildFictionPrompt({
            beat: nativeEditorState.generation.beat,
            sceneContext: nativeSceneContent(scene.id),
            options: {
                povCharacter: scene.povCharacter || '',
                pov: '3rd person limited',
                tense: scene.tense || 'past',
                sceneSummaries: Array.from(sceneSummaryMap.values()),
                compendiumEntries: Array.from(compendiumMap.values()),
                systemPrompt: template.systemContent || '',
                prosePrompt: [chapter && chapter.summary ? `Chapter context: ${chapter.summary}` : '', template.content || '', context.manualText || ''].filter(Boolean).join('\n\n')
            }
        });
    }

    function showNativePromptPreview() {
        if (nativeEditorState.generation.genTask === 'summary') return;
        const elements = nativeEditorElements();
        const prompt = buildNativePrompt();
        if (!prompt) return;
        nativeEditorState.generation.prompt = prompt;
        if (elements.promptPreview) elements.promptPreview.textContent = prompt.asString ? prompt.asString() : JSON.stringify(prompt.messages || prompt, null, 2);
        if (elements.promptDialog && typeof elements.promptDialog.showModal === 'function') {
            elements.promptDialog.showModal();
        }
    }

    function nativeGenerationConfig(signal) {
        const effectiveProfile = writerEffectiveProfile();
        const selectedModel = writerSelectedModelId(effectiveProfile);
        const extras = { signal };
        if (writerModelOverride.profileId && writerModelOverride.profileId !== 'inherit') {
            extras.profileId = writerModelOverride.profileId;
        }
        if (writerModelOverride.model !== 'inherit' && selectedModel) {
            extras.model = selectedModel;
        }
        if (writerModelOverride.thinking && modelCatalog().isThinkingSupported(effectiveProfile.provider, selectedModel || effectiveProfile.model)) {
            extras.enableThinking = true;
        }
        return runtimeProviderConfig(extras);
    }

    function prepareInlineGeneration(task, prompt) {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const generation = nativeEditorState.generation;
        if (!elements.editor || !scene) return false;
        const current = elements.editor.value || '';
        let start = current.length;
        let end = current.length;
        if (task === 'rewrite' && prompt && prompt.selection) {
            start = prompt.selection.start;
            end = prompt.selection.end;
        } else {
            const mode = elements.insertMode ? elements.insertMode.value : 'append';
            if (mode === 'replace' && elements.editor.selectionStart !== elements.editor.selectionEnd) {
                start = elements.editor.selectionStart;
                end = elements.editor.selectionEnd;
            } else if (mode === 'cursor') {
                start = elements.editor.selectionStart || 0;
                end = start;
            }
        }
        generation.inlineBaseText = current;
        generation.insertionStart = start;
        generation.insertionEnd = end;
        generation.pendingSceneId = scene.id;
        generation.task = task || 'fiction-prose';
        return true;
    }

    function formatInlineGeneratedText(text) {
        const generation = nativeEditorState.generation;
        const base = generation.inlineBaseText || '';
        const before = base.slice(0, generation.insertionStart);
        const after = base.slice(generation.insertionEnd);
        if (generation.task === 'rewrite' || generation.task === 'regenerate-selection') return text;
        if (generation.insertionStart === base.length && generation.insertionEnd === base.length) {
            return base && text ? `\n\n${text}` : text;
        }
        const prefix = before && text && !/\s$/.test(before) ? '\n\n' : '';
        const suffix = after && text && !/^\s/.test(after) ? '\n\n' : '';
        return `${prefix}${text}${suffix}`;
    }

    function syncInlineGenerationToEditor() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const generation = nativeEditorState.generation;
        if (!elements.editor || !scene || generation.pendingSceneId !== scene.id) return;
        const inserted = formatInlineGeneratedText(generation.text || '');
        const nextValue = `${generation.inlineBaseText.slice(0, generation.insertionStart)}${inserted}${generation.inlineBaseText.slice(generation.insertionEnd)}`;
        elements.editor.value = nextValue;
        const cursor = generation.insertionStart + inserted.length;
        if (generation.task === 'rewrite' || generation.task === 'regenerate-selection') {
            elements.editor.selectionStart = cursor;
            elements.editor.selectionEnd = cursor;
        } else {
            elements.editor.selectionStart = generation.insertionStart;
            elements.editor.selectionEnd = cursor;
        }
        elements.editor.focus();
        updateNativeStats();
    }

    function restorePendingInlineGeneration() {
        const elements = nativeEditorElements();
        const generation = nativeEditorState.generation;
        if (!elements.editor || !generation.inlineBaseText || generation.pendingSceneId !== nativeEditorState.activeSceneId) return;
        elements.editor.value = generation.inlineBaseText;
        flushNativeEditorFields();
    }

    function insertNativeSpecialChar(char) {
        const elements = nativeEditorElements();
        if (!elements.editor || elements.editor.disabled) return;
        const value = elements.editor.value || '';
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || start;
        elements.editor.value = `${value.slice(0, start)}${char}${value.slice(end)}`;
        elements.editor.focus();
        elements.editor.selectionStart = start + char.length;
        elements.editor.selectionEnd = start + char.length;
        flushNativeEditorFields();
        markNativeDirty('已插入符号，未保存');
        updateNativeStats();
    }

    function stopNativeReading() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        nativeEditorState.tts.reading = false;
        const elements = nativeEditorElements();
        if (elements.readAloud) elements.readAloud.hidden = false;
        if (elements.stopReading) elements.stopReading.hidden = true;
    }

    function readNativeSceneAloud() {
        const elements = nativeEditorElements();
        if (!elements.editor || !window.speechSynthesis) {
            setNativeSaveStatus('当前环境不支持朗读', 'error');
            return;
        }
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || 0;
        const text = (start !== end ? elements.editor.value.slice(start, end) : elements.editor.value).trim();
        if (!text) {
            setNativeSaveStatus('没有可朗读的文本', 'error');
            return;
        }
        stopNativeReading();
        const utterance = new SpeechSynthesisUtterance(text);
        const savedRate = Number(window.localStorage.getItem('draftharbor:ttsSpeed') || '1');
        utterance.rate = Number.isFinite(savedRate) ? Math.min(2, Math.max(0.5, savedRate)) : 1;
        const savedVoice = window.localStorage.getItem('draftharbor:ttsVoice') || '';
        const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
        const voice = voices.find((item) => item.name === savedVoice) || voices.find((item) => /zh|Chinese|Mandarin/i.test(`${item.lang} ${item.name}`));
        if (voice) utterance.voice = voice;
        utterance.onend = stopNativeReading;
        utterance.onerror = stopNativeReading;
        nativeEditorState.tts.reading = true;
        if (elements.readAloud) elements.readAloud.hidden = true;
        if (elements.stopReading) elements.stopReading.hidden = false;
        window.speechSynthesis.speak(utterance);
    }

    function applyNativeAutoReplace() {
        const elements = nativeEditorElements();
        if (!elements.editor || elements.editor.disabled) return;
        const cursor = elements.editor.selectionStart || 0;
        const value = elements.editor.value || '';
        if (!value.includes('--')) return;
        const beforeCursor = value.slice(0, cursor);
        const nextValue = value.replace(/--/g, '—');
        const nextCursor = beforeCursor.replace(/--/g, '—').length;
        elements.editor.value = nextValue;
        elements.editor.selectionStart = nextCursor;
        elements.editor.selectionEnd = nextCursor;
    }

    async function startNativeGeneration() {
        const elements = nativeEditorElements();
        if (elements.beatInput) nativeEditorState.generation.beat = elements.beatInput.value;
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        if (!scene || !snapshot) {
            setNativeSaveStatus('请先选择一个场景', 'error');
            return { ok: false, reason: 'no-scene' };
        }
        if (nativeEditorState.generation.inProgress) return { ok: false, reason: 'in-progress' };
        const prompt = buildNativePrompt();
        if (nativeEditorState.generation.genTask === 'beat' && !nativeEditorState.generation.beat.trim()) {
            setNativeSaveStatus('请输入 beat', 'error');
            return { ok: false, reason: 'empty-beat' };
        }
        if (!prompt) {
            setNativeSaveStatus('Prompt 构建失败', 'error');
            return { ok: false, reason: 'no-prompt' };
        }

        const generation = nativeEditorState.generation;
        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.text = '';
        generation.reasoning = '';
        generation.prompt = prompt;
        generation.record = null;
        if (!prepareInlineGeneration('fiction-prose', prompt)) return { ok: false, reason: 'no-editor' };
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        renderNativeGeneration();
        setNativeSaveStatus('生成中...', 'info');

        const startedAt = new Date().toISOString();
        let failureMessage = '';
        try {
            if (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function') {
                throw new Error('Native generation provider stream is not loaded.');
            }
            await window.DraftHarborProviderStream.streamGeneration(prompt, (token, meta) => {
                if (meta && meta.type === 'reasoning') {
                    generation.reasoning += token;
                } else {
                    generation.text += token;
                }
                syncInlineGenerationToEditor();
                renderNativeGeneration();
            }, nativeGenerationConfig(generation.abortController && generation.abortController.signal));
            if (!generation.text.trim()) {
                throw new Error('AI provider returned an empty response.');
            }

            const result = window.DraftHarborGenerationResult
                ? window.DraftHarborGenerationResult.createGenerationResult({
                    task: 'fiction-prose',
                    text: generation.text,
                    reasoning: generation.reasoning,
                    messages: prompt.messages || [],
                    startedAt,
                    finishedAt: new Date().toISOString()
                })
                : { text: generation.text, messages: prompt.messages || [] };
            const record = window.DraftHarborGenerationHistory
                ? window.DraftHarborGenerationHistory.createGenerationRecord({
                    projectId: snapshot.project && snapshot.project.id,
                    sceneId: scene.id,
                    task: 'fiction-prose',
                    beat: generation.beat,
                    messages: prompt.messages || [],
                    promptText: prompt.asString ? prompt.asString() : '',
                    resultText: result.text || generation.text,
                    reasoning: result.reasoning || ''
                })
                : { id: `generation-${Date.now()}`, beat: generation.beat, resultText: generation.text, createdAt: new Date().toISOString() };
            snapshot.promptHistory = snapshot.promptHistory || [];
            snapshot.promptHistory.push(record);
            generation.record = record;
            setNativeSaveStatus('生成完成', 'ok');
            flushNativeEditorFields();
            markNativeDirty('生成结果已写入正文，未保存');
            return { ok: true, record };
        } catch (error) {
            if (error && error.name === 'AbortError') {
                setNativeSaveStatus('生成已取消', 'info');
            } else {
                console.error('Native generation failed:', error);
                const normalized = window.DraftHarborGenerationResult
                    ? window.DraftHarborGenerationResult.normalizeGenerationError(error)
                    : { message: error && error.message ? error.message : String(error) };
                failureMessage = normalized.message;
                setNativeSaveStatus(`生成失败：${normalized.message}`, 'error');
            }
        } finally {
            generation.inProgress = false;
            generation.abortController = null;
            renderNativeGeneration();
        }
        return { ok: false, reason: 'failed', message: failureMessage };
    }

    function showNativeRewritePreview() {
        const elements = nativeEditorElements();
        const prompt = buildNativeRewritePrompt();
        if (!prompt) {
            setNativeSaveStatus('请先在正文中选中文本', 'error');
            return;
        }
        if (elements.promptPreview) elements.promptPreview.textContent = prompt.asString();
        if (elements.promptDialog && typeof elements.promptDialog.showModal === 'function') {
            elements.promptDialog.showModal();
        }
    }

    let nativeAITaskRunner = null;

    function getNativeAITaskRunner() {
        if (nativeAITaskRunner) return nativeAITaskRunner;
        if (!window.DraftHarborAITaskRunner || typeof window.DraftHarborAITaskRunner.createAITaskRunner !== 'function') {
            return null;
        }
        nativeAITaskRunner = window.DraftHarborAITaskRunner.createAITaskRunner({
            streamGeneration(prompt, onToken, config) {
                if (!window.DraftHarborProviderStream || typeof window.DraftHarborProviderStream.streamGeneration !== 'function') {
                    throw new Error('Native generation provider stream is not loaded.');
                }
                return window.DraftHarborProviderStream.streamGeneration(prompt, onToken, config);
            }
        });
        return nativeAITaskRunner;
    }

    async function runNativeSelectionAITask(options) {
        const generation = nativeEditorState.generation;
        const snapshot = nativeEditorState.snapshot;
        const scene = options.scene;
        const prompt = options.prompt;
        const runner = getNativeAITaskRunner();
        if (!runner || !window.DraftHarborAITaskContract || !window.DraftHarborAITaskHistory) {
            setNativeSaveStatus(`${options.failurePrefix}：AI 任务执行器未加载`, 'error');
            return { ok: false, reason: 'missing-runner', message: 'AI 任务执行器未加载' };
        }

        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.task = options.action;
        generation.beat = prompt.instruction;
        generation.text = '';
        generation.reasoning = '';
        generation.prompt = prompt;
        generation.record = null;
        generation.aiTaskRecord = null;
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

        const effectiveProfile = writerEffectiveProfile();
        const task = {
            projectId: snapshot.project && snapshot.project.id,
            domain: 'prose',
            action: options.action,
            target: { type: 'scene', sceneId: scene.id },
            scope: 'selection',
            presetId: options.action === 'rewrite' ? nativeEditorState.rewrite.preset : '',
            instruction: prompt.instruction,
            providerProfileId: writerModelOverride.profileId !== 'inherit' ? writerModelOverride.profileId : '',
            model: writerSelectedModelId(effectiveProfile),
            outputContract: 'text',
            beforeSnapshot: {
                sceneId: scene.id,
                selectionStart: nativeEditorState.rewrite.selectionStart,
                selectionEnd: nativeEditorState.rewrite.selectionEnd,
                originalText: nativeEditorState.rewrite.originalText
            }
        };
        generation.aiTaskTargetKey = window.DraftHarborAITaskContract.taskTargetKey(task);
        renderNativeGeneration();
        setNativeSaveStatus(options.startStatus, 'info');

        let result;
        try {
            result = await runner.run(task, {
                prompt,
                abortController: generation.abortController,
                providerConfig: nativeGenerationConfig(generation.abortController && generation.abortController.signal),
                onToken(state) {
                    generation.text = state.text;
                    generation.reasoning = state.reasoning;
                    renderNativeGeneration();
                }
            });
            if (!result.ok) {
                console.error(options.logLabel, result.error);
                const message = result.error && result.error.message ? result.error.message : 'AI 任务执行失败';
                setNativeSaveStatus(`${options.failurePrefix}：${message}`, 'error');
                return { ok: false, reason: result.status || 'failed', message };
            }

            generation.text = result.text;
            generation.reasoning = result.reasoning;
            const record = window.DraftHarborAITaskHistory.toLegacyGenerationRecord(result.record, {
                sceneId: scene.id,
                task: options.action,
                beat: prompt.instruction,
                resultText: result.text
            });
            snapshot.promptHistory = snapshot.promptHistory || [];
            snapshot.promptHistory.push(record);
            generation.record = record;
            generation.aiTaskRecord = result.record;
            generation.lastAcceptedSceneId = scene.id;
            setNativeSaveStatus(options.successStatus, 'ok');
            return { ok: true, record, aiTaskRecord: result.record };
        } finally {
            generation.inProgress = false;
            generation.abortController = null;
            generation.aiTaskTargetKey = '';
            renderNativeGeneration();
        }
    }

    async function startNativeRewrite() {
        const elements = nativeEditorElements();
        if (elements.rewritePreset) nativeEditorState.rewrite.preset = elements.rewritePreset.value || 'polish';
        if (elements.rewriteInstruction) nativeEditorState.rewrite.instruction = elements.rewriteInstruction.value || '';
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        var prompt = buildNativeRewritePrompt();
        var scene = currentNativeScene();
        if (!prompt || !scene) {
            setNativeSaveStatus('请先在正文中选中文本', 'error');
            return { ok: false, reason: 'no-selection' };
        }
        var generation = nativeEditorState.generation;
        if (generation.inProgress) return { ok: false, reason: 'in-progress' };
        return runNativeSelectionAITask({
            action: 'rewrite',
            prompt,
            scene,
            startStatus: '改写中...',
            successStatus: '改写完成 - 预览结果后点击"保留"替代原文',
            failurePrefix: '改写失败',
            logLabel: 'Native rewrite failed:'
        });
    }

    async function startNativeRegenerateSelection() {
        var elements = nativeEditorElements();
        if (elements.rewriteInstruction) nativeEditorState.rewrite.instruction = elements.rewriteInstruction.value || '';
        if (elements.regenerateUseContext) {
            nativeEditorState.rewrite.regenerateUseContext = elements.regenerateUseContext.checked !== false;
        }
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(function () { return null; });
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        var prompt = buildNativeRegenerateSelectionPrompt();
        var scene = currentNativeScene();
        if (!prompt || !scene) {
            setNativeSaveStatus('请先在正文中选中要重生成的文本', 'error');
            return { ok: false, reason: 'no-selection' };
        }
        var generation = nativeEditorState.generation;
        if (generation.inProgress) return { ok: false, reason: 'in-progress' };
        return runNativeSelectionAITask({
            action: 'regenerate-selection',
            prompt,
            scene,
            startStatus: '正在重生成选区...',
            successStatus: '选区重生成完成 - 预览结果后点击"保留"替代原文',
            failurePrefix: '选区重生成失败',
            logLabel: 'Native selection regeneration failed:'
        });
    }

    async function generateNativeSummary(scope) {
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const chapter = currentNativeChapterByState();
        if (!nativeEditorState.snapshot || !scene || !chapter) return;
        flushNativeEditorFields();
        let sourceText = '';
        let targetTitle = '';
        if (scope === 'chapter') {
            const chapterScenes = (nativeEditorState.snapshot.scenes || [])
                .filter((item) => item.chapterId === chapter.id)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
            sourceText = chapterScenes.map((item) => {
                const content = nativeSceneContent(item.id).trim();
                return `${item.title || '未命名场景'}\n${item.summary || content}`;
            }).join('\n\n');
            targetTitle = chapter.title || '当前章节';
        } else {
            sourceText = nativeSceneContent(scene.id).trim();
            targetTitle = scene.title || '当前场景';
        }
        if (!sourceText.trim()) {
            setNativeSaveStatus('没有可总结的正文', 'error');
            return;
        }
        const prompt = {
            messages: [
                { role: 'system', content: '你是小说编辑助手。请输出简洁、准确、可用于后续上下文检索的摘要。不要加入评价。' },
                { role: 'user', content: `请为“${targetTitle}”生成 ${scope === 'chapter' ? '章节' : '场景'}摘要，控制在 120-220 字：\n\n${sourceText}` }
            ],
            asString() {
                return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n');
            }
        };
        const generation = nativeEditorState.generation;
        if (generation.inProgress) return;
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let summary = '';
        renderNativeGeneration();
        setNativeSaveStatus(scope === 'chapter' ? '正在生成章节摘要...' : '正在生成场景摘要...', 'info');
        try {
            await window.DraftHarborProviderStream.streamGeneration(prompt, (token) => {
                summary += token;
                if (scope === 'scene' && elements.summary) elements.summary.value = summary;
            }, nativeGenerationConfig(generation.abortController && generation.abortController.signal));
            summary = summary.trim();
            if (!summary) throw new Error('AI provider returned an empty response.');
            if (scope === 'chapter') {
                chapter.summary = summary;
                chapter.summaryUpdated = new Date().toISOString();
                chapter.summarySource = 'ai';
            } else {
                scene.summary = summary;
                scene.summaryUpdated = new Date().toISOString();
                scene.summarySource = 'ai';
                scene.summaryStale = false;
                if (elements.summary) elements.summary.value = summary;
            }
            markNativeDirty(scope === 'chapter' ? '章节摘要已生成，未保存' : '场景摘要已生成，未保存');
            renderNativeEditor();
        } catch (error) {
            console.error('Native summary failed:', error);
            setNativeSaveStatus(`摘要生成失败：${error.message || error}`, 'error');
        } finally {
            generation.inProgress = false;
            generation.abortController = null;
            renderNativeGeneration();
        }
    }

    function acceptNativeGeneration() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const generation = nativeEditorState.generation;
        if (!scene || !generation.text || !elements.editor) return;
        syncInlineGenerationToEditor();
        elements.editor.selectionStart = generation.insertionStart + formatInlineGeneratedText(generation.text || '').length;
        elements.editor.selectionEnd = elements.editor.selectionStart;
        generation.lastAcceptedSceneId = scene.id;
        generation.text = '';
        generation.reasoning = '';
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        flushNativeEditorFields();
        markNativeDirty('已保留生成内容，未保存');
        renderNativeEditor();
        renderNativeGeneration();
    }

    function discardNativeGeneration() {
        const elements = nativeEditorElements();
        const generation = nativeEditorState.generation;
        if (elements.editor && generation.pendingSceneId === nativeEditorState.activeSceneId && generation.inlineBaseText) {
            elements.editor.value = generation.inlineBaseText;
            flushNativeEditorFields();
            markNativeDirty('已撤回生成内容，未保存');
        }
        generation.text = '';
        generation.reasoning = '';
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.task = '';
        nativeEditorState.rewrite.originalText = '';
        nativeEditorState.rewrite.selectionStart = 0;
        nativeEditorState.rewrite.selectionEnd = 0;
        renderNativeGeneration();
        setNativeSaveStatus('已撤回生成内容', 'info');
    }

    function acceptNativeRewrite() {
        var elements = nativeEditorElements();
        var scene = currentNativeScene();
        var generation = nativeEditorState.generation;
        if (!scene || !generation.text || !elements.editor) return;
        if (generation.lastAcceptedSceneId && generation.lastAcceptedSceneId !== scene.id) {
            setNativeSaveStatus('已切换场景，改写结果已失效。请回到原场景或重新执行改写。', 'error');
            return;
        }
        var origStart = nativeEditorState.rewrite.selectionStart;
        var origEnd = nativeEditorState.rewrite.selectionEnd;
        var origText = nativeEditorState.rewrite.originalText || '';
        var currentSelection = elements.editor.value.slice(origStart, origEnd);
        if (origText && currentSelection !== origText) {
            setNativeSaveStatus('原文已发生变化，无法安全替换。请重新选中并执行改写。', 'error');
            return;
        }
        if (origStart < origEnd) {
            var before = elements.editor.value.slice(0, origStart);
            var after = elements.editor.value.slice(origEnd);
            var replacement = generation.text || '';
            elements.editor.value = before + replacement + after;
            elements.editor.selectionStart = origStart;
            elements.editor.selectionEnd = origStart + replacement.length;
            elements.editor.focus();
            flushNativeEditorFields();
            markNativeDirty('已接受改写结果，未保存');
        }
        generation.lastAcceptedSceneId = scene.id;
        generation.text = '';
        generation.reasoning = '';
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.task = '';
        nativeEditorState.rewrite.originalText = '';
        nativeEditorState.rewrite.selectionStart = 0;
        nativeEditorState.rewrite.selectionEnd = 0;
        renderNativeEditor();
        renderNativeGeneration();
        setNativeSaveStatus('已接受改写结果', 'ok');
    }

    function cancelNativeGeneration() {
        const generation = nativeEditorState.generation;
        const runner = getNativeAITaskRunner();
        if (runner && generation.aiTaskTargetKey && runner.cancel(generation.aiTaskTargetKey)) return;
        const controller = generation.abortController;
        if (controller) controller.abort();
    }

    async function openDesktopProject(project) {
        if (project && project.health === 'invalid') {
            setProjectLibraryStatus('这个项目文件暂时无法读取，请先检查磁盘快照。', 'error');
            return;
        }

        setProjectLibraryStatus(`正在打开《${project.name || '未命名项目'}》...`, 'info');
        setView('writer');

        const snapshot = await fetchProjectSnapshot(project);
        loadNativeProjectEditor(snapshot, project || {});
        loadReaderFromProjectSnapshot(snapshot);
        await loadCompendium();
        await loadPrompts();
        await loadRewritePrompts();
        await loadWorkshopSessions();
        await loadWorkflowRuns();

        setProjectLibraryStatus('', 'ok');
    }

    function bindNativeEditor() {
        const elements = nativeEditorElements();
        if (elements.saveButton) {
            elements.saveButton.addEventListener('click', () => {
                saveNativeScene();
            });
        }
        if (elements.sendToWorkshop) elements.sendToWorkshop.addEventListener('click', sendNativeSelectionToWorkshop);
        if (elements.saveToCompendium) elements.saveToCompendium.addEventListener('click', saveNativeSelectionToCompendium);
        if (elements.readAloud) elements.readAloud.addEventListener('click', readNativeSceneAloud);
        if (elements.stopReading) elements.stopReading.addEventListener('click', stopNativeReading);
        if (elements.toggleOutline) {
            elements.toggleOutline.addEventListener('click', () => {
                nativeEditorState.outlineCollapsed = !nativeEditorState.outlineCollapsed;
                renderNativeEditor();
            });
        }
        if (elements.toggleAssistant) {
            elements.toggleAssistant.addEventListener('click', () => {
                nativeEditorState.assistantCollapsed = !nativeEditorState.assistantCollapsed;
                renderNativeEditor();
            });
        }
        if (elements.assistantPlacement) {
            elements.assistantPlacement.addEventListener('click', () => {
                nativeEditorState.assistantPlacement = nativeEditorState.assistantPlacement === 'bottom' ? 'right' : 'bottom';
                try { window.localStorage.setItem('draftharbor:nativeAssistantPlacement', nativeEditorState.assistantPlacement); } catch (error) { /* ignore */ }
                renderNativeEditor();
            });
        }
        if (elements.toggleSpecials) {
            elements.toggleSpecials.addEventListener('click', () => {
                const shouldOpen = elements.specials ? elements.specials.hidden : false;
                closeNativeWriterPopovers({ keep: 'specials' });
                if (elements.specials) elements.specials.hidden = !shouldOpen;
                elements.toggleSpecials.setAttribute('aria-pressed', shouldOpen ? 'true' : 'false');
            });
        }
        if (elements.toggleTypography) {
            elements.toggleTypography.addEventListener('click', () => {
                const shouldOpen = !nativeEditorState.typographyOpen;
                closeNativeWriterPopovers({ keep: 'typography' });
                nativeEditorState.typographyOpen = shouldOpen;
                renderNativeEditor();
            });
        }
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!target || !target.closest) return;
            if (target.closest('[data-native-typography], [data-native-specials], [data-native-toggle-typography], [data-native-toggle-specials]')) return;
            closeNativeWriterPopovers();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const elements = nativeEditorElements();
            const hasOpenPopover = (elements.typography && !elements.typography.hidden) || (elements.specials && !elements.specials.hidden);
            if (!hasOpenPopover) return;
            event.preventDefault();
            closeNativeWriterPopovers();
        });
        [
            ['editorFontSize', 'fontSize'],
            ['editorLineHeight', 'lineHeight'],
            ['editorTextWidth', 'textWidth'],
            ['editorParagraphSpacing', 'paragraphSpacing']
        ].forEach(([elementKey, prefKey]) => {
            const field = elements[elementKey];
            if (!field) return;
            field.addEventListener('input', () => {
                const limits = {
                    fontSize: [15, 24, 18],
                    lineHeight: [1.45, 2.2, 1.9],
                    textWidth: [620, 1040, 760],
                    paragraphSpacing: [0, 1.5, 0]
                }[prefKey];
                nativeEditorState.editorPrefs[prefKey] = clampNumber(field.value, limits[0], limits[1], limits[2]);
                saveNativeEditorPrefs();
                applyNativeEditorPrefs();
            });
        });
        if (elements.editorFontFamily) {
            elements.editorFontFamily.addEventListener('change', () => {
                nativeEditorState.editorPrefs.fontFamily = elements.editorFontFamily.value || 'system';
                saveNativeEditorPrefs();
                applyNativeEditorPrefs();
            });
        }
        if (elements.editorWordGoal) {
            elements.editorWordGoal.addEventListener('input', () => {
                nativeEditorState.editorPrefs.wordGoal = clampNumber(elements.editorWordGoal.value, 0, 999999, 0);
                saveNativeEditorPrefs();
                updateNativeStats();
            });
        }
        elements.specialButtons.forEach((button) => {
            button.addEventListener('click', () => {
                insertNativeSpecialChar(button.dataset.nativeSpecialChar || button.textContent || '');
                if (elements.specials) elements.specials.hidden = true;
            });
        });
        if (elements.sceneTitle) {
            elements.sceneTitle.addEventListener('dblclick', beginNativeSceneTitleEdit);
            elements.sceneTitle.addEventListener('keydown', (event) => {
                if (!currentNativeScene()) return;
                if (!nativeEditorState.titleEditing && (event.key === 'Enter' || event.key === 'F2')) {
                    event.preventDefault();
                    beginNativeSceneTitleEdit();
                    return;
                }
                if (nativeEditorState.titleEditing && event.key === 'Enter') {
                    event.preventDefault();
                    finishNativeSceneTitleEdit();
                }
                if (nativeEditorState.titleEditing && event.key === 'Escape') {
                    event.preventDefault();
                    finishNativeSceneTitleEdit({ cancel: true });
                }
            });
            elements.sceneTitle.addEventListener('blur', () => {
                if (nativeEditorState.titleEditing) finishNativeSceneTitleEdit();
            });
        }
        if (elements.focusMode) {
            elements.focusMode.addEventListener('click', () => {
                nativeEditorState.focusMode = !nativeEditorState.focusMode;
                renderNativeEditor();
                if (elements.editor && nativeEditorState.focusMode) elements.editor.focus();
            });
        }
        elements.panelTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                nativeEditorState.assistantPanel = tab.dataset.nativePanelTab || 'generate';
                renderNativeEditor();
            });
        });
        if (elements.search) {
            elements.search.addEventListener('input', () => {
                nativeEditorState.searchQuery = elements.search.value;
                renderNativeEditor();
            });
        }
        if (elements.replaceCurrent) elements.replaceCurrent.addEventListener('click', () => replaceNativeText('current'));
        if (elements.replaceAll) elements.replaceAll.addEventListener('click', () => replaceNativeText('all'));
        if (elements.searchPrev) elements.searchPrev.addEventListener('click', () => navigateNativeSearchMatch(-1));
        if (elements.searchNext) elements.searchNext.addEventListener('click', () => navigateNativeSearchMatch(1));
        if (elements.editor) {
            elements.editor.addEventListener('input', () => {
                if (!nativeEditorState.snapshot || !nativeEditorState.activeSceneId) return;
                applyNativeAutoReplace();
                markNativeDirty();
                if (nativeEditorState.searchQuery.trim()) updateNativeSearchMatchState();
            });
            ['select', 'mouseup', 'keyup'].forEach((eventName) => {
                elements.editor.addEventListener(eventName, renderNativeRewrite);
            });
        }
        [elements.summary, elements.tags, elements.pov, elements.tense].forEach((field) => {
            if (!field) return;
            field.addEventListener('input', () => {
                if (!nativeEditorState.snapshot || !nativeEditorState.activeSceneId) return;
                markNativeDirty();
            });
            field.addEventListener('change', () => {
                if (!nativeEditorState.snapshot || !nativeEditorState.activeSceneId) return;
                markNativeDirty();
            });
        });
        if (elements.newProject) {
            elements.newProject.addEventListener('click', () => {
                openProjectCreator();
            });
        }
        if (elements.showBookshelf) {
            elements.showBookshelf.addEventListener('click', () => {
                setView('bookshelf');
            });
        }
        if (elements.addChapter) elements.addChapter.addEventListener('click', addNativeChapter);
        if (elements.renameChapter) elements.renameChapter.addEventListener('click', renameNativeChapter);
        if (elements.deleteChapter) elements.deleteChapter.addEventListener('click', deleteNativeChapter);
        if (elements.addScene) elements.addScene.addEventListener('click', addNativeScene);
        if (elements.renameScene) elements.renameScene.addEventListener('click', renameNativeScene);
        if (elements.deleteScene) elements.deleteScene.addEventListener('click', deleteNativeScene);
        if (elements.moveSceneUp) elements.moveSceneUp.addEventListener('click', () => moveNativeScene(-1));
        if (elements.moveSceneDown) elements.moveSceneDown.addEventListener('click', () => moveNativeScene(1));
        if (elements.exportMarkdown) elements.exportMarkdown.addEventListener('click', () => downloadNativeExport('markdown'));
        if (elements.exportText) elements.exportText.addEventListener('click', () => downloadNativeExport('text'));
        if (elements.exportHtml) elements.exportHtml.addEventListener('click', () => downloadNativeExport('html'));
        if (elements.exportEpub) elements.exportEpub.addEventListener('click', () => downloadNativeExport('epub'));
        if (elements.exportPackage) elements.exportPackage.addEventListener('click', downloadNativeProjectPackage);
        if (elements.exportIncludeSceneTitles) elements.exportIncludeSceneTitles.addEventListener('change', saveExportOptions);
        if (elements.beatInput) {
            elements.beatInput.addEventListener('input', () => {
                nativeEditorState.generation.beat = elements.beatInput.value;
                renderNativeGeneration();
            });
        }
        if (elements.modelSelect) {
            elements.modelSelect.addEventListener('change', () => {
                writerModelOverride.model = elements.modelSelect.value || 'inherit';
                if (writerModelOverride.model !== '__custom__') writerModelOverride.customModel = '';
                writerModelOverride.thinking = false;
                saveWriterModelOverride();
                renderWriterModelControl();
            });
        }
        if (elements.profileSelect) {
            elements.profileSelect.addEventListener('change', () => {
                writerModelOverride.profileId = elements.profileSelect.value || 'inherit';
                writerModelOverride.model = 'inherit';
                writerModelOverride.customModel = '';
                writerModelOverride.thinking = false;
                saveWriterModelOverride();
                renderWriterModelControl();
                renderNativeGeneration();
            });
        }
        if (elements.customModelInput) {
            elements.customModelInput.addEventListener('input', () => {
                writerModelOverride.customModel = elements.customModelInput.value.trim();
                saveWriterModelOverride();
                renderWriterModelControl();
            });
        }
        if (elements.thinkingToggle) {
            elements.thinkingToggle.addEventListener('change', () => {
                writerModelOverride.thinking = !!elements.thinkingToggle.checked;
                saveWriterModelOverride();
                renderWriterModelControl();
            });
        }
        if (elements.closePrompt) {
            elements.closePrompt.addEventListener('click', () => {
                if (elements.promptDialog && typeof elements.promptDialog.close === 'function') elements.promptDialog.close();
            });
        }
        if (elements.promptTemplate) {
            elements.promptTemplate.addEventListener('change', () => {
                promptState.selectedId = elements.promptTemplate.value || 'default-prose';
                renderPromptManager();
            });
        }
        if (elements.managePrompts) {
            elements.managePrompts.addEventListener('click', () => {
                renderPromptManager();
                if (elements.promptManagerDialog && typeof elements.promptManagerDialog.showModal === 'function') {
                    elements.promptManagerDialog.showModal();
                }
            });
        }
        if (elements.promptManagerForm) elements.promptManagerForm.addEventListener('submit', savePromptTemplate);
        if (elements.promptManagerList) {
            elements.promptManagerList.addEventListener('click', (event) => {
                const target = event.target && event.target.closest ? event.target.closest('[data-prompt-manager-select]') : null;
                if (!target) return;
                promptState.selectedId = target.dataset.promptManagerSelect || 'default-prose';
                if (elements.promptTemplate && elements.promptTemplate.querySelector(`option[value="${CSS.escape(promptState.selectedId)}"]`)) {
                    elements.promptTemplate.value = promptState.selectedId;
                }
                renderPromptManager();
            });
        }
        if (elements.promptManagerNew) elements.promptManagerNew.addEventListener('click', newPromptTemplate);
        if (elements.promptManagerDelete) elements.promptManagerDelete.addEventListener('click', deletePromptTemplate);
        if (elements.promptManagerClose) {
            elements.promptManagerClose.addEventListener('click', () => {
                if (elements.promptManagerDialog && typeof elements.promptManagerDialog.close === 'function') elements.promptManagerDialog.close();
            });
        }
        if (elements.rewritePreset) {
            elements.rewritePreset.addEventListener('change', () => {
                nativeEditorState.rewrite.preset = elements.rewritePreset.value || 'polish';
                nativeEditorState.rewrite.savedPromptId = '';
                nativeEditorState.rewrite.instruction = '';
                nativeEditorState.rewrite.instruction = rewriteInstructionText();
                if (elements.rewriteInstruction) elements.rewriteInstruction.value = nativeEditorState.rewrite.instruction;
                renderNativeRewrite();
            });
        }
        if (elements.rewriteSavedPrompt) {
            elements.rewriteSavedPrompt.addEventListener('change', function () {
                var selectedId = elements.rewriteSavedPrompt.value || '';
                nativeEditorState.rewrite.savedPromptId = selectedId;
                if (selectedId) {
                    var selected = rewritePromptState.prompts.find(function (p) { return p.id === selectedId; });
                    if (selected && selected.content) {
                        nativeEditorState.rewrite.preset = 'custom';
                        nativeEditorState.rewrite.instruction = selected.content;
                        if (elements.rewritePreset) elements.rewritePreset.value = 'custom';
                        if (elements.rewriteInstruction) elements.rewriteInstruction.value = selected.content;
                    }
                }
                renderNativeRewrite();
            });
        }
        if (elements.rewriteInstruction) {
            elements.rewriteInstruction.addEventListener('input', () => {
                nativeEditorState.rewrite.instruction = elements.rewriteInstruction.value || '';
                nativeEditorState.rewrite.savedPromptId = '';
                nativeEditorState.rewrite.preset = 'custom';
                if (elements.rewritePreset) elements.rewritePreset.value = 'custom';
                renderNativeRewrite();
            });
        }
        if (elements.regenerateUseContext) {
            elements.regenerateUseContext.addEventListener('change', function () {
                nativeEditorState.rewrite.regenerateUseContext = elements.regenerateUseContext.checked !== false;
            });
        }
        if (elements.writerTemperature) {
            elements.writerTemperature.addEventListener('change', function () {
                saveWriterGenerationDefaults({ temperature: Number(elements.writerTemperature.value || 0.8) });
            });
        }
        if (elements.writerMaxTokens) {
            elements.writerMaxTokens.addEventListener('change', function () {
                saveWriterGenerationDefaults({ maxTokens: Number(elements.writerMaxTokens.value || 2000) });
            });
        }
        if (elements.writerProviderDefaults) {
            elements.writerProviderDefaults.addEventListener('change', function () {
                saveWriterGenerationDefaults({ useProviderDefaults: !!elements.writerProviderDefaults.checked });
            });
        }
        if (elements.previewRewrite) elements.previewRewrite.addEventListener('click', showNativeRewritePreview);
        if (elements.startRewrite) elements.startRewrite.addEventListener('click', startNativeRewrite);
        if (elements.regenerateSelection) elements.regenerateSelection.addEventListener('click', startNativeRegenerateSelection);
        if (elements.genTaskButtons && elements.genTaskButtons.length) {
            elements.genTaskButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    nativeEditorState.generation.genTask = btn.getAttribute('data-native-gen-task') || 'continue';
                    renderNativeGeneration();
                });
            });
        }
        if (elements.copilotSuggestionButtons && elements.copilotSuggestionButtons.length) {
            elements.copilotSuggestionButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    nativeEditorState.generation.genTask = 'beat';
                    nativeEditorState.generation.beat = btn.getAttribute('data-native-copilot-suggestion') || '';
                    if (elements.beatInput) elements.beatInput.value = nativeEditorState.generation.beat;
                    renderNativeGeneration();
                    if (elements.beatInput) elements.beatInput.focus();
                });
            });
        }
        if (elements.rewriteTaskButtons && elements.rewriteTaskButtons.length) {
            const rewriteTaskPresetMap = {
                polish: 'balanced-polish',
                expand: 'expand',
                shorten: 'tighten',
                style: 'same-meaning-alt'
            };
            elements.rewriteTaskButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const task = btn.getAttribute('data-native-rewrite-task') || 'polish';
                    nativeEditorState.rewrite.rewriteTask = task;
                    nativeEditorState.rewrite.preset = rewriteTaskPresetMap[task] || 'balanced-polish';
                    nativeEditorState.rewrite.savedPromptId = '';
                    nativeEditorState.rewrite.instruction = '';
                    nativeEditorState.rewrite.instruction = rewriteInstructionText();
                    if (elements.rewriteInstruction) elements.rewriteInstruction.value = nativeEditorState.rewrite.instruction;
                    renderNativeRewrite();
                });
            });
        }
        if (elements.generateSceneSummary) elements.generateSceneSummary.addEventListener('click', () => generateNativeSummary('scene'));
        if (elements.generateChapterSummary) elements.generateChapterSummary.addEventListener('click', () => generateNativeSummary('chapter'));
        if (elements.newCharacter) {
            elements.newCharacter.addEventListener('click', async () => {
                compendiumState.type = 'character';
                await createCompendiumEntry('character');
                nativeEditorState.assistantPanel = 'characters';
                renderNativeEditor();
            });
        }
        if (elements.openCompendium) {
            elements.openCompendium.addEventListener('click', () => {
                compendiumState.type = 'character';
                setView('compendium');
                renderCompendium();
            });
        }
        document.addEventListener('click', (event) => {
            const target = event.target && event.target.closest ? event.target.closest('[data-native-generate],[data-native-preview-prompt],[data-native-cancel-generation],[data-native-accept-generation],[data-native-retry-generation],[data-native-discard-generation]') : null;
            if (!target) return;
            if (target.dataset.nativeGenerate !== undefined) {
                if (nativeEditorState.generation.genTask === 'summary') {
                    generateNativeSummary('scene');
                } else {
                    startNativeGeneration();
                }
            }
            if (target.dataset.nativePreviewPrompt !== undefined) showNativePromptPreview();
            if (target.dataset.nativeCancelGeneration !== undefined) cancelNativeGeneration();
            if (target.dataset.nativeAcceptGeneration !== undefined) {
                if (nativeEditorState.generation.task === 'rewrite' || nativeEditorState.generation.task === 'regenerate-selection') {
                    acceptNativeRewrite();
                } else {
                    acceptNativeGeneration();
                }
            }
            if (target.dataset.nativeRetryGeneration !== undefined) {
                if (nativeEditorState.generation.task === 'rewrite') {
                    startNativeRewrite();
                } else if (nativeEditorState.generation.task === 'regenerate-selection') {
                    startNativeRegenerateSelection();
                } else if (nativeEditorState.generation.genTask === 'summary') {
                    generateNativeSummary('scene');
                } else {
                    startNativeGeneration();
                }
            }
            if (target.dataset.nativeDiscardGeneration !== undefined) discardNativeGeneration();
        });
        window.addEventListener('keydown', (event) => {
            if (!nativeEditorState.snapshot) return;
            const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
            if (isSave) {
                event.preventDefault();
                saveNativeScene();
            }
            const isNewScene = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n';
            if (isNewScene) {
                event.preventDefault();
                addNativeScene();
            }
            if (event.altKey && event.key === 'ArrowUp') {
                event.preventDefault();
                switchNativeScene(-1);
            }
            if (event.altKey && event.key === 'ArrowDown') {
                event.preventDefault();
                switchNativeScene(1);
            }
        });
        window.addEventListener('beforeunload', (event) => {
            if (!nativeEditorState.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
        renderNativeEditor();
    }

    function bindContextStrip() {
        const elements = contextStripElements();
        if (elements.gotoWriter) elements.gotoWriter.addEventListener('click', () => setView('writer'));
        if (elements.gotoCompendium) elements.gotoCompendium.addEventListener('click', () => {
            setView('compendium');
            renderCompendium();
        });
        if (elements.gotoWorkshop) elements.gotoWorkshop.addEventListener('click', async () => {
            if (currentProjectId() && !selectedWorkshopSession()) {
                await createWorkshopSession();
            }
            setView('workshop');
            renderWorkshop();
        });
        if (elements.gotoBookshelf) elements.gotoBookshelf.addEventListener('click', () => setView('bookshelf'));
    }

    function init() {
        applyDesktopThemeFromStorage();
        try {
            const placement = window.localStorage.getItem('draftharbor:nativeAssistantPlacement');
            if (placement === 'bottom' || placement === 'right') nativeEditorState.assistantPlacement = placement;
        } catch (error) { /* ignore */ }
        loadWriterModelOverride();
        loadNativeEditorPrefs();
        loadExportOptions();
        bindNavigation();
        bindWindowControls();
        bindProjectLibrary();
        bindProjectCreator();
        bindProjectEditor();
        bindContextStrip();
        bindNativeEditor();
        bindRecovery();
        bindReader();
        bindSettings();
        bindCompendium();
        bindWorkshop();
        bindWorkflow();
        const state = getState();
        setView(state ? state.loadInitialView() : 'bookshelf');
        loadProjectLibrary();
        loadRecoveryList();
        loadSettings();
        renderCompendium();
        renderWorkshop();
        renderWorkflow();
        renderContextStrip();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.DraftHarborDesktopShell = {
        loadProjectLibrary,
        setView,
        toggleFullscreen,
        startNativeGeneration,
        loadSettings
    };
})();
