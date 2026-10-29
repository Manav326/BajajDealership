import { expect, test, type Page } from '@playwright/test';

const requestPublicId = 'website-request-e2e-001';
const enquiryPublicId = 'sales-enquiry-e2e-001';
const modelPublicId = 'model-e2e-001';
const vehiclePublicId = 'vehicle-unit-e2e-001';

function pageOf<T>(items: T[]) {
  return { items, page: 0, pageSize: 100, total: items.length };
}

const customer = {
  publicId: 'customer-e2e-001',
  customerCode: 'CUS-E2E-001',
  fullName: 'Test Rider',
  phone: '9000000002',
  email: 'test-rider@example.test',
  alternatePhone: '9000000003',
  preferredLanguage: 'en',
  status: 'ACTIVE',
  createdAt: '2026-07-01T10:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
};

const model = {
  publicId: modelPublicId,
  modelCode: 'BAJAJ_PULSAR_NS200',
  modelName: 'Pulsar NS200',
  variantName: null,
  colourName: null,
  active: true,
  availableCount: 1,
};

const unit = {
  publicId: vehiclePublicId,
  modelPublicId,
  modelCode: model.modelCode,
  modelName: model.modelName,
  variantName: null,
  colourName: null,
  chassisNumber: 'MD2A-E2E-CHASSIS',
  engineNumber: 'EN-E2E-ENGINE',
  stockStatus: 'AVAILABLE',
};

const customerRequest = {
  publicId: requestPublicId,
  requestCode: 'SR-E2E-001',
  requestType: 'PURCHASE',
  modelCode: model.modelCode,
  modelName: model.modelName,
  preferredAt: null,
  notes: 'Started from the public showroom.',
  status: 'REQUESTED',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  convertedEnquiryPublicId: null,
  customerPublicId: customer.publicId,
  customerCode: customer.customerCode,
  customerName: customer.fullName,
  customerPhone: customer.phone,
  customerEmail: customer.email,
  enquiryCode: null,
  enquiryStatus: null,
  testRideCode: null,
  testRideStatus: null,
  testRideScheduledStart: null,
  bookingCode: null,
  bookingStatus: null,
  invoiceNumber: null,
  invoiceStatus: null,
  invoiceTotal: null,
  paidAmount: 0,
  creditedAmount: 0,
  balanceDue: null,
  deliveredAt: null,
};

const enquiry = {
  publicId: enquiryPublicId,
  enquiryCode: 'ENQ-E2E-001',
  customerPublicId: customer.publicId,
  customerCode: customer.customerCode,
  customerName: customer.fullName,
  customerPhone: customer.phone,
  customerEmail: customer.email,
  interestedModelPublicId: modelPublicId,
  modelCode: model.modelCode,
  modelName: model.modelName,
  variantName: null,
  colourName: null,
  assignedStaffPublicId: null,
  assignedStaffName: null,
  status: 'NEW',
  leadSource: 'WEBSITE',
  contactPreference: 'CALL',
  nextFollowUpAt: null,
  lastContactedAt: null,
  notes: 'Started from the public showroom.',
  createdAt: '2026-10-29T08:05:00Z',
  updatedAt: '2026-10-29T08:05:00Z',
};

type SalesJourneyState = {
  conversionCalls: number;
  conversionPaths: string[];
  request: typeof customerRequest;
  enquiry: typeof enquiry | null;
  testRideWrites: number;
  bookingWrites: number;
};

