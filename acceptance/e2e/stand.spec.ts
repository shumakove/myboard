// Служебные проверки самого стенда Q0.1 (не приёмка требований).
import { test, expect } from './fixtures';

test('stand: PUBLIC_BASE_URL отвечает любым HTTP-ответом', async ({ request }) => {
  const response = await request.get('/', { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(100);
  expect(response.status()).toBeLessThan(600);
});

test('stand: два клиента не делят cookie', async ({ twoClients, baseURL }) => {
  const [a, b] = twoClients;
  await a.context.addCookies([{ name: 'probe', value: 'a', url: baseURL! }]);
  expect(await b.context.cookies()).toEqual([]);
});
