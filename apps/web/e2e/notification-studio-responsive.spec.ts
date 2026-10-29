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
    scheduledAt: null,
    expiresAt: previewExpiry,
    createdAt: '2026-01-01T00:00:00Z',
    dispatchedAt: null,
    cancelledAt: null,
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

async function mockApi(page: Page) {
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
        ],
      });
    }
    if (path.endsWith('/system/health')) {
      return json({ status: 'UP', service: 'bajaj-api', version: 'e2e', timestamp: previewExpiry });
    }
    if (path.endsWith('/system/bootstrap/status')) return json({ available: false });
    if (path.endsWith('/admin/notifications/media/e2e-image')) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6h8AAAAASUVORK5CYII=', 'base64'),
      });
    }
    if (path.endsWith('/admin/notifications/templates')) return json({ templates: [] });
    if (path.endsWith('/admin/notifications/campaigns')) {
      const campaigns = Array.from({ length: 18 }, (_, index) => ({
        ...campaign(index % 2 === 0 ? 'SENT' : 'SCHEDULED'),
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
  test(`Notification Studio stays within the viewport at ${width}px and supports each preview mode`, async ({ page }) => {
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
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
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