async function mockSalesJourney(page: Page): Promise<SalesJourneyState> {
  const state: SalesJourneyState = {
    conversionCalls: 0,
    conversionPaths: [],
    request: { ...customerRequest },
    enquiry: null,
    testRideWrites: 0,
    bookingWrites: 0,
  };

  await page.addInitScript(() => {
    window.sessionStorage.setItem('qe_staff_token', 'synthetic-staff-session');
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

    if (path === '/api/v1/auth/staff/me') {
      return json({
        staffPublicId: 'staff-e2e-001',
        fullName: 'Test Staff',
        dealershipPublicId: 'dealership-e2e-001',
        dealershipCode: 'LBA',
        roles: ['SALES_MANAGER'],
        permissions: ['sales.read', 'sales.manage', 'customer.read', 'vehicle.read'],
      });
    }
    if (path === '/api/v1/system/health') {
      return json({ status: 'UP', service: 'bajaj-api', version: 'e2e', timestamp: '2026-10-29T08:00:00Z' });
    }
    if (path === '/api/v1/system/bootstrap/status') return json({ available: false });
    if (path === '/api/v1/admin/customers') return json(pageOf([customer]));
    if (path === `/api/v1/admin/customers/${customer.publicId}` && method === 'GET') return json(customer);
    if (path === `/api/v1/admin/customers/${customer.publicId}/saved-addresses` && method === 'GET') {
      return json([{
        publicId: 'address-history-e2e-001', label: 'HOME', recipientName: 'Test Rider', phone: customer.phone,
        addressLine1: '12 Historic Road', addressLine2: 'Floor 2', landmark: 'Near post office',
        locality: 'Station Road', city: 'Bettiah', district: 'West Champaran', state: 'Bihar',
        postalCode: '845438', country: 'India', isDefaultDelivery: true,
        createdAt: '2026-06-01T08:00:00Z', updatedAt: '2026-09-01T08:00:00Z',
      }]);
    }
    if (path === `/api/v1/admin/customers/${customer.publicId}/profile-photo`) {
      return route.fulfill({ status: 404, body: 'No profile photo' });
    }
    if (path === `/api/v1/admin/customers/${customer.publicId}/history` && method === 'GET') {
      return json({
        customer,
        notes: 'Prefers a short phone call before delivery.',
        marketingConsentAt: null,
        marketingConsentSource: null,
        motorcyclePurchases: [{
          publicId: 'handover-history-e2e-001', invoiceNumber: 'SALE-E2E-001',
          modelName: 'Pulsar NS200', variantName: 'Standard', colourName: 'Black', modelYear: 2026,
          invoiceTotal: 145000, paidAmount: 145000, creditedAmount: 0, balanceDue: 0,
          invoiceIssuedAt: '2026-09-15T10:00:00Z', deliveredAt: '2026-09-16T10:00:00Z', deliveredToName: 'Test Rider',
        }],
        sparePartOrders: [{
          publicId: 'parts-history-e2e-001', orderCode: 'RPO-E2E-001', status: 'RETURNED',
          paymentMethod: 'PAY_ON_DELIVERY', paymentStatus: 'REFUND_REVIEW_REQUIRED', orderTotal: 249,
          fulfillmentMethod: 'DELIVERY', deliveryAddress: '12 Historic Road, Bettiah, Bihar 845438',
          deliveryFee: 50, deliveryQuoteStatus: 'ACCEPTED', deliveryQuoteNote: 'Local delivery',
          deliveryQuotedAt: '2026-09-20T10:00:00Z', customerNote: 'Call on arrival',
          createdAt: '2026-09-19T10:00:00Z', updatedAt: '2026-09-22T10:00:00Z',
          cancelledAt: null, fulfilledAt: '2026-09-21T10:00:00Z', returnedAt: '2026-09-22T10:00:00Z',
          returnReason: 'Wrong size supplied', restockedOnReturn: false, customerName: customer.fullName,
          customerCode: customer.customerCode, customerPhone: customer.phone,
          lines: [{ partPublicId: 'part-history-e2e-001', skuCode: 'BGP-0001', partName: 'Front brake pad',
            unitOfMeasure: 'EACH', quantity: 1, unitPrice: 199, lineTotal: 199 }],
        }],
        websiteRequests: [{
          ...customerRequest,
          convertedEnquiryPublicId: enquiryPublicId, status: 'CONVERTED',
          enquiryCode: 'ENQ-E2E-001', enquiryStatus: 'BOOKED', testRideCode: 'TR-E2E-001',
          testRideStatus: 'COMPLETED', testRideScheduledStart: '2026-08-20T08:00:00Z',
          bookingCode: 'BK-E2E-001', bookingStatus: 'CONVERTED_TO_SALE',
          invoiceNumber: 'SALE-E2E-001', invoiceStatus: 'ISSUED', invoiceTotal: 145000,
          paidAmount: 145000, creditedAmount: 0, balanceDue: 0, deliveredAt: '2026-09-16T10:00:00Z',
        }],
      });
    }
    if (path === '/api/v1/admin/vehicle-models') return json(pageOf([model]));
    if (path === '/api/v1/admin/vehicle-units') return json(pageOf([unit]));
    if (path === '/api/v1/admin/sales/enquiries') {
      return json(pageOf(state.enquiry ? [state.enquiry] : []));
    }
    if (path === '/api/v1/admin/sales/bookings') return json(pageOf([]));
    if (path === '/api/v1/admin/sales/customer-requests' && method === 'GET') {
      return json([state.request]);
    }
    if (path === `/api/v1/admin/sales/customer-requests/${requestPublicId}/convert` && method === 'POST') {
      state.conversionCalls += 1;
      state.conversionPaths.push(path);
      state.request = {
        ...state.request,
        status: 'CONVERTED',
        convertedEnquiryPublicId: enquiryPublicId,
        enquiryCode: enquiry.enquiryCode,
        enquiryStatus: enquiry.status,
      };
      state.enquiry = { ...enquiry };
      return json(state.request);
    }
    if (path === `/api/v1/admin/sales/enquiries/${enquiryPublicId}` && method === 'GET') {
      return json({
        enquiry: state.enquiry ?? enquiry,
        activities: [{
          publicId: 'activity-e2e-001',
          activityType: 'ENQUIRY_CREATED',
          fromStatus: null,
          toStatus: 'NEW',
          note: 'Converted from website request.',
          followUpAt: null,
          referenceType: null,
          referenceId: null,
          actorName: 'Test Staff',
          createdAt: '2026-10-29T08:05:00Z',
        }],
        testRides: [],
        bookings: [],
      });
    }
    if (path.endsWith('/test-rides') && method === 'POST') {
      state.testRideWrites += 1;
      return json({});
    }
    if (path.endsWith('/bookings') && method === 'POST') {
      state.bookingWrites += 1;
      return json({});
    }
    if (path === '/api/v1/admin/notifications/inbox') return json({ unreadCount: 0 });
    return json({});
  });

  return state;
}

