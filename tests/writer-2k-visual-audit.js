const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const { setAssistantPlacement, openGenerationAdvanced, openNativePanel } = require('./helpers/native-panel');

const projectRoot = path.resolve(__dirname, '..');
const reportDir = path.join(projectRoot, 'cache', 'writer-2k-audit');

const prose = [
  '港湾的钟只响了一声，余音却贴在黑水面上，像整条海岸忽然忘了怎么呼吸。',
  '玛拉把地图匣按在大衣里。皮革被盐雾浸得发亮，风一偏，匣中旧纸便像活物一样轻轻鼓起。',
  '「灯还亮着，就说明有人来过。」凯尔尽量说得有用，出口却像警告。',
  '断码头尽头，灯塔从一颗石齿上竖起来。窗子全黑，只有顶层有一团发绿的光，在玻璃后慢慢移动。',
  '她数着步子。二十步到闸门，十五步到墙根，十步到海把小路吃掉一半、铁锚从崖壁里露出来的地方。'
].join('\n\n');

const cases = [
  { id: '2k-100', label: '2560x1440 @100%（桌面 2K）', width: 2560, height: 1440, scale: 1 },
  { id: '2k-125', label: '2K 笔记本 125% 缩放（CSS 2048x1152）', width: 2048, height: 1152, scale: 1.25 },
  { id: '2k-150', label: '2K 笔记本 150% 缩放（CSS 1707x960）', width: 1707, height: 960, scale: 1.5 }
];

async function measure(page) {
  return page.evaluate(() => {
    const writer = document.querySelector('[data-native-writer]');
    const editor = document.querySelector('[data-native-scene-editor]');
    const assistant = document.querySelector('.desktop-native-assistant');
    const header = document.querySelector('.desktop-native-editor-header');
    const generate = document.querySelector('[data-native-generate]');
    const thinking = document.querySelector('[data-native-thinking-toggle]');
    const advanced = document.querySelector('[data-native-generation-advanced]');
    const nav = document.querySelector('.desktop-nav');
    const r = (el) => {
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        x: Math.round(box.left),
        y: Math.round(box.top),
        w: Math.round(box.width),
        h: Math.round(box.height)
      };
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      overflowY: document.documentElement.scrollHeight - window.innerHeight,
      placement: writer && writer.classList.contains('is-assistant-bottom') ? 'bottom' : 'right',
      writer: r(writer),
      editor: r(editor),
      assistant: r(assistant),
      header: r(header),
      generate: r(generate),
      thinking: r(thinking),
      beat: r(document.querySelector('[data-native-beat-input]')),
      rewrite: r(document.querySelector('[data-native-rewrite-instruction]')),
      composer: r(document.querySelector('[data-native-composer="generate"]')),
      modelName: r(document.querySelector('[data-native-composer-model]')),
      preview: r(document.querySelector('[data-native-preview-prompt]')),
      settings: r(document.querySelector('[data-native-open-writer-settings]')),
      resizer: r(document.querySelector('[data-native-resize-assistant]')),
      advancedOpen: !!(advanced && advanced.open),
      nav: r(nav)
    };
  });
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-writer-2k-'));
  await fs.mkdir(reportDir, { recursive: true });
  let servers = null;
  let browser = null;
  const metrics = [];

  try {
    await projectService.createProject(dataRoot, {
      id: 'writer-2k-project',
      title: '2K 写作区实拍',
      chapters: [
        { id: 'chapter-1', title: '雾港', order: 0 },
        { id: 'chapter-2', title: '灯塔', order: 1 }
      ],
      scenes: [
        { id: 'scene-1', chapterId: 'chapter-1', title: '潮声', summary: '玛拉到港。', content: prose, order: 0 },
        { id: 'scene-2', chapterId: 'chapter-1', title: '闸门', summary: '闸门自己开了。', content: prose, order: 1 },
        { id: 'scene-3', chapterId: 'chapter-2', title: '绿玻璃', summary: '顶层的光转向他们。', content: prose, order: 0 }
      ]
    });
    servers = await startDesktopServers({ appRoot: projectRoot, dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });

    for (const view of cases) {
      const page = await browser.newPage({
        viewport: { width: view.width, height: view.height },
        deviceScaleFactor: 1
      });
      await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.desktop-project-card');
      await page.focus('.desktop-project-card');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#desktop-root')?.dataset.view === 'writer');
      await page.waitForSelector('[data-native-scene-editor]:not([disabled])');
      await page.evaluate(() => {
        if (typeof applyDesktopTheme === 'function') applyDesktopTheme('morandi-ink');
      });

      for (const placement of ['bottom', 'right']) {
        await setAssistantPlacement(page, placement);
        await openNativePanel(page, 'generate');
        await page.waitForTimeout(200);
        const shotA = `${view.id}-${placement}-editing.png`;
        await page.screenshot({ path: path.join(reportDir, shotA), fullPage: false });
        metrics.push({ view: view.label, placement, state: 'editing', file: shotA, ...(await measure(page)) });

        await openGenerationAdvanced(page);
        await page.waitForTimeout(200);
        const shotB = `${view.id}-${placement}-advanced.png`;
        await page.screenshot({ path: path.join(reportDir, shotB), fullPage: false });
        metrics.push({ view: view.label, placement, state: 'advanced', file: shotB, ...(await measure(page)) });
        await page.evaluate(() => {
          const dialog = document.querySelector('[data-native-writer-settings-dialog]');
          if (dialog && dialog.open && typeof dialog.close === 'function') dialog.close();
        });

        await openNativePanel(page, 'rewrite');
        await page.waitForTimeout(200);
        const shotR = `${view.id}-${placement}-rewrite.png`;
        await page.screenshot({ path: path.join(reportDir, shotR), fullPage: false });
        metrics.push({ view: view.label, placement, state: 'rewrite', file: shotR, ...(await measure(page)) });
        await openNativePanel(page, 'generate');
      }

      await setAssistantPlacement(page, 'bottom');
      await page.evaluate(() => {
        const writer = document.querySelector('[data-native-writer]');
        if (writer && !writer.classList.contains('is-focus-mode')) {
          document.querySelector('[data-native-focus-mode]')?.click();
        }
      });
      await page.waitForTimeout(200);
      const shotC = `${view.id}-focus.png`;
      await page.screenshot({ path: path.join(reportDir, shotC), fullPage: false });
      metrics.push({ view: view.label, placement: 'bottom', state: 'focus', file: shotC, ...(await measure(page)) });
      await page.close();
    }

    await fs.writeFile(path.join(reportDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`2K visual audit wrote ${metrics.length} shots to ${path.relative(projectRoot, reportDir)}`);
    metrics.forEach((row) => {
      console.log(`${row.file} editor=${row.editor && row.editor.w}x${row.editor && row.editor.h} dock=${row.assistant && row.assistant.w}x${row.assistant && row.assistant.h} overflow=${row.overflowX}/${row.overflowY}`);
    });
  } finally {
    if (browser) await browser.close();
    if (servers && typeof servers.close === 'function') servers.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
