const assert = require('assert');
const WorkflowDefinition = require('../src/core/workflow/workflow-definition-schema');

const definition = WorkflowDefinition.createWorkflowDefinition({
  id: 'definition-1',
  title: '续写工作流',
  nodes: [
    { id: 'source', capabilityId: 'source.text', capabilityVersion: 1 },
    { id: 'outline', capabilityId: 'outline.extract', capabilityVersion: 2 },
    { id: 'draft', capabilityId: 'draft.generate', capabilityVersion: 1 }
  ],
  edges: [
    { id: 'edge-1', fromNodeId: 'source', fromPortId: 'text', toNodeId: 'outline', toPortId: 'source' },
    { id: 'edge-2', fromNodeId: 'outline', fromPortId: 'outline', toNodeId: 'draft', toPortId: 'outline' }
  ],
  createdAt: '2026-07-14T00:00:00.000Z'
});

const valid = WorkflowDefinition.validateWorkflowDefinition(definition);
assert.strictEqual(valid.ok, true);
assert.deepStrictEqual(valid.order, ['source', 'outline', 'draft']);
assert.strictEqual(valid.definition.schemaVersion, 2);

const snapshot = WorkflowDefinition.createWorkflowDefinitionSnapshot(definition, {
  capturedAt: '2026-07-14T01:00:00.000Z'
});
assert.strictEqual(snapshot.definitionId, 'definition-1');
assert.strictEqual(snapshot.capturedAt, '2026-07-14T01:00:00.000Z');
assert.notStrictEqual(snapshot.definition, definition);

const template = WorkflowDefinition.createWorkflowTemplate({
  id: 'continuation',
  version: 3,
  title: '续写模板',
  definition
});
const templateValidation = WorkflowDefinition.validateWorkflowTemplate(template);
assert.strictEqual(templateValidation.ok, true, templateValidation.errors.join('; '));
assert.strictEqual(template.definition.templateId, 'continuation');
assert.strictEqual(template.definition.templateVersion, 3);
const instantiated = WorkflowDefinition.createWorkflowDefinitionFromTemplate(template, {
  id: 'run-definition-1',
  title: '本次续写'
});
assert.strictEqual(instantiated.id, 'run-definition-1');
assert.strictEqual(instantiated.templateId, 'continuation');
assert.strictEqual(instantiated.templateVersion, 3);
assert.deepStrictEqual(instantiated.nodes.map((node) => node.id), ['source', 'outline', 'draft']);

const duplicate = WorkflowDefinition.validateWorkflowDefinition({
  nodes: [
    { id: 'same', capabilityId: 'one' },
    { id: 'same', capabilityId: 'two' }
  ]
});
assert.strictEqual(duplicate.ok, false);
assert.ok(duplicate.errors.some((error) => error.includes('duplicate node id')));

const missingEndpoint = WorkflowDefinition.validateWorkflowDefinition({
  nodes: [{ id: 'only', capabilityId: 'one' }],
  edges: [{ id: 'bad-edge', fromNodeId: 'only', fromPortId: 'out', toNodeId: 'missing', toPortId: 'in' }]
});
assert.strictEqual(missingEndpoint.ok, false);
assert.ok(missingEndpoint.errors.some((error) => error.includes('target node not found')));

const cycle = WorkflowDefinition.validateWorkflowDefinition({
  nodes: [
    { id: 'a', capabilityId: 'one' },
    { id: 'b', capabilityId: 'two' }
  ],
  edges: [
    { id: 'a-b', fromNodeId: 'a', fromPortId: 'out', toNodeId: 'b', toPortId: 'in' },
    { id: 'b-a', fromNodeId: 'b', fromPortId: 'out', toNodeId: 'a', toPortId: 'in' }
  ]
});
assert.strictEqual(cycle.ok, false);
assert.ok(cycle.errors.includes('workflow definition must be acyclic'));

const interrupted = WorkflowDefinition.createWorkflowNodeState({
  nodeId: 'draft',
  executionState: 'interrupted',
  attempt: 2,
  activeChunkId: 'chunk-3'
});
assert.strictEqual(interrupted.executionState, 'interrupted');
assert.strictEqual(interrupted.attempt, 2);
assert.strictEqual(interrupted.activeChunkId, 'chunk-3');

console.log('Workflow v2 schema test passed.');
