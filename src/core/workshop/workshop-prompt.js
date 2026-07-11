(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('../context/context-resolver'));
    } else {
        root.DraftHarborWorkshopPrompt = factory(root.DraftHarborContextResolver);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ContextResolver) {
    const DEFAULT_SYSTEM = 'You are a creative writing assistant helping brainstorm and develop fiction. Be concrete, useful, and concise unless the author asks for depth.';

    function contextBlock(context) {
        const parts = [];
        for (const entry of context.compendiumEntries || []) {
            parts.push(`[${entry.type || entry.category || 'entry'}: ${entry.title}]\n${entry.summary ? `${entry.summary}\n` : ''}${entry.body || ''}`);
        }
        for (const scene of context.sceneSummaries || []) {
            parts.push(`[Scene: ${scene.title}]\n${scene.summary || ''}`);
        }
        if (context.manualText) parts.push(`[Manual Notes]\n${context.manualText}`);
        return parts.filter(Boolean).join('\n\n');
    }

    function historyMessages(session, limit = 20) {
        const messages = Array.isArray(session && session.messages) ? session.messages : [];
        return messages
            .filter((message) => ['user', 'assistant'].includes(message.role) && String(message.content || '').trim())
            .slice(-limit)
            .map((message) => ({ role: message.role, content: message.content }));
    }

    function buildWorkshopPrompt(input = {}) {
        const project = input.project || {};
        const session = input.session || {};
        const message = String(input.message || '');
        const template = input.template || {};
        const context = ContextResolver && typeof ContextResolver.resolveContext === 'function'
            ? ContextResolver.resolveContext({
                project,
                beat: message,
                selection: {
                    currentSceneId: input.currentSceneId || project.currentSceneId,
                    recentSceneLimit: input.recentSceneLimit || 4,
                    maxChars: input.maxChars || 6000,
                    ...(input.selection || {})
                }
            })
            : { compendiumEntries: [], sceneSummaries: [] };
        const messages = [{
            role: 'system',
            content: template.systemContent || template.content || DEFAULT_SYSTEM
        }];
        const block = contextBlock(context);
        if (block) {
            messages.push({
                role: 'system',
                content: `Project context:\n${block}`
            });
        }
        messages.push(...historyMessages(session, input.historyLimit || 20));
        messages.push({ role: 'user', content: message });
        return {
            messages,
            context,
            meta: {
                task: 'workshop-chat',
                sessionId: session.id || '',
                promptTemplateId: template.id || ''
            },
            asString() {
                return messages.map((item) => `${item.role.toUpperCase()}:\n${item.content}`).join('\n\n');
            }
        };
    }

    return {
        DEFAULT_SYSTEM,
        buildWorkshopPrompt,
        contextBlock
    };
});
