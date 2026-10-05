const assert = require('assert');
const Illustration = require('../src/core/document/reader-illustration');

const chapter = {
  chapterId: 'chapter-1',
  blocks: [
    { blockId: 'b1', text: '第一段' },
    { blockId: 'b2', text: '第二段' },
    { blockId: 'b3', text: '第三段' }
  ]
};
const base = {
  documentId: 'book-1', chapterId: 'chapter-1', offset: 0, assetId: 'image:asset',
  mediaType: 'image/png', createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z'
};
const illustrations = [
  Illustration.createReaderIllustration({ ...base, illustrationId: 'i1', blockId: 'b1', fileName: 'one.png' }),
  Illustration.createReaderIllustration({ ...base, illustrationId: 'i2', blockId: 'b2', fileName: 'two.png' }),
  Illustration.createReaderIllustration({ ...base, illustrationId: 'i3', blockId: 'b2', fileName: 'three.png' })
];

assert.strictEqual(Illustration.pageContainsAnchor({
  segments: [{ blockId: 'b1', startOffset: 0, endOffset: 3 }]
}, { blockId: 'b1', offset: 2 }), true, 'a selected trigger inside the visible page must remain active');
assert.strictEqual(Illustration.pageContainsAnchor({
  segments: [{ blockId: 'b1', startOffset: 3, endOffset: 6 }]
}, { blockId: 'b1', offset: 2 }), false, 'a trigger from the previous split page must not remain selected');
assert.strictEqual(Illustration.pageContainsAnchor({
  segments: [{ blockId: 'b2', startOffset: 0, endOffset: 3 }]
}, { blockId: 'b1', offset: 0 }), false, 'a trigger from another paragraph must not remain selected');

assert.deepStrictEqual(Illustration.activeIllustrationsForPage(illustrations, chapter, {
  segments: [{ blockId: 'b1', blockIndex: 0, endOffset: 3 }]
}).map((item) => item.illustrationId), ['i1']);
assert.deepStrictEqual(Illustration.activeIllustrationsForPage(illustrations, chapter, {
  segments: [{ blockId: 'b2', blockIndex: 1, endOffset: 3 }]
}).map((item) => item.illustrationId), ['i2', 'i3'], 'images sharing a visible trigger must retain upload order');
assert.deepStrictEqual(Illustration.activeIllustrationsForPage(illustrations, chapter, {
  segments: [{ blockId: 'b3', blockIndex: 2, endOffset: 3 }]
}).map((item) => item.illustrationId), [], 'legacy images must expire after their anchor paragraph leaves the page');
assert.deepStrictEqual(Illustration.activeIllustrationsForPage(illustrations, { ...chapter, chapterId: 'chapter-2' }, {
  segments: [{ blockId: 'b3', blockIndex: 2, endOffset: 3 }]
}), [], 'illustrations must not leak across chapters');

const splitAnchor = Illustration.createReaderIllustration({
  ...base, illustrationId: 'split', blockId: 'b2', offset: 2, fileName: 'split.png'
});
assert.deepStrictEqual(Illustration.activeIllustrationsForPage([illustrations[0], splitAnchor], chapter, {
  segments: [{ blockId: 'b2', blockIndex: 1, startOffset: 0, endOffset: 2 }]
}).map((item) => item.illustrationId), [], 'an anchor at the exclusive page end must wait for the following page');
assert.deepStrictEqual(Illustration.activeIllustrationsForPage([illustrations[0], splitAnchor], chapter, {
  segments: [{ blockId: 'b2', blockIndex: 1, startOffset: 2, endOffset: 3 }]
}).map((item) => item.illustrationId), ['split'], 'an anchor must trigger when its text first appears');

assert.deepStrictEqual(Illustration.activeIllustrationsForPage(illustrations, chapter, {
  segments: [{ blockId: 'b1', startOffset: 0, endOffset: 3 }, { blockId: 'b2', startOffset: 0, endOffset: 3 }]
}).map((item) => item.illustrationId), ['i1', 'i2', 'i3'], 'all visible legacy groups must be offered on the same page');

const range = { start: { blockId: 'b1', offset: 1 }, end: { blockId: 'b2', offset: 2 } };
const ranged = Illustration.createReaderIllustration({
  ...base, illustrationId: 'range', blockId: 'b1', offset: 1, revisionId: 'revision-1', range
});
assert.strictEqual(ranged.revisionId, 'revision-1', 'the revision used to bind an image must survive normalization');
assert.deepStrictEqual(ranged.range, range, 'content range must survive normalization');
assert.ok(!Object.hasOwn(illustrations[0], 'range') && !Object.hasOwn(illustrations[0], 'revisionId'), 'legacy records must not acquire invented scope or revision');
range.start.offset = 0;
assert.strictEqual(ranged.range.start.offset, 1, 'normalization must capture the range instead of sharing mutable upload data');

