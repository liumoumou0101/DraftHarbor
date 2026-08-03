(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DraftHarborInstructionStack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SCHEMA_VERSION = 1;
    const DIRECTIVE_STACK_MODE_PARITY = 'parity';
    const DIRECTIVE_STACK_MODE_SCOPED = 'scoped';
    const MAX_COMPILED_CHARS = 12000;

    const TASK_KINDS = Object.freeze([
        'writer-prose',
        'writer-rewrite',
        'writer-summary',
        'workshop-chat',
        'workflow-brief',
        'workflow-json',
        'workflow-draft',
        'workflow-review',
        'workflow-rewrite',
        'workflow-repair',
        'workflow-analysis',
        'compendium-json',
        'compendium-agent',
        'reader-extract',
        'unknown'
    ]);

    const CREATIVE_TASK_KINDS = Object.freeze([
        'writer-prose',
        'writer-rewrite',
        'workshop-chat',
        'workflow-draft',
        'workflow-rewrite',
        'workflow-repair'
    ]);

    const TASK_KIND_ALIASES = Object.freeze({
        'fiction-prose': 'writer-prose',
        'workshop-chat': 'workshop-chat'
    });

    const SAFE_DOMAIN_ACTION_KIND = Object.freeze({
        'prose:generate': 'writer-prose',
        'prose:rewrite': 'writer-rewrite',
        'prose:regenerate-selection': 'writer-rewrite',
        'summary:summarize': 'writer-summary',
        'style-guard:repair': 'writer-rewrite',
        'compendium:draw': 'compendium-json',
        'compendium:rewrite': 'compendium-json'
    });

    const TARGET_TYPE_TASK_KIND = Object.freeze({
        'compendium-draw': 'compendium-json',
        'compendium-entry': 'compendium-json',
        'scene-selection': 'compendium-json',
        'compendium-agent-analysis': 'compendium-agent',
        'compendium-agent-qa': 'compendium-agent',
        'reader-transfer-chunk': 'reader-extract'
    });

    const WORKFLOW_NODE_TASK_KIND = Object.freeze({
        brief: 'workflow-brief',
        analysis: 'workflow-analysis',
        direction: 'workflow-json',
        blueprint: 'workflow-json',
        compendium: 'workflow-json',
        plan: 'workflow-json',
        draft: 'workflow-draft',
        review: 'workflow-review',
        rewrite: 'workflow-rewrite',
        repair: 'workflow-repair'
    });

    const APP_DEFAULT_CREATIVE = '遵循当前任务使用的语言、叙事视角与既有连续性。除非任务明确要求，不要输出场景编号、批次名、计划字段名等创作过程元信息。';

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function uniqueTaskKinds(values, fallback = CREATIVE_TASK_KINDS) {
        const source = Array.isArray(values) && values.length ? values : fallback;
        return [...new Set(source.map(clean).filter((value) => TASK_KINDS.includes(value)))];
    }

    function normalizeDirectiveLayer(input = {}, defaults = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const defaultScopes = defaults.scopes || CREATIVE_TASK_KINDS;
        return {
            id: clean(source.id || defaults.id || 'directive'),
            title: clean(source.title || defaults.title || ''),
            enabled: source.enabled === undefined ? defaults.enabled !== false : !!source.enabled,
            content: clean(source.content),
            scopes: uniqueTaskKinds(source.scopes, defaultScopes),
            source: clean(source.source || defaults.source || 'user')
        };
    }

    function normalizeDirectiveStackSettings(input = {}, legacyGlobalPrompt = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const legacy = legacyGlobalPrompt && typeof legacyGlobalPrompt === 'object' ? legacyGlobalPrompt : {};
        const hasUserGlobal = source.userGlobal && typeof source.userGlobal === 'object';
        const userGlobal = normalizeDirectiveLayer(hasUserGlobal ? source.userGlobal : {
            enabled: !!legacy.enabled,
            content: clean(legacy.content || legacy.prefix),
            source: clean(legacy.content || legacy.prefix) ? 'migrated_globalPrompt' : 'user'
        }, {
            id: 'user_global',
            title: '用户全局创作指令',
            scopes: CREATIVE_TASK_KINDS,
            enabled: false,
            source: 'user'
        });
        return {
            schemaVersion: SCHEMA_VERSION,
            mode: source.mode === DIRECTIVE_STACK_MODE_PARITY
                ? DIRECTIVE_STACK_MODE_PARITY
                : DIRECTIVE_STACK_MODE_SCOPED,
            userGlobal
        };
    }

    function normalizeProjectDirectiveStack(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const rawLayers = Array.isArray(source.layers) ? source.layers : [];
        return {
            schemaVersion: SCHEMA_VERSION,
            layers: rawLayers.map((layer, index) => normalizeDirectiveLayer(layer, {
                id: `project_${index + 1}`,
                title: '项目指令',
                scopes: CREATIVE_TASK_KINDS,
                source: 'project'
            })).filter((layer) => layer.id)
        };
    }

    function mergeDirectiveStackSettings(currentInput = {}, patchInput = {}) {
        const current = currentInput && typeof currentInput === 'object' ? currentInput : {};
        const patch = patchInput && typeof patchInput === 'object' ? patchInput : {};
        return {
            ...current,
            ...patch,
            userGlobal: {
                ...((current && current.userGlobal) || {}),
                ...((patch && patch.userGlobal) || {})
            }
        };
    }

    function legacyGlobalPromptFromUserGlobal(stackInput = {}) {
        const stack = normalizeDirectiveStackSettings(stackInput);
        return {
            enabled: !!stack.userGlobal.enabled,
            content: clean(stack.userGlobal.content)
        };
    }

    function normalizeTaskKind(value) {
        const kind = clean(value);
        return TASK_KINDS.includes(kind) ? kind : '';
    }

    function aiTaskFrom(config = {}, prompt = {}) {
        const meta = prompt && prompt.meta && typeof prompt.meta === 'object' ? prompt.meta : {};
        return config.aiTask && typeof config.aiTask === 'object'
            ? config.aiTask
            : (meta.aiTask && typeof meta.aiTask === 'object' ? meta.aiTask : {});
    }

    function resolveTaskKindFromAITask(task = {}) {
        const targetType = clean(task.target && task.target.type);
        if (TARGET_TYPE_TASK_KIND[targetType]) return TARGET_TYPE_TASK_KIND[targetType];
        if (targetType === 'workflow-node') {
            const nodeId = clean(task.target && task.target.id);
            if (WORKFLOW_NODE_TASK_KIND[nodeId]) return WORKFLOW_NODE_TASK_KIND[nodeId];
        }
        return SAFE_DOMAIN_ACTION_KIND[`${clean(task.domain)}:${clean(task.action)}`] || '';
    }

    function resolveTaskKind(config = {}, prompt = {}) {
        const meta = prompt && prompt.meta && typeof prompt.meta === 'object' ? prompt.meta : {};
        const explicit = normalizeTaskKind(config.taskKind) || normalizeTaskKind(meta.taskKind);
        if (explicit) return explicit;
        const fromTask = resolveTaskKindFromAITask(aiTaskFrom(config, prompt));
        if (fromTask) return fromTask;
        const alias = TASK_KIND_ALIASES[clean(meta.task)];
        if (alias) return alias;
        const nodeId = clean(config.workflowNodeId || meta.workflowNodeId);
        if (WORKFLOW_NODE_TASK_KIND[nodeId]) return WORKFLOW_NODE_TASK_KIND[nodeId];
        if (config.strictTaskKind) {
            const error = new Error('Directive Stack requires an explicit taskKind.');
            error.code = 'directive_task_kind_missing';
            throw error;
        }
        return 'unknown';
    }

    function layerApplies(layer, taskKind) {
        return !!(layer && layer.enabled && layer.content && layer.scopes.includes(taskKind));
    }

    function sectionText(layer) {
        return layer.title ? `## ${layer.title}\n${layer.content}` : layer.content;
    }

    function compiledSourceLayers(context, taskKind) {
        if (context.frozenDirectiveStack && Array.isArray(context.frozenDirectiveStack.layers)) {
            return context.frozenDirectiveStack.layers.map((layer, index) => normalizeDirectiveLayer(layer, {
                id: `frozen_${index + 1}`,
                scopes: CREATIVE_TASK_KINDS,
                source: 'frozen'
            }));
        }
        const stack = normalizeDirectiveStackSettings(context.directiveStack || {}, context.globalPrompt || {});
        const project = normalizeProjectDirectiveStack(context.projectDirectiveStack || {});
        const layers = [stack.userGlobal, ...project.layers];
        const session = context.sessionDirective || context.directiveOverride;
        if (session && typeof session === 'object') {
            layers.push(normalizeDirectiveLayer(session, {
                id: 'run_session',
                title: '本次任务指令',
                scopes: [taskKind],
                source: 'session'
            }));
        } else if (clean(session)) {
            layers.push(normalizeDirectiveLayer({ content: session, scopes: [taskKind] }, {
                id: 'run_session',
                title: '本次任务指令',
                scopes: [taskKind],
                source: 'session'
            }));
        }
        return layers;
    }

    function compileInstructionStack(context = {}) {
        const taskKind = normalizeTaskKind(context.taskKind) || 'unknown';
        const debugLayers = [];
        const applied = [];
        if (CREATIVE_TASK_KINDS.includes(taskKind)) {
            applied.push({
                id: 'app_defaults',
                title: '应用创作契约',
                content: APP_DEFAULT_CREATIVE,
                source: 'system'
            });
            debugLayers.push({ id: 'app_defaults', applied: true, reason: 'applied', chars: APP_DEFAULT_CREATIVE.length });
        }
        for (const layer of compiledSourceLayers(context, taskKind)) {
            const applies = layerApplies(layer, taskKind);
            debugLayers.push({
                id: layer.id,
                applied: applies,
                reason: !layer.enabled ? 'disabled' : (!layer.content ? 'empty' : (applies ? 'applied' : 'out_of_scope')),
                chars: applies ? layer.content.length : 0
            });
            if (applies) applied.push(layer);
        }
        const text = applied.map(sectionText).filter(Boolean).join('\n\n');
        if (text.length > MAX_COMPILED_CHARS) {
            const error = new Error(`Directive Stack is too long (${text.length}/${MAX_COMPILED_CHARS} characters). Shorten the active directives before generating.`);
            error.code = 'directive_stack_too_long';
            error.totalChars = text.length;
            error.maxChars = MAX_COMPILED_CHARS;
            throw error;
        }
        const debug = {
            schemaVersion: SCHEMA_VERSION,
            taskKind,
            layers: debugLayers,
            appliedLayerIds: applied.map((layer) => layer.id),
            totalChars: text.length,
            warnings: []
        };
        return {
            messagesPrefix: text ? [{ role: 'system', content: text }] : [],
            appliedLayers: applied.map((layer) => ({
                id: layer.id,
                title: layer.title || '',
                source: layer.source || '',
                chars: layer.content.length
            })),
            debug
        };
    }

    function applyInstructionStack(messages, compiled) {
        const source = Array.isArray(messages) ? messages : [];
        const prefix = compiled && Array.isArray(compiled.messagesPrefix) ? compiled.messagesPrefix : [];
        return [...prefix.map((message) => ({ ...message })), ...source.map((message) => ({ ...message }))];
    }

    function buildDirectiveAuditEnvelope(compiled, snapshotVersion = SCHEMA_VERSION) {
        const debug = compiled && compiled.debug ? compiled.debug : {};
        return {
            schemaVersion: SCHEMA_VERSION,
            taskKind: normalizeTaskKind(debug.taskKind) || 'unknown',
            snapshotVersion,
            appliedLayerIds: Array.isArray(debug.appliedLayerIds) ? [...debug.appliedLayerIds] : []
        };
    }

    function createDirectiveSnapshot({ directiveStack, projectDirectiveStack } = {}) {
        const settingsStack = normalizeDirectiveStackSettings(directiveStack || {});
        const projectStack = normalizeProjectDirectiveStack(projectDirectiveStack || {});
        return {
            schemaVersion: SCHEMA_VERSION,
            directivePolicyVersion: SCHEMA_VERSION,
            mode: DIRECTIVE_STACK_MODE_SCOPED,
            layers: [settingsStack.userGlobal, ...projectStack.layers].map((layer) => ({ ...layer, source: 'frozen' }))
        };
    }

    return Object.freeze({
        SCHEMA_VERSION,
        DIRECTIVE_STACK_MODE_PARITY,
        DIRECTIVE_STACK_MODE_SCOPED,
        MAX_COMPILED_CHARS,
        TASK_KINDS,
        CREATIVE_TASK_KINDS,
        TASK_KIND_ALIASES,
        SAFE_DOMAIN_ACTION_KIND,
        TARGET_TYPE_TASK_KIND,
        WORKFLOW_NODE_TASK_KIND,
        APP_DEFAULT_CREATIVE,
        normalizeDirectiveLayer,
        normalizeDirectiveStackSettings,
        normalizeProjectDirectiveStack,
        mergeDirectiveStackSettings,
        legacyGlobalPromptFromUserGlobal,
        resolveTaskKindFromAITask,
        resolveTaskKind,
        compileInstructionStack,
        applyInstructionStack,
        buildDirectiveAuditEnvelope,
        createDirectiveSnapshot
    });
});
