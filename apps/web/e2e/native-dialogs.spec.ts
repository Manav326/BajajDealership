import { expect, test } from './fixtures/coverage-test';

test('desktop staff and customer portal use branded dialogs instead of browser-native dialogs', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    nativeDialogs.push(dialog.type() + ': ' + dialog.message());
    await dialog.dismiss();
  });

  await page.goto('/');
  const confirmResult = page.evaluate(async (moduleUrl) => {
    const { appConfirm } = await import(/* @vite-ignore */ moduleUrl);
    return appConfirm('Remove this uploaded catalogue image?', {
      title: 'Remove catalogue image?',
      confirmLabel: 'Remove',
      danger: true,
    });
  }, '/src/dialogs/dialogService.ts');

  const confirmDialog = page.getByRole('dialog', { name: 'Remove catalogue image?' });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText('Remove this uploaded catalogue image?');
  await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await confirmResult).toBe(false);

  const promptResult = page.evaluate(async (moduleUrl) => {
    const { appPrompt } = await import(/* @vite-ignore */ moduleUrl);
    return appPrompt('Enter a reason for this change.', {
      title: 'Device change reason',
      inputLabel: 'Reason',
      placeholder: 'Enter at least four characters',
      multiline: true,
      minLength: 4,
      confirmLabel: 'Continue',
    });
  }, '/src/dialogs/dialogService.ts');

  const promptDialog = page.getByRole('dialog', { name: 'Device change reason' });
  await expect(promptDialog).toBeVisible();
  await promptDialog.getByLabel('Reason').fill('Verified by owner');
  await promptDialog.getByRole('button', { name: 'Continue' }).click();
  expect(await promptResult).toBe('Verified by owner');

  await page.goto('http://127.0.0.1:4173/');
  const alertResult = page.evaluate(async (moduleUrl) => {
    const { appAlert } = await import(/* @vite-ignore */ moduleUrl);
    return appAlert('Allow pop-ups to print or save this document as a PDF.', 'Printing unavailable');
  }, '/src/dialogService.ts');

  const alertDialog = page.getByRole('dialog', { name: 'Printing unavailable' });
  await expect(alertDialog).toBeVisible();
  await alertDialog.getByRole('button', { name: 'Okay' }).click();
  expect(await alertResult).toBeUndefined();
  expect(nativeDialogs).toEqual([]);
});
