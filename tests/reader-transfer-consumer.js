/* global readerState */

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectStore = require('../desktop/storage/project-file-store');

async function openTransfer(page, envelopeIds, destination, envelopeId = envelopeIds[destination]) {
  await page.evaluate(({ target, id }) => {
    window.dispatchEvent(new CustomEvent('reader-transfer-created', { detail: { destination: target, envelopeId: id } }));
  }, { target: destination, id: envelopeId });
  await page.waitForFunction((target) => document.getElementById('desktop-root').dataset.view === target, destination);
  await page.waitForFunction((target) => {
    const bar = document.querySelector(`[data-reader-source-bar="${target}"]`);
    return bar && !bar.hidden && bar.querySelector('[data-reader-source-use]').disabled === false;
  }, destination);
}

async function assertConsumed(page, envelopeIds, destination) {
  await page.waitForFunction(async (envelopeId) => {
    const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`, { cache: 'no-store' })).json();
    return payload.transfer.envelope.lifecycle === 'consumed';
  }, envelopeIds[destination]);
  const lifecycle = await page.evaluate(async (envelopeId) => {
    const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`, { cache: 'no-store' })).json();
    return payload.transfer.envelope.lifecycle;
  }, envelopeIds[destination]);
  assert.strictEqual(lifecycle, 'consumed', `${destination} should consume only after its input is materialized`);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-consumer-'));
  let servers;
  let browser;
  try {
    await fs.mkdir(path.join(dataRoot, 'projects'), { recursive: true });
    const createdConsumer = await projectStore.createProject(dataRoot, { id: 'consumer-project', title: 'Envelope Consumer' });
    await projectStore.saveProject(dataRoot, {
      ...createdConsumer.project,
      scenes: createdConsumer.project.scenes.map((scene) => ({ ...scene, content: '项目场景正文。' }))
    });
    const createdSource = await projectStore.createProject(dataRoot, { id: 'source-project', title: 'Source Project' });
    await projectStore.saveProject(dataRoot, {
      ...createdSource.project,
      scenes: [{
        id: 'source-scene', chapterId: createdSource.project.chapters[0].id, title: '来源场', content: 'SOURCE_PROJECT_TRANSFER_SECRET',
        order: 0, createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-16T12:00:00.000Z'
      }],
      sceneOrder: ['source-scene'], currentSceneId: 'source-scene', updatedAt: '2026-07-16T12:00:00.000Z'
    });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-project-continue]');
    const sourceProjectId = 'source-project';
    await page.locator('.desktop-project-card').filter({ hasText: 'Envelope Consumer' }).locator('[data-project-continue]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent === 'Envelope Consumer');

    const envelopeIds = await page.evaluate(async (sourceProjectId) => {
      const sourceText = '# 来源章\n\nTARGET_TRANSFER_SECRET 正文输入。';
      const preview = await (await fetch('/api/reader/import/paste-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: 'consumer-reader-draft', format: 'md', title: '目标来源', text: sourceText })
      })).json();
      await fetch('/api/reader/import/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: preview.draft.draftId, documentId: 'consumer-reader-document', revisionId: 'consumer-reader-r1' })
      });
      const metadata = await (await fetch('/api/reader/document?documentId=consumer-reader-document')).json();
      const contents = await (await fetch('/api/reader/contents?documentId=consumer-reader-document')).json();
      const revision = metadata.metadata.revisions.find((item) => item.revisionId === 'consumer-reader-r1');
      const chapterId = contents.contents.chapters[0].chapterId;
      const ids = {};
      for (const destination of ['writer', 'compendium', 'workflow']) {
        const envelopeId = `consumer-${destination}-envelope`;
        const response = await fetch('/api/reader/transfer/range', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            envelopeId, destination, documentId: 'consumer-reader-document', revisionId: 'consumer-reader-r1',
            sourceRevisionDigest: revision.contentDigest, scope: 'chapter', chapterId
          })
        });
        if (!response.ok) throw new Error(await response.text());
        ids[destination] = envelopeId;
      }
      for (const [key, request] of Object.entries({
        failure: {
          envelopeId: 'consumer-failure-envelope', destination: 'workflow', documentId: 'consumer-reader-document',
          revisionId: 'consumer-reader-r1', sourceRevisionDigest: revision.contentDigest, scope: 'chapter', chapterId
        },
        newProjectUi: {
          envelopeId: 'consumer-new-project-envelope', destination: 'writer', documentId: 'consumer-reader-document',
          revisionId: 'consumer-reader-r1', sourceRevisionDigest: revision.contentDigest, scope: 'chapter', chapterId
        },
        crossProject: {
          envelopeId: 'consumer-cross-project-envelope', destination: 'writer', documentId: `project:${sourceProjectId}`,
          projectId: sourceProjectId, scope: 'document'
        }
      })) {
        const response = await fetch('/api/reader/transfer/range', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
        });
        if (!response.ok) throw new Error(await response.text());
        ids[key] = request.envelopeId;
      }
      ids.sourceProjectId = sourceProjectId;
      return ids;
    }, sourceProjectId);

    await openTransfer(page, envelopeIds, 'writer');
    assert.ok((await page.locator('[data-reader-source-bar="writer"]').innerText()).includes('目标来源'));
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('TARGET_TRANSFER_SECRET'), 'target pointer persistence must contain ids only');
    const writerSceneCountBefore = await page.evaluate(async () => {
      const payload = await (await fetch('/api/get-project?projectId=consumer-project')).json();
      return payload.project.scenes.length;
    });
    await page.click('[data-reader-source-bar="writer"] [data-reader-source-use]');
    await page.waitForFunction(() => document.querySelector('[data-reader-writer-dialog]').open);
    try {
      await page.waitForFunction(() => document.querySelector('[data-reader-writer-status]').textContent.includes('预览完成'), null, { timeout: 5000 });
    } catch {
      throw new Error(`writer preview did not complete: ${await page.locator('[data-reader-writer-status]').textContent()}`);
    }
    assert.strictEqual(await page.evaluate(async () => {
      const payload = await (await fetch('/api/get-project?projectId=consumer-project')).json();
      return payload.project.scenes.length;
    }), writerSceneCountBefore, 'writer preview must not change project disk');
    await page.check('[data-reader-writer-confirm]');
    await page.click('[data-reader-writer-apply]');
    await page.waitForFunction(() => !document.querySelector('[data-reader-writer-dialog]').open);
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('TARGET_TRANSFER_SECRET'));
    await assertConsumed(page, envelopeIds, 'writer');

    await openTransfer(page, envelopeIds, 'compendium');
    await page.click('[data-reader-source-bar="compendium"] [data-reader-source-use]');
    await page.waitForFunction(() => document.querySelector('[data-reader-compendium-dialog]').open);
    const compendiumBeforeSave = await page.evaluate(async () => {
      const payload = await (await fetch('/api/get-project?projectId=consumer-project')).json();
      return payload.project.compendium || [];
    });
    assert.strictEqual(compendiumBeforeSave.length, 0, 'opening extraction review must not write a formal compendium card');
    assert.strictEqual(await page.evaluate(async (envelopeId) => {
      const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`)).json();
      return payload.transfer.envelope.lifecycle;
    }, envelopeIds.compendium), 'active', 'compendium envelope must remain active until the approved batch is saved');
    const reviewBatch = {
      batchId: 'ui-review-batch', envelopeId: envelopeIds.compendium, projectId: 'consumer-project', sourceTitle: '目标来源',
      projectUpdatedAt: createdConsumer.project.updatedAt, status: 'review', chunkCount: 2,
      createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-16T12:00:00.000Z', savedEntryIds: [],
      candidates: [
        { candidateId: 'candidate-1', classification: 'new', existingEntryId: '', suspectedEntryIds: [], decision: '', modifiedCard: null, card: { type: 'character', title: '林岚', summary: '调查员', body: '', tags: [], aliases: [], characterProfile: {}, evidence: [{ chunkIndex: 0, excerpt: '林岚进入钟楼。' }] } },
        { candidateId: 'candidate-2', classification: 'suspected-duplicate', existingEntryId: '', suspectedEntryIds: ['old-clock'], decision: '', modifiedCard: null, card: { type: 'location', title: '钟楼', summary: '旧港钟楼', body: '', tags: [], aliases: [], evidence: [{ chunkIndex: 1, excerpt: '钟楼位于旧港。' }] } }
      ]
    };
    let submittedReview = null;
    await page.route('**/api/compendium/reader-transfer/extract', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, batch: reviewBatch }) }));
    await page.route('**/api/compendium/reader-transfer/review', (route) => {
      submittedReview = route.request().postDataJSON();
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, batch: { ...reviewBatch, candidates: reviewBatch.candidates.map((candidate) => ({ ...candidate, decision: submittedReview.decisions.find((item) => item.candidateId === candidate.candidateId).decision })) } }) });
    });
    await page.route('**/api/compendium/reader-transfer/apply', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, applied: true, idempotent: false, batch: { ...reviewBatch, status: 'applied', savedEntryIds: ['saved-linyan'] }, backup: { backupId: 'ui-backup' } }) }));
    await page.click('[data-reader-compendium-extract]');
    await page.waitForFunction(() => document.querySelectorAll('[data-reader-compendium-candidate]').length === 2);
    await page.check('[data-reader-compendium-confirm]');
    assert.strictEqual(await page.locator('[data-reader-compendium-apply]').isDisabled(), true, 'confirmation must not bypass unreviewed candidates');
    await page.selectOption('[data-reader-compendium-candidate="candidate-1"] [data-reader-compendium-decision]', 'approved');
    assert.strictEqual(await page.locator('[data-reader-compendium-apply]').isDisabled(), true, 'one reviewed card must not bypass the remaining candidate');
    await page.selectOption('[data-reader-compendium-candidate="candidate-2"] [data-reader-compendium-decision]', 'abandoned');
    assert.strictEqual(await page.locator('[data-reader-compendium-apply]').isEnabled(), true, 'all explicit decisions plus confirmation should enable save');
    await page.click('[data-reader-compendium-apply]');
    await page.waitForFunction(() => !document.querySelector('[data-reader-compendium-dialog]').open);
    assert.deepStrictEqual(submittedReview.decisions.map((item) => item.decision), ['approved', 'abandoned'], 'review API must receive every explicit per-card decision');
    await page.unroute('**/api/compendium/reader-transfer/extract');
    await page.unroute('**/api/compendium/reader-transfer/review');
    await page.unroute('**/api/compendium/reader-transfer/apply');

    await openTransfer(page, envelopeIds, 'workflow');
    await page.click('[data-reader-source-bar="workflow"] [data-reader-source-use]');
    await page.waitForFunction(() => document.querySelector('[data-reader-workflow-dialog]').open && document.querySelector('[data-reader-workflow-status]').textContent.includes('预览完成'));
    assert.ok(!(await page.locator('[data-workflow-brief]').inputValue()).includes('TARGET_TRANSFER_SECRET'), 'formal workflow transfer must not paste frozen text into the editable Brief');
    assert.strictEqual(await page.locator('[data-reader-workflow-template] option[value="rewrite-guided"]').evaluate((option) => option.disabled), true, 'external Reader sources must not masquerade as rewriteable project scenes');
    await page.check('[data-reader-workflow-confirm]');
    await page.click('[data-reader-workflow-apply]');
    await page.waitForFunction(() => !document.querySelector('[data-reader-workflow-dialog]').open);
    await assertConsumed(page, envelopeIds, 'workflow');

    await openTransfer(page, envelopeIds, 'writer', envelopeIds.crossProject);
    assert.ok((await page.locator('[data-reader-source-bar="writer"]').innerText()).includes(`建议项目：${envelopeIds.sourceProjectId}`), 'cross-project source should be displayed as a suggestion');
    assert.strictEqual(await page.evaluate(() => window.currentProjectId()), 'consumer-project', 'suggestedProjectId must not switch the active target project');
    await page.click('[data-reader-source-bar="writer"] [data-reader-source-use]');
    await page.waitForFunction(() => document.querySelector('[data-reader-writer-dialog]').open && document.querySelector('[data-reader-writer-status]').textContent.includes('预览完成'));
    await page.selectOption('[data-reader-writer-project]', envelopeIds.sourceProjectId);
    await page.selectOption('[data-reader-writer-intent]', 'locate');
    await page.waitForFunction(() => document.querySelector('[data-reader-writer-location]').textContent.includes('精确定位'));
    await page.check('[data-reader-writer-confirm]');
    await page.click('[data-reader-writer-apply]');
    await page.waitForFunction(() => !document.querySelector('[data-reader-writer-dialog]').open && document.querySelector('[data-native-project-title]').textContent === 'Source Project');
    assert.strictEqual(await page.evaluate(() => window.currentProjectId()), envelopeIds.sourceProjectId, 'explicit locate should open the selected source project');
    await page.click('[data-reader-source-bar="writer"] [data-reader-source-return]');
    await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'reader');
    await page.waitForFunction((documentId) => readerState.activeDocumentId === documentId, `project:${envelopeIds.sourceProjectId}`);
    const projectReturnLocator = await page.evaluate(async (envelopeId) => {
      const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`)).json();
      return payload.transfer.envelope.sourceLocators[0];
    }, envelopeIds.crossProject);
    await page.waitForFunction((locator) => readerState.anchorLocator && readerState.anchorLocator.blockId === locator.blockId, projectReturnLocator);
    assert.strictEqual(await page.evaluate(() => readerState.documentMetadata.title), 'Source Project', 'returning from a project-source transfer should reopen its Reader projection');

    await openTransfer(page, envelopeIds, 'workflow', envelopeIds.failure);
    await page.route('**/api/workflows/reader-transfer/apply', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'forced materialization failure' })
    }));
    await page.click('[data-reader-source-bar="workflow"] [data-reader-source-use]');
    await page.waitForFunction(() => document.querySelector('[data-reader-workflow-dialog]').open && document.querySelector('[data-reader-workflow-status]').textContent.includes('预览完成'));
    await page.check('[data-reader-workflow-confirm]');
    await page.click('[data-reader-workflow-apply]');
    await page.waitForFunction(() => document.querySelector('[data-reader-workflow-status]').textContent.includes('创建失败'));
    await page.unroute('**/api/workflows/reader-transfer/apply');
    const failedLifecycle = await page.evaluate(async (envelopeId) => {
      const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`)).json();
      return payload.transfer.envelope.lifecycle;
    }, envelopeIds.failure);
    assert.strictEqual(failedLifecycle, 'active', 'target API failure must not consume the envelope');
    await page.click('[data-reader-workflow-close]');

    await openTransfer(page, envelopeIds, 'writer', envelopeIds.newProjectUi);
    await page.click('[data-reader-source-bar="writer"] [data-reader-source-use]');
    await page.waitForFunction(() => document.querySelector('[data-reader-writer-dialog]').open && document.querySelector('[data-reader-writer-status]').textContent.includes('预览完成'));
    await page.selectOption('[data-reader-writer-intent]', 'new-project');
    await page.waitForFunction(() => !document.querySelector('[data-reader-writer-title-field]').hidden && document.querySelector('[data-reader-writer-status]').textContent.includes('预览完成'));
    await page.fill('[data-reader-writer-project-title]', 'Reader Imported Project');
    await page.check('[data-reader-writer-confirm]');
    await page.click('[data-reader-writer-apply]');
    await page.waitForFunction(() => !document.querySelector('[data-reader-writer-dialog]').open && document.querySelector('[data-native-project-title]').textContent === 'Reader Imported Project');
    assert.ok((await page.locator('[data-native-scene-editor]').inputValue()).includes('TARGET_TRANSFER_SECRET'), 'new-project import should open its deterministic imported scene');

    await openTransfer(page, envelopeIds, 'workflow');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'workflow');
    await page.waitForFunction(() => {
      const bar = document.querySelector('[data-reader-source-bar="workflow"]');
      return bar && !bar.hidden && bar.textContent.includes('目标来源');
    });
    assert.ok((await page.locator('[data-reader-source-bar="workflow"]').innerText()).includes('重新载入此快照'), 'application reopen should resolve the current envelope by id');

    console.log('Reader transfer consumer tests passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) await servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader transfer consumer tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
