const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const store = require('../desktop/storage/reader-appearance-store');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-appearance-'));
  try {
    const empty = await store.readReaderAppearances(dataRoot);
    assert.deepStrictEqual(empty.profiles, []);
    const first = await store.writeReaderAppearance(dataRoot, {
      name: '夜读',
      preferences: { themeId: 'oled', fontSize: 21 }
    }, { expectedUpdatedAt: '' });
    assert.ok(/^user:/.test(first.profile.profileId));
    assert.strictEqual(first.profile.preferences.themeId, 'oled');
    const second = await store.writeReaderAppearance(dataRoot, {
      profileId: first.profile.profileId,
      name: '夜读增强',
      preferences: { themeId: 'ink', fontSize: 22 }
    }, { expectedUpdatedAt: first.record.updatedAt });
    assert.strictEqual(second.record.profiles.length, 1);
    assert.strictEqual(second.profile.name, '夜读增强');
    await assert.rejects(
      () => store.deleteReaderAppearance(dataRoot, first.profile.profileId, { expectedUpdatedAt: first.record.updatedAt }),
      (error) => error instanceof store.ReaderAppearanceConflictError
    );
    const deleted = await store.deleteReaderAppearance(dataRoot, first.profile.profileId, { expectedUpdatedAt: second.record.updatedAt });
    assert.strictEqual(deleted.record.profiles.length, 0);
    assert.throws(() => store.normalizeProfile({ profileId: 'bad', preferences: {} }), /profileId/);
    console.log('Reader appearance store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader appearance store tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
