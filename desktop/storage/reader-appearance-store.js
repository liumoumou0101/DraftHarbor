const crypto = require('crypto');
const fs = require('fs/promises');

const ReaderPreferences = require('../../src/core/document/reader-preferences');
const { writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');

const STORE_SCHEMA_VERSION = 1;
const MAX_PROFILES = 50;
const locks = new Map();

class ReaderAppearanceConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderAppearanceConflictError';
  }
}

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function timestamp(value, label) {
  const text = cleanString(value);
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}

function appearanceId(value) {
  const id = cleanString(value);
  if (!/^user:[a-z0-9][a-z0-9._-]{1,79}$/i.test(id)) throw new Error('reader appearance profileId is invalid');
  return id;
}

function createAppearanceId() {
  return `user:${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function normalizeProfile(input = {}, options = {}) {
  const profileId = appearanceId(input.profileId || input.id || options.profileId || createAppearanceId());
  const name = cleanString(input.name, '未命名方案').slice(0, 80) || '未命名方案';
  const preferences = ReaderPreferences.createReaderPreferencesV2({
    ...(input.preferences || {}),
    appearanceProfileId: profileId
  });
  return {
    profileId,
    name,
    preferences,
    createdAt: timestamp(input.createdAt || options.createdAt || new Date().toISOString(), 'reader appearance createdAt'),
    updatedAt: timestamp(input.updatedAt || options.updatedAt || new Date().toISOString(), 'reader appearance updatedAt')
  };
}

function normalizeRecord(input = {}) {
  if (Number(input.schemaVersion) !== STORE_SCHEMA_VERSION || input.kind !== 'reader-appearance-store') {
    throw new Error('reader appearance store schema is invalid');
  }
  const profiles = (Array.isArray(input.profiles) ? input.profiles : []).slice(0, MAX_PROFILES).map(normalizeProfile);
  const ids = new Set();
  profiles.forEach((profile) => {
    if (ids.has(profile.profileId)) throw new Error(`duplicate reader appearance profileId: ${profile.profileId}`);
    ids.add(profile.profileId);
  });
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    kind: 'reader-appearance-store',
    updatedAt: timestamp(input.updatedAt, 'reader appearance store updatedAt'),
    profiles
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

async function readReaderAppearances(dataRoot) {
  const stored = await readJsonOptional(paths.readerAppearancesPath(dataRoot));
  if (!stored) return { schemaVersion: STORE_SCHEMA_VERSION, kind: 'reader-appearance-store', updatedAt: '', profiles: [] };
  return normalizeRecord(stored);
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

async function writeReaderAppearance(dataRoot, input, options = {}) {
  const filePath = paths.readerAppearancesPath(dataRoot);
  return withLock(filePath, async () => {
    const current = await readReaderAppearances(dataRoot);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current.updatedAt)) {
      throw new ReaderAppearanceConflictError('reader appearance store updatedAt does not match');
    }
    const now = new Date().toISOString();
    const profileId = cleanString(input.profileId || input.id);
    const existing = current.profiles.find((profile) => profile.profileId === profileId);
    const profile = normalizeProfile(input, {
      profileId: profileId || undefined,
      createdAt: existing && existing.createdAt || now,
      updatedAt: now
    });
    const profiles = existing
      ? current.profiles.map((item) => item.profileId === profile.profileId ? profile : item)
      : [profile, ...current.profiles];
    if (profiles.length > MAX_PROFILES) throw new Error(`reader appearance profiles cannot exceed ${MAX_PROFILES}`);
    const record = normalizeRecord({
      schemaVersion: STORE_SCHEMA_VERSION,
      kind: 'reader-appearance-store',
      updatedAt: now,
      profiles
    });
    await writeJsonAtomic(filePath, record);
    return { record, profile };
  });
}

async function deleteReaderAppearance(dataRoot, profileId, options = {}) {
  const id = appearanceId(profileId);
  const filePath = paths.readerAppearancesPath(dataRoot);
  return withLock(filePath, async () => {
    const current = await readReaderAppearances(dataRoot);
    if (options.expectedUpdatedAt !== undefined && cleanString(options.expectedUpdatedAt) !== cleanString(current.updatedAt)) {
      throw new ReaderAppearanceConflictError('reader appearance store updatedAt does not match');
    }
    const profiles = current.profiles.filter((profile) => profile.profileId !== id);
    if (profiles.length === current.profiles.length) throw new Error('reader appearance profile not found');
    const now = new Date().toISOString();
    const record = normalizeRecord({ schemaVersion: STORE_SCHEMA_VERSION, kind: 'reader-appearance-store', updatedAt: now, profiles });
    await writeJsonAtomic(filePath, record);
    return { record, profileId: id };
  });
}

module.exports = {
  STORE_SCHEMA_VERSION,
  MAX_PROFILES,
  ReaderAppearanceConflictError,
  normalizeProfile,
  readReaderAppearances,
  writeReaderAppearance,
  deleteReaderAppearance
};
