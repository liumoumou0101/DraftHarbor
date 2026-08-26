const PANEL_GROUP = {
  generate: 'writing',
  rewrite: 'writing',
  characters: 'context',
  context: 'context',
  metadata: 'document',
  structure: 'document',
  search: 'document',
  history: 'document'
};

async function openNativePanel(page, tab) {
  await page.click(`[data-native-assistant-group="${PANEL_GROUP[tab]}"]`);
  await page.click(`[data-native-panel-tab="${tab}"]`);
}

async function openGenerationAdvanced(page) {
  const dialog = page.locator('[data-native-writer-settings-dialog]');
  if (await dialog.count()) {
    const open = await dialog.evaluate((el) => el.open);
    if (!open) {
      await page.locator('[data-native-open-writer-settings]').first().click();
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-native-writer-settings-dialog]');
        return el && el.open;
      });
    }
    return;
  }
  await page.locator('[data-native-generation-advanced]').evaluate((el) => {
    el.open = true;
  });
}

async function closeGenerationAdvanced(page) {
  await page.evaluate(() => {
    const dialog = document.querySelector('[data-native-writer-settings-dialog]');
    if (dialog && dialog.open && typeof dialog.close === 'function') dialog.close();
    const advanced = document.querySelector('[data-native-generation-advanced]');
    if (advanced && !(advanced instanceof HTMLDialogElement)) advanced.open = false;
  });
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
