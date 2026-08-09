const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const Illustration = require('../../src/core/document/reader-illustration');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

const STORE_SCHEMA_VERSION = 1;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const locks = new Map();

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

async function readJsonOptional(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
}

async function withLock(filePath, task) {
  const previous = locks.get(filePath) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const token = previous.then(() => gate);
  locks.set(filePath, token);
  await previous;
  try { return await task(); }
  finally { release(); if (locks.get(filePath) === token) locks.delete(filePath); }
}

function detectImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', mediaType: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', mediaType: 'image/jpeg' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return { extension: 'gif', mediaType: 'image/gif' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { extension: 'webp', mediaType: 'image/webp' };
  throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片');
}

function emptyRecord(documentId) {
  return { schemaVersion: STORE_SCHEMA_VERSION, kind: 'reader-illustrations', documentId, updatedAt: '', illustrations: [] };
}

function normalizeRecord(input, documentId) {
  if (!input) return emptyRecord(documentId);
  if (Number(input.schemaVersion) !== STORE_SCHEMA_VERSION || input.kind !== 'reader-illustrations' || cleanString(input.documentId) !== documentId) {
    throw new Error('reader illustration store schema is invalid');
  }
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    kind: 'reader-illustrations',
    documentId,
    updatedAt: cleanString(input.updatedAt),
    illustrations: (Array.isArray(input.illustrations) ? input.illustrations : []).map(Illustration.createReaderIllustration)
  };
}

async function readReaderIllustrations(dataRoot, documentId) {
  const id = cleanString(documentId);
  if (!id) throw new Error('reader illustration documentId is required');
  return normalizeRecord(await readJsonOptional(paths.readerDocumentIllustrationsPath(dataRoot, id)), id);
}

async function importReaderIllustration(dataRoot, input = {}) {
  const documentId = cleanString(input.documentId);
  if (!documentId) throw new Error('reader illustration documentId is required');
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(cleanString(input.bytes), 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片大小必须在 1 字节至 12 MiB 之间');
  const detected = detectImage(bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const assetId = `image:${digest.slice(0, 24)}`;
  const assetFileName = `${digest}.${detected.extension}`;
  const recordPath = paths.readerDocumentIllustrationsPath(dataRoot, documentId);
  return withLock(recordPath, async () => {
    const current = await readReaderIllustrations(dataRoot, documentId);
    const now = new Date().toISOString();
    const illustration = Illustration.createReaderIllustration({
      ...input,
      illustrationId: `illustration:${crypto.randomUUID()}`,
      documentId,
      assetId,
      fileName: path.basename(cleanString(input.fileName) || `插图.${detected.extension}`),
      mediaType: detected.mediaType,
      sizeBytes: bytes.length,
      createdAt: now,
      updatedAt: now
    });
    await fs.mkdir(paths.readerDocumentIllustrationMediaDir(dataRoot, documentId), { recursive: true });
    const assetPath = paths.readerDocumentIllustrationAssetPath(dataRoot, documentId, assetFileName);
    await fs.writeFile(assetPath, bytes, { flag: 'wx' }).catch((error) => {
      if (!error || error.code !== 'EEXIST') throw error;
    });
    const record = { ...current, updatedAt: now, illustrations: [...current.illustrations, illustration] };
    await writeJsonAtomic(recordPath, record);
    return { record: normalizeRecord(record, documentId), illustration };
  });
}

async function deleteReaderIllustration(dataRoot, documentIdInput, illustrationIdInput) {
  const documentId = cleanString(documentIdInput);
  const illustrationId = cleanString(illustrationIdInput);
  const recordPath = paths.readerDocumentIllustrationsPath(dataRoot, documentId);
  return withLock(recordPath, async () => {
    const current = await readReaderIllustrations(dataRoot, documentId);
    const removed = current.illustrations.find((item) => item.illustrationId === illustrationId);
    if (!removed) return { record: current, deleted: false };
    const illustrations = current.illustrations.filter((item) => item.illustrationId !== illustrationId);
    const now = new Date().toISOString();
    const record = { ...current, updatedAt: now, illustrations };
    await writeJsonAtomic(recordPath, record);
    if (!illustrations.some((item) => item.assetId === removed.assetId)) {
      const digest = removed.assetId.replace(/^image:/, '');
      const entries = await fs.readdir(paths.readerDocumentIllustrationMediaDir(dataRoot, documentId)).catch(() => []);
      await Promise.all(entries.filter((name) => name.startsWith(digest)).map((name) => fs.rm(
        paths.readerDocumentIllustrationAssetPath(dataRoot, documentId, name), { force: true }
      )));
    }
    return { record: normalizeRecord(record, documentId), deleted: true };
  });
}

async function readReaderIllustrationFile(dataRoot, documentId, assetId) {
  const record = await readReaderIllustrations(dataRoot, documentId);
  const entry = record.illustrations.find((item) => item.assetId === cleanString(assetId));
  if (!entry) throw new Error('reader illustration file not found');
  const digest = entry.assetId.replace(/^image:/, '');
  const entries = await fs.readdir(paths.readerDocumentIllustrationMediaDir(dataRoot, documentId));
  const fileName = entries.find((name) => name.startsWith(digest));
  if (!fileName) throw new Error('reader illustration file is missing');
  return { entry, bytes: await fs.readFile(paths.readerDocumentIllustrationAssetPath(dataRoot, documentId, fileName)) };
}

module.exports = {
  STORE_SCHEMA_VERSION,
  MAX_IMAGE_BYTES,
  detectImage,
  readReaderIllustrations,
  importReaderIllustration,
  deleteReaderIllustration,
  readReaderIllustrationFile
};
