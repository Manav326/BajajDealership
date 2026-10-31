import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  // Cross-browser customer showroom smoke is run only by playwright.compat.config.ts.
  testIgnore: ['**/browser-compatibility.spec.ts'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    // Dedicated test port keeps the Docker-hosted staff portal on 3001 untouched.
    baseURL: 'http://127.0.0.1:3101',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
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
