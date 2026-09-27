// Средства приёмки входа пользователя досок (T1.2): вызовы API и учётки.
// Публичный API — из handoff T1.2: POST /api/login, POST /api/logout, GET /api/session.
import type { APIRequestContext, Browser } from '@playwright/test';
import { apiAdminLogin, apiCreateUser, type CreatedUser } from './admin';

export const SESSION_COOKIE = 'myboard_session';

/** Учётка пользователя досок, созданная администратором в отдельном контексте. */
export async function createBoardUser(
  browser: Browser,
  baseURL: string | undefined,
  overrides: Partial<Omit<CreatedUser, 'id'>> = {},
): Promise<CreatedUser> {
  const adminCtx = await browser.newContext({ baseURL });
  try {
    await apiAdminLogin(adminCtx.request);
    return await apiCreateUser(adminCtx.request, overrides);
  } finally {
    await adminCtx.close();
  }
}

/** Изменение учётки администратором (ADM-04…06). */
export async function adminPatchUser(
  browser: Browser,
  baseURL: string | undefined,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const adminCtx = await browser.newContext({ baseURL });
  try {
    await apiAdminLogin(adminCtx.request);
    const res = await adminCtx.request.patch(`/api/admin/users/${id}`, { data });
    if (res.status() !== 200) throw new Error(`изменение учётки: ${res.status()} ${await res.text()}`);
  } finally {
    await adminCtx.close();
  }
}

/** Вход пользователя через API в контексте запросов (cookie попадает в контекст). */
export async function apiUserLogin(request: APIRequestContext, user: CreatedUser): Promise<void> {
  const res = await request.post('/api/login', { data: { email: user.email, password: user.password } });
  if (res.status() !== 204) throw new Error(`вход пользователя: ${res.status()} ${await res.text()}`);
}
