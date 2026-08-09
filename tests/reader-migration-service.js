const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const readerStore = require('../desktop/storage/reader-document-store');
const stateStore = require('../desktop/storage/reader-state-store');
const paths = require('../desktop/storage/library-paths');
const { createReaderMigrationService } = require('../desktop/services/reader-migration-service');

async function tempRoot(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), `draftharbor-${label}-`));
}

function legacyProject(projectId) {
  return {
    document: {
      source: 'project',
      projectId,
      title: '迁移项目',
      chapters: [{ id: 'chapter-1', title: '第一章', content: '旧缓存不应成为权威正文。' }]
    },
    chapterIndex: 0,
    scrollPositions: { [`project:${projectId}:chapter-1`]: 0.75 },
    fontSize: 22,
    lineHeight: 2,
    paragraphSpacing: 1.3,
    fontFamily: 'yahei',
    theme: 'paper',
    indent: false
  };
}

function legacyExternal() {
  return {
    document: {
      title: '旧外部小说',
      fileName: 'old-book.txt',
      chapters: [
        { id: 'old-1', title: '旧第一章', content: '第一段。\n\n第二段。' },
        { id: 'old-2', title: '旧第二章', content: '结尾正文。' }
      ]
    },
    chapterIndex: 1,
    scrollPositions: { 'file:old-book.txt:old-2': 0.5 },
    theme: 'sepia'
  };
}

(async () => {
  const roots = [];
  try {
    const emptyRoot = await tempRoot('reader-migration-empty'); roots.push(emptyRoot);
    const emptyService = createReaderMigrationService({ clock: () => '2026-07-15T08:00:00.000Z' });
    const noData = await emptyService.migrateLegacyReaderState(emptyRoot, null);
    assert.strictEqual(noData.status, 'complete');
    assert.strictEqual(noData.reason, 'no-data');
    assert.strictEqual(noData.canClearLegacyState, true);

    const retryRoot = await tempRoot('reader-migration-retry'); roots.push(retryRoot);
    const retryService = createReaderMigrationService({ clock: () => '2026-07-15T08:05:00.000Z' });
    const malformed = await retryService.migrateLegacyReaderState(retryRoot, '{bad json');
    assert.strictEqual(malformed.status, 'failed');
    assert.strictEqual(malformed.canClearLegacyState, false);
    const retried = await retryService.migrateLegacyReaderState(retryRoot, { theme: 'paper', fontSize: 20 });
    assert.strictEqual(retried.status, 'complete');
    assert.strictEqual(retried.reason, 'preferences-only');

    const projectRoot = await tempRoot('reader-migration-project'); roots.push(projectRoot);
    const created = await projectService.createProject(projectRoot, { id: 'migration-project', title: '迁移项目' });
    await projectService.saveProject(projectRoot, {
      ...created.project,
      scenes: [{ ...created.project.scenes[0], content: '项目 Store 中的真正正文。\n\n第二段。' }]
    });
    const projectMigration = createReaderMigrationService({ clock: () => '2026-07-15T09:00:00.000Z' });
    const projectResult = await projectMigration.migrateLegacyReaderState(projectRoot, legacyProject('migration-project'));
    assert.strictEqual(projectResult.status, 'complete');
    assert.strictEqual(projectResult.reason, 'project-state-migrated');
    assert.strictEqual(projectResult.documentId, 'project:migration-project');
    assert.strictEqual(projectResult.canClearLegacyState, true);
    assert.ok(projectResult.state.positionLocator);
    assert.strictEqual(projectResult.state.preferenceOverrides.migrationResolution, 'approximate');
    const preferences = await stateStore.readReaderGlobalPreferences(projectRoot);
    assert.strictEqual(preferences.preferences.layoutMode, 'double-page');
    assert.strictEqual(preferences.preferences.themeId, 'paper');
    assert.strictEqual(preferences.preferences.fontFamilyId, 'sans-serif');
    assert.strictEqual(preferences.preferences.indent, false);
    assert.strictEqual((await readerStore.listReaderDocuments(projectRoot)).documents.length, 0, 'project migration must not copy project prose into Reader Store');
    const projectAgain = await projectMigration.migrateLegacyReaderState(projectRoot, legacyProject('migration-project'));
    assert.strictEqual(projectAgain.alreadyMigrated, true);
    assert.strictEqual(projectAgain.revisionId, projectResult.revisionId);

    const abandonRoot = await tempRoot('reader-migration-abandon'); roots.push(abandonRoot);
    const abandonService = createReaderMigrationService({ clock: () => '2026-07-15T10:00:00.000Z' });
    const pending = await abandonService.migrateLegacyReaderState(abandonRoot, legacyExternal());
    assert.strictEqual(pending.status, 'pending-external');
    assert.strictEqual(pending.canClearLegacyState, false);
    assert.strictEqual((await readerStore.listReaderDocuments(abandonRoot)).documents.length, 0);
    const abandoned = await abandonService.migrateLegacyReaderState(abandonRoot, legacyExternal(), { externalAction: 'abandon' });
    assert.strictEqual(abandoned.status, 'complete');
    assert.strictEqual(abandoned.reason, 'external-abandoned');
    assert.strictEqual(abandoned.canClearLegacyState, true);

    const externalRoot = await tempRoot('reader-migration-external'); roots.push(externalRoot);
    const externalService = createReaderMigrationService({ clock: () => '2026-07-15T11:00:00.000Z' });
    const imported = await externalService.migrateLegacyReaderState(externalRoot, legacyExternal(), { externalAction: 'confirm' });
    assert.strictEqual(imported.status, 'complete');
    assert.strictEqual(imported.reason, 'external-imported');
    assert.strictEqual(imported.canClearLegacyState, true);
    const reopened = await readerStore.readReaderDocument(externalRoot, imported.documentId);
    assert.strictEqual(reopened.revision.chapters[0].title, '旧第一章');
    assert.ok(reopened.revision.chapters[0].blocks.some((block) => block.text === '第二段。'));
    const markerText = await fs.readFile(paths.readerMigrationPath(externalRoot), 'utf8');
    assert.ok(!markerText.includes('第一段。'), 'migration marker must not copy legacy prose');
    await fs.rm(paths.readerMigrationPath(externalRoot));
    const crashRetry = await externalService.migrateLegacyReaderState(externalRoot, legacyExternal(), { externalAction: 'confirm' });
    assert.strictEqual(crashRetry.documentId, imported.documentId);
    assert.strictEqual((await readerStore.readReaderDocumentMetadata(externalRoot, imported.documentId)).revisions.length, 1);

    const failureRoot = await tempRoot('reader-migration-failure'); roots.push(failureRoot);
    const failingStateStore = {
      ...stateStore,
      writeReaderGlobalPreferences: async () => { throw new Error('simulated preference disk failure'); }
    };
    const failingService = createReaderMigrationService({
      stateStore: failingStateStore,
      clock: () => '2026-07-15T12:00:00.000Z'
    });
    const failed = await failingService.migrateLegacyReaderState(failureRoot, { theme: 'paper' });
    assert.strictEqual(failed.status, 'failed');
    assert.strictEqual(failed.canClearLegacyState, false);
    const recoveredService = createReaderMigrationService({ clock: () => '2026-07-15T12:05:00.000Z' });
    const recovered = await recoveredService.migrateLegacyReaderState(failureRoot, { theme: 'paper' });
    assert.strictEqual(recovered.status, 'complete');

    console.log('Reader migration service tests passed.');
  } finally {
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  }
})().catch((error) => {
  console.error('Reader migration service tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
