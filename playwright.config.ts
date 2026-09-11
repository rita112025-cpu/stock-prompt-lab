import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.test.ts',
  outputDir: './screenshots/browser-tests',
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { outputFolder: 'screenshots/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173/stock-prompt-lab/',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Taipei',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/stock-prompt-lab/',
    reuseExistingServer: false,
  },
});
