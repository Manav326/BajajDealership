import { expect, test, type Page } from '@playwright/test';

function makeSilentWav(seconds: number) {
  const sampleRate = 8000;
  const dataBytes = sampleRate * seconds * 2;
  const file = Buffer.alloc(44 + dataBytes);
  file.write('RIFF', 0);
  file.writeUInt32LE(36 + dataBytes, 4);
  file.write('WAVE', 8);
  file.write('fmt ', 12);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write('data', 36);
  file.writeUInt32LE(dataBytes, 40);
  return file;
}

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
  await expect(page.getByRole('button', { name: 'Render photo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
});

test('canvas fullscreen is distinct from fit-page zoom and can be exited', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Fit page' }).click();
  await expect(page.getByRole('button', { name: 'Fullscreen canvas' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Fullscreen canvas' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Creative editor"]');
    return Boolean(document.fullscreenElement) || getComputedStyle(editor!).gridTemplateRows.startsWith('0px');
  })).toBe(true);
  await expect(page.getByRole('button', { name: 'Exit fullscreen canvas' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Exit fullscreen canvas' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Creative editor"]');
    return !document.fullscreenElement && !getComputedStyle(editor!).gridTemplateRows.startsWith('0px');
  })).toBe(true);
  await expect(page.getByRole('button', { name: 'Fullscreen canvas' })).toHaveAttribute('aria-pressed', 'false');
});