const rangePages = [
  { segments: [{ blockId: 'b1', startOffset: 0, endOffset: 1 }], expected: [] },
  { segments: [{ blockId: 'b1', startOffset: 1, endOffset: 3 }], expected: ['range'] },
  { segments: [{ blockId: 'b2', startOffset: 0, endOffset: 2 }], expected: ['range'] },
  { segments: [{ blockId: 'b2', startOffset: 2, endOffset: 3 }], expected: [] },
  { segments: [{ blockId: 'b3', startOffset: 0, endOffset: 3 }], expected: [] }
];
for (const fixture of rangePages) {
  assert.deepStrictEqual(Illustration.activeIllustrationsForPage([ranged], chapter, fixture, { revisionId: 'revision-1' })
    .map((item) => item.illustrationId), fixture.expected, 'range overlap must be nonempty and half-open');
}
assert.deepStrictEqual(Illustration.activeIllustrationsForPage([ranged], chapter, {
  segments: [{ blockId: 'b1', startOffset: 0, endOffset: 3 }, { blockId: 'b2', startOffset: 0, endOffset: 3 }]
}, { revisionId: 'revision-2' }), [], 'old revision ranges must not bind to a new revision with reused block IDs');
assert.deepStrictEqual(Illustration.activeIllustrationsForPage([ranged], chapter, rangePages[1]), [], 'revision-bearing images require an explicit matching revision');

const laterRange = Illustration.createReaderIllustration({
  ...base, illustrationId: 'later', blockId: 'b2', revisionId: 'revision-1',
  range: { start: { blockId: 'b2', offset: 0 }, end: { blockId: 'b3', offset: 1 } }
});
const secondUpload = Illustration.createReaderIllustration({
  ...ranged, illustrationId: 'second-upload', createdAt: '2026-08-08T00:00:00.000Z'
});
assert.deepStrictEqual(Illustration.activeIllustrationsForPage([laterRange, ranged, secondUpload], chapter, {
  segments: [{ blockId: 'b2', startOffset: 0, endOffset: 2 }]
}, { revisionId: 'revision-1' }).map((item) => item.illustrationId), ['range', 'second-upload', 'later'],
'overlapping groups sort by content position while equal ranges retain upload order instead of timestamp order');

for (const invalidRange of [null, [], {}, { start: {}, end: {} },
  { start: { blockId: 'b1', offset: -1 }, end: { blockId: 'b1', offset: 2 } },
  { start: { blockId: 'b1', offset: 0.5 }, end: { blockId: 'b1', offset: 2 } },
  { start: { blockId: 'b1', offset: '0' }, end: { blockId: 'b1', offset: 2 } },
  { start: { blockId: 'b1', offset: 0 }, end: { blockId: 'b1', offset: Infinity } },
  { start: { blockId: 'b1', offset: 2 }, end: { blockId: 'b1', offset: 1 } },
  { start: { blockId: 'b1', offset: 2 }, end: { blockId: 'b1', offset: 2 } }
]) {
  assert.throws(() => Illustration.createReaderIllustration({ ...base, illustrationId: 'invalid', blockId: 'b1', range: invalidRange }), /range/i,
    'malformed, fractional, reversed or empty same-block ranges must be rejected');
}
for (const invalidRange of [
  { start: { blockId: 'b3', offset: 0 }, end: { blockId: 'b1', offset: 1 } },
  { start: { blockId: 'missing', offset: 0 }, end: { blockId: 'b2', offset: 1 } },
  { start: { blockId: 'b1', offset: 0 }, end: { blockId: 'b2', offset: 4 } }
]) {
  const invalid = Illustration.createReaderIllustration({ ...base, illustrationId: 'invalid-chapter', blockId: 'b1', range: invalidRange });
  assert.deepStrictEqual(Illustration.activeIllustrationsForPage([invalid], chapter, {
    segments: [{ blockId: 'b1', startOffset: 0, endOffset: 3 }, { blockId: 'b2', startOffset: 0, endOffset: 3 }]
  }), [], 'reversed cross-block, missing or out-of-bounds chapter ranges must not match');
}

console.log('Reader illustration tests passed.');
