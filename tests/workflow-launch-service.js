const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const paths = require('../desktop/storage/library-paths');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-launch-'));
  let servers = null;
  try {
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
    const generationPolicy = {
      providerProfileId: 'inherit',
      snapshot: {
        source: 'default-writing', label: '默认写作连接', mode: 'api', provider: 'deepseek',
        endpoint: 'https://api.example.test/chat/completions', model: 'workflow-test-model',
        temperature: 0.6, maxTokens: 4800, useProviderDefaults: false
      }
    };
    const response = await fetch(`${servers.appUrl}/api/workflows/v2/create-project-and-start-creation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: { title: '工作流新作', description: '从零创建项目验收', status: '构思中' },
        brief: { workingTitle: '工作流新作', premise: '一名抄写员在失忆的城市寻找真相。' },
        generationPolicy
      })
    });
    const result = await response.json();
    assert.ok(response.ok && result.ok, result.error || 'creation launch should succeed');
    assert.ok(result.projectId && result.runId, 'launch should return both project and run IDs');
    const opened = await projectService.openProject(dataRoot, result.projectId);
    assert.strictEqual(opened.project.title, '工作流新作');
    const stored = await runStore.readWorkflowV2Run(paths.projectDir(dataRoot, result.projectId), result.runId);
    const frozen = stored.definitionSnapshot.definition.settings.generationPolicy;
    assert.strictEqual(frozen.providerProfileId, 'inherit');
    assert.strictEqual(frozen.snapshot.model, 'workflow-test-model');
    assert.strictEqual(frozen.snapshot.temperature, 0.6);
    assert.strictEqual(frozen.snapshot.maxTokens, 4800);
    assert.strictEqual(frozen.snapshot.endpoint, '', 'launch stamp must not persist a client endpoint');
    assert.notStrictEqual(frozen.snapshot.provider, 'deepseek', 'empty disk settings must not keep a client-forged provider');
    assert.ok(!JSON.stringify(stored).includes('apiKey'), 'workflow snapshot must not store an API key');
    console.log('Workflow launch service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow launch service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