test('supports editable elements, contextual properties, custom sizes, pages and project round-trip', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('button', { name: 'Headline' }).click();
  const text = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(text).toHaveValue('Your next adventure starts here');
  await text.fill('Ride into your next journey');

  await page.getByRole('button', { name: 'Resize' }).click();
  await page.getByRole('button', { name: 'Portrait feed 3:4' }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 1440');
  await page.getByRole('button', { name: 'Render photo' }).click();
  await expect(page.getByRole('button', { name: 'Preview rendered photo' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Preview rendered photo' }).click();
  const portraitOutput = page.getByRole('img', { name: 'Rendered photo output' });
  await expect.poll(async () => portraitOutput.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1080);
  await expect.poll(async () => portraitOutput.evaluate(image => (image as HTMLImageElement).naturalHeight)).toBe(1440);
  await page.getByRole('button', { name: 'Close photo preview' }).click();
  await page.getByRole('button', { name: 'Create variant 1080 by 1080' }).click();
  await expect(page.getByRole('button', { name: /2 Square feed/ })).toBeVisible();
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 1080');

  await page.getByRole('button', { name: 'Landscape feed' }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 566');
  await page.getByRole('button', { name: 'Render photo' }).click();
  await expect(page.getByRole('button', { name: 'Preview rendered photo' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Preview rendered photo' }).click();
  const landscapeOutput = page.getByRole('img', { name: 'Rendered photo output' });
  await expect.poll(async () => landscapeOutput.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1080);
  await expect.poll(async () => landscapeOutput.evaluate((image) => (image as HTMLImageElement).naturalHeight)).toBe(566);
  await page.getByRole('button', { name: 'Close photo preview' }).click();

  await page.getByLabel('Custom width').fill('1234');
  await page.getByLabel('Custom height').fill('987');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1234 × 987');
  await page.getByRole('button', { name: 'Render photo' }).click();
  await expect(page.getByRole('button', { name: 'Preview rendered photo' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Preview rendered photo' }).click();
  const customOutput = page.getByRole('img', { name: 'Rendered photo output' });
  await expect.poll(async () => customOutput.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1234);
  await expect.poll(async () => customOutput.evaluate((image) => (image as HTMLImageElement).naturalHeight)).toBe(987);
  await page.getByRole('button', { name: 'Close photo preview' }).click();

  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('complementary', { name: 'Pages' }).getByRole('button', { name: 'Add page' }).click();
  await expect(page.getByRole('button', { name: /3 Page 3/ })).toBeVisible();
  await page.getByRole('button', { name: /1 Portrait feed 3:4/ }).click();
  await page.getByLabel('Page 1 name').fill('Opening scene');
  await page.getByRole('button', { name: 'Duplicate page' }).click();
  await expect(page.getByLabel('Page 4 name')).toHaveValue('Opening scene — Copy');
  await expect(page.getByRole('img', { name: 'Editable design canvas' }).locator('text')).toHaveText('Ride into your next journey');
  await page.getByRole('button', { name: /1 Opening scene/ }).click();
  await page.getByRole('button', { name: 'Duplicate page' }).click();
  await expect(page.getByLabel('Page 5 name')).toHaveValue('Opening scene — Copy 2');
  await page.getByRole('button', { name: /1 Opening scene/ }).click();
  await page.getByRole('combobox', { name: 'Transition after page 1' }).selectOption('fade');
  await page.getByRole('spinbutton', { name: 'Fade duration after page 1' }).fill('1.5');
  await expect(page.getByRole('spinbutton', { name: 'Fade duration after page 1' })).toHaveValue('1.5');
  await page.getByRole('button', { name: 'Duplicate page' }).click();
  await expect(page.getByLabel('Page 6 name')).toHaveValue('Opening scene — Copy 3');
  await expect(page.getByRole('combobox', { name: 'Transition after page 6' })).toHaveValue('fade');
  await expect(page.getByRole('spinbutton', { name: 'Fade duration after page 6' })).toHaveValue('1.5');
  await page.getByRole('button', { name: /1 Opening scene/ }).click();

  await page.getByRole('button', { name: 'Back to resources' }).click();
  await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  const project = page.getByRole('button', { name: 'Open Untitled design' });
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.getByRole('img', { name: 'Editable design canvas' }).locator('text')).toHaveText('Ride into your next journey');
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 1440');
});

test('renders a selected landscape video size, previews it in the editor and does not auto-download', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('1');
  await page.getByRole('button', { name: 'Resize' }).click();
  await page.getByRole('button', { name: 'Landscape feed' }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 566');
  await page.getByRole('button', { name: 'Render video' }).click();
  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled({ timeout: 30000 });
  await expect(preview).toBeVisible({ timeout: 30000 });
  const video = preview.locator('video');
  await expect(video).toHaveAttribute('controls', '');
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(1080);
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(566);
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close video preview' }).click();
  await expect(page.getByRole('dialog', { name: 'Creative editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Portrait feed 3:4' }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 1440');
  await page.getByRole('button', { name: 'Render video' }).click();
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(1080);
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(1440);
  await page.getByRole('button', { name: 'Close video preview' }).click();

  await page.getByLabel('Custom width').fill('1234');
  await page.getByLabel('Custom height').fill('987');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1234 × 987');
  await page.getByRole('button', { name: 'Render video' }).click();
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(1234);
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(987);
  await page.getByRole('button', { name: 'Close video preview' }).click();
  await expect(page.getByRole('dialog', { name: 'Creative editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to resources' }).click();
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const renderedVideoCard = page.locator('[data-testid="studio-resource-card"]').filter({ hasText: /untitled-design-video\.(?:mp4|webm)/ }).first();
  await expect(renderedVideoCard).toBeVisible();
  const resourcePlayer = renderedVideoCard.locator('video');
  await expect(resourcePlayer).toHaveAttribute('controls', '');
  await expect.poll(async () => renderedVideoCard.locator('span').last().textContent()).toContain('00:01');
  const reDownload = page.waitForEvent('download');
  await renderedVideoCard.getByRole('button', { name: /Download untitled-design-video\.(?:mp4|webm)/ }).click();
  expect((await reDownload).suggestedFilename()).toMatch(/\.(?:mp4|webm)$/);
});

test('renders a photo first, then downloads it only after an explicit choice', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('button', { name: 'Headline' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Lucky Bajaj creative export');
  await page.getByRole('button', { name: 'Render photo' }).click();
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled({ timeout: 15000 });
  await page.getByRole('button', { name: 'Preview rendered photo' }).click();
  const squarePhoto = page.getByRole('img', { name: 'Rendered photo output' });
  await expect.poll(async () => squarePhoto.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1080);
  await expect.poll(async () => squarePhoto.evaluate(image => (image as HTMLImageElement).naturalHeight)).toBe(1080);
  await page.getByRole('button', { name: 'Close photo preview' }).click();
  await page.getByRole('button', { name: 'Download rendered outputs' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download selected' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByRole('dialog', { name: 'Creative editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to resources' }).click();
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await expect(page.locator('[data-testid="studio-resource-card"]')).toHaveCount(1);
  await page.getByRole('button', { name: /Download .*\.png/ }).click();
});

test('video render can be cancelled, cleans up and can be retried', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('2');
  await page.getByRole('button', { name: 'Render video' }).click();
  const cancel = page.getByRole('button', { name: 'Cancel render' });
  await expect(cancel).toBeVisible({ timeout: 15000 });
  await cancel.click();
  await expect(page.getByText('Video rendering was cancelled.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel render' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Render video' }).click();
  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled();
});

test('download workflow supports video-only and photo-plus-video selections', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Render photo' }).click();
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Render video' }).click();
  const videoPreview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(videoPreview).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Close video preview' }).click();
  await expect(page.getByRole('button', { name: 'Render photo' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Render video' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Download rendered outputs' }).click();
  const output = page.getByRole('combobox', { name: 'Output selection' });
  await expect(output.locator('option')).toHaveCount(3);
  await output.selectOption('video');
  const videoDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download selected' }).click();
  expect((await videoDownload).suggestedFilename()).toMatch(/\.(?:mp4|webm)$/);

  await page.getByRole('button', { name: 'Download rendered outputs' }).click();
  await page.getByRole('combobox', { name: 'Output selection' }).selectOption('both');
  const bothDownloads: string[] = [];
  const captureDownload = (download: { suggestedFilename: () => string }) => bothDownloads.push(download.suggestedFilename());
  page.on('download', captureDownload);
  await page.getByRole('button', { name: 'Download selected' }).click();
  await expect.poll(() => bothDownloads.length).toBe(2);
  page.off('download', captureDownload);
  expect(bothDownloads[0]).toMatch(/\.png$/);
  expect(bothDownloads[1]).toMatch(/\.(?:mp4|webm)$/);
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


test('video resource cards play and show the decoded media duration', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const upload = page.locator('input[type="file"][multiple]').first();
  await upload.setInputFiles({
    name: 'library-preview.webm', mimeType: 'video/webm',
    buffer: Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAPREU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggO77AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIBQqxoaDkAoicgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgTC6gTCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WIBQqxoaDkAohnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QhLngQCjwYEAAIBwAwCdASowADAAAEcIhYWImYSIAgICdaoD+AP6AgdqCOecuLQA/v1u8//kb+PnRv/I4//8Sp7jieP//EaAo7KBAGQAMQIABRCsABgMUUvbO5RwHhcckwD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQDIABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQEsABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQGQABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQH0ABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQJYABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQK8ABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQMgABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agABxTu2uRu4+zgQC3iveBAfGCAaPwgQM=', 'base64'),
  });
  const card = page.locator('[data-testid="studio-resource-card"]').filter({ hasText: 'library-preview.webm' });
  const player = card.locator('video[aria-label="Preview library-preview.webm"]');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('controls', '');
  await expect.poll(async () => card.locator('span').last().textContent()).toContain('00:01');
  await expect.poll(async () => player.evaluate(element => (element as HTMLVideoElement).duration)).toBeGreaterThan(0);
});

test('project-name save button is enabled only after a name change', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const saveName = page.getByRole('button', { name: 'Save design name' });
  await expect(saveName).toBeDisabled();
  await page.getByRole('textbox', { name: 'Design name' }).fill('Summer campaign');
  await expect(saveName).toBeEnabled();
  await saveName.click();
  await expect(saveName).toBeDisabled();
});

test('element search filters presets and layer search filters the actual layer list', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Elements' }).click();
  await page.getByRole('textbox', { name: 'Search tool resources' }).fill('badge');
  await expect(page.getByRole('button', { name: 'Offer badge', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Circle' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Offer badge', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search tool resources' }).fill('Circle');
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.getByRole('button', { name: 'Layers' }).click();
  await page.getByRole('textbox', { name: 'Search tool resources' }).fill('offer');
  await expect(page.getByRole('button', { name: 'Offer badge', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Circle', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Offer badge', exact: true }).click();
  await page.getByRole('button', { name: 'Lock layer' }).click();
  await expect(page.getByText('This layer is locked. Unlock it in Layers to edit.')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'X' })).toBeDisabled();
  await expect(page.locator('svg[aria-label="Editable design canvas"] > g[transform*="rotate"]')).toHaveCount(0);
  const lockedLayer = page.getByRole('button', { name: 'Offer badge', exact: true });
  const lockedCanvasObject = page.locator('svg[aria-label="Editable design canvas"] g[aria-label="Select Offer badge, locked"]');
  await expect(lockedCanvasObject).toHaveCount(1);
  const lockedBefore = await lockedCanvasObject.boundingBox();
  if (!lockedBefore) throw new Error('Locked canvas object is not visible.');
  await page.mouse.move(lockedBefore.x + lockedBefore.width/2, lockedBefore.y + lockedBefore.height/2);
  await page.mouse.down();
  await page.mouse.move(lockedBefore.x + lockedBefore.width/2 + 50, lockedBefore.y + lockedBefore.height/2 + 35, { steps: 3 });
  await page.mouse.up();
  const lockedAfter = await lockedCanvasObject.boundingBox();
  expect(lockedAfter?.x).toBeCloseTo(lockedBefore.x, 1);
  expect(lockedAfter?.y).toBeCloseTo(lockedBefore.y, 1);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+d');
  await expect(lockedLayer).toBeVisible();
});


test('layer visibility hides and restores the selected canvas object', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Elements' }).click();
  await page.getByRole('button', { name: 'Offer badge', exact: true }).click();
  const canvasObject = page.locator('svg[aria-label="Editable design canvas"] g[aria-label="Select Offer badge"]');
  await expect(canvasObject).toHaveCount(1);
  await page.getByRole('button', { name: 'Layers' }).click();
  const hide = page.getByRole('button', { name: 'Hide layer' });
  await expect(hide).toBeVisible();
  await hide.click();
  const show = page.getByRole('button', { name: 'Show layer' });
  await expect(show).toHaveAttribute('aria-pressed', 'true');
  await expect(canvasObject).toHaveCount(0);
  await show.click();
  await expect(page.getByRole('button', { name: 'Hide layer' })).toHaveAttribute('aria-pressed', 'false');
  await expect(canvasObject).toHaveCount(1);
});

test('search filters Text, Uploads and Audio library entries', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await page.getByRole('button', { name: 'Text' }).click();
  const search = page.getByRole('textbox', { name: 'Search tool resources' });
  await search.fill('Fine print');
  await expect(page.getByRole('button', { name: 'Fine print', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Body text', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Uploads' }).click();
  await page.getByLabel('Import media').setInputFiles([
    { name: 'campaign-alpha.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=','base64') },
    { name: 'campaign-beta.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=','base64') },
  ]);
  await expect(page.getByText('campaign-alpha.png')).toBeVisible();
  await expect(page.getByText('campaign-beta.png')).toBeVisible();
  await search.fill('campaign-beta');
  await expect(page.getByText('campaign-beta.png')).toBeVisible();
  await expect(page.getByText('campaign-alpha.png')).toHaveCount(0);

  await page.getByRole('button', { name: 'Audio' }).click();
  await page.getByLabel('Import audio').setInputFiles({ name: 'ambient-alpha.wav', mimeType: 'audio/wav', buffer: makeSilentWav(2) });
  await expect(page.getByRole('button', { name: 'ambient-alpha.wav', exact: true })).toBeVisible();
  await page.getByLabel('Import audio').setInputFiles({ name: 'ambient-beta.wav', mimeType: 'audio/wav', buffer: makeSilentWav(2) });
  await expect(page.getByRole('button', { name: 'ambient-beta.wav', exact: true })).toBeVisible();
  await search.fill('ambient-beta');
  await expect(page.getByRole('button', { name: 'ambient-beta.wav', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ambient-alpha.wav', exact: true })).toHaveCount(0);
});

test('scene timeline plays and seeks a preview without triggering a render', async ({ page }) => {
  await openNewStudio(page); await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'Play timeline preview'}).click();
  await expect(page.locator('canvas[aria-label="Timeline preview"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Pause timeline preview'})).toBeVisible();
  await page.getByRole('button',{name:'Pause timeline preview'}).click();
  await page.getByRole('button',{name:'Exit timeline preview'}).click();
  await expect(page.getByRole('img',{name:'Editable design canvas'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Download rendered outputs'})).toBeDisabled();
});
test('brand image picker supports existing library resources and explicit uploads', async ({ page }) => {
  await openNewStudio(page); await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'Brand'}).click();
  await page.getByRole('button',{name:'Add logo / image'}).click();
  const picker = page.getByRole('dialog',{name:'Brand image picker'});
  await expect(picker).toBeVisible();
  await picker.locator('input[aria-label="Upload brand logo or image"]').setInputFiles({name:'brand-logo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=','base64')});
  await expect(picker).toHaveCount(0);
  const canvasImages = page.getByRole('img',{name:'Editable design canvas'}).locator('image');
  await expect(canvasImages).toHaveCount(1);
  await page.getByRole('button',{name:'Add logo / image'}).click();
  const existingPicker = page.getByRole('dialog',{name:'Brand image picker'});
  await expect(existingPicker.getByRole('button',{name:'brand-logo.png'})).toBeVisible();
  await existingPicker.getByRole('button',{name:'brand-logo.png'}).click();
  await expect(existingPicker).toHaveCount(0);
  await expect(canvasImages).toHaveCount(2);
});


test('adds sticker presets and exposes editable text spacing and save state', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('button', { name: 'Headline' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Letter spacing' })).toHaveValue('0');
  await page.getByRole('spinbutton', { name: 'Letter spacing' }).fill('2.5');
  await expect(page.getByRole('spinbutton', { name: 'Letter spacing' })).toHaveValue('2.5');
  await page.getByRole('button', { name: 'Set text colour #facc15' }).click();
  await page.getByLabel('Font family').selectOption('Georgia');
  await page.getByLabel('Font size').fill('88');
  await page.getByLabel('Text alignment').selectOption('center');
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.getByRole('button', { name: 'Italic' }).click();
  await expect(page.getByLabel('Font family')).toHaveValue('Georgia');
  await expect(page.getByLabel('Font size')).toHaveValue('88');
  await expect(page.getByLabel('Text alignment')).toHaveValue('center');
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Elements' }).click();
  await page.getByRole('textbox', { name: 'Search tool resources' }).fill('Star sticker');
  await page.getByRole('button', { name: 'Star sticker' }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('textbox', { name: 'Page 1 name' }).fill('Opening scene');
  await page.getByRole('combobox', { name: 'Transition after page 1' }).selectOption('fade');
  await page.getByRole('spinbutton', { name: 'Fade duration after page 1' }).fill('1.5');
  await expect(page.getByRole('textbox', { name: 'Page 1 name' })).toHaveValue('Opening scene');
  await expect(page.getByRole('spinbutton', { name: 'Fade duration after page 1' })).toHaveValue('1.5');
});

test('Back saves a new blank design before returning to the resource library', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Back to resources' }).click();
  await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Untitled design' })).toBeVisible();
});

test('short audio under twenty seconds imports, trims and renders with video', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('2');
  await page.getByRole('button', { name: 'Audio' }).click();
  await page.getByLabel('Import audio').setInputFiles({
    name: 'short-cue.wav', mimeType: 'audio/wav', buffer: makeSilentWav(.5),
  });
  const audioTrack = page.getByRole('button', { name: 'short-cue.wav', exact: true });
  await expect(audioTrack).toBeVisible();
  await audioTrack.click();
  const audioEnd = page.getByRole('spinbutton', { name: 'Audio end position' });
  await expect.poll(async () => Number(await audioEnd.inputValue())).toBeCloseTo(.5,1);
  await audioEnd.fill('0.3');
  await expect(page.getByText('Duration · 0.3 seconds')).toBeVisible();
  await page.getByRole('slider', { name: 'Audio fade in' }).fill('0.3');
  await page.getByRole('slider', { name: 'Audio fade out' }).fill('0.3');
  await expect(page.getByRole('slider', { name: 'Audio fade in' })).toHaveValue('0.3');
  await expect(page.getByRole('slider', { name: 'Audio fade out' })).toHaveValue('0.3');
  await page.getByRole('button', { name: 'Render video' }).click();
  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect(preview.locator('video')).toHaveAttribute('controls', '');
  await expect.poll(async () => preview.locator('video').evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(1080);
  await expect.poll(async () => preview.locator('video').evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(1080);
});

test('audio timeline selects and moves a 35–95 second range from a 125-second track', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('60');
  await page.getByRole('complementary', { name: 'Pages' }).getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('60');
  await page.getByRole('button', { name: 'Audio' }).click();
  await page.getByLabel('Import audio').setInputFiles({
    name: 'full-track.wav', mimeType: 'audio/wav', buffer: makeSilentWav(125),
  });
  const audioTrack = page.getByRole('button', { name: 'full-track.wav', exact: true });
  await expect(audioTrack).toBeVisible();
  await audioTrack.click();
  const start = page.getByRole('spinbutton', { name: 'Audio start position' });
  const end = page.getByRole('spinbutton', { name: 'Audio end position' });
  await start.fill('35');
  await end.fill('95');
  await expect.poll(async () => Number(await start.inputValue())).toBe(35);
  await expect.poll(async () => Number(await end.inputValue())).toBe(95);
  await expect(page.getByText('Duration · 60.0 seconds')).toBeVisible();

  const startHandle = page.getByRole('button', { name: 'Audio trim start' });
  const startBox = await startHandle.boundingBox();
  if (!startBox) throw new Error('Audio start trim handle was not visible.');
  await page.mouse.move(startBox.x + startBox.width/2, startBox.y + startBox.height/2);
  await page.mouse.down();
  await page.mouse.move(startBox.x + startBox.width/2 + 10, startBox.y + startBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await start.inputValue())).toBeGreaterThan(35);
  await expect.poll(async () => Number(await end.inputValue())).toBeCloseTo(95, 0);

  const startAfterTrim = Number(await start.inputValue());
  const endHandle = page.getByRole('button', { name: 'Audio trim end' });
  const endBox = await endHandle.boundingBox();
  if (!endBox) throw new Error('Audio end trim handle was not visible.');
  await page.mouse.move(endBox.x + endBox.width/2, endBox.y + endBox.height/2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width/2 - 10, endBox.y + endBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await start.inputValue())).toBeCloseTo(startAfterTrim, 0);
  await expect.poll(async () => Number(await end.inputValue())).toBeLessThan(95);

  const selectedRange = page.getByRole('group', { name: 'Audio trim range' }).locator('span').nth(1);
  const rangeBox = await selectedRange.boundingBox();
  if (!rangeBox) throw new Error('Audio selected-range body was not visible.');
  await page.mouse.move(rangeBox.x + rangeBox.width/2, rangeBox.y + rangeBox.height/2);
  await page.mouse.down();
  await page.mouse.move(rangeBox.x + rangeBox.width/2 - 12, rangeBox.y + rangeBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await start.inputValue())).toBeLessThan(35);
  await expect.poll(async () => Number(await end.inputValue())).toBeLessThan(95);

  const beforeStartTrim = Number(await start.inputValue());
  const beforeEndTrim = Number(await end.inputValue());
  const independentStartHandle = page.getByRole('button', { name: 'Audio trim start' });
  const independentStartHandleBox = await independentStartHandle.boundingBox();
  if (!independentStartHandleBox) throw new Error('Audio start trim handle is not visible.');
  await page.mouse.move(independentStartHandleBox.x + independentStartHandleBox.width/2, independentStartHandleBox.y + independentStartHandleBox.height/2);
  await page.mouse.down();
  await page.mouse.move(independentStartHandleBox.x + independentStartHandleBox.width/2 + 12, independentStartHandleBox.y + independentStartHandleBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await start.inputValue())).toBeGreaterThan(beforeStartTrim);
  await expect.poll(async () => Number(await end.inputValue())).toBeCloseTo(beforeEndTrim, 1);

  const afterStartTrim = Number(await start.inputValue());
  const beforeEndHandle = Number(await end.inputValue());
  const independentEndHandle = page.getByRole('button', { name: 'Audio trim end' });
  const independentEndHandleBox = await independentEndHandle.boundingBox();
  if (!independentEndHandleBox) throw new Error('Audio end trim handle is not visible.');
  await page.mouse.move(independentEndHandleBox.x + independentEndHandleBox.width/2, independentEndHandleBox.y + independentEndHandleBox.height/2);
  await page.mouse.down();
  await page.mouse.move(independentEndHandleBox.x + independentEndHandleBox.width/2 + 12, independentEndHandleBox.y + independentEndHandleBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await end.inputValue())).toBeGreaterThan(beforeEndHandle);
  await expect.poll(async () => Number(await start.inputValue())).toBeCloseTo(afterStartTrim, 1);

  await page.getByRole('slider', { name: 'Audio volume' }).fill('65');
  await page.getByRole('slider', { name: 'Audio fade in' }).fill('0.8');
  await page.getByRole('slider', { name: 'Audio fade out' }).fill('1.1');
  await expect(page.getByRole('slider', { name: 'Audio volume' })).toHaveValue('65');
  await expect(page.getByRole('slider', { name: 'Audio fade in' })).toHaveValue('0.8');
  await expect(page.getByRole('slider', { name: 'Audio fade out' })).toHaveValue('1.1');
});

test('fade transition blends the timeline preview and the rendered video consistently', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('2');
  await page.getByRole('complementary', { name: 'Pages' }).getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('2');

  const setBackground = async (colour: string) => {
    await page.getByRole('button', { name: 'Brand' }).click();
    await page.getByLabel('Page background').evaluate((element, value) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Native colour input setter is unavailable.');
      setter.call(input, value as string);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, colour);
    await expect(page.getByLabel('Page background')).toHaveValue(colour);
  };
  await setBackground('#0000ff');
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('button', { name: /1 Page 1/ }).click();
  await setBackground('#ff0000');
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('combobox', { name: 'Transition after page 1' }).selectOption('fade');
  await page.getByRole('spinbutton', { name: 'Fade duration after page 1' }).fill('1.5');

  const playhead = page.getByRole('slider', { name: 'Timeline playhead' });
  await playhead.focus();
  for (let i = 0; i < 12; i += 1) await playhead.press('ArrowRight');
  await expect(playhead).toHaveValue('1.2');
  const timelineCanvas = page.locator('canvas[aria-label="Timeline preview"]');
  await expect(timelineCanvas).toBeVisible();
  const readPreviewPixel = () => timelineCanvas.evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context) throw new Error('Timeline preview canvas is unavailable.');
    const pixel = context.getImageData(Math.floor(element.width/2), Math.floor(element.height/2), 1, 1).data;
    return [pixel[0], pixel[1], pixel[2]];
  });
  await expect.poll(async () => { const pixel = await readPreviewPixel(); return pixel[0] > 30 && pixel[2] > 30 && pixel[1] < 50; }).toBe(true);

  await page.getByRole('button', { name: 'Render video' }).click();
  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(preview).toBeVisible({ timeout: 30000 });
  const video = preview.locator('video');
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(1080);
  await video.evaluate(element => new Promise<void>((resolve, reject) => {
    const output = element as HTMLVideoElement;
    const timeout = window.setTimeout(() => reject(new Error('Rendered video seek timed out.')), 10000);
    output.addEventListener('seeked', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    output.currentTime = 1.2;
  }));
  const renderedPixel = await video.evaluate(element => {
    const output = element as HTMLVideoElement;
    const canvas = document.createElement('canvas');
    canvas.width = output.videoWidth; canvas.height = output.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Rendered video frame canvas is unavailable.');
    context.drawImage(output, 0, 0);
    const pixel = context.getImageData(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1).data;
    return [pixel[0], pixel[1], pixel[2]];
  });
  expect(renderedPixel[0]).toBeGreaterThan(30);
  expect(renderedPixel[2]).toBeGreaterThan(30);
  expect(renderedPixel[1]).toBeLessThan(80);
});

test('publishing caption and hashtags live in the dedicated Publishing tool', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Publishing', exact: true }).click();
  await page.getByLabel('Publishing caption').fill('Launch day at Lucky Bajaj.');
  await page.getByLabel('Publishing hashtags').fill('#LuckyBajaj #RideOn');
  await expect(page.getByLabel('Publishing caption')).toHaveValue('Launch day at Lucky Bajaj.');
  await expect(page.getByLabel('Publishing hashtags')).toHaveValue('#LuckyBajaj #RideOn');
  await page.getByRole('button', { name: 'Back to resources' }).click();
  await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();
});


test('Meta connection requires explicit consent and cancellation never starts OAuth', async ({ page }) => {
  const connectRequests: string[] = [];
  await page.route('**/api/v1/admin/social/meta/connect', async (route) => {
    connectRequests.push(route.request().method());
    const origin = new URL(route.request().url()).origin;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authorizationUrl: origin + '/meta-oauth-consent-test' }) });
  });
  await page.route('**/meta-oauth-consent-test', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Meta authorization handoff test</title>' }));

  await openNewStudio(page);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  await expect(connect).toBeVisible();

  await connect.click();
  const consent = page.getByRole('dialog', { name: 'Connect Facebook and Instagram?' });
  await expect(consent).toBeVisible();
  await expect(consent).toContainText('Meta will show the exact permissions requested');
  await expect(consent).toContainText('Connecting an account does not publish anything');
  const notNow = consent.getByRole('button', { name: 'Not now' });
  const continueToMeta = consent.getByRole('button', { name: 'Continue to Meta' });
  await expect(notNow).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  expect(connectRequests).toHaveLength(0);

  await page.keyboard.press('Shift+Tab');
  await expect(continueToMeta).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(notNow).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(consent).toHaveCount(0);
  await expect(connect).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  expect(connectRequests).toHaveLength(0);

  await connect.click();
  await page.getByRole('dialog', { name: 'Connect Facebook and Instagram?' }).getByRole('button', { name: 'Not now' }).click();
  await expect(consent).toHaveCount(0);
  expect(connectRequests).toHaveLength(0);

  await connect.click();
  await page.getByRole('dialog', { name: 'Connect Facebook and Instagram?' }).getByRole('button', { name: 'Continue to Meta' }).click();
  await page.waitForURL('**/meta-oauth-consent-test');
  expect(connectRequests).toEqual(['POST']);
});

test('video output uses an explicitly selected browser-supported codec', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Resize' }).click();
  const format = page.getByRole('combobox', { name: 'Video output format' });
  const webmSupported = await format.locator('option[value="webm"]').isEnabled();
  const mp4Supported = await format.locator('option[value="mp4"]').isEnabled();
  const requestedFormat = webmSupported ? 'webm' : mp4Supported ? 'mp4' : 'auto';
  if (requestedFormat !== 'auto') await format.selectOption(requestedFormat);
  await expect(format).toHaveValue(requestedFormat);

  await page.getByRole('button', { name: 'Render video' }).click();
  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(preview).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Close video preview' }).click();

  await page.getByRole('button', { name: 'Download rendered outputs' }).click();
  const renderedFormat = (await page.getByRole('combobox', { name: 'Video format' }).locator('option').textContent() ?? '').toLowerCase();
  const actualExtension = renderedFormat.includes('mp4') ? 'mp4' : 'webm';
  if (requestedFormat !== 'auto') expect(actualExtension).toBe(requestedFormat);
  await page.getByRole('button', { name: 'Close download dialog' }).click();

  await page.getByRole('button', { name: 'Back to resources' }).click();
  await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();
  const outputName = 'untitled-design-video.' + actualExtension;
  const outputCard = page.locator('[data-testid="studio-resource-card"]').filter({ hasText: outputName }).first();
  await expect(outputCard).toBeVisible();
  const download = page.waitForEvent('download');
  await outputCard.getByRole('button', { name: 'Download ' + outputName }).click();
  expect((await download).suggestedFilename()).toBe(outputName);
});

test('mixed-size scenes use the selected page as the deliberate video output frame', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('1');
  await page.getByRole('complementary', { name: 'Pages' }).getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('spinbutton', { name: 'Selected scene duration' }).fill('1');
  await page.getByRole('button', { name: 'Resize' }).click();
  await page.getByRole('button', { name: 'Landscape feed' }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 566');

  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await page.getByRole('button', { name: 'Render video' }).click();
  await expect(preview).toBeVisible({ timeout: 30000 });
  const video = preview.locator('video');
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(1080);
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(566);
  await page.getByRole('button', { name: 'Close video preview' }).click();

  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('button', { name: /1 Page 1/ }).click();
  await expect(page.getByTestId('active-page-size')).toHaveText('1080 × 1080');
  await page.getByRole('button', { name: 'Render video' }).click();
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(1080);
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(1080);
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

test('uploaded video media becomes a timed, selectable timeline clip', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Uploads' }).click();
  await page.getByLabel('Import media').setInputFiles({
    name: 'scene-video.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAPREU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggO77AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIBQqxoaDkAoicgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgTC6gTCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WIBQqxoaDkAohnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QhLngQCjwYEAAIBwAwCdASowADAAAEcIhYWImYSIAgICdaoD+AP6AgdqCOecuLQA/v1u8//kb+PnRv/I4//8Sp7jieP//EaAo7KBAGQAMQIABRCsABgMUUvbO5RwHhcckwD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQDIABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQEsABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQGQABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQH0ABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQJYABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQK8ABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOxgQMgABECAAUQrAAYACBP9AwAUJDzRAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agABxTu2uRu4+zgQC3iveBAfGCAaPwgQM=', 'base64'),
  });
  const videoAsset = page.getByRole('button', { name: /scene-video\.webm/ });
  await expect(videoAsset).toBeVisible();
  await videoAsset.click();
  await expect(page.getByRole('button', { name: 'Select timeline video clip scene-video.webm', exact: true })).toBeVisible();
  const clipDuration = page.getByRole('spinbutton', { name: 'Video clip duration' });
  await expect(clipDuration).toBeVisible();
  const initialDuration = Number(await clipDuration.inputValue());
  const trimEndHandle = page.getByRole('button', { name: 'Trim end of scene-video.webm' });
  const trimBox = await trimEndHandle.boundingBox();
  if (!trimBox) throw new Error('Video clip end handle is not visible.');
  await page.mouse.move(trimBox.x + trimBox.width/2, trimBox.y + trimBox.height/2);
  await page.mouse.down();
  await page.mouse.move(trimBox.x - 30, trimBox.y + trimBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await clipDuration.inputValue())).toBeLessThan(initialDuration);
  const sourceInPoint = page.getByRole('spinbutton', { name: 'Video source in point' });
  const originalSourceInPoint = Number(await sourceInPoint.inputValue());
  const trimStartHandle = page.getByRole('button', { name: 'Trim start of scene-video.webm' });
  const startBox = await trimStartHandle.boundingBox();
  if (!startBox) throw new Error('Video clip start handle was not visible.');
  await page.mouse.move(startBox.x + startBox.width/2, startBox.y + startBox.height/2);
  await page.mouse.down();
  await page.mouse.move(startBox.x + startBox.width + 25, startBox.y + startBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await sourceInPoint.inputValue())).toBeGreaterThan(originalSourceInPoint);
  const initialStart = Number(await page.getByRole('spinbutton', { name: 'Video clip start' }).inputValue());
  const clipBody = page.getByRole('button', { name: 'Select timeline video clip scene-video.webm', exact: true });
  const bodyBox = await clipBody.boundingBox();
  if (!bodyBox) throw new Error('Video clip body is not visible.');
  await page.mouse.move(bodyBox.x + bodyBox.width/2, bodyBox.y + bodyBox.height/2);
  await page.mouse.down();
  await page.mouse.move(bodyBox.x + bodyBox.width/2 + 30, bodyBox.y + bodyBox.height/2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Video clip start' }).inputValue())).toBeGreaterThan(initialStart);
  await page.getByRole('button', { name: 'Render photo' }).click();
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled({ timeout: 30000 });
});
