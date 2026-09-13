const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const projects = require('../desktop/services/project-service');
const cards = require('../desktop/services/compendium-service');
const settings = require('../desktop/services/settings-service');
const workshop = require('../desktop/services/workshop-service');
const { startDesktopServers } = require('../desktop/local-server');

const ORIGINAL = '雾贴着港口的石阶。沈砚把旧信收进衣袋，望向海关楼。\n\n他明知陆遥昨夜已经离港，却仍准备在码头等她，直到最后一班渡船熄灯。\n\n远处传来两声汽笛。守夜人提着灯走过，没有看见他掌心那枚破损的铜钥匙。';
const REVISED = '雾贴着港口的石阶。沈砚把旧信收进衣袋，望向海关楼。\n\n他明知陆遥昨夜已经离港，仍决定在码头等到最后一班渡船熄灯。信里约定的不是会面，而是交接：只要灯还亮着，替她送消息的人就可能出现。\n\n远处传来两声汽笛。守夜人提着灯走过，没有看见他掌心那枚破损的铜钥匙。沈砚将钥匙攥紧，退进仓库门廊的阴影里。';

async function createFixture() {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workshop-agent-'));
    const requests = [];
    let servers;
    const calls = [
        { tool: 'project_outline', args: {} },
        { tool: 'read_scene', args: { sceneId: 'scene-harbor' } },
        { tool: 'search_entries', args: { query: '沈砚' } },
        { tool: 'read_entry', args: { entryId: 'card-shen' } },
        { tool: 'stage_scene', args: { sceneId: 'scene-harbor', patch: { content: REVISED, summary: '沈砚在雾港等待陆遥委托的信使，守住铜钥匙与交接约定。' }, reason: '保留离港事实，补足继续等候的目的，使行动与人物资料一致。' } },
        { tool: 'stage_entry_update', args: { entryId: 'card-shen', patch: { summary: '谨慎的海关抄写员，为查清失踪案守候陆遥的信使。' }, reason: '把本场景已经明确的行动目标记入人物资料，便于后续写作保持一致。' } },
        { tool: 'stage_entry_create', args: { entry: { title: '破损的铜钥匙', type: 'item', body: '沈砚在港口守候时攥着的铜钥匙。具体用途尚未揭示。', tags: ['雾港', '线索'] }, reason: '记录已出现的线索，保留尚未揭示的用途。' } },
        { tool: 'final', args: { answer: '我查阅了《雾港的约定》和沈砚的人物资料。当前冲突在于：沈砚知道陆遥已离港，却没有明确的等候目的。\n\n建议补足“等待信使”的动机，同步人物摘要，并将铜钥匙收录为线索卡。下面是 3 项待确认修改，正文及资料卡尚未改变。' } }
    ];
    const provider = http.createServer(async (request, response) => {
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const payload = JSON.parse(raw);
        requests.push(payload);
        const previous = (payload.messages || []).filter(message => {
            if (message.role !== 'assistant') return false;
            try { return !!JSON.parse(message.content).tool; } catch (_) { return false; }
        }).length;
        const call = calls[Math.min(previous, calls.length - 1)];
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(call) }, finish_reason: null }] })}\n\n`);
        response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    try {
        await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
        await settings.writeSettings(dataRoot, { providerSettings: { mode: 'api', provider: 'custom', endpoint: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`, apiKey: 'local-fixture-only', model: 'fixture-model' } });
        await projects.createProject(dataRoot, {
            id: 'agent-demo', title: '雾港来信', description: '项目助手功能验证用的临时作品。',
            chapters: [{ id: 'chapter-harbor', title: '第一章 · 雾港', order: 0 }],
            scenes: [{ id: 'scene-harbor', chapterId: 'chapter-harbor', title: '雾港的约定', summary: '沈砚在码头等待陆遥。', content: ORIGINAL }]
        });
        await cards.saveEntry(dataRoot, 'agent-demo', { id: 'card-shen', title: '沈砚', type: 'character', summary: '谨慎的海关抄写员，正在查找失踪的兄长。', body: '沈砚不轻信口头承诺。他与陆遥约定，在雾港等候她委托的信使。', tags: ['主角', '雾港'] });
        await workshop.saveSession(dataRoot, 'agent-demo', { id: 'session-demo', title: '核对雾港场景与人物动机', messages: [] });
        servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
        return { dataRoot, requests, servers, ORIGINAL, REVISED, close: async () => {
            servers.close();
            provider.closeAllConnections();
            await new Promise(resolve => provider.close(resolve));
            await fs.rm(dataRoot, { recursive: true, force: true });
        } };
    } catch (error) {
        if (servers) servers.close();
        provider.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
        throw error;
    }
}

module.exports = { createFixture };

if (require.main === module) {
    createFixture().then(fixture => {
        console.log(JSON.stringify({ appUrl: fixture.servers.appUrl, dataRoot: fixture.dataRoot }));
        process.on('SIGINT', () => { fixture.close().then(() => process.exit(0)); });
    }).catch(error => { console.error(error); process.exitCode = 1; });
}
