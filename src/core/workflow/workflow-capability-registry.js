(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./workflow-definition-schema'),
            require('./workflow-artifact-schema')
        );
    } else {
        root.DraftHarborWorkflowCapabilityRegistry = factory(
            root.DraftHarborWorkflowDefinitionSchema,
            root.DraftHarborWorkflowArtifactSchema
        );
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DefinitionSchema, ArtifactSchema) {
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

    function definitionKey(id, version) {
        return `${cleanString(id)}@${positiveInteger(version, 1)}`;
    }

    function normalizeArtifactTypeDefinition(input = {}) {
        const ref = ArtifactSchema.createArtifactTypeRef(input);
        return {
            id: ref.id,
            version: ref.version,
            title: cleanString(input.title, ref.id),
            payloadFormat: cleanString(input.payloadFormat, 'json'),
            validatePayload: typeof input.validatePayload === 'function' ? input.validatePayload : null
        };
    }

    function normalizePort(input = {}, direction) {
        const typeInputs = Array.isArray(input.artifactTypes)
            ? input.artifactTypes
            : (input.artifactType ? [input.artifactType] : []);
        return {
            id: cleanString(input.id),
            label: cleanString(input.label, input.id),
            direction,
            artifactTypes: typeInputs.map(ArtifactSchema.createArtifactTypeRef),
            required: direction === 'input' ? input.required !== false : false,
            multiple: input.multiple === true
        };
    }

    function normalizeCapabilityDefinition(input = {}) {
        return {
            id: cleanString(input.id),
            version: positiveInteger(input.version, 1),
            title: cleanString(input.title, input.id),
            category: cleanString(input.category, 'workflow'),
            inputPorts: (Array.isArray(input.inputPorts) ? input.inputPorts : []).map((port) => normalizePort(port, 'input')),
            outputPorts: (Array.isArray(input.outputPorts) ? input.outputPorts : []).map((port) => normalizePort(port, 'output')),
            configDefaults: input.configDefaults && typeof input.configDefaults === 'object' && !Array.isArray(input.configDefaults)
                ? clonePlain(input.configDefaults)
                : {},
            configSchema: input.configSchema && typeof input.configSchema === 'object' && !Array.isArray(input.configSchema)
                ? clonePlain(input.configSchema)
                : {},
            validateConfig: typeof input.validateConfig === 'function' ? input.validateConfig : null
        };
    }

    function duplicatePortIds(capability) {
        const errors = [];
        for (const [label, ports] of [['input', capability.inputPorts], ['output', capability.outputPorts]]) {
            const ids = new Set();
            for (const port of ports) {
                if (!port.id) errors.push(`${label} port id is required`);
                if (ids.has(port.id)) errors.push(`duplicate ${label} port id: ${port.id}`);
                ids.add(port.id);
                if (!port.artifactTypes.length) errors.push(`${label} port ${port.id || '(empty)'} must declare artifact types`);
            }
        }
        return errors;
    }

    function compatibleArtifactTypes(outputPort, inputPort) {
        const accepted = new Set(inputPort.artifactTypes.map(ArtifactSchema.artifactTypeKey));
        return outputPort.artifactTypes.some((type) => accepted.has(ArtifactSchema.artifactTypeKey(type)));
    }

    function createWorkflowCapabilityRegistry() {
        const artifactTypes = new Map();
        const capabilities = new Map();

        function registerArtifactType(input = {}) {
            const definition = normalizeArtifactTypeDefinition(input);
            if (!definition.id) throw new Error('artifact type id is required');
            if (!ArtifactSchema.PAYLOAD_FORMATS.includes(definition.payloadFormat)) {
                throw new Error(`unsupported artifact payload format: ${definition.payloadFormat}`);
            }
            const key = definitionKey(definition.id, definition.version);
            if (artifactTypes.has(key)) throw new Error(`artifact type already registered: ${key}`);
            artifactTypes.set(key, definition);
            return definition;
        }

        function getArtifactType(input, version) {
            const ref = version === undefined
                ? ArtifactSchema.createArtifactTypeRef(input)
                : ArtifactSchema.createArtifactTypeRef({ id: input, version });
            return artifactTypes.get(definitionKey(ref.id, ref.version)) || null;
        }

        function registerCapability(input = {}) {
            const definition = normalizeCapabilityDefinition(input);
            if (!definition.id) throw new Error('capability id is required');
            const errors = duplicatePortIds(definition);
            for (const port of [...definition.inputPorts, ...definition.outputPorts]) {
                for (const type of port.artifactTypes) {
                    if (!getArtifactType(type)) {
                        errors.push(`unknown artifact type ${ArtifactSchema.artifactTypeKey(type)} on port ${port.id}`);
                    }
                }
            }
            if (errors.length) throw new Error(`Invalid capability ${definition.id}: ${errors.join('; ')}`);
            const key = definitionKey(definition.id, definition.version);
            if (capabilities.has(key)) throw new Error(`capability already registered: ${key}`);
            capabilities.set(key, definition);
            return definition;
        }

        function getCapability(id, version = 1) {
            return capabilities.get(definitionKey(id, version)) || null;
        }

        function validateCapabilityConfig(capability, config, nodeId) {
            if (!capability.validateConfig) return [];
            try {
                const result = capability.validateConfig(clonePlain(config || {}));
                if (result === true || result === undefined || result === null) return [];
                if (result === false) return [`node ${nodeId} capability config is invalid`];
                if (Array.isArray(result)) return result.map((error) => `node ${nodeId}: ${cleanString(error)}`);
                if (result && typeof result === 'object' && Array.isArray(result.errors)) {
                    return result.errors.map((error) => `node ${nodeId}: ${cleanString(error)}`);
                }
                return [];
            } catch (error) {
                return [`node ${nodeId} capability config validation failed: ${error.message || error}`];
            }
        }

        function validateWorkflowDefinition(input = {}) {
            const base = DefinitionSchema.validateWorkflowDefinition(input);
            const definition = base.definition;
            const errors = base.errors.slice();
            const nodeCapabilities = new Map();

            for (const node of definition.nodes) {
                const capability = getCapability(node.capabilityId, node.capabilityVersion);
                if (!capability) {
                    errors.push(`node ${node.id} references unknown capability ${definitionKey(node.capabilityId, node.capabilityVersion)}`);
                    continue;
                }
                nodeCapabilities.set(node.id, capability);
                errors.push(...validateCapabilityConfig(capability, { ...capability.configDefaults, ...node.config }, node.id));
            }

            const incomingByPort = new Map();
            for (const edge of definition.edges) {
                const sourceCapability = nodeCapabilities.get(edge.from.nodeId);
                const targetCapability = nodeCapabilities.get(edge.to.nodeId);
                if (!sourceCapability || !targetCapability) continue;
                const outputPort = sourceCapability.outputPorts.find((port) => port.id === edge.from.portId);
                const inputPort = targetCapability.inputPorts.find((port) => port.id === edge.to.portId);
                if (!outputPort) {
                    errors.push(`edge ${edge.id} output port not found: ${edge.from.nodeId}.${edge.from.portId}`);
                    continue;
                }
                if (!inputPort) {
                    errors.push(`edge ${edge.id} input port not found: ${edge.to.nodeId}.${edge.to.portId}`);
                    continue;
                }
                if (!compatibleArtifactTypes(outputPort, inputPort)) {
                    errors.push(`edge ${edge.id} artifact types are incompatible`);
                }
                const inputKey = `${edge.to.nodeId}:${edge.to.portId}`;
                incomingByPort.set(inputKey, (incomingByPort.get(inputKey) || 0) + 1);
            }

            for (const node of definition.nodes) {
                if (node.disabled) continue;
                const capability = nodeCapabilities.get(node.id);
                if (!capability) continue;
                for (const port of capability.inputPorts) {
                    const count = incomingByPort.get(`${node.id}:${port.id}`) || 0;
                    if (port.required && count === 0) errors.push(`node ${node.id} required input is not connected: ${port.id}`);
                    if (!port.multiple && count > 1) errors.push(`node ${node.id} input does not allow multiple connections: ${port.id}`);
                }
            }

            return {
                ok: errors.length === 0,
                errors,
                definition,
                order: base.order
            };
        }

        function validateArtifactPayload(typeInput, payload) {
            const type = getArtifactType(typeInput);
            if (!type) {
                return { ok: false, errors: [`unknown artifact type: ${ArtifactSchema.artifactTypeKey(typeInput)}`] };
            }
            if (!type.validatePayload) return { ok: true, errors: [] };
            try {
                const result = type.validatePayload(clonePlain(payload));
                if (result === true || result === undefined || result === null) return { ok: true, errors: [] };
                if (result === false) return { ok: false, errors: [`payload is invalid for ${definitionKey(type.id, type.version)}`] };
                const errors = Array.isArray(result)
                    ? result.map((error) => cleanString(error))
                    : (result && Array.isArray(result.errors)
                        ? result.errors.map((error) => cleanString(error))
                        : []);
                return { ok: errors.length === 0, errors };
            } catch (error) {
                return { ok: false, errors: [error.message || String(error)] };
            }
        }

        return Object.freeze({
            registerArtifactType,
            getArtifactType,
            listArtifactTypes: () => Array.from(artifactTypes.values()),
            registerCapability,
            getCapability,
            listCapabilities: () => Array.from(capabilities.values()),
            validateWorkflowDefinition,
            validateArtifactPayload
        });
    }

    return {
        createWorkflowCapabilityRegistry,
        normalizeArtifactTypeDefinition,
        normalizeCapabilityDefinition,
        compatibleArtifactTypes
    };
});
