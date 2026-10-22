const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const vm = require('vm');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const applicationStore = require('../desktop/storage/workflow-application-store');
const applicationService = require('../desktop/services/workflow-application-service');
const Transfer = require('../desktop/services/workflow-transfer-service');
const { createReaderCompendiumTransferService } = require('../desktop/services/reader-compendium-transfer-service');

(async () => {
  const temporaryRoot = path.resolve(__dirname, '..', '.ai_state');
  await fs.mkdir(temporaryRoot, { recursive: true });
  const dataRoot = await fs.mkdtemp(path.join(temporaryRoot, 'compendium-transfer-safety-'));
  const failures = [];
  let sequence = 0;
  async function check(name, task) {
    try { await task(); console.log(`PASS ${name}`); }
    catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
  }
  async function fixture() {
    const { project, projectPath } = await projectService.createProject(dataRoot, { id: `transfer-safety-${++sequence}`, title: 'Transfer safety' });
    const runId = 'run';
    await runStore.createWorkflowV2Run(projectPath, {
      id: runId, projectId: project.id,
      definition: { id: 'definition', templateId: 'continuation', templateVersion: 1, title: 'Transfer', nodes: [{ id: 'draft', capabilityId: 'draft.batch' }] }
    });
    await artifactStore.writeArtifactRevision(projectPath, runId, {
      id: 'artifact', projectId: project.id, runId, nodeId: 'draft', artifactType: 'draft-batch@1', title: 'Draft'
    }, { id: 'revision', reviewState: 'approved', approvedAt: '2026-10-22T00:00:00.000Z', freshness: 'fresh', payload: { format: 'text' } }, 'Approved source');
    return { dataRoot, projectPath, projectId: project.id, runId, source: { runId, artifactId: 'artifact', revisionId: 'revision' } };
  }
  try {
    await check('explicit target ID takes precedence over an earlier name match', async () => {
      const suggestions = Transfer.createCompendiumSuggestions([{ matchedEntryId: 'target', draft: { type: 'character', title: 'Mira', summary: 'Updated' } }], [
        { id: 'other', type: 'character', title: 'Mira', updatedAt: 'v1' },
        { id: 'target', type: 'character', title: 'Another name', updatedAt: 'v2' }
      ]);
      assert.strictEqual(suggestions[0].target.entryId, 'target');
    });
    await check('automatic matching never merges different card types', async () => {
      const suggestions = Transfer.createCompendiumSuggestions([{ draft: { type: 'character', title: 'Mercury', summary: 'A courier' } }], [
        { id: 'planet', type: 'location', title: 'Mercury', updatedAt: 'v1' }
      ]);
      assert.strictEqual(suggestions[0].kind, 'create');
    });
    await check('ambiguous names require an explicit target', async () => {
      assert.throws(() => Transfer.createCompendiumSuggestions([{ draft: { type: 'character', title: 'Mira' } }], [
        { id: 'one', type: 'character', title: 'Mira', updatedAt: 'v1' },
        { id: 'two', type: 'character', title: 'Ada', aliases: ['Mira'], updatedAt: 'v2' }
      ]), /ambiguous/i);
    });
    await check('apply rejects a card changed after the confirmed preview', async () => {
      const base = await fixture();
      const saved = (await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' })).entry;
      const candidates = [{ id: 'suggestion', draft: { type: 'character', title: 'Mira', summary: 'Workflow draft' }, source: base.source }];
      const preview = await Transfer.previewCompendiumSuggestions({ ...base, candidates });
      await compendiumService.saveEntry(dataRoot, base.projectId, { id: saved.id, summary: 'Author edit' });
      await assert.rejects(() => Transfer.applyConfirmedCompendiumSuggestions({ ...base, applicationId: 'stale-preview', candidates, preview, confirmedSuggestionIds: ['suggestion'] }), /changed/i);
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries[0].summary, 'Author edit');
    });
    await check('duplicate suggestion targets are rejected before either patch is saved', async () => {
      const base = await fixture();
      await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', aliases: ['The Doctor'], summary: 'Original' });
      const candidates = [
        { id: 'by-title', draft: { type: 'character', title: 'Mira', summary: 'First patch' }, source: base.source },
        { id: 'by-alias', draft: { type: 'character', title: 'The Doctor', summary: 'Second patch' }, source: base.source }
      ];
      const preview = await Transfer.previewCompendiumSuggestions({ ...base, candidates });
      assert.deepStrictEqual(preview.suggestions.map(suggestion => suggestion.target.entryId), ['mira', 'mira']);
      await assert.rejects(() => Transfer.applyConfirmedCompendiumSuggestions({ ...base, applicationId: 'duplicate-updates', preview, confirmedSuggestionIds: ['by-title', 'by-alias'] }), /duplicate compendium target/i);
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries[0].summary, 'Original');
      assert.strictEqual(await applicationStore.readApplicationRecord(base.projectPath, base.runId, 'duplicate-updates'), null);
    });
    await check('duplicate create IDs are rejected before creating either card', async () => {
      const base = await fixture();
      const creates = ['First', 'Second'].map(title => ({ id: 'same-id', title, type: 'note', source: base.source }));
      await assert.rejects(() => applicationService.applyWorkflowApplication({ ...base, applicationId: 'duplicate-creates', compendium: { creates } }), /duplicate compendium target/i);
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries.length, 0);
    });
    await check('resume rejects duplicate pending card targets without a partial write', async () => {
      const base = await fixture();
      const card = (await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' })).entry;
      await applicationStore.writeApplicationRecord(base.projectPath, base.runId, {
        applicationId: 'legacy-duplicates', projectId: base.projectId, status: 'failed',
        operations: ['First patch', 'Second patch'].map((summary, index) => ({
          id: `pending-${index}`, kind: 'compendium.update', target: { entryId: card.id }, source: base.source,
          data: { projectId: base.projectId, expectedUpdatedAt: card.updatedAt, patch: { summary } }
        }))
      });
      const resumed = await applicationService.applyWorkflowApplication({ ...base, applicationId: 'legacy-duplicates', resume: true });
      assert.strictEqual(resumed.ok, false);
      assert.match(resumed.error.message, /duplicate compendium target/i);
      assert.ok(resumed.application.operations.every(operation => operation.status === 'pending'));
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries[0].summary, 'Original');
    });
    await check('apply uses exactly the reviewed patch and requires its preview', async () => {
      const base = await fixture();
      await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' });
      const candidates = [{ id: 'suggestion', draft: { type: 'character', title: 'Mira', summary: 'Reviewed patch' }, source: base.source }];
      const preview = await Transfer.previewCompendiumSuggestions({ ...base, candidates });
      candidates[0].draft.summary = 'Unreviewed replacement';
      const result = await Transfer.applyConfirmedCompendiumSuggestions({ ...base, applicationId: 'frozen-patch', candidates, preview, confirmedSuggestionIds: ['suggestion'] });
      assert.ok(result.ok);
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries[0].summary, 'Reviewed patch');
      await assert.rejects(() => Transfer.applyConfirmedCompendiumSuggestions({ ...base, applicationId: 'missing-preview', candidates, confirmedSuggestionIds: ['suggestion'] }), /preview/i);
    });
    await check('analysis transfer UI submits the reviewed preview and identifies character candidates', async () => {
      const base = await fixture();
      await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' });
      let refreshed = false;
      const context = vm.createContext({
        window: { isCreationWorkflow: () => false, confirm: () => true },
        currentProjectId: () => base.projectId,
        selectedWorkflowRun: () => ({ id: base.runId, artifacts: [{ id: 'artifact', nodeId: 'analysis', revision: { id: 'revision', reviewState: 'approved' }, content: { characterCandidates: [{ title: 'Mira', summary: 'Analyzed character' }] } }] }),
        fetch: async (url, init) => {
          const options = { ...JSON.parse(init.body), dataRoot };
          const result = url.endsWith('/preview-compendium-suggestions')
            ? await Transfer.previewCompendiumSuggestions(options)
            : await Transfer.applyConfirmedCompendiumSuggestions(options);
          return { ok: result.ok, json: async () => result };
        },
        loadCompendium: async () => { refreshed = true; },
        setWorkflowStatus: () => {}
      });
      vm.runInContext(await fs.readFile(path.resolve(__dirname, '..', 'src/desktop/shell/workflow-transfer-helpers.js'), 'utf8'), context);
      await context.window.transferGuidedCompendiumSuggestions();
      const entries = (await compendiumService.listEntries(dataRoot, base.projectId)).entries;
      assert.strictEqual(entries.length, 1, 'analysis character must update the matching character, not create a note');
      assert.strictEqual(entries[0].summary, 'Analyzed character');
      assert.strictEqual(refreshed, true);
    });
    await check('resuming an application rejects changed pending card targets', async () => {
      const base = await fixture();
      const card = (await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' })).entry;
      const interrupted = await applicationService.applyWorkflowApplication({
        ...base, applicationId: 'resume-conflict', operations: [
          { kind: 'compendium.create', source: base.source, data: { entry: { id: 'first', title: 'First', type: 'note' } } },
          { kind: 'compendium.update', target: { entryId: card.id }, source: base.source, data: { expectedUpdatedAt: card.updatedAt, patch: { summary: 'Old workflow draft' } } }
        ], afterOperation: async () => { throw new Error('intentional interruption'); }
      });
      assert.strictEqual(interrupted.application.status, 'partial');
      await compendiumService.saveEntry(dataRoot, base.projectId, { id: card.id, summary: 'Author edit after interruption' });
      const resumed = await applicationService.applyWorkflowApplication({ ...base, applicationId: 'resume-conflict', resume: true });
      assert.strictEqual(resumed.ok, false);
      assert.match(resumed.error.message, /changed/i);
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries.find(entry => entry.id === card.id).summary, 'Author edit after interruption');
    });
    await check('workflow card writes still compare versions at the store boundary', async () => {
      const base = await fixture();
      const card = (await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' })).entry;
      const result = await applicationService.applyWorkflowApplication({
        ...base, applicationId: 'boundary-conflict', operations: [
          { kind: 'compendium.create', source: base.source, data: { entry: { id: 'first', title: 'First', type: 'note' } } },
          { kind: 'compendium.update', target: { entryId: card.id }, source: base.source, data: { expectedUpdatedAt: card.updatedAt, patch: { summary: 'Old workflow draft' } } }
        ], afterOperation: async (_, index) => { if (index === 0) await compendiumService.saveEntry(dataRoot, base.projectId, { id: card.id, summary: 'Author edit at write boundary' }); }
      });
      assert.strictEqual(result.ok, false);
      assert.match(result.error.message, /changed/i);
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries.find(entry => entry.id === card.id).summary, 'Author edit at write boundary');
    });
    await check('reader batch rejects a post-validation change without partially saving cards', async () => {
      const base = await fixture();
      const card = (await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' })).entry;
      const envelope = { envelopeId: 'envelope', destination: 'compendium', documentId: 'doc', revisionId: 'rev' };
      let materialized = false;
      const service = createReaderCompendiumTransferService({
        projectService, compendiumService,
        readerTransferService: {
          readTransfer: async () => ({ envelope, snapshot: { sourceTitle: 'Source', sections: [] }, text: 'Mira enters the tower.' }),
          materializeConsumer: async () => { materialized = true; }
        },
        extractor: { extractChunk: async () => [{ type: 'character', title: 'Mira', summary: 'Reader draft' }, { type: 'location', title: 'Tower', summary: 'A tower' }] },
        createBackup: async () => {
          // Reentrant project writes exercise the final compare even while the outer lock is held.
          await compendiumService.saveEntry(dataRoot, base.projectId, { id: card.id, summary: 'Author edit during backup' });
          return { backup: { backupId: 'backup' } };
        }
      });
      const extracted = await service.extract(dataRoot, { projectId: base.projectId, envelopeId: envelope.envelopeId, batchId: 'reader-batch' });
      await service.review(dataRoot, { projectId: base.projectId, batchId: 'reader-batch', decisions: extracted.batch.candidates.map(candidate => ({ candidateId: candidate.candidateId, decision: 'approved' })) });
      await assert.rejects(() => service.apply(dataRoot, { projectId: base.projectId, batchId: 'reader-batch', confirmed: true }), /changed/i);
      const entries = (await compendiumService.listEntries(dataRoot, base.projectId)).entries;
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].summary, 'Author edit during backup');
      assert.strictEqual(materialized, false);
    });
    await check('reader alias-match targets retain their extraction version', async () => {
      const base = await fixture();
      const card = (await compendiumService.saveEntry(dataRoot, base.projectId, { id: 'mira', type: 'character', title: 'Mira', summary: 'Original' })).entry;
      const service = createReaderCompendiumTransferService({
        projectService, compendiumService,
        readerTransferService: {
          readTransfer: async () => ({ envelope: { envelopeId: 'alias-envelope', destination: 'compendium', documentId: 'doc', revisionId: 'rev' }, snapshot: { sourceTitle: 'Source', sections: [] }, text: 'The Doctor arrives.' }),
          materializeConsumer: async () => {}
        },
        extractor: { extractChunk: async () => [{ type: 'character', title: 'The Doctor', aliases: ['Mira'], summary: 'Reader draft' }] },
        createBackup: async () => ({ backup: { backupId: 'backup' } })
      });
      const extracted = await service.extract(dataRoot, { projectId: base.projectId, envelopeId: 'alias-envelope', batchId: 'alias-batch' });
      const candidate = extracted.batch.candidates[0];
      assert.strictEqual(candidate.classification, 'suspected-duplicate');
      await service.review(dataRoot, { projectId: base.projectId, batchId: 'alias-batch', decisions: [{ candidateId: candidate.candidateId, decision: 'approved', targetEntryId: card.id }] });
      await compendiumService.saveEntry(dataRoot, base.projectId, { id: card.id, summary: 'New author fact' });
      await assert.rejects(() => service.apply(dataRoot, { projectId: base.projectId, batchId: 'alias-batch', confirmed: true }), /changed/i);
      assert.strictEqual((await compendiumService.listEntries(dataRoot, base.projectId)).entries[0].summary, 'New author fact');
    });
  } finally {
    assert.ok(dataRoot.startsWith(`${temporaryRoot}${path.sep}`));
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
  if (failures.length) throw new Error(`${failures.length} transfer safety regression(s) failed`);
  console.log('Compendium transfer safety tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
