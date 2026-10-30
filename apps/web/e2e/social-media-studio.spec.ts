import { expect, test, type Page } from '@playwright/test';

const permissions = [
  'social_media.read',
  'social_media.manage',
  'social_media.publish',
  'social_media.whatsapp.read',
  'social_media.whatsapp.manage',
  'social_media.whatsapp.send',
  'notification.read',
];

async function installApiFixture(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('qe_staff_token', 'social-studio-browser-test');
  });

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (path.endsWith('/auth/staff/me')) {
      return json({
        staffPublicId: 'STAFF-SOCIAL-E2E',
        fullName: 'Social Studio Test Staff',
        dealershipPublicId: 'DEALERSHIP-SOCIAL-E2E',
        dealershipCode: 'LUCKYBAJAJ',
        roles: ['OWNER'],
        permissions,
      });
    }
    if (path.endsWith('/system/health')) {
      return json({ status: 'UP', service: 'bajaj-api', version: 'browser-test', timestamp: new Date().toISOString() });
    }
    if (path.endsWith('/admin/notifications/inbox')) return json({ unreadCount: 0, items: [] });
    if (path.endsWith('/admin/social/meta/status')) {
      return json({
        configured: false,
        publishingReady: false,
        code: 'CONFIGURATION_REQUIRED',
        message: 'Meta is not configured in this isolated browser test.',
        missingConfigurationKeys: ['SOCIAL_META_APP_ID'],
        missingPublishingConfigurationKeys: ['SOCIAL_MEDIA_PUBLIC_BASE_URL'],
        destinations: [],
      });
    }
    if (path.endsWith('/admin/social/meta/publish-requests')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/status')) {
      return json({
        configured: false,
        webhookConfigured: false,
        message: 'WhatsApp is not configured in this isolated browser test.',
        webhookMessage: 'Webhook is not configured in this isolated browser test.',
        missingConfigurationKeys: ['SOCIAL_WHATSAPP_ENABLED'],
        missingWebhookConfigurationKeys: ['SOCIAL_WHATSAPP_VERIFY_TOKEN'],
      });
    }
    if (path.endsWith('/admin/social/whatsapp/customers')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/scheduled')) return json([]);
    if (path.endsWith('/admin/social/whatsapp/templates')) return json([]);

    // These browser tests exercise UI transitions only. No provider credentials are
    // configured and no real posts or customer messages may leave the application.
    return json({ message: 'No fixture exists for this API route.' }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  await installApiFixture(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Social Media Studio' })).toBeVisible();
  await page.getByRole('button', { name: 'Social Media Studio' }).click();
  await expect(page.getByRole('heading', { name: 'LuckyBajaj Creative Studio' })).toBeVisible();
});

test('desktop navigation collapses to icon-only mode and can expand again', async ({ page }) => {
  const sidebar = page.locator('#primary-navigation');
  const collapse = page.getByRole('button', { name: 'Collapse navigation' });
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await collapse.click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(sidebar).not.toHaveClass(/collapsed/);
});

test('opens as a regular editor-first page, not a modal', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: 'Social Media Artwork Studio' })).toHaveCount(0);
  await expect(page.locator('canvas[aria-label^="Preview of"], canvas[aria-label^="Editable canvas"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Create & edit/ })).toHaveAttribute('aria-current', 'page');
});

test('image and music catalogues open as independent pickers and can be searched', async ({ page }) => {
  await page.getByRole('button', { name: /Photos & assets/ }).click();
  const imagePicker = page.getByRole('dialog', { name: 'Choose an artwork image' });
  await expect(imagePicker).toBeVisible();
  await expect(imagePicker.getByText('Diwali · Diyas & warm lights').first()).toBeVisible();
  await imagePicker.getByText('Diwali · Diyas & warm lights').first().hover();
  await expect(imagePicker.getByRole('img', { name: 'Diwali · Diyas & warm lights' })).toBeVisible();
  await imagePicker.getByRole('searchbox', { name: 'Search image assets' }).fill('Chhath');
  await expect(imagePicker.getByText('Chhath Puja · Arghya at sunrise')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(imagePicker).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Photos & assets/ })).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

  await page.getByRole('button', { name: /Music & sound/ }).click();
  const musicPicker = page.getByRole('dialog', { name: 'Choose background music' });
  await expect(musicPicker).toBeVisible();
  await expect(musicPicker.getByText('Chhath · Hindu Festive Music')).toBeVisible();
  await expect(musicPicker.getByRole('button', { name: 'Preview source' }).first()).toBeEnabled();
  await musicPicker.getByRole('searchbox', { name: 'Search music tracks' }).fill('Bhojpuri');
  await expect(musicPicker.getByText('Bhojpuri · Regional festive feel')).toBeVisible();
  await expect(musicPicker.getByText('Chhath · Hindu Festive Music')).toHaveCount(0);
});

