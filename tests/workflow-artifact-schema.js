const assert = require('assert');
const ArtifactSchema = require('../src/core/workflow/workflow-artifact-schema');

const family = ArtifactSchema.createWorkflowArtifactFamily({
  id: 'artifact-1',
  projectId: 'project-1',
  runId: 'run-1',
  nodeId: 'draft',
  artifactType: 'draft-batch@1',
  title: '第一批正文',
  createdAt: '2026-07-14T00:00:00.000Z'
});
assert.strictEqual(ArtifactSchema.validateWorkflowArtifactFamily(family).ok, true);
assert.strictEqual(ArtifactSchema.artifactTypeKey(family.artifactType), 'draft-batch@1');

const draft = ArtifactSchema.createWorkflowArtifactRevision({
  id: 'revision-1',
  artifactId: family.id,
  payload: {
    format: 'text',
    contentRef: 'content/revision-1.txt',
    digest: 'sha256:one',
    byteLength: 1200
  },
  providerSnapshot: {
    providerProfileId: 'profile-1',
    provider: 'example',
    model: 'novel-model',
    parameters: {
      temperature: 0.8,
      apiKey: 'must-not-survive',
      nested: { token: 'must-not-survive', topP: 0.9 }
    }
  },
  createdAt: '2026-07-14T00:00:00.000Z'
});
assert.strictEqual(ArtifactSchema.validateWorkflowArtifactRevision(draft).ok, true);
assert.strictEqual(draft.providerSnapshot.parameters.apiKey, undefined);
assert.strictEqual(draft.providerSnapshot.parameters.nested.token, undefined);
assert.strictEqual(draft.providerSnapshot.parameters.nested.topP, 0.9);

assert.throws(
  () => ArtifactSchema.updateDraftRevision(draft, { reviewState: 'approved' }),
  (error) => error.name === 'WorkflowArtifactReviewStateError'
);

const approved = ArtifactSchema.approveArtifactRevision(draft, '2026-07-14T01:00:00.000Z');
assert.strictEqual(approved.reviewState, 'approved');
assert.strictEqual(approved.approvedAt, '2026-07-14T01:00:00.000Z');
assert.throws(
  () => ArtifactSchema.updateDraftRevision(approved, { summary: '不能覆盖已批准版本' }),
  (error) => error.name === 'WorkflowArtifactImmutableError'
);

const appliedAndStale = ArtifactSchema.createWorkflowArtifactRevision({
  ...approved,
  freshness: 'stale',
  applicationState: 'applied'
});
assert.strictEqual(appliedAndStale.reviewState, 'approved');
assert.strictEqual(appliedAndStale.freshness, 'stale');
assert.strictEqual(appliedAndStale.applicationState, 'applied');
assert.strictEqual(ArtifactSchema.validateWorkflowArtifactRevision(appliedAndStale).ok, true);

const child = ArtifactSchema.createChildArtifactRevision(approved, {
  id: 'revision-2',
  reviewState: 'approved',
  freshness: 'stale',
  applicationState: 'applied',
  archiveState: 'archived',
  payload: {
    format: 'text',
    contentRef: 'content/revision-2.txt',
    digest: 'sha256:two'
  }
});
assert.strictEqual(child.parentRevisionId, approved.id);
assert.strictEqual(child.reviewState, 'draft');
assert.strictEqual(child.freshness, 'fresh');
assert.strictEqual(child.applicationState, 'unapplied');
assert.strictEqual(child.archiveState, 'active');

const attached = ArtifactSchema.attachRevisionToArtifact(family, child);
assert.deepStrictEqual(attached.revisionIds, ['revision-2']);

const duplicateBindings = ArtifactSchema.validateArtifactBindings([
  { id: 'binding-1', projectId: 'project-1', slotKey: 'active-outline', artifactId: 'a', revisionId: 'r1' },
  { id: 'binding-2', projectId: 'project-1', slotKey: 'active-outline', artifactId: 'b', revisionId: 'r2' }
]);
assert.strictEqual(duplicateBindings.ok, false);
assert.ok(duplicateBindings.errors.some((error) => error.includes('duplicate active binding slot')));

console.log('Workflow artifact schema test passed.');
