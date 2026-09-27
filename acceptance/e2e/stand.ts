// Общие средства e2e-стенда QA (Q0.1): базовый адрес и проверка настройки.
// Стенд работает только через браузер и HTTP, код из apps/ не импортируется.

const FORBIDDEN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/** Базовый адрес стека из PUBLIC_BASE_URL, без завершающего `/`. */
export function publicBaseUrl(): string {
  const raw = (process.env.PUBLIC_BASE_URL ?? '').trim();
  if (!raw) {
    throw new Error(
      'PUBLIC_BASE_URL не задан. Пример: PUBLIC_BASE_URL=http://192.168.1.20 pnpm playwright test',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`PUBLIC_BASE_URL должен быть http(s)://<хост>[:порт], получено: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`PUBLIC_BASE_URL должен быть http(s)://<хост>[:порт], получено: ${raw}`);
  }
  if (FORBIDDEN_HOSTS.has(url.hostname)) {
    throw new Error(`PUBLIC_BASE_URL=${raw}: localhost не используется, укажите IP машины в сети`);
  }
  return raw.replace(/\/+$/, '');
}

/** Заготовка фикстуры, для которой в продукте ещё нет публичного API. */
export function pending(fixture: string, task: string): never {
  throw new Error(
    `Фикстура «${fixture}» — заготовка стенда Q0.1: появится после ${task}, ` +
      'когда станет известен публичный API из handoff задачи.',
  );
}
