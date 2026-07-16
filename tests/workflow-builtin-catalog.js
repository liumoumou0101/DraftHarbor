const assert = require('assert');
const Catalog = require('../src/core/workflow/workflow-builtin-catalog');
const continuation = require('../desktop/services/workflow-guided-service');
const creation = require('../desktop/services/workflow-creation-guided-service');
const rewrite = require('../desktop/services/workflow-rewrite-guided-service');

const registry = Catalog.createBuiltinWorkflowRegistry();
assert.strictEqual(registry.listCapabilities().length, 15);
assert.strictEqual(registry.validateWorkflowDefinition(continuation.definition({})).ok, true);
assert.strictEqual(registry.validateWorkflowDefinition(creation.definition({})).ok, true);
assert.strictEqual(registry.validateWorkflowDefinition(rewrite.definition({})).ok, true);

const invalidPort = continuation.definition({});
invalidPort.edges[0].fromPortId = 'missing';
assert.ok(registry.validateWorkflowDefinition(invalidPort).errors.some((error) => error.includes('output port not found')));

const incompatible = continuation.definition({});
incompatible.edges[0].fromPortId = 'snapshot';
assert.ok(registry.validateWorkflowDefinition(incompatible).errors.some((error) => error.includes('incompatible')));

const unknown = continuation.definition({});
unknown.nodes[0].capabilityId = 'plugin.unknown';
assert.ok(registry.validateWorkflowDefinition(unknown).errors.some((error) => error.includes('unknown capability')));

console.log('Workflow builtin catalog test passed.');
