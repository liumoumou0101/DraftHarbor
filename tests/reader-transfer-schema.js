const assert = require('assert');
const crypto = require('crypto');

const Transfer = require('../src/core/document/reader-transfer-schema');

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

const createdAt = '2026-07-16T08:00:00.000Z';
const locator = {
  documentId: 'reader-book',
  revisionId: 'revision-1',
  chapterId: 'chapter-1',
  blockId: 'block-1',
  offset: 2
};
const bundle = Transfer.createReaderTransferBundle({
  envelope: {
    envelopeId: 'envelope-1',
    createdAt,
    destination: 'writer',
    sourceKind: 'local-text',
    documentId: 'reader-book',
    revisionId: 'revision-1',
    sourceRevisionDigest: 'sha256:source-revision',
    format: 'txt',
    scope: 'selection',
    sourceLocators: [locator]
  },
  snapshot: {
    sourceTitle: '测试来源',
    sections: [{ sectionId: 'section-1', title: '第一章', chapterId: 'chapter-1', characterCount: 4 }]
  },
  text: '正文\r\n片段'
}, { digest });

assert.strictEqual(bundle.text, '正文\n片段');
assert.strictEqual(bundle.envelope.characterCount, bundle.text.length);
assert.strictEqual(bundle.envelope.snapshotRef, 'reader-transfer:envelope-1:snapshot');
assert.ok(bundle.envelope.snapshotDigest.startsWith('sha256:'));
assert.ok(bundle.snapshot.textDigest.startsWith('sha256:'));
assert.ok(Object.isFrozen(bundle.envelope));
assert.ok(Object.isFrozen(bundle.snapshot.sections[0]));

const withConsumer = Transfer.addReaderTransferConsumer(bundle.envelope, {
  consumerId: 'consumer-1',
  destination: 'writer',
  referenceId: 'writer-import-1',
  createdAt: '2026-07-16T08:01:00.000Z'
});
assert.strictEqual(Transfer.canDeleteArchivedReaderTransfer(withConsumer), false);
assert.throws(
  () => Transfer.transitionReaderTransfer(withConsumer, 'consumed', { updatedAt: '2026-07-16T08:02:00.000Z' }),
  /materialized consumer/
);
const materialized = Transfer.updateReaderTransferConsumer(withConsumer, 'consumer-1', {
  materializedAt: '2026-07-16T08:02:00.000Z',
  updatedAt: '2026-07-16T08:02:00.000Z',
  referenceId: 'must-not-change',
  destination: 'workflow'
});
assert.strictEqual(materialized.consumerReferences[0].referenceId, 'writer-import-1', 'consumer identity must remain immutable');
assert.strictEqual(materialized.consumerReferences[0].destination, 'writer');
const consumed = Transfer.transitionReaderTransfer(materialized, 'consumed', { updatedAt: '2026-07-16T08:02:00.000Z' });
const archived = Transfer.transitionReaderTransfer(consumed, 'archived', { updatedAt: '2026-07-16T08:03:00.000Z' });
assert.strictEqual(Transfer.canDeleteArchivedReaderTransfer(archived), true);
assert.throws(() => Transfer.transitionReaderTransfer(archived, 'active'), /cannot transition/);
assert.throws(() => Transfer.addReaderTransferConsumer(archived, {
  consumerId: 'late', destination: 'writer', referenceId: 'late', createdAt
}), /cannot add consumers/);

assert.throws(() => Transfer.createReaderTransferBundle({
  envelope: { ...bundle.envelope, envelopeId: 'bad-destination', destination: 'email', snapshotDigest: '' },
  snapshot: { sourceTitle: 'x', sections: [{ sectionId: 'one' }] },
  text: 'x'
}, { digest }), /destination is not supported/);
assert.throws(() => Transfer.createReaderTransferBundle({
  envelope: { ...bundle.envelope, envelopeId: 'bad-locator', sourceLocators: [{ ...locator, documentId: 'other' }], snapshotDigest: '' },
  snapshot: { sourceTitle: 'x', sections: [{ sectionId: 'one' }] },
  text: 'x'
}, { digest }), /locators must match/);
assert.throws(() => Transfer.createReaderTransferBundle({
  envelope: {
    ...bundle.envelope,
    envelopeId: 'project-envelope',
    sourceKind: 'project',
    format: 'project',
    documentId: 'project:one',
    snapshotDigest: '',
    sourceLocators: [{ ...locator, documentId: 'project:one' }]
  },
  snapshot: { sourceTitle: 'project', sections: [{ sectionId: 'one' }] },
  text: 'x'
}, { digest }), /requires sourceUnits/);
assert.throws(() => Transfer.createReaderTransferBundle({
  envelope: { ...bundle.envelope, envelopeId: 'tampered', snapshotDigest: 'sha256:wrong' },
  snapshot: { sourceTitle: 'x', sections: [{ sectionId: 'one' }] },
  text: 'x'
}, { digest }), /digest does not match/);

console.log('Reader transfer schema tests passed.');
