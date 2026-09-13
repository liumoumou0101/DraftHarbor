const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const compendiumStore = require('../storage/compendium-store');
const { readWorkshopProjectContext, assertWorkshopBackupSources } = require('../storage/workshop-project-reader');
const paths = require('../storage/library-paths');
const { writeFileAtomic, writeJsonAtomic } = require('../storage/atomic-write');
const { withProjectWriteLock } = require('../storage/project-write-lock');
const CompendiumSchema = require('../../src/core/knowledge/compendium-schema');

const ENTRY_FIELDS = ['title', 'type', 'body', 'summary', 'tags', 'aliases', 'characterProfile'];
const PROFILE_FIELDS = ['role', 'goal', 'motivation', 'conflict', 'voice', 'currentState', 'knowledge', 'relationshipNotes'];
const MAX_CHANGES = 10;

class WorkshopEditError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = statusCode === 409 ? 'WorkshopEditConflictError' : 'WorkshopEditError';
    this.statusCode = statusCode;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, stableValue(value[key])]));
  return value;
}

function revision(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function revisionForScene(scene) { return revision(scene); }
function revisionForEntry(entry) { return revision(entry); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function conflict(message) { throw new WorkshopEditError(message, 409); }

function identifier(value, label) {
  if (typeof value !== 'string' || !value || value !== paths.sanitizePathSegment(value)
      || value === '.' || value === '..' || value.startsWith('.')) throw new WorkshopEditError(`${label} is invalid`);
  return value;
}

function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.includes(key))) throw new WorkshopEditError(`${label} contains invalid or unknown fields`);
}

function text(value, label, limit, nonempty = false) {
  if (typeof value !== 'string' || value.length > limit || (nonempty && !value.trim())) {
    throw new WorkshopEditError(`${label} must be ${nonempty ? 'nonempty ' : ''}text within ${limit} characters`);
  }
}

function validatePatch(patch, scene = false) {
  record(patch, scene ? ['content', 'summary'] : ENTRY_FIELDS, 'patch');
  if (!Object.keys(patch).length) throw new WorkshopEditError('patch must contain a change');
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'tags' || key === 'aliases') {
      if (!Array.isArray(value) || value.length > 40) throw new WorkshopEditError(`${key} must contain at most 40 strings`);
      value.forEach((item) => text(item, key, 100));
    } else if (key === 'characterProfile') {
      record(value, PROFILE_FIELDS, key);
      Object.values(value).forEach((item) => text(item, key, 2000));
    } else if (key === 'type') {
      if (!CompendiumSchema.ENTRY_TYPES.includes(value)) throw new WorkshopEditError('entry type is invalid');
    } else {
      text(value, key, key === 'content' ? 100000 : key === 'body' ? 30000 : key === 'title' ? 200 : 10000, key === 'title');
    }
  }
}

function nextTimestamp(records) {
  return new Date(Math.max(Date.now(), ...records.map((item) => (Date.parse(item && item.updatedAt) || 0) + 1))).toISOString();
}