test('asset picker adds an independent image object and drafts restore its layer', async ({ page }) => {
  await page.route('https://images.unsplash.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=', 'base64') });
  });
  await page.getByRole('button', { name: /Photos & assets/ }).click();
  const imagePicker = page.getByRole('dialog', { name: 'Choose an artwork image' });
  await expect(imagePicker).toBeVisible();
  await imagePicker.getByRole('searchbox', { name: 'Search image assets' }).fill('Diwali');
  await expect(imagePicker.getByText('Diwali · Diyas & warm lights').first()).toBeVisible();
  await imagePicker.getByRole('button', { name: 'Add to canvas' }).first().click();
  await expect(imagePicker).toHaveCount(0);
  await expect(page.getByText(/1 editable object/)).toBeVisible();
  await expect(page.locator('[aria-label="Object layers"]').getByRole('button', { name: /Diwali/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved in this browser' })).toBeVisible();
  const savedDraftPicker = page.getByLabel('Open saved draft');
  const option = await savedDraftPicker.locator('option').nth(1).getAttribute('value');
  expect(option).toBeTruthy();
  await savedDraftPicker.selectOption(option!);
  await expect(page.getByText(/1 editable object/)).toBeVisible();
});

test('canvas tools create and persist editable text and shape objects in a saved draft', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Text' }).click();
  await expect(page.getByText(/1 editable object/)).toBeVisible();
  const textField = page.getByLabel('Text');
  await expect(textField).toHaveValue('Your message here');
  await textField.fill('Ride into your next adventure');
  await page.getByLabel('Font family').selectOption('Georgia');
  await page.getByLabel('Alignment').selectOption('center');
  await expect(page.getByLabel('Rotation')).toBeVisible();
  await page.getByLabel('Rotation').focus();
  await expect(page.getByRole('region', { name: 'Story composition timeline' })).toBeVisible();
  await page.getByRole('button', { name: '＋ Rectangle' }).click();
  await expect(page.getByText(/2 editable object/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/1 editable object/)).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText(/2 editable object/)).toBeVisible();
  await page.getByLabel('Draft name').fill('Browser studio object round-trip');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved in this browser' })).toBeVisible();
  const savedDraftPicker = page.getByLabel('Open saved draft');
  const savedDraftOptionId = await savedDraftPicker.locator('option').nth(1).getAttribute('value');
  expect(savedDraftOptionId).toBeTruthy();
  await savedDraftPicker.selectOption(savedDraftOptionId!);
  await expect(page.getByText(/2 editable object/)).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByText(/0 editable object/)).toBeVisible();
});

test('Meta, WhatsApp and publishing workflows stay on dedicated tabs', async ({ page }) => {
  await page.getByRole('button', { name: /Connections/ }).click();
  await expect(page.getByRole('region', { name: 'Meta account connections' })).toBeVisible();
  await expect(page.getByText('SOCIAL_META_APP_ID')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'WhatsApp customer messages' })).toBeVisible();

  await page.getByRole('button', { name: /Publishing & history/ }).click();
  await expect(page.getByRole('region', { name: 'Publish campaign artwork' })).toBeVisible();
  await expect(page.getByText('Approval and schedule queue')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Publish campaign artwork' }).getByText('Not configured')).toBeVisible();
});

test('WhatsApp composer keeps unsent form state when switching studio tabs', async ({ page }) => {
  await page.getByRole('button', { name: /Connections/ }).click();
  const preferenceSource = page.getByRole('textbox', { name: 'Preference source' });
  await expect(preferenceSource).toBeVisible();
  await preferenceSource.fill('Verified customer-requested opt-in · keep this draft');
  await page.getByRole('button', { name: /Create & edit/ }).click();
  await page.getByRole('button', { name: /Connections/ }).click();
  await expect(page.getByRole('textbox', { name: 'Preference source' }))
    .toHaveValue('Verified customer-requested opt-in · keep this draft');
});

test('prevents deleting an image asset referenced by a saved canvas draft', async ({ page }) => {
  await page.getByRole('button', { name: /Photos & assets/ }).click();
  const imagePicker = page.getByRole('dialog', { name: 'Choose an artwork image' });
  await imagePicker.getByTestId('artwork-image-upload').setInputFiles({
    name: 'saved-campaign-layer.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=', 'base64'),
  });
  const uploadedAsset = imagePicker.getByRole('article').filter({ hasText: 'saved-campaign-layer' });
  await expect(uploadedAsset).toBeVisible();
  await uploadedAsset.getByRole('button', { name: 'Add to canvas' }).click();
  await expect(imagePicker).toHaveCount(0);
  await page.getByLabel('Draft name').fill('Draft that depends on image asset');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved in this browser' })).toBeVisible();

  await page.getByRole('button', { name: /Photos & assets/ }).click();
  const reopenedPicker = page.getByRole('dialog', { name: 'Choose an artwork image' });
  const referencedAsset = reopenedPicker.getByRole('article').filter({ hasText: 'saved-campaign-layer' });
  await referencedAsset.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('alert')).toContainText('Draft that depends on image asset');
  await expect(referencedAsset).toBeVisible();
});
