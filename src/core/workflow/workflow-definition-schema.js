(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborWorkflowDefinitionSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const WORKFLOW_DEFINITION_SCHEMA_VERSION = 2;
    const NODE_EXECUTION_STATES = Object.freeze([
        'pending',
        'ready',
        'running',
        'waiting_user',
        'completed',
        'failed',
        'interrupted',
        'skipped',
        'cancelled'
    ]);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function clonePlain(value) {
        if (Array.isArray(value)) return value.map(clonePlain);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = clonePlain(item);
        return result;
    }

    function positiveInteger(value, fallback = 1) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    function nowIso(value = '') {
        if (value) {
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
        return new Date().toISOString();
    }

    function makeId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function createWorkflowNode(input = {}) {
        return {
            id: cleanString(input.id) || makeId('workflow-node'),
            capabilityId: cleanString(input.capabilityId),
            capabilityVersion: positiveInteger(input.capabilityVersion, 1),
            title: cleanString(input.title),
            description: cleanString(input.description),
            config: input.config && typeof input.config === 'object' && !Array.isArray(input.config)
                ? clonePlain(input.config)
                : {},
            position: input.position && typeof input.position === 'object'
                ? {
                    x: Number.isFinite(Number(input.position.x)) ? Number(input.position.x) : 0,
                    y: Number.isFinite(Number(input.position.y)) ? Number(input.position.y) : 0
                }
                : { x: 0, y: 0 },
            disabled: input.disabled === true
        };
    }

    function createWorkflowEdge(input = {}) {
        const from = input.from && typeof input.from === 'object' ? input.from : {};
        const to = input.to && typeof input.to === 'object' ? input.to : {};
        return {
            id: cleanString(input.id) || makeId('workflow-edge'),
            from: {
                nodeId: cleanString(from.nodeId || input.fromNodeId),
                portId: cleanString(from.portId || input.fromPortId)
            },
            to: {
                nodeId: cleanString(to.nodeId || input.toNodeId),
                portId: cleanString(to.portId || input.toPortId)
            }
        };
    }

    function createWorkflowDefinition(input = {}) {
        const now = nowIso(input.updatedAt || input.createdAt);
        return {
            schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
            id: cleanString(input.id) || makeId('workflow-definition'),
            templateId: cleanString(input.templateId),
            templateVersion: positiveInteger(input.templateVersion, 1),
            title: cleanString(input.title, '未命名工作流') || '未命名工作流',
            description: cleanString(input.description),
            automationLevel: cleanString(input.automationLevel, 'semi_automatic') || 'semi_automatic',
            nodes: Array.isArray(input.nodes) ? input.nodes.map(createWorkflowNode) : [],
            edges: Array.isArray(input.edges) ? input.edges.map(createWorkflowEdge) : [],
            settings: input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
                ? clonePlain(input.settings)
                : {},
            createdAt: nowIso(input.createdAt || now),
            updatedAt: now
        };
    }

    function createWorkflowTemplate(input = {}) {
        const id = cleanString(input.id || input.templateId);
        const version = positiveInteger(input.version || input.templateVersion, 1);
        const source = input.definition && typeof input.definition === 'object' ? input.definition : input;
        const now = nowIso(input.updatedAt || input.createdAt);
        return {
            schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
            id,
            version,
            title: cleanString(input.title || source.title, '未命名工作流模板') || '未命名工作流模板',
            description: cleanString(input.description || source.description),
            definition: createWorkflowDefinition({
                ...source,
                id: cleanString(source.id) || (id ? `${id}@${version}` : undefined),
                templateId: id,
                templateVersion: version,
                createdAt: source.createdAt || input.createdAt || now,
                updatedAt: source.updatedAt || input.updatedAt || now
            }),
            createdAt: nowIso(input.createdAt || now),
            updatedAt: now
        };
    }

    function validateWorkflowTemplate(input = {}) {
        const template = createWorkflowTemplate(input);
        const definitionValidation = validateWorkflowDefinition(template.definition);
        const errors = definitionValidation.errors.slice();
        if (!template.id) errors.unshift('template id is required');
        return { ok: errors.length === 0, errors, template };
    }

    function createWorkflowDefinitionFromTemplate(templateInput = {}, overrides = {}) {
        const validation = validateWorkflowTemplate(templateInput);
        if (!validation.ok) {
            const error = new Error(`Invalid workflow template: ${validation.errors.join('; ')}`);
            error.name = 'WorkflowTemplateValidationError';
            error.errors = validation.errors.slice();
            throw error;
        }
        const template = validation.template;
        return createWorkflowDefinition({
            ...template.definition,
            ...overrides,
            id: cleanString(overrides.id) || undefined,
            templateId: template.id,
            templateVersion: template.version,
            nodes: overrides.nodes === undefined ? template.definition.nodes : overrides.nodes,
            edges: overrides.edges === undefined ? template.definition.edges : overrides.edges,
            settings: overrides.settings === undefined ? template.definition.settings : overrides.settings,
            createdAt: overrides.createdAt,
            updatedAt: overrides.updatedAt
        });
    }

    function topologicalOrder(definitionInput = {}) {
        const definition = createWorkflowDefinition(definitionInput);
        const ids = definition.nodes.map((node) => node.id);
        const indegree = new Map(ids.map((id) => [id, 0]));
        const outgoing = new Map(ids.map((id) => [id, []]));

        for (const edge of definition.edges) {
            if (!indegree.has(edge.from.nodeId) || !indegree.has(edge.to.nodeId)) continue;
            outgoing.get(edge.from.nodeId).push(edge.to.nodeId);
            indegree.set(edge.to.nodeId, indegree.get(edge.to.nodeId) + 1);
        }

        const queue = ids.filter((id) => indegree.get(id) === 0);
        const order = [];
        while (queue.length) {
            const id = queue.shift();
            order.push(id);
            for (const target of outgoing.get(id) || []) {
                indegree.set(target, indegree.get(target) - 1);
                if (indegree.get(target) === 0) queue.push(target);
            }
        }
        return {
            order,
            hasCycle: order.length !== ids.length
        };
    }

    function validateWorkflowDefinition(input = {}) {
        const definition = createWorkflowDefinition(input);
        const errors = [];
        const nodeIds = new Set();
        const edgeIds = new Set();

        if (!definition.id) errors.push('definition id is required');
        if (!definition.title) errors.push('definition title is required');
        if (!definition.nodes.length) errors.push('definition must contain at least one node');

        for (const node of definition.nodes) {
            if (nodeIds.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
            nodeIds.add(node.id);
            if (!node.capabilityId) errors.push(`node ${node.id} capabilityId is required`);
        }

        for (const edge of definition.edges) {
            if (edgeIds.has(edge.id)) errors.push(`duplicate edge id: ${edge.id}`);
            edgeIds.add(edge.id);
            if (!edge.from.nodeId || !edge.from.portId || !edge.to.nodeId || !edge.to.portId) {
                errors.push(`edge ${edge.id} must define both node and port endpoints`);
                continue;
            }
            if (!nodeIds.has(edge.from.nodeId)) errors.push(`edge ${edge.id} source node not found: ${edge.from.nodeId}`);
            if (!nodeIds.has(edge.to.nodeId)) errors.push(`edge ${edge.id} target node not found: ${edge.to.nodeId}`);
            if (edge.from.nodeId === edge.to.nodeId) errors.push(`edge ${edge.id} cannot connect a node to itself`);
        }

        const topology = topologicalOrder(definition);
        if (topology.hasCycle) errors.push('workflow definition must be acyclic');

        return {
            ok: errors.length === 0,
            errors,
            definition,
            order: topology.order
        };
    }

    function requireWorkflowDefinition(input = {}) {
        const validation = validateWorkflowDefinition(input);
        if (!validation.ok) {
            const error = new Error(`Invalid workflow definition: ${validation.errors.join('; ')}`);
            error.name = 'WorkflowDefinitionValidationError';
            error.errors = validation.errors.slice();
            throw error;
        }
        return validation.definition;
    }

    function createWorkflowDefinitionSnapshot(input = {}, options = {}) {
        const definition = requireWorkflowDefinition(input);
        return {
            schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
            definitionId: definition.id,
            templateId: definition.templateId,
            templateVersion: definition.templateVersion,
            capturedAt: nowIso(options.capturedAt),
            definition: clonePlain(definition)
        };
    }

    function createWorkflowNodeState(input = {}) {
        const executionState = cleanString(input.executionState || input.status, 'pending');
        return {
            nodeId: cleanString(input.nodeId),
            executionState: NODE_EXECUTION_STATES.includes(executionState) ? executionState : 'pending',
            attempt: Number.isInteger(Number(input.attempt)) && Number(input.attempt) >= 0 ? Number(input.attempt) : 0,
            activeChunkId: cleanString(input.activeChunkId),
            error: input.error && typeof input.error === 'object'
                ? {
                    code: cleanString(input.error.code),
                    message: cleanString(input.error.message)
                }
                : null,
            startedAt: cleanString(input.startedAt),
            finishedAt: cleanString(input.finishedAt),
            invalidatedAt: cleanString(input.invalidatedAt),
            invalidatedRevisionIds: Array.isArray(input.invalidatedRevisionIds)
                ? [...new Set(input.invalidatedRevisionIds.map(cleanString).filter(Boolean))]
                : [],
            updatedAt: nowIso(input.updatedAt)
        };
    }

    return {
        WORKFLOW_DEFINITION_SCHEMA_VERSION,
        NODE_EXECUTION_STATES,
        createWorkflowNode,
        createWorkflowEdge,
        createWorkflowDefinition,
        createWorkflowTemplate,
        validateWorkflowTemplate,
        createWorkflowDefinitionFromTemplate,
        validateWorkflowDefinition,
        requireWorkflowDefinition,
        createWorkflowDefinitionSnapshot,
        createWorkflowNodeState,
        topologicalOrder
    };
});