test('staff can convert a showroom request to an enquiry without creating a booking or confirming a test ride', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  const state = await mockSalesJourney(page);
  await page.goto('/');

  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: /Sales pipeline/ }).click();
  await expect(page.getByRole('heading', { name: 'Sales pipeline', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Website requests/ }).click();

  await expect(page.getByRole('heading', { name: 'Customer website requests' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'SR-E2E-001' });
  await expect(row).toContainText('Test Rider');
  await expect(row).toContainText('Pulsar NS200');
  await expect(row).toContainText('Requested');
  await row.getByRole('button', { name: 'Convert to enquiry' }).click();

  await expect(page.getByText('ENQUIRY DETAIL', { exact: true })).toBeVisible();
  await expect(page.locator('.sales-detail-heading').getByRole('heading', { name: 'Test Rider' })).toBeVisible();
  await expect(page.locator('.sales-detail-heading')).toContainText('ENQ-E2E-001');
  await expect(page.getByRole('heading', { name: 'Schedule a test ride' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reserve a bike' })).toBeVisible();

  expect(state.conversionCalls).toBe(1);
  expect(state.conversionPaths).toEqual([`/api/v1/admin/sales/customer-requests/${requestPublicId}/convert`]);
  expect(state.request.status).toBe('CONVERTED');
  expect(state.request.convertedEnquiryPublicId).toBe(enquiryPublicId);
  expect(state.testRideWrites).toBe(0);
  expect(state.bookingWrites).toBe(0);
  await expect(page.getByText('Not booked', { exact: true })).toHaveCount(0);
});


test('staff customer profile displays complete motorcycle, parts-return and website-request history', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await mockSalesJourney(page);
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View profile for Test Rider' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Customer profile', exact: true })).toBeVisible();
  await expect(dialog).toContainText('12 Historic Road');
  await expect(dialog.getByRole('heading', { name: 'Motorcycles purchased' })).toBeVisible();
  await expect(dialog).toContainText('SALE-E2E-001');
  await expect(dialog.getByRole('heading', { name: 'Spare-parts orders & returns' })).toBeVisible();
  await expect(dialog).toContainText('RPO-E2E-001');
  await expect(dialog).toContainText('Wrong size supplied');
  await expect(dialog.getByRole('heading', { name: 'Bike enquiries & test rides' })).toBeVisible();
  await expect(dialog).toContainText('ENQ-E2E-001');
  await expect(dialog).toContainText('TR-E2E-001');
  await expect(dialog).toContainText('BK-E2E-001');
  await expect(dialog.getByRole('heading', { name: 'Customer notes & consent' })).toBeVisible();
  await expect(dialog).toContainText('Prefers a short phone call before delivery.');
  await dialog.getByRole('button', { name: 'Close customer profile' }).click();
  await expect(dialog).toHaveCount(0);
});
