    function bindReader() {
        loadReaderState();
        renderReader();
        const elements = readerElements();
        migrateLegacyReaderState();
        if (typeof initializeReaderWorkspace === 'function') initializeReaderWorkspace();

        if (elements.migrationConfirm) {
            elements.migrationConfirm.addEventListener('click', () => migrateLegacyReaderState('confirm'));
        }
        if (elements.migrationAbandon) {
            elements.migrationAbandon.addEventListener('click', () => migrateLegacyReaderState('abandon'));
        }

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
                if (typeof scheduleReaderPreferenceSave === 'function') scheduleReaderPreferenceSave();
            });
        }

        if (elements.textWidth) {
            elements.textWidth.addEventListener('input', () => {
                readerState.textWidth = Number(elements.textWidth.value) || 760;
                applyReaderSettings();
                saveReaderState();
                if (typeof scheduleReaderPreferenceSave === 'function') scheduleReaderPreferenceSave();
            });
        }

        if (elements.paragraphSpacing) {
            elements.paragraphSpacing.addEventListener('input', () => {
                readerState.paragraphSpacing = Number(elements.paragraphSpacing.value) || 1.05;
                applyReaderSettings();
                saveReaderState();
                if (typeof scheduleReaderPreferenceSave === 'function') scheduleReaderPreferenceSave();
            });
        }

        if (elements.fontFamily) {
            elements.fontFamily.addEventListener('change', () => {
                readerState.fontFamily = elements.fontFamily.value || 'system';
                applyReaderSettings();
                saveReaderState();
                if (typeof scheduleReaderPreferenceSave === 'function') scheduleReaderPreferenceSave();
            });
        }

        if (elements.indent) {
            elements.indent.addEventListener('change', () => {
                readerState.indent = !!elements.indent.checked;
                applyReaderSettings();
                saveReaderState();
                if (typeof scheduleReaderPreferenceSave === 'function') scheduleReaderPreferenceSave();
            });
        }

        if (elements.lineHeight) {
            elements.lineHeight.addEventListener('input', () => {
                readerState.lineHeight = Number(elements.lineHeight.value) || 1.8;
                applyReaderSettings();
                saveReaderState();
                if (typeof scheduleReaderPreferenceSave === 'function') scheduleReaderPreferenceSave();
            });
        }

        if (elements.theme) {
            elements.theme.addEventListener('change', () => {
                readerState.theme = elements.theme.value || 'dark';
                applyReaderSettings();
                saveReaderState();
                if (typeof scheduleReaderPreferenceSave === 'function') scheduleReaderPreferenceSave();
            });
        }

        if (elements.prev) {
            elements.prev.addEventListener('click', () => {
                if (readerState.apiMode && typeof navigateReaderWorkspaceChapter === 'function') {
                    navigateReaderWorkspaceChapter(-1);
                    return;
                }
                rememberReaderScroll();
                readerState.chapterIndex -= 1;
                saveReaderState();
                renderReader();
            });
        }

        if (elements.next) {
            elements.next.addEventListener('click', () => {
                if (readerState.apiMode && typeof navigateReaderWorkspaceChapter === 'function') {
                    navigateReaderWorkspaceChapter(1);
                    return;
                }
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

            if (event.key === 'Escape' && typeof handleReaderWorkspaceEscape === 'function') {
                event.preventDefault();
                handleReaderWorkspaceEscape();
                return;
            }
            if (event.key === '[' && elements.prev && !elements.prev.disabled) {
                event.preventDefault();
                elements.prev.click();
                return;
            }
            if (event.key === ']' && elements.next && !elements.next.disabled) {
                event.preventDefault();
                elements.next.click();
                return;
            }

            if (readerState.apiMode && readerState.effectiveLayoutMode !== 'flow') {
                if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
                    event.preventDefault();
                    if (typeof queueReaderPageTurn === 'function') queueReaderPageTurn(-1);
                    return;
                }
                if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
                    event.preventDefault();
                    if (typeof queueReaderPageTurn === 'function') queueReaderPageTurn(1);
                    return;
                }
            }

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
        if (window.draftHarborDesktop && typeof window.draftHarborDesktop.toggleFullscreen === 'function') {
            await window.draftHarborDesktop.toggleFullscreen();
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
