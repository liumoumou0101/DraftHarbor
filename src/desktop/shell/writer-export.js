    window.projectExportName = function projectExportName(extension) {
        const project = nativeEditorState.snapshot && nativeEditorState.snapshot.project;
        const base = String(project && project.name ? project.name : 'DraftHarbor Project')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'DraftHarbor Project';
        return `${base}.${extension}`;
    };

    window.buildNativeExport = function buildNativeExport(format) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot) return '';
        flushNativeEditorFields();
        window.normalizeNativeOrders();
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
    };

    window.downloadNativeExport = async function downloadNativeExport(format) {
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
    };
