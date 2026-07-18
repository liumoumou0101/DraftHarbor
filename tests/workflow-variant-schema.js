const assert = require('assert');
const Variant = require('../src/core/workflow/workflow-variant-schema');

const main = Variant.createVariantManifest({ variantId: 'main', label: '初版', items: [
  { scopeKey: 's1', targetSceneId: 's1', artifactId: 'a1', revisionId: 'r1' },
  { scopeKey: 's2', targetSceneId: 's2', artifactId: 'a2', revisionId: 'r2' }
] });
const alternative = Variant.createVariantManifest({ variantId: 'alt', label: '强化冲突版', items: [
  { scopeKey: 's1', targetSceneId: 's1', artifactId: 'a1', revisionId: 'r3' },
  { scopeKey: 's2', targetSceneId: 's2', artifactId: 'a2', revisionId: 'r2' }
] });
const comparison = Variant.compareVariantManifests(main, alternative);
assert.deepStrictEqual(comparison.scopes.map((item) => item.state), ['changed', 'same']);
const selection = Variant.createVariantSelection({ selections: [{ scopeKey: 's1', variantId: 'alt' }, { scopeKey: 's2', variantId: 'main' }] }, [main, alternative]);
assert.deepStrictEqual(selection.selections.map((item) => item.revisionId), ['r3', 'r2']);
assert.throws(() => Variant.createVariantManifest({ variantId: 'bad', items: [{ scopeKey: 's1', artifactId: 'a', revisionId: 'r' }, { scopeKey: 's1', artifactId: 'b', revisionId: 'r2' }] }), /duplicate variant scope/);
console.log('Workflow variant schema test passed.');
