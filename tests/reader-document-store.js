const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const ReaderSchema = require('../src/core/document/reader-document-schema');
const projectStore = require('../desktop/storage/project-file-store');
const paths = require('../desktop/storage/library-paths');
const readerStore = require('../desktop/storage/reader-document-store');

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function makeRevision(revisionId, createdAt, text, parentRevisionId = '') {
  return ReaderSchema.createReaderDocumentRevision({
    schemaVersion: 1,
    revisionId,
    parentRevisionId,
    createdAt,
    encoding: 'utf-8',
    parserVersion: 'reader-store-test@1',
    chapters: [{
      chapterId: 'chapter-1',
      title: '第一章',
      blocks: [{ blockId: 'block-1', type: 'paragraph', text, order: 0 }]
    }, {
      chapterId: 'chapter-2',
      title: '第二章',
      blocks: [{ blockId: 'block-2', type: 'paragraph', text: '第二章短文。', order: 0 }]
    }]
  }, { digest });
}

async function treeDigest(root) {
  const records = [];
  async function visit(directory, relative = '') {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const nextRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(absolute, nextRelative);
      else records.push(`${nextRelative}:${crypto.createHash('sha256').update(await fs.readFile(absolute)).digest('hex')}`);
    }
  }
  await visit(root);
  return digest(records.join('\n'));
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-store-'));
  const concurrencyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-store-concurrency-'));

  try {
    const readerRoot = path.resolve(paths.readerDocumentsDir(dataRoot));
    const traversalPath = path.resolve(paths.readerDocumentDir(dataRoot, '../../outside'));
    assert.ok(traversalPath.startsWith(`${readerRoot}${path.sep}`), 'reader document ids must not escape the library root');
    assert.notStrictEqual(
      paths.readerDocumentDir(dataRoot, 'same:name'),
      paths.readerDocumentDir(dataRoot, 'same?name'),
      'sanitized ids must retain collision-resistant path identities'
    );

    const firstText = `第一版唯一正文-${'长内容。'.repeat(100)}`;
    const revisionOne = makeRevision('revision-1', '2026-07-15T08:00:00.000Z', firstText);
    const document = ReaderSchema.createReaderDocument({
      schemaVersion: 2,
      documentId: 'reader-book-1',
      sourceKind: 'local-text',
      format: 'txt',
      title: 'Reader Store 测试书',
      originalFileName: 'book.txt',
      importedAt: '2026-07-15T08:00:00.000Z',
      updatedAt: '2026-07-15T08:00:00.000Z',
      activeRevisionId: 'revision-1',
      revisions: [revisionOne]
    }, { digest });

    const created = await readerStore.createReaderDocument(dataRoot, document, { expectedIndexVersion: 0 });
    assert.strictEqual(created.index.version, 1);
    assert.strictEqual(created.metadata.activeRevisionId, 'revision-1');
    assert.strictEqual(created.metadata.revisions.length, 1);

    const listed = await readerStore.listReaderDocuments(dataRoot);
    assert.strictEqual(listed.documents.length, 1);
    assert.strictEqual(listed.documents[0].revisionCount, 1);
    const indexText = await fs.readFile(paths.readerDocumentsIndexPath(dataRoot), 'utf8');
    const documentMetadataText = await fs.readFile(paths.readerDocumentMetadataPath(dataRoot, 'reader-book-1'), 'utf8');
    const revisionMetadataText = await fs.readFile(
      paths.readerDocumentRevisionMetadataPath(dataRoot, 'reader-book-1', 'revision-1'),
      'utf8'
    );
    assert.ok(!indexText.includes(firstText.slice(0, 30)), 'reader index must not contain chapter text');
    assert.ok(!documentMetadataText.includes(firstText.slice(0, 30)), 'document metadata must not contain chapter text');
    assert.ok(!revisionMetadataText.includes(firstText.slice(0, 30)), 'revision metadata must not contain chapter text');

    const reopened = await readerStore.readReaderDocument(dataRoot, 'reader-book-1');
    assert.strictEqual(reopened.revision.revisionId, 'revision-1');
    assert.strictEqual(reopened.revision.chapters[0].blocks[0].text, firstText);
    assert.strictEqual(reopened.recovery, null);
    const singleChapter = await readerStore.readReaderDocumentChapter(dataRoot, 'reader-book-1', 'revision-1', 'chapter-2');
    assert.strictEqual(singleChapter.revision.revisionId, 'revision-1');
    assert.strictEqual(singleChapter.chapter.chapterId, 'chapter-2');
    assert.strictEqual(singleChapter.chapter.blocks[0].text, '第二章短文。');
    assert.strictEqual(await readerStore.readReaderDocumentChapter(dataRoot, 'reader-book-1', 'revision-1', 'missing'), null);

    const revisionTwo = makeRevision('revision-2', '2026-07-15T09:00:00.000Z', '第二版正文。', 'revision-1');
    const appended = await readerStore.appendReaderDocumentRevision(dataRoot, 'reader-book-1', revisionTwo, {
      expectedUpdatedAt: '2026-07-15T08:00:00.000Z',
      expectedIndexVersion: 1
    });
    assert.strictEqual(appended.metadata.activeRevisionId, 'revision-2');
    assert.strictEqual(appended.metadata.revisions.length, 2);
    assert.strictEqual(appended.index.version, 2);

    await assert.rejects(
      () => readerStore.appendReaderDocumentRevision(dataRoot, 'reader-book-1', revisionTwo),
      /immutable and already exists/
    );
    await assert.rejects(
      () => readerStore.appendReaderDocumentRevision(
        dataRoot,
        'reader-book-1',
        makeRevision('revision-stale', '2026-07-15T09:30:00.000Z', '不应写入。', 'revision-2'),
        { expectedUpdatedAt: '2026-07-15T08:00:00.000Z' }
      ),
      (error) => error instanceof readerStore.ReaderStoreConflictError
    );
    await assert.rejects(
      () => readerStore.appendReaderDocumentRevision(
        dataRoot,
        'reader-book-1',
        makeRevision('revision-stale-index', '2026-07-15T09:30:00.000Z', '不应写入。', 'revision-2'),
        { expectedUpdatedAt: '2026-07-15T09:00:00.000Z', expectedIndexVersion: 1 }
      ),
      (error) => error instanceof readerStore.ReaderStoreConflictError
    );
    await assert.rejects(() => fs.access(
      paths.readerDocumentRevisionMetadataPath(dataRoot, 'reader-book-1', 'revision-stale-index')
    ));

    const renamed = await readerStore.updateReaderDocumentMetadata(dataRoot, 'reader-book-1', {
      title: '重命名后的书'
    }, {
      expectedUpdatedAt: '2026-07-15T09:00:00.000Z',
      expectedIndexVersion: 2,
      updatedAt: '2026-07-15T10:00:00.000Z'
    });
    assert.strictEqual(renamed.metadata.title, '重命名后的书');
    assert.strictEqual(renamed.metadata.revisions.length, 2, 'metadata updates must not create content revisions');
    assert.strictEqual(renamed.index.version, 3);

    const activeChapterPath = paths.readerDocumentRevisionChapterPath(dataRoot, 'reader-book-1', 'revision-2', 'chapter-1');
    const tamperedChapter = JSON.parse(await fs.readFile(activeChapterPath, 'utf8'));
    tamperedChapter.blocks[0].text = '被篡改的正文';
    await fs.writeFile(activeChapterPath, JSON.stringify(tamperedChapter, null, 2), 'utf8');
    const recovered = await readerStore.readReaderDocument(dataRoot, 'reader-book-1');
    assert.strictEqual(recovered.revision.revisionId, 'revision-1', 'a corrupt active revision should fall back to a prior immutable revision');
    assert.strictEqual(recovered.recovery.status, 'recovered');
    assert.strictEqual(recovered.recovery.failedRevisionId, 'revision-2');

    await fs.writeFile(paths.readerDocumentsIndexPath(dataRoot), '{broken index', 'utf8');
    await assert.rejects(() => readerStore.listReaderDocuments(dataRoot));
    const rebuilt = await readerStore.rebuildReaderDocumentIndex(dataRoot, { updatedAt: '2026-07-15T11:00:00.000Z' });
    assert.strictEqual(rebuilt.index.documents.length, 1);
    assert.strictEqual(rebuilt.index.documents[0].title, '重命名后的书');
    assert.strictEqual((await readerStore.listReaderDocuments(dataRoot)).documents.length, 1);

    const orphanRevisionDir = paths.readerDocumentRevisionDir(dataRoot, 'reader-book-1', 'orphan-revision');
    await fs.mkdir(orphanRevisionDir, { recursive: true });
    await fs.writeFile(path.join(orphanRevisionDir, 'revision.json'), JSON.stringify({ revisionId: 'orphan-revision' }), 'utf8');
    const referencedSource = paths.readerDocumentSourceRevisionPath(dataRoot, 'reader-book-1', 'revision-2', 'txt');
    const orphanSource = paths.readerDocumentSourceRevisionPath(dataRoot, 'reader-book-1', 'orphan-revision', 'txt');
    await fs.mkdir(path.dirname(referencedSource), { recursive: true });
    await fs.writeFile(referencedSource, 'referenced', 'utf8');
    await fs.writeFile(orphanSource, 'orphan', 'utf8');
    const atomicTemp = path.join(paths.readerDocumentDir(dataRoot, 'reader-book-1'), `document.json.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(atomicTemp, 'interrupted', 'utf8');
    const incompleteDir = paths.readerDocumentDir(dataRoot, 'incomplete-document');
    await fs.mkdir(incompleteDir, { recursive: true });
    const corruptDir = paths.readerDocumentDir(dataRoot, 'corrupt-document');
    await fs.mkdir(corruptDir, { recursive: true });
    await fs.writeFile(path.join(corruptDir, 'document.json'), '{corrupt', 'utf8');
    const cleanup = await readerStore.cleanupReaderDocumentStore(dataRoot);
    assert.ok(cleanup.removedTempFiles.includes(atomicTemp));
    assert.ok(cleanup.removedOrphanRevisionDirs.includes(path.resolve(orphanRevisionDir)));
    assert.ok(cleanup.removedOrphanSourceFiles.includes(path.resolve(orphanSource)));
    assert.ok(cleanup.removedIncompleteDocumentDirs.includes(path.resolve(incompleteDir)));
    assert.ok(cleanup.corruptDocumentDirs.includes(corruptDir), 'corrupt formal documents should be reported, not deleted');
    await assert.rejects(() => fs.access(orphanRevisionDir));
    await assert.rejects(() => fs.access(orphanSource));
    await fs.access(referencedSource);
    await assert.rejects(() => fs.access(incompleteDir));
    await fs.access(corruptDir);

    const projectRevision = makeRevision('project-revision', '2026-07-15T12:00:00.000Z', '项目投影不应落盘');
    const projectDocument = ReaderSchema.createReaderDocument({
      schemaVersion: 2,
      documentId: 'project:project-reader',
      projectId: 'project-reader',
      sourceKind: 'project',
      format: 'project',
      title: '项目投影',
      importedAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
      activeRevisionId: 'project-revision',
      revisions: [projectRevision]
    }, { digest });
    await assert.rejects(
      () => readerStore.createReaderDocument(dataRoot, projectDocument),
      /project reader documents are derived/
    );

    const readerTreeBeforeProjectSave = await treeDigest(paths.readerDocumentsDir(dataRoot));
    const createdProject = await projectStore.createProject(dataRoot, { id: 'independent-project', title: 'Independent' });
    await projectStore.saveProject(dataRoot, { ...createdProject.project, title: 'Independent Updated' });
    assert.strictEqual(
      await treeDigest(paths.readerDocumentsDir(dataRoot)),
      readerTreeBeforeProjectSave,
      'project-wide save must not overwrite Reader Store data'
    );

    const concurrentDocument = (id, title) => ReaderSchema.createReaderDocument({
      schemaVersion: 2,
      documentId: id,
      sourceKind: 'pasted-text',
      format: 'plain',
      title,
      importedAt: '2026-07-15T08:00:00.000Z',
      updatedAt: '2026-07-15T08:00:00.000Z',
      activeRevisionId: 'revision-1',
      revisions: [makeRevision('revision-1', '2026-07-15T08:00:00.000Z', title)]
    }, { digest });
    const concurrentResults = await Promise.allSettled([
      readerStore.createReaderDocument(concurrencyRoot, concurrentDocument('concurrent-a', 'A'), { expectedIndexVersion: 0 }),
      readerStore.createReaderDocument(concurrencyRoot, concurrentDocument('concurrent-b', 'B'), { expectedIndexVersion: 0 })
    ]);
    assert.strictEqual(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);
    assert.strictEqual(concurrentResults.filter((result) => result.status === 'rejected').length, 1);
    assert.ok(concurrentResults.find((result) => result.status === 'rejected').reason instanceof readerStore.ReaderStoreConflictError);

    console.log('Reader document store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
    await fs.rm(concurrencyRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader document store tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
