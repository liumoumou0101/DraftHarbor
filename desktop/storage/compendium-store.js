const path = require('path');
const fs = require('fs/promises');
const { writeJsonAtomic } = require('./atomic-write');
const { projectDir } = require('./library-paths');
const CompendiumSchema = require('../../src/core/knowledge/compendium-schema');
const { withProjectWriteLock: withEntriesLock } = require('./project-write-lock');

class CompendiumConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompendiumConflictError';
  }
}

function compendiumDir(projectPath) {
  return path.join(projectPath, 'compendium');
}

function entriesPath(projectPath) {
  return path.join(compendiumDir(projectPath), 'entries.json');
}

async function readEntries(projectPath, projectId = '') {
  try {
    const entries = JSON.parse(await fs.readFile(entriesPath(projectPath), 'utf8'));
    if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
      throw new Error('compendium entries file is invalid');
    }
    return CompendiumSchema.normalizeCompendiumEntries(entries, projectId);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeEntriesUnlocked(projectPath, entries, projectId = '') {
  await fs.mkdir(compendiumDir(projectPath), { recursive: true });
  const normalized = CompendiumSchema.normalizeCompendiumEntries(entries, projectId);
  await writeJsonAtomic(entriesPath(projectPath), normalized);
  return normalized;
}

async function writeEntries(projectPath, entries, projectId = '') {
  return withEntriesLock(projectPath, () => writeEntriesUnlocked(projectPath, entries, projectId));
}

async function listEntries(dataRoot, projectId) {
  const projectPath = projectDir(dataRoot, projectId);
  return withEntriesLock(projectPath, () => readEntries(projectPath, projectId));
}

async function withEntriesTransaction(dataRoot, projectId, task) {
  const projectPath = projectDir(dataRoot, projectId);
  return withEntriesLock(projectPath, async () => {
    const entries = await readEntries(projectPath, projectId);
    let changed = false;
    let lastUpdated = entries.reduce((latest, entry) => Math.max(latest, Date.parse(entry.updatedAt) || 0), 0);
    // Mutations stay in memory until the callback (including any backup) succeeds.
    const transaction = {
      entries,
      saveEntry(entryInput = {}) {
        if (entryInput.projectId && entryInput.projectId !== projectId) throw new Error('compendium entry projectId cannot cross projects');
        const id = String(entryInput.id || '').trim();
        const index = id ? entries.findIndex((entry) => entry.id === id) : -1;
        const existing = index >= 0 ? entries[index] : null;
        if (entryInput.expectedUpdatedAt !== undefined
            && String(entryInput.expectedUpdatedAt || '') !== (existing && existing.updatedAt || '')) {
          throw new CompendiumConflictError('compendium entry has changed; reload it before saving');
        }
        const patch = Object.fromEntries(Object.entries(entryInput).filter(([, value]) => value !== undefined));
        const now = new Date(Math.max(Date.now(), lastUpdated + 1)).toISOString();
        const incoming = CompendiumSchema.createCompendiumEntry({
          ...existing, ...patch, projectId, id: id || undefined,
          order: patch.order === undefined ? (existing ? existing.order : entries.length) : patch.order,
          createdAt: existing ? existing.createdAt : patch.createdAt || now,
          updatedAt: now
        });
        if (index >= 0) entries[index] = incoming;
        else entries.push(incoming);
        lastUpdated = Date.parse(now);
        changed = true;
        return incoming;
      },
      deleteEntry(entryId) {
        const index = entries.findIndex((entry) => entry.id === entryId);
        if (index < 0) return { deleted: 0 };
        entries.splice(index, 1);
        changed = true;
        return { deleted: 1 };
      }
    };
    const result = await task(transaction);
    if (changed) await writeEntriesUnlocked(projectPath, entries, projectId);
    return result;
  });
}

async function saveEntry(dataRoot, projectId, entryInput = {}) {
  return withEntriesTransaction(dataRoot, projectId, (transaction) => transaction.saveEntry(entryInput));
}

async function saveEntriesBatch(dataRoot, projectId, entryInputs = []) {
  return withEntriesTransaction(dataRoot, projectId, (transaction) => {
    const ids = entryInputs.map((entry) => transaction.saveEntry(entry).id);
    return ids.map((id) => transaction.entries.find((entry) => entry.id === id));
  });
}

async function deleteEntry(dataRoot, projectId, entryId) {
  return withEntriesTransaction(dataRoot, projectId, (transaction) => transaction.deleteEntry(entryId));
}

module.exports = {
  CompendiumConflictError,
  withEntriesTransaction,
  entriesPath,
  readEntries,
  writeEntries,
  listEntries,
  saveEntry,
  saveEntriesBatch,
  deleteEntry
};
