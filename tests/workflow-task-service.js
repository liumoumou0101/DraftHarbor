const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const projectStore = require('../desktop/storage/project-file-store');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const historyStore = require('../desktop/storage/workflow-generation-history-store');
const paths = require('../desktop/storage/library-paths');
const CapabilityRegistry = require('../src/core/workflow/workflow-capability-registry');
const { resolveWorkflowProvider } = require('../desktop/services/workflow-provider-service');
const { createWorkflowAITask, runWorkflowTask } = require('../desktop/services/workflow-task-service');

async function countExactText(root, target) {
  let count = 0;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      count += await countExactText(entryPath, target);
    } else {
      const text = await fs.readFile(entryPath, 'utf8');
      count += text.split(target).length - 1;
    }
  }
  return count;
}

function createRegistry() {
  const registry = CapabilityRegistry.createWorkflowCapabilityRegistry();
  registry.registerArtifactType({
    id: 'draft-batch',
    version: 1,
    title: '正文批次',
    payloadFormat: 'text',
    validatePayload: (payload) => typeof payload === 'string' && payload.includes('工作流正文')
  });
  registry.registerCapability({
    id: 'draft.batch',
    version: 1,
    title: '大段正文生成',
    outputPorts: [{ id: 'draft', artifactType: 'draft-batch@1' }]
  });
  return registry;
}

