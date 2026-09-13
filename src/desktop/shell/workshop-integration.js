(() => {
    function canRefresh(projectId, snapshot) {
        return nativeEditorState.snapshot === snapshot && snapshot?.project?.id === projectId;
    }

    function hasPendingEdits() {
        return nativeEditorState.dirty || nativeEditorState.isSaving || compendiumState.dirty || nativeEditorState.generation?.inProgress;
    }

    window.refreshWorkshopAgentProject = async (projectId, snapshot, response = {}) => {
        if (!canRefresh(projectId, snapshot)) return false;
        if (hasPendingEdits()) throw new Error('修改已保存，但编辑区有后续输入。请先保留这些输入，再重新打开项目查看结果。');
        let refreshed = response.projectSnapshot;
        if (!refreshed) {
            const result = await fetch(`/api/get-project?${new URLSearchParams({ projectId })}`, { cache: 'no-store' });
            const payload = await result.json().catch(() => ({}));
            if (!result.ok || !payload.ok) throw new Error('修改已保存，暂时无法刷新项目。请重新打开项目查看结果。');
            refreshed = payload.project;
        }
        if (!canRefresh(projectId, snapshot)) return false;
        if (hasPendingEdits()) throw new Error('修改已保存，刷新期间检测到新输入。请先保留这些输入，再重新打开项目。');
        if (!refreshed || refreshed.project?.id !== projectId || !Array.isArray(refreshed.scenes)) throw new Error('修改已保存，返回的项目内容无法确认，请重新打开项目。');

        // Keep the editor/session identity stable while replacing persisted data.
        // The discussion module owns its in-flight message and must not be reset.
        const sessions = workshopState.sessions;
        Object.assign(snapshot, refreshed, { workshopSessions: sessions });
        if (!(snapshot.scenes || []).some(scene => scene.id === nativeEditorState.activeSceneId)) {
            nativeEditorState.activeSceneId = snapshot.scenes[0]?.id || '';
        }
        compendiumState.entries = snapshot.compendium || [];
        if (!compendiumState.entries.some(entry => entry.id === compendiumState.selectedId)) compendiumState.selectedId = compendiumState.entries[0]?.id || '';
        renderNativeEditor();
        renderCompendium();
        await loadReaderFromProjectSnapshot(snapshot);
        await loadProjectLibrary();
        return canRefresh(projectId, snapshot);
    };
})();
