    function workflowGenerationLaunchConfig() {
        const settings = normalizeDesktopSettings(settingsState.settings || {});
        const configured = (settings.workflowGeneration || {}).providerProfileId || 'inherit';
        const profileId = configured === 'inherit' ? '' : configured;
        const config = runtimeProviderConfig(profileId ? { profileId } : {});
        const profile = profileId ? (settings.providerProfiles || []).find((item) => item.id === profileId) : null;
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
                enableThinking: !!workflowElements().thinking?.checked,
                useProviderDefaults: !!config.useProviderDefaults
            }
        };
    }

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
            ? !!workflowElements().thinking?.checked
            : !!snapshot.enableThinking;
        const minimums = { analysis: 4000, direction: 3000, blueprint: 5000, compendium: 5000, plan: 4000, draft: 6000, rewrite: 6000, repair: 6000, review: 3000 };
        const minimum = minimums[nodeId] || 3000;
        return {
            ...config,
            mode: snapshot.mode || config.mode,
            provider: snapshot.provider || config.provider,
            endpoint: snapshot.endpoint || config.endpoint,
            baseUrl: snapshot.baseUrl || config.baseUrl,
            organization: snapshot.organization || config.organization,
            model: snapshot.model || config.model,
            temperature: snapshot.temperature === undefined ? config.temperature : snapshot.temperature,
            enableThinking: thinking,
            firstResponseTimeoutMs: 90000,
            idleTimeoutMs: 120000,
            useProviderDefaults: false,
            maxTokens: Math.max(Number(snapshot.maxTokens === undefined ? config.maxTokens : snapshot.maxTokens) || 0, minimum)
        };
    }
