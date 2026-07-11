const promptStore = require('../storage/prompt-store');
const projectService = require('./project-service');
const PromptTemplateSchema = require('../../src/core/prompt/prompt-template-schema');

async function ensureProject(dataRoot, projectId) {
  if (!projectId) throw new Error('projectId is required');
  await projectService.projectLocation(dataRoot, projectId);
}

function filterPrompts(prompts, options = {}) {
  const category = String(options.category || '').trim();
  const query = String(options.query || '').trim().toLowerCase();
  return prompts.filter((prompt) => {
    if (category && prompt.category !== category) return false;
    if (!query) return true;
    return [prompt.title, prompt.content, prompt.systemContent, ...(prompt.tags || [])]
      .join('\n')
      .toLowerCase()
      .includes(query);
  });
}

function defaultPromptsForOptions(projectId, options = {}) {
  const category = String(options.category || '').trim();
  return PromptTemplateSchema.defaultPromptTemplates(category, projectId);
}

function withDefaultPrompts(prompts, projectId, options = {}) {
  const defaults = defaultPromptsForOptions(projectId, options);
  const existingIds = new Set((prompts || []).map((prompt) => prompt.id));
  return [
    ...(prompts || []),
    ...defaults.filter((prompt) => !existingIds.has(prompt.id))
  ];
}

async function listPrompts(dataRoot, projectId, options = {}) {
  await ensureProject(dataRoot, projectId);
  const prompts = await promptStore.listPrompts(dataRoot, projectId);
  const visible = filterPrompts(withDefaultPrompts(prompts, projectId, options), options);
  return {
    ok: true,
    prompts: visible
  };
}

async function savePrompt(dataRoot, projectId, promptInput = {}) {
  await ensureProject(dataRoot, projectId);
  const nextPrompt = { ...promptInput };
  if (PromptTemplateSchema.isDefaultPromptId(nextPrompt.id)) {
    delete nextPrompt.id;
  }
  return {
    ok: true,
    prompt: await promptStore.savePrompt(dataRoot, projectId, nextPrompt)
  };
}

async function deletePrompt(dataRoot, projectId, promptId) {
  await ensureProject(dataRoot, projectId);
  if (!promptId) throw new Error('promptId is required');
  if (PromptTemplateSchema.isDefaultPromptId(promptId)) return { ok: true, deleted: 0 };
  return {
    ok: true,
    ...await promptStore.deletePrompt(dataRoot, projectId, promptId)
  };
}

module.exports = {
  listPrompts,
  savePrompt,
  deletePrompt
};
