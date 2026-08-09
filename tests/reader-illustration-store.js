const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const store = require('../desktop/storage/reader-illustration-store');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-illustration-'));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 3)]);
  try {
    const first = await store.importReaderIllustration(dataRoot, {
      documentId: 'project:test', chapterId: 'chapter-1', blockId: 'block-1', offset: 0,
      excerpt: '触发段落', fileName: '..\\unsafe\\forest.png', bytes: png.toString('base64')
    });
    assert.strictEqual(first.record.illustrations.length, 1);
    assert.strictEqual(first.illustration.mediaType, 'image/png');
    assert.strictEqual(first.illustration.fileName, 'forest.png');
    const second = await store.importReaderIllustration(dataRoot, {
      documentId: 'project:test', chapterId: 'chapter-1', blockId: 'block-1', offset: 0,
      fileName: 'forest-copy.png', bytes: png.toString('base64')
    });
    assert.strictEqual(second.record.illustrations.length, 2);
    assert.strictEqual(second.record.illustrations[0].assetId, second.record.illustrations[1].assetId, 'identical images should share one asset');
    const file = await store.readReaderIllustrationFile(dataRoot, 'project:test', first.illustration.assetId);
    assert.deepStrictEqual(file.bytes, png);
    const removedOne = await store.deleteReaderIllustration(dataRoot, 'project:test', first.illustration.illustrationId);
    assert.strictEqual(removedOne.record.illustrations.length, 1);
    assert.deepStrictEqual((await store.readReaderIllustrationFile(dataRoot, 'project:test', first.illustration.assetId)).bytes, png, 'shared asset must remain while referenced');
    const removedTwo = await store.deleteReaderIllustration(dataRoot, 'project:test', second.illustration.illustrationId);
    assert.strictEqual(removedTwo.record.illustrations.length, 0);
    await assert.rejects(() => store.readReaderIllustrationFile(dataRoot, 'project:test', first.illustration.assetId), /not found/);
    await assert.rejects(() => store.importReaderIllustration(dataRoot, {
      documentId: 'project:test', chapterId: 'chapter-1', blockId: 'block-1', bytes: Buffer.from('not-image').toString('base64')
    }), /仅支持/);
    console.log('Reader illustration store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
