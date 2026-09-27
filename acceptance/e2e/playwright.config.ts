import { defineConfig, devices } from '@playwright/test';
import { publicBaseUrl } from './stand';

// Приёмочные e2e-тесты QA. Базовый адрес — только из PUBLIC_BASE_URL.
// --list работает и без переменной, чтобы можно было посмотреть набор тестов.
const listOnly = process.argv.includes('--list');
const baseURL = listOnly && !process.env.PUBLIC_BASE_URL ? undefined : publicBaseUrl();

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Ширина телефона и сенсорный ввод (MOB-*); движок Chromium.
      name: 'mobile',
      use: { ...devices['Pixel 7'], hasTouch: true, isMobile: true },
    },
  ],
});
