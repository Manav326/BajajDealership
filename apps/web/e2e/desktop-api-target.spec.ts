import { expect, test } from '@playwright/test';

test('Tauri desktop can switch between hosted and Local Docker APIs without rebuilding installers', async ({ page }) => {
  const bootstrapRequests: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });
  await page.route('**/api/v1/system/bootstrap/status', async (route) => {
    bootstrapRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: false, message: 'Owner setup is not enabled in this test.' }),
    });
  });

  await page.goto('/');
  const connection = page.getByLabel('Server connection');
  await expect(connection).toBeVisible();
  await expect(connection).toHaveValue('hosted');
  await expect.poll(() => bootstrapRequests.some((url) => url.startsWith('https://lucky-bajaj-api.onrender.com/'))).toBe(true);

  await connection.selectOption('local-docker');
  await expect(connection).toHaveValue('local-docker');
  await expect.poll(() => bootstrapRequests.some((url) => url.startsWith('http://127.0.0.1:8080/'))).toBe(true);

  // The choice is installation-local and survives restarting the desktop app.
  await page.reload();
  await expect(page.getByLabel('Server connection')).toHaveValue('local-docker');
  await expect.poll(() => bootstrapRequests.filter((url) => url.startsWith('http://127.0.0.1:8080/')).length).toBeGreaterThanOrEqual(2);

  await page.getByLabel('Server connection').selectOption('hosted');
  await expect.poll(() => bootstrapRequests.filter((url) => url.startsWith('https://lucky-bajaj-api.onrender.com/')).length).toBeGreaterThanOrEqual(2);
});