const settings = {
  providerSettings: {
    mode: 'api',
    provider: 'openai-compatible',
    endpoint: 'https://writer.example.test/v1',
    apiKey: 'writer-secret',
    model: 'writer-model'
  },
  generationDefaults: { temperature: 0.8, maxTokens: 1000, useProviderDefaults: false },
  providerProfiles: [
    {
      id: 'workflow-profile',
      provider: 'openai-compatible',
      endpoint: 'https://workflow.example.test/v1',
      apiKey: 'workflow-secret',
      model: 'workflow-profile-model'
    },
    {
      id: 'node-profile',
      provider: 'openai-compatible',
      endpoint: 'https://node.example.test/v1',
      apiKey: 'node-secret',
      model: 'node-profile-model'
    }
  ]
};

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-task-service-'));
  try {
    const workflowResolution = resolveWorkflowProvider(settings, {
      generationPolicy: { providerProfileId: 'workflow-profile', model: 'workflow-model', temperature: 0.4 }
    });
    assert.strictEqual(workflowResolution.source, 'workflow');
    assert.strictEqual(workflowResolution.config.apiKey, 'workflow-secret');
    assert.strictEqual(workflowResolution.config.model, 'workflow-model');

    const writerResolution = resolveWorkflowProvider(settings, {}, {});
    assert.strictEqual(writerResolution.source, 'writer');
    assert.strictEqual(writerResolution.config.apiKey, 'writer-secret');
    assert.strictEqual(writerResolution.config.model, 'writer-model');

    const nodeResolution = resolveWorkflowProvider(settings, {
      generationPolicy: { providerProfileId: 'workflow-profile', model: 'workflow-model' }
    }, {
      providerPolicy: { providerProfileId: 'node-profile', model: 'node-model', parameters: { temperature: 0.25 } }
    });
    assert.strictEqual(nodeResolution.source, 'node');
    assert.strictEqual(nodeResolution.config.apiKey, 'node-secret');
    assert.strictEqual(nodeResolution.config.model, 'node-model');
    assert.strictEqual(nodeResolution.snapshot.providerProfileId, 'node-profile');
    assert.strictEqual(nodeResolution.snapshot.parameters.temperature, 0.25);
    assert.ok(!JSON.stringify(nodeResolution.snapshot).includes('secret'), 'provider snapshot must not include API keys');

    const created = await projectService.createProject(dataRoot, {
      id: 'workflow-task-project',
      title: 'Workflow Task Project'
    });
    const { project, projectPath } = created;
    await workflowV2Store.createWorkflowV2Run(projectPath, {
      id: 'workflow-task-run',
      projectId: project.id,
      title: '正文生成运行',
      definition: {
        id: 'workflow-task-definition',
        templateId: 'new-work',
        templateVersion: 1,
        title: '正文生成定义',
        nodes: [{ id: 'draft-node', capabilityId: 'draft.batch' }]
      }
    });

    const registry = createRegistry();
    assert.throws(
      () => createWorkflowAITask({
        projectId: project.id,
        action: 'generate',
        target: { type: 'workflow-node', id: 'draft-node' },
        scope: 'scene',
        capabilityId: 'draft.batch',
        outputArtifactType: 'unknown@1',
        outputContract: 'text'
      }, registry),
      /output artifact type is not registered/
    );

    const outputText = '这是工作流正文：雨夜的钟声敲响。';
    let privateProviderConfig = null;
    const beforeProject = await projectStore.openProject(dataRoot, project.id);
    const result = await runWorkflowTask({
      projectPath,
      runId: 'workflow-task-run',
      nodeId: 'draft-node',
      capabilityRegistry: registry,
      settings,
      workflow: { generationPolicy: { providerProfileId: 'workflow-profile', model: 'workflow-model' } },
      node: { providerPolicy: { providerProfileId: 'node-profile', model: 'node-model', parameters: { temperature: 0.25 } } },
      task: {
        id: 'workflow-task-1',
        projectId: project.id,
        action: 'generate',
        target: { type: 'workflow-node', id: 'draft-node', runId: 'workflow-task-run' },
        scope: 'scene',
        capabilityId: 'draft.batch',
        capabilityVersion: 1,
        outputArtifactType: 'draft-batch@1',
        outputContract: 'text'
      },
      prompt: {
        messages: [{ role: 'user', content: '请生成一段正文。' }],
        asString: () => '请生成一段正文。'
      },
      artifact: { id: 'draft-artifact-1', title: '第一批正文', targetRef: { sceneId: 'scene-1' } },
      revision: { id: 'draft-revision-1', summary: '工作流正文初稿' },
      streamGeneration: async (_prompt, onToken, providerConfig) => {
        privateProviderConfig = providerConfig;
        onToken(outputText);
      }
    });

    assert.ok(result.ok);
    assert.strictEqual(result.output, outputText);
    assert.strictEqual(privateProviderConfig.apiKey, 'node-secret', 'only the stream adapter receives the API key');
    assert.strictEqual(result.provider.source, 'node');
    assert.ok(!JSON.stringify(result.provider).includes('secret'));
    assert.ok(!JSON.stringify(result.task).includes('secret'));
    assert.strictEqual(
      await artifactStore.readArtifactContent(projectPath, 'workflow-task-run', 'draft-artifact-1', 'draft-revision-1'),
      outputText
    );
    const storedRevision = await artifactStore.readArtifactRevision(projectPath, 'workflow-task-run', 'draft-artifact-1', 'draft-revision-1');
    assert.ok(!JSON.stringify(storedRevision).includes('secret'));
    assert.strictEqual(storedRevision.providerSnapshot.model, 'node-model');

    const histories = await historyStore.listWorkflowGenerationHistory(projectPath, 'workflow-task-run');
    assert.strictEqual(histories.length, 1);
    assert.strictEqual(histories[0].artifactRef.artifactId, 'draft-artifact-1');
    assert.ok(!JSON.stringify(histories[0]).includes(outputText));
    const historyPath = paths.workflowV2GenerationHistoryPath(projectPath, 'workflow-task-run', histories[0].id);
    const historyText = await fs.readFile(historyPath, 'utf8');
    assert.ok(!historyText.includes(outputText));
    assert.ok(!historyText.includes('node-secret'));
    const afterProject = await projectStore.openProject(dataRoot, project.id);
    assert.deepStrictEqual(afterProject.promptHistory, beforeProject.promptHistory, 'workflow task must not write the project prompt history');
    const runsText = await fs.readFile(paths.workflowV2RunsPath(projectPath), 'utf8');
    assert.ok(!runsText.includes(outputText), 'run index must remain metadata-only');
    assert.strictEqual(await countExactText(projectPath, outputText), 1, 'complete generated text must be persisted only in the artifact content file');

    console.log('Workflow task service test passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow task service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
