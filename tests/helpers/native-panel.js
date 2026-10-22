const PANEL_GROUP = {
  generate: 'writing',
  rewrite: 'writing',
  characters: 'context',
  context: 'context',
  metadata: 'document',
  structure: 'document',
  search: 'document',
  history: 'writing'
};

async function openNativePanel(page, tab) {
  const desk = await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-literary-desk'));
  if (desk) {
    if (tab === 'generate' || tab === 'rewrite') {
      await page.locator(`[data-native-desk-mode="${tab === 'rewrite' ? 'revise' : 'write'}"]`).click();
      const composerToggle = page.locator('[data-native-desk-composer-toggle]');
      if (await composerToggle.isVisible() && await composerToggle.getAttribute('aria-expanded') === 'false') await composerToggle.click();
    } else {
      await page.locator('[data-native-desk-tool]').selectOption(tab);
    }
    await page.locator(`[data-native-panel="${tab}"]`).waitFor({ state: 'visible' });
    return;
  }
  await page.click(`[data-native-assistant-group="${PANEL_GROUP[tab]}"]`);
  await page.click(`[data-native-panel-tab="${tab}"]`);
}

async function openGenerationAdvanced(page) {
  const dialog = page.locator('[data-native-writer-settings-dialog]');
  if (await dialog.count()) {
    const open = await dialog.evaluate((el) => el.open);
    if (!open) {
      const composerToggle = page.locator('[data-native-desk-composer-toggle]');
      if (await composerToggle.isVisible() && await composerToggle.getAttribute('aria-expanded') === 'false') await composerToggle.click();
      await page.locator('[data-native-open-writer-settings]:visible').first().click();
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-native-writer-settings-dialog]');
        return el && el.open;
      });
    }
    return;
  }
  const advanced = page.locator('[data-native-generation-advanced]');
  if (!await advanced.evaluate(el => el.open)) await advanced.locator('summary').click();
}

async function closeGenerationAdvanced(page) {
  const dialog = page.locator('[data-native-writer-settings-dialog]');
  if (await dialog.count()) {
    if (await dialog.evaluate(el => el.open)) await page.locator('[data-native-close-writer-settings]').click();
    return;
  }
  const advanced = page.locator('[data-native-generation-advanced]');
  if (await advanced.count() && await advanced.evaluate(el => el.open)) await advanced.locator('summary').click();
}

async function openMoreMenu(page) {
  const alreadyOpen = await page.evaluate(() => {
    const menu = document.querySelector('[data-native-more-menu]');
    return menu && !menu.hidden;
  });
  if (alreadyOpen) return;
  await page.click('[data-native-more-tools]');
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-native-more-menu]');
    return menu && !menu.hidden;
  });
}

async function clickMoreAction(page, selector) {
  await openMoreMenu(page);
  await page.click(selector);
}

async function openOutlineMenu(page, selector) {
  await page.locator(selector).click({ button: 'right' });
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-native-outline-menu]');
    return menu && !menu.hidden;
  });
}

async function setAssistantPlacement(page, placement) {
  const desk = await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-literary-desk'));
  if (desk) await page.locator('[data-native-desk-layout]').click();
  const wantBottom = placement === 'bottom';
  const isBottom = await page.evaluate(() => document.querySelector('[data-native-writer]').classList.contains('is-assistant-bottom'));
  if (isBottom === wantBottom) return;
  await clickMoreAction(page, '[data-native-assistant-placement]');
  await page.waitForFunction((want) => {
    const writer = document.querySelector('[data-native-writer]');
    return writer && writer.classList.contains('is-assistant-bottom') === want;
  }, wantBottom);
}

module.exports = {
  PANEL_GROUP,
  openNativePanel,
  openGenerationAdvanced,
  closeGenerationAdvanced,
  openMoreMenu,
  clickMoreAction,
  openOutlineMenu,
  setAssistantPlacement
};
