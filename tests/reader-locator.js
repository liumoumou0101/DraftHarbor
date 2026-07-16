const assert = require('assert');
const crypto = require('crypto');

const ReaderSchema = require('../src/core/document/reader-document-schema');
const ReaderLocator = require('../src/core/document/reader-locator');

function digest(value) {
    return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function revision(revisionId, chapters) {
    return ReaderSchema.createReaderDocumentRevision({
        schemaVersion: 1,
        revisionId,
        createdAt: '2026-07-15T08:00:00.000Z',
        chapters
    }, { digest });
}

const base = revision('revision-1', [{
    chapterId: 'chapter-1',
    sourceChapterId: 'project-chapter-1',
    title: '第一章',
    blocks: [
        { blockId: 'opening', type: 'paragraph', text: '开场正文', sourceSceneId: 'scene-1', sourceStart: 0, sourceEnd: 4 },
        { blockId: 'repeat-a', type: 'paragraph', text: '重复句' },
        { blockId: 'middle', type: 'paragraph', text: '中段' },
        { blockId: 'repeat-b', type: 'paragraph', text: '重复句' },
        { blockId: 'graphemes', type: 'paragraph', text: 'A😀e\u0301B' }
    ]
}, {
    chapterId: 'chapter-2',
    title: '第二章',
    blocks: [{ blockId: 'ending', type: 'paragraph', text: '结尾' }]
}]);

const direct = ReaderLocator.locatorFromBlockPosition({
    documentId: 'project:project-1',
    projectId: 'project-1',
    chapterId: 'chapter-1',
    blockId: 'opening',
    offset: 2
}, base, { exact: '正文' });
assert.strictEqual(direct.projectRef.sceneId, 'scene-1');
assert.strictEqual(direct.projectRef.sceneOffset, 2);
assert.ok(direct.blockDigest.startsWith('sha256:'));

const directResolved = ReaderLocator.resolveReaderLocator(direct, base);
assert.strictEqual(directResolved.resolution, 'exact');
assert.strictEqual(directResolved.reason, 'same-revision-block');
assert.strictEqual(directResolved.locator.offset, 2);

const sameProjectText = revision('revision-2', [{
    chapterId: 'chapter-renamed',
    sourceChapterId: 'project-chapter-1',
    title: '第一章',
    blocks: [{ blockId: 'opening-new-id', type: 'paragraph', text: '开场正文', sourceSceneId: 'scene-1', sourceStart: 0, sourceEnd: 4 }]
}]);
const projectResolved = ReaderLocator.resolveReaderLocator(direct, sameProjectText);
assert.strictEqual(projectResolved.resolution, 'exact');
assert.strictEqual(projectResolved.reason, 'project-scene-offset');
assert.strictEqual(projectResolved.locator.blockId, 'opening-new-id');
assert.strictEqual(projectResolved.locator.chapterId, 'chapter-renamed', 'project scene mapping should survive a Reader chapter id change');

const projectWithoutQuote = ReaderLocator.createReaderLocator({
    documentId: 'project:project-1',
    revisionId: 'old-project-revision',
    chapterId: 'chapter-1',
    projectRef: { projectId: 'project-1', sceneId: 'scene-1', sceneOffset: 2 },
    offset: 2
});
const unverifiedProject = ReaderLocator.resolveReaderLocator(projectWithoutQuote, sameProjectText);
assert.strictEqual(unverifiedProject.resolution, 'approximate');
assert.strictEqual(unverifiedProject.reason, 'project-scene-offset-unverified');

const insertedProjectText = revision('revision-3', [{
    chapterId: 'chapter-1',
    sourceChapterId: 'project-chapter-1',
    title: '第一章',
    blocks: [{ blockId: 'opening-shifted', type: 'paragraph', text: '新增开场正文', sourceSceneId: 'scene-1', sourceStart: 0, sourceEnd: 6 }]
}]);
const shiftedResolved = ReaderLocator.resolveReaderLocator(direct, insertedProjectText);
assert.strictEqual(shiftedResolved.resolution, 'approximate');
assert.strictEqual(shiftedResolved.reason, 'unique-text-anchor');
assert.strictEqual(shiftedResolved.locator.offset, 4, 'the exact selected text should be found after inserted text');

assert.strictEqual(ReaderLocator.snapUtf16Offset('A😀B', 2, 'before'), 1, 'before affinity must not split a surrogate pair');
assert.strictEqual(ReaderLocator.snapUtf16Offset('A😀B', 2, 'after'), 3, 'after affinity must not split a surrogate pair');
assert.strictEqual(ReaderLocator.snapUtf16Offset('e\u0301x', 1, 'before'), 0, 'before affinity must not split a combining grapheme');
assert.strictEqual(ReaderLocator.snapUtf16Offset('e\u0301x', 1, 'after'), 2, 'after affinity must not split a combining grapheme');

const emojiBefore = ReaderLocator.locatorFromBlockPosition({
    documentId: 'external-book',
    chapterId: 'chapter-1',
    blockId: 'graphemes',
    offset: 2,
    affinity: 'before'
}, base);
const emojiAfter = ReaderLocator.locatorFromBlockPosition({
    documentId: 'external-book',
    chapterId: 'chapter-1',
    blockId: 'graphemes',
    offset: 2,
    affinity: 'after'
}, base);
assert.strictEqual(emojiBefore.offset, 1);
assert.strictEqual(emojiAfter.offset, 3);

const repeatedLocator = ReaderLocator.locatorFromBlockPosition({
    documentId: 'external-book',
    chapterId: 'chapter-1',
    blockId: 'repeat-a',
    offset: 0
}, base);
const movedDuplicates = revision('revision-4', [{
    chapterId: 'chapter-1',
    title: '第一章',
    blocks: [
        { blockId: 'other-start', type: 'paragraph', text: '其他' },
        { blockId: 'duplicate-wrong', type: 'paragraph', text: '重复句' },
        { blockId: 'other-middle', type: 'paragraph', text: '别处' },
        { blockId: 'opening-moved', type: 'paragraph', text: '开场正文' },
        { blockId: 'duplicate-right', type: 'paragraph', text: '重复句' },
        { blockId: 'middle-moved', type: 'paragraph', text: '中段' }
    ]
}]);
const digestResolved = ReaderLocator.resolveReaderLocator(repeatedLocator, movedDuplicates);
assert.strictEqual(digestResolved.resolution, 'approximate');
assert.strictEqual(digestResolved.reason, 'block-digest-context');
assert.strictEqual(digestResolved.locator.blockId, 'duplicate-right', 'neighbor digests should disambiguate duplicate text blocks');

const ambiguous = ReaderLocator.createReaderLocator({
    documentId: 'external-book',
    revisionId: 'old-revision',
    chapterId: 'chapter-1',
    blockId: 'missing-block',
    offset: 0,
    quote: { exact: '重复句' }
});
const ambiguousResult = ReaderLocator.resolveReaderLocator(ambiguous, movedDuplicates);
assert.strictEqual(ambiguousResult.resolution, 'unresolved');
assert.strictEqual(ambiguousResult.reason, 'chapter-fallback');
assert.strictEqual(ambiguousResult.locator.blockId, 'other-start');

const range = ReaderLocator.createReaderRange({
    start: ReaderLocator.locatorFromBlockPosition({
        documentId: 'external-book',
        chapterId: 'chapter-1',
        blockId: 'opening',
        offset: 2
    }, base),
    end: ReaderLocator.locatorFromBlockPosition({
        documentId: 'external-book',
        chapterId: 'chapter-1',
        blockId: 'middle',
        offset: 1
    }, base)
});
const extracted = ReaderLocator.extractReaderRangeText(range, base);
assert.strictEqual(extracted.resolution, 'exact');
assert.strictEqual(extracted.text, '正文\n\n重复句\n\n中');

assert.throws(() => ReaderLocator.resolveReaderRange({
    start: range.end,
    end: range.start
}, base), /start must not follow end/);
assert.throws(() => ReaderLocator.createReaderRange({
    start: range.start,
    end: { ...range.end, documentId: 'another-book' }
}), /same document/);

const weighted = revision('weight-revision', [{
    chapterId: 'long',
    title: '长章',
    blocks: [{ blockId: 'long-block', type: 'paragraph', text: '甲 乙 丙 丁' }]
}, {
    chapterId: 'short',
    title: '短章',
    blocks: [{ blockId: 'short-block', type: 'paragraph', text: '终' }]
}]);
assert.strictEqual(ReaderLocator.readerContentWeight(weighted), 5);
const startProgress = ReaderLocator.readerProgressForLocator(ReaderLocator.locatorFromBlockPosition({
    documentId: 'weighted-book', chapterId: 'long', blockId: 'long-block', offset: 0
}, weighted), weighted);
assert.strictEqual(startProgress.progress, 0);
const shortStartProgress = ReaderLocator.readerProgressForLocator(ReaderLocator.locatorFromBlockPosition({
    documentId: 'weighted-book', chapterId: 'short', blockId: 'short-block', offset: 0
}, weighted), weighted);
assert.strictEqual(shortStartProgress.progress, 0.8, 'whole-book progress must weight chapters by readable content');
const endProgress = ReaderLocator.readerProgressForLocator(ReaderLocator.locatorFromBlockPosition({
    documentId: 'weighted-book', chapterId: 'short', blockId: 'short-block', offset: 1
}, weighted), weighted);
assert.strictEqual(endProgress.progress, 1);

assert.throws(() => ReaderLocator.createReaderLocator({
    schemaVersion: 2,
    documentId: 'book',
    revisionId: 'revision',
    chapterId: 'chapter',
    blockId: 'block'
}), /schemaVersion must be 1/);
assert.throws(() => ReaderLocator.createReaderLocator({
    documentId: 'book',
    revisionId: 'revision',
    chapterId: 'chapter',
    blockId: 'block',
    affinity: 'center'
}), /affinity is not supported/);
assert.throws(() => ReaderLocator.createReaderLocator({
    documentId: 'book',
    revisionId: 'revision',
    chapterId: 'chapter',
    blockId: 'block',
    offset: -1
}), /offset must be a non-negative integer/);

console.log('Reader locator tests passed.');
