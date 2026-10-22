const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const schema = require('../../src/core/knowledge/compendium-schema');

const PROJECT_ID = 'visual-wudu-fixture';
const ROOT = path.resolve(__dirname, '../..');
const CHARACTER_ID = 'wudu-lu-cizhou';
const FIXED_TIME = '2026-10-22T08:00:00.000Z';

function makeFixture() {
    const cards = [
        {
            id: CHARACTER_ID, type: 'character', title: '陆辞舟', aliases: ['辞舟', '陆师傅'], tags: ['无渡', '主角', '修复师'],
            summary: '替别人修补旧物的人，始终不敢触碰自己记忆里的裂缝。',
            body: '陆辞舟在无渡镇的旧书铺里修书，也修那些无法被轻易说出口的往事。他习惯先摸一摸书脊，再听客人讲述来历；真假并不急着分辨，纸张留下的痕迹会替人作证。\n\n七年前的一场渡口大火夺走了他的师父。如今，沈青萝带着一封没有落款的旧信回来，信封上的青铜扣，与师父遗物里缺失的那一枚完全相同。\n\n他答应在秋潮到来前修好《渡口旧志》。但修复得越多，镇上被遗忘的人名就越清晰。每一页都在逼他回答同一个问题：有些真相被保存下来，是为了被记住，还是为了再一次被藏起？',
            characterProfile: {
                role: '旧书修复师；无渡镇失火旧案的亲历者。',
                goal: '修复《渡口旧志》，找到师父失踪前最后一次出门的原因。',
                motivation: '相信物件会替沉默的人留住证词，也希望证明自己当年的逃离并非背叛。',
                conflict: '每靠近一层真相，都可能伤害仍在保护他的镇民；记忆与证据互相抵触。',
                voice: '说话慢，少用形容词；回答难题前会用拇指摩挲食指上的旧伤。',
                currentState: '已认出旧信上的青铜扣，与沈青萝达成暂时的合作。秋潮只剩三日。',
                knowledge: '知道旧志有被人重新装订的痕迹；尚不知道渡口大火当晚有第二条船离岸。',
                relationshipNotes: '对沈青萝既信任又戒备；把陈伯当作长辈，却开始察觉他的叙述总会少掉一个名字。'
            },
            contextPolicy: { mode: 'mention' }, relatedSceneIds: ['scene-old-letter'],
            sourceReferences: [
                { kind: 'writer-selection', sceneId: 'scene-old-letter', chapterId: 'chapter-return', excerpt: '陆辞舟把旧信放在灯下，青铜扣的阴影落在他的指节上。', createdAt: FIXED_TIME },
                { kind: 'reader-transfer', documentId: 'wudu-reading-draft', revisionId: 'revision-3', sectionId: 'section-7', sceneId: 'scene-retired-version', excerpt: '他修了一辈子的书，却从未读完那场火留给他的最后一页。', createdAt: '2026-10-18T06:00:00.000Z' }
            ]
        },
        { id: 'wudu-shen-qingluo', type: 'character', title: '沈青萝', summary: '带着一封旧信归来，沿着失踪父亲的足迹追问往事。', body: '沈青萝离开无渡镇多年，再回来时，只带了一只皮箱和一封没有落款的信。她需要陆辞舟的手艺，也需要他终于肯说出当年的经过。', aliases: ['青萝'], tags: ['无渡', '归来者'], characterProfile: { goal: '查清父亲失踪的真相。', voice: '直截了当，偶尔用玩笑挡住真正的问题。' }, contextPolicy: { mode: 'mention' } },
        { id: 'wudu-chen-bo', type: 'character', title: '陈伯', summary: '渡口最后一位摆渡人，也是旧案的守口人。', body: '陈伯守着无渡镇的旧渡口。他总说潮水记不住人名，却能准确说出七年前每一条船离岸的时辰。', aliases: ['陈渡'], tags: ['无渡', '旧案'] },
        { id: 'wudu-town', type: 'location', title: '无渡镇', summary: '秋潮抵岸时，旧河道会重新显现的临水小镇。', body: '无渡镇沿着废弃的河道生长。旧书铺、渡口和封闭的南仓构成镇民日常行走的三角；入夜之后，只有旧书铺还亮着灯。', tags: ['无渡', '旧案'] },
        { id: 'wudu-bookshop', type: 'location', title: '听潮书铺', summary: '陆辞舟的修复工作台，藏在一条朝向河口的窄巷尽头。', body: '听潮书铺有两扇木窗、一张修复台和一整面尚未整理的旧档。每到涨潮，后门门槛上的水印就高出一指。', tags: ['无渡', '修复师'] },
        { id: 'wudu-ferry-guild', type: 'organization', title: '渡船会', summary: '曾经维护河道与渡运的松散行会。', body: '渡船会在大火之后解散，旧名册却一直留在陈伯手中。名册最后一页被完整地裁掉了。', tags: ['旧案'] },
        { id: 'wudu-bronze-clasp', type: 'item', title: '青铜扣', summary: '旧信上留下的铜扣，与师父遗物里缺失的一枚成对。', body: '青铜扣背面刻着细小的潮纹。陆辞舟认得这种磨损：它曾被反复缝在一件常年沾水的外衣上。', tags: ['旧案', '证物'] },
        { id: 'wudu-autumn-tide', type: 'lore', title: '秋潮与旧河道', summary: '每年秋分后的第三次大潮，会让沉没的河道短暂露出地面。', body: '秋潮持续不到一个时辰。镇上的老人认为那是河在归还旧物；沈青萝相信那只是看清旧渡口地形的唯一机会。', tags: ['无渡', '潮汐'] },
        { id: 'wudu-fire-timeline', type: 'timeline', title: '渡口大火 · 七年前', summary: '所有人的回忆都停在同一声钟响，但船的数目对不上。', body: '戌时：南仓传出争执。\n亥初：渡口起火。\n亥正：第一条船离岸。\n午夜：镇钟响了两次。第二条船未被写入旧志。', tags: ['旧案'], relatedSceneIds: ['scene-ferry'], sourceReferences: [{ kind: 'summary', chapterId: 'chapter-tide', sceneId: 'scene-ferry', excerpt: '陈伯说那晚只有一条船，河滩上却留下两道拖痕。', createdAt: FIXED_TIME }] }
    ];
    const entries = cards.map((card, index) => schema.createCompendiumEntry({ ...card, projectId: PROJECT_ID, order: index, createdAt: FIXED_TIME, updatedAt: FIXED_TIME }));
    const chapters = [{ id: 'chapter-return', projectId: PROJECT_ID, title: '第一章 · 归来的旧信', order: 0 }, { id: 'chapter-tide', projectId: PROJECT_ID, title: '第二章 · 潮声之前', order: 1 }];
    const scenes = [
        { id: 'scene-old-letter', projectId: PROJECT_ID, chapterId: 'chapter-return', title: '旧信抵达', order: 0, povCharacter: '陆辞舟', characters: ['陆辞舟', '沈青萝'] },
        { id: 'scene-repair', projectId: PROJECT_ID, chapterId: 'chapter-return', title: '灯下修书', order: 1, povCharacter: '陆辞舟', characters: ['陆辞舟'] },
        { id: 'scene-ferry', projectId: PROJECT_ID, chapterId: 'chapter-tide', title: '渡口的第二条船', order: 0, characters: ['陈伯', '沈青萝'] }
    ];
    const sceneContents = {
        'scene-old-letter': '雨水沿着旧书铺的窗格落下。\n\n陆辞舟把旧信放在灯下，青铜扣的阴影落在他的指节上。沈青萝没有催促，只把皮箱推到桌边。\n\n“这封信，是你师父写的吗？”\n\n他没有回答。纸张很旧，封口却是昨天才粘好的。',
        'scene-repair': '辞舟将《渡口旧志》的书脊缓缓拆开。第三层衬纸后面，有一个被反复擦去的名字。\n\n灯火轻轻晃了一下，他终于看见师父当年留下的批注。',
        'scene-ferry': '陈伯说那晚只有一条船，河滩上却留下两道拖痕。沈青萝望向对岸：秋潮正在退去，旧河道一点点露出湿亮的石头。'
    };
    return { entries, selectedId: CHARACTER_ID, snapshot: { project: { id: PROJECT_ID, title: '无渡', name: '无渡', description: '一个关于旧物、记忆与归来的故事。' }, compendium: entries, chapters, scenes, sceneContents } };
}

