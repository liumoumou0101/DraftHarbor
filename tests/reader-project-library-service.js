const assert = require('assert');
const crypto = require('crypto');
const { createReaderProjectLibraryService } = require('../desktop/services/reader-project-library-service');

const project = {
  id: 'project-1',
  title: '项目小说',
  updatedAt: '2026-08-04T08:00:00.000Z',
  chapters: [{ id: 'chapter-1', title: '第一章', order: 0 }],
  scenes: [{ id: 'scene-1', chapterId: 'chapter-1', title: '开端', order: 0, content: '第一段正文。' }]
};
const projectService = {
  async listProjects() { return { projects: [{ id: project.id, title: project.title, updatedAt: project.updatedAt, chapterCount: 1, wordCount: 6 }] }; },
  async openProject() { return { ok: true, project }; }
};
const service = createReaderProjectLibraryService({
  projectService,
  digest(value) { return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`; }
});

(async () => {
  const documents = await service.listDocuments('unused');
  assert.strictEqual(documents[0].documentId, 'project:project-1');
  const metadata = await service.readMetadata('unused', 'project-1');
  assert.strictEqual(metadata.sourceKind, 'project');
  assert.strictEqual(metadata.activeRevisionId.length > 0, true);
  const contents = await service.readContents('unused', 'project-1');
  assert.strictEqual(contents.chapters.length, 1);
  const chapter = await service.readChapter('unused', 'project-1', contents.revisionId, contents.chapters[0].chapterId);
  assert.strictEqual(chapter.chapter.blocks[1].text, '第一段正文。');
  await assert.rejects(() => service.readMetadata('unused', '../escape'), /invalid/);
  console.log('Reader project library service tests passed.');
})().catch((error) => { console.error(error); process.exit(1); });
