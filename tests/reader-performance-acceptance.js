const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const readerStore = require('../desktop/storage/reader-document-store');
const paths = require('../desktop/storage/library-paths');
const { createReaderLibraryService } = require('../desktop/services/reader-library-service');
const { createReaderTransferService } = require('../desktop/services/reader-transfer-service');
const readerLayout = require('../src/core/document/reader-layout');
const readerNavigation = require('../src/core/document/reader-navigation');

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function millionCharacterFixture() {
  const lines = [];
  for (let chapter = 1; chapter <= 100; chapter += 1) {
    lines.push(`# 第${chapter}章 平衡夹具`, '');
    for (let block = 1; block <= 10; block += 1) {
      lines.push(`段落${chapter}-${block}：${'海'.repeat(990)}`, '');
    }
  }
  return lines.join('\n');
}

function millionCharacterChapter() {
  const blocks = [];
  for (let chapter = 1; chapter <= 100; chapter += 1) {
    for (let block = 1; block <= 10; block += 1) {
      blocks.push({
        blockId: `block-${chapter}-${block}`,
        order: blocks.length,
        type: 'paragraph',
        text: `段落${chapter}-${block}：${'海'.repeat(990)}`
      });
    }
  }
  return { chapterId: 'million-character-navigation', blocks };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-performance-'));
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-performance-source-'));
  try {
    const fixture = millionCharacterFixture();
    assert.ok(fixture.length >= 1000000 && fixture.length < 1100000, `fixture must remain near one million UTF-16 units: ${fixture.length}`);
    const fixturePath = path.join(sourceRoot, 'reader-million-balanced.md');
    await fs.writeFile(fixturePath, fixture, 'utf8');
    const service = createReaderLibraryService();
    const transferService = createReaderTransferService();
    const previewMs = [];
    const commitMs = [];
    const snapshotWriteMs = [];
    const snapshotReadMs = [];
    const chapterReadMs = [];
    const fullTextSearchMs = [];
    const paginationMs = [];
    const heapStart = process.memoryUsage().heapUsed;
    let heapPeak = heapStart;

    for (let iteration = 0; iteration < 6; iteration += 1) {
      const draftId = `reader-performance-draft-${iteration}`;
      const previewStarted = performance.now();
      const draft = await service.previewFileImport({
        draftId,
        filePath: fixturePath,
        createdAt: `2026-07-15T0${iteration + 1}:00:00.000Z`
      });
      const previewDuration = performance.now() - previewStarted;
      assert.strictEqual(draft.chapters.length, 100);
      assert.ok(draft.characterCount >= 990000);

      const documentId = `reader-million-${iteration}`;
      const revisionId = `reader-million-r${iteration}`;
      const commitStarted = performance.now();
      await service.confirmImportDraft(dataRoot, draftId, {
        documentId,
        revisionId,
        createdAt: `2026-07-15T1${iteration}:00:00.000Z`
      });
      const commitDuration = performance.now() - commitStarted;

      const snapshotStarted = performance.now();
      await transferService.createTransferFromRange(dataRoot, {
        envelopeId: `reader-million-envelope-${iteration}`,
        destination: 'writer', documentId, revisionId, scope: 'document',
        createdAt: `2026-07-15T20:0${iteration}:00.000Z`
      });
      const snapshotDuration = performance.now() - snapshotStarted;
      const snapshotReadStarted = performance.now();
      const snapshot = await transferService.readTransfer(dataRoot, `reader-million-envelope-${iteration}`);
      const snapshotReadDuration = performance.now() - snapshotReadStarted;
      assert.ok(snapshot.text.length >= 990000, `snapshot must retain the million-character document: ${snapshot.text.length}`);
      assert.strictEqual(snapshot.envelope.lifecycle, 'active');

      const chapterStarted = performance.now();
      const chapter = await readerStore.readReaderDocumentChapter(dataRoot, documentId, revisionId, 'chapter-50');
      const chapterDuration = performance.now() - chapterStarted;
      assert.strictEqual(chapter.chapter.blocks.length, 10);
      assert.ok(chapter.chapter.blocks[0].text.includes('段落50-1'));

      if (iteration > 0) {
        previewMs.push(previewDuration);
        commitMs.push(commitDuration);
        snapshotWriteMs.push(snapshotDuration);
        snapshotReadMs.push(snapshotReadDuration);
        chapterReadMs.push(chapterDuration);
      }
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }

    const navigationChapter = millionCharacterChapter();
    const pageCapacity = readerLayout.estimatePageCapacity({
      pageWidth: 720,
      pageHeight: 720,
      fontSize: 18,
      lineHeight: 1.8,
      pageMargin: 48
    });
    let paginationPageCount = 0;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const searchStarted = performance.now();
      const matches = readerNavigation.findLiteralMatches(navigationChapter, '段落100-10', { limit: 10 });
      const searchDuration = performance.now() - searchStarted;
      assert.strictEqual(matches.length, 1, 'million-character literal search must find the final block exactly once');

      const paginationStarted = performance.now();
      const pages = readerLayout.buildReaderPages(navigationChapter, { capacity: pageCapacity });
      const paginationDuration = performance.now() - paginationStarted;
      assert.ok(pages.length > 100, 'million-character pagination must create a realistic temporary page set');
      paginationPageCount = pages.length;
      if (iteration > 0) {
        fullTextSearchMs.push(searchDuration);
        paginationMs.push(paginationDuration);
      }
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }

    const indexText = await fs.readFile(paths.readerDocumentsIndexPath(dataRoot), 'utf8');
    const metadataText = await fs.readFile(paths.readerDocumentMetadataPath(dataRoot, 'reader-million-5'), 'utf8');
    const revisionMetadataText = await fs.readFile(
      paths.readerDocumentRevisionMetadataPath(dataRoot, 'reader-million-5', 'reader-million-r5'),
      'utf8'
    );
    assert.ok(!indexText.includes('段落50-1'));
    assert.ok(!metadataText.includes('段落50-1'));
    assert.ok(!revisionMetadataText.includes('段落50-1'));

    const result = {
      fixtureUtf16Characters: fixture.length,
      chapters: 100,
      blocks: 1000,
      samples: 5,
      previewMedianMs: round(percentile(previewMs, 0.5)),
      previewP95Ms: round(percentile(previewMs, 0.95)),
      commitMedianMs: round(percentile(commitMs, 0.5)),
      commitP95Ms: round(percentile(commitMs, 0.95)),
      snapshotWriteMedianMs: round(percentile(snapshotWriteMs, 0.5)),
      snapshotWriteP95Ms: round(percentile(snapshotWriteMs, 0.95)),
      snapshotReadMedianMs: round(percentile(snapshotReadMs, 0.5)),
      snapshotReadP95Ms: round(percentile(snapshotReadMs, 0.95)),
      chapterReadMedianMs: round(percentile(chapterReadMs, 0.5)),
      chapterReadP95Ms: round(percentile(chapterReadMs, 0.95)),
      fullTextSearchMedianMs: round(percentile(fullTextSearchMs, 0.5)),
      fullTextSearchP95Ms: round(percentile(fullTextSearchMs, 0.95)),
      paginationMedianMs: round(percentile(paginationMs, 0.5)),
      paginationP95Ms: round(percentile(paginationMs, 0.95)),
      paginationPageCount,
      observedHeapGrowthMiB: round(Math.max(0, heapPeak - heapStart) / 1024 / 1024),
      node: process.version,
      platform: `${process.platform}-${process.arch}`
    };
    const budgets = {
      previewP95Ms: 8000,
      commitP95Ms: 7000,
      snapshotWriteP95Ms: 7000,
      snapshotReadP95Ms: 1200,
      chapterReadP95Ms: 1200,
      fullTextSearchP95Ms: 1500,
      paginationP95Ms: 1500,
      observedHeapGrowthMiB: 300
    };
    console.log(`READER_PERF_RESULT=${JSON.stringify(result)}`);
    console.log(`READER_PERF_BUDGETS=${JSON.stringify(budgets)}`);
    assert.ok(result.previewP95Ms <= budgets.previewP95Ms, `preview p95 exceeded budget: ${JSON.stringify({ actual: result.previewP95Ms, budget: budgets.previewP95Ms, result })}`);
    assert.ok(result.commitP95Ms <= budgets.commitP95Ms, `commit p95 exceeded budget: ${JSON.stringify({ actual: result.commitP95Ms, budget: budgets.commitP95Ms, result })}`);
    assert.ok(result.snapshotWriteP95Ms <= budgets.snapshotWriteP95Ms, `snapshot write p95 exceeded budget: ${JSON.stringify({ actual: result.snapshotWriteP95Ms, budget: budgets.snapshotWriteP95Ms, result })}`);
    assert.ok(result.snapshotReadP95Ms <= budgets.snapshotReadP95Ms, `snapshot read p95 exceeded budget: ${JSON.stringify({ actual: result.snapshotReadP95Ms, budget: budgets.snapshotReadP95Ms, result })}`);
    assert.ok(result.chapterReadP95Ms <= budgets.chapterReadP95Ms, `chapter read p95 exceeded budget: ${JSON.stringify({ actual: result.chapterReadP95Ms, budget: budgets.chapterReadP95Ms, result })}`);
    assert.ok(result.fullTextSearchP95Ms <= budgets.fullTextSearchP95Ms, `full-text search p95 exceeded budget: ${JSON.stringify({ actual: result.fullTextSearchP95Ms, budget: budgets.fullTextSearchP95Ms, result })}`);
    assert.ok(result.paginationP95Ms <= budgets.paginationP95Ms, `pagination p95 exceeded budget: ${JSON.stringify({ actual: result.paginationP95Ms, budget: budgets.paginationP95Ms, result })}`);
    assert.ok(result.observedHeapGrowthMiB <= budgets.observedHeapGrowthMiB, `observed heap growth exceeded budget: ${JSON.stringify({ actual: result.observedHeapGrowthMiB, budget: budgets.observedHeapGrowthMiB, result })}`);
    console.log('Reader performance acceptance passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
    await fs.rm(sourceRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader performance acceptance failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