async function inlineDesktop() {
    let html = await fs.readFile(path.join(ROOT, 'desktop.html'), 'utf8');
    const fragmentPattern = /<div\s+data-desktop-fragment="([^"]+)"\s*><\/div>/g;
    for (const match of [...html.matchAll(fragmentPattern)]) html = html.replace(match[0], await fs.readFile(path.join(ROOT, match[1]), 'utf8'));
    const stylesheetPattern = /<link\b[^>]*rel="stylesheet"[^>]*>/g;
    const linkedStylesheets = [];
    for (const match of [...html.matchAll(stylesheetPattern)]) {
        const href = match[0].match(/href="([^"]+)"/);
        if (!href) throw new Error(`Stylesheet link has no href: ${match[0]}`);
        const filename = href[1].split('?')[0];
        linkedStylesheets.push(filename);
        html = html.replace(match[0], `<style data-fixture-source="${filename}">${await fs.readFile(path.join(ROOT, filename), 'utf8')}</style>`);
    }
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    for (const match of [...html.matchAll(/src="(assets\/[^"]+)"/g)]) {
        const bytes = await fs.readFile(path.join(ROOT, match[1]));
        const extension = path.extname(match[1]).slice(1).toLowerCase();
        const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' }[extension] || 'application/octet-stream';
        html = html.replace(match[0], `src="data:${mime};base64,${bytes.toString('base64')}"`);
    }
    if (!linkedStylesheets.length || /data-desktop-fragment=/.test(html)) throw new Error('Desktop fixture did not inline the complete desktop source.');
    return { html, linkedStylesheets };
}

