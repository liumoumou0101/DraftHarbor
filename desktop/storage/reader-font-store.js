const crypto = require('crypto');
const fs = require('fs/promises');

const Catalog = require('../../src/core/document/reader-font-catalog');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

const STORE_SCHEMA_VERSION = 1;
const MAX_FONT_BYTES = 20 * 1024 * 1024;
const ALLOWED_FORMATS = Object.freeze(['ttf', 'otf', 'woff2']);
const DEFAULT_LICENSE_NOTICE = '请确认该字体的使用许可；稿湾只在本地保存，不会上传字体文件。';
const locks = new Map();

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function safeText(value, fallback, maximum = 120) {
  // eslint-disable-next-line no-control-regex
  const text = cleanString(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[{}\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
  return text || fallback;
}

function safeFileName(value, fallback = 'font') {
  const name = cleanString(value).split(/[\\/]/).pop() || fallback;
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160) || fallback;
}

function formatFromName(fileName) {
  const match = safeFileName(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match && ALLOWED_FORMATS.includes(match[1]) ? match[1] : '';
}

function detectFormat(bytes, fileName) {
  const extension = formatFromName(fileName);
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) throw new Error('字体文件为空或不完整');
  const signature = bytes.toString('ascii', 0, 4);
  const bySignature = signature === 'wOF2' ? 'woff2' : signature === 'OTTO' ? 'otf' : bytes.readUInt32BE(0) === 0x00010000 ? 'ttf' : '';
  if (!bySignature || !extension || bySignature !== extension) throw new Error('字体格式无效，仅支持匹配的 TTF、OTF 或 WOFF2 文件');
  return bySignature;
}

function deriveFamily(fileName) {
  const base = safeFileName(fileName).replace(/\.[^.]+$/, '').replace(/[-_](regular|book|medium|semibold|bold|italic|oblique|light)$/i, '');
    return safeText(base, '用户字体', 100);
}

function decodeFontName(bytes, platformId, offset, length) {
  const raw = bytes.subarray(offset, offset + length);
  if (platformId === 0 || platformId === 3) {
    const swapped = Buffer.alloc(raw.length - (raw.length % 2));
    for (let index = 0; index < swapped.length; index += 2) {
      swapped[index] = raw[index + 1];
      swapped[index + 1] = raw[index];
    }
    // eslint-disable-next-line no-control-regex
    return swapped.toString('utf16le').replace(/\u0000/g, '').trim();
  }
  // eslint-disable-next-line no-control-regex
  return raw.toString('latin1').replace(/\u0000/g, '').trim();
}

function sfntTable(bytes, tag) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  const count = bytes.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > bytes.length) return null;
    if (bytes.toString('ascii', recordOffset, recordOffset + 4) !== tag) continue;
    const offset = bytes.readUInt32BE(recordOffset + 8);
    const length = bytes.readUInt32BE(recordOffset + 12);
    if (offset > bytes.length || length > bytes.length - offset) return null;
    return { offset, length };
  }
  return null;
}

