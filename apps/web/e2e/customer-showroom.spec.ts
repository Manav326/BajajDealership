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

type ShowroomAuthJourney = {
  loginPayload: Record<string, unknown> | null;
  requestPayloads: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
};

async function mockShowroomApi(
  page: Page,
  promotions: unknown[] = [],
  options: { failFirstSalesRequest?: boolean; failFirstSalesRequestList?: boolean } = {},
): Promise<ShowroomAuthJourney> {
  const journey: ShowroomAuthJourney = { loginPayload: null, requestPayloads: [], requests: [] };
  let failFirstSalesRequest = Boolean(options.failFirstSalesRequest);
  let failFirstSalesRequestList = Boolean(options.failFirstSalesRequestList);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
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
    const customer = {
      publicId: 'customer-public-e2e-auth',
      customerCode: 'CUS-E2E-AUTH',
      fullName: 'Test Rider',
      phone: '9000000002',
      email: 'test-rider@example.test',
      preferredLanguage: 'en',
      dealershipCode: 'LBA',
      dealershipName: 'Lucky Bajaj Agency',
    };
    if (url.pathname === '/api/v1/customer/auth/login' && method === 'POST') {
      journey.loginPayload = request.postDataJSON() as Record<string, unknown>;
      return json({ accessToken: 'synthetic-auth-token', expiresAt: '2026-10-30T00:00:00Z', customer });
    }
    if (url.pathname === '/api/v1/customer/auth/me') return json(customer);
    if (url.pathname === '/api/v1/customer/vehicles'
      || url.pathname === '/api/v1/customer/service-history'
      || url.pathname === '/api/v1/customer/appointments') return json([]);
    if (url.pathname === '/api/v1/customer/notifications') {
      return json({ items: [], page: 0, pageSize: 50, total: 0, unreadCount: 0 });
    }
    if (url.pathname === '/api/v1/customer/sales-requests' && method === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      journey.requestPayloads.push(payload);
      if (failFirstSalesRequest) {
        failFirstSalesRequest = false;
        return json({ message: 'Synthetic temporary sales-request outage. Please retry.' }, 503);
      }
      const created = {
        publicId: 'sales-request-e2e-1',
        requestCode: 'SR-E2E-0001',
        requestType: payload.requestType,
        modelCode: payload.modelCode,
        modelName: payload.modelCode === 'BAJAJ_PULSAR_NS200' ? 'Pulsar NS200' : String(payload.modelCode),
        preferredAt: payload.preferredAt ?? null,
        notes: payload.notes ?? null,
        status: 'REQUESTED',
        createdAt: '2026-10-29T08:00:00Z',
        updatedAt: '2026-10-29T08:00:00Z',
        convertedEnquiryPublicId: null,
        customerPublicId: customer.publicId,
        customerCode: customer.customerCode,
        customerName: customer.fullName,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        enquiryCode: null, enquiryStatus: null,
        testRideCode: null, testRideStatus: null, testRideScheduledStart: null,
        bookingCode: null, bookingStatus: null,
        invoiceNumber: null, invoiceStatus: null, invoiceTotal: null,
        paidAmount: 0, creditedAmount: null, balanceDue: null, deliveredAt: null,
      } as Record<string, unknown>;
      journey.requests = [created];
      return json(created);
    }
    if (url.pathname === '/api/v1/customer/sales-requests' && method === 'GET') {
      if (failFirstSalesRequestList) {
        failFirstSalesRequestList = false;
        return json({ message: 'Synthetic temporary request-list outage. Please retry.' }, 503);
      }
      return json(journey.requests);
    }
    if (url.pathname === '/api/v1/customer/auth/logout' && method === 'POST') return json({ success: true });
    return json({});
  });
  return journey;
}

const retailPartFixture = {
  publicId: 'part-retail-e2e-1',
  skuCode: 'BRK-PAD-01',
  partName: 'Front brake pad',
  description: 'Genuine listed replacement part.',
  unitOfMeasure: 'EACH',
  retailPrice: 199,
  fitmentModelCodes: [],
  imageUrl: null,
  quantityAvailable: 4,
  available: true,
};

function deliveryOrderFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    publicId: 'retail-order-e2e-1',
    orderCode: 'RPO-E2E-001',
    status: 'PLACED',
    paymentMethod: 'PAY_ON_DELIVERY',
    paymentStatus: 'PAY_ON_DELIVERY',
    orderTotal: 249,
    fulfillmentMethod: 'DELIVERY',
    deliveryAddress: '12 Sample Road, Bettiah, Bihar 845438',
    deliveryFee: 50,
    deliveryQuoteStatus: 'AWAITING_CUSTOMER_CONFIRMATION',
    deliveryQuoteNote: 'Local delivery to the requested address',
    deliveryQuotedAt: '2026-10-29T07:00:00Z',
    customerNote: null,
    createdAt: '2026-10-29T06:45:00Z',
    updatedAt: '2026-10-29T07:00:00Z',
    cancelledAt: null,
    fulfilledAt: null,
    returnedAt: null,
    returnReason: null,
    restockedOnReturn: null,
    customerName: 'Manav Test Customer',
    customerCode: 'CUS-E2E-001',
    customerPhone: '9000000001',
    lines: [{
      partPublicId: retailPartFixture.publicId,
      skuCode: retailPartFixture.skuCode,
      partName: retailPartFixture.partName,
      unitOfMeasure: retailPartFixture.unitOfMeasure,
      quantity: 1,
      unitPrice: 199,
      lineTotal: 199,
    }],
    ...overrides,
  };
}

type CustomerRetailE2EState = {
  checkoutPayload: Record<string, unknown> | null;
  quoteAcceptance: boolean | null;
  cancellationRequested: boolean;
  currentOrder: Record<string, unknown> | null;
};

async function mockSignedInCustomerPortal(
  page: Page,
  initialOrder: Record<string, unknown> | null = null,
): Promise<CustomerRetailE2EState> {
  const state: CustomerRetailE2EState = {
    checkoutPayload: null,
    quoteAcceptance: null,
    cancellationRequested: false,
    currentOrder: initialOrder ? { ...initialOrder } : null,
  };
  await page.addInitScript(() => {
    window.sessionStorage.setItem('qe_customer_portal_token', 'synthetic-customer-token');
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (payload: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });

    if (path === '/api/v1/customer/auth/me') {
      return json({
        publicId: 'customer-public-e2e-1',
        customerCode: 'CUS-E2E-001',
        fullName: 'Manav Test Customer',
        phone: '9000000001',
        email: null,
        preferredLanguage: 'en',
        dealershipCode: 'LBA',
        dealershipName: 'Lucky Bajaj Agency',
      });
    }
    if (path === '/api/v1/customer/vehicles'
      || path === '/api/v1/customer/service-history'
      || path === '/api/v1/customer/appointments'
      || path === '/api/v1/customer/sales-requests') {
      return json([]);
    }
    if (path === '/api/v1/customer/notifications') {
      return json({ items: [], page: 0, pageSize: 50, total: 0, unreadCount: 0 });
    }
    if (path === '/api/v1/customer/parts' && method === 'GET') return json([retailPartFixture]);
    if (path === '/api/v1/customer/parts/orders' && method === 'GET') {
      return json(state.currentOrder ? [state.currentOrder] : []);
    }
    if (path === '/api/v1/customer/parts/orders' && method === 'POST') {
      state.checkoutPayload = request.postDataJSON() as Record<string, unknown>;
      const delivery = state.checkoutPayload.fulfillmentMethod === 'DELIVERY';
      state.currentOrder = deliveryOrderFixture({
        publicId: 'retail-order-e2e-created',
        orderCode: 'RPO-E2E-NEW',
        orderTotal: 199,
        fulfillmentMethod: delivery ? 'DELIVERY' : 'PICKUP',
        paymentMethod: delivery ? 'PAY_ON_DELIVERY' : 'PAY_AT_PICKUP',
        paymentStatus: delivery ? 'PAY_ON_DELIVERY' : 'PAY_ON_PICKUP',
        deliveryAddress: delivery ? state.checkoutPayload.deliveryAddress : null,
        deliveryFee: 0,
        deliveryQuoteStatus: delivery ? 'AWAITING_STAFF_QUOTE' : 'NOT_REQUIRED',
        deliveryQuoteNote: null,
        deliveryQuotedAt: null,
      });
      return json(state.currentOrder);
    }
    if (path.endsWith('/delivery-quote-response') && method === 'POST') {
      const body = request.postDataJSON() as { accept: boolean };
      state.quoteAcceptance = body.accept;
      state.currentOrder = deliveryOrderFixture({
        ...(state.currentOrder ?? {}),
        status: body.accept ? 'PLACED' : 'CANCELLED',
        deliveryQuoteStatus: body.accept ? 'ACCEPTED' : 'DECLINED',
        cancelledAt: body.accept ? null : new Date().toISOString(),
      });
      return json(state.currentOrder);
    }
    if (/\/api\/v1\/customer\/parts\/orders\/[^/]+\/cancel$/.test(path) && method === 'POST') {
      state.cancellationRequested = true;
      state.currentOrder = deliveryOrderFixture({
        ...(state.currentOrder ?? {}),
        status: 'CANCELLED',
        deliveryQuoteStatus: (state.currentOrder?.fulfillmentMethod === 'DELIVERY') ? 'CANCELLED' : 'NOT_REQUIRED',
        cancelledAt: new Date().toISOString(),
      });
      return json(state.currentOrder);
    }
    if (path === '/api/v1/customer/auth/logout' && method === 'POST') return json({ success: true });
    return json({});
  });
  return state;
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
    await expect(page.getByRole('link', { name: 'Open official Bajaj Auto website' })).toHaveAttribute('href', 'https://www.bajajauto.com/');
    await expect(page.locator('.showroom-bike-card').first().getByText('Out of stock', { exact: true })).toBeVisible();
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


