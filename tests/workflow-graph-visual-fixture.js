const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const rewrite = require('../desktop/services/workflow-rewrite-guided-service');
const templateService = require('../desktop/services/workflow-template-service');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-graph-visual-'));
  await projectService.createProject(dataRoot, {
    id: 'graph-visual-project', title: '潮汐城档案',
    chapters: [{ id: 'chapter-1', title: '雾港来信', order: 0 }],
    scenes: [
      { id: 'scene-1', chapterId: 'chapter-1', title: '停泊区的陌生灯号', content: '凌晨两点，旧港停泊区亮起了早已废弃的蓝色灯号。苏晚站在防波堤尽头，看见潮水里浮出一排不属于这座城市的屋顶。', order: 0 },
      { id: 'scene-2', chapterId: 'chapter-1', title: '来自明日的航海日志', content: '日志最后一页写着明天的日期，落款却是苏晚自己的名字。远处警报响起时，她听见身后的脚步与潮声保持着完全相同的节奏。', order: 1 }
    ]
  });
  const started = await rewrite.startGuidedRewrite({
    dataRoot, projectId: 'graph-visual-project', runId: 'visual-rewrite-run', scope: 'project',
    brief: { instruction: '保留关键事实，强化潮水逼近时的压迫感。', targetStyle: '克制、冷峻', targetTone: '悬疑', targetLengthRatio: 1 }
  });
  const definition = rewrite.definition({ brief: { instruction: '强化压迫感' } });
  definition.nodes[1].title = '确认重写策略与保留事实';
  definition.nodes.forEach((node, index) => { node.position = { x: index * 260, y: index % 2 ? 95 : 0 }; });
  await templateService.saveTemplate(dataRoot, { id: 'visual-rewrite-template', title: '潮汐悬疑重写模板', definition });
  const servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
  const statePath = path.resolve(__dirname, '..', '.ai_state', 'workflow-visual-fixture.json');
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify({ appUrl: servers.appUrl, dataRoot, pid: process.pid, runId: started.runId }, null, 2));
  console.log(`Workflow visual fixture ready: ${servers.appUrl}`);
  const cleanup = async () => { servers.close(); await fs.rm(dataRoot, { recursive: true, force: true }); await fs.rm(statePath, { force: true }); process.exit(0); };
  process.on('SIGTERM', cleanup); process.on('SIGINT', cleanup);
  setInterval(() => {}, 60000);
})().catch((error) => { console.error(error); process.exit(1); });
