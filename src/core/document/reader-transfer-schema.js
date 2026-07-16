(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./reader-document-schema'), require('./reader-locator'));
    } else {
        root.DraftHarborReaderTransferSchema = factory(root.DraftHarborReaderDocumentSchema, root.DraftHarborReaderLocator);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderSchema, ReaderLocator) {
    const TRANSFER_SCHEMA_VERSION = 1;
    const SNAPSHOT_SCHEMA_VERSION = 1;
    const DESTINATIONS = Object.freeze(['writer', 'compendium', 'workflow']);
    const SCOPES = Object.freeze(['selection', 'scene', 'chapter', 'chapters', 'document']);
    const LIFECYCLES = Object.freeze(['active', 'consumed', 'archived']);

    function cleanString(value, fallback = '') {
        return String(value === undefined || value === null ? fallback : value).trim();
    }

    function normalizeText(value) {
        return ReaderSchema.normalizeText(value === undefined || value === null ? '' : value);
    }

    function timestamp(value, label) {
        const text = cleanString(value);
        const parsed = new Date(text);
        if (!text || Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid timestamp`);
        return parsed.toISOString();
    }

    function enumValue(value, allowed, label) {
        const normalized = cleanString(value);
        if (!allowed.includes(normalized)) throw new Error(`${label} is not supported: ${normalized || '(empty)'}`);
        return normalized;
    }

    function nonNegativeInteger(value, fallback = 0) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 ? number : fallback;
    }

    function deepFreeze(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
        return value;
    }

    function digestValue(provided, canonical, options, label) {
        const existing = cleanString(provided);
        if (options && typeof options.digest === 'function') {
            const calculated = cleanString(options.digest(canonical));
            if (!calculated) throw new Error(`${label} digest function returned an empty value`);
            if (existing && existing !== calculated) throw new Error(`${label} digest does not match normalized content`);
            return calculated;
        }
        if (!existing) throw new Error(`${label} digest is required`);
        return existing;
    }

    function unique(items, field, label) {
        const seen = new Set();
        for (const item of items) {
            if (seen.has(item[field])) throw new Error(`duplicate ${label}: ${item[field]}`);
            seen.add(item[field]);
        }
    }

    function createSourceUnit(input = {}) {
        const kind = enumValue(input.kind, ['chapter', 'scene', 'block'], 'reader transfer source unit kind');
        const sourceId = cleanString(input.sourceId || input.id);
        if (!sourceId) throw new Error('reader transfer source unit sourceId is required');
        const digest = cleanString(input.digest);
        if (!digest) throw new Error(`reader transfer source unit ${sourceId} digest is required`);
        return {
            kind,
            sourceId,
            chapterId: cleanString(input.chapterId),
            sceneId: cleanString(input.sceneId),
            start: input.start === undefined ? undefined : nonNegativeInteger(input.start, -1),
            end: input.end === undefined ? undefined : nonNegativeInteger(input.end, -1),
            digest,
            updatedAt: input.updatedAt ? timestamp(input.updatedAt, `reader transfer source unit ${sourceId} updatedAt`) : ''
        };
    }

    function createSnapshotSection(input = {}, index = 0) {
        const sectionId = cleanString(input.sectionId || input.id, `section-${index + 1}`);
        if (!sectionId) throw new Error('reader transfer snapshot sectionId is required');
        return {
            sectionId,
            title: cleanString(input.title),
            chapterId: cleanString(input.chapterId),
            sceneId: cleanString(input.sceneId),
            order: nonNegativeInteger(input.order, index),
            characterCount: nonNegativeInteger(input.characterCount),
            textStart: input.textStart === undefined ? undefined : nonNegativeInteger(input.textStart),
            textEnd: input.textEnd === undefined ? undefined : nonNegativeInteger(input.textEnd),
            textDigest: cleanString(input.textDigest)
        };
    }

    function canonicalSnapshotStructure(input = {}) {
        return JSON.stringify({
            envelopeId: input.envelopeId,
            sourceTitle: input.sourceTitle,
            sourceKind: input.sourceKind,
            documentId: input.documentId,
            revisionId: input.revisionId,
            sourceRevisionDigest: input.sourceRevisionDigest,
            sections: input.sections,
            sourceUnits: input.sourceUnits,
            createdAt: input.createdAt
        });
    }

    function createReaderTransferSnapshot(input = {}, textInput, options = {}) {
        if (Number(input.schemaVersion === undefined ? SNAPSHOT_SCHEMA_VERSION : input.schemaVersion) !== SNAPSHOT_SCHEMA_VERSION) {
            throw new Error(`reader transfer snapshot schemaVersion must be ${SNAPSHOT_SCHEMA_VERSION}`);
        }
        const envelopeId = cleanString(input.envelopeId);
        const documentId = cleanString(input.documentId);
        const revisionId = cleanString(input.revisionId);
        if (!envelopeId) throw new Error('reader transfer snapshot envelopeId is required');
        if (!documentId || !revisionId) throw new Error('reader transfer snapshot documentId and revisionId are required');
        const sourceKind = enumValue(input.sourceKind, ReaderSchema.SOURCE_KINDS, 'reader transfer snapshot sourceKind');
        const text = normalizeText(textInput === undefined ? input.text : textInput);
        if (!text) throw new Error('reader transfer snapshot text is required');
        const sections = (Array.isArray(input.sections) ? input.sections : []).map(createSnapshotSection);
        if (!sections.length) throw new Error('reader transfer snapshot requires at least one section');
        unique(sections, 'sectionId', 'reader transfer snapshot sectionId');
        const sourceUnits = (Array.isArray(input.sourceUnits) ? input.sourceUnits : []).map(createSourceUnit);
        unique(sourceUnits, 'sourceId', 'reader transfer source unit sourceId');
        if (sourceKind === 'project' && !sourceUnits.length) throw new Error('project reader transfer snapshot requires sourceUnits');
        const base = {
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            envelopeId,
            sourceTitle: cleanString(input.sourceTitle, '未命名来源') || '未命名来源',
            sourceKind,
            documentId,
            revisionId,
            sourceRevisionDigest: cleanString(input.sourceRevisionDigest),
            createdAt: timestamp(input.createdAt, 'reader transfer snapshot createdAt'),
            sections,
            sourceUnits,
            characterCount: text.length,
            textDigest: digestValue(input.textDigest, text, options, 'reader transfer snapshot text')
        };
        if (!base.sourceRevisionDigest) throw new Error('reader transfer snapshot sourceRevisionDigest is required');
        const snapshot = {
            ...base,
            structureDigest: digestValue(input.structureDigest, canonicalSnapshotStructure(base), options, 'reader transfer snapshot structure')
        };
        return deepFreeze({ snapshot, text });
    }

    function createConsumerReference(input = {}) {
        const consumerId = cleanString(input.consumerId || input.id);
        const referenceId = cleanString(input.referenceId);
        if (!consumerId || !referenceId) throw new Error('reader transfer consumerId and referenceId are required');
        return {
            consumerId,
            destination: enumValue(input.destination, DESTINATIONS, 'reader transfer consumer destination'),
            referenceId,
            createdAt: timestamp(input.createdAt, 'reader transfer consumer createdAt'),
            materializedAt: input.materializedAt ? timestamp(input.materializedAt, 'reader transfer consumer materializedAt') : '',
            releasedAt: input.releasedAt ? timestamp(input.releasedAt, 'reader transfer consumer releasedAt') : ''
        };
    }

    function createReaderTransferEnvelope(input = {}, options = {}) {
        if (Number(input.schemaVersion === undefined ? TRANSFER_SCHEMA_VERSION : input.schemaVersion) !== TRANSFER_SCHEMA_VERSION) {
            throw new Error(`reader transfer envelope schemaVersion must be ${TRANSFER_SCHEMA_VERSION}`);
        }
        const envelopeId = cleanString(input.envelopeId || input.id);
        const documentId = cleanString(input.documentId);
        const revisionId = cleanString(input.revisionId);
        if (!envelopeId) throw new Error('reader transfer envelopeId is required');
        if (!documentId || !revisionId) throw new Error('reader transfer documentId and revisionId are required');
        const sourceKind = enumValue(input.sourceKind, ReaderSchema.SOURCE_KINDS, 'reader transfer sourceKind');
        const format = enumValue(input.format, ReaderSchema.FORMATS, 'reader transfer format');
        const locators = (Array.isArray(input.sourceLocators) ? input.sourceLocators : []).map(ReaderLocator.createReaderLocator);
        if (!locators.length) throw new Error('reader transfer requires at least one source locator');
        if (locators.some((locator) => locator.documentId !== documentId || locator.revisionId !== revisionId)) {
            throw new Error('reader transfer locators must match the envelope source');
        }
        const consumerReferences = (Array.isArray(input.consumerReferences) ? input.consumerReferences : []).map(createConsumerReference);
        unique(consumerReferences, 'consumerId', 'reader transfer consumerId');
        const lifecycle = enumValue(input.lifecycle || 'active', LIFECYCLES, 'reader transfer lifecycle');
        if (lifecycle === 'consumed' && !consumerReferences.some((reference) => reference.materializedAt)) {
            throw new Error('consumed reader transfer requires a materialized consumer reference');
        }
        const envelope = {
            schemaVersion: TRANSFER_SCHEMA_VERSION,
            envelopeId,
            createdAt: timestamp(input.createdAt, 'reader transfer createdAt'),
            updatedAt: timestamp(input.updatedAt || input.createdAt, 'reader transfer updatedAt'),
            destination: enumValue(input.destination, DESTINATIONS, 'reader transfer destination'),
            sourceKind,
            documentId,
            revisionId,
            sourceRevisionDigest: cleanString(input.sourceRevisionDigest),
            format,
            scope: enumValue(input.scope, SCOPES, 'reader transfer scope'),
            sourceLocators: locators,
            snapshotRef: cleanString(input.snapshotRef, `reader-transfer:${envelopeId}:snapshot`),
            snapshotDigest: cleanString(input.snapshotDigest),
            characterCount: nonNegativeInteger(input.characterCount),
            suggestedProjectId: cleanString(input.suggestedProjectId),
            lifecycle,
            consumerReferences
        };
        if (!envelope.sourceRevisionDigest || !envelope.snapshotDigest) throw new Error('reader transfer source and snapshot digests are required');
        if (envelope.snapshotRef !== `reader-transfer:${envelopeId}:snapshot`) throw new Error('reader transfer snapshotRef is invalid');
        if (options.snapshot) {
            const bundle = createReaderTransferSnapshot(options.snapshot.snapshot || options.snapshot, options.snapshot.text, options);
            const calculated = digestValue('', `${JSON.stringify(bundle.snapshot)}\n${bundle.text}`, options, 'reader transfer snapshot bundle');
            if (calculated !== envelope.snapshotDigest) throw new Error('reader transfer snapshotDigest does not match snapshot');
            if (bundle.snapshot.envelopeId !== envelopeId || bundle.snapshot.documentId !== documentId || bundle.snapshot.revisionId !== revisionId) {
                throw new Error('reader transfer snapshot identity does not match envelope');
            }
            if (bundle.snapshot.textDigest && envelope.characterCount !== bundle.snapshot.characterCount) {
                throw new Error('reader transfer characterCount does not match snapshot');
            }
        }
        return deepFreeze(envelope);
    }

    function createReaderTransferBundle(input = {}, options = {}) {
        const envelopeInput = input.envelope || input;
        const snapshotInput = input.snapshot || {};
        const bundle = createReaderTransferSnapshot({
            ...snapshotInput,
            envelopeId: envelopeInput.envelopeId || envelopeInput.id,
            sourceKind: envelopeInput.sourceKind,
            documentId: envelopeInput.documentId,
            revisionId: envelopeInput.revisionId,
            sourceRevisionDigest: envelopeInput.sourceRevisionDigest,
            createdAt: snapshotInput.createdAt || envelopeInput.createdAt
        }, input.text, options);
        const snapshotDigest = digestValue(envelopeInput.snapshotDigest, `${JSON.stringify(bundle.snapshot)}\n${bundle.text}`, options, 'reader transfer snapshot bundle');
        const envelope = createReaderTransferEnvelope({
            ...envelopeInput,
            snapshotDigest,
            characterCount: bundle.snapshot.characterCount
        }, options);
        return deepFreeze({ envelope, snapshot: bundle.snapshot, text: bundle.text });
    }

    function transitionReaderTransfer(envelopeInput, lifecycle, options = {}) {
        const current = createReaderTransferEnvelope(envelopeInput);
        const next = enumValue(lifecycle, LIFECYCLES, 'reader transfer lifecycle');
        const allowed = { active: ['active', 'consumed', 'archived'], consumed: ['consumed', 'archived'], archived: ['archived'] };
        if (!allowed[current.lifecycle].includes(next)) throw new Error(`reader transfer cannot transition from ${current.lifecycle} to ${next}`);
        return createReaderTransferEnvelope({ ...current, lifecycle: next, updatedAt: options.updatedAt || current.updatedAt });
    }

    function addReaderTransferConsumer(envelopeInput, consumerInput) {
        const current = createReaderTransferEnvelope(envelopeInput);
        if (current.lifecycle === 'archived') throw new Error('archived reader transfer cannot add consumers');
        const consumer = createConsumerReference(consumerInput);
        if (consumer.destination !== current.destination) throw new Error('reader transfer consumer destination must match envelope destination');
        if (current.consumerReferences.some((item) => item.consumerId === consumer.consumerId)) throw new Error(`reader transfer consumer already exists: ${consumer.consumerId}`);
        return createReaderTransferEnvelope({
            ...current,
            updatedAt: consumer.createdAt,
            consumerReferences: [...current.consumerReferences, consumer]
        });
    }

    function updateReaderTransferConsumer(envelopeInput, consumerId, changes = {}) {
        const current = createReaderTransferEnvelope(envelopeInput);
        const id = cleanString(consumerId);
        if (!current.consumerReferences.some((item) => item.consumerId === id)) throw new Error(`reader transfer consumer not found: ${id}`);
        const references = current.consumerReferences.map((item) => item.consumerId === id ? createConsumerReference({
            ...item,
            materializedAt: changes.materializedAt === undefined ? item.materializedAt : changes.materializedAt,
            releasedAt: changes.releasedAt === undefined ? item.releasedAt : changes.releasedAt
        }) : item);
        return createReaderTransferEnvelope({ ...current, updatedAt: changes.updatedAt || current.updatedAt, consumerReferences: references });
    }

    function canDeleteArchivedReaderTransfer(envelopeInput) {
        const envelope = createReaderTransferEnvelope(envelopeInput);
        return envelope.lifecycle === 'archived' && envelope.consumerReferences.every((reference) => reference.materializedAt || reference.releasedAt);
    }

    return {
        TRANSFER_SCHEMA_VERSION,
        SNAPSHOT_SCHEMA_VERSION,
        DESTINATIONS,
        SCOPES,
        LIFECYCLES,
        createReaderTransferSnapshot,
        createReaderTransferEnvelope,
        createReaderTransferBundle,
        transitionReaderTransfer,
        addReaderTransferConsumer,
        updateReaderTransferConsumer,
        canDeleteArchivedReaderTransfer
    };
});