test('signed-in customer can request delivery with an address without inventing a delivery fee', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const state = await mockSignedInCustomerPortal(page);
  await page.goto('http://127.0.0.1:4173');
  await expect(page.getByRole('heading', { name: 'Namaste, Manav.' })).toBeVisible();
  await page.getByRole('button', { name: /Spare parts/ }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByLabel('Fulfillment method').selectOption('DELIVERY');
  const address = '12 Sample Road, Bettiah, Bihar 845438';
  await page.getByPlaceholder('House / street, locality, city, state and PIN code').fill(address);
  await expect(page.getByText(/the order total currently shows parts only/i)).toBeVisible();
  await page.getByRole('button', { name: 'Request delivery quote' }).click();

  await expect(page.getByRole('status')).toContainText('Delivery request RPO-E2E-NEW saved.');
  await expect(page.getByText('Awaiting Lucky Bajaj delivery quote.', { exact: false })).toBeVisible();
  expect(state.checkoutPayload).toMatchObject({
    fulfillmentMethod: 'DELIVERY',
    deliveryAddress: address,
    fitmentModelCode: null,
  });
  expect(state.currentOrder).toMatchObject({
    fulfillmentMethod: 'DELIVERY',
    deliveryAddress: address,
    deliveryFee: 0,
    deliveryQuoteStatus: 'AWAITING_STAFF_QUOTE',
    orderTotal: 199,
    paymentStatus: 'PAY_ON_DELIVERY',
  });
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('customer explicitly accepts a quoted delivery fee before delivery can proceed', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const state = await mockSignedInCustomerPortal(page, deliveryOrderFixture());
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: /Spare parts/ }).click();
  await expect(page.getByText('Delivery fee: ₹50.00', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Accept delivery quote' }).click();

  await expect(page.getByRole('status')).toContainText('Delivery quote for RPO-E2E-001 accepted.');
  await expect(page.getByText('Delivery fee accepted: ₹50.00', { exact: false })).toBeVisible();
  await expect(page.getByText('Pay on delivery when it arrives', { exact: true })).toBeVisible();
  expect(state.quoteAcceptance).toBe(true);
  expect(state.currentOrder).toMatchObject({ status: 'PLACED', deliveryQuoteStatus: 'ACCEPTED' });
  await expect(page.getByRole('button', { name: 'Accept delivery quote' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('declining a delivery quote cancels the order and shows that stock was released', async ({ page }) => {
  const state = await mockSignedInCustomerPortal(page, deliveryOrderFixture());
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: /Spare parts/ }).click();
  await page.getByRole('button', { name: 'Decline and cancel order' }).click();

  await expect(page.getByRole('status')).toContainText('Delivery quote declined. Order RPO-E2E-001 was cancelled');
  await expect(page.getByText('Delivery request cancelled; stock reservation was released.', { exact: true })).toBeVisible();
  await expect(page.getByText('Order cancelled; reserved stock released', { exact: true })).toBeVisible();
  expect(state.quoteAcceptance).toBe(false);
  expect(state.currentOrder).toMatchObject({ status: 'CANCELLED', deliveryQuoteStatus: 'DECLINED' });
  await expect(page.getByRole('button', { name: 'Accept delivery quote' })).toHaveCount(0);
});

test('customer cancellation before a delivery quote marks the request cancelled and prevents stale quote prompts', async ({ page }) => {
  const state = await mockSignedInCustomerPortal(page, deliveryOrderFixture({
    deliveryFee: 0,
    deliveryQuoteStatus: 'AWAITING_STAFF_QUOTE',
    deliveryQuoteNote: null,
    deliveryQuotedAt: null,
    orderTotal: 199,
  }));
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: /Spare parts/ }).click();
  await page.getByRole('button', { name: 'Cancel and release stock' }).click();

  await expect(page.getByRole('status')).toContainText('Order RPO-E2E-001 was cancelled and its stock reservation released.');
  await expect(page.getByText('Delivery request cancelled; stock reservation was released.', { exact: true })).toBeVisible();
  expect(state.cancellationRequested).toBe(true);
  expect(state.currentOrder).toMatchObject({ status: 'CANCELLED', deliveryQuoteStatus: 'CANCELLED' });
  await expect(page.getByText('Awaiting Lucky Bajaj delivery quote.', { exact: false })).toHaveCount(0);
});


test('customer can cancel an accepted delivery request before fulfilment without stale quote actions', async ({ page }) => {
  const state = await mockSignedInCustomerPortal(page, deliveryOrderFixture());
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: /Spare parts/ }).click();
  await page.getByRole('button', { name: 'Accept delivery quote' }).click();

  await expect(page.getByText('Delivery fee accepted: ₹50.00', { exact: false })).toBeVisible();
  expect(state.currentOrder).toMatchObject({ status: 'PLACED', deliveryQuoteStatus: 'ACCEPTED' });
  await page.getByRole('button', { name: 'Cancel and release stock' }).click();

  await expect(page.getByRole('status')).toContainText('Order RPO-E2E-001 was cancelled and its stock reservation released.');
  await expect(page.getByText('Delivery request cancelled; stock reservation was released.', { exact: true })).toBeVisible();
  await expect(page.getByText('Order cancelled; reserved stock released', { exact: true })).toBeVisible();
  expect(state.cancellationRequested).toBe(true);
  expect(state.currentOrder).toMatchObject({ status: 'CANCELLED', deliveryQuoteStatus: 'CANCELLED' });
  await expect(page.getByRole('button', { name: 'Accept delivery quote' })).toHaveCount(0);
});


