const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const ArtifactSchema = require('../../src/core/workflow/workflow-artifact-schema');
const { writeFileAtomic, writeJsonAtomic } = require('./atomic-write');
const paths = require('./library-paths');
const { readWorkflowV2RunState } = require('./workflow-run-store-v2');

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function toSerializedPayload(content, format) {
  if (format === 'json') return `${JSON.stringify(content === undefined ? null : content, null, 2)}\n`;
  return String(content === undefined ? '' : content);
}

function payloadDigest(serialized) {
  return `sha256:${crypto.createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readArtifactFamily(projectPath, runId, artifactId) {
  const stored = await readJson(paths.workflowV2ArtifactFamilyPath(projectPath, runId, artifactId));
  return stored ? ArtifactSchema.createWorkflowArtifactFamily(stored) : null;
}

async function readArtifactRevision(projectPath, runId, artifactId, revisionId) {
  const stored = await readJson(paths.workflowV2ArtifactRevisionPath(projectPath, runId, artifactId, revisionId));
  return stored ? ArtifactSchema.createWorkflowArtifactRevision(stored) : null;
}

async function listArtifactFamilies(projectPath, runId) {
  let entries = [];
  try {
    entries = await fs.readdir(paths.workflowV2ArtifactsDir(projectPath, runId), { withFileTypes: true });
  } catch {
    return [];
  }
  const families = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readArtifactFamily(projectPath, runId, entry.name)));
  return families.filter(Boolean).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function readArtifactContent(projectPath, runId, artifactId, revisionId) {
  const revision = await readArtifactRevision(projectPath, runId, artifactId, revisionId);
  if (!revision) return null;
  const filePath = paths.workflowV2ArtifactContentPath(
    projectPath,
    runId,
    artifactId,
    revisionId,
    revision.payload.format
  );
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return revision.payload.format === 'json' ? JSON.parse(text) : text;
  } catch {
    return null;
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeArtifactRevision(projectPath, runId, familyInput = {}, revisionInput = {}, content) {
  const run = cleanString(runId);
  if (!run) throw new Error('workflow v2 artifact runId is required');
  if (!await readWorkflowV2RunState(projectPath, run)) {
    throw new Error(`workflow v2 run state not found: ${run}`);
  }
  const family = ArtifactSchema.createWorkflowArtifactFamily({ ...familyInput, runId: run });
  const familyValidation = ArtifactSchema.validateWorkflowArtifactFamily(family);
  if (!familyValidation.ok) throw new Error(`Invalid workflow artifact family: ${familyValidation.errors.join('; ')}`);

  const revisionId = cleanString(revisionInput.id || revisionInput.revisionId);
  if (!revisionId) throw new Error('workflow artifact revision id is required');
  const format = cleanString(revisionInput.payload && revisionInput.payload.format, 'text');
  if (!ArtifactSchema.PAYLOAD_FORMATS.includes(format)) throw new Error(`unsupported artifact payload format: ${format}`);
  const serialized = toSerializedPayload(content, format);
  const contentPath = paths.workflowV2ArtifactContentPath(projectPath, run, family.id, revisionId, format);
  const runPath = paths.workflowV2RunDir(projectPath, run);
  const revision = ArtifactSchema.createWorkflowArtifactRevision({
    ...revisionInput,
    id: revisionId,
    artifactId: family.id,
    payload: {
      ...(revisionInput.payload || {}),
      format,
      contentRef: path.relative(runPath, contentPath).replace(/\\/g, '/'),
      digest: payloadDigest(serialized),
      byteLength: Buffer.byteLength(serialized, 'utf8')
    }
  });
  const revisionValidation = ArtifactSchema.validateWorkflowArtifactRevision(revision);
  if (!revisionValidation.ok) throw new Error(`Invalid workflow artifact revision: ${revisionValidation.errors.join('; ')}`);

  const existingRevision = await readArtifactRevision(projectPath, run, family.id, revisionId);
  if (existingRevision) {
    const existingContent = await readArtifactContent(projectPath, run, family.id, revisionId);
    if (!sameJson(existingRevision, revision) || !sameJson(existingContent, content)) {
      throw new Error(`workflow artifact revision is immutable: ${revisionId}`);
    }
    return { family: await readArtifactFamily(projectPath, run, family.id), revision: existingRevision };
  }

  const existingFamily = await readArtifactFamily(projectPath, run, family.id);
  if (existingFamily && ArtifactSchema.artifactTypeKey(existingFamily.artifactType) !== ArtifactSchema.artifactTypeKey(family.artifactType)) {
    throw new Error(`workflow artifact family type cannot change: ${family.id}`);
  }
  const nextFamily = ArtifactSchema.attachRevisionToArtifact(existingFamily || family, revision);

  if (format === 'json') {
    await writeJsonAtomic(contentPath, content === undefined ? null : content);
  } else {
    await writeFileAtomic(contentPath, serialized, 'utf8');
  }
  await writeJsonAtomic(paths.workflowV2ArtifactRevisionPath(projectPath, run, family.id, revisionId), revision);
  await writeJsonAtomic(paths.workflowV2ArtifactFamilyPath(projectPath, run, family.id), nextFamily);
  return { family: nextFamily, revision };
}

module.exports = {
  payloadDigest,
  readArtifactFamily,
  readArtifactRevision,
  readArtifactContent,
  listArtifactFamilies,
  writeArtifactRevision
};
