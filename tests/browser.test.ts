import { test as base, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeCsv, parseHoldingsCsv } from '../src/holdingsCsv';

const test = base.extend<{ browserErrors: void }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await use();
    expect(errors, 'Browser runtime and console errors').toEqual([]);
  }, { auto: true }],
});

// All holdings used here are fictional. No personal data is loaded.
const fixture = encodeCsv([
  ['code', 'name', 'shares', 'costAvg', 'price', 'account', 'factor'],
  ['0001', '測試甲', 10, 100, 120, '測試帳戶甲', '測試因子'],
  ['9999', '測試乙', 20, 50, 40, '測試帳戶乙', '測試因子'],
]);

async function importCsv(page: Page, buffer = Buffer.from(fixture)) {
  await page.getByLabel('選擇持股 CSV').setInputFiles({ name: 'fixture.csv', mimeType: 'text/csv', buffer });
  await expect(page.getByRole('heading', { name: '匯入預覽：2 筆持股' })).toBeVisible();
  await page.getByRole('button', { name: '取代檔案中的帳戶', exact: true }).click();
  await expect(page.getByLabel('0001 因子')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('empty initial portfolio has zero totals and no stored holdings', async ({ page }) => {
  await expect(page.getByText('尚未匯入持股。', { exact: false })).toBeVisible();
  await expect(page.locator('footer')).toContainText('全部 0筆');
  await expect(page.locator('footer')).toContainText('總成本 0 • 總市值 0');
  await page.getByRole('button', { name: '持股表', exact: true }).click();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
});

test('editing shares, cost and price recalculates totals, profit and weights', async ({ page }) => {
  await importCsv(page);
  const row = page.getByLabel('0001 因子').locator('../..');
  await row.getByRole('spinbutton').nth(0).fill('20');
  await expect(page.locator('footer')).toContainText('總成本 3,000 • 總市值 3,200');
  await row.getByRole('spinbutton').nth(1).fill('90');
  await row.getByRole('spinbutton').nth(2).fill('160');
  await expect(page.locator('footer')).toContainText('總成本 2,800 • 總市值 4,000 • 損益 1,200 (42.86%)');
  await expect(row).toContainText('77.78%');
  await expect(row).toContainText('80.00%');
  await row.getByRole('spinbutton').nth(0).fill('-1');
  await expect(row.getByRole('spinbutton').nth(0)).toHaveValue('20');
  await expect(page.locator('footer')).toContainText('總市值 4,000');
});

test('desktop pages remain within the viewport', async ({ page }) => {
  for (const tab of ['總覽', 'Prompt庫']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  }
  await importCsv(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test('CSV import, totals, account filters, and invalid import preserve existing holdings', async ({ page }) => {
  await importCsv(page);
  await expect(page.locator('footer')).toContainText('總成本 2,000');
  await expect(page.locator('footer')).toContainText('總市值 2,000');
  await page.getByRole('button', { name: '測試帳戶甲', exact: true }).click();
  await expect(page.getByLabel('9999 因子')).toHaveCount(0);
  await expect(page.locator('footer')).toContainText('總市值 1,200');
  await page.getByLabel('選擇持股 CSV').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture.replace('"10"', '"1,2"')) });
  await expect(page.getByRole('alert')).toContainText('匯入失敗');
  await expect(page.getByLabel('0001 因子')).toBeVisible();
  await expect(page.locator('footer')).toContainText('總市值 1,200');
});

test('factor editing supports names that collide with object properties', async ({ page }) => {
  await importCsv(page);
  await page.getByLabel('0001 因子').fill('constructor');
  await page.getByLabel('9999 因子').fill('__proto__');
  await page.getByRole('button', { name: '總覽', exact: true }).click();
  await expect(page.getByText('constructor', { exact: true }).locator('..')).toContainText('60.0% • 1,200');
  await expect(page.getByText('__proto__', { exact: true }).locator('..')).toContainText('40.0% • 800');
});

test('Prompt copy writes literal variables and filtered holdings to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByLabel('關注標的 ticker').fill('$& {{date}}');
  await page.locator('article').filter({ hasText: '單一股票完整分析' }).getByRole('button', { name: '複製 Prompt', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('標的：$& {{date}}');
  await importCsv(page);
  await page.getByRole('button', { name: '測試帳戶甲', exact: true }).click();
  await page.getByRole('button', { name: 'Prompt庫', exact: true }).click();
  await page.locator('article').filter({ hasText: '持股組合健檢' }).getByRole('button', { name: '複製 Prompt', exact: true }).first().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('測試甲');
  expect(copied).not.toContain('測試乙');
  expect(copied).toContain('總市值 1,200');
});

test('copy failure provides a manual copy dialog', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = () => false;
  });
  await page.locator('article').first().getByRole('button', { name: '複製 Prompt', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /手動複製/ })).toBeVisible();
  await expect(page.locator('textarea')).toHaveValue(/資深投資分析師/);
});

