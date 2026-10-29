import { expect, test, type Page } from '@playwright/test';

type Recipient = {
  recipientId: number;
  recipientKind: 'CUSTOMER' | 'STAFF';
  publicId: string;
  recipientName: string;
  classCode: string | null;
  institutionId: number;
  institutionName: string;
  institutionCode: string;
};

const customers: Recipient[] = [
  {
    recipientId: 11,
    recipientKind: 'CUSTOMER',
    publicId: 'CUST00011',
    recipientName: 'Aarav Customer',
    classCode: null,
    institutionId: 1,
    institutionName: 'Lucky Bajaj Agency',
    institutionCode: 'LBA',
  },
  {
    recipientId: 12,
    recipientKind: 'CUSTOMER',
    publicId: 'CUST00012',
    recipientName: 'Beena Customer',
    classCode: null,
    institutionId: 1,
    institutionName: 'Lucky Bajaj Agency',
    institutionCode: 'LBA',
  },
];

const staffRecipients: Recipient[] = [
  {
    recipientId: 21,
    recipientKind: 'STAFF',
    publicId: 'STAFF00021',
    recipientName: 'Staff Member',
    classCode: null,
    institutionId: 1,
    institutionName: 'Lucky Bajaj Agency',
    institutionCode: 'LBA',
  },
];

const campaignId = 'camp-e2e-0001';
const previewExpiry = '2035-01-01T00:00:00Z';

function campaign(status: string) {
  return {
    id: 1,
    publicId: campaignId,
    scope: 'CUSTOMER',
    title: 'A helpful update from Lucky Bajaj',
    summary: 'An update from your dealership',
    status,
    resolvedRecipientCount: 2,
    scheduledAt: status === 'SCHEDULED' ? new Date(Date.now() - 60_000).toISOString() : null,
    expiresAt: previewExpiry,
    createdAt: '2026-01-01T00:00:00Z',
    dispatchedAt: null,
    cancelledAt: null,
    dispatchAttemptCount: status === 'SCHEDULED' ? 1 : 0,
    lastDispatchAttemptAt: status === 'SCHEDULED' ? new Date(Date.now() - 60_000).toISOString() : null,
    nextDispatchAttemptAt: status === 'SCHEDULED' ? new Date(Date.now() - 60_000).toISOString() : null,
    lastDispatchError: status === 'SCHEDULED' ? 'Dispatch error: ResponseStatusException' : null,
  };
}

function preview() {
  return {
    valid: true,
    campaignPublicId: campaignId,
    previewToken: 'e2e-preview-token',
    expiresAt: previewExpiry,
    recipientCount: 2,
    recipientCounts: { CUSTOMER: 2 },
    recipients: customers,
    message: 'The audience is eligible for this preview.',
  };
}

