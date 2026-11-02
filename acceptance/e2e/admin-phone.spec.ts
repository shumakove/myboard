// Перепроверка BUG-021 · список учётных записей администратора на телефоне (ADM-04, ADM-05, UI-04).
// Сценарии — docs/qa/reports/T1.1.md. Нажатия — настоящие касания по координатам, а не Locator.click:
// баг был в том, что касание уходило в другую строку.
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { apiCreateUser, uniqueEmail } from './admin';

const MIN_TARGET = 44;

test.describe.configure({ timeout: 180_000 });

async function openUsers(page: Page) {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Create user' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

interface Layout {
  rows: number;
  pageHeight: number;
  pageWidth: number;
  viewportWidth: number;
  avgRowHeight: number;
  maxRowHeight: number;
  tableWidth: number;
  emailCellWidth: number;
}

async function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const heights = rows.map((r) => r.getBoundingClientRect().height);
    const emails = [...document.querySelectorAll('td.admin-email')].map((c) => c.getBoundingClientRect().width);
    return {
      rows: rows.length,
      pageHeight: document.documentElement.scrollHeight,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      avgRowHeight: heights.reduce((a, b) => a + b, 0) / Math.max(1, heights.length),
      maxRowHeight: Math.max(0, ...heights),
      tableWidth: document.querySelector('table')?.getBoundingClientRect().width ?? 0,
      emailCellWidth: emails.length ? Math.min(...emails) : 0,
    };
  });
}

/** Что браузер находит под центром кнопки и совпадает ли это с самой кнопкой. */
async function hitInfo(button: Locator): Promise<{ hit: boolean; under: string; x: number; y: number; w: number; h: number }> {
  await button.scrollIntoViewIfNeeded();
  return button.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const under = document.elementFromPoint(x, y);
    return {
      hit: !!under && (under === el || el.contains(under)),
      under: under ? `${under.tagName}: ${(under.textContent ?? '').slice(0, 60)}` : 'null',
      x,
      y,
      w: b.width,
      h: b.height,
    };
  });
}

/** Настоящее касание в центр кнопки; на компьютере — щелчок мышью в ту же точку. */
async function tapCenter(page: Page, button: Locator, touch: boolean) {
  const info = await hitInfo(button);
  expect(info.hit, `под центром кнопки: ${info.under}`).toBe(true);
  if (touch) await page.touchscreen.tap(info.x, info.y);
  else await page.mouse.click(info.x, info.y);
}

/** Строки на концах и в середине списка. */
function sampleIndexes(count: number): number[] {
  return [...new Set([0, Math.floor(count / 2), count - 1])];
}

test('ADM-04 ADM-05 UI-04 BUG-021 row buttons take the touch at both ends and in the middle of the list', async ({ adminPage: page, hasTouch }, info) => {
  await apiCreateUser(page.request);
  await openUsers(page);
  const layout = await measure(page);
  info.annotations.push({ type: 'BUG-021 раскладка', description: JSON.stringify(layout) });
  console.log(`BUG-021 раскладка [${info.project.name}]: ${JSON.stringify(layout)}`);
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);

  const rows = page.locator('tbody tr');
  for (const i of sampleIndexes(layout.rows)) {
    const row = rows.nth(i);
    const email = await row.getAttribute('aria-label');
    const name = (await row.locator('td').first().innerText()).trim();

    for (const label of ['Edit', /^(Disable|Enable)$/]) {
      const button = row.getByRole('button', { name: label });
      const hit = await hitInfo(button);
      expect(hit.hit, `строка ${i} (${email}), кнопка ${label}: под центром ${hit.under}`).toBe(true);
      if (hasTouch) expect(hit.w, `строка ${i}: ширина ${label}`).toBeGreaterThanOrEqual(MIN_TARGET);
      if (hasTouch) expect(hit.h, `строка ${i}: высота ${label}`).toBeGreaterThanOrEqual(MIN_TARGET);
    }

    await tapCenter(page, row.getByRole('button', { name: 'Edit' }), hasTouch);
    const editing = page.getByRole('row', { name: email! });
    await expect(editing.getByLabel('Name'), `строка ${i}: открылась правка ${email}`).toHaveValue(name);
    await expect(editing.getByLabel('Email')).toHaveValue(email!);
    await tapCenter(page, editing.getByRole('button', { name: 'Cancel' }), hasTouch);
    await expect(editing.getByRole('button', { name: 'Edit' })).toBeVisible();
  }
});

