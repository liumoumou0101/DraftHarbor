const assert = require('assert');

const { createProject, createChapter, createScene } = require('../src/core/project/project-schema');
const { normalizeProject } = require('../src/core/project/project-normalize');
const { projectStats, countWords } = require('../src/core/project/project-stats');
const { reindexProjectOrder } = require('../src/core/document/scene-ordering');
const { buildManuscript } = require('../src/core/document/manuscript-builder');
const { projectToReaderDocument } = require('../src/core/document/reader-document');
const { WORKFLOW_STATUSES, createPlaceholderWorkflowRun } = require('../src/core/workflow/workflow-schema');

const emptyProject = createProject({
    id: 'empty-project',
    title: 'Empty Project',
    createdAt: '2026-06-26T00:00:00.000Z'
});
assert.strictEqual(emptyProject.schemaVersion, 1);
assert.strictEqual(emptyProject.chapters.length, 1);
assert.strictEqual(emptyProject.scenes.length, 1);
assert.strictEqual(emptyProject.chapterOrder[0], emptyProject.chapters[0].id);
assert.strictEqual(emptyProject.sceneOrder[0], emptyProject.scenes[0].id);
assert.strictEqual(emptyProject.currentSceneId, emptyProject.scenes[0].id);

const normalizedEmpty = normalizeProject({ project: { id: 'p-empty', name: 'No Content' } });
assert.strictEqual(normalizedEmpty.title, 'No Content');
assert.strictEqual(normalizedEmpty.chapters.length, 1);
assert.strictEqual(normalizedEmpty.scenes.length, 1);

const normalized = normalizeProject({
    project: {
        id: 'p1',
        name: 'Test Novel',
        tags: ['fantasy', 'fantasy', '  ensemble  '],
        created: '2026-06-26T00:00:00.000Z'
    },
    chapters: [
        { id: 'c2', title: 'Chapter Two', order: 2 },
        { id: 'c1', title: 'Chapter One', order: 1 }
    ],
    scenes: [
        { id: 's2', chapterId: 'c1', title: 'Rain Night', order: 2 },
        { id: 's1', chapterId: 'c1', title: 'Opening', order: 1, content: 'Hello world' },
        { id: 's3', chapterId: 'missing', title: 'Fallback Chapter', order: 3 }
    ],
    sceneContents: {
        s2: '\u5979\u8d70\u8fdb\u96e8\u91cc\u3002\n\n\u8857\u706f\u4eae\u7740\u3002'
    }
});

assert.strictEqual(normalized.id, 'p1');
assert.strictEqual(normalized.title, 'Test Novel');
assert.deepStrictEqual(normalized.tags, ['fantasy', 'ensemble']);
assert.deepStrictEqual(normalized.chapterOrder, ['c1', 'c2']);
assert.deepStrictEqual(normalized.sceneOrder, ['s1', 's2', 's3']);
assert.strictEqual(normalized.scenes[2].chapterId, 'c1');
assert.strictEqual(normalized.scenes[1].content, '\u5979\u8d70\u8fdb\u96e8\u91cc\u3002\n\n\u8857\u706f\u4eae\u7740\u3002');

assert.strictEqual(countWords('Hello world'), 2);
assert.strictEqual(countWords('\u5979\u8d70\u8fdb\u96e8\u91cc'), 5);
assert.deepStrictEqual(projectStats(normalized), {
    chapterCount: 2,
    sceneCount: 3,
    wordCount: 11
});

const manuscript = buildManuscript(normalized);
assert.ok(manuscript.includes('# Chapter One'));
assert.ok(manuscript.includes('## Opening'));
assert.ok(manuscript.includes('\u5979\u8d70\u8fdb\u96e8\u91cc\u3002'));

const readerDoc = projectToReaderDocument(normalized);
assert.strictEqual(readerDoc.title, 'Test Novel');
assert.strictEqual(readerDoc.chapters.length, 2);
assert.strictEqual(readerDoc.chapters[0].paragraphs[0].type, 'scene-title');
assert.ok(readerDoc.text.includes('# Chapter One'));

const chapterA = createChapter({ id: 'a', title: 'A', order: 10 });
const chapterB = createChapter({ id: 'b', title: 'B', order: 0 });
const sceneA2 = createScene({ id: 'a2', chapterId: 'a', title: 'A2', order: 2 });
const sceneA1 = createScene({ id: 'a1', chapterId: 'a', title: 'A1', order: 1 });
const sceneB1 = createScene({ id: 'b1', chapterId: 'b', title: 'B1', order: 5 });
const reindexed = reindexProjectOrder({
    id: 'order-test',
    chapters: [chapterA, chapterB],
    scenes: [sceneA2, sceneB1, sceneA1]
});
assert.deepStrictEqual(reindexed.chapterOrder, ['b', 'a']);
assert.deepStrictEqual(reindexed.sceneOrder, ['b1', 'a1', 'a2']);
assert.deepStrictEqual(reindexed.chapters.find((chapter) => chapter.id === 'a').sceneIds, ['a1', 'a2']);

assert.ok(WORKFLOW_STATUSES.includes('waiting_user'));
const workflow = createPlaceholderWorkflowRun({ projectId: 'p1' });
assert.strictEqual(workflow.projectId, 'p1');
assert.strictEqual(workflow.status, 'pending');
assert.deepStrictEqual(workflow.steps, []);

console.log('Core project tests passed.');