async function mount(page, htmlPath, fixture = makeFixture()) {
    const networkRequests = [];
    await page.route(/^https?:/, route => { networkRequests.push(route.request().url()); return route.abort(); });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(initial => {
        window.localStorage.clear();
        window.root = document.querySelector('#desktop-root');
        document.documentElement.dataset.desktopTheme = 'morandi-ink';
        window.compendiumState = { entries: initial.entries, selectedId: initial.selectedId, query: '', type: '', loading: false, dirty: false };
        window.nativeEditorState = { snapshot: initial.snapshot, activeSceneId: 'scene-old-letter', context: { compendiumIds: [], compendiumTags: [], chapterModes: {}, sceneModes: {} }, generation: { inProgress: false }, dirty: false };
        window.renderContextStrip = () => {};
        window.openCompendiumRewrite = () => {};
        window.contextPolicyMode = entry => entry.contextPolicy?.mode || 'manual';
        window.contextPolicyLabel = entry => ({ always: '常驻', auto: '自动', mention: '提及', manual: '手动', disabled: '禁用' })[entry.contextPolicy?.mode || 'manual'];
        window.currentNativeScene = () => window.nativeEditorState.snapshot.scenes.find(scene => scene.id === window.nativeEditorState.activeSceneId);
        window.confirm = () => true;
        window.fixtureRequests = [];
        window.fetch = async (url, options = {}) => {
            if (url !== '/api/compendium' || options.method !== 'POST') throw new Error(`Unexpected fixture API request: ${url}`);
            const request = JSON.parse(options.body);
            window.fixtureRequests.push({ url, request });
            if (request.projectId !== initial.snapshot.project.id) throw new Error('Fixture attempted a cross-project write.');
            return { ok: true, json: async () => ({ ok: true, entry: window.DraftHarborCompendiumSchema.createCompendiumEntry({ ...request.entry, projectId: request.projectId, updatedAt: '2026-10-22T09:00:00.000Z' }) }) };
        };
        window.setView = view => {
            window.root.dataset.view = view;
            document.querySelector('#desktop-view-title').textContent = view === 'compendium' ? '资料库' : '写作';
            document.querySelectorAll('[data-view-panel]').forEach(node => node.classList.toggle('is-active', node.dataset.viewPanel === view));
            document.querySelectorAll('.desktop-nav-item').forEach(node => node.classList.toggle('is-active', node.dataset.viewTarget === view));
        };
        window.selectOutlineTarget = () => true;
        window.setView('compendium');
    }, fixture);
    for (const filename of [
        'src/core/knowledge/compendium-schema.js', 'src/core/knowledge/compendium-insights.js',
        'src/desktop/shell/writer-elements.js', 'src/desktop/shell/compendium.js',
        'src/desktop/shell/compendium-workspace.js', 'src/desktop/shell/writer-prompts.js', 'src/desktop/shell/compendium-peek.js'
    ]) await page.addScriptTag({ content: await fs.readFile(path.join(ROOT, filename), 'utf8') });
    await page.evaluate(() => { window.bindCompendium(); window.setCompendiumCountStatus(); });
    await page.locator('[data-compendium-title]').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    return { networkRequests };
}

module.exports = { ROOT, PROJECT_ID, CHARACTER_ID, makeFixture, inlineDesktop, mount };
