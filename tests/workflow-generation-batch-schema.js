const assert = require('assert');
const BatchSchema = require('../src/core/workflow/workflow-generation-batch-schema');

assert.strictEqual(BatchSchema.batchIdForSequence(2), 'batch-0002');
assert.strictEqual(BatchSchema.countTextCharacters('  第一场正文。  '), 6);

const first = BatchSchema.requireGenerationBatch({
  batchId: 'batch-0001',
  sequence: 1,
  status: 'waiting_decision',
  targetCharacters: 120000,
  plannedCharacters: 8000,
  planRef: { artifactId: 'plan-batch-1', revisionId: 'plan-r1' },
  draftRefs: [
    { artifactId: 'draft-batch-1-scene-1', revisionId: 'draft-r1', sceneId: 'scene-1', sequence: 1, characters: 3100 },
    { artifactId: 'draft-batch-1-scene-2', revisionId: 'draft-r2', sceneId: 'scene-2', sequence: 2, characters: 2900 }
  ],
  reviewRef: { artifactId: 'review-batch-1', revisionId: 'review-r1' },
  batchCharacters: 6000,
  cumulativeCharacters: 6000
});
assert.strictEqual(first.kind, 'generation-batch');
assert.strictEqual(first.draftRefs.length, 2);
assert.strictEqual(first.batchCharacters, 6000);

const second = BatchSchema.requireGenerationBatch({
  batchId: 'batch-0002',
  sequence: 2,
  status: 'planning',
  targetCharacters: 120000,
  cumulativeCharacters: 6000
});
assert.deepStrictEqual(
  BatchSchema.createGenerationBatchSet([second, first]).map((batch) => batch.batchId),
  ['batch-0001', 'batch-0002']
);

assert.throws(() => BatchSchema.requireGenerationBatch({
  batchId: 'broken',
  status: 'reviewing'
}), /requires planRef/);
assert.throws(() => BatchSchema.requireGenerationBatch({
  batchId: 'unknown-status',
  status: 'teleporting'
}), /unknown generation batch status/);
assert.throws(() => BatchSchema.requireGenerationBatch({
  ...first,
  batchCharacters: 1
}), /must match draftRefs characters/);
assert.throws(() => BatchSchema.requireGenerationBatch({
  batchId: 'broken-completed',
  status: 'completed',
  planRef: { artifactId: 'plan', revisionId: 'plan-r1' },
  draftRefs: [{ artifactId: 'draft', revisionId: 'draft-r1' }],
  reviewRef: { artifactId: 'review', revisionId: 'review-r1' }
}), /terminationReason/);
assert.throws(() => BatchSchema.createGenerationBatchSet([
  first,
  { ...second, batchId: first.batchId }
]), /duplicate generation batch id/);
assert.throws(() => BatchSchema.createGenerationBatchSet([
  first,
  { ...second, cumulativeCharacters: 100 }
]), /must not decrease/);

console.log('Workflow generation batch schema test passed.');
