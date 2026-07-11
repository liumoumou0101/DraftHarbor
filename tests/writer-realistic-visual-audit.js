const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');

const projectRoot = path.resolve(__dirname, '..');
const reportDir = path.join(projectRoot, '.ai_state', 'test_reports', 'phase58_realistic_writer');

const viewports = [
  { width: 1280, height: 720 },
  { width: 1493, height: 1061 },
  { width: 1920, height: 1080 }
];

const themes = ['morandi-ink', 'mist-library', 'ash-rose'];

const prose = [
  'The harbor bell rang once through the fog, then seemed to hang there, suspended over the black water as if the whole coast had forgotten how to breathe.',
  'Mara kept one hand on the map case beneath her coat. The leather had gone slick with salt, and every time the wind shifted she could feel the old paper inside flex like something alive.',
  '"If the lantern is still burning, someone has been here," Kale said. He tried to make it sound useful. It came out like a warning.',
  'Past the broken pier, the lighthouse rose from a tooth of stone. Its windows were dark except for the top room, where a greenish light moved slowly behind the glass.',
  'Mara counted her steps. Twenty to the gate. Fifteen to the wall. Ten to the place where the sea had eaten half the path away and left iron anchors showing through the cliff.',
  'She had promised herself she would not think about the last expedition, about the six names cut into the memorial board, about the seventh line left blank because no one had agreed whether her father was dead.',
  'The gate opened before Kale touched it. The sound was soft, almost polite, and somehow worse for that.',
  'Inside, the courtyard smelled of rainwater, rust, and burned lavender. Someone had swept the stones clean. Someone had arranged three shells on the threshold, each one painted with a different eye.',
  '"Mara," Kale whispered. "Look at the tower."',
  'The lantern had turned toward them. Not the beam, not the housing, but the entire room at the top of the lighthouse, rotating without gears or sound until its blank windows faced the path.',
  'For a moment Mara saw her reflection in the glass from impossible distance: wet hair, split lip, map case held too tightly, and behind her a figure that was not Kale.',
  'Then the bell rang a second time, and the courtyard filled with the voices of people who had drowned years ago.'
].join('\n\n');

function chaptersAndScenes() {
  const chapters = [
    { id: 'part-1', title: 'Part I - The Drowned Coast', order: 0 },
    { id: 'chapter-1', title: 'Chapter 1: Harbor of Mist', order: 1 },
    { id: 'chapter-2', title: 'Chapter 2: The Lantern Keeper', order: 2 },
    { id: 'chapter-3', title: 'Chapter 3: The Old Light', order: 3 },
    { id: 'part-2', title: 'Part II - The Shifting Deep', order: 4 },
    { id: 'chapter-4', title: 'Chapter 4: Broken Compass', order: 5 },
    { id: 'chapter-5', title: 'Chapter 5: Smuggler Weather', order: 6 }
  ];

  const sceneTitles = [
    ['Morning Tide', 'A Map with No Shore', 'Harbor of Mist'],
    ['The Door Opens', 'Salt on the Steps', 'The Lantern Keeper'],
    ['Green Glass', 'The Bell Rings Twice', 'The Old Light'],
    ['North by Memory', 'Compass Rose', 'The Wrong Current'],
    ['Market Under Rain', 'Hidden Cargo', 'A Bargain in Fog']
  ];

  const scenes = [];
  chapters.filter((chapter) => chapter.id.startsWith('chapter-')).forEach((chapter, chapterIndex) => {
    sceneTitles[chapterIndex].forEach((title, sceneIndex) => {
      const selected = chapter.id === 'chapter-3' && sceneIndex === 1;
      scenes.push({
        id: `${chapter.id}-scene-${sceneIndex + 1}`,
        chapterId: chapter.id,
        title: `Scene ${sceneIndex + 1}: ${title}`,
        summary: selected
          ? 'Mara and Kale enter the lighthouse courtyard and discover that the old signal is watching them.'
          : 'A dense story beat used to validate outline hierarchy and realistic writer layout.',
        povCharacter: selected ? 'Mara' : '',
        tense: selected ? 'Close third / past' : '',
        goal: selected ? 'Find the source of the signal before the tide cuts off the path.' : '',
        content: selected ? prose : `${title}\n\n${prose.split('\n\n').slice(0, 3).join('\n\n')}`,
        order: sceneIndex
      });
    });
  });
  return { chapters, scenes };
}

