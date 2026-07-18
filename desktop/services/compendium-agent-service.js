const compendiumStore = require('../storage/compendium-store');
const projectService = require('./project-service');
const CompendiumAgentPolicy = require('../../src/core/knowledge/compendium-agent-policy');

async function ensureProject(dataRoot, projectId) {
  if (!projectId) throw new Error('projectId is required');
  await projectService.projectLocation(dataRoot, projectId);
}

function normalizeEntryIds(entryIds, maxCardsPerRun) {
  const values = Array.isArray(entryIds) ? entryIds : [];
  const seen = new Set();
  const ids = [];
  values.forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  if (ids.length > maxCardsPerRun) throw new Error(`entry limit is ${maxCardsPerRun}`);
  return ids;
}

function selectEntries(entries, entryIds, maxCardsPerRun) {
  const ids = normalizeEntryIds(entryIds, maxCardsPerRun);
  const allEntries = Array.isArray(entries) ? entries : [];
  if (!ids.length) return allEntries.slice(0, maxCardsPerRun);
  const entryMap = new Map(allEntries.map((entry) => [entry.id, entry]));
  const selected = ids.map((id) => entryMap.get(id));
  if (selected.some((entry) => !entry)) throw new Error('one or more entries do not exist in this project');
  return selected;
}

async function readSnapshot(dataRoot, projectId, entryIds = [], agentSettings = {}) {
  await ensureProject(dataRoot, projectId);
  const settings = CompendiumAgentPolicy.normalizeCompendiumAgentSettings(agentSettings);
  const entries = await compendiumStore.listEntries(dataRoot, projectId);
  const selectedEntries = selectEntries(entries, entryIds, settings.maxCardsPerRun);
  return {
    ok: true,
    projectId,
    snapshot: CompendiumAgentPolicy.createAgentInputSnapshot(selectedEntries, settings)
  };
}

function applyPatch(entry, patch) {
  const next = { ...entry };
  if (Object.prototype.hasOwnProperty.call(patch, 'summary')) next.summary = patch.summary;
  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) next.tags = patch.tags.slice();
  if (Object.prototype.hasOwnProperty.call(patch, 'aliases')) next.aliases = patch.aliases.slice();
  if (Object.prototype.hasOwnProperty.call(patch, 'characterProfile')) {
    next.characterProfile = { ...(entry.characterProfile || {}), ...patch.characterProfile };
  }
  return next;
}

async function applyOperations(dataRoot, projectId, operations, options = {}) {
  await ensureProject(dataRoot, projectId);
  const settings = CompendiumAgentPolicy.normalizeCompendiumAgentSettings(options.agentSettings);
  const entries = await compendiumStore.listEntries(dataRoot, projectId);
  const validation = CompendiumAgentPolicy.validateOperationsAgainstEntries(operations, entries, {
    maxOperations: settings.maxCardsPerRun
  });
  if (!validation.ok) throw new Error(`invalid compendium agent operations: ${validation.errors.join('; ')}`);

  const operationMap = new Map(validation.operations.map((operation) => [operation.entryId, operation]));
  const nextEntries = entries.map((entry) => {
    const operation = operationMap.get(entry.id);
    return operation ? applyPatch(entry, operation.patch) : entry;
  });

  const backup = typeof options.beforeWrite === 'function'
    ? await options.beforeWrite({ projectId, entryIds: validation.operations.map((operation) => operation.entryId) })
    : null;
  const savedEntries = await compendiumStore.writeEntries(
    require('../storage/library-paths').projectDir(dataRoot, projectId),
    nextEntries,
    projectId
  );
  const savedMap = new Map(savedEntries.map((entry) => [entry.id, entry]));
  return {
    ok: true,
    entries: validation.operations.map((operation) => savedMap.get(operation.entryId)),
    appliedCount: validation.operations.length,
    backup
  };
}

module.exports = {
  readSnapshot,
  applyOperations,
  selectEntries,
  applyPatch
};
