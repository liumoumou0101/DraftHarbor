    window.cleanChapterTitleForTransfer = function cleanChapterTitleForTransfer(fallbackTitle, sceneTitle) {
        const title = String(fallbackTitle || sceneTitle || '正文').trim();
        if (/^第\s*\d+\s*批/.test(title)) return String(sceneTitle || '第 1 章').trim() || '第 1 章';
        return title || '正文';
    };

    window.transferGuidedCompendiumSuggestions = async function transferGuidedCompendiumSuggestions() {
        const projectId = currentProjectId();
        const run = selectedWorkflowRun();
        const sourceArtifact = window.isCreationWorkflow(run)
            ? (run.artifacts || []).find((artifact) => artifact.nodeId === 'compendium' && artifact.revision.reviewState === 'approved')
            : (run.artifacts || []).find((artifact) => artifact.nodeId === 'analysis' && artifact.revision.reviewState === 'approved');
        const drafts = window.isCreationWorkflow(run)
            ? sourceArtifact && sourceArtifact.content && sourceArtifact.content.entries
            : sourceArtifact && sourceArtifact.content && sourceArtifact.content.characterCandidates;
        const candidates = Array.isArray(drafts)
            ? drafts.map((draft, index) => ({ id: `guided-card-${index + 1}`, draft, source: { runId: run.id, artifactId: sourceArtifact.id, revisionId: sourceArtifact.revision.id } }))
            : [];
        if (!candidates.length) throw new Error(window.isCreationWorkflow(run) ? '人物与世界观阶段没有提供资料卡草稿' : '原文分析没有提供资料卡候选');
        const previewResponse = await fetch('/api/workflows/v2/preview-compendium-suggestions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, runId: run.id, candidates })
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || `HTTP ${previewResponse.status}`);
        if (!window.confirm(`发现 ${preview.suggestions.length} 条资料建议。确认后才会写入资料库，是否全部应用？`)) return;
        const response = await fetch('/api/workflows/v2/apply-compendium-suggestions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, runId: run.id, applicationId: `guided-compendium-${Date.now()}`, candidates, confirmedSuggestionIds: preview.suggestions.map((suggestion) => suggestion.id) })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        await loadCompendium();
        setWorkflowStatus('已确认的资料建议已写入资料库。', 'ok');
    };
