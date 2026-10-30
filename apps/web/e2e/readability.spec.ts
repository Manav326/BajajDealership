import { expect, test } from '@playwright/test';

const isLatinInterFont = (response: { url(): string }) =>
  new URL(response.url()).pathname.endsWith('/fonts/inter-latin-wght-normal.woff2');

test('staff sign-in uses the bundled Inter font and readable glass surfaces', async ({ page }) => {
  const fontResponse = page.waitForResponse(isLatinInterFont);

  await page.goto('/');
  await expect(page.locator('.auth-card')).toBeVisible();

  const response = await fontResponse;
  expect(response.ok()).toBe(true);

  const typography = await page.evaluate(async () => {
    const loadedFaces = await document.fonts.load('500 14px Inter');
    const intro = document.querySelector<HTMLElement>('.auth-intro')!;
    const card = document.querySelector<HTMLElement>('.auth-card')!;
    const introStyle = getComputedStyle(intro);
    const cardStyle = getComputedStyle(card);
    return {
      interLoaded: loadedFaces.some((face) => face.status === 'loaded'),
      fontFamily: getComputedStyle(document.body).fontFamily,
      introColor: introStyle.color,
      introSize: introStyle.fontSize,
      introWeight: introStyle.fontWeight,
      cardBackground: cardStyle.backgroundImage,
      cardBlur: cardStyle.backdropFilter,
    };
  });

  expect(typography.interLoaded).toBe(true);
  expect(typography.fontFamily).toContain('Inter');
  expect(typography.introColor).toBe('rgb(68, 85, 111)');
  expect(typography.introSize).toBe('14px');
  expect(typography.introWeight).toBe('500');
  expect(typography.cardBackground).toContain('0.97');
  expect(typography.cardBlur).toContain('blur(14px)');
});

test('staff dashboard card highlights sit behind readable content', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    document.documentElement.classList.add('tauri-desktop');
    window.sessionStorage.setItem('qe_staff_token', 'readability-e2e-session');
  });

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path.endsWith('/auth/staff/me')
      ? {
          staffPublicId: 'READABILITY-E2E-STAFF',
          fullName: 'Readability Test',
          dealershipPublicId: 'READABILITY-E2E-DEALERSHIP',
          dealershipCode: 'LBA',
          roles: ['OWNER'],
          permissions: [],
        }
      : path.endsWith('/system/health')
        ? { status: 'UP', service: 'bajaj-api', version: 'e2e', timestamp: '2026-10-30T00:00:00Z' }
        : path.endsWith('/system/license/status')
          ? { state: 'ACTIVE', daysUntilExpiry: 30 }
          : {};

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.goto('/');
  const card = page.locator('.metric-card').first();
  await expect(card).toBeVisible();

  const surface = await card.evaluate((element) => ({
    isolation: getComputedStyle(element).isolation,
    highlightZIndex: getComputedStyle(element, '::before').zIndex,
    valueColor: getComputedStyle(element.querySelector('.metric-value')!).color,
    noteColor: getComputedStyle(element.querySelector('.metric-note')!).color,
  }));

  expect(surface.isolation).toBe('isolate');
  expect(surface.highlightZIndex).toBe('-1');
  expect(surface.valueColor).toBe('rgb(23, 36, 59)');
  expect(surface.noteColor).toBe('rgb(88, 105, 129)');
});

test('customer website loads its own bundled Inter font', async ({ page }) => {
  const fontResponse = page.waitForResponse(isLatinInterFont);

  await page.goto('http://127.0.0.1:4173/');
  const response = await fontResponse;
  expect(response.ok()).toBe(true);

  const loaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('500 14px Inter');
    return faces.some((face) => face.status === 'loaded');
  });
  expect(loaded).toBe(true);
});