function parseSfntMetadata(bytes, format) {
  if (!['ttf', 'otf'].includes(format) || bytes.length < 12) return {};
  const nameTable = sfntTable(bytes, 'name');
  if (!nameTable || nameTable.length < 6) return {};
  const table = bytes.subarray(nameTable.offset, nameTable.offset + nameTable.length);
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const recordOffset = 6 + index * 12;
    if (recordOffset + 12 > table.length) break;
    const platformId = table.readUInt16BE(recordOffset);
    const languageId = table.readUInt16BE(recordOffset + 4);
    const nameId = table.readUInt16BE(recordOffset + 6);
    const length = table.readUInt16BE(recordOffset + 8);
    const offset = stringOffset + table.readUInt16BE(recordOffset + 10);
    if (offset + length > table.length) continue;
    const value = decodeFontName(table, platformId, offset, length);
    if (value) records.push({ languageId, nameId, value });
  }
  const preferred = (ids) => records
    .filter((record) => ids.includes(record.nameId))
    .sort((left, right) => {
      const leftLanguage = left.languageId === 0x0409 || left.languageId === 0 ? 0 : 1;
      const rightLanguage = right.languageId === 0x0409 || right.languageId === 0 ? 0 : 1;
      return leftLanguage - rightLanguage;
    })[0]?.value || '';
  const family = preferred([16, 1]);
  const subfamily = preferred([17, 2]);
  const fullName = preferred([4]) || family;
  const os2Table = sfntTable(bytes, 'OS/2');
  const weightClass = os2Table && os2Table.length >= 6 ? bytes.readUInt16BE(os2Table.offset + 4) : 0;
  const weightMatch = subfamily.match(/(thin|hairline|extra\s*light|ultra\s*light|light|medium|semi\s*bold|demi\s*bold|bold|extra\s*bold|ultra\s*bold|black|heavy)/i);
  const weightByName = {
    thin: 100, hairline: 100, 'extra light': 200, extralight: 200, 'ultra light': 200, ultralight: 200, light: 300,
    medium: 500, 'semi bold': 600, semibold: 600, 'demi bold': 600, demibold: 600, bold: 700,
    'extra bold': 800, extrabold: 800, 'ultra bold': 800, ultrabold: 800, black: 900, heavy: 900
  };
  const namedWeight = weightMatch && weightByName[weightMatch[1].toLowerCase().replace(/\s+/g, ' ')];
  return {
    family: family || fullName,
    displayName: fullName || family,
    weight: Number.isInteger(weightClass) && weightClass >= 100 && weightClass <= 900 ? weightClass : namedWeight || 400,
    style: /oblique/i.test(subfamily) ? 'oblique' : /italic/i.test(subfamily) ? 'italic' : 'normal'
  };
}

function normalizeStoredEntry(input = {}) {
  return Catalog.createReaderFontCatalogEntry({
    ...input,
    sourceKind: 'user',
    status: input.status || 'ready',
    family: safeText(input.family, '用户字体'),
    displayName: safeText(input.displayName, input.family || '用户字体', 100),
    fileName: safeFileName(input.fileName, 'font'),
    format: cleanString(input.format).toLowerCase(),
    fileHash: cleanString(input.fileHash),
    sizeBytes: Math.max(0, Math.floor(Number(input.sizeBytes) || 0)),
    weight: Math.max(100, Math.min(900, Math.round(Number(input.weight) || 400))),
    style: ['normal', 'italic', 'oblique'].includes(cleanString(input.style)) ? cleanString(input.style) : 'normal',
    createdAt: cleanString(input.createdAt),
    licenseNotice: safeText(input.licenseNotice, DEFAULT_LICENSE_NOTICE, 240)
  });
}

function storedCatalog(input = {}) {
  const builtins = Catalog.createBuiltinReaderFontCatalog();
  const entries = Array.isArray(input.entries) ? input.entries.map(normalizeStoredEntry) : [];
  return Catalog.createReaderFontCatalog({
    catalogVersion: input.catalogVersion,
    entries: [...builtins.entries, ...entries]
  });
}

function storedRecord(catalog) {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    kind: 'reader-font-store',
    catalogVersion: catalog.catalogVersion,
    entries: catalog.entries.filter((entry) => entry.sourceKind === 'user')
  };
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function withLock(filePath, task) {
  const previous = locks.get(filePath) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const token = previous.then(() => gate);
  locks.set(filePath, token);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(filePath) === token) locks.delete(filePath);
  }
}

async function readReaderFontCatalog(dataRoot) {
  const stored = await readJsonOptional(paths.readerFontsCatalogPath(dataRoot));
  const catalog = storedCatalog(stored || {});
  const entries = await Promise.all(catalog.entries.map(async (entry) => {
    if (entry.sourceKind === 'builtin') return entry;
    if (!ALLOWED_FORMATS.includes(entry.format)) return { ...entry, status: 'failed', errorCode: 'invalid-format' };
    try {
      await fs.access(paths.readerFontFilePath(dataRoot, entry.fontId, entry.format));
      return entry.status === 'missing' ? { ...entry, status: 'ready', errorCode: '' } : entry;
    } catch {
      return { ...entry, status: 'missing', errorCode: '' };
    }
  }));
  return Catalog.createReaderFontCatalog({ catalogVersion: catalog.catalogVersion, entries });
}

async function writeReaderFontCatalog(dataRoot, catalog) {
  await fs.mkdir(paths.readerFontsDir(dataRoot), { recursive: true });
  await writeJsonAtomic(paths.readerFontsCatalogPath(dataRoot), storedRecord(catalog));
  return catalog;
}

