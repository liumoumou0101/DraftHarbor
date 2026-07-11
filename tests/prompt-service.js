const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const promptService = require('../desktop/services/prompt-service');
const PromptTemplateSchema = require('../src/core/prompt/prompt-template-schema');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-prompt-test-'));
  let servers = null;
  try {
    await projectService.createProject(dataRoot, {
      id: 'prompt-project',
      title: 'Prompt Project'
    });

    const saved = await promptService.savePrompt(dataRoot, 'prompt-project', {
      category: 'prose',
      title: 'Quiet Style',
      systemContent: 'Write softly.',
      content: 'Use small details.'
    });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.prompt.category, 'prose');

    const expectedDefaultCounts = {
      prose: 20,
      rewrite: 24,
      summary: 8,
      workshop: 10,
      workflow: 8
    };
    for (const [category, expectedCount] of Object.entries(expectedDefaultCounts)) {
      const templates = PromptTemplateSchema.defaultPromptTemplates(category, 'prompt-project');
      assert.strictEqual(templates.length, expectedCount, `${category} should expose the full built-in template set`);
      assert.ok(templates.every((prompt) => prompt.isDefault), `${category} templates should be marked as default`);
      assert.ok(templates.every((prompt) => prompt.title && !prompt.title.startsWith('默认')), `${category} templates should use scenario titles`);
      assert.ok(templates.every((prompt) => prompt.content && prompt.content.trim().length > 20), `${category} templates should include usable content`);
    }

    const listed = await promptService.listPrompts(dataRoot, 'prompt-project', { category: 'prose' });
    assert.ok(listed.prompts.length >= 21, 'prose prompt list should include saved and expanded default prompts');
    assert.strictEqual(listed.prompts[0].title, 'Quiet Style');
    assert.ok(listed.prompts.some((prompt) => prompt.id === 'default-prose'), 'prose prompt list should keep the default prose template');
    assert.ok(listed.prompts.some((prompt) => prompt.title === '对白场景：人物交锋'), 'prose prompt list should include scenario-specific writing templates');

    const rewriteDefaults = await promptService.listPrompts(dataRoot, 'prompt-project', { category: 'rewrite' });
    assert.ok(rewriteDefaults.prompts.length >= 24, 'rewrite category should include expanded default rewrite templates');
    assert.ok(rewriteDefaults.prompts.every((prompt) => prompt.category === 'rewrite'), 'rewrite defaults should stay in rewrite category');
    assert.ok(rewriteDefaults.prompts.some((prompt) => prompt.id === 'default-rewrite-balanced'), 'rewrite defaults should include balanced polish');

    for (const category of ['summary', 'workshop', 'workflow']) {
      const defaults = await promptService.listPrompts(dataRoot, 'prompt-project', { category });
      assert.ok(defaults.prompts.length >= expectedDefaultCounts[category], `${category} category should include expanded default templates`);
      assert.ok(defaults.prompts.every((prompt) => prompt.category === category), `${category} defaults should stay in category`);
    }

    const dialogueSearch = await promptService.listPrompts(dataRoot, 'prompt-project', { category: 'prose', query: '对白' });
    assert.ok(dialogueSearch.prompts.some((prompt) => prompt.title === '对白场景：人物交锋'), 'query should find built-in prose scenario templates');

    const deleteDefault = await promptService.deletePrompt(dataRoot, 'prompt-project', 'default-rewrite-balanced');
    assert.strictEqual(deleteDefault.deleted, 0, 'default prompt delete should be ignored');

    const clonedDefault = await promptService.savePrompt(dataRoot, 'prompt-project', {
      id: 'default-rewrite-balanced',
      category: 'rewrite',
      title: 'Custom Balanced Rewrite',
      content: 'Use a custom rewrite style.'
    });
    assert.notStrictEqual(clonedDefault.prompt.id, 'default-rewrite-balanced', 'saving a default prompt should create a user-owned copy');
    assert.strictEqual(clonedDefault.prompt.category, 'rewrite');

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot
    });

    const apiList = await fetch(servers.appUrl + '/api/prompts?projectId=prompt-project&category=prose');
    const apiListBody = await apiList.json();
    assert.ok(apiList.ok && apiListBody.ok, 'prompt list API should return ok');
    assert.strictEqual(apiListBody.prompts[0].title, 'Quiet Style');
    assert.ok(apiListBody.prompts.some((prompt) => prompt.id === 'default-prose'), 'prompt API should include default prose template');

    const apiSave = await fetch(servers.appUrl + '/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'prompt-project',
        prompt: {
          category: 'workflow',
          title: 'Workflow Step',
          content: 'Do one step.'
        }
      })
    });
    const apiSaveBody = await apiSave.json();
    assert.ok(apiSave.ok && apiSaveBody.ok, 'prompt save API should return ok');
    assert.strictEqual(apiSaveBody.prompt.category, 'workflow');

    const apiDelete = await fetch(servers.appUrl + '/api/delete-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'prompt-project', promptId: apiSaveBody.prompt.id })
    });
    const apiDeleteBody = await apiDelete.json();
    assert.ok(apiDelete.ok && apiDeleteBody.ok, 'prompt delete API should return ok');
    assert.strictEqual(apiDeleteBody.deleted, 1);

    console.log('Prompt service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Prompt service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