test('ADM-04 BUG-021 tap on Edit in the row of a new account changes only that account', async ({ adminPage: page, hasTouch }) => {
  const user = await apiCreateUser(page.request);
  const before = (await (await page.request.get('/api/admin/users')).json()) as { id: string; name: string; email: string }[];
  await openUsers(page);
  const row = page.getByRole('row', { name: user.email });
  await tapCenter(page, row.getByRole('button', { name: 'Edit' }), hasTouch);
  await row.getByLabel('Name').fill(`Edited ${user.name}`);
  await tapCenter(page, row.getByRole('button', { name: 'Save' }), hasTouch);
  await expect(row).toContainText(`Edited ${user.name}`);

  const after = (await (await page.request.get('/api/admin/users')).json()) as { id: string; name: string; email: string }[];
  expect(before.find((u) => u.id === user.id)?.name).toBe(user.name);
  expect(after.filter((u) => u.name === `Edited ${user.name}`).map((u) => u.id)).toEqual([user.id]);
  expect(after.find((u) => u.id === user.id)?.email).toBe(user.email);
});

test('ADM-05 ADM-06 BUG-021 tap on Disable disables that account and no other', async ({ adminPage: page, hasTouch }) => {
  const user = await apiCreateUser(page.request);
  const neighbour = await apiCreateUser(page.request);
  await openUsers(page);
  const row = page.getByRole('row', { name: user.email });
  await tapCenter(page, row.getByRole('button', { name: 'Disable' }), hasTouch);
  await expect(row).toContainText('Disabled');
  const list = (await (await page.request.get('/api/admin/users')).json()) as { id: string; disabled: boolean }[];
  expect(list.find((u) => u.id === user.id)?.disabled).toBe(true);
  expect(list.find((u) => u.id === neighbour.id)?.disabled).toBe(false);
  await tapCenter(page, row.getByRole('button', { name: 'Enable' }), hasTouch);
  await expect(row).toContainText('Active');
});

const LONG_VALUES: [string, string, () => string][] = [
  ['long name without spaces', 'N'.repeat(200), () => uniqueEmail('long-name')],
  ['long Cyrillic name', 'Ё'.repeat(200), () => uniqueEmail('long-cyr')],
  ['long email', 'Plain Name', () => `${'a'.repeat(50)}${Math.random().toString(36).slice(2, 8)}@${'b'.repeat(60)}.example.com`],
];

for (const [title, name, email] of LONG_VALUES) {
  test(`ADM-04 UI-04 BUG-021 ${title}: the page keeps its width, row buttons work, the value stays whole`, async ({ adminPage: page, hasTouch }, info) => {
    const user = await apiCreateUser(page.request, { name, email: email() });
    await openUsers(page);
    const layout = await measure(page);
    info.annotations.push({ type: 'BUG-021 раскладка', description: JSON.stringify(layout) });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);

    const row = page.getByRole('row', { name: user.email });
    await expect(row.locator('td').first()).toHaveText(name);
    await expect(row.locator('td.admin-email')).toHaveText(user.email);
    // Значение не обрезано: ячейка показывает весь текст, а не прячет его.
    const clipped = await row.locator('td').first().evaluate((td) => td.scrollWidth > td.clientWidth + 1);
    expect(clipped, 'имя не вылезает за ячейку').toBe(false);

    await tapCenter(page, row.getByRole('button', { name: 'Edit' }), hasTouch);
    await expect(row.getByLabel('Name')).toHaveValue(name);
    await tapCenter(page, row.getByRole('button', { name: 'Cancel' }), hasTouch);
    await tapCenter(page, row.getByRole('button', { name: 'Disable' }), hasTouch);
    await expect(row).toContainText('Disabled');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
