    /* global readerSetNavigationStatus readerNavigationElements readerRevisionSnapshot */

    function readerBookmarkList() {
        return readerState.documentRecordState && Array.isArray(readerState.documentRecordState.bookmarks)
            ? readerState.documentRecordState.bookmarks : [];
    }

    async function persistReaderNavigationState(bookmarks) {
        if (!readerState.activeDocumentId) return null;
        if (typeof queueReaderDocumentStateWrite === 'function') {
            return queueReaderDocumentStateWrite({ bookmarks: Array.isArray(bookmarks) ? bookmarks : readerBookmarkList() });
        }
        const existing = readerState.documentRecordState || {};
        const locator = typeof captureReaderPositionLocator === 'function'
            ? captureReaderPositionLocator() || existing.positionLocator : existing.positionLocator;
        const nextState = {
            documentId: readerState.activeDocumentId,
            positionLocator: locator || null,
            updatedAt: new Date().toISOString(),
            preferenceOverrides: readerState.preferenceOverrides || existing.preferenceOverrides || {},
            bookmarks: Array.isArray(bookmarks) ? bookmarks : readerBookmarkList()
        };
        const payload = await readerApi('/api/reader/state', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: nextState })
        });
        readerState.documentRecordState = payload.state;
        return payload.state;
    }

    function readerBookmarkExcerpt(locator) {
        const chapter = readerState.currentChapter;
        const block = chapter && chapter.blocks.find((item) => item.blockId === locator.blockId);
        if (!block) return '';
        const text = String(block.text || '');
        const offset = Math.max(0, Math.min(text.length, Number(locator.offset) || 0));
        return text.slice(Math.max(0, offset - 36), Math.min(text.length, offset + 84)).trim();
    }

    function readerBookmarkId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return `bookmark-${window.crypto.randomUUID()}`;
        return `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    async function createReaderBookmarkAtCurrentPosition() {
        if (readerState.focusMode) return;
        const locator = typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : null;
        if (!locator) {
            readerSetNavigationStatus('bookmark', '当前位置暂时无法创建书签。');
            return;
        }
        const chapterIndex = readerState.contents.findIndex((item) => item.chapterId === locator.chapterId);
        const bookmark = {
            bookmarkId: readerBookmarkId(),
            title: `${readerState.contents[chapterIndex] && readerState.contents[chapterIndex].title || '阅读位置'} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            excerpt: readerBookmarkExcerpt(locator),
            color: 'yellow', category: '未分类', note: '', locator,
            createdAt: new Date().toISOString(), lastVisitedAt: null
        };
        try {
            await persistReaderNavigationState([...readerBookmarkList(), bookmark]);
            readerState.bookmarkResolutions.set(bookmark.bookmarkId, { resolution: 'exact', locator });
            renderReaderBookmarks();
            readerSetNavigationStatus('bookmark', '书签已保存。');
        } catch (error) {
            readerSetNavigationStatus('bookmark', `书签保存失败：${error.message || error}`);
        }
    }

    async function updateReaderBookmark(bookmarkId, changes) {
        if (readerState.focusMode) return;
        const patch = typeof changes === 'string' ? { title: changes } : changes || {};
        const bookmarks = readerBookmarkList().map((bookmark) => bookmark.bookmarkId === bookmarkId
            ? {
                ...bookmark,
                title: String(patch.title || '').trim() || '书签',
                color: patch.color || bookmark.color || 'yellow',
                category: String(patch.category || bookmark.category || '未分类').trim() || '未分类',
                note: String(patch.note || '').trim()
            } : bookmark);
        await persistReaderNavigationState(bookmarks);
        renderReaderBookmarks();
        readerSetNavigationStatus('bookmark', '书签已更新。');
    }

    async function deleteReaderBookmark(bookmarkId) {
        if (readerState.focusMode) return;
        const persistence = persistReaderNavigationState(readerBookmarkList().filter((bookmark) => bookmark.bookmarkId !== bookmarkId));
        readerState.bookmarkResolutions.delete(bookmarkId);
        renderReaderBookmarks();
        try {
            await persistence;
            readerSetNavigationStatus('bookmark', '书签已删除。');
        } catch (error) {
            renderReaderBookmarks();
            readerSetNavigationStatus('bookmark', `书签删除失败：${error.message || error}`);
        }
    }

    function bookmarkResolutionLabel(resolution) {
        const labels = { exact: '精确', approximate: '近似', unresolved: '需确认', pending: '检查中' };
        return labels[resolution] || labels.pending;
    }

    function renderReaderBookmarks() {
        const container = readerNavigationElements().bookmarks;
        if (!container) return;
        container.replaceChildren();
        const bookmarks = readerBookmarkList();
        if (!bookmarks.length) {
            const empty = document.createElement('p');
            empty.className = 'desktop-reader-hint';
            empty.textContent = '还没有书签。';
            container.appendChild(empty);
            return;
        }
        [...bookmarks].sort((left, right) => new Date(right.lastVisitedAt || right.createdAt).getTime() - new Date(left.lastVisitedAt || left.createdAt).getTime()).forEach((bookmark) => {
            const resolution = readerState.bookmarkResolutions.get(bookmark.bookmarkId) || {
                resolution: bookmark.locator.revisionId === readerState.activeRevisionId ? 'exact' : 'pending', locator: bookmark.locator
            };
            const card = document.createElement('article');
            card.className = 'desktop-reader-bookmark';
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'desktop-reader-bookmark-open';
            open.dataset.readerBookmarkColor = bookmark.color || 'yellow';
            const heading = document.createElement('strong');
            heading.textContent = bookmark.title;
            const excerpt = document.createElement('span');
            excerpt.textContent = bookmark.excerpt || '无摘要';
            const accuracy = document.createElement('small');
            accuracy.dataset.readerBookmarkAccuracy = resolution.resolution;
            accuracy.textContent = `恢复：${bookmarkResolutionLabel(resolution.resolution)}`;
            const meta = document.createElement('small');
            meta.className = 'desktop-reader-bookmark-meta';
            meta.textContent = `${bookmark.category || '未分类'}${bookmark.lastVisitedAt ? ` · 最近访问 ${new Date(bookmark.lastVisitedAt).toLocaleString()}` : ''}`;
            open.append(heading, excerpt, meta, accuracy);
            open.addEventListener('click', async () => {
                const visitedAt = new Date().toISOString();
                await persistReaderNavigationState(readerBookmarkList().map((item) => item.bookmarkId === bookmark.bookmarkId
                    ? { ...item, lastVisitedAt: visitedAt } : item)).catch(() => null);
                await navigateReaderToLocator(resolution.locator || bookmark.locator, { highlight: true, historySource: 'bookmark', historyLabel: bookmark.title });
                setReaderDrawer('');
            });
            const controls = document.createElement('div');
            controls.className = 'desktop-reader-bookmark-controls';
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = bookmark.title;
            titleInput.setAttribute('aria-label', `编辑书签：${bookmark.title}`);
            const color = document.createElement('select');
            color.setAttribute('aria-label', `书签颜色：${bookmark.title}`);
            ['yellow', 'blue', 'green', 'pink', 'gray'].forEach((value) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = { yellow: '黄色', blue: '蓝色', green: '绿色', pink: '粉色', gray: '灰色' }[value];
                option.selected = (bookmark.color || 'yellow') === value;
                color.appendChild(option);
            });
            const category = document.createElement('select');
            ['未分类', '重要', '待查', '灵感', bookmark.category || '未分类'].filter((value, index, values) => values.indexOf(value) === index).forEach((value) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                option.selected = (bookmark.category || '未分类') === value;
                category.appendChild(option);
            });
            category.setAttribute('aria-label', `书签分类：${bookmark.title}`);
            const note = document.createElement('textarea');
            note.value = bookmark.note || '';
            note.placeholder = '备注（可选）';
            note.setAttribute('aria-label', `书签备注：${bookmark.title}`);
            const save = document.createElement('button');
            save.type = 'button';
            save.className = 'desktop-secondary-action';
            save.textContent = '保存书签';
            save.addEventListener('click', () => updateReaderBookmark(bookmark.bookmarkId, {
                title: titleInput.value, color: color.value, category: category.value, note: note.value
            }));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'desktop-reader-tool';
            remove.textContent = '删除';
            remove.addEventListener('click', () => deleteReaderBookmark(bookmark.bookmarkId));
            controls.append(titleInput, color, category, note, save, remove);
            card.append(open, controls);
            container.appendChild(card);
        });
    }

    async function refreshReaderBookmarkResolutions() {
        const bookmarks = readerBookmarkList();
        readerState.bookmarkResolutions.clear();
        bookmarks.forEach((bookmark) => readerState.bookmarkResolutions.set(bookmark.bookmarkId, {
            resolution: bookmark.locator.revisionId === readerState.activeRevisionId ? 'exact' : 'pending', locator: bookmark.locator
        }));
        renderReaderBookmarks();
        if (!bookmarks.some((bookmark) => bookmark.locator.revisionId !== readerState.activeRevisionId)) return;
        try {
            const revision = await readerRevisionSnapshot();
            bookmarks.forEach((bookmark) => {
                const resolved = window.DraftHarborReaderLocator.resolveReaderLocator(bookmark.locator, revision);
                readerState.bookmarkResolutions.set(bookmark.bookmarkId, { resolution: resolved.resolution, locator: resolved.locator });
            });
            renderReaderBookmarks();
        } catch (error) {
            readerSetNavigationStatus('bookmark', `书签精确度检查失败：${error.message || error}`);
        }
    }
