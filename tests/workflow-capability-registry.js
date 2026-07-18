const assert = require('assert');
const CapabilityRegistry = require('../src/core/workflow/workflow-capability-registry');

const registry = CapabilityRegistry.createWorkflowCapabilityRegistry();
registry.registerArtifactType({
  id: 'source-text',
  version: 1,
  payloadFormat: 'text',
  validatePayload: (payload) => typeof payload === 'string' && payload.length > 0
});
registry.registerArtifactType({
  id: 'story-outline',
  version: 1,
  payloadFormat: 'json',
  validatePayload: (payload) => payload && Array.isArray(payload.beats) ? true : ['beats is required']
});
registry.registerArtifactType({ id: 'draft-batch', version: 1, payloadFormat: 'text' });

registry.registerCapability({
  id: 'source.provide',
  version: 1,
  outputPorts: [{ id: 'text', artifactType: 'source-text@1' }]
});
registry.registerCapability({
  id: 'outline.extract',
  version: 2,
  inputPorts: [{ id: 'source', artifactType: 'source-text@1', required: true }],
  outputPorts: [{ id: 'outline', artifactType: 'story-outline@1' }],
  configDefaults: { depth: 'chapter' },
  validateConfig: (config) => ['chapter', 'scene'].includes(config.depth) || ['depth is invalid']
});
registry.registerCapability({
  id: 'draft.generate',
  version: 1,
  inputPorts: [{ id: 'outline', artifactType: 'story-outline@1', required: true }],
  outputPorts: [{ id: 'draft', artifactType: 'draft-batch@1' }]
});

const valid = registry.validateWorkflowDefinition({
  nodes: [
    { id: 'source', capabilityId: 'source.provide', capabilityVersion: 1 },
    { id: 'outline', capabilityId: 'outline.extract', capabilityVersion: 2 },
    { id: 'draft', capabilityId: 'draft.generate', capabilityVersion: 1 }
  ],
  edges: [
    { id: 'edge-1', fromNodeId: 'source', fromPortId: 'text', toNodeId: 'outline', toPortId: 'source' },
    { id: 'edge-2', fromNodeId: 'outline', fromPortId: 'outline', toNodeId: 'draft', toPortId: 'outline' }
  ]
});
assert.strictEqual(valid.ok, true, valid.errors.join('; '));

const unknownVersion = registry.validateWorkflowDefinition({
  nodes: [{ id: 'source', capabilityId: 'source.provide', capabilityVersion: 9 }]
});
assert.strictEqual(unknownVersion.ok, false);
assert.ok(unknownVersion.errors.some((error) => error.includes('unknown capability source.provide@9')));

const missingRequiredInput = registry.validateWorkflowDefinition({
  nodes: [{ id: 'outline', capabilityId: 'outline.extract', capabilityVersion: 2 }]
});
assert.strictEqual(missingRequiredInput.ok, false);
assert.ok(missingRequiredInput.errors.some((error) => error.includes('required input is not connected')));

const incompatible = registry.validateWorkflowDefinition({
  nodes: [
    { id: 'source', capabilityId: 'source.provide', capabilityVersion: 1 },
    { id: 'draft', capabilityId: 'draft.generate', capabilityVersion: 1 }
  ],
  edges: [
    { id: 'bad-type', fromNodeId: 'source', fromPortId: 'text', toNodeId: 'draft', toPortId: 'outline' }
  ]
});
assert.strictEqual(incompatible.ok, false);
assert.ok(incompatible.errors.some((error) => error.includes('artifact types are incompatible')));

assert.deepStrictEqual(
  registry.validateArtifactPayload('story-outline@1', { beats: ['开端', '转折'] }),
  { ok: true, errors: [] }
);
assert.strictEqual(registry.validateArtifactPayload('story-outline@1', {}).ok, false);
assert.strictEqual(registry.validateArtifactPayload('source-text@1', '').ok, false);
assert.throws(
  () => registry.registerCapability({
    id: 'unknown.output',
    outputPorts: [{ id: 'result', artifactType: 'unknown-type@1' }]
  }),
  /unknown artifact type/
);
assert.throws(
  () => registry.registerArtifactType({ id: 'binary-output', version: 1, payloadFormat: 'binary' }),
  /unsupported artifact payload format/
);

console.log('Workflow capability registry test passed.');