async function createFixture(dataRoot) {
  const { chapters, scenes } = chaptersAndScenes();
  const created = await projectService.createProject(dataRoot, {
    id: 'phase58-realistic-writer',
    title: 'The Glass Horizon',
    description: 'A realistic visual QA project with dense manuscript content.',
    status: 'Drafting',
    tags: ['coastal fantasy', 'mystery', 'longform']
  });
  const defaultChapter = {
    ...created.project.chapters[0],
    title: 'Chapter 0: Cold Open',
    order: -1,
    sceneIds: [created.project.scenes[0].id]
  };
  const defaultScene = {
    ...created.project.scenes[0],
    title: 'Scene 1: Harbor Bell',
    summary: 'The opening scene used to validate realistic manuscript density.',
    content: prose,
    order: -1
  };
  const chapterSceneMap = scenes.reduce((acc, scene) => {
    acc[scene.chapterId] = acc[scene.chapterId] || [];
    acc[scene.chapterId].push(scene.id);
    return acc;
  }, {});
  const allChapters = [defaultChapter, ...chapters];
  const allScenes = [defaultScene, ...scenes];
  const project = {
    ...created.project,
    chapterOrder: allChapters.map((chapter) => chapter.id),
    sceneOrder: allScenes.map((scene) => scene.id),
    currentSceneId: defaultScene.id,
    chapters: allChapters.map((chapter) => ({
      ...chapter,
      sceneIds: chapterSceneMap[chapter.id] || chapter.sceneIds || []
    })),
    scenes: allScenes
  };
  await projectService.saveProject(dataRoot, project);

  await compendiumService.saveEntry(dataRoot, 'phase58-realistic-writer', {
    type: 'location',
    title: 'Old Coast Lighthouse',
    summary: 'A tide-locked lighthouse with a signal room that appears to move independently.',
    body: 'The lighthouse stands on a stone tooth beyond the harbor wall. Locals leave painted shells at the threshold.',
    tags: ['lighthouse', 'coast', 'signal'],
    alwaysInContext: true
  });

  await compendiumService.saveEntry(dataRoot, 'phase58-realistic-writer', {
    type: 'character',
    title: 'Mara Venn',
    summary: 'Cartographer searching for the missing expedition and her father.',
    body: 'Mara is precise under pressure, suspicious of easy answers, and afraid of inheriting her father\'s obsession.',
    tags: ['Mara', 'POV'],
    alwaysInContext: true
  });
}

