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
  await page.getByRole('combobox', { name: 'Transition after page 1' }).selectOption('fade');
  await page.getByRole('spinbutton', { name: 'Fade duration after page 1' }).fill('1.5');
  await expect(page.getByRole('spinbutton', { name: 'Fade duration after page 1' })).toHaveValue('1.5');
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

test('renders a short promotional video, previews it in the editor and does not auto-download', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Render video' }).click();
  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled({ timeout: 30000 });
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect(preview.locator('video')).toHaveAttribute('controls', '');
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close video preview' }).click();
  await expect(page.getByRole('dialog', { name: 'Creative editor' })).toBeVisible();
});

test('renders a photo first, then downloads it only after an explicit choice', async ({ page }) => {
  await openNewStudio(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('button', { name: 'Headline' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Lucky Bajaj creative export');
  await page.getByRole('button', { name: 'Render photo' }).click();
  await expect(page.getByRole('button', { name: 'Download rendered outputs' })).toBeEnabled({ timeout: 15000 });
  await page.getByRole('button', { name: 'Download rendered outputs' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download selected' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('button', { name: 'Back to resources' }).click();
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
  await page.getByRole('button', { name: 'Layers' }).click();
  await page.getByRole('textbox', { name: 'Search tool resources' }).fill('offer');
  await expect(page.getByRole('button', { name: 'Offer badge', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock layer' }).click();
  await expect(page.getByText('This layer is locked. Unlock it in Layers to edit.')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'X' })).toBeDisabled();
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
test('brand logo picker imports and inserts the selected image once', async ({ page }) => {
  await openNewStudio(page); await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'Brand'}).click();
  await page.locator('input[aria-label="Upload brand logo or image"]').setInputFiles({name:'brand-logo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=','base64')});
  await expect(page.getByRole('img',{name:'Editable design canvas'}).locator('image')).toHaveCount(1);
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
    name: 'short-cue.wav', mimeType: 'audio/wav', buffer: makeSilentWav(2),
  });
  const audioTrack = page.getByRole('button', { name: /short-cue\.wav/ });
  await expect(audioTrack).toBeVisible();
  await audioTrack.click();
  const audioEnd = page.getByRole('spinbutton', { name: 'Audio end position' });
  await expect.poll(async () => audioEnd.inputValue()).toBe('2');
  await audioEnd.fill('1.5');
  await expect(page.getByText('Duration · 1.5 seconds')).toBeVisible();
  await page.getByRole('button', { name: 'Render video' }).click();
  const preview = page.getByRole('dialog', { name: 'Rendered video preview' });
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect(preview.locator('video')).toHaveAttribute('controls', '');
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