test('customer login resumes the selected showroom purchase as a saved sales request', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const journey = await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();
  await page.getByRole('button', { name: 'Enquire / purchase' }).click();
  await expect(page.locator('.portal-auth-screen')).toBeVisible();

  await page.getByRole('textbox', { name: 'Dealership code' }).fill('LBA');
  await page.getByRole('textbox', { name: 'Customer code' }).fill('CUS-E2E-AUTH');
  await page.getByLabel('Password').fill('Synthetic-Only-Password-123!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();

  await expect(page.getByRole('heading', { name: 'My Bajaj requests' })).toBeVisible();
  await expect(page.getByText('Purchase enquiry for Pulsar NS200 was sent to Lucky Bajaj.', { exact: false })).toBeVisible();
  await expect(page.getByText('SR-E2E-0001')).toBeVisible();
  expect(journey.loginPayload).toMatchObject({ dealershipCode: 'LBA', customerCode: 'CUS-E2E-AUTH' });
  expect(journey.requestPayloads).toHaveLength(1);
  expect(journey.requestPayloads[0]).toMatchObject({
    requestType: 'PURCHASE',
    modelCode: 'BAJAJ_PULSAR_NS200',
    preferredAt: null,
    notes: 'Request started from the public Bajaj showroom.',
  });
  expect(typeof journey.requestPayloads[0].idempotencyKey).toBe('string');
  expect(journey.requestPayloads[0].idempotencyKey).toHaveLength(36);
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('failed showroom handoff remains recoverable and retry reuses the original idempotency key', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const journey = await mockShowroomApi(page, [], { failFirstSalesRequest: true });
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();
  await page.getByRole('button', { name: 'Enquire / purchase' }).click();
  await page.getByRole('textbox', { name: 'Dealership code' }).fill('LBA');
  await page.getByRole('textbox', { name: 'Customer code' }).fill('CUS-E2E-AUTH');
  await page.getByLabel('Password').fill('Synthetic-Only-Password-123!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();

  const recovery = page.getByRole('region', { name: 'Saved showroom request not submitted' });
  await expect(recovery).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Synthetic temporary sales-request outage');
  await expect(recovery).toContainText('Retry with the same safe request key');
  await recovery.getByRole('button', { name: 'Retry saved request' }).click();

  await expect(page.getByText('SR-E2E-0001')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('purchase enquiry for Pulsar NS200 was sent');
  expect(journey.requestPayloads).toHaveLength(2);
  expect(journey.requestPayloads[0].idempotencyKey).toBe(journey.requestPayloads[1].idempotencyKey);
  await expect(page.getByRole('region', { name: 'Saved showroom request not submitted' })).toHaveCount(0);
});

test('a customer can discard a failed showroom selection and return to a clean request list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page, [], { failFirstSalesRequest: true });
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();
  await page.getByRole('button', { name: 'Enquire / purchase' }).click();
  await page.getByRole('textbox', { name: 'Dealership code' }).fill('LBA');
  await page.getByRole('textbox', { name: 'Customer code' }).fill('CUS-E2E-AUTH');
  await page.getByLabel('Password').fill('Synthetic-Only-Password-123!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();

  const recovery = page.getByRole('region', { name: 'Saved showroom request not submitted' });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Discard selection' }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Saved showroom selection cleared.');
  expect(await page.evaluate(() => window.sessionStorage.getItem('qe_bajaj_pending_intent'))).toBeNull();
});


test('customer login resumes a test-ride request with its preferred local date and time', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const journey = await mockShowroomApi(page);
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

  await page.getByRole('textbox', { name: 'Dealership code' }).fill('LBA');
  await page.getByRole('textbox', { name: 'Customer code' }).fill('CUS-E2E-AUTH');
  await page.getByLabel('Password').fill('Synthetic-Only-Password-123!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();

  await expect(page.getByRole('heading', { name: 'My Bajaj requests' })).toBeVisible();
  await expect(page.getByText('Test-ride request', { exact: false }).first()).toBeVisible();
  expect(journey.requestPayloads).toHaveLength(1);
  expect(journey.requestPayloads[0]).toMatchObject({
    requestType: 'TEST_RIDE',
    modelCode: 'BAJAJ_PULSAR_NS200',
    preferredAt: expectedPreferredAt,
  });
});


test('successful sales-request POST with failed confirmation GET remains safely retryable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const journey = await mockShowroomApi(page, [], { failFirstSalesRequestList: true });
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();
  await page.getByRole('button', { name: 'Enquire / purchase' }).click();
  await page.getByRole('textbox', { name: 'Dealership code' }).fill('LBA');
  await page.getByRole('textbox', { name: 'Customer code' }).fill('CUS-E2E-AUTH');
  await page.getByLabel('Password').fill('Synthetic-Only-Password-123!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();

  const recovery = page.getByRole('region', { name: 'Saved showroom request not submitted' });
  await expect(recovery).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Synthetic temporary request-list outage');
  expect(journey.requests).toHaveLength(1);
  const firstKey = journey.requestPayloads[0].idempotencyKey;

  await recovery.getByRole('button', { name: 'Retry saved request' }).click();
  await expect(page.getByText('SR-E2E-0001')).toBeVisible();
  expect(journey.requests).toHaveLength(1);
  expect(journey.requestPayloads).toHaveLength(2);
  expect(journey.requestPayloads[1].idempotencyKey).toBe(firstKey);
  expect(await page.evaluate(() => window.sessionStorage.getItem('qe_bajaj_pending_intent'))).toBeNull();
  await expect(page.getByRole('region', { name: 'Saved showroom request not submitted' })).toHaveCount(0);
});


test('Asia/Kolkata test-ride preference round-trips the same instant and local display', async ({ browser }) => {
  const context = await browser.newContext({
    timezoneId: 'Asia/Kolkata',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const journey = await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.showroom-bike-card').getByRole('button', { name: 'View Pulsar NS200 details' }).click();

  const preferredLocalTime = await page.evaluate(() => {
    const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    date.setSeconds(0, 0);
    const pad = (value: number) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  });
  await page.locator('.showroom-preferred-time input').fill(preferredLocalTime);
  const expectedInstant = await page.locator('.showroom-preferred-time input').evaluate((element) =>
    new Date((element as HTMLInputElement).value).toISOString());
  const expectedLocalLabel = await page.evaluate((instant) =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant)),
    expectedInstant);

  await page.getByRole('button', { name: /Request test ride/ }).click();
  await page.getByRole('textbox', { name: 'Dealership code' }).fill('LBA');
  await page.getByRole('textbox', { name: 'Customer code' }).fill('CUS-E2E-AUTH');
  await page.getByLabel('Password').fill('Synthetic-Only-Password-123!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();

  await expect(page.getByRole('heading', { name: 'My Bajaj requests' })).toBeVisible();
  expect(journey.requestPayloads).toHaveLength(1);
  expect(journey.requestPayloads[0]).toMatchObject({
    requestType: 'TEST_RIDE',
    modelCode: 'BAJAJ_PULSAR_NS200',
    preferredAt: expectedInstant,
  });
  await expect(page.getByText('Preferred time: ' + expectedLocalLabel, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await context.close();
});


test('showroom header stays fixed while the public page scrolls and anchor targets clear it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');

  const header = page.locator('.showroom-nav');
  await expect(header).toBeVisible();
  await expect.poll(() => header.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(0);

  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 950);
  });
  await expect.poll(() => header.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(0);

  await page.getByRole('link', { name: 'Motorcycles' }).click();
  await expect.poll(() => page.locator('#collection').evaluate((element) =>
    Math.round(element.getBoundingClientRect().top))).toBeGreaterThanOrEqual(80);
  await expect.poll(() => page.locator('#collection').evaluate((element) =>
    Math.round(element.getBoundingClientRect().top))).toBeLessThan(130);
});

test('customer auth has stable URLs, returns to the showroom, and exposes policy and QuantaEdge footer links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShowroomApi(page);
  await page.goto('http://127.0.0.1:4173');

  await page.getByRole('button', { name: 'My account' }).click();
  await expect(page).toHaveURL(/\/\?view=signin$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByRole('button', { name: /Showroom/ }).first().click();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  await expect(page.locator('.bajaj-showroom')).toBeVisible();

  await page.goto('http://127.0.0.1:4173/?view=signup');
  await expect(page).toHaveURL(/\/\?view=signup$/);
  await expect(page.getByRole('tab', { name: 'Activate account' })).toHaveAttribute('aria-selected', 'true');

  const quantaEdgeLogo = page.getByRole('img', { name: 'QuantaEdge — Smarter Decisions. Greater Growth.' });
  await quantaEdgeLogo.scrollIntoViewIfNeeded();
  await expect(quantaEdgeLogo).toBeVisible();
  await expect(page.getByRole('button', { name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terms & conditions' })).toBeVisible();

  await page.getByRole('button', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/\?view=privacy$/);
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Terms & conditions' }).click();
  await expect(page).toHaveURL(/\/\?view=terms$/);
  await expect(page.getByRole('heading', { name: 'Terms & conditions', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '← Back to showroom' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  await expect(page.locator('.bajaj-showroom')).toBeVisible();

  await page.getByRole('button', { name: 'Privacy policy' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/\?view=privacy$/);
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
});
