(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./workflow-schema'), require('../context/context-resolver'));
    } else {
        root.DraftHarborWorkflowEngine = factory(root.DraftHarborWorkflowSchema, root.DraftHarborContextResolver);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WorkflowSchema, ContextResolver) {
    const STEP_ORDER = ['project-brief', 'chapter-outline', 'scene-draft', 'user-confirmation'];

    function nowIso() {
        return new Date().toISOString();
    }

    function text(value) {
        return String(value || '').trim();
    }

    function artifactId(stepId, type) {
        return `${stepId}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function sortedArtifacts(run, type) {
        return (run.artifacts || [])
            .filter((artifact) => !type || artifact.type === type)
            .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    }

    function latestArtifact(run, type) {
        const matches = sortedArtifacts(run, type);
        return matches[matches.length - 1] || null;
    }

    function setStepStatus(run, stepId, status) {
        const step = (run.steps || []).find((item) => item.id === stepId);
        if (!step) return null;
        step.status = status;
        step.updatedAt = nowIso();
        return step;
    }

    function createNovelWorkflowRun(input = {}) {
        const template = WorkflowSchema.createNovelDraftingPlaceholderTemplate();
        const now = nowIso();
        const brief = text(input.brief || input.projectBrief || '');
        const steps = template.steps.map((step) => ({
            ...step,
            status: step.id === 'project-brief'
                ? 'completed'
                : (step.id === 'chapter-outline' ? 'ready' : 'pending'),
            createdAt: now,
            updatedAt: now
        }));
        const artifacts = brief
            ? [WorkflowSchema.createWorkflowArtifact({
                id: artifactId('project-brief', 'project_brief'),
                type: 'project_brief',
                title: '项目设定',
                stepId: 'project-brief',
                content: brief,
                createdAt: now,
                updatedAt: now
            })]
            : [];

        return WorkflowSchema.createPlaceholderWorkflowRun({
            id: input.id || `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            projectId: input.projectId || '',
            templateId: template.id,
            title: input.title || '半自动小说工作流',
            status: 'waiting_user',
            activeStepId: 'chapter-outline',
            preRunSnapshot: input.preRunSnapshot || null,
            steps,
            artifacts,
            createdAt: now,
            updatedAt: now
        });
    }

    function projectSummary(project) {
        const chapters = Array.isArray(project && project.chapters) ? project.chapters : [];
        const scenes = Array.isArray(project && project.scenes) ? project.scenes : [];
        return [
            `作品：${text(project && (project.title || project.name)) || '未命名作品'}`,
            project && project.description ? `简介：${project.description}` : '',
            `当前结构：${chapters.length} 章 / ${scenes.length} 场`,
            ...chapters.slice(0, 8).map((chapter, index) => `${index + 1}. ${chapter.title || `第 ${index + 1} 章`}`)
        ].filter(Boolean).join('\n');
    }

    function resolveContext(project, options = {}) {
        if (!ContextResolver || typeof ContextResolver.resolveContext !== 'function') return null;
        return ContextResolver.resolveContext({
            project,
            sceneId: options.sceneId || project.currentSceneId || '',
            selection: {
                includeAlways: true,
                includePreviousScenes: true,
                maxCharacters: 5000
            }
        });
    }

    function contextText(context) {
        if (!context) return '';
        const parts = [];
        if (Array.isArray(context.compendiumEntries) && context.compendiumEntries.length) {
            parts.push('资料库：');
            context.compendiumEntries.slice(0, 12).forEach((entry) => {
                const detail = [entry.summary, entry.content || entry.body].filter(Boolean).join(' / ');
                parts.push(`- ${entry.title}: ${detail}`);
            });
        }
        if (Array.isArray(context.sceneSummaries) && context.sceneSummaries.length) {
            parts.push('场景摘要：');
            context.sceneSummaries.slice(0, 8).forEach((scene) => {
                parts.push(`- ${scene.title}: ${scene.summary || scene.excerpt || ''}`);
            });
        }
        return parts.join('\n').trim();
    }

    function buildStepPrompt(run, project, stepId) {
        const brief = latestArtifact(run, 'project_brief');
        const outline = latestArtifact(run, 'chapter_outline');
        const context = contextText(resolveContext(project));
        const base = [
            projectSummary(project),
            brief ? `\n项目设定：\n${brief.content}` : '',
            outline ? `\n已确认章节大纲：\n${outline.content}` : '',
            context ? `\n可用上下文：\n${context}` : ''
        ].filter(Boolean).join('\n');

        if (stepId === 'chapter-outline') {
            const user = `${base}\n\n请生成一个可人工确认的章节大纲。要求：\n1. 只输出结构化大纲，不写正文。\n2. 每章包含目标、冲突、转折和钩子。\n3. 保持可修改，不要假装这是最终稿。`;
            return {
                stepId,
                messages: [
                    { role: 'system', content: '你是小说策划助手。你的任务是提出可审阅、可修改的阶段性产物。' },
                    { role: 'user', content: user }
                ],
                asString: () => user
            };
        }

        if (stepId === 'scene-draft') {
            const user = `${base}\n\n请根据已确认大纲生成一个场景草稿。要求：\n1. 只写一个场景，不要扩展成整章。\n2. 保留明确的冲突、动作和结尾推进。\n3. 输出可直接写入正文的草稿。`;
            return {
                stepId,
                messages: [
                    { role: 'system', content: '你是小说草稿助手。你的输出必须可由作者人工确认后写入项目。' },
                    { role: 'user', content: user }
                ],
                asString: () => user
            };
        }

        return {
            stepId,
            messages: [
                { role: 'system', content: '你是半自动小说工作流助手。' },
                { role: 'user', content: base || '请等待用户确认。' }
            ],
            asString: () => base || ''
        };
    }

    function completeGenerationStep(runInput, stepId, generatedText, prompt) {
        const run = WorkflowSchema.createPlaceholderWorkflowRun(runInput);
        const now = nowIso();
        const outputType = stepId === 'chapter-outline' ? 'chapter_outline' : 'draft_text';
        const title = stepId === 'chapter-outline' ? '章节大纲' : '场景草稿';
        const promptText = prompt && typeof prompt.asString === 'function'
            ? prompt.asString()
            : text(prompt && prompt.promptText);

        run.artifacts = [
            ...(run.artifacts || []),
            WorkflowSchema.createWorkflowArtifact({
                id: artifactId(stepId, 'prompt'),
                type: 'prompt',
                title: `${title} Prompt`,
                stepId,
                content: promptText,
                data: { messages: prompt && prompt.messages ? prompt.messages : [] },
                createdAt: now,
                updatedAt: now
            }),
            WorkflowSchema.createWorkflowArtifact({
                id: artifactId(stepId, 'generation_result'),
                type: 'generation_result',
                title: `${title}生成结果`,
                stepId,
                content: text(generatedText),
                createdAt: now,
                updatedAt: now
            }),
            WorkflowSchema.createWorkflowArtifact({
                id: artifactId(stepId, outputType),
                type: outputType,
                title,
                stepId,
                content: text(generatedText),
                createdAt: now,
                updatedAt: now
            })
        ];
        setStepStatus(run, stepId, 'waiting_user');
        run.activeStepId = stepId;
        run.status = 'waiting_user';
        run.updatedAt = now;
        return run;
    }

    function approveStep(runInput, stepId) {
        const run = WorkflowSchema.createPlaceholderWorkflowRun(runInput);
        const now = nowIso();
        setStepStatus(run, stepId, 'completed');
        const next = STEP_ORDER[STEP_ORDER.indexOf(stepId) + 1] || '';
        if (next) {
            setStepStatus(run, next, 'ready');
            run.activeStepId = next;
            run.status = 'waiting_user';
        } else {
            run.activeStepId = '';
            run.status = 'completed';
        }
        run.updatedAt = now;
        return run;
    }

    function rejectStep(runInput, stepId, reason = '') {
        const run = WorkflowSchema.createPlaceholderWorkflowRun(runInput);
        const now = nowIso();
        setStepStatus(run, stepId, 'ready');
        run.activeStepId = stepId;
        run.status = 'waiting_user';
        run.artifacts = [
            ...(run.artifacts || []),
            WorkflowSchema.createWorkflowArtifact({
                id: artifactId(stepId, 'note'),
                type: 'note',
                title: '用户退回',
                stepId,
                content: reason || '用户退回此步骤，等待重新生成或修改。',
                createdAt: now,
                updatedAt: now
            })
        ];
        run.updatedAt = now;
        return run;
    }

    function draftArtifact(runInput, artifactId = '') {
        const artifacts = (runInput && runInput.artifacts) || [];
        if (artifactId) {
            const match = artifacts.find((artifact) => artifact.id === artifactId && artifact.type === 'draft_text');
            if (match) return match;
        }
        return latestArtifact(runInput, 'draft_text');
    }

    function applyDraftArtifact(projectInput, runInput, artifactId = '') {
        const draft = draftArtifact(runInput, artifactId);
        if (!draft || !text(draft.content)) {
            return { project: projectInput, applied: false, sceneId: '', artifactId: '' };
        }
        const project = JSON.parse(JSON.stringify(projectInput || {}));
        const now = nowIso();
        project.scenes = Array.isArray(project.scenes) ? project.scenes : [];
        project.chapters = Array.isArray(project.chapters) ? project.chapters : [];
        if (project.chapters.length === 0) {
            project.chapters.push({ id: 'chapter-1', title: 'Chapter 1', order: 0, createdAt: now, updatedAt: now });
        }
        const chapterId = draft.chapterId || project.currentChapterId || (project.scenes[0] && project.scenes[0].chapterId) || project.chapters[0].id;
        let scene = project.scenes.find((item) => item.id === draft.sceneId);
        if (!scene) {
            scene = project.scenes.find((item) => item.id === project.currentSceneId) || null;
        }
        if (!scene) {
            scene = {
                id: `workflow-scene-${Date.now()}`,
                chapterId,
                title: '工作流草稿',
                summary: '',
                content: '',
                order: project.scenes.filter((item) => item.chapterId === chapterId).length,
                tags: ['workflow'],
                createdAt: now,
                updatedAt: now
            };
            project.scenes.push(scene);
        }
        scene.content = scene.content ? `${scene.content.trim()}\n\n${draft.content}` : draft.content;
        scene.updatedAt = now;
        project.currentSceneId = scene.id;
        project.updatedAt = now;
        return { project, applied: true, sceneId: scene.id, artifactId: draft.id };
    }

    function applyApprovedDraft(projectInput, runInput) {
        return applyDraftArtifact(projectInput, runInput);
    }

    function cancelRun(runInput, reason = '') {
        const run = WorkflowSchema.createPlaceholderWorkflowRun(runInput);
        const now = nowIso();
        run.steps = (run.steps || []).map((step) => {
            if (['completed', 'skipped', 'cancelled'].includes(step.status)) return step;
            return { ...step, status: 'cancelled', updatedAt: now };
        });
        run.status = 'cancelled';
        run.activeStepId = '';
        run.updatedAt = now;
        run.artifacts = [
            ...(run.artifacts || []),
            WorkflowSchema.createWorkflowArtifact({
                id: artifactId('run', 'note'),
                type: 'note',
                title: 'Workflow cancelled',
                stepId: '',
                content: reason || 'Workflow was cancelled by the user.',
                createdAt: now,
                updatedAt: now
            })
        ];
        return run;
    }

    return {
        STEP_ORDER,
        createNovelWorkflowRun,
        buildStepPrompt,
        completeGenerationStep,
        approveStep,
        rejectStep,
        cancelRun,
        applyDraftArtifact,
        applyApprovedDraft,
        latestArtifact
    };
});