async function mockApi(page: Page, extraPermissions: string[] = []) {
  let galleryImages: Array<{
    publicId: string; modelCode: string; contentType: string; sizeBytes: number;
    primary: boolean; uploadedAt: string;
  }> = [];
  await page.addInitScript(() => {
    window.sessionStorage.setItem('qe_staff_token', 'responsive-e2e-session');
  });

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const json = (payload: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });

    if (path.endsWith('/auth/staff/me')) {
      return json({
        staffPublicId: 'STAFF-E2E',
        fullName: 'Test Staff',
        dealershipPublicId: 'DEALERSHIP-E2E',
        dealershipCode: 'LBA',
        roles: ['OWNER'],
        permissions: [
          'customer.read',
          'sales.read',
          'vehicle.read',
          'catalogue.read',
          'catalogue.manage',
          'workshop.read',
          'parts.read',
          'finance.read',
          'staff.read',
          'notification.read',
          'notification.create',
          'notification.approve',
          'notification.send',
          'social_media.read',
          'social_media.manage',
          'social_media.publish',
          'social_media.whatsapp.read',
          'social_media.whatsapp.manage',
          'social_media.whatsapp.send',
          'report.read',
          ...extraPermissions,
        ],
      });
    }
    if (path.endsWith('/system/health')) {
      return json({ status: 'UP', service: 'bajaj-api', version: 'e2e', timestamp: previewExpiry });
    }
    if (path.endsWith('/system/bootstrap/status')) return json({ available: false });
    if (path.endsWith('/admin/vehicle-models') && method === 'GET') {
      return json({ items: [], page: 0, pageSize: 100, total: 0 });
    }
    if (path.endsWith('/admin/vehicle-units') && method === 'GET') {
      return json({ items: [], page: 0, pageSize: 100, total: 0 });
    }
    if (path.endsWith('/admin/catalogue/models') && method === 'GET') {
      return json({ models: [{
        modelCode: 'BAJAJ_PULSAR_NS200', modelName: 'Pulsar NS200',
        family: 'Pulsar NS', category: 'SPORT', published: true,
        markedOutOfStock: false, expectedAvailableOn: null, internalNote: null, updatedAt: null,
        availableUnits: 0, expectedUnits: 0, reservedUnits: 0,
      }] });
    }
    if (path.endsWith('/admin/catalogue/pricing-profiles') && method === 'GET') {
      return json({ profiles: [] });
    }
    if (path.endsWith('/admin/catalogue/promotions') && method === 'GET') {
      return json({ promotions: [] });
    }
    if (path.endsWith('/admin/catalogue/models/BAJAJ_PULSAR_NS200/images') && method === 'GET') {
      return json({ items: galleryImages });
    }
    if (path.endsWith('/admin/catalogue/models/BAJAJ_PULSAR_NS200/images') && method === 'POST') {
      galleryImages = [{
        publicId: 'e2e-catalogue-image-1',
        modelCode: 'BAJAJ_PULSAR_NS200',
        contentType: 'image/png',
        sizeBytes: 68,
        primary: true,
        uploadedAt: '2026-10-29T12:00:00Z',
      }];
      return json(galleryImages[0]);
    }
    if (/\/admin\/catalogue\/models\/BAJAJ_PULSAR_NS200\/images\/[^/]+$/.test(path) && method === 'DELETE') {
      galleryImages = [];
      return json({ success: true, message: 'Image removed.' });
    }
    if (path.startsWith('/api/v1/public/catalogue/bikes/images/')) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP41STyHwAGmgKQNGNyggAAAABJRU5ErkJggg==', 'base64'),
      });
    }
    if (path.endsWith('/admin/notifications/media/e2e-image')) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6h8AAAAASUVORK5CYII=', 'base64'),
      });
    }
    if (path.endsWith('/admin/notifications/templates')) return json({ templates: [] });
    if (path.endsWith('/admin/social/meta/status')) return json({
      configured: false, publishingReady: false, code: 'NOT_CONFIGURED',
      message: 'Meta connection is not configured for this test.',
      missingConfigurationKeys: [], missingPublishingConfigurationKeys: [], destinations: [],
    });
    if (path.endsWith('/admin/social/whatsapp/status')) return json({
      configured: false, webhookConfigured: false,
      message: 'WhatsApp is not configured for this test.',
      webhookMessage: 'Webhook is not configured for this test.',
      missingConfigurationKeys: [], missingWebhookConfigurationKeys: [],
    });
    if (path.endsWith('/admin/social/whatsapp/customers')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/scheduled')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/templates')) return json([]);
    if (/\/admin\/notifications\/campaigns\/[^/]+\/preview$/.test(path) && method === 'GET') {
      const publicId = path.split('/').slice(-2, -1)[0];
      return json({
        campaign: { ...campaign(publicId.endsWith('0004') ? 'APPROVED' : 'SCHEDULED'), publicId, title: publicId.endsWith('0004') ? 'Campaign history row 4' : 'Campaign history row 2' },
        contentDocument: { version: 1, blocks: [{ type: 'hero', title: 'Exact saved headline', subtitle: 'Approved saved content' }] },
        audienceStage: 'PREVIEW',
        audienceResolvedAt: '2026-10-29T06:00:00Z',
        previewedRecipientCount: 2,
        recipientCounts: { CUSTOMER: 2 },
        currentEligibleRecipientCount: 1,
        currentEligibleRecipientCounts: { CUSTOMER: 1 },
        eligibilityCheckedAt: new Date().toISOString(),
        previewExpiresAt: previewExpiry,
        previewConsumedAt: '2026-10-29T06:01:00Z',
        approvedAt: '2026-10-29T06:01:00Z',
      });
    }
    if (path.endsWith('/admin/notifications/campaigns')) {
      const campaigns = Array.from({ length: 18 }, (_, index) => ({
        ...campaign(index === 3 ? 'APPROVED' : index % 2 === 0 ? 'SENT' : 'SCHEDULED'),
        id: index + 1,
        publicId: `camp-e2e-${String(index + 1).padStart(4, '0')}`,
        title: `Campaign history row ${index + 1}`,
        summary: 'A long enough campaign summary to exercise page scrolling in history.',
        resolvedRecipientCount: index + 1,
      }));
      return json({ campaigns });
    }
    if (path.endsWith('/admin/notifications/options')) {
      return json({
        institutions: [{
          id: 1,
          institutionCode: 'LBA',
          displayName: 'Lucky Bajaj Agency',
          status: 'ACTIVE',
          activeCustomerCount: 12,
          marketingConsentCustomerCount: 8,
          activeStaffCount: 3,
        }],
        activeCustomerCount: 12,
        marketingConsentCustomerCount: 8,
        activeStaffCount: 3,
      });
    }
    if (path.endsWith('/admin/notifications/recipients')) {
      const kind = url.searchParams.get('kind');
      return json({ recipients: kind === 'STAFF' ? staffRecipients : customers });
    }
    if (path.endsWith('/admin/notifications/preview') && method === 'POST') {
      return json(preview());
    }
    if (/\/admin\/notifications\/campaigns\/[^/]+\/approve$/.test(path) && method === 'POST') {
      return json(campaign('APPROVED'));
    }
    if (path.endsWith('/admin/notifications/send') && method === 'POST') {
      return json({ campaign: campaign('SENT'), idempotentReplay: false });
    }
    if (path.endsWith('/admin/notifications/inbox')) return json({ unreadCount: 0 });
    return json({});
  });
}

