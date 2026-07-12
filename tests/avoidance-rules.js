const assert = require('assert');
const rules = require('../src/core/style/avoidance-rules');

const normalized = rules.normalizeRules([
  { text: '嘴角微微上扬', reason: '避免模板化微表情' },
  { text: '嘴角微微上扬', reason: 'duplicate' },
  { text: '仿佛被命运推着走', enabled: false }
]);
assert.strictEqual(normalized.length, 2, 'duplicate avoidance expressions should be removed');
const instruction = rules.promptInstruction(normalized);
assert.ok(instruction.includes('嘴角微微上扬'), 'enabled rules should enter prompt instructions');
assert.ok(instruction.includes('避免模板化微表情'), 'rule reasons should enter prompt instructions');
assert.ok(!instruction.includes('仿佛被命运推着走'), 'disabled rules should not enter prompt instructions');
console.log('Avoidance rules test passed.');
