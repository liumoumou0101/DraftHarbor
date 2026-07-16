const crypto = require('crypto');

const ReaderDocument = require('../../src/core/document/reader-document');
const ReaderSelection = require('../../src/core/document/reader-selection');
const transferStore = require('../storage/reader-transfer-store');
const readerStore = require('../storage/reader-document-store');
const projectStore = require('../storage/project-file-store');

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function projectUnitDigest(project, unit) {
  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  if (unit.kind === 'chapter') {
    const chapterScenes = scenes
      .filter((scene) => scene.chapterId === unit.sourceId)
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    if (!chapterScenes.length) return null;
    return digest(JSON.stringify(chapterScenes.map((scene) => ({ id: scene.id, content: String(scene.content || '') }))));
  }
  const sceneId = unit.sceneId || unit.sourceId;
  const scene = scenes.find((item) => item.id === sceneId);
  if (!scene) return null;
  const content = String(scene.content || '');
  if (unit.kind === 'block' && unit.start !== undefined && unit.end !== undefined) {
    return digest(content.slice(unit.start, unit.end));
  }
  return digest(content);
}

function createReaderTransferService(dependencies = {}) {
  const transfers = dependencies.transferStore || transferStore;
  const documents = dependencies.readerStore || readerStore;
  const projects = dependencies.projectStore || projectStore;

  async function validateSource(dataRoot, bundleInput) {
    const envelope = bundleInput.envelope || bundleInput;
    if (envelope.sourceKind === 'project') {
      const projectId = cleanString(envelope.suggestedProjectId || cleanString(envelope.documentId).replace(/^project:/, ''));
      if (!projectId) throw new Error('project reader transfer requires a project id');
      const project = await projects.openProject(dataRoot, projectId).catch(() => null);
      if (!project) throw new Error(`reader transfer source project not found: ${projectId}`);
      const projection = ReaderDocument.projectToReaderDocumentV2(project, { digest });
      if (projection.revisions[0].contentDigest !== cleanString(envelope.sourceRevisionDigest)) {
        throw new Error('reader transfer source revision digest does not match the current project');
      }
      return;
    }
    if (envelope.sourceKind === 'pasted-text') return;
    const metadata = await documents.readReaderDocumentMetadata(dataRoot, envelope.documentId);
    if (!metadata) throw new Error('reader transfer source document not found');
    const revision = metadata.revisions.find((item) => item.revisionId === envelope.revisionId);
    if (!revision) throw new Error('reader transfer source revision not found');
    if (revision.contentDigest !== cleanString(envelope.sourceRevisionDigest)) {
      throw new Error('reader transfer source revision digest does not match');
    }
    if (metadata.sourceKind !== envelope.sourceKind || metadata.format !== envelope.format) {
      throw new Error('reader transfer source kind or format does not match');
    }
  }

  async function createTransfer(dataRoot, input) {
    await validateSource(dataRoot, input);
    return transfers.createReaderTransfer(dataRoot, input);
  }

  async function createTransferFromRange(dataRoot, request = {}) {
    const documentId = cleanString(request.documentId);
    const requestedRevisionId = cleanString(request.revisionId);
    if (!documentId) throw new Error('reader transfer range documentId is required');
    let source;
    let revision;
    let project = null;
    if (documentId.startsWith('project:')) {
      const projectId = cleanString(request.projectId || documentId.replace(/^project:/, ''));
      project = await projects.openProject(dataRoot, projectId).catch(() => null);
      if (!project) throw new Error(`reader transfer source project not found: ${projectId}`);
      const projection = ReaderDocument.projectToReaderDocumentV2(project, { digest });
      revision = projection.revisions[0];
      source = {
        sourceKind: 'project', format: 'project', title: projection.title, projectId,
        documentId: projection.documentId, revisionId: revision.revisionId, sourceRevisionDigest: revision.contentDigest
      };
    } else {
      const metadata = await documents.readReaderDocumentMetadata(dataRoot, documentId);
      if (!metadata) throw new Error('reader transfer source document not found');
      const revisionId = requestedRevisionId || metadata.activeRevisionId;
      revision = await documents.readReaderDocumentRevision(dataRoot, documentId, revisionId);
      if (!revision) throw new Error('reader transfer source revision not found');
      source = {
        sourceKind: metadata.sourceKind, format: metadata.format, title: metadata.title, projectId: '',
        documentId: metadata.documentId, revisionId: revision.revisionId, sourceRevisionDigest: revision.contentDigest
      };
    }
    if (requestedRevisionId && requestedRevisionId !== source.revisionId) throw new Error('reader transfer range revision changed before snapshot creation');
    if (request.sourceRevisionDigest && cleanString(request.sourceRevisionDigest) !== source.sourceRevisionDigest) {
      throw new Error('reader transfer range source revision changed before snapshot creation');
    }
    const selection = ReaderSelection.buildReaderTransferSelection(revision, {
      documentId: source.documentId,
      projectId: source.projectId,
      scope: request.scope,
      range: request.range,
      sceneId: request.sceneId,
      chapterId: request.chapterId,
      chapterIds: request.chapterIds
    });
    const sourceUnits = project ? selection.sceneIds.map((sceneId) => {
      const scene = project.scenes.find((item) => item.id === sceneId);
      return {
        kind: 'scene', sourceId: sceneId, sceneId,
        chapterId: scene && scene.chapterId || '',
        digest: projectUnitDigest(project, { kind: 'scene', sourceId: sceneId }),
        updatedAt: scene && scene.updatedAt || project.updatedAt
      };
    }) : [];
    if (project && !sourceUnits.length) {
      for (const sourceChapterId of selection.sourceChapterIds) {
        sourceUnits.push({
          kind: 'chapter', sourceId: sourceChapterId, chapterId: sourceChapterId,
          digest: projectUnitDigest(project, { kind: 'chapter', sourceId: sourceChapterId }),
          updatedAt: (project.chapters.find((item) => item.id === sourceChapterId) || {}).updatedAt || project.updatedAt
        });
      }
    }
    const createdAt = request.createdAt || new Date().toISOString();
    return createTransfer(dataRoot, {
      envelope: {
        envelopeId: request.envelopeId,
        createdAt,
        destination: request.destination,
        sourceKind: source.sourceKind,
        documentId: source.documentId,
        revisionId: source.revisionId,
        sourceRevisionDigest: source.sourceRevisionDigest,
        format: source.format,
        scope: selection.scope,
        sourceLocators: selection.sourceLocators,
        suggestedProjectId: source.projectId
      },
      snapshot: {
        sourceTitle: source.title,
        sections: selection.sections.map((section, index) => {
          const prefix = selection.sections.length > 1 ? `# ${section.title}\n\n` : '';
          const previous = selection.sections.slice(0, index).reduce((sum, item) => (
            sum + (selection.sections.length > 1 ? `# ${item.title}\n\n`.length : 0) + item.text.length + 2
          ), 0);
          return {
            sectionId: section.sectionId,
            title: section.title,
            chapterId: section.chapterId,
            order: section.order,
            characterCount: section.characterCount,
            textStart: previous + prefix.length,
            textEnd: previous + prefix.length + section.text.length,
            textDigest: digest(section.text)
          };
        }),
        sourceUnits
      },
      text: selection.text
    });
  }

  async function freshness(dataRoot, envelopeId) {
    const record = await transfers.readReaderTransfer(dataRoot, envelopeId);
    if (!record) throw new Error(`reader transfer not found: ${cleanString(envelopeId)}`);
    const { envelope, snapshot } = record;
    if (envelope.sourceKind === 'pasted-text') {
      return { status: 'fresh', newerRevisionAvailable: false, returnLocationAvailable: true, unitResults: [] };
    }
    if (envelope.sourceKind === 'local-text') {
      const metadata = await documents.readReaderDocumentMetadata(dataRoot, envelope.documentId).catch(() => null);
      if (!metadata) return { status: 'missing', newerRevisionAvailable: false, returnLocationAvailable: false, unitResults: [] };
      const revision = metadata.revisions.find((item) => item.revisionId === envelope.revisionId);
      if (!revision || revision.contentDigest !== envelope.sourceRevisionDigest) {
        return { status: 'missing', newerRevisionAvailable: metadata.activeRevisionId !== envelope.revisionId, returnLocationAvailable: false, unitResults: [] };
      }
      return {
        status: 'fresh',
        newerRevisionAvailable: metadata.activeRevisionId !== envelope.revisionId,
        returnLocationAvailable: true,
        unitResults: []
      };
    }
    const projectId = envelope.suggestedProjectId || envelope.documentId.replace(/^project:/, '');
    const project = await projects.openProject(dataRoot, projectId).catch(() => null);
    if (!project) return { status: 'missing', newerRevisionAvailable: false, returnLocationAvailable: false, unitResults: [] };
    const unitResults = snapshot.sourceUnits.map((unit) => {
      const currentDigest = projectUnitDigest(project, unit);
      return {
        kind: unit.kind,
        sourceId: unit.sourceId,
        status: currentDigest === null ? 'missing' : currentDigest === unit.digest ? 'fresh' : 'stale'
      };
    });
    const status = unitResults.some((item) => item.status === 'missing')
      ? 'missing'
      : unitResults.some((item) => item.status === 'stale') ? 'stale' : 'fresh';
    return { status, newerRevisionAvailable: false, returnLocationAvailable: status !== 'missing', unitResults };
  }

  async function readTransfer(dataRoot, envelopeId) {
    const record = await transfers.readReaderTransfer(dataRoot, envelopeId);
    if (!record) return null;
    return { ...record, freshness: await freshness(dataRoot, envelopeId) };
  }

  async function materializeConsumer(dataRoot, envelopeId, consumerInput = {}) {
    const id = cleanString(envelopeId);
    const consumerId = cleanString(consumerInput.consumerId);
    const referenceId = cleanString(consumerInput.referenceId);
    const destination = cleanString(consumerInput.destination);
    if (!id || !consumerId || !referenceId) throw new Error('reader transfer materialization identity is required');
    let record = await transfers.readReaderTransfer(dataRoot, id);
    if (!record) throw new Error(`reader transfer not found: ${id}`);
    if (record.envelope.lifecycle === 'archived') throw new Error('archived reader transfer cannot be materialized');
    if (destination !== record.envelope.destination) throw new Error('reader transfer materialization destination must match envelope');
    const timestamp = cleanString(consumerInput.materializedAt || consumerInput.createdAt) || new Date().toISOString();
    let consumer = record.envelope.consumerReferences.find((item) => item.consumerId === consumerId);
    if (consumer && (consumer.destination !== destination || consumer.referenceId !== referenceId)) {
      throw new Error('reader transfer consumer identity is immutable');
    }
    if (!consumer) {
      const envelope = await transfers.addReaderTransferConsumer(dataRoot, id, {
        consumerId, destination, referenceId,
        createdAt: cleanString(consumerInput.createdAt) || timestamp,
        materializedAt: timestamp
      }, { expectedUpdatedAt: record.envelope.updatedAt });
      record = { ...record, envelope };
      consumer = envelope.consumerReferences.find((item) => item.consumerId === consumerId);
    } else if (!consumer.materializedAt) {
      const envelope = await transfers.updateReaderTransferConsumer(dataRoot, id, consumerId, {
        materializedAt: timestamp, updatedAt: timestamp
      }, { expectedUpdatedAt: record.envelope.updatedAt });
      record = { ...record, envelope };
    }
    if (record.envelope.lifecycle === 'active') {
      const envelope = await transfers.transitionReaderTransfer(dataRoot, id, 'consumed', {
        expectedUpdatedAt: record.envelope.updatedAt, updatedAt: timestamp
      });
      record = { ...record, envelope };
    }
    return record.envelope;
  }

  return {
    createTransfer,
    createTransferFromRange,
    readTransfer,
    materializeConsumer,
    freshness,
    listTransfers: (dataRoot) => transfers.listReaderTransfers(dataRoot),
    addConsumer: (dataRoot, envelopeId, consumer, options) => transfers.addReaderTransferConsumer(dataRoot, envelopeId, consumer, options),
    updateConsumer: (dataRoot, envelopeId, consumerId, changes, options) => transfers.updateReaderTransferConsumer(dataRoot, envelopeId, consumerId, changes, options),
    transition: (dataRoot, envelopeId, lifecycle, options) => transfers.transitionReaderTransfer(dataRoot, envelopeId, lifecycle, options),
    deleteArchived: (dataRoot, envelopeId) => transfers.deleteArchivedReaderTransfer(dataRoot, envelopeId)
  };
}

module.exports = { createReaderTransferService, projectUnitDigest };
