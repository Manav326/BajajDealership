import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: ['browser-compatibility.spec.ts'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/browser-compatibility.json' }],
    ['html', { outputFolder: 'playwright-compat-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 3101 --strictPort',
      cwd: webDirectory,
      url: 'http://127.0.0.1:3101',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      cwd: path.resolve(webDirectory, '../customer-web'),
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
