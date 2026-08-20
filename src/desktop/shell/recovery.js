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
        return health === 'ok' ? '正常' : '需检查';
    }

    function recoveryGroupName(backup) {
        if (backup.projectName) return backup.projectName;
        const folder = String(backup.projectId || '').trim() || String(backup.path || '').split(/[\\/]/)[0].trim();
        if (!folder) return '未命名项目';
        const named = recoveryState.backups.find((item) => item.projectId === folder && item.projectName);
        return (named && named.projectName) || folder;
    }

    function setRecoveryFilter(filter) {
        recoveryState.filter = filter || 'all';
        const { filter: filterSelect } = recoveryElements();
        if (filterSelect) filterSelect.value = recoveryState.filter;
        const chips = document.querySelector('[data-recovery-filter-chips]');
        if (chips) {
            chips.querySelectorAll('[data-recovery-filter-chip]').forEach((chip) => {
                const active = (chip.dataset.recoveryFilterChip || 'all') === recoveryState.filter;
                chip.classList.toggle('is-active', active);
                chip.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }
        renderRecoveryList();
    }

    function renderRecoveryList() {
        const elements = recoveryElements();
        const backups = filteredRecoveryBackups();
        if (elements.status) {
            const invalidCount = recoveryState.backups.filter((backup) => backup.health !== 'ok').length;
            elements.status.textContent = `${backups.length} / ${recoveryState.backups.length} 个备份${invalidCount ? ` · ${invalidCount} 个异常` : ' · 全部正常'}`;
        }
        if (elements.location) {
            elements.location.textContent = '本地备份目录';
            elements.location.title = recoveryState.backupLocation || '默认书库备份目录';
        }
        if (elements.search && elements.search.value !== (recoveryState.query || '')) {
            elements.search.value = recoveryState.query || '';
        }
        if (!elements.list) return;
        elements.list.replaceChildren();
        if (!backups.length) {
            const empty = document.createElement('div');
            empty.className = 'desktop-recovery-empty';
            if (recoveryState.backups.length === 0) {
                const location = recoveryState.backupLocation || '默认书库备份目录';
                empty.innerHTML = `<strong>还没有本地备份</strong><span>从书库为作品创建第一个备份。<br>备份位置：${location}</span>`;
            } else {
                empty.innerHTML = '<strong>没有匹配的备份</strong><span>试试换个关键词或筛选。</span>';
            }
            elements.list.appendChild(empty);
            return;
        }
        let lastGroup = '';
        backups
            .sort((a, b) => {
                const groupCompare = recoveryGroupName(a).localeCompare(recoveryGroupName(b), 'zh-CN');
                if (groupCompare) return groupCompare;
                const healthCompare = Number(b.health === 'ok') - Number(a.health === 'ok');
                if (healthCompare) return healthCompare;
                return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
            })
            .forEach((backup) => {
            const group = recoveryGroupName(backup);
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
            item.classList.toggle('is-invalid', backup.health !== 'ok');
            const created = backup.timestamp ? formatDate(backup.timestamp) : '未知时间';
            const pin = backup.pinned ? ' · 已固定' : '';
            const title = document.createElement('strong');
            title.textContent = backup.health === 'ok'
                ? `${recoveryReasonLabel(backup.reason)} · ${created}`
                : `无法读取 · ${created}`;
            const meta = document.createElement('span');
            meta.textContent = `${backup.sceneCount || 0} 场 · ${formatNumber(backup.wordCount || 0)} 字 · ${recoveryHealthLabel(backup.health)}${pin}`;
            item.title = backup.id || '';
            item.append(title, meta);
            if (backup.note) {
                const note = document.createElement('span');
                note.className = 'desktop-recovery-item-note';
                note.textContent = backup.note;
                item.append(note);
            }
            item.addEventListener('click', () => selectRecoveryBackup(backup));
            elements.list.appendChild(item);
        });
    }

    function firstBackupPreviewText(backup) {
        const entries = Object.entries(backup.sceneContents || {});
        if (!entries.length) return '这个备份没有正文内容。';
        const [sceneId, text] = entries[0];
        const scene = (backup.scenes || []).find((item) => item.id === sceneId);
        const heading = scene && scene.title ? scene.title : sceneId;
        const body = String(text || '').trim();
        if (!body) return heading;
        if (body.startsWith(heading)) return body.slice(0, 2400);
        return `${heading}\n\n${body}`.slice(0, 2400);
    }

    function firstBackupSceneId(backup) {
        return Object.keys((backup && backup.sceneContents) || {})[0] || '';
    }

    function renderRecoveryPreview() {
        const elements = recoveryElements();
        const summary = recoveryState.selected;
        const backup = recoveryState.selectedBackup;
        const diff = recoveryState.selectedDiff;
        if (elements.previewText && elements.previewText.closest('[data-recovery-preview]')) {
            elements.previewText.closest('[data-recovery-preview]').classList.toggle('is-empty', !summary || !backup);
        }
        if (!summary || !backup) {
            if (elements.previewTitle) elements.previewTitle.textContent = summary ? (summary.projectName || summary.projectId || '正在读取备份') : '选择一个备份';
            if (elements.previewMeta) {
                elements.previewMeta.textContent = summary
                    ? '正在读取备份正文与差异...'
                    : recoveryState.backups.length
                    ? '从左侧选一条备份，先看正文再决定怎么恢复。'
                    : '还没有本地备份。从书库为作品创建第一个。';
            }
            if (elements.previewHealth) {
                elements.previewHealth.textContent = summary ? recoveryHealthLabel(summary.health) : '等待选择';
                elements.previewHealth.dataset.tone = summary && summary.health === 'ok' ? 'ok' : 'info';
            }
            if (elements.diff) elements.diff.replaceChildren();
            if (elements.previewText) {
                elements.previewText.textContent = summary
                    ? ''
                    : recoveryState.backups.length
                    ? '从左侧选一条备份，先看正文再决定怎么恢复。'
                    : '还没有本地备份。从书库为作品创建第一个。';
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
                setRecoveryFilter(elements.filter.value || 'all');
            });
        }
        const filterChips = document.querySelector('[data-recovery-filter-chips]');
        if (filterChips) {
            filterChips.addEventListener('click', (event) => {
                const chip = event.target.closest('[data-recovery-filter-chip]');
                if (!chip) return;
                setRecoveryFilter(chip.dataset.recoveryFilterChip || 'all');
            });
        }
        if (elements.restoreScene) elements.restoreScene.addEventListener('click', restoreSelectedBackupScene);
        if (elements.restoreNew) elements.restoreNew.addEventListener('click', () => restoreSelectedBackup('new-project'));
        if (elements.restoreReplace) elements.restoreReplace.addEventListener('click', () => restoreSelectedBackup('replace'));
    }