async function openNotificationStudio(page: Page) {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  const mobileToggle = page.locator('.mobile-nav-toggle');
  if (await mobileToggle.isVisible()) {
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
  }
  await page.getByRole('button', { name: /Notification Studio/ }).click();
  await expect(page.getByRole('heading', { name: 'Notification Studio', exact: true })).toBeVisible();
  await expect(page.getByLabel('Campaign title')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

for (const width of [320, 768, 1280]) {
  test(`Notification Studio stays within the viewport at ${width}px and supports each preview mode`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await openNotificationStudio(page);

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    for (const [label, mode] of [
      ['Mobile app', 'mobile'],
      ['Desktop inbox', 'inbox'],
      ['Push', 'push'],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('.rich-preview-frame')).toHaveAttribute('data-preview-mode', mode);
      const bounds = await page.locator('.preview-device-screen').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(-1);
      expect(bounds.right).toBeLessThanOrEqual(width + 1);
    }

    // Push mode deliberately suppresses images; verify media sizing on the mobile-app surface.
    await page.getByRole('button', { name: 'Mobile app', exact: true }).click();
    await page.getByLabel('Campaign title').fill('Extra-long campaign title '.repeat(5));
    await page.locator('.content-block-editor textarea').nth(1).fill('unbrokenmessage'.repeat(220));
    await page.locator('.add-block-controls select').selectOption('image');
    await page.getByRole('button', { name: /Add block/ }).click();
    const imageEditor = page.locator('.content-block-editor').last();
    await imageEditor.getByLabel('assetId').fill('e2e-image');
    await imageEditor.getByLabel('Image description (alt text)').fill('Test image with safe responsive bounds');
    const previewImage = page.locator('.preview-device-screen img');
    await expect(previewImage).toBeVisible();
    const imageBounds = await previewImage.evaluate((element) => {
      const image = element as HTMLImageElement;
      const rect = image.getBoundingClientRect();
      return { loaded: image.naturalWidth > 0, width: rect.width, screenWidth: image.parentElement?.getBoundingClientRect().width ?? 0 };
    });
    expect(imageBounds.loaded).toBe(true);
    expect(imageBounds.width).toBeLessThanOrEqual(imageBounds.screenWidth + 1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    // The real audience/approval surfaces must not introduce horizontal overflow.
    await page.getByRole('button', { name: 'Preview audience', exact: true }).click();
    await expect(page.locator('.preview-result')).toBeVisible();
    const toastStack = page.locator('.toast-stack');
    await expect(toastStack).toHaveCSS('position', 'fixed');
    await expect(toastStack.getByRole('status')).toContainText('Audience preview is ready');
    const toastBounds = await toastStack.boundingBox();
    expect(toastBounds).not.toBeNull();
    expect(toastBounds!.x).toBeGreaterThanOrEqual(-1);
    expect(toastBounds!.x + toastBounds!.width).toBeLessThanOrEqual(width + 1);
    const viewportMetrics = await page.evaluate(() => ({
      htmlWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollX: window.scrollX,
    }));
    expect(viewportMetrics.htmlWidth - viewportMetrics.clientWidth, JSON.stringify(viewportMetrics))
      .toBeLessThanOrEqual(1);
    expect(viewportMetrics.bodyWidth - viewportMetrics.clientWidth, JSON.stringify(viewportMetrics))
      .toBeLessThanOrEqual(1);

    // Keep actual rendered evidence from each target viewport with the workflow artifact.
    await page.screenshot({ path: testInfo.outputPath(`notification-studio-${width}px.png`), fullPage: false });
    await page.locator('.preview-result').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`notification-studio-audience-${width}px.png`), fullPage: false });
  });
}

