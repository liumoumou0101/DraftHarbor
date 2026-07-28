const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');

async function assertGraph(page, expected) {
  await page.waitForFunction(({ nodeCount, activeNodeId }) => {
    const graph = document.querySelector('[data-workflow-graph]');
    const nodes = Array.from(document.querySelectorAll('[data-workflow-graph-node]'));
    return graph && !graph.hidden && nodes.length === nodeCount
      && nodes.some((node) => node.dataset.workflowGraphNode === activeNodeId && node.classList.contains('is-active'));
  }, expected);
  assert.strictEqual(await page.locator('[data-workflow-graph-edge]').count(), expected.edgeCount);
  assert.ok((await page.locator('[data-workflow-graph] > header').innerText()).includes('只读'));
  assert.strictEqual(await page.locator('[data-workflow-graph] input, [data-workflow-graph] textarea, [data-workflow-graph] select').count(), 0);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-graph-ui-'));
  let servers = null;
  let browser = null;
  try {
    await projectService.createProject(dataRoot, {
      id: 'workflow-graph-project',
      title: '图视图验收项目',
      chapters: [{ id: 'chapter-1', title: '雨夜来客', order: 0 }],
      scenes: [{ id: 'scene-1', chapterId: 'chapter-1', title: '门外脚步', content: '雨夜里，门外的脚步声停在第三阶。', order: 0 }]
    });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const browserErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? '图视图自定义模板' : undefined));
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.desktop-project-card');
    await page.focus('.desktop-project-card');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-native-project-title]')?.textContent.includes('图视图验收项目'));
    await page.click('[data-view-target="workflow"]');

    await page.fill('[data-workflow-brief]', '保持悬疑感，继续雨夜来客。');
    await page.click('[data-workflow-start-guided]');
    await page.click('[data-workflow-view-graph]');
    await assertGraph(page, { nodeCount: 7, edgeCount: 6, activeNodeId: 'analysis' });
    assert.ok((await page.locator('[data-workflow-graph-node="source"]').innerText()).includes('1 个产物'));

    await page.click('[data-workflow-launcher] > summary');
    await page.selectOption('[data-workflow-mode]', 'creation');
    await page.fill('[data-workflow-creation-title]', '玻璃海岸');
    await page.fill('[data-workflow-creation-premise]', '守灯人发现海面每天倒映不同的城市。');
    await page.click('[data-workflow-start-creation]');
    await assertGraph(page, { nodeCount: 8, edgeCount: 7, activeNodeId: 'direction' });

    await page.click('[data-workflow-launcher] > summary');
    await page.selectOption('[data-workflow-mode]', 'rewrite');
    await page.fill('[data-workflow-rewrite-instruction]', '强化脚步逼近时的压迫感，保留关键事实。');
    await page.click('[data-workflow-start-rewrite]');
    await assertGraph(page, { nodeCount: 6, edgeCount: 5, activeNodeId: 'plan' });

    await page.click('[data-workflow-graph-edit]');
    await page.waitForSelector('.desktop-workflow-graph-body.is-editing');
    assert.strictEqual(await page.locator('[data-workflow-graph-validation]').getAttribute('data-workflow-graph-validation'), 'valid');
    await page.getByRole('button', { name: '复制节点' }).click();
    assert.strictEqual(await page.locator('[data-workflow-graph-node]').count(), 7);
    await page.getByRole('button', { name: '删除节点' }).click();
    assert.strictEqual(await page.locator('[data-workflow-graph-node]').count(), 6);
    await page.locator('.desktop-workflow-graph-node-library select').selectOption('analysis.extract@1');
    await page.locator('.desktop-workflow-graph-node-library').getByRole('button', { name: '添加节点' }).click();
    assert.strictEqual(await page.locator('[data-workflow-graph-node]').count(), 7);
    assert.ok((await page.locator('[data-workflow-graph-node="extract"]').innerText()).includes('analysis.extract'));
    await page.getByRole('button', { name: '删除节点' }).click();

    const edgeAdd = page.locator('.desktop-workflow-graph-edge-add');
    await page.click('[data-workflow-graph-output-port="source:snapshot"]');
    await page.click('[data-workflow-graph-input-port="plan:previous"]');
    assert.ok((await page.locator('[data-workflow-graph-validation]').innerText()).includes('类型不兼容'));
    await page.locator('.desktop-workflow-graph-edge-list > div').last().getByRole('button').click();

    await edgeAdd.locator('select').nth(0).selectOption('review');
    await edgeAdd.locator('select').nth(2).selectOption('plan');
    await edgeAdd.getByRole('button', { name: '添加连线' }).click();
    assert.strictEqual(await page.locator('[data-workflow-graph-validation]').getAttribute('data-workflow-graph-validation'), 'invalid');
    assert.ok((await page.locator('[data-workflow-graph-validation]').innerText()).includes('循环'));
    await page.click('[data-workflow-graph-edit]');
    assert.strictEqual(await page.locator('.desktop-workflow-graph-body.is-editing').count(), 1);
    await page.locator('.desktop-workflow-graph-edge-list > div').last().getByRole('button').click();
    assert.strictEqual(await page.locator('[data-workflow-graph-validation]').getAttribute('data-workflow-graph-validation'), 'valid');
    const inspector = page.locator('.desktop-workflow-graph-inspector');
    await inspector.getByLabel('标题').fill('用户草稿中的重写来源');
    await inspector.getByLabel('横坐标').fill('80');
    await inspector.getByLabel('禁用此节点').check();
    await inspector.getByLabel('禁用此节点').uncheck();
    await page.click('[data-workflow-graph-edit]');
    await page.waitForSelector('.desktop-workflow-graph-body:not(.is-editing)');
    assert.ok((await page.locator('[data-workflow-graph-node="source"]').innerText()).includes('用户草稿中的重写来源'));
    await page.click('[data-workflow-graph-save-template]');
    try {
      await page.waitForFunction(() => document.querySelector('[data-workflow-status]')?.textContent.includes('v1 已保存'), null, { timeout: 5000 });
    } catch (error) {
      throw new Error(`${error.message}; template status=${await page.locator('[data-workflow-status]').innerText()}; errors=${browserErrors.join(' | ')}`);
    }
    await page.click('[data-workflow-graph-save-template]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]')?.textContent.includes('v2 已保存'));
    const templates = await (await fetch(`${servers.appUrl}/api/workflows/v2/templates`)).json();
    assert.strictEqual(templates.templates.length, 1);
    assert.strictEqual(templates.templates[0].version, 2);
    assert.ok(templates.templates[0].title.length > 0);
    assert.strictEqual(templates.templates[0].executionCompatibility.executable, true);
    await page.click('[data-workflow-graph-start-template]');
    try {
      await page.waitForFunction(() => document.querySelector('[data-workflow-status]')?.textContent.includes('创建真实运行'), null, { timeout: 5000 });
    } catch (error) {
      throw new Error(`${error.message}; start status=${await page.locator('[data-workflow-status]').innerText()}; errors=${browserErrors.join(' | ')}`);
    }
    assert.strictEqual(await page.locator('[data-workflow-run-list] .desktop-workflow-run').count(), 4);
    assert.ok((await page.locator('[data-workflow-graph-node="source"]').innerText()).includes('用户草稿中的重写来源'));
    await page.click('[data-workflow-view-guided]');
    assert.ok((await page.locator('.desktop-workflow-step-card').first().innerText()).includes('用户草稿中的重写来源'));
    await page.click('[data-workflow-view-graph]');
    assert.ok((await page.locator('[data-workflow-graph-node="source"]').innerText()).includes('用户草稿中的重写来源'));
    assert.strictEqual(await page.locator('[data-workflow-graph-run-node]').isEnabled(), true);
    assert.strictEqual(await page.locator('[data-workflow-graph-run-checkpoint]').isEnabled(), true);
    await page.click('[data-workflow-graph-restart-node]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]')?.textContent.includes('下游已重置'));
    await page.waitForFunction(() => document.querySelector('[data-workflow-events]')?.textContent.includes('后续结果已标记为过期'));
    assert.ok((await page.locator('[data-workflow-events]').textContent()).includes('后续结果已标记为过期'));

    await page.click('[data-workflow-view-guided]');
    assert.strictEqual(await page.locator('[data-workflow-steps]').isVisible(), true);
    assert.strictEqual(await page.locator('[data-workflow-graph]').isHidden(), true);
    assert.deepStrictEqual(browserErrors, []);
    console.log('Workflow graph UI test passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow graph UI test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
