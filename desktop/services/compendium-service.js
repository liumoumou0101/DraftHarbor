const compendiumStore = require('../storage/compendium-store');
const projectService = require('./project-service');
const CompendiumSchema = require('../../src/core/knowledge/compendium-schema');

async function ensureProject(dataRoot, projectId) {
  if (!projectId) throw new Error('projectId is required');
  await projectService.projectLocation(dataRoot, projectId);
}

function filterEntries(entries, options = {}) {
  const query = String(options.query || '').trim().toLowerCase();
  const type = String(options.type || '').trim();
  return entries.filter((entry) => {
    if (type && entry.type !== type) return false;
    if (!query) return true;
    const haystack = [
      entry.title,
      entry.summary,
      entry.body,
      entry.category,
      ...(entry.tags || []),
      ...(entry.aliases || [])
    ].join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

async function listEntries(dataRoot, projectId, options = {}) {
  await ensureProject(dataRoot, projectId);
  const entries = await compendiumStore.listEntries(dataRoot, projectId);
  return {
    ok: true,
    entries: filterEntries(entries, options),
    summaries: filterEntries(entries, options).map(CompendiumSchema.compendiumEntrySummary),
    counts: entries.reduce((acc, entry) => {
      acc[entry.type] = (acc[entry.type] || 0) + 1;
      return acc;
    }, {})
  };
}

async function saveEntry(dataRoot, projectId, entryInput = {}) {
  await ensureProject(dataRoot, projectId);
  const entry = await compendiumStore.saveEntry(dataRoot, projectId, entryInput);
  return {
    ok: true,
    entry
  };
}

async function deleteEntry(dataRoot, projectId, entryId) {
  await ensureProject(dataRoot, projectId);
  if (!entryId) throw new Error('entryId is required');
  const result = await compendiumStore.deleteEntry(dataRoot, projectId, entryId);
  return {
    ok: true,
    ...result
  };
}

async function importEntries(dataRoot, projectId, entries = []) {
  await ensureProject(dataRoot, projectId);
  const saved = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    saved.push((await saveEntry(dataRoot, projectId, entry)).entry);
  }
  return {
    ok: true,
    entries: saved
  };
}

module.exports = {
  listEntries,
  saveEntry,
  deleteEntry,
  importEntries
};