async function readJson(target, optional = false) {
  try { return JSON.parse(await fs.readFile(target, 'utf8')); } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function projectContext(dataRoot, projectId, sessionId) {
  return readWorkshopProjectContext(dataRoot, { projectId, sessionId });
}

function statePath(projectPath, kind, id) {
  identifier(id, kind);
  return path.join(projectPath, 'workshop', 'edits', kind, `${id}.json`);
}

function assertBinding(value, projectId, sessionId) {
  if (!value || value.projectId !== projectId || value.sessionId !== sessionId) throw new WorkshopEditError('proposal or receipt belongs to another project/session');
}

function publicProposal(proposal) {
  const { proposalId, projectId, sessionId, createdAt, changes } = proposal;
  return clone({ proposalId, projectId, sessionId, createdAt, changes });
}

function publicReceipt(receipt) {
  const { receiptId, proposalId, projectId, sessionId, status, changes, backup, createdAt, undoneAt } = receipt;
  return clone({ receiptId, proposalId, projectId, sessionId, status, changes, backup, createdAt, undoneAt });
}

function prepareChanges(context, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > MAX_CHANGES) throw new WorkshopEditError(`changes must contain 1-${MAX_CHANGES} operations`);
  if (JSON.stringify(changes).length > 200000) throw new WorkshopEditError('change batch is too large');
  const seen = new Set();
  const now = nextTimestamp([...context.project.scenes, ...context.entries]);
  return changes.map((operation) => {
    record(operation, ['kind', 'sceneId', 'entryId', 'expectedRevision', 'patch', 'entry', 'reason'], 'operation');
    if (operation.reason !== undefined) text(operation.reason, 'reason', 1000);
    const allowed = operation.kind === 'scene.update'
      ? ['kind', 'sceneId', 'expectedRevision', 'patch', 'reason']
      : operation.kind === 'compendium.update' ? ['kind', 'entryId', 'expectedRevision', 'patch', 'reason']
        : operation.kind === 'compendium.create' ? ['kind', 'entry', 'reason'] : [];
    if (!allowed.length) throw new WorkshopEditError('operation kind is not allowed');
    record(operation, allowed, 'operation');
    const isScene = operation.kind === 'scene.update';
    const creating = operation.kind === 'compendium.create';
    const id = creating ? `entry-${crypto.randomUUID()}` : identifier(isScene ? operation.sceneId : operation.entryId, 'target id');
    const key = `${isScene ? 'scene' : 'entry'}:${id}`;
    if (seen.has(key)) throw new WorkshopEditError('each target may occur only once per proposal');
    seen.add(key);
    const before = creating ? null : (isScene ? context.project.scenes : context.entries).find((item) => item.id === id);
    if (!creating && !before) conflict('target does not exist in the current project');
    if (before && !isScene && before.projectId !== context.project.id) throw new WorkshopEditError('entry belongs to another project');
    const beforeRevision = before ? revision(before) : null;
    if (!creating && (typeof operation.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(operation.expectedRevision))) {
      throw new WorkshopEditError('expectedRevision from a current read is required');
    }
    if (!creating && operation.expectedRevision !== beforeRevision) conflict('target has changed since it was read');
    const patch = creating ? operation.entry : operation.patch;
    validatePatch(patch, isScene);
    if (creating && !patch.title) throw new WorkshopEditError('new entries require a title');
    let after;
    if (isScene) {
      after = { ...before, ...patch, updatedAt: now };
      if (patch.content !== undefined && patch.content !== before.content) after.summaryStale = true;
      if (patch.summary !== undefined) Object.assign(after, { summary: patch.summary.trim(), summarySource: 'workshop-agent', summaryUpdated: now, summaryStale: false });
    } else {
      after = CompendiumSchema.createCompendiumEntry({
        ...before, ...patch, id, projectId: context.project.id,
        characterProfile: patch.characterProfile ? { ...before && before.characterProfile, ...patch.characterProfile } : before && before.characterProfile,
        order: before ? before.order : context.entries.length + seen.size - 1,
        createdAt: before ? before.createdAt : now, updatedAt: now
      });
    }
    return { kind: operation.kind, ...(isScene ? { sceneId: id } : { entryId: id }), reason: operation.reason || '', before: clone(before), after: clone(after), beforeRevision, afterRevision: revision(after) };
  });
}

function validateCurrent(context, changes, undo = false) {
  for (const change of changes) {
    const isScene = change.kind === 'scene.update';
    const current = (isScene ? context.project.scenes : context.entries).find((item) => item.id === (isScene ? change.sceneId : change.entryId));
    const expected = undo ? change.afterRevision : change.beforeRevision;
    if ((current ? revision(current) : null) !== expected) conflict(`${isScene ? 'scene' : 'entry'} has changed; refresh the proposal before ${undo ? 'undo' : 'apply'}`);
  }
}

