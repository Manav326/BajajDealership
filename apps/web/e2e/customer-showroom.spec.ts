import { expect, test, type Page } from '@playwright/test';

const bike = {
  manufacturer: 'BAJAJ',
  modelCode: 'BAJAJ_PULSAR_NS200',
  modelName: 'Pulsar NS200',
  family: 'Pulsar NS',
  category: 'SPORT',
  engineCc: 199.5,
  maxPower: '24.5 PS',
  maxTorque: '18.74 Nm',
  gearbox: '6-speed',
  braking: 'Dual-channel ABS; front and rear disc brakes',
  frontSuspension: '37 mm USD front forks',
  rearSuspension: 'Nitrox mono-shock rear suspension',
  fuelTankLitres: 12,
  groundClearanceMm: 168,
  kerbWeightKg: 158,
  rideCharacter: 'Performance street riding',
  highlights: ['199.5 cc liquid-cooled engine', '6-speed gearbox', 'Dual-channel ABS'],
  heroImageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"%3E%3Crect width="16" height="9" fill="%23223344"/%3E%3C/svg%3E',
  officialModelUrl: 'https://www.bajajauto.com/bikes/pulsar/pulsar-ns200',
  officialSpecsUrl: 'https://www.bajajauto.com/bikes/pulsar/pulsar-ns200/specifications',
  exShowroomPrice: 138302,
  priceCity: 'New Delhi',
  priceSourceUrl: 'https://www.bajajauto.com/bikes',
  priceVerifiedAt: '2026-10-29',
  inventoryModelPublicId: null,
  availableUnits: 0,
  expectedUnits: 0,
  reservedUnits: 0,
  availabilityStatus: 'OUT_OF_STOCK' as const,
  expectedAvailableOn: null,
};

async function mockShowroomApi(page: Page, promotions: unknown[] = []) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (payload: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });

    if (url.pathname.endsWith('/public/catalogue/bikes')) {
      return json({
        manufacturer: 'BAJAJ',
        dealershipCode: 'LBA',
        dealershipName: 'Lucky Bajaj Agency',
        priceReferenceCity: 'New Delhi',
        servedAt: '2026-10-29T00:00:00Z',
        bikes: [bike, ...Array.from({ length: 19 }, (_, index) => ({
          ...bike,
          modelCode: `BAJAJ_TEST_MODEL_${String(index + 1).padStart(2, '0')}`,
          modelName: `Fixture Bajaj Model ${String(index + 1).padStart(2, '0')}`,
          family: 'Fixture Bajaj Range',
        }))],
      });
    }
    if (url.pathname.endsWith('/public/catalogue/promotions')) {
      return json({ promotions });
    }
    if (url.pathname.endsWith('/public/catalogue/quotes')) {
      return json({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'No current, sourced on-road estimate is configured for this Bajaj model and location. Please request a dealer quote.',
      }, 404);
    }
    return json({});
  });
}


test('public catalogue renders at least 20 Bajaj model cards and searches the returned catalogue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');

  const cards = page.locator('.showroom-bike-card');
  await expect(cards).toHaveCount(20);
  const brandLabels = await page.locator('.showroom-card-brand').allTextContents();
  expect(brandLabels).toHaveLength(20);
  expect(brandLabels.every((label) => label.trim().startsWith('BAJAJ'))).toBeTruthy();

  await page.getByRole('textbox', { name: 'Search Bajaj models' }).fill('Fixture Bajaj Model 07');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole('heading', { name: 'Fixture Bajaj Model 07', exact: true })).toBeVisible();
});

test('showroom honors reduced-motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');
  await expect(page.locator('.showroom-bike-card').first()).toBeVisible();

  const duration = await page.locator('.showroom-bike-card').first().evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).animationDuration));
  expect(duration).toBeLessThan(0.001);
});

