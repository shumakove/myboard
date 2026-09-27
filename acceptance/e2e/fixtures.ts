// Фикстуры e2e-стенда QA (Q0.1). Тесты импортируют `test` и `expect` отсюда.
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { apiAdminLogin } from './admin';
import { pending } from './stand';
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
  board: { id: string };
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
  board: async ({}, _use) => pending('доска', 'T2.1'),
  linkParticipantPage: async ({}, _use) => pending('участник по ссылке', 'T3.1'),
});

export { expect };