async function checkedFile(projectPath, target) {
  const relative = path.relative(projectPath, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new WorkshopEditError('edit target is outside the project');
  let cursor = projectPath;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new WorkshopEditError('edit targets cannot be symbolic links');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { return await fs.readFile(target, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function planFiles(context, changes, undo = false) {
  const files = [];
  const changedChapters = new Set();
  let entries = clone(context.entries);
  let entriesChanged = false;
  const now = nextTimestamp([context.project, ...context.project.chapters, ...context.project.scenes, ...entries]);
  const add = async (target, after) => files.push({ target, before: await checkedFile(context.projectPath, target), after });
  for (const change of changes) {
    let desired = clone(undo ? change.before : change.after);
    if (undo && desired) desired.updatedAt = now;
    if (change.kind === 'scene.update') {
      const current = context.project.scenes.find((scene) => scene.id === change.sceneId);
      if (desired.content !== current.content || desired.summary !== current.summary) changedChapters.add(current.chapterId);
      const { content, ...meta } = desired;
      await add(paths.sceneMetaPath(context.projectPath, change.sceneId), `${JSON.stringify(meta, null, 2)}\n`);
      await add(paths.sceneMarkdownPath(context.projectPath, change.sceneId), content);
    } else {
      entriesChanged = true;
      const index = entries.findIndex((item) => item.id === change.entryId);
      if (desired && index >= 0) entries[index] = desired;
      else if (desired) entries.push(desired);
      else entries = entries.filter((item) => item.id !== change.entryId);
    }
  }
  if (changes.some((change) => change.kind === 'scene.update')) {
    // Touch only current metadata. Undo also invalidates chapter summaries: a
    // summary generated after apply describes the applied text, not its undo.
    for (const chapterId of changedChapters) {
      identifier(chapterId, 'chapterId');
      const target = paths.chapterPath(context.projectPath, chapterId);
      const chapter = JSON.parse(await checkedFile(context.projectPath, target));
      if (!chapter || chapter.id !== chapterId) throw new WorkshopEditError('chapter metadata is invalid');
      if (chapter.summary) await add(target, `${JSON.stringify({ ...chapter, summaryStale: true, updatedAt: now }, null, 2)}\n`);
    }
    const target = paths.manifestPath(context.projectPath);
    const manifest = JSON.parse(await checkedFile(context.projectPath, target));
    await add(target, `${JSON.stringify({ ...manifest, updatedAt: now }, null, 2)}\n`);
  }
  if (entriesChanged) await add(compendiumStore.entriesPath(context.projectPath), `${JSON.stringify(CompendiumSchema.normalizeCompendiumEntries(entries, context.project.id), null, 2)}\n`);
  return files;
}

async function restoreFiles(files) {
  const failures = [];
  for (const file of [...files].reverse()) {
    try {
      if (file.before === null) await fs.rm(file.target, { force: true });
      else await writeFileAtomic(file.target, file.before, 'utf8');
    } catch (error) { failures.push(error.message); }
  }
  return failures;
}

async function commitFiles(receiptPath, receipt, files, undo = false) {
  // The journal contains original bytes before the first write. A crash leaves a
  // non-success status and blocks retries; a caught failure rolls the batch back.
  const pending = { ...receipt, status: undo ? 'undoing' : 'applying', files };
  await writeJsonAtomic(receiptPath, pending);
  try {
    for (const file of files) await writeFileAtomic(file.target, file.after, 'utf8');
    const completed = { ...pending, status: undo ? 'undone' : 'applied', ...(undo ? { undoneAt: new Date().toISOString() } : {}) };
    await writeJsonAtomic(receiptPath, completed);
    return publicReceipt(completed);
  } catch (error) {
    const failures = await restoreFiles(files);
    const failed = { ...pending, status: failures.length ? 'recovery-required' : undo ? 'applied' : 'rolled-back', error: error.message, rollbackErrors: failures };
    try { await writeJsonAtomic(receiptPath, failed); } catch (journalError) { failures.push(journalError.message); }
    const failure = new WorkshopEditError(failures.length ? 'edit failed; recovery is required from the saved change journal' : 'edit failed; the complete batch was rolled back', 500);
    failure.receiptId = receipt.receiptId;
    throw failure;
  }
}

function createWorkshopEditService({ createBackup } = {}) {
  async function preview(dataRoot, { projectId, sessionId, changes } = {}) {
    identifier(projectId, 'projectId');
    identifier(sessionId, 'sessionId');
    const projectPath = paths.projectDir(dataRoot, projectId);
    return withProjectWriteLock(projectPath, async () => {
      const context = await projectContext(dataRoot, projectId, sessionId);
      const proposal = { proposalId: `proposal-${crypto.randomUUID()}`, projectId, sessionId, createdAt: new Date().toISOString(), changes: prepareChanges(context, changes) };
      const target = statePath(projectPath, 'proposals', proposal.proposalId);
      await checkedFile(projectPath, target);
      await writeJsonAtomic(target, proposal);
      return publicProposal(proposal);
    });
  }

  async function apply(dataRoot, { projectId, sessionId, proposal } = {}) {
    identifier(projectId, 'projectId');
    identifier(sessionId, 'sessionId');
    const projectPath = paths.projectDir(dataRoot, projectId);
    return withProjectWriteLock(projectPath, async () => {
      const context = await projectContext(dataRoot, projectId, sessionId);
      const proposalPath = statePath(projectPath, 'proposals', proposal && proposal.proposalId);
      await checkedFile(projectPath, proposalPath);
      const stored = await readJson(proposalPath);
      assertBinding(stored, projectId, sessionId);
      const receiptId = `receipt-${stored.proposalId.slice('proposal-'.length)}`;
      const target = statePath(projectPath, 'receipts', receiptId);
      await checkedFile(projectPath, target);
      const previous = await readJson(target, true);
      if (previous && ['applied', 'undone'].includes(previous.status)) return publicReceipt(previous);
      if (previous && previous.status !== 'rolled-back') conflict('previous edit is incomplete; inspect its recovery journal before retrying');
      validateCurrent(context, stored.changes);
      const files = await planFiles(context, stored.changes);
      if (typeof createBackup === 'function') await assertWorkshopBackupSources(projectPath);
      const backupResult = typeof createBackup === 'function'
        ? await createBackup(dataRoot, projectId, '讨论 Agent 修改前备份', 'before-workshop-agent-apply')
        : { backupId: receiptId, kind: 'workshop-change-journal' };
      const backup = backupResult && backupResult.backup || backupResult;
      const receipt = { receiptId, proposalId: stored.proposalId, projectId, sessionId, createdAt: new Date().toISOString(), changes: stored.changes, backup };
      return commitFiles(target, receipt, files);
    });
  }

  async function undo(dataRoot, { projectId, sessionId, receipt } = {}) {
    identifier(projectId, 'projectId');
    identifier(sessionId, 'sessionId');
    const projectPath = paths.projectDir(dataRoot, projectId);
    return withProjectWriteLock(projectPath, async () => {
      const context = await projectContext(dataRoot, projectId, sessionId);
      const target = statePath(projectPath, 'receipts', receipt && receipt.receiptId);
      await checkedFile(projectPath, target);
      const stored = await readJson(target);
      assertBinding(stored, projectId, sessionId);
      if (stored.status === 'undone') return publicReceipt(stored);
      if (stored.status !== 'applied') conflict('only a successfully applied edit can be undone');
      validateCurrent(context, stored.changes, true);
      const files = await planFiles(context, stored.changes, true);
      return commitFiles(target, stored, files, true);
    });
  }

  return { preview, apply, undo };
}

module.exports = { createWorkshopEditService, revisionForScene, revisionForEntry, WorkshopEditError, MAX_CHANGES, ENTRY_FIELDS };
