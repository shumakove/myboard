// Фикстуры e2e-стенда QA (Q0.1). Тесты импортируют `test` и `expect` отсюда.
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { apiAdminLogin } from './admin';
import { apiUserLogin, createBoardUser } from './user';

/** Независимый браузерный клиент: свой контекст (cookie, хранилище) и вкладка. */
export interface BrowserClient {
  context: BrowserContext;
  page: Page;
}

interface StandFixtures {
  /** Два независимых клиента в профиле проекта — для COL-*, SHR-04, realtime. */
  twoClients: [BrowserClient, BrowserClient];
  /** Вкладка, вошедшая как администратор (ADM-01). */
  adminPage: Page;
  /** Вкладка пользователя досок, созданного администратором (ADM-03, ACC-01). */
  boardUserPage: Page;
  /** Доска пользователя досок (BRD-01). */
  board: { id: string; title?: string };
  /** Вкладка участника по ссылке /b/{token}, назвавшего имя (SHR-02, SHR-03). */
  linkParticipantPage: Page;
}

export const test = base.extend<StandFixtures>({
  twoClients: async (
    { browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor },
    use,
  ) => {
    // Контексты создаются с настройками текущего профиля (desktop или mobile).
    const options = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
    const make = async (): Promise<BrowserClient> => {
      const context = await browser.newContext(options);
      return { context, page: await context.newPage() };
    };
    const clients: [BrowserClient, BrowserClient] = [await make(), await make()];
    await use(clients);
    await Promise.all(clients.map((c) => c.context.close()));
  },
  adminPage: async ({ page }, use) => {
    // Вход через публичный API: cookie сессии попадает в контекст вкладки (T1.1).
    await apiAdminLogin(page.request);
    await use(page);
  },
  boardUserPage: async ({ page, browser, baseURL }, use) => {
    // Учётку создаёт администратор, вход — через публичный API (T1.2).
    const user = await createBoardUser(browser, baseURL);
    await apiUserLogin(page.request, user);
    await use(page);
  },
  board: async ({ boardUserPage }, use) => {
    // Доска вошедшего пользователя: POST /api/boards из handoff T2.1.
    const res = await boardUserPage.request.post('/api/boards', { data: { title: `QA board ${Date.now()}` } });
    if (res.status() !== 201) throw new Error(`создание доски: ${res.status()} ${await res.text()}`);
    await use((await res.json()) as { id: string });
  },
  linkParticipantPage: async (
    { browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor, boardUserPage, board },
    use,
  ) => {
    // Ссылка владельца и вход участника — API из handoff T3.1; контекст без сессии пользователя.
    const res = await boardUserPage.request.get(`/api/boards/${board.id}/share`);
    if (res.status() !== 200) throw new Error(`ссылка на доску: ${res.status()} ${await res.text()}`);
    const { token } = (await res.json()) as { token: string };
    const context = await browser.newContext({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
    const joined = await context.request.post(`/api/share/${token}/join`, { data: { name: 'QA Guest' } });
    if (joined.status() !== 200) throw new Error(`вход по ссылке: ${joined.status()} ${await joined.text()}`);
    const page = await context.newPage();
    await page.goto(`/b/${token}`);
    await use(page);
    await context.close();
  },
});

export { expect };