async function importReaderFont(dataRoot, input = {}) {
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes || '', 'base64');
  if (!bytes.length || bytes.length > MAX_FONT_BYTES) throw new Error(`字体文件大小必须在 1 字节至 ${MAX_FONT_BYTES / 1024 / 1024} MiB 之间`);
  const format = detectFormat(bytes, input.fileName);
  const metadata = parseSfntMetadata(bytes, format);
  const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const fileName = safeFileName(input.fileName, `font.${format}`);
  const fontId = `user:${fileHash.slice(0, 24)}`;
  const catalogPath = paths.readerFontsCatalogPath(dataRoot);
  return withLock(catalogPath, async () => {
    const current = await readReaderFontCatalog(dataRoot);
    const duplicate = current.entries.find((entry) => entry.sourceKind === 'user' && entry.fileHash === fileHash);
    if (duplicate) return { entry: duplicate, catalog: current, idempotent: true };
    if (input.expectedCatalogVersion !== undefined && Number(input.expectedCatalogVersion) !== current.catalogVersion) {
      throw new Error('reader font catalog version changed; reload and retry');
    }
    const now = new Date().toISOString();
    const entry = normalizeStoredEntry({
      fontId,
      displayName: input.displayName || metadata.displayName || deriveFamily(fileName),
      family: input.family || metadata.family || deriveFamily(fileName),
      format,
      fileName,
      fileHash,
      sizeBytes: bytes.length,
      weight: input.weight || metadata.weight,
      style: input.style || metadata.style,
      createdAt: now,
      licenseNotice: DEFAULT_LICENSE_NOTICE,
      status: 'ready'
    });
    await fs.mkdir(paths.readerFontsFilesDir(dataRoot), { recursive: true });
    const filePath = paths.readerFontFilePath(dataRoot, entry.fontId, entry.format);
    await fs.writeFile(filePath, bytes, { flag: 'wx' }).catch((error) => {
      if (error && error.code === 'EEXIST') return undefined;
      throw error;
    });
    const next = Catalog.createReaderFontCatalog({
      catalogVersion: current.catalogVersion + 1,
      entries: [...current.entries, entry]
    });
    try {
      await writeReaderFontCatalog(dataRoot, next);
    } catch (error) {
      await fs.rm(filePath, { force: true }).catch(() => {});
      throw error;
    }
    return { entry, catalog: next, idempotent: false };
  });
}

async function removeReaderFont(dataRoot, fontId, options = {}) {
  const id = cleanString(fontId);
  const catalogPath = paths.readerFontsCatalogPath(dataRoot);
  return withLock(catalogPath, async () => {
    const current = await readReaderFontCatalog(dataRoot);
    const entry = current.entries.find((item) => item.fontId === id);
    if (!entry) throw new Error('reader font not found');
    if (entry.sourceKind === 'builtin') throw new Error('built-in reader fonts cannot be removed');
    if (options.expectedCatalogVersion !== undefined && Number(options.expectedCatalogVersion) !== current.catalogVersion) {
      throw new Error('reader font catalog version changed; reload and retry');
    }
    await fs.rm(paths.readerFontFilePath(dataRoot, entry.fontId, entry.format), { force: true });
    const next = Catalog.createReaderFontCatalog({
      catalogVersion: current.catalogVersion + 1,
      entries: current.entries.filter((item) => item.fontId !== id)
    });
    await writeReaderFontCatalog(dataRoot, next);
    return { fontId: id, catalog: next };
  });
}

async function readReaderFontFile(dataRoot, fontId) {
  const catalog = await readReaderFontCatalog(dataRoot);
  const entry = catalog.entries.find((item) => item.fontId === cleanString(fontId));
  if (!entry || entry.sourceKind !== 'user') throw new Error('reader font file not found');
  if (!ALLOWED_FORMATS.includes(entry.format)) throw new Error('reader font file format is invalid');
  try {
    return { entry, bytes: await fs.readFile(paths.readerFontFilePath(dataRoot, entry.fontId, entry.format)) };
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('reader font file is missing');
    throw error;
  }
}

module.exports = {
  STORE_SCHEMA_VERSION,
  MAX_FONT_BYTES,
  ALLOWED_FORMATS,
  detectFormat,
  parseSfntMetadata,
  normalizeStoredEntry,
  readReaderFontCatalog,
  writeReaderFontCatalog,
  importReaderFont,
  removeReaderFont,
  readReaderFontFile
};