test('downloaded CSV reimports without losing values, leading zeros, or edited factors', async ({ page }) => {
  await importCsv(page);
  await page.getByLabel('0001 因子').fill('constructor');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV 下載', exact: true }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).toBeTruthy();
  const buffer = await readFile(path!);
  const expected = parseHoldingsCsv(fixture);
  expected[0].factor = 'constructor';
  expect(parseHoldingsCsv(buffer.toString('utf8'))).toEqual(expected);
  await page.reload();
  await importCsv(page, buffer);
  await expect(page.getByLabel('0001 因子')).toHaveValue('constructor');
  await expect(page.locator('footer')).toContainText('總市值 2,000');
});

test('refresh clears holdings and blocks portfolio Prompt copy', async ({ page }) => {
  await importCsv(page);
  await page.reload();
  await expect(page.getByText('尚未匯入持股。', { exact: false })).toBeVisible();
  await expect(page.locator('footer')).toContainText('全部 0筆');
  await page.locator('article').filter({ hasText: '持股組合健檢' }).getByRole('button', { name: '複製 Prompt', exact: true }).first().click();
  await expect(page.getByRole('status')).toContainText('請先匯入持股 CSV');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

for (const width of [390, 320]) {
  test(`mobile ${width}px keeps page within viewport and portfolio scrollable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    for (const tab of ['總覽', 'Prompt庫']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await importCsv(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const tableScroll = page.locator('.overflow-x-auto').filter({ has: page.getByLabel('0001 因子') });
    expect(await tableScroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByLabel('0001 因子').fill('手機測試');
    await expect(page.getByLabel('0001 因子')).toHaveValue('手機測試');
    await page.screenshot({ path: testInfo.outputPath(`mobile-${width}.png`), fullPage: true });
  });
}

test('replace only updates accounts in the file, add blocks duplicates, and a missing account must be chosen', async ({ page }) => {
  await importCsv(page);
  const update = encodeCsv([['code', 'name', 'shares', 'costAvg', 'price', 'account'], ['0001', '測試甲', 30, 100, 130, '測試帳戶甲']]);
  await page.getByLabel('選擇持股 CSV').setInputFiles({ name: 'update.csv', mimeType: 'text/csv', buffer: Buffer.from(update) });
  await expect(page.getByRole('heading', { name: '匯入預覽：1 筆持股' })).toBeVisible();
  await expect(page.getByRole('button', { name: '加入現有持股', exact: true })).toBeDisabled();
  await expect(page.getByText('已有相同帳戶與代號的持股', { exact: false })).toBeVisible();
  await expect(page.getByText('因子會被 CSV 覆蓋', { exact: false })).toContainText('測試帳戶甲 0001：測試因子 → ETF');
  await page.getByRole('button', { name: '取代檔案中的帳戶', exact: true }).click();
  await expect(page.getByLabel('9999 因子')).toBeVisible();
  await expect(page.locator('footer')).toContainText('總市值 4,700');

  const noAccount = encodeCsv([['code', 'name', 'shares', 'costAvg', 'price'], ['9998', '測試丙', 5, 10, 10]]);
  await page.getByLabel('選擇持股 CSV').setInputFiles({ name: 'no-account.csv', mimeType: 'text/csv', buffer: Buffer.from(noAccount) });
  await expect(page.getByRole('button', { name: '加入現有持股', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取代檔案中的帳戶', exact: true })).toBeDisabled();
  await page.getByLabel('匯入帳戶').fill('測試帳戶乙');
  await page.getByRole('button', { name: '加入現有持股', exact: true }).click();
  await expect(page.getByLabel('9998 因子')).toBeVisible();
  await expect(page.locator('footer')).toContainText('總市值 4,750');

  const partial = encodeCsv([['code', 'name', 'shares', 'costAvg', 'price', 'account'], ['9997', '測試丁', 1, 1, 1, '測試帳戶乙']]);
  await page.getByLabel('選擇持股 CSV').setInputFiles({ name: 'partial.csv', mimeType: 'text/csv', buffer: Buffer.from(partial) });
  const dropped = page.getByText('取代後會被移除', { exact: false });
  await expect(dropped).toContainText('測試帳戶乙 9999');
  await expect(dropped).toContainText('測試帳戶乙 9998');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('footer')).toContainText('總市值 4,750');
});
