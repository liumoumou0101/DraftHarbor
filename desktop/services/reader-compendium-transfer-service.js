const crypto = require('crypto');
const Extraction = require('../../src/core/knowledge/reader-compendium-extraction');
const CompendiumSchema = require('../../src/core/knowledge/compendium-schema');
const defaultBatchStore = require('../storage/reader-compendium-batch-store');

function clean(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function stableId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`; }
function excerptFor(chunk, title) {
  const index = chunk.text.toLocaleLowerCase().indexOf(clean(title).toLocaleLowerCase());
  const start = index < 0 ? 0 : Math.max(0, index - 240);
  return chunk.text.slice(start, Math.min(chunk.text.length, start + 900));
}

function createReaderCompendiumTransferService(dependencies = {}) {
  const { readerTransferService, compendiumService, projectService, extractor, createBackup } = dependencies;
  const batches = dependencies.batchStore || defaultBatchStore;
  if (!readerTransferService || !compendiumService || !projectService || !extractor || !createBackup) throw new Error('reader compendium transfer dependencies are required');

  async function extract(dataRoot, request = {}) {
    const envelopeId = clean(request.envelopeId);
    const projectId = clean(request.projectId);
    if (!envelopeId || !projectId) throw new Error('reader compendium envelopeId and projectId are required');
    const transfer = await readerTransferService.readTransfer(dataRoot, envelopeId);
    if (!transfer || transfer.envelope.destination !== 'compendium') throw new Error('reader transfer destination must be compendium');
    const project = (await projectService.openProject(dataRoot, projectId)).project;
    const existing = (await compendiumService.listEntries(dataRoot, projectId)).entries;
    const requestedSize = Number(request.chunking && request.chunking.size) || 12000;
    const requestedOverlap = Number(request.chunking && request.chunking.overlap) || 800;
    const chunks = Extraction.chunkText(transfer.text, {
      size: Math.min(16000, Math.max(6000, requestedSize)),
      overlap: Math.min(1600, Math.max(200, requestedOverlap))
    });
    if (!chunks.length) throw new Error('reader transfer contains no extractable text');
    if (chunks.length > 40) throw new Error('reader compendium extraction exceeds the chunk safety limit');
    const rawCards = [];
    for (const chunk of chunks) {
      const output = await extractor.extractChunk(dataRoot, {
        projectId, envelope: transfer.envelope,
        sourceTitle: transfer.snapshot.sourceTitle, chunk, chunkCount: chunks.length,
        existingEntries: existing.map((entry) => ({ id: entry.id, type: entry.type, title: entry.title, aliases: entry.aliases }))
      });
      if (!Array.isArray(output)) throw new Error('reader compendium extractor returned an invalid card list');
      if (output.length > 80) throw new Error('reader compendium extractor returned too many cards for one chunk');
      output.forEach((card) => rawCards.push(Extraction.normalizeCard(card, {
        chunkIndex: chunk.index, start: chunk.start, end: chunk.end, excerpt: excerptFor(chunk, card && card.title)
      })));
    }
    const merged = Extraction.mergeCards(rawCards, Math.min(80, Math.max(1, Number(request.maxCards) || 80)));
    const candidates = Extraction.compareCandidates(merged, existing).map((candidate) => ({
      ...candidate,
      existingUpdatedAt: candidate.existingEntryId ? (existing.find((entry) => entry.id === candidate.existingEntryId) || {}).updatedAt || '' : ''
    }));
    const now = clean(request.createdAt) || new Date().toISOString();
    const batchId = clean(request.batchId) || stableId('reader-compendium-batch', `${envelopeId}:${projectId}:${now}`);
    const prior = await batches.readBatch(dataRoot, projectId, batchId);
    if (prior) {
      if (prior.envelopeId !== envelopeId) throw new Error('reader compendium batch identity conflict');
      return { ok: true, batch: prior, idempotent: true };
    }
    const batch = {
      version: 1, batchId, envelopeId, projectId, sourceTitle: transfer.snapshot.sourceTitle,
      projectUpdatedAt: project.updatedAt, status: 'review', chunkCount: chunks.length,
      candidates, createdAt: now, updatedAt: now, appliedAt: '', backupId: '', savedEntryIds: []
    };
    await batches.writeBatch(dataRoot, projectId, batch);
    return { ok: true, batch, idempotent: false };
  }

  async function review(dataRoot, request = {}) {
    const projectId = clean(request.projectId); const batchId = clean(request.batchId);
    const batch = await batches.readBatch(dataRoot, projectId, batchId);
    if (!batch) throw new Error('reader compendium review batch was not found');
    if (batch.status === 'applied') return { ok: true, batch, idempotent: true };
    if (request.expectedUpdatedAt && request.expectedUpdatedAt !== batch.updatedAt) throw new Error('reader compendium review batch changed');
    const byId = new Map((request.decisions || []).map((decision) => [clean(decision.candidateId), decision]));
    batch.candidates = batch.candidates.map((candidate) => {
      const decision = byId.get(candidate.candidateId);
      if (!decision) return candidate;
      if (!Extraction.DECISIONS.includes(decision.decision)) throw new Error(`invalid candidate decision: ${clean(decision.decision)}`);
      let modifiedCard = null;
      if (decision.decision === 'approved-modified') {
        const editableCard = { ...(decision.card || {}) };
        delete editableCard.evidence;
        modifiedCard = Extraction.normalizeCard(editableCard, candidate.card.evidence[0]);
      }
      const targetEntryId = clean(decision.targetEntryId);
      if (targetEntryId && !candidate.suspectedEntryIds.includes(targetEntryId)) throw new Error('candidate target entry is outside the comparison set');
      return { ...candidate, decision: decision.decision, modifiedCard, targetEntryId };
    });
    batch.updatedAt = clean(request.updatedAt) || new Date().toISOString();
    await batches.writeBatch(dataRoot, projectId, batch);
    return { ok: true, batch, idempotent: false };
  }

  function sourceReferences(batch, transfer, candidate, now) {
    return candidate.card.evidence.map((evidence) => ({
      kind: 'reader-transfer', envelopeId: batch.envelopeId, batchId: batch.batchId, candidateId: candidate.candidateId,
      documentId: transfer.envelope.documentId, revisionId: transfer.envelope.revisionId,
      sectionId: (transfer.snapshot.sections.find((section) => evidence.start >= Number(section.textStart || 0) && evidence.start <= Number(section.textEnd || 0)) || {}).sectionId || '',
      excerpt: evidence.excerpt, createdAt: now
    }));
  }

  async function apply(dataRoot, request = {}) {
    if (request.confirmed !== true) throw new Error('reader compendium save requires explicit confirmation');
    const projectId = clean(request.projectId); const batchId = clean(request.batchId);
    const batch = await batches.readBatch(dataRoot, projectId, batchId);
    if (!batch) throw new Error('reader compendium review batch was not found');
    if (batch.status === 'applied') return { ok: true, applied: true, idempotent: true, batch };
    Extraction.validateDecisions(batch.candidates);
    const transfer = await readerTransferService.readTransfer(dataRoot, batch.envelopeId);
    const project = (await projectService.openProject(dataRoot, projectId)).project;
    const entries = (await compendiumService.listEntries(dataRoot, projectId)).entries;
    const alreadySaved = entries.filter((entry) => (entry.sourceReferences || []).some((reference) => reference.batchId === batchId));
    if (alreadySaved.length) {
      batch.status = 'applied'; batch.savedEntryIds = alreadySaved.map((entry) => entry.id); batch.appliedAt = batch.appliedAt || new Date().toISOString();
      await batches.writeBatch(dataRoot, projectId, batch);
      return { ok: true, applied: true, idempotent: true, batch };
    }
    if (clean(request.expectedProjectUpdatedAt || batch.projectUpdatedAt) !== project.updatedAt) throw new Error('target project changed after extraction');
    const now = clean(request.appliedAt) || new Date().toISOString();
    const writes = batch.candidates.filter((candidate) => candidate.decision !== 'abandoned').map((candidate) => {
      const card = candidate.decision === 'approved-modified' ? candidate.modifiedCard : candidate.card;
      const targetId = clean(candidate.targetEntryId || candidate.existingEntryId);
      const existing = targetId ? entries.find((entry) => entry.id === targetId) : null;
      if (targetId && !existing) throw new Error(`target compendium entry no longer exists: ${targetId}`);
      if (existing && candidate.existingUpdatedAt && existing.updatedAt !== candidate.existingUpdatedAt) throw new Error(`target compendium entry changed after extraction: ${targetId}`);
      return CompendiumSchema.createCompendiumEntry({
        ...(existing || {}), ...card,
        id: existing ? existing.id : stableId(card.type, `${batchId}:${candidate.candidateId}`), projectId,
        summary: card.summary || existing && existing.summary || '',
        body: card.body || existing && existing.body || '',
        aliases: [...(existing && existing.aliases || []), ...(card.aliases || [])],
        tags: [...(existing && existing.tags || []), ...(card.tags || [])],
        characterProfile: card.type === 'character' ? {
          ...(existing && existing.characterProfile || {}),
          ...Object.fromEntries(Object.entries(card.characterProfile || {}).filter(([, value]) => clean(value)))
        } : undefined,
        sourceReferences: [...(existing && existing.sourceReferences || []), ...sourceReferences(batch, transfer, candidate, now)],
        createdAt: existing && existing.createdAt || now, updatedAt: now
      });
    });
    const backup = (await createBackup(dataRoot, projectId, `Before saving Reader compendium batch ${batchId}`, 'before-reader-compendium-application')).backup;
    const saved = writes.length ? (await compendiumService.saveEntriesBatch(dataRoot, projectId, writes)).entries : [];
    batch.status = 'applied'; batch.appliedAt = now; batch.backupId = backup && backup.backupId || ''; batch.savedEntryIds = saved.map((entry) => entry.id); batch.updatedAt = now;
    await batches.writeBatch(dataRoot, projectId, batch);
    await readerTransferService.materializeConsumer(dataRoot, batch.envelopeId, {
      consumerId: `compendium-batch:${batchId}`, destination: 'compendium', referenceId: `compendium:${projectId}:${batchId}`, createdAt: now, materializedAt: now
    });
    return { ok: true, applied: true, idempotent: false, entries: saved, backup, batch };
  }

  async function read(dataRoot, projectId, batchId) {
    const batch = await batches.readBatch(dataRoot, clean(projectId), clean(batchId));
    if (!batch) throw new Error('reader compendium review batch was not found');
    return { ok: true, batch };
  }

  return { extract, review, apply, read };
}

module.exports = { createReaderCompendiumTransferService, stableId };
