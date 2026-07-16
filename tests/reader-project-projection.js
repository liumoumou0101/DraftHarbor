const assert = require('assert');
const crypto = require('crypto');

const ReaderLocator = require('../src/core/document/reader-locator');
const {
    blocksFromScene,
    projectToReaderDocument,
    projectToReaderDocumentV2
} = require('../src/core/document/reader-document');

function digest(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

const timestamp = '2026-07-15T08:00:00.000Z';
const crlfContent = '  第一段😀\r\n续行  \r\n \r\n 第二段 ';
const sourceBlocks = blocksFromScene({ id: 'scene-crlf', title: '场景标题', content: crlfContent });
assert.strictEqual(sourceBlocks.length, 3);
assert.strictEqual(sourceBlocks[0].type, 'scene-title');
assert.strictEqual(sourceBlocks[0].sourceSceneId, 'scene-crlf');
assert.strictEqual(sourceBlocks[0].sourceStart, undefined);
assert.strictEqual(sourceBlocks[1].text, '第一段😀\n续行');
assert.strictEqual(sourceBlocks[2].text, '第二段');
for (const block of sourceBlocks.filter((item) => item.type === 'paragraph')) {
    assert.strictEqual(
        crlfContent.slice(block.sourceStart, block.sourceEnd).replace(/\r\n?/g, '\n'),
        block.text
    );
}
assert.strictEqual(sourceBlocks[1].sourceEnd - sourceBlocks[1].sourceStart, '第一段😀\r\n续行'.length);

const project = {
    id: 'reader-project',
    title: '投影测试',
    createdAt: timestamp,
    updatedAt: timestamp,
    chapters: [
        { id: 'chapter-2', title: '第二章', order: 2 },
        { id: 'chapter-1', title: '第一章', order: 1 }
    ],
    scenes: [
        { id: 'scene-2', chapterId: 'chapter-2', title: '后场', order: 0, content: '后场正文。' },
        { id: 'scene-1b', chapterId: 'chapter-1', title: '次场', order: 2, content: '相同段落。\n\n相同段落。' },
        { id: 'scene-1a', chapterId: 'chapter-1', title: '首场', order: 1, content: crlfContent }
    ]
};
const originalProject = JSON.stringify(project);
const document = projectToReaderDocumentV2(project, { digest });
assert.strictEqual(document.documentId, 'project:reader-project');
assert.strictEqual(document.sourceKind, 'project');
assert.strictEqual(document.format, 'project');
assert.strictEqual(document.projectId, 'reader-project');
assert.strictEqual(document.importedAt, timestamp);
assert.deepStrictEqual(document.revisions.map((item) => item.revisionId), [document.activeRevisionId]);
assert.strictEqual(document.revisions[0].lineEnding, 'mixed');
assert.deepStrictEqual(document.revisions[0].chapters.map((chapter) => chapter.chapterId), ['chapter-1', 'chapter-2']);
assert.deepStrictEqual(
    document.revisions[0].chapters[0].blocks.filter((block) => block.type === 'scene-title').map((block) => block.text),
    ['首场', '次场']
);
const duplicates = document.revisions[0].chapters[0].blocks.filter((block) => block.text === '相同段落。');
assert.strictEqual(duplicates.length, 2);
assert.notStrictEqual(duplicates[0].blockId, duplicates[1].blockId);
assert.ok(duplicates[0].textDigest);
assert.strictEqual(JSON.stringify(project), originalProject, 'projection must not mutate the project or its timestamps');

const rebuilt = projectToReaderDocumentV2(project, { digest });
assert.deepStrictEqual(rebuilt, document, 'a deleted projection cache must be reproducible from project data');

const stableBefore = projectToReaderDocumentV2({
    id: 'stable-project',
    title: '稳定块',
    updatedAt: timestamp,
    chapters: [{ id: 'chapter', title: '章节', order: 0 }],
    scenes: [{ id: 'scene', chapterId: 'chapter', title: '场景', order: 0, content: '保留段落。' }]
}, { digest });
const oldRevision = stableBefore.revisions[0];
const oldBlock = oldRevision.chapters[0].blocks.find((block) => block.type === 'paragraph');
const oldLocator = ReaderLocator.locatorFromBlockPosition({
    documentId: stableBefore.documentId,
    projectId: 'stable-project',
    chapterId: 'chapter',
    blockId: oldBlock.blockId,
    offset: 0
}, oldRevision, { exact: '保留' });

const stableAfter = projectToReaderDocumentV2({
    id: 'stable-project',
    title: '稳定块',
    updatedAt: '2026-07-15T09:00:00.000Z',
    chapters: [{ id: 'chapter', title: '章节', order: 0 }],
    scenes: [{ id: 'scene', chapterId: 'chapter', title: '场景', order: 0, content: '新增段落。\n\n保留段落。' }]
}, { digest });
const newRevision = stableAfter.revisions[0];
const newBlock = newRevision.chapters[0].blocks.find((block) => block.text === '保留段落。');
assert.strictEqual(newBlock.blockId, oldBlock.blockId, 'inserting another paragraph must not rename an unchanged block');
assert.notStrictEqual(newRevision.revisionId, oldRevision.revisionId);
const recovered = ReaderLocator.resolveReaderLocator(oldLocator, newRevision);
assert.strictEqual(recovered.resolution, 'approximate');
assert.strictEqual(recovered.reason, 'unique-text-anchor');
assert.strictEqual(recovered.block.blockId, newBlock.blockId);

const unrelatedSceneChange = projectToReaderDocumentV2({
    id: 'reader-project',
    title: '投影测试',
    updatedAt: '2026-07-15T10:00:00.000Z',
    chapters: project.chapters,
    scenes: project.scenes.map((scene) => scene.id === 'scene-2' ? { ...scene, content: '另一场已经修改。' } : scene)
}, { digest });
const crlfBlock = document.revisions[0].chapters[0].blocks.find((block) => block.text === '第一段😀\n续行');
const crlfLocator = ReaderLocator.locatorFromBlockPosition({
    documentId: document.documentId,
    projectId: project.id,
    chapterId: 'chapter-1',
    blockId: crlfBlock.blockId,
    offset: 3
}, document.revisions[0]);
const unchangedRecovery = ReaderLocator.resolveReaderLocator(crlfLocator, unrelatedSceneChange.revisions[0]);
assert.strictEqual(unchangedRecovery.resolution, 'exact');
assert.strictEqual(unchangedRecovery.reason, 'project-scene-offset');
assert.strictEqual(unchangedRecovery.block.blockId, crlfBlock.blockId);

const historical = projectToReaderDocumentV2({
    id: 'historical-project',
    title: '历史项目',
    createdAt: timestamp,
    chapters: [],
    scenes: [{ id: 'orphan-scene', chapterId: 'missing', title: '旧场景', order: 3, content: '历史正文。' }]
}, { digest });
assert.strictEqual(historical.revisions[0].chapters.length, 1);
assert.strictEqual(historical.revisions[0].chapters[0].chapterId, 'project:historical-project:synthetic:scenes');
assert.strictEqual(historical.revisions[0].chapters[0].sourceChapterId, '');
assert.strictEqual(historical.revisions[0].chapters[0].blocks[1].sourceSceneId, 'orphan-scene');

const emptyHistorical = projectToReaderDocumentV2({ id: 'empty-history', title: '空项目' }, { digest });
assert.strictEqual(emptyHistorical.revisions[0].chapters.length, 1);
assert.strictEqual(emptyHistorical.revisions[0].chapters[0].blocks.length, 0);

const legacy = projectToReaderDocument(project);
assert.strictEqual(legacy.title, project.title);
assert.strictEqual(legacy.chapters[0].paragraphs[0].type, 'scene-title');
assert.strictEqual(legacy.chapters[0].paragraphs[1].sourceSceneId, 'scene-1a');
assert.ok(legacy.text.includes('# 第一章'));

console.log('Reader project projection tests passed.');
