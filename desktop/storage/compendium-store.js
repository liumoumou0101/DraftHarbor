const path = require('path');
const fs = require('fs/promises');
const { writeJsonAtomic } = require('./atomic-write');
const { projectDir } = require('./library-paths');
const CompendiumSchema = require('../../src/core/knowledge/compendium-schema');

function compendiumDir(projectPath) {
  return path.join(projectPath, 'compendium');
}

function entriesPath(projectPath) {
  return path.join(compendiumDir(projectPath), 'entries.json');
}

async function readEntries(projectPath, projectId = '') {
  try {
    const entries = JSON.parse(await fs.readFile(entriesPath(projectPath), 'utf8'));
    return CompendiumSchema.normalizeCompendiumEntries(entries, projectId);
  } catch {
    return [];
  }
}

async function writeEntries(projectPath, entries, projectId = '') {
  await fs.mkdir(compendiumDir(projectPath), { recursive: true });
  const normalized = CompendiumSchema.normalizeCompendiumEntries(entries, projectId);
  await writeJsonAtomic(entriesPath(projectPath), normalized);
  return normalized;
}

async function listEntries(dataRoot, projectId) {
  return readEntries(projectDir(dataRoot, projectId), projectId);
}

async function saveEntry(dataRoot, projectId, entryInput = {}) {
  const projectPath = projectDir(dataRoot, projectId);
  const entries = await readEntries(projectPath, projectId);
  const now = new Date().toISOString();
  const incoming = CompendiumSchema.createCompendiumEntry({
    ...entryInput,
    projectId,
    id: entryInput.id || undefined,
    createdAt: entryInput.createdAt || now,
    updatedAt: now
  });
  const index = entries.findIndex((entry) => entry.id === incoming.id);
  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      ...incoming,
      createdAt: entries[index].createdAt || incoming.createdAt,
      updatedAt: now
    };
  } else {
    entries.push({
      ...incoming,
      order: Number.isFinite(Number(entryInput.order)) ? Number(entryInput.order) : entries.length
    });
  }
  const saved = await writeEntries(projectPath, entries, projectId);
  return saved.find((entry) => entry.id === incoming.id);
}

async function deleteEntry(dataRoot, projectId, entryId) {
  const projectPath = projectDir(dataRoot, projectId);
  const entries = await readEntries(projectPath, projectId);
  const next = entries.filter((entry) => entry.id !== entryId);
  await writeEntries(projectPath, next, projectId);
  return { deleted: entries.length - next.length };
}

module.exports = {
  entriesPath,
  readEntries,
  writeEntries,
  listEntries,
  saveEntry,
  deleteEntry
};
