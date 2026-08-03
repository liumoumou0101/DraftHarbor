const assert = require('assert');
const InstructionStack = require('../src/core/generation/instruction-stack');
const ProviderStream = require('../src/core/generation/provider-stream');

const USER_SENTINEL = 'USER-DIRECTIVE-SENTINEL';
const PROJECT_SENTINEL = 'PROJECT-DIRECTIVE-SENTINEL';

const migrated = InstructionStack.normalizeDirectiveStackSettings({}, {
  enabled: true,
  content: USER_SENTINEL
});
assert.strictEqual(migrated.mode, 'scoped');
assert.strictEqual(migrated.userGlobal.content, USER_SENTINEL);
assert.ok(migrated.userGlobal.scopes.includes('writer-prose'));
assert.ok(!migrated.userGlobal.scopes.includes('workflow-json'));

const projectDirectiveStack = {
  schemaVersion: 1,
  layers: [{
    id: 'project_main',
    title: '本作品',
    enabled: true,
    content: PROJECT_SENTINEL,
    scopes: ['writer-prose', 'workflow-draft']
  }]
};

const creative = InstructionStack.compileInstructionStack({
  taskKind: 'writer-prose',
  directiveStack: migrated,
  projectDirectiveStack
});
const creativeText = creative.messagesPrefix.map((message) => message.content).join('\n');
assert.strictEqual((creativeText.match(new RegExp(USER_SENTINEL, 'g')) || []).length, 1);
assert.strictEqual((creativeText.match(new RegExp(PROJECT_SENTINEL, 'g')) || []).length, 1);

const structured = InstructionStack.compileInstructionStack({
  taskKind: 'workflow-json',
  directiveStack: migrated,
  projectDirectiveStack
});
const structuredText = structured.messagesPrefix.map((message) => message.content).join('\n');
assert.ok(!structuredText.includes(USER_SENTINEL));
assert.ok(!structuredText.includes(PROJECT_SENTINEL));

const prompt = {
  messages: [
    { role: 'system', content: 'Task template.' },
    { role: 'user', content: 'Draft.' }
  ]
};
const config = {
  directiveStackMode: 'scoped',
  directiveStack: migrated,
  projectDirectiveStack,
  taskKind: 'writer-prose'
};
const first = ProviderStream.prepareDirectiveMessages(prompt.messages, prompt, config).messages;
const second = ProviderStream.prepareDirectiveMessages(prompt.messages, prompt, config).messages;
for (const requestMessages of [first, second]) {
  const requestText = JSON.stringify(requestMessages);
  assert.strictEqual((requestText.match(new RegExp(USER_SENTINEL, 'g')) || []).length, 1, 'each retry should inject user directive exactly once');
  assert.strictEqual((requestText.match(new RegExp(PROJECT_SENTINEL, 'g')) || []).length, 1, 'each retry should inject project directive exactly once');
}
assert.strictEqual(prompt.messages.length, 2, 'Directive Stack must not mutate prompt messages');
assert.strictEqual(prompt.meta, undefined, 'Directive Stack must not add a cross-request applied marker');

const isolated = ProviderStream.prepareDirectiveMessages(prompt.messages, prompt, {
  ...config,
  taskKind: 'reader-extract'
}).messages;
assert.ok(!JSON.stringify(isolated).includes(USER_SENTINEL));
assert.ok(!JSON.stringify(isolated).includes(PROJECT_SENTINEL));

assert.strictEqual(InstructionStack.resolveTaskKindFromAITask({
  domain: 'compendium', action: 'extract', target: { type: 'reader-transfer-chunk' }
}), 'reader-extract');
assert.strictEqual(InstructionStack.resolveTaskKindFromAITask({
  domain: 'compendium', action: 'extract', target: { type: 'scene-selection' }
}), 'compendium-json');
assert.strictEqual(InstructionStack.resolveTaskKindFromAITask({
  domain: 'compendium', action: 'update', target: { type: 'compendium-agent-analysis' }
}), 'compendium-agent');

assert.throws(() => InstructionStack.resolveTaskKind({ strictTaskKind: true }, prompt), (error) => error.code === 'directive_task_kind_missing');

const audit = InstructionStack.buildDirectiveAuditEnvelope(creative);
assert.deepStrictEqual(audit.appliedLayerIds, ['app_defaults', 'user_global', 'project_main']);
assert.ok(!JSON.stringify(audit).includes(USER_SENTINEL), 'audit envelope must not repeat directive content');
assert.ok(!JSON.stringify(audit).includes(PROJECT_SENTINEL), 'audit envelope must not repeat project content');

const frozen = InstructionStack.createDirectiveSnapshot({
  directiveStack: migrated,
  projectDirectiveStack
});
assert.strictEqual(frozen.directivePolicyVersion, 1);
assert.strictEqual(frozen.mode, 'scoped');

console.log('Instruction Stack tests passed.');
