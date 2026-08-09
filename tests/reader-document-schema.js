const assert = require('assert');
const crypto = require('crypto');

const ReaderSchema = require('../src/core/document/reader-document-schema');

function digest(value) {
    return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

const createdAt = '2026-07-15T08:00:00.000Z';
const revisionOne = ReaderSchema.createReaderDocumentRevision({
    schemaVersion: 1,
    revisionId: 'revision-1',
    createdAt,
    encoding: 'utf-8',
    chapters: [{
        chapterId: 'chapter-1',
        title: '第一章',
        blocks: [
            { blockId: 'block-1', type: 'paragraph', text: '第一段。\r\n第二行。', order: 0 },
            {
                blockId: 'block-2',
                type: 'paragraph',
                text: '场景正文',
                order: 1,
                sourceSceneId: 'scene-1',
                sourceStart: 4,
                sourceEnd: 8
            }
        ]
    }]
}, { digest });

assert.strictEqual(revisionOne.schemaVersion, 1);
assert.strictEqual(revisionOne.chapters[0].blocks[0].text, '第一段。\n第二行。');
assert.ok(revisionOne.contentDigest.startsWith('sha256:'));
assert.ok(revisionOne.structureDigest.startsWith('sha256:'));
assert.ok(revisionOne.chapters[0].blocks[0].textDigest.startsWith('sha256:'));
assert.strictEqual(Object.isFrozen(revisionOne), true, 'reader revisions should be immutable values');
assert.strictEqual(Object.isFrozen(revisionOne.chapters[0].blocks[0]), true, 'nested revision values should be immutable');

const sameContentDifferentLineEnding = ReaderSchema.createReaderDocumentRevision({
    schemaVersion: 1,
    revisionId: 'revision-line-ending',
    createdAt,
    encoding: 'utf-8',
    chapters: [{
        chapterId: 'chapter-1',
        title: '第一章',
        blocks: [
            { blockId: 'block-1', type: 'paragraph', text: '第一段。\n第二行。', order: 0 },
            {
                blockId: 'block-2',
                type: 'paragraph',
                text: '场景正文',
                order: 1,
                sourceSceneId: 'scene-1',
                sourceStart: 4,
                sourceEnd: 8
            }
        ]
    }]
}, { digest });
assert.strictEqual(sameContentDifferentLineEnding.contentDigest, revisionOne.contentDigest, 'normalized line endings should produce a stable digest');

const documentOne = ReaderSchema.createReaderDocument({
    schemaVersion: 2,
    documentId: 'external-book-1',
    sourceKind: 'local-text',
    format: 'txt',
    title: '外部书籍',
    originalFileName: 'book.txt',
    importedAt: createdAt,
    updatedAt: createdAt,
    activeRevisionId: revisionOne.revisionId,
    revisions: [revisionOne]
}, { digest });

const revisionTwo = ReaderSchema.createReaderDocumentRevision({
    schemaVersion: 1,
    revisionId: 'revision-2',
    parentRevisionId: 'revision-1',
    createdAt: '2026-07-15T09:00:00.000Z',
    encoding: 'utf-8',
    chapters: [{
        chapterId: 'chapter-1',
        title: '第一章（修订）',
        blocks: [{ blockId: 'block-1', type: 'paragraph', text: '修订正文。', order: 0 }]
    }]
}, { digest });

const documentTwo = ReaderSchema.appendReaderDocumentRevision(documentOne, revisionTwo, { digest });
assert.strictEqual(documentOne.revisions.length, 1, 'appending a revision must not mutate the original document');
assert.strictEqual(documentOne.activeRevisionId, 'revision-1');
assert.strictEqual(documentTwo.revisions.length, 2);
assert.strictEqual(documentTwo.activeRevisionId, 'revision-2');
assert.throws(
    () => ReaderSchema.appendReaderDocumentRevision(documentTwo, revisionTwo, { digest }),
    /already exists/,
    'a formal revision must not be overwritten in place'
);
assert.throws(() => ReaderSchema.createReaderDocumentRevision({
    schemaVersion: 1,
    revisionId: 'tampered-revision',
    createdAt,
    contentDigest: 'sha256:not-the-content',
    chapters: [{
        chapterId: 'chapter-1',
        title: '第一章',
        blocks: [{ blockId: 'block-1', type: 'paragraph', text: '正文', order: 0 }]
    }]
}, { digest }), /digest does not match normalized content/, 'provided digests must be verified when a digest function is available');

const renamed = ReaderSchema.updateReaderDocumentMetadata(documentTwo, {
    title: '新书名',
    updatedAt: '2026-07-15T10:00:00.000Z'
}, { digest });
assert.strictEqual(renamed.title, '新书名');
assert.strictEqual(renamed.revisions.length, 2, 'metadata changes should not create a content revision');
assert.strictEqual(renamed.activeRevisionId, 'revision-2');

const projectDocument = ReaderSchema.createReaderDocument({
    schemaVersion: 2,
    documentId: 'project:project-1',
    projectId: 'project-1',
    sourceKind: 'project',
    format: 'project',
    title: '当前项目',
    importedAt: createdAt,
    updatedAt: createdAt,
    activeRevisionId: revisionOne.revisionId,
    revisions: [revisionOne]
}, { digest });
assert.strictEqual(projectDocument.documentId, 'project:project-1');

assert.throws(() => ReaderSchema.createReaderDocument({
    schemaVersion: 2,
    documentId: 'wrong-id',
    projectId: 'project-1',
    sourceKind: 'project',
    format: 'project',
    importedAt: createdAt,
    updatedAt: createdAt
}), /project:<projectId>/);
assert.throws(() => ReaderSchema.createReaderDocument({
    schemaVersion: 3,
    documentId: 'book',
    sourceKind: 'local-text',
    format: 'txt',
    importedAt: createdAt,
    updatedAt: createdAt
}), /schemaVersion must be 2/);
assert.throws(() => ReaderSchema.createReaderDocument({
    schemaVersion: 2,
    documentId: 'book',
    sourceKind: 'remote-url',
    format: 'txt',
    importedAt: createdAt,
    updatedAt: createdAt
}), /sourceKind is not supported/);
assert.throws(() => ReaderSchema.createReaderDocument({
    schemaVersion: 2,
    documentId: 'book',
    sourceKind: 'local-text',
    format: 'pdf',
    importedAt: createdAt,
    updatedAt: createdAt
}), /format is not supported/);
assert.throws(() => ReaderSchema.createReaderBlock({
    blockId: 'bad-block',
    type: 'html',
    text: '<script>alert(1)</script>'
}), /block type is not supported/);
assert.throws(() => ReaderSchema.createReaderBlock({
    blockId: 'bad-range',
    type: 'paragraph',
    text: '正文',
    sourceStart: 1,
    sourceEnd: 2
}), /sourceSceneId is required/);

const preferences = ReaderSchema.createReaderGlobalPreferences({
    layoutMode: 'double-page',
    pageTransition: 'none',
    themeId: 'paper',
    fontFamilyId: 'serif',
    fontSize: 22,
    reducedMotionOverride: true
});
assert.strictEqual(ReaderSchema.createReaderGlobalPreferences({}).layoutMode, 'double-page');
assert.strictEqual(preferences.layoutMode, 'double-page');
assert.strictEqual(preferences.fontFamilyId, 'serif');
assert.strictEqual(preferences.reducedMotionOverride, true);
assert.strictEqual(preferences.textWidth, 760);
assert.throws(() => ReaderSchema.createReaderGlobalPreferences({ layoutMode: 'magazine' }), /layoutMode is not supported/);

const state = ReaderSchema.createReaderDocumentState({
    documentId: 'external-book-1',
    updatedAt: createdAt,
    positionLocator: { chapterId: 'chapter-1', blockId: 'block-1', offset: 2 },
    preferenceOverrides: { fontFamilyId: 'serif' },
    bookmarks: [{
        bookmarkId: 'bookmark-1',
        title: '开头',
        excerpt: '第一段',
        locator: { chapterId: 'chapter-1', blockId: 'block-1', offset: 0 },
        createdAt
    }]
});
assert.strictEqual(state.bookmarks.length, 1);
assert.strictEqual(state.positionLocator.offset, 2);
assert.strictEqual(state.bookmarks[0].color, 'yellow');
assert.strictEqual(state.bookmarks[0].category, '未分类');
assert.strictEqual(state.bookmarks[0].note, '');
assert.strictEqual(state.bookmarks[0].lastVisitedAt, null);
const enrichedBookmark = ReaderSchema.createReaderBookmark({
    bookmarkId: 'bookmark-enriched',
    title: '检查点',
    locator: { chapterId: 'chapter-1', blockId: 'block-1', offset: 3 },
    createdAt,
    color: 'blue',
    category: '重要',
    note: '回看这一段',
    lastVisitedAt: '2026-07-15T11:00:00.000Z'
});
assert.deepStrictEqual(
    { color: enrichedBookmark.color, category: enrichedBookmark.category, note: enrichedBookmark.note, lastVisitedAt: enrichedBookmark.lastVisitedAt },
    { color: 'blue', category: '重要', note: '回看这一段', lastVisitedAt: '2026-07-15T11:00:00.000Z' }
);
assert.throws(() => ReaderSchema.createReaderBookmark({ bookmarkId: 'bad-color', locator: {}, createdAt, color: 'purple' }), /color is not supported/);
assert.throws(() => ReaderSchema.createReaderDocumentState({
    documentId: 'external-book-1',
    updatedAt: createdAt,
    bookmarks: [
        { bookmarkId: 'same', locator: {}, createdAt },
        { bookmarkId: 'same', locator: {}, createdAt }
    ]
}), /duplicate reader bookmark id/);

console.log('Reader document schema tests passed.');
