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
        bikes: [bike],
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

    await page.locator('.showroom-bike-card').getByRole('button', { name: 'Explore specs' }).click();
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

test('selecting a bike preserves the requested test ride intent through sign-in handoff', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'Explore specs' }).click();
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
    preferredAt: null,
  });
  expect(typeof intent.idempotencyKey).toBe('string');
  expect(intent.idempotencyKey.length).toBeGreaterThan(8);
});
