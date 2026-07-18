const fs = require('fs/promises');
const paths = require('./library-paths');
const { writeJsonAtomic } = require('./atomic-write');

async function readJsonOrNull(target) {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readWorkflowTemplate(dataRoot, templateId, version) {
  const requestedVersion = Number.parseInt(version, 10);
  if (!Number.isFinite(requestedVersion) || requestedVersion < 1) {
    return readJsonOrNull(paths.workflowTemplatePath(dataRoot, templateId));
  }
  const historical = await readJsonOrNull(paths.workflowTemplateVersionPath(dataRoot, templateId, requestedVersion));
  if (historical) return historical;
  const latest = await readJsonOrNull(paths.workflowTemplatePath(dataRoot, templateId));
  return latest && Number(latest.version || 1) === requestedVersion ? latest : null;
}

async function listWorkflowTemplateVersions(dataRoot, templateId) {
  const latest = await readWorkflowTemplate(dataRoot, templateId);
  let entries = [];
  try {
    entries = await fs.readdir(paths.workflowTemplateVersionsDir(dataRoot, templateId), { withFileTypes: true });
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  const versions = [];
  for (const entry of entries) {
    const match = entry.isFile() && /^v(\d+)\.json$/.exec(entry.name);
    if (!match) continue;
    const template = await readJsonOrNull(paths.workflowTemplateVersionPath(dataRoot, templateId, Number(match[1])));
    if (template) versions.push(template);
  }
  if (latest && !versions.some((template) => Number(template.version) === Number(latest.version))) versions.push(latest);
  return versions.sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
}

async function listWorkflowTemplates(dataRoot) {
  let entries = [];
  try {
    entries = await fs.readdir(paths.workflowTemplatesDir(dataRoot), { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const templates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const template = await readWorkflowTemplate(dataRoot, entry.name.slice(0, -5));
    if (template) templates.push(template);
  }
  return templates.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

async function writeWorkflowTemplate(dataRoot, template) {
  const existing = await readWorkflowTemplate(dataRoot, template.id);
  if (existing) await writeJsonAtomic(paths.workflowTemplateVersionPath(dataRoot, existing.id, existing.version || 1), existing);
  await writeJsonAtomic(paths.workflowTemplateVersionPath(dataRoot, template.id, template.version || 1), template);
  await writeJsonAtomic(paths.workflowTemplatePath(dataRoot, template.id), template);
  return template;
}

async function deleteWorkflowTemplate(dataRoot, templateId) {
  const target = paths.workflowTemplatePath(dataRoot, templateId);
  const versionsTarget = paths.workflowTemplateVersionsDir(dataRoot, templateId);
  let deleted = 0;
  try {
    await fs.rm(target);
    deleted = 1;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  await fs.rm(versionsTarget, { recursive: true, force: true });
  return { deleted };
}

module.exports = { readWorkflowTemplate, listWorkflowTemplates, listWorkflowTemplateVersions, writeWorkflowTemplate, deleteWorkflowTemplate };
