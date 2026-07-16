const crypto = require('crypto');
const store = require('../storage/workflow-template-store');
const DefinitionSchema = require('../../src/core/workflow/workflow-definition-schema');
const Catalog = require('../../src/core/workflow/workflow-builtin-catalog');
const continuation = require('./workflow-guided-service');
const creation = require('./workflow-creation-guided-service');
const rewrite = require('./workflow-rewrite-guided-service');

function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }

const EXECUTORS = {
  'continuation-guided': { definition: continuation.definition, start: continuation.startGuidedContinuation },
  'creation-guided': { definition: creation.definition, start: creation.startGuidedCreation },
  'rewrite-guided': { definition: rewrite.definition, start: rewrite.startGuidedRewrite }
};

function templateCompatibility(template) {
  const definition = template.definition || template;
  const baseTemplateId = clean(definition.settings && definition.settings.baseTemplateId, definition.templateId);
  const executor = EXECUTORS[baseTemplateId];
  if (!executor) return { executable: false, baseTemplateId, errors: [`unsupported base template: ${baseTemplateId || '(empty)'}`] };
  const registry = Catalog.createBuiltinWorkflowRegistry();
  const validation = registry.validateWorkflowDefinition(definition);
  const canonical = executor.definition({});
  const errors = validation.errors.slice();
  const expected = new Map(canonical.nodes.map((node) => [node.id, node]));
  if (definition.nodes.length !== canonical.nodes.length) errors.push('executable template must keep the canonical node count');
  for (const node of definition.nodes) {
    const target = expected.get(node.id);
    if (!target) errors.push(`non-canonical executable node: ${node.id}`);
    else if (node.capabilityId !== target.capabilityId || Number(node.capabilityVersion || 1) !== Number(target.capabilityVersion || 1)) errors.push(`node ${node.id} capability differs from canonical executor`);
    if (node.disabled) errors.push(`executable node cannot be disabled: ${node.id}`);
  }
  const canonicalOrder = canonical.nodes.map((node) => node.id);
  if (validation.order.join('|') !== canonicalOrder.join('|')) errors.push('node execution order differs from canonical executor');
  return { executable: errors.length === 0, baseTemplateId, errors: [...new Set(errors)] };
}

async function listTemplates(dataRoot) {
  const templates = await store.listWorkflowTemplates(dataRoot);
  const enriched = await Promise.all(templates.map(async (template) => ({
    ...template,
    availableVersions: (await store.listWorkflowTemplateVersions(dataRoot, template.id)).map((item) => Number(item.version || 1)),
    executionCompatibility: templateCompatibility(template)
  })));
  return { ok: true, templates: enriched };
}

async function getTemplate(dataRoot, templateId, version) {
  const template = await store.readWorkflowTemplate(dataRoot, clean(templateId), version);
  if (!template) throw new Error('workflow template not found');
  return { ok: true, template: { ...template, executionCompatibility: templateCompatibility(template) } };
}

async function listTemplateVersions(dataRoot, templateId) {
  if (!clean(templateId)) throw new Error('templateId is required');
  const templates = await store.listWorkflowTemplateVersions(dataRoot, templateId);
  return { ok: true, templates: templates.map((template) => ({ ...template, executionCompatibility: templateCompatibility(template) })) };
}

async function saveTemplate(dataRoot, input = {}) {
  const definition = input.definition && typeof input.definition === 'object' ? input.definition : input;
  const validation = Catalog.createBuiltinWorkflowRegistry().validateWorkflowDefinition(definition);
  if (!validation.ok) {
    const error = new Error(`Invalid workflow template: ${validation.errors.join('; ')}`);
    error.name = 'WorkflowTemplateValidationError'; error.errors = validation.errors;
    throw error;
  }
  const id = clean(input.id, `custom-${crypto.randomUUID()}`);
  const existing = await store.readWorkflowTemplate(dataRoot, id);
  const version = existing ? Number(existing.version || 1) + 1 : 1;
  const now = new Date().toISOString();
  const baseTemplateId = clean(existing && existing.definition && existing.definition.settings && existing.definition.settings.baseTemplateId,
    clean(definition.settings && definition.settings.baseTemplateId, definition.templateId));
  let template = DefinitionSchema.createWorkflowTemplate({
    id, version,
    title: clean(input.title || definition.title, '未命名自定义模板'),
    description: clean(input.description || definition.description),
    definition: { ...definition, id: `${id}@${version}`, templateId: id, templateVersion: version, settings: { ...(definition.settings || {}), baseTemplateId } },
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  });
  template = { ...template, executionCompatibility: templateCompatibility(template) };
  await store.writeWorkflowTemplate(dataRoot, template);
  return { ok: true, template };
}

async function startTemplate(dataRoot, input = {}) {
  const template = await store.readWorkflowTemplate(dataRoot, clean(input.templateId), input.templateVersion);
  if (!template) throw new Error('workflow template not found');
  const compatibility = templateCompatibility(template);
  if (!compatibility.executable) {
    const error = new Error(`Workflow template is not executable: ${compatibility.errors.join('; ')}`);
    error.name = 'WorkflowTemplateExecutionError'; error.errors = compatibility.errors; throw error;
  }
  const executor = EXECUTORS[compatibility.baseTemplateId];
  const canonical = executor.definition({});
  const definitionOverride = clone(template.definition);
  definitionOverride.id = `${template.id}@${template.version}-run-${Date.now()}`;
  definitionOverride.templateId = compatibility.baseTemplateId;
  definitionOverride.templateVersion = canonical.templateVersion;
  definitionOverride.settings = { ...(definitionOverride.settings || {}), customTemplateId: template.id, customTemplateVersion: template.version };
  return executor.start({ ...input, dataRoot, title: clean(input.title, `${template.title} · 模板运行`), definitionOverride });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function deleteTemplate(dataRoot, templateId) {
  if (!clean(templateId)) throw new Error('templateId is required');
  return { ok: true, ...(await store.deleteWorkflowTemplate(dataRoot, templateId)) };
}

module.exports = { listTemplates, getTemplate, listTemplateVersions, saveTemplate, deleteTemplate, startTemplate, templateCompatibility };
