const assert = require('assert');

const Selection = require('../src/core/document/reader-selection');

const revision = {
  revisionId: 'revision-1',
  chapters: [{
    chapterId: 'chapter-1', title: '第一章', sourceChapterId: 'source-chapter-1', blocks: [
      { blockId: 'block-1', type: 'paragraph', text: '甲😀乙', order: 0, sourceSceneId: 'scene-1', sourceStart: 0, sourceEnd: 4 },
      { blockId: 'block-2', type: 'paragraph', text: '第二段', order: 1, sourceSceneId: 'scene-1', sourceStart: 4, sourceEnd: 7 }
    ]
  }, {
    chapterId: 'chapter-2', title: 'Second', sourceChapterId: 'source-chapter-2', blocks: [
      { blockId: 'block-3', type: 'paragraph', text: 'English paragraph.', order: 0, sourceSceneId: 'scene-2', sourceStart: 0, sourceEnd: 18 }
    ]
  }]
};
const base = { documentId: 'project:one', projectId: 'one' };
const locator = (chapterId, blockId, offset) => ({ documentId: 'project:one', revisionId: 'revision-1', chapterId, blockId, offset });

const emoji = Selection.buildReaderTransferSelection(revision, {
  ...base,
  scope: 'selection',
  range: { start: locator('chapter-1', 'block-1', 2), end: locator('chapter-1', 'block-1', 2) }
});
assert.strictEqual(emoji.text, '😀', 'selection offsets inside a surrogate pair should snap to the full grapheme');
assert.strictEqual(emoji.sourceLocators[0].offset, 1);
assert.strictEqual(emoji.sourceLocators[1].offset, 3);

const reverse = Selection.buildReaderTransferSelection(revision, {
  ...base,
  scope: 'selection',
  range: { start: locator('chapter-1', 'block-2', 2), end: locator('chapter-1', 'block-1', 1) }
});
assert.strictEqual(reverse.text, '😀乙\n\n第二', 'reverse ranges should normalize to document order');
assert.strictEqual(reverse.sourceLocators[0].blockId, 'block-1');
assert.strictEqual(reverse.sourceLocators[1].blockId, 'block-2');

const scene = Selection.buildReaderTransferSelection(revision, { ...base, scope: 'scene', sceneId: 'scene-1' });
assert.strictEqual(scene.text, '甲😀乙\n\n第二段');
assert.deepStrictEqual(scene.sceneIds, ['scene-1']);

const chapters = Selection.buildReaderTransferSelection(revision, {
  ...base, scope: 'chapters', chapterIds: ['chapter-2', 'chapter-1']
});
assert.deepStrictEqual(chapters.chapterIds, ['chapter-1', 'chapter-2'], 'chapter snapshots should use authoritative document order');
assert.ok(chapters.text.includes('# 第一章'));
assert.ok(chapters.text.includes('# Second'));
assert.strictEqual(chapters.sections.length, 2);

const documentSelection = Selection.buildReaderTransferSelection(revision, { ...base, scope: 'document' });
assert.strictEqual(documentSelection.sections.length, 2);
assert.ok(documentSelection.characterCount > scene.characterCount);

assert.throws(() => Selection.buildReaderTransferSelection(revision, {
  ...base, scope: 'selection', range: { start: locator('chapter-1', 'block-1', 0), end: locator('chapter-1', 'block-1', 0) }
}), /empty/);
assert.throws(() => Selection.buildReaderTransferSelection(revision, { ...base, scope: 'scene', sceneId: 'missing' }), /not found/);
assert.throws(() => Selection.buildReaderTransferSelection(revision, { ...base, scope: 'chapters', chapterIds: [] }), /requires chapterIds/);

console.log('Reader selection tests passed.');
