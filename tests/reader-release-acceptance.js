const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const workflowGuidedService = require('../desktop/services/workflow-guided-service');
const workflowRewriteGuidedService = require('../desktop/services/workflow-rewrite-guided-service');
const transferStore = require('../desktop/storage/reader-transfer-store');
const readerStore = require('../desktop/storage/reader-document-store');
const { createReaderLibraryService } = require('../desktop/services/reader-library-service');
const { createReaderTransferService } = require('../desktop/services/reader-transfer-service');
const { createReaderWriterTransferService } = require('../desktop/services/reader-writer-transfer-service');
const { createReaderCompendiumTransferService } = require('../desktop/services/reader-compendium-transfer-service');
const { createReaderWorkflowTransferService } = require('../desktop/services/reader-workflow-transfer-service');

const SOURCE_KINDS = ['project', 'txt', 'markdown', 'paste'];
const DESTINATIONS = ['writer', 'compendium', 'workflow'];
const STRESS_ENVELOPES = 120;

async function allFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  }));
  return nested.flat();
}

function sourceRequest(source, envelopeId, destination) {
  if (source.kind === 'project') {
    return {
      envelopeId, destination, documentId: `project:${source.projectId}`,
      projectId: source.projectId, scope: 'scene', sceneId: source.sceneId
    };
  }
  return { envelopeId, destination, documentId: source.documentId, revisionId: source.revisionId, scope: 'document' };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-release-'));
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-release-source-'));
  const secretSentinel = 'sk-release-acceptance-secret-must-not-persist';
  const previousSentinel = process.env.DRAFTHARBOR_ACCEPTANCE_API_KEY;
  process.env.DRAFTHARBOR_ACCEPTANCE_API_KEY = secretSentinel;
  try {
    const libraryService = createReaderLibraryService();
    const readerTransferService = createReaderTransferService({ transferStore, readerStore });
    const backups = [];
    const createBackup = async (_, projectId, note, reason) => {
      backups.push({ projectId, note, reason, snapshot: structuredClone((await projectService.openProject(dataRoot, projectId)).project) });
      return { backup: { backupId: `reader-release-backup-${backups.length}` } };
    };
    const writerService = createReaderWriterTransferService({ readerTransferService, projectService, createBackup });
    const extractor = {
      extractChunk: async (_, input) => [{
        type: 'note', title: `验收卡-${input.envelope.envelopeId}`,
        summary: `来自 ${input.sourceTitle} 的确定性验收证据`, tags: ['F-10.4D']
      }]
    };
    const compendiumTransferService = createReaderCompendiumTransferService({
      readerTransferService, compendiumService, projectService, extractor, createBackup
    });
    const workflowTransferService = createReaderWorkflowTransferService({
      readerTransferService, projectService, workflowGuidedService, workflowRewriteGuidedService
    });

    const sourceProject = (await projectService.createProject(dataRoot, { id: 'reader-release-source-project', title: '项目来源' })).project;
    sourceProject.scenes[0].title = '项目验收场景';
    sourceProject.scenes[0].content = '项目来源正文：林岚在旧港钟楼记录潮汐。';
    sourceProject.updatedAt = '2026-07-16T16:00:00.000Z';
    sourceProject.scenes[0].updatedAt = sourceProject.updatedAt;
    await projectService.saveProject(dataRoot, sourceProject);

    const fileSources = [
      { kind: 'txt', file: 'reader-release.txt', format: 'txt', text: 'TXT 来源正文：远航船于午夜离港。' },
      { kind: 'markdown', file: 'reader-release.md', format: 'md', text: '# Markdown 章节\n\nMarkdown 来源正文：灯塔守望者发出信号。' }
    ];
    const sources = [{ kind: 'project', projectId: sourceProject.id, sceneId: sourceProject.scenes[0].id }];
    for (const item of fileSources) {
      const filePath = path.join(sourceRoot, item.file);
      await fs.writeFile(filePath, item.text, 'utf8');
      const draft = await libraryService.previewFileImport({ draftId: `draft-${item.kind}`, filePath, format: item.format, title: `${item.kind} 来源` });
      const confirmed = await libraryService.confirmImportDraft(dataRoot, draft.draftId, {
        documentId: `reader-release-${item.kind}`, revisionId: `reader-release-${item.kind}-r1`
      });
      sources.push({ kind: item.kind, documentId: confirmed.documentId, revisionId: confirmed.revisionId });
    }
    const pastedDraft = libraryService.previewPastedImport({
      draftId: 'draft-paste', format: 'plain', title: '粘贴来源', text: '粘贴来源正文：失踪的航海日志重新出现。'
    });
    const pasted = await libraryService.confirmImportDraft(dataRoot, pastedDraft.draftId, {
      documentId: 'reader-release-paste', revisionId: 'reader-release-paste-r1'
    });
    sources.push({ kind: 'paste', documentId: pasted.documentId, revisionId: pasted.revisionId });
    assert.deepStrictEqual(sources.map((source) => source.kind), SOURCE_KINDS);

    const target = (await projectService.createProject(dataRoot, { id: 'reader-release-target', title: '综合验收目标' })).project;
    const matrix = [];
    for (const source of sources) {
      for (const destination of DESTINATIONS) {
        const envelopeId = `release-${source.kind}-${destination}`;
        const transfer = await readerTransferService.createTransferFromRange(dataRoot, sourceRequest(source, envelopeId, destination));
        assert.strictEqual(transfer.envelope.destination, destination);
        assert.ok(transfer.text.length > 0);

        if (destination === 'writer') {
          const request = {
            envelopeId, applicationId: `application-${source.kind}`, intent: 'new-scenes',
            targetProjectId: target.id, targetChapterId: target.chapters[0].id
          };
          const preview = await writerService.preview(dataRoot, request);
          await assert.rejects(() => writerService.apply(dataRoot, { ...request, confirmed: false }), /explicit confirmation/);
          const applied = await writerService.apply(dataRoot, {
            ...request, confirmed: true, expectedTargetUpdatedAt: preview.targetProject.updatedAt,
            selectedItemIds: preview.items.map((item) => item.itemId)
          });
          const retry = await writerService.apply(dataRoot, { ...request, confirmed: true, expectedTargetUpdatedAt: preview.targetProject.updatedAt });
          assert.strictEqual(applied.idempotent, false);
          assert.strictEqual(retry.idempotent, true);
        } else if (destination === 'compendium') {
          const batchId = `batch-${source.kind}`;
          const extracted = await compendiumTransferService.extract(dataRoot, { envelopeId, projectId: target.id, batchId });
          const decisions = extracted.batch.candidates.map((candidate) => ({ candidateId: candidate.candidateId, decision: 'approved' }));
          await compendiumTransferService.review(dataRoot, { projectId: target.id, batchId, decisions });
          await assert.rejects(() => compendiumTransferService.apply(dataRoot, { projectId: target.id, batchId, confirmed: false }), /explicit confirmation/);
          const applied = await compendiumTransferService.apply(dataRoot, { projectId: target.id, batchId, confirmed: true });
          const retry = await compendiumTransferService.apply(dataRoot, { projectId: target.id, batchId, confirmed: true });
          assert.strictEqual(applied.idempotent, false);
          assert.strictEqual(retry.idempotent, true);
        } else {
          const request = { envelopeId, projectId: target.id, templateId: 'continuation-guided' };
          const preview = await workflowTransferService.preview(dataRoot, request);
          assert.strictEqual(preview.artifactType, source.kind === 'project' ? 'writer-source@1' : 'reader-source@1');
          await assert.rejects(() => workflowTransferService.apply(dataRoot, { ...request, confirmed: false }), /explicit confirmation/);
          const applied = await workflowTransferService.apply(dataRoot, {
            ...request, confirmed: true, expectedProjectUpdatedAt: preview.targetProject.updatedAt,
            brief: `F-10.4D ${source.kind} 来源验收`
          });
          const retry = await workflowTransferService.apply(dataRoot, { ...request, confirmed: true, expectedProjectUpdatedAt: preview.targetProject.updatedAt });
          assert.strictEqual(applied.idempotent, false);
          assert.strictEqual(retry.idempotent, true);
        }
        const consumed = await readerTransferService.readTransfer(dataRoot, envelopeId);
        assert.strictEqual(consumed.envelope.lifecycle, 'consumed');
        matrix.push({ source: source.kind, destination, status: 'passed' });
      }
    }
    assert.strictEqual(matrix.length, SOURCE_KINDS.length * DESTINATIONS.length);

    const stressStarted = performance.now();
    for (let index = 0; index < STRESS_ENVELOPES; index += 1) {
      const source = sources[index % sources.length];
      await readerTransferService.createTransferFromRange(dataRoot, sourceRequest(source, `stress-envelope-${index}`, 'writer'));
    }
    for (let index = 0; index < STRESS_ENVELOPES; index += 2) {
      await readerTransferService.materializeConsumer(dataRoot, `stress-envelope-${index}`, {
        consumerId: `stress-consumer-${index}`, destination: 'writer', referenceId: `stress-reference-${index}`
      });
      await readerTransferService.materializeConsumer(dataRoot, `stress-envelope-${index}`, {
        consumerId: `stress-consumer-${index}`, destination: 'writer', referenceId: `stress-reference-${index}`
      });
    }
    const listed = await readerTransferService.listTransfers(dataRoot);
    const stressRecords = listed.transfers.filter((item) => item.envelopeId.startsWith('stress-envelope-'));
    assert.strictEqual(stressRecords.length, STRESS_ENVELOPES);
    assert.strictEqual(stressRecords.filter((item) => item.lifecycle === 'consumed').length, STRESS_ENVELOPES / 2);
    assert.ok(stressRecords.every((item) => !Object.hasOwn(item, 'text') && !Object.hasOwn(item, 'snapshot')));

    assert.strictEqual(await readerTransferService.readTransfer(dataRoot, '../../outside'), null, 'path traversal id must not resolve a transfer');
    const files = await allFiles(dataRoot);
    for (const file of files) {
      const bytes = await fs.readFile(file);
      const text = bytes.toString('utf8');
      assert.ok(!text.includes(secretSentinel), `environment API key leaked into ${path.relative(dataRoot, file)}`);
      assert.ok(!text.includes(sourceRoot), `absolute import path leaked into ${path.relative(dataRoot, file)}`);
    }

    const result = {
      matrix, matrixPassed: matrix.length, stressEnvelopes: STRESS_ENVELOPES,
      stressConsumed: STRESS_ENVELOPES / 2,
      stressDurationMs: Math.round((performance.now() - stressStarted) * 100) / 100,
      filesScanned: files.length, backupsCreated: backups.length
    };
    console.log(`READER_RELEASE_RESULT=${JSON.stringify(result)}`);
    console.log('Reader release acceptance passed.');
  } finally {
    if (previousSentinel === undefined) delete process.env.DRAFTHARBOR_ACCEPTANCE_API_KEY;
    else process.env.DRAFTHARBOR_ACCEPTANCE_API_KEY = previousSentinel;
    await fs.rm(dataRoot, { recursive: true, force: true });
    await fs.rm(sourceRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader release acceptance failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