test('public showroom remains responsive and truthful when no dealer offer or regional quote is configured', async ({ page }) => {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await mockShowroomApi(page);
    await page.goto('http://127.0.0.1:4173');
    await expect(page.getByRole('heading', { name: 'Pulsar NS200', exact: true })).toBeVisible();
    await expect(page.getByText('No public offers are currently published.', { exact: false })).toBeVisible();
    await expect(page.getByText('Out of stock', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Reference price checked')).toBeVisible();
    await page.getByRole('textbox', { name: 'City and state for on-road estimate' }).fill('Bettiah, Bihar');
    await page.getByRole('button', { name: 'Check configured estimate' }).click();
    await expect(page.getByRole('alert')).toContainText('No current, sourced on-road estimate is configured');
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/customer-showroom-' + width + 'px.png', fullPage: false });
    await page.context().clearCookies();
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto('about:blank');
  }
});

test('public promotions expose source and terms without claiming an automatic discount', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page, [{
    publicId: 'promotion-e2e-1',
    modelCode: 'BAJAJ_PULSAR_NS200',
    modelName: 'Pulsar NS200',
    title: 'Verified accessory offer',
    summary: 'Ask Lucky Bajaj whether eligible accessory benefits apply to this model.',
    terms: 'Valid only for eligible customers. Availability and final terms require dealer confirmation.',
    startsOn: '2026-10-01',
    endsOn: '2026-11-30',
    sourceUrl: 'https://www.bajajauto.com/bike-offer',
    published: true,
    disclaimer: 'Dealer-authored information only. Verify current availability and final terms with Lucky Bajaj.',
  }]);
  await page.goto('http://127.0.0.1:4173');
  const card = page.locator('.showroom-offer-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Verified accessory offer' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Review source ↗' })).toHaveAttribute('href', 'https://www.bajajauto.com/bike-offer');
  await card.getByText('Terms and exclusions').click();
  await expect(card.getByText('Valid only for eligible customers.', { exact: false })).toBeVisible();
  await expect(card.getByText('This announcement does not change catalogue prices automatically.', { exact: false })).toHaveCount(0);
  await expect(card.getByText('Dealer-authored information only.', { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('selecting a bike preserves the preferred test ride time through sign-in handoff', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();

  const preferredTime = await page.evaluate(() => {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
    date.setSeconds(0, 0);
    const pad = (value: number) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  });
  await page.locator('.showroom-preferred-time input').fill(preferredTime);
  const expectedPreferredAt = await page.locator('.showroom-preferred-time input').evaluate((element) =>
    new Date((element as HTMLInputElement).value).toISOString());
  await page.getByRole('button', { name: /Request test ride/ }).click();
  await expect(page.locator('.portal-auth-screen')).toBeVisible();

  const intent = await page.evaluate(() => {
    const raw = window.sessionStorage.getItem('qe_bajaj_pending_intent');
    return raw ? JSON.parse(raw) : null;
  });
  expect(intent).toMatchObject({
    action: 'TEST_RIDE',
    modelCode: 'BAJAJ_PULSAR_NS200',
    modelName: 'Pulsar NS200',
    preferredAt: expectedPreferredAt,
  });
  expect(typeof intent.idempotencyKey).toBe('string');
  expect(intent.idempotencyKey.length).toBeGreaterThan(8);
});

test('purchase intent is preserved through the sign-in handoff', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();
  await page.getByRole('button', { name: 'Enquire / purchase' }).click();
  await expect(page.locator('.portal-auth-screen')).toBeVisible();

  const intent = await page.evaluate(() => {
    const raw = window.sessionStorage.getItem('qe_bajaj_pending_intent');
    return raw ? JSON.parse(raw) : null;
  });
  expect(intent).toMatchObject({
    action: 'PURCHASE',
    modelCode: 'BAJAJ_PULSAR_NS200',
    modelName: 'Pulsar NS200',
    preferredAt: null,
  });
  expect(typeof intent.idempotencyKey).toBe('string');
});


test('bike details dialog supports Escape and restores keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');
  const trigger = page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' });
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const closeButton = dialog.getByRole('button', { name: 'Close bike details' });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
