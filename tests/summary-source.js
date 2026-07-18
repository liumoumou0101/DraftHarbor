const assert = require('assert');
const { buildChapterSummarySource, DEFAULT_MAX_CHARS } = require('../src/core/generation/summary-source');

const scenes = [
  { id: 'fresh', title: 'Fresh summary', summary: 'A concise, current summary.' },
  { id: 'stale', title: 'Stale summary', summary: 'This old summary must not be used.', summaryStale: true },
  { id: 'long', title: 'Long scene', summary: 'x'.repeat(5000) }
];

const source = buildChapterSummarySource({
  scenes,
  maxChars: 1000,
  getContent: (id) => id === 'stale' ? 'Fresh content replaces the stale summary.' : ''
});

assert.ok(source.text.includes('A concise, current summary.'), 'fresh summaries should be preferred');
assert.ok(source.text.includes('Fresh content replaces the stale summary.'), 'stale summaries should fall back to current scene content');
assert.ok(!source.text.includes('This old summary must not be used.'), 'stale summaries must not be used for chapter input');
assert.ok(source.compressed, 'oversized chapter input should report compression');
assert.ok(source.usedChars <= 1000, 'chapter source must stay within its configured budget');
assert.ok(source.text.length <= 1000, 'serialized chapter source must stay within its configured budget');
assert.strictEqual(DEFAULT_MAX_CHARS, 18000, 'default chapter summary budget should be explicit');

console.log('Summary source test passed.');
