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
