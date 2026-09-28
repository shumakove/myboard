// Средства приёмки панели администратора (T1.1): учётные данные и вызовы API.
// Учётные данные — ADMIN_EMAIL/ADMIN_PASSWORD окружения прогона, иначе deploy/compose/.env.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';

const ENV_FILE = fileURLToPath(new URL('../../deploy/compose/.env', import.meta.url));

function envFileValues(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const values: Record<string, string> = {};
  for (const raw of readFileSync(ENV_FILE, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return values;
}

export function adminCredentials(): { email: string; password: string } {
  const file = envFileValues();
  const email = process.env.ADMIN_EMAIL || file.ADMIN_EMAIL || '';
  const password = process.env.ADMIN_PASSWORD || file.ADMIN_PASSWORD || '';
  if (!email || !password) {
    throw new Error('Нет ADMIN_EMAIL/ADMIN_PASSWORD ни в окружении, ни в deploy/compose/.env');
  }
  return { email, password };
}

export const ADMIN_COOKIE = 'myboard_admin';

export function uniqueEmail(prefix = 'e2e'): string {
  return `qa-${prefix}-${Math.random().toString(36).slice(2, 12)}@example.com`;
}

export interface CreatedUser {
  id: string;
  name: string;
  email: string;
  password: string;
}

/** Вход администратора через API в контексте запросов (cookie попадают в контекст). */
export async function apiAdminLogin(request: APIRequestContext): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await request.post('/api/admin/login', { data: adminCredentials() });
    // `429` общего лимита стенда пережидается.
    if (res.status() === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, (Number(res.headers()['retry-after'] ?? '60') + 1) * 1000));
      continue;
    }
    if (res.status() !== 204) throw new Error(`вход администратора: ${res.status()} ${await res.text()}`);
    return;
  }
}

export async function apiCreateUser(
  request: APIRequestContext,
  overrides: Partial<Omit<CreatedUser, 'id'>> = {},
): Promise<CreatedUser> {
  const data = {
    name: `QA User ${Math.random().toString(36).slice(2, 8)}`,
    email: uniqueEmail(),
    password: `pw-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
  const res = await request.post('/api/admin/users', { data });
  if (res.status() !== 201) throw new Error(`создание учётки: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return { id: body.id, ...data };
}
