import { expect, test } from '@playwright/test';

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
  braking: 'Dual-channel ABS',
  frontSuspension: 'USD front forks',
  rearSuspension: 'Nitrox mono-shock',
  fuelTankLitres: 12,
  groundClearanceMm: 168,
  kerbWeightKg: 158,
  rideCharacter: 'Performance street riding',
  highlights: ['Liquid-cooled engine', '6-speed gearbox'],
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
  availabilityStatus: 'OUT_OF_STOCK',
  expectedAvailableOn: null,
};

async function stubPublicCatalogue(page) {
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (payload, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
    if (pathname.endsWith('/public/catalogue/bikes')) {
      return json({
        manufacturer: 'BAJAJ',
        dealershipCode: 'LBA',
        dealershipName: 'Lucky Bajaj Agency',
        priceReferenceCity: 'New Delhi',
        servedAt: '2026-10-29T00:00:00Z',
        bikes: [bike],
      });
    }
    if (pathname.endsWith('/public/catalogue/promotions')) return json({ promotions: [] });
    if (pathname.endsWith('/public/catalogue/quotes')) {
      return json({ detail: 'No dealer quote is configured.' }, 404);
    }
    return json({});
  });
}

test('public showroom has named navigation and a keyboard-operable model dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubPublicCatalogue(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /Make every ride a statement/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Showroom navigation' })).toBeVisible();

  const detailsButton = page.getByRole('button', { name: 'View Pulsar NS200 details' });
  await detailsButton.click();
  const dialog = page.getByRole('dialog', { name: 'Pulsar NS200' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close bike details' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(detailsButton).toBeFocused();
});

test('mobile showroom navigation exposes and closes its menu accessibly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubPublicCatalogue(page);
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  const navigation = page.getByRole('navigation', { name: 'Showroom navigation' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation.getByRole('link', { name: 'Motorcycles' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Motorcycles' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
