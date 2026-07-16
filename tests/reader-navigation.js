const assert = require('assert');
const navigation = require('../src/core/document/reader-navigation');

const chapterOne = {
  chapterId: 'chapter-1',
  blocks: [
    { blockId: 'b1', order: 0, text: 'Harbor light and harbor wind.' },
    { blockId: 'b2', order: 1, text: 'A quiet LIGHT remained.' }
  ]
};
const chapterTwo = {
  chapterId: 'chapter-2',
  blocks: [
    { blockId: 'b3', order: 0, text: 'Final shore.' }
  ]
};
const contents = [
  { chapterId: 'chapter-1', characterCount: 60 },
  { chapterId: 'chapter-2', characterCount: 40 }
];

const matches = navigation.findLiteralMatches(chapterOne, 'light');
assert.strictEqual(matches.length, 2, 'literal search should be case-insensitive by default');
assert.deepStrictEqual(
  matches.map((match) => [match.blockId, match.offset]),
  [['b1', 7], ['b2', 8]],
  'literal search should return stable block and UTF-16 offsets'
);
assert.strictEqual(navigation.findLiteralMatches(chapterOne, 'LIGHT', { caseSensitive: true }).length, 1);
assert.strictEqual(navigation.findLiteralMatches(chapterOne, '').length, 0);

assert.deepStrictEqual(navigation.chapterTargetForBookRatio(contents, 0), { chapterId: 'chapter-1', chapterRatio: 0 });
assert.deepStrictEqual(navigation.chapterTargetForBookRatio(contents, 0.6), { chapterId: 'chapter-1', chapterRatio: 1 });
assert.deepStrictEqual(navigation.chapterTargetForBookRatio(contents, 1), { chapterId: 'chapter-2', chapterRatio: 1 });
assert.deepStrictEqual(navigation.blockPositionForChapterRatio(chapterTwo, 1), { blockId: 'b3', offset: 12 });

assert.strictEqual(
  navigation.contentProgressForLocator(contents, chapterOne, { blockId: 'b1', offset: 0 }),
  0,
  'book progress must begin at zero'
);
assert.strictEqual(
  navigation.contentProgressForLocator(contents, chapterTwo, { blockId: 'b3', offset: 12 }),
  1,
  'book progress must end at one'
);

const millionCharacterChapter = {
  chapterId: 'million',
  blocks: Array.from({ length: 1000 }, (_, index) => ({
    blockId: `million-${index}`,
    order: index,
    text: `${'海港长风'.repeat(248)} marker-${index}`
  }))
};
const startedAt = Date.now();
const boundedMatches = navigation.findLiteralMatches(millionCharacterChapter, 'marker-', { limit: 500 });
const elapsed = Date.now() - startedAt;
assert.strictEqual(boundedMatches.length, 500, 'million-character search should enforce the result budget');
assert.ok(elapsed < 1500, `million-character literal search should stay within 1.5s (actual ${elapsed}ms)`);

console.log('Reader navigation tests passed.');