for (const width of [320, 768]) {
  test(`navigation drawer closes and restores body scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await openNotificationStudio(page);

    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
    await expect.poll(() => page.locator('body').evaluate((element) => (element as HTMLElement).style.overflow))
      .toBe('hidden');

    await page.locator('.sidebar .mobile-drawer-close').click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/);
    await expect.poll(() => page.locator('body').evaluate((element) => (element as HTMLElement).style.overflow))
      .toBe('');
  });
}

test('desktop sidebar stays in view and scrolls independently', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await openNotificationStudio(page);

  const sidebar = page.locator('.app-shell > .sidebar');
  await expect.poll(() => sidebar.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
  await expect.poll(() => sidebar.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  const sidebarHeight = await sidebar.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(sidebarHeight.scrollHeight).toBeGreaterThan(sidebarHeight.clientHeight);
  await sidebar.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bounds = await sidebar.boundingBox();
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.y)).toBeLessThanOrEqual(1);

  // Also check a long Campaign history view, not only the editor.
  await page.getByRole('button', { name: /Campaign history/ }).click();
  await expect(page.locator('.campaign-row')).toHaveCount(18);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => sidebar.evaluate((element) => Math.abs(element.getBoundingClientRect().y)))
    .toBeLessThanOrEqual(1);
});

test('manual and all-eligible recipient checks, bulk actions, and review actions are consistent', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openNotificationStudio(page);

  await page.getByRole('button', { name: 'Search people', exact: true }).click();
  await expect(page.getByText('Aarav Customer')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Deselect Aarav Customer' })).toBeChecked();

  // In all-eligible mode, checking means included and unchecking creates an exclusion.
  await page.getByRole('checkbox', { name: 'Deselect Aarav Customer' }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Aarav Customer' })).not.toBeChecked();
  await expect(page.getByText('Excluded recipients')).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Deselect Aarav Customer' })).toBeChecked();

  // Manual mode starts unchecked; bulk operations apply to currently displayed results.
  await page.getByRole('radio', { name: /Choose recipients manually/ }).check();
  await expect(page.getByRole('checkbox', { name: 'Select Aarav Customer' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Select all results', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Deselect Aarav Customer' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Deselect Beena Customer' })).toBeChecked();
  await page.getByRole('button', { name: 'Deselect results', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Aarav Customer' })).not.toBeChecked();

  await page.getByRole('checkbox', { name: 'Select Aarav Customer' }).click();
  await expect(page.getByText('Selected recipients')).toBeVisible();
  await page.getByRole('button', { name: 'Deselect', exact: true }).click();
  await expect(page.getByText('Selected recipients')).toHaveCount(0);
});

test('content changes during an in-flight preview cannot restore stale approval state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openNotificationStudio(page);

  let releasePreview!: () => void;
  const previewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
  let markPreviewStarted!: () => void;
  const previewStarted = new Promise<void>((resolve) => { markPreviewStarted = resolve; });
  await page.route('**/api/v1/admin/notifications/preview', async (route) => {
    markPreviewStarted();
    await previewGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(preview()),
    });
  });

  try {
    const response = page.waitForResponse((value) => value.url().includes('/admin/notifications/preview'));
    await page.getByRole('button', { name: 'Preview audience', exact: true }).click();
    await previewStarted;
    await page.getByLabel('Campaign title').fill('Changed while preview was in flight');
    releasePreview();
    await response;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('.preview-result')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve campaign' })).toHaveCount(0);
  } finally {
    releasePreview();
  }
});

test('recipient/audience controls stay locked while a send request is processing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openNotificationStudio(page);
  await page.getByRole('button', { name: 'Preview audience', exact: true }).click();
  await expect(page.locator('.preview-result')).toBeVisible();
  await page.getByRole('button', { name: 'Approve campaign', exact: true }).click();
  await expect(page.getByRole('button', { name: /Send in-app notification/ })).toBeEnabled();

  let releaseSend!: () => void;
  const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
  let markSendStarted!: () => void;
  const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
  await page.route('**/api/v1/admin/notifications/send', async (route) => {
    markSendStarted();
    await sendGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ campaign: campaign('SENT'), idempotentReplay: false }),
    });
  });

  try {
    await page.getByRole('button', { name: /Send in-app notification/ }).click();
    await sendStarted;
    await expect(page.locator('.scope-choice')).toHaveCount(3);
    await expect(page.locator('.scope-choice').first()).toBeDisabled();
    await expect(page.getByLabel('Find a customer or staff member')).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Choose recipients manually/ })).toBeDisabled();
  } finally {
    releaseSend();
  }
});

test('campaign history exposes dispatch timing and compares saved audience with current eligibility', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openNotificationStudio(page);
  await page.getByRole('button', { name: /Campaign history/ }).click();

  const row = page.locator('.campaign-row').filter({ hasText: 'Campaign history row 2' });
  await expect(row).toBeVisible();
  await expect(row.getByText(/Retry overdue since/)).toBeVisible();
  await expect(row.getByText(/1 dispatch attempt/)).toBeVisible();
  await row.getByRole('button', { name: 'Preview exact content' }).click();

  const dialog = page.getByRole('dialog', { name: 'Campaign history row 2' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('EXACT SAVED CONTENT', { exact: true })).toBeVisible();
  await expect(dialog.getByText('ORIGINAL SAVED AUDIENCE', { exact: true })).toBeVisible();
  await expect(dialog.getByText('CURRENTLY ELIGIBLE AUDIENCE', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/1 currently eligible/)).toBeVisible();
  await expect(dialog.getByText('Exact saved headline', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Snapshot resolved/)).toBeVisible();
});

test('approved campaign history offers Send now before a schedule exists', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openNotificationStudio(page);
  await page.getByRole('button', { name: /Campaign history/ }).click();
  const row = page.locator('.campaign-row').filter({ hasText: 'Campaign history row 4' });
  await expect(row).toBeVisible();
  await expect(row.getByText('APPROVED', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: /Send now/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Campaign history row 4' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send now ↗' })).toBeVisible();
  await expect(dialog.getByText('EXACT SAVED CONTENT', { exact: true })).toBeVisible();
});


test('staff manage Bajaj model gallery with multipart upload and primary-image removal', async ({ page }) => {
  let galleryUploadContentType = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/admin/catalogue/models/BAJAJ_PULSAR_NS200/images'
        && request.method() === 'POST') {
      galleryUploadContentType = request.headers()['content-type'] ?? '';
    }
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.getByRole('button', { name: /Bike inventory/ }).click();
  await expect(page.getByRole('heading', { name: 'Motorcycle image gallery', exact: true })).toBeVisible();
  await expect(page.getByLabel('Bajaj catalogue model')).toHaveValue('BAJAJ_PULSAR_NS200');
  await expect(page.getByText('No uploaded gallery images for this model.')).toBeVisible();

  await page.locator('.catalogue-gallery-upload input[type="file"]').setInputFiles({
    name: 'pulsar-ns200.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP41STyHwAGmgKQNGNyggAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('button', { name: 'Upload as primary image' }).click();
  await expect(page.getByText('PRIMARY', { exact: true })).toBeVisible();
  expect(galleryUploadContentType).toContain('multipart/form-data');
  expect(galleryUploadContentType).not.toContain('application/json');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove image' }).click();
  await expect(page.getByText('No uploaded gallery images for this model.')).toBeVisible();
});


test('staff can open a customer profile and view the saved delivery address and private photo', async ({ page }) => {
  await mockApi(page, ['customer.update']);
  let customer = {
    publicId: '00000000-0000-0000-0000-000000000321',
    customerCode: 'CUS-E2E-0321',
    fullName: 'Asha Customer',
    phone: '9000000032',
    alternatePhone: '9000000033',
    email: 'asha@example.test',
    preferredLanguage: 'hi',
    status: 'ACTIVE',
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-29T10:00:00Z',
  };
  let savedCustomerUpdate: Record<string, unknown> | null = null;
  let customerNotes = 'Calls preferred during office hours.';
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (payload: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(payload),
    });
    if (path === '/api/v1/admin/customers' && method === 'GET') {
      return json({ items: [customer], page: 0, pageSize: 25, total: 1 });
    }
    if (path === '/api/v1/admin/customers/' + customer.publicId && method === 'GET') return json(customer);
    if (path === '/api/v1/admin/customers/' + customer.publicId && method === 'PUT') {
      savedCustomerUpdate = route.request().postDataJSON() as Record<string, unknown>;
      customer = { ...customer, ...savedCustomerUpdate, updatedAt: '2026-10-29T11:15:00Z' };
      customerNotes = typeof savedCustomerUpdate.notes === 'string' ? savedCustomerUpdate.notes : '';
      return json(customer);
    }
    if (path === '/api/v1/admin/customers/' + customer.publicId + '/saved-addresses' && method === 'GET') {
      return json([{
        publicId: 'address-e2e-0321', label: 'HOME', recipientName: 'Asha Customer',
        phone: '9000000032', addressLine1: '12 Station Road', addressLine2: 'Flat 3B',
        landmark: 'Near the post office', locality: 'Town Centre', city: 'Bettiah',
        district: 'West Champaran', state: 'Bihar', postalCode: '845438', country: 'India',
        isDefaultDelivery: true, createdAt: '2026-10-28T10:00:00Z', updatedAt: '2026-10-28T10:00:00Z',
      }]);
    }
    if (path === '/api/v1/admin/customers/' + customer.publicId + '/history' && method === 'GET') {
      return json({
        customer, notes: customerNotes,
        marketingConsentAt: null, marketingConsentSource: null,
        motorcyclePurchases: [], sparePartOrders: [], salesEnquiries: [], websiteRequests: [],
      });
    }
    if (path === '/api/v1/admin/customers/' + customer.publicId + '/profile-photo' && method === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwK8AAAAASUVORK5CYII=', 'base64'),
      });
    }
    return route.fallback();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'CUS-E2E-0321' })).toBeVisible();
  await page.getByRole('button', { name: 'View profile for Asha Customer' }).click();

  const dialog = page.getByRole('dialog', { name: 'Customer profile' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Asha Customer' })).toBeVisible();
  await expect(dialog.locator('.customer-profile-photo img')).toBeVisible();
  await expect(dialog.getByText('12 Station Road', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Near the post office', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Default', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Edit customer details' }).click();
  await dialog.getByLabel('Full name *').fill('Asha Updated');
  await dialog.getByLabel('Mobile number').fill('9000000042');
  await dialog.getByLabel('Internal customer note').fill('Prefers WhatsApp after 5 PM.');
  await expect(dialog.getByLabel('Marketing consent change')).toHaveValue('UNCHANGED');
  await dialog.getByRole('button', { name: 'Save customer details' }).click();
  await expect(dialog.getByRole('status')).toContainText('Customer details saved.');
  await expect(dialog.getByRole('heading', { name: 'Asha Updated' })).toBeVisible();
  expect(savedCustomerUpdate).toMatchObject({
    fullName: 'Asha Updated',
    phone: '9000000042',
    notes: 'Prefers WhatsApp after 5 PM.',
    marketingConsent: null,
    consentSource: null,
  });
  await expect(page.getByRole('button', { name: 'View profile for Asha Updated' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});



function silentWav(seconds = 35, sampleRate = 8_000): Buffer {
  const dataBytes = seconds * sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

test('Social Media Artwork Studio offers festival templates, bounded image/music libraries, and Story video export', async ({ page }) => {
  test.setTimeout(120_000);
  const browserDiagnostics: string[] = [];
  page.on('pageerror', (cause) => browserDiagnostics.push('pageerror: ' + (cause.stack || cause.message)));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserDiagnostics.push(message.type() + ': ' + message.text());
    }
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Social Media Studio', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Social Media Artwork Studio' });
  try {
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  } catch (cause) {
    throw new Error(String(cause) + '\\nBrowser diagnostics:\\n' + (browserDiagnostics.join('\\n') || 'No browser console/page errors captured.'));
  }
  await expect(dialog.getByRole('button', { name: 'Use Shubh Deepawali template' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use Chhath Puja · Sunrise template' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use Eid Mubarak · Elegant template' })).toBeVisible();
  await expect(dialog.getByText(/12 \/ 50 images · JPEG or PNG/)).toBeVisible();
  await expect(dialog.getByRole('slider', { name: /Position X/ })).toBeVisible();
  await expect(dialog.getByLabel('Headline colour')).toBeVisible();

  // Keep image selection deterministic and offline in CI; the real asset flow still validates
  // JPEG/PNG signatures, dimensions, size and IndexedDB persistence.
  await page.route('https://images.unsplash.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP41STyHwAGmgKQNGNyggAAAABJRU5ErkJggg==', 'base64'),
    });
  });
  await dialog.getByRole('button', { name: 'Use Shubh Deepawali template' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Headline', exact: true })).toHaveValue('शुभ दीपावली');
  await expect(dialog.getByText(/template loaded/)).toBeVisible();

  await dialog.getByTestId('artwork-image-upload').setInputFiles({
    name: 'dealer-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP41STyHwAGmgKQNGNyggAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(dialog.getByText(/13 \/ 50 images · JPEG or PNG/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use as logo' }).first()).toBeVisible();

  const musicLibrary = dialog.getByRole('region', { name: 'Music asset library' });
  await expect(musicLibrary).toBeVisible();
  await expect(musicLibrary.getByText(/10 \/ 50 tracks/)).toBeVisible();
  await expect(musicLibrary.getByText('Chhath · Hindu Festive Music')).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Story video creator' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create story video' })).toBeDisabled();

  // Use a generated audio file for deterministic coverage; actual curated tracks are imported from their source pages.
  await dialog.locator('[data-testid="artwork-music-upload"]').setInputFiles({
    name: 'festive-instrumental.wav',
    mimeType: 'audio/wav',
    buffer: silentWav(125),
  });
  await expect(dialog.getByText(/11 \/ 50 tracks/)).toBeVisible();
  await expect(dialog.getByText('festive-instrumental')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use 9:16 Story format' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use 9:16 Story format' }).click();
  await expect(dialog.getByRole('button', { name: 'Create story video' })).toBeEnabled();
  await expect(dialog.getByRole('slider', { name: 'Music snippet start' })).toBeEnabled();
  await expect(dialog.getByRole('slider', { name: 'Music volume' })).toBeEnabled();

  const videoDestination = dialog.getByLabel('Story video destination');
  await expect(videoDestination).toHaveValue('whatsapp-status');
  await expect(dialog.getByRole('button', { name: '120s', exact: true })).toBeDisabled();
  await videoDestination.selectOption('instagram-story');
  await expect(dialog.getByRole('button', { name: '120s', exact: true })).toBeDisabled();
  await videoDestination.selectOption('social-reel');
  await expect(dialog.getByRole('button', { name: '120s', exact: true })).toBeEnabled();

  // Exercise the real canvas/audio MediaRecorder path with a generated local WAV.
  await dialog.getByRole('button', { name: '20s', exact: true }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Create story video' }).click();
  await expect(dialog.getByRole('button', { name: 'Rendering story video…' })).toBeDisabled();
  const videoDownload = await downloadPromise;
  expect(videoDownload.suggestedFilename()).toMatch(/^lucky-bajaj-story-20s\.(mp4|webm)$/);
  await expect(dialog.getByRole('status').filter({ hasText: /Vertical video exported for Instagram \/ Facebook Reel \(20 seconds/ })).toBeVisible();
});
