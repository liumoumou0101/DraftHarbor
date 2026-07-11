(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborWorkflowSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const WORKFLOW_STATUSES = Object.freeze([
        'pending',
        'running',
        'waiting_user',
        'completed',
        'failed',
        'cancelled'
    ]);

    const STEP_STATUSES = Object.freeze([
        'pending',
        'ready',
        'running',
        'waiting_user',
        'completed',
        'failed',
        'skipped',
        'cancelled'
    ]);

    const ARTIFACT_TYPES = Object.freeze([
        'project_brief',
        'chapter_outline',
        'scene_plan',
        'draft_text',
        'prompt',
        'generation_result',
        'note'
    ]);

    const EVENT_TYPES = Object.freeze([
        'run_created',
        'snapshot_created',
        'step_started',
        'step_waiting_user',
        'step_completed',
        'step_failed',
        'artifact_created',
        'user_approved',
        'user_rejected',
        'artifact_applied',
        'run_completed',
        'run_cancelled'
    ]);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function createWorkflowArtifact(input = {}) {
        const now = new Date().toISOString();
        return {
            id: cleanString(input.id, `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            type: ARTIFACT_TYPES.includes(input.type) ? input.type : 'note',
            title: cleanString(input.title, 'Workflow artifact'),
            stepId: cleanString(input.stepId),
            sceneId: cleanString(input.sceneId),
            chapterId: cleanString(input.chapterId),
            content: input.content === undefined ? '' : String(input.content || ''),
            data: input.data && typeof input.data === 'object' ? input.data : {},
            createdAt: input.createdAt || now,
            updatedAt: input.updatedAt || input.createdAt || now
        };
    }

    function createWorkflowStep(input = {}) {
        return {
            id: cleanString(input.id, `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            title: cleanString(input.title, 'Workflow step'),
            kind: cleanString(input.kind, 'manual'),
            status: STEP_STATUSES.includes(input.status) ? input.status : 'pending',
            requiresUserApproval: input.requiresUserApproval !== false,
            promptTemplateId: cleanString(input.promptTemplateId),
            inputArtifactIds: Array.isArray(input.inputArtifactIds) ? input.inputArtifactIds.map((id) => cleanString(id)).filter(Boolean) : [],
            outputArtifactTypes: Array.isArray(input.outputArtifactTypes) ? input.outputArtifactTypes.filter((type) => ARTIFACT_TYPES.includes(type)) : [],
            createdAt: input.createdAt || '',
            updatedAt: input.updatedAt || ''
        };
    }

    function createWorkflowTemplate(input = {}) {
        const steps = Array.isArray(input.steps) ? input.steps.map(createWorkflowStep) : [];
        return {
            id: cleanString(input.id, 'novel-drafting-placeholder'),
            title: cleanString(input.title, 'Novel drafting placeholder'),
            description: cleanString(input.description),
            version: cleanString(input.version, '0.1-placeholder'),
            automationLevel: cleanString(input.automationLevel, 'semi_automatic'),
            steps,
            createdAt: input.createdAt || '',
            updatedAt: input.updatedAt || ''
        };
    }

    function createWorkflowEvent(input = {}) {
        return {
            id: cleanString(input.id, `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            runId: cleanString(input.runId),
            type: EVENT_TYPES.includes(input.type) ? input.type : 'step_started',
            stepId: cleanString(input.stepId),
            artifactId: cleanString(input.artifactId),
            payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
            createdAt: input.createdAt || new Date().toISOString()
        };
    }

    function createNovelDraftingPlaceholderTemplate(input = {}) {
        return createWorkflowTemplate({
            id: input.id || 'novel-drafting-placeholder',
            title: input.title || '半自动小说工作流占位',
            description: input.description || '项目设定 -> 章节大纲 -> 场景草稿 -> 人工确认。这里只定义边界，不实现复杂自动化。',
            version: input.version || '0.1-placeholder',
            automationLevel: 'semi_automatic',
            steps: [
                {
                    id: 'project-brief',
                    title: '项目设定',
                    kind: 'manual',
                    status: 'pending',
                    requiresUserApproval: true,
                    outputArtifactTypes: ['project_brief']
                },
                {
                    id: 'chapter-outline',
                    title: '章节大纲',
                    kind: 'generation',
                    status: 'pending',
                    requiresUserApproval: true,
                    inputArtifactIds: ['project-brief'],
                    outputArtifactTypes: ['chapter_outline', 'prompt', 'generation_result']
                },
                {
                    id: 'scene-draft',
                    title: '场景草稿',
                    kind: 'generation',
                    status: 'pending',
                    requiresUserApproval: true,
                    inputArtifactIds: ['chapter-outline'],
                    outputArtifactTypes: ['scene_plan', 'draft_text', 'prompt', 'generation_result']
                },
                {
                    id: 'user-confirmation',
                    title: '人工确认',
                    kind: 'manual',
                    status: 'pending',
                    requiresUserApproval: true,
                    inputArtifactIds: ['scene-draft'],
                    outputArtifactTypes: ['note']
                }
            ],
            ...input
        });
    }

    function createPlaceholderWorkflowRun(input = {}) {
        const now = new Date().toISOString();
        return {
            id: input.id || `workflow-${Date.now()}`,
            projectId: input.projectId || '',
            templateId: input.templateId || 'placeholder',
            title: input.title || 'Workflow placeholder',
            status: WORKFLOW_STATUSES.includes(input.status) ? input.status : 'pending',
            activeStepId: cleanString(input.activeStepId),
            preRunSnapshot: input.preRunSnapshot || null,
            steps: Array.isArray(input.steps) ? input.steps.map(createWorkflowStep) : [],
            artifacts: Array.isArray(input.artifacts) ? input.artifacts.map(createWorkflowArtifact) : [],
            createdAt: input.createdAt || now,
            updatedAt: input.updatedAt || now
        };
    }

    return {
        WORKFLOW_STATUSES,
        STEP_STATUSES,
        ARTIFACT_TYPES,
        EVENT_TYPES,
        createWorkflowTemplate,
        createWorkflowStep,
        createWorkflowArtifact,
        createWorkflowEvent,
        createNovelDraftingPlaceholderTemplate,
        createPlaceholderWorkflowRun
    };
});