async function openWriterProject(page, appUrl) {
  await page.goto(`${appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.desktop-project-card', { timeout: 10000 });
  await page.locator('.desktop-project-card').filter({ hasText: 'The Glass Horizon' }).first().click();
  await page.waitForFunction(() => document.querySelector('#desktop-root')?.dataset.view === 'writer');
  await page.waitForFunction(() => document.querySelector('[data-native-project-title]')?.textContent.includes('The Glass Horizon'));
  await page.waitForSelector('.desktop-native-scene', { timeout: 10000 });
  await page.locator('.desktop-native-scene:visible').first().click();
  await page.waitForFunction(() => {
    const editor = document.querySelector('[data-native-scene-editor]');
    return editor && !editor.disabled && editor.value.length > 500;
  });
}

async function auditViewport(page, label) {
  return page.evaluate((auditLabel) => {
    const issues = [];
    const tolerance = 2;

    function rectOf(element) {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        label: (element.textContent || element.getAttribute('title') || element.getAttribute('aria-label') || element.className || element.tagName)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100)
      };
    }

    function isVisible(element) {
      const closedDetails = element.closest('details:not([open])');
      if (closedDetails && !element.closest('summary')) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.offsetParent !== null;
    }

    function intersects(a, b) {
      return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > tolerance
        && Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > tolerance;
    }

    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + tolerance) {
      issues.push(`${auditLabel}: horizontal overflow ${doc.scrollWidth}px > ${window.innerWidth}px`);
    }

    const requiredVisible = [
      ['paper', '.desktop-native-paper-heading'],
      ['editor', '[data-native-scene-editor]'],
      ['outline', '.desktop-native-outline'],
      ['copilot', '.desktop-native-assistant'],
      ['toolbar', '.desktop-native-editor-actions']
    ];
    for (const [name, selector] of requiredVisible) {
      const element = document.querySelector(selector);
      if (!element || !isVisible(element)) issues.push(`${auditLabel}: ${name} is not visible`);
    }

    const groups = [
      ['editor toolbar', '.desktop-native-editor-actions button:not([hidden]), .desktop-native-editor-actions > div > span:not([hidden])'],
      ['assistant tabs', '.desktop-native-assistant-tabs button:not([hidden])'],
      ['outline scenes', '.desktop-native-scene'],
      ['copilot cards', '.desktop-native-copilot-brief, .desktop-native-copilot-context, .desktop-native-copilot-suggestions']
    ];

    for (const [name, selector] of groups) {
      const rects = Array.from(document.querySelectorAll(selector)).filter(isVisible).map(rectOf);
      for (let i = 0; i < rects.length; i += 1) {
        const rect = rects[i];
        if (rect.left < -tolerance || rect.right > window.innerWidth + tolerance) {
          issues.push(`${auditLabel}: ${name} item outside viewport: ${rect.label}`);
        }
        if (rect.width < 2 || rect.height < 2) {
          issues.push(`${auditLabel}: ${name} item collapsed: ${rect.label}`);
        }
        for (let j = i + 1; j < rects.length; j += 1) {
          if (intersects(rect, rects[j])) {
            issues.push(`${auditLabel}: ${name} overlap: "${rect.label}" with "${rects[j].label}"`);
          }
        }
      }
    }

    const editor = document.querySelector('[data-native-scene-editor]');
    if (editor) {
      const editorRect = rectOf(editor);
      if (editorRect.width < 420) issues.push(`${auditLabel}: manuscript editor too narrow (${editorRect.width}px)`);
      if (editor.scrollHeight <= editor.clientHeight) issues.push(`${auditLabel}: realistic prose should create manuscript scroll density`);
    }

    return issues;
  }, label);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-realistic-writer-'));
  let servers = null;
  let browser = null;

  try {
    await fs.mkdir(reportDir, { recursive: true });
    await createFixture(dataRoot);

    servers = await startDesktopServers({
      appRoot: projectRoot,
      dataRoot,
      revealPath: async () => ''
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: viewports[0] });
    await openWriterProject(page, servers.appUrl);

    const allIssues = [];
    for (const theme of themes) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.desktopTheme = nextTheme;
        document.querySelector('#desktop-root')?.setAttribute('data-desktop-theme', nextTheme);
      }, theme);

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(180);
        const label = `${theme}-${viewport.width}x${viewport.height}`;
        await page.screenshot({ path: path.join(reportDir, `realistic-${label}.png`), fullPage: false });
        allIssues.push(...await auditViewport(page, label));
      }
    }

    assert.deepStrictEqual(allIssues, [], `Realistic writer visual audit failed:\n${allIssues.join('\n')}`);
    console.log(`Realistic writer visual audit passed. Screenshots saved to ${path.relative(projectRoot, reportDir)}`);
  } finally {
    if (browser) await browser.close();
    if (servers && typeof servers.close === 'function') servers.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
