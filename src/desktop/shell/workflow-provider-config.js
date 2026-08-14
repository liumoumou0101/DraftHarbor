    function workflowGenerationLaunchConfig(projectSnapshot) {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const configured = (settings.workflowGeneration || {}).providerProfileId || 'inherit';
        const profileId = configured === 'inherit' ? '' : configured;
        const selectedModel = workflowState.workflowModel || 'inherit';
        const config = runtimeProviderConfig({ ...(profileId ? { profileId } : {}), ...(selectedModel !== 'inherit' ? { model: selectedModel } : {}) });
        const profile = profileId ? (settings.providerProfiles || []).find((item) => item.id === profileId) : null;
        const project = projectSnapshot || (typeof nativeEditorState !== 'undefined' && nativeEditorState.snapshot) || {};
        const directiveSnapshot = window.DraftHarborInstructionStack
            && typeof window.DraftHarborInstructionStack.createDirectiveSnapshot === 'function'
            ? window.DraftHarborInstructionStack.createDirectiveSnapshot({
                directiveStack: settings.directiveStack,
                projectDirectiveStack: project.directiveStack
            })
            : null;
        return {
            providerProfileId: configured,
            snapshot: {
                source: profileId ? 'workflow-profile' : 'default-writing',
                profileId,
                label: profile ? (profile.name || profile.provider) : '默认写作连接',
                mode: config.mode,
                provider: config.provider,
                endpoint: config.endpoint,
                baseUrl: config.baseUrl || '',
                organization: config.organization || '',
                model: config.model || '',
                temperature: config.temperature,
                maxTokens: config.maxTokens,
                globalPrompt: config.globalPrompt || '',
                directivePolicyVersion: directiveSnapshot ? 1 : undefined,
                directiveStack: directiveSnapshot || undefined,
                enableThinking: workflowState.workflowThinking !== false,
                useProviderDefaults: !!config.useProviderDefaults
            }
        };
    }

    window.renderWorkflowModelControl = function renderWorkflowModelControl() {
        const elements = workflowElements();
        const selects = [elements.workflowModel, elements.briefWorkflowModel].filter(Boolean);
        if (!selects.length) return;
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const configured = (settings.workflowGeneration || {}).providerProfileId || 'inherit';
        const profileId = configured === 'inherit' ? '' : configured;
        const config = runtimeProviderConfig(profileId ? { profileId } : {});
        const catalog = modelCatalog();
        const selected = workflowState.workflowModel || 'inherit';
        selects.forEach((select) => {
            select.replaceChildren();
            const inherited = document.createElement('option');
            inherited.value = 'inherit'; inherited.textContent = `使用配置默认模型（${config.model || '未设置'}）`;
            select.appendChild(inherited);
            if (config.mode === 'api' && catalog.isApiCompatibleProvider(config.provider)) {
                const hidePrivacy = !!(settings.modelCatalogPreferences || {}).hidePrivacyRiskModels;
                catalog.getProviderModels(config.provider, {
                    catalog: (config.provider === 'opencode-zen' || config.provider === 'opencode-go')
                        ? ((settingsState.modelCatalogs && settingsState.modelCatalogs[config.provider]) || settingsState.modelCatalog)
                        : null,
                    hidePrivacyRiskModels: hidePrivacy
                }).filter((item) => item.id !== '__custom__').forEach((item) => {
                    const option = document.createElement('option');
                    option.value = item.id;
                    option.textContent = catalog.modelOptionLabel ? catalog.modelOptionLabel(item) : (item.label || item.id);
                    if (catalog.isModelSelectable && !catalog.isModelSelectable(item)) option.disabled = true;
                    select.appendChild(option);
                });
            }
            select.disabled = select.options.length < 2;
            select.value = Array.from(select.options).some((option) => option.value === selected) ? selected : 'inherit';
        });
        if (!selects.some((select) => select.value === selected)) workflowState.workflowModel = 'inherit';
        [elements.thinking, elements.briefThinking].filter(Boolean).forEach((toggle) => {
            toggle.checked = workflowState.workflowThinking !== false;
        });
    };

    function workflowGenerationPolicy(run = selectedWorkflowRun()) {
        return (run && run.settings && run.settings.generationPolicy) || workflowGenerationLaunchConfig();
    }

    function workflowConfigLabel(policy) {
        const snapshot = (policy && policy.snapshot) || {};
        if (snapshot.label || snapshot.model) return `${snapshot.label || '工作流配置'} · ${snapshot.model || '默认模型'}（已冻结）`;
        return policy && policy.providerProfileId && policy.providerProfileId !== 'inherit' ? '工作流专用配置组（旧运行未冻结详情）' : '继承默认写作连接（旧运行未冻结详情）';
    }

    function guidedStageProviderConfig(nodeId, run = selectedWorkflowRun()) {
        const policy = workflowGenerationPolicy(run);
        const snapshot = policy.snapshot || {};
        const profileId = policy.providerProfileId && policy.providerProfileId !== 'inherit' ? policy.providerProfileId : '';
        const config = runtimeProviderConfig(profileId ? { profileId } : {});
        const thinking = snapshot.enableThinking === undefined
            ? workflowState.workflowThinking !== false
            : !!snapshot.enableThinking;
        const minimums = {
            analysis: 12000,
            direction: 8000,
            blueprint: 16000,
            compendium: 16000,
            plan: 16000,
            draft: 12000,
            rewrite: 12000,
            repair: 16000,
            review: 8000
        };
        const minimum = minimums[nodeId] || 3000;
        const taskKind = window.DraftHarborInstructionStack
            && window.DraftHarborInstructionStack.WORKFLOW_NODE_TASK_KIND[nodeId]
            || 'unknown';
        const versionedDirectives = Number(snapshot.directivePolicyVersion) >= 1
            && snapshot.directiveStack && Array.isArray(snapshot.directiveStack.layers);
        return {
            ...config,
            mode: snapshot.mode || config.mode,
            provider: snapshot.provider || config.provider,
            endpoint: snapshot.endpoint || config.endpoint,
            baseUrl: snapshot.baseUrl || config.baseUrl,
            organization: snapshot.organization || config.organization,
            model: snapshot.model || config.model,
            temperature: snapshot.temperature === undefined ? config.temperature : snapshot.temperature,
            globalPrompt: snapshot.globalPrompt === undefined ? config.globalPrompt : snapshot.globalPrompt,
            directiveStackMode: versionedDirectives ? 'scoped' : 'parity',
            frozenDirectiveStack: versionedDirectives ? snapshot.directiveStack : undefined,
            taskKind,
            workflowNodeId: nodeId,
            enableThinking: thinking,
            firstResponseTimeoutMs: 90000,
            idleTimeoutMs: 120000,
            useProviderDefaults: false,
            maxTokens: Math.max(Number(snapshot.maxTokens === undefined ? config.maxTokens : snapshot.maxTokens) || 0, minimum)
        };
    }
