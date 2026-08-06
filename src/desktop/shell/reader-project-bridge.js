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

    function loadLegacyReaderProjectProjection(documentData, options = {}) {
        readerState.apiMode = false;
        readerState.activeDocumentId = '';
        readerState.activeRevisionId = '';
        readerState.documentMetadata = null;
        readerState.contents = [];
        readerState.currentChapter = null;
        const previous = readerState.document;
        const sameProject = previous && previous.source === 'project' && previous.projectId === documentData.projectId;
        readerState.document = documentData;
        readerState.chapterIndex = sameProject ? readerState.chapterIndex : 0;
        saveReaderState();
        renderReader();

        if (options.showReader) setView('reader');
        return true;
    }

    function loadReaderFromProjectSnapshot(snapshot, options = {}) {
        const documentData = snapshotToReaderDocument(snapshot);
        if (!documentData) return false;

        if (options.showReader) setView('reader');
        if (typeof openReaderLibraryDocument === 'function' && readerState.apiMode !== undefined) {
            const projectLoadToken = (Number(readerState.r) || 0) + 1;
            readerState.r = projectLoadToken;
            const projectDocumentId = `project:${documentData.projectId}`;
            return Promise.resolve(openReaderLibraryDocument(projectDocumentId, projectLoadToken)).then((opened) => {
                if (readerState.r !== projectLoadToken) return true;
                if (opened !== false) return true;
                return loadLegacyReaderProjectProjection(documentData, options);
            });
        }
        return loadLegacyReaderProjectProjection(documentData, options);
    }
