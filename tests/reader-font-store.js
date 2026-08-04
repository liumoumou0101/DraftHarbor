const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const paths = require('../desktop/storage/library-paths');
const store = require('../desktop/storage/reader-font-store');
const Catalog = require('../src/core/document/reader-font-catalog');

function makeTtfWithNames() {
  const names = [
    [1, 'Quiet Serif'],
    [2, 'SemiBold Italic'],
    [4, 'Quiet Serif SemiBold Italic']
  ];
  const encoded = names.map(([, value]) => Buffer.from(value, 'utf16le')).map((buffer) => {
    const swapped = Buffer.alloc(buffer.length);
    for (let index = 0; index < buffer.length; index += 2) {
      swapped[index] = buffer[index + 1];
      swapped[index + 1] = buffer[index];
    }
    return swapped;
  });
  const nameTable = Buffer.alloc(6 + names.length * 12 + encoded.reduce((total, value) => total + value.length, 0));
  nameTable.writeUInt16BE(0, 0);
  nameTable.writeUInt16BE(names.length, 2);
  nameTable.writeUInt16BE(6 + names.length * 12, 4);
  let stringOffset = 0;
  names.forEach(([nameId], index) => {
    const recordOffset = 6 + index * 12;
    nameTable.writeUInt16BE(3, recordOffset);
    nameTable.writeUInt16BE(1, recordOffset + 2);
    nameTable.writeUInt16BE(0x0409, recordOffset + 4);
    nameTable.writeUInt16BE(nameId, recordOffset + 6);
    nameTable.writeUInt16BE(encoded[index].length, recordOffset + 8);
    nameTable.writeUInt16BE(stringOffset, recordOffset + 10);
    encoded[index].copy(nameTable, nameTable.readUInt16BE(4) + stringOffset);
    stringOffset += encoded[index].length;
  });
  const font = Buffer.alloc(12 + 16 + nameTable.length);
  font.writeUInt32BE(0x00010000, 0);
  font.writeUInt16BE(1, 4);
  font.write('name', 12, 4, 'ascii');
  font.writeUInt32BE(28, 20);
  font.writeUInt32BE(nameTable.length, 24);
  nameTable.copy(font, 28);
  return font;
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-font-store-'));
  const bytes = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 7)]);
  try {
    const imported = await store.importReaderFont(dataRoot, {
      fileName: '..\\unsafe\\Quiet Serif.woff2',
      bytes
    });
    assert.strictEqual(imported.idempotent, false);
    assert.ok(imported.entry.fontId.startsWith('user:'));
    assert.strictEqual(imported.entry.format, 'woff2');
    assert.strictEqual(imported.entry.fileName, 'Quiet Serif.woff2');
    assert.strictEqual(imported.entry.sizeBytes, bytes.length);
    assert.ok(imported.entry.licenseNotice.includes('使用许可'));
    assert.strictEqual(imported.catalog.entries.filter((entry) => entry.sourceKind === 'user').length, 1);

    const metadata = store.parseSfntMetadata(makeTtfWithNames(), 'ttf');
    assert.deepStrictEqual(metadata, {
      family: 'Quiet Serif',
      displayName: 'Quiet Serif SemiBold Italic',
      weight: 600,
      style: 'italic'
    });

    const duplicate = await store.importReaderFont(dataRoot, { fileName: 'copy.woff2', bytes });
    assert.strictEqual(duplicate.idempotent, true);
    assert.strictEqual(duplicate.entry.fontId, imported.entry.fontId);

    const file = await store.readReaderFontFile(dataRoot, imported.entry.fontId);
    assert.deepStrictEqual(file.bytes, bytes);
    const filePath = paths.readerFontFilePath(dataRoot, imported.entry.fontId, imported.entry.format);
    await fs.rm(filePath);
    const missing = await store.readReaderFontCatalog(dataRoot);
    assert.strictEqual(missing.entries.find((entry) => entry.fontId === imported.entry.fontId).status, 'missing');

    await assert.rejects(
      () => store.importReaderFont(dataRoot, { fileName: 'wrong.woff2', bytes: Buffer.from('OTTO0000') }),
      /格式无效/
    );
    await assert.rejects(
      () => store.removeReaderFont(dataRoot, imported.entry.fontId, { expectedCatalogVersion: 1 }),
      /version changed/
    );
    const removed = await store.removeReaderFont(dataRoot, imported.entry.fontId);
    assert.strictEqual(removed.catalog.entries.some((entry) => entry.fontId === imported.entry.fontId), false);
    const malformed = store.normalizeStoredEntry({
      fontId: 'user:malformed',
      family: 'Malformed',
      format: '../../escape'
    });
    await store.writeReaderFontCatalog(dataRoot, Catalog.createReaderFontCatalog({
      catalogVersion: removed.catalog.catalogVersion,
      entries: [...Catalog.createBuiltinReaderFontCatalog().entries, malformed]
    }));
    const malformedCatalog = await store.readReaderFontCatalog(dataRoot);
    assert.strictEqual(malformedCatalog.entries.find((entry) => entry.fontId === 'user:malformed').status, 'failed');
    await assert.rejects(() => store.readReaderFontFile(dataRoot, 'user:malformed'), /format is invalid/);
    const escaped = paths.readerFontFilePath(dataRoot, '../escape', 'woff2');
    assert.strictEqual(path.dirname(escaped), paths.readerFontsFilesDir(dataRoot));
    console.log('Reader font store tests passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Reader font store tests failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
