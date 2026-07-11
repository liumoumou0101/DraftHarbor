const path = require('path');
const fs = require('fs/promises');
const { writeJsonAtomic } = require('./atomic-write');
const { projectDir } = require('./library-paths');
const PromptTemplateSchema = require('../../src/core/prompt/prompt-template-schema');

function promptsDir(projectPath) {
  return path.join(projectPath, 'prompts');
}

function promptsPath(projectPath) {
  return path.join(promptsDir(projectPath), 'prompts.json');
}

async function readPrompts(projectPath, projectId = '') {
  try {
    const prompts = JSON.parse(await fs.readFile(promptsPath(projectPath), 'utf8'));
    return PromptTemplateSchema.normalizePromptTemplates(prompts, projectId);
  } catch {
    return [];
  }
}

async function writePrompts(projectPath, prompts, projectId = '') {
  await fs.mkdir(promptsDir(projectPath), { recursive: true });
  const normalized = PromptTemplateSchema.normalizePromptTemplates(prompts, projectId);
  await writeJsonAtomic(promptsPath(projectPath), normalized);
  return normalized;
}

async function listPrompts(dataRoot, projectId) {
  return readPrompts(projectDir(dataRoot, projectId), projectId);
}

async function savePrompt(dataRoot, projectId, promptInput = {}) {
  const projectPath = projectDir(dataRoot, projectId);
  const prompts = await readPrompts(projectPath, projectId);
  const now = new Date().toISOString();
  const incoming = PromptTemplateSchema.createPromptTemplate({
    ...promptInput,
    projectId,
    createdAt: promptInput.createdAt || now,
    updatedAt: now
  });
  const index = prompts.findIndex((prompt) => prompt.id === incoming.id);
  if (index >= 0) {
    prompts[index] = {
      ...prompts[index],
      ...incoming,
      createdAt: prompts[index].createdAt || incoming.createdAt,
      updatedAt: now
    };
  } else {
    prompts.push(incoming);
  }
  const saved = await writePrompts(projectPath, prompts, projectId);
  return saved.find((prompt) => prompt.id === incoming.id);
}

async function deletePrompt(dataRoot, projectId, promptId) {
  const projectPath = projectDir(dataRoot, projectId);
  const prompts = await readPrompts(projectPath, projectId);
  const next = prompts.filter((prompt) => prompt.id !== promptId);
  await writePrompts(projectPath, next, projectId);
  return { deleted: prompts.length - next.length };
}

module.exports = {
  promptsPath,
  readPrompts,
  writePrompts,
  listPrompts,
  savePrompt,
  deletePrompt
};
