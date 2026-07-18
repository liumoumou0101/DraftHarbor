const assert = require('assert');
const Extraction = require('../src/core/knowledge/reader-compendium-extraction');

const text = `${'甲'.repeat(1100)}\n\n${'乙'.repeat(1100)}`;
const chunks = Extraction.chunkText(text, { size: 1200, overlap: 100 });
assert.ok(chunks.length > 1, 'long sources should be chunked');
assert.ok(chunks[1].start < chunks[0].end, 'chunks should overlap');

const first = Extraction.normalizeCard({ type: 'character', title: '林岚', aliases: ['小林'], summary: '调查员', tags: ['港口'] }, { chunkIndex: 0, start: 0, end: 100, excerpt: '林岚走进港口。' });
const second = Extraction.normalizeCard({ type: 'character', title: '小林', aliases: ['林岚'], body: '她检查钟楼。', tags: ['钟楼'] }, { chunkIndex: 1, start: 80, end: 180, excerpt: '小林检查钟楼。' });
const merged = Extraction.mergeCards([first, second]);
assert.strictEqual(merged.length, 1, 'cross-block aliases should merge');
assert.deepStrictEqual(merged[0].tags.sort(), ['港口', '钟楼'].sort());
assert.strictEqual(merged[0].evidence.length, 2, 'merged cards should retain all evidence');

const compared = Extraction.compareCandidates(merged, [{ id: 'existing-linyan', type: 'character', title: '林岚', aliases: [] }]);
assert.strictEqual(compared[0].classification, 'update');
assert.strictEqual(compared[0].existingEntryId, 'existing-linyan');
assert.throws(() => Extraction.validateDecisions(compared), /explicit decision/);
assert.throws(() => Extraction.normalizeCard({ type: 'character', title: '越权', projectId: 'other' }), /unauthorized fields/);
assert.throws(() => Extraction.normalizeCard({ type: 'unknown', title: '未知' }), /unknown compendium card type/);
assert.throws(() => Extraction.mergeCards(new Array(321).fill(first), 80), /safety limit/);

console.log('reader compendium extraction tests passed');
