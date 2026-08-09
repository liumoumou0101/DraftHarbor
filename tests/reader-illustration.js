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
}).map((item) => item.illustrationId), ['i2', 'i3'], 'images sharing the latest trigger must form one gallery');
assert.deepStrictEqual(Illustration.activeIllustrationsForPage(illustrations, chapter, {
  segments: [{ blockId: 'b3', blockIndex: 2, endOffset: 3 }]
}).map((item) => item.illustrationId), ['i2', 'i3'], 'latest illustration group must persist until the next trigger');
assert.deepStrictEqual(Illustration.activeIllustrationsForPage(illustrations, { ...chapter, chapterId: 'chapter-2' }, {
  segments: [{ blockId: 'b3', blockIndex: 2, endOffset: 3 }]
}), [], 'illustrations must not leak across chapters');

const splitAnchor = Illustration.createReaderIllustration({
  ...base, illustrationId: 'split', blockId: 'b2', offset: 2, fileName: 'split.png'
});
assert.deepStrictEqual(Illustration.activeIllustrationsForPage([illustrations[0], splitAnchor], chapter, {
  segments: [{ blockId: 'b2', blockIndex: 1, startOffset: 0, endOffset: 2 }]
}).map((item) => item.illustrationId), ['i1'], 'an anchor at the exclusive page end must wait for the following page');
assert.deepStrictEqual(Illustration.activeIllustrationsForPage([illustrations[0], splitAnchor], chapter, {
  segments: [{ blockId: 'b2', blockIndex: 1, startOffset: 2, endOffset: 3 }]
}).map((item) => item.illustrationId), ['split'], 'an anchor must trigger when its text first appears');

console.log('Reader illustration tests passed.');
