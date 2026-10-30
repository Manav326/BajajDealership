import { expect, test, type Page } from '@playwright/test';

async function installStudioFixture(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('qe_staff_token', 'social-studio-next-browser-test');
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        (window as unknown as { __studioFolderPickerRequested?: boolean }).__studioFolderPickerRequested = true;
        throw new DOMException('Folder picker dismissed by browser test.', 'AbortError');
      },
    });
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });
    if (path.endsWith('/auth/staff/me')) return json({
      staffPublicId: 'STAFF-NEXT-STUDIO',
      fullName: 'Creative Studio Test',
      dealershipPublicId: 'DEALERSHIP-NEXT-STUDIO',
      dealershipCode: 'LUCKYBAJAJ',
      roles: ['OWNER'],
      permissions: [
        'social_media.read', 'social_media.manage', 'social_media.publish',
        'social_media.whatsapp.read', 'social_media.whatsapp.manage', 'social_media.whatsapp.send',
        'notification.read',
      ],
    });
    if (path.endsWith('/system/health')) return json({ status: 'UP', service: 'bajaj-api', version: 'studio-next-test', timestamp: new Date().toISOString() });
    if (path.endsWith('/system/bootstrap/status')) return json({ available: false });
    if (path.endsWith('/admin/social/meta/status')) return json({
      configured: false, publishingReady: false, code: 'CONFIGURATION_REQUIRED',
      message: 'Meta is disabled in this test.', missingConfigurationKeys: ['SOCIAL_META_APP_ID'],
      missingPublishingConfigurationKeys: ['SOCIAL_MEDIA_PUBLIC_BASE_URL'], destinations: [],
    });
    if (path.endsWith('/admin/social/meta/publish-requests')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/status')) return json({
      configured: false, webhookConfigured: false, message: 'WhatsApp disabled in test.',
      webhookMessage: 'Webhook disabled in test.', missingConfigurationKeys: [],
      missingWebhookConfigurationKeys: [],
    });
    if (path.endsWith('/admin/social/whatsapp/customers')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/scheduled')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/templates')) return json([]);
    return json({});
  });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function openNewStudio(page: Page) {
  const mobileToggle = page.locator('.mobile-nav-toggle');
  if (await mobileToggle.isVisible()) await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.locator('button[title="Social Media Studio (New)"]').click();
  await expect(page.getByRole('navigation', { name: 'Creative workspace' })).toBeVisible();
}

test.beforeEach(async ({ page }) => installStudioFixture(page));

test('new navigation entry is separate and existing Social Media Studio remains available', async ({ page }) => {
  await expect(page.locator('button[title="Social Media Studio"]')).toBeVisible();
  const newEntry = page.locator('button[title="Social Media Studio (New)"]');
  await expect(newEntry).toBeVisible();
  await expect(newEntry.locator('.nav-new')).toHaveText('NEW');
  await openNewStudio(page);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.locator('button[title="Social Media Studio"]').click();
  await expect(page.getByRole('heading', { name: 'LuckyBajaj Creative Studio' })).toBeVisible();
});

test('asks for local folder access and opens a full-viewport editor', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Choose local resource folder' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __studioFolderPickerRequested?: boolean }).__studioFolderPickerRequested))
    .toBe(true);

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Creative editor' });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('position', 'fixed');
  const bounds = await editor.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBe(0);
  expect(bounds!.y).toBe(0);
  expect(bounds!.width).toBe(viewport.width);
  expect(bounds!.height).toBe(viewport.height);
  await expect(page.getByRole('button', { name: 'Templates' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resize' })).toBeVisible();
});

test('supports editable elements, contextual properties, custom sizes, pages and project round-trip', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('button', { name: 'Add heading' }).click();
  const text = page.getByRole('textbox', { name: 'Text' });
  await expect(text).toHaveValue('Your text here');
  await text.fill('Ride into your next journey');

  await page.getByRole('button', { name: 'Resize' }).click();
  await page.getByRole('button', { name: 'Portrait feed 3:4' }).click();
  await expect(page.locator('.editorFooter')).toContainText('1080 × 1440');
  await page.getByRole('button', { name: 'Create variant 1080 by 1080' }).click();
  await expect(page.locator('.timelinePage,.timelinePageActive')).toHaveCount(2);
  await expect(page.locator('.editorFooter')).toContainText('1080 × 1080');

  await page.getByRole('button', { name: 'Pages' }).click();
  await page.locator('.pageTools').getByRole('button', { name: 'Add page' }).click();
  await expect(page.locator('.timelinePage,.timelinePageActive')).toHaveCount(3);
  await expect(page.locator('.timelinePageActive')).toHaveCount(1);
  await page.locator('.timelinePage').filter({ hasText: 'Portrait feed 3:4' }).click();

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  const project = page.getByRole('button', { name: 'Open Untitled design' });
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.getByLabel('Text')).toHaveValue('Ride into your next journey');
  await expect(page.locator('.editorFooter')).toContainText('1080 × 1440');
});

test('exports artwork into the independent local resource library and supports re-download', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('button', { name: 'Add heading' }).click();
  await page.getByRole('textbox', { name: 'Text' }).fill('Lucky Bajaj creative export');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByRole('status').filter({ hasText: 'Export saved to the resource library' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await expect(page.locator('[data-testid="studio-resource-card"]')).toHaveCount(1);
  await page.getByRole('button', { name: /Download .*\.png/ }).click();
});

test('resource import, filter and delete remain in the resource library', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const upload = page.locator('input[type="file"][multiple]').first();
  await upload.setInputFiles({
    name: 'local-campaign-photo.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.getByText('local-campaign-photo.png')).toBeVisible();
  await page.getByRole('combobox', { name: 'Resource type' }).selectOption('image');
  await expect(page.getByText('local-campaign-photo.png')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete local-campaign-photo.png' }).click();
  // Confirm the resource is removed after the explicit confirmation.
  await expect(page.getByText('local-campaign-photo.png')).toHaveCount(0);
});

for (const width of [390, 768, 1280]) {
  test('new studio workspace adapts without horizontal overflow at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await openNewStudio(page);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Creative editor' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
