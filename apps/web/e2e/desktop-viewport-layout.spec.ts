import { expect, test } from './fixtures/coverage-test';

const viewports = [
  { width: 1000, height: 680 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

test('Tauri desktop keeps the app frame fixed and scrolls the workspace and sidebar independently', async ({ page }) => {
  await page.setViewportSize(viewports[0]);
  await page.addInitScript(() => {
    // Set auth before application startup; documentElement may not exist at init-script time.
    window.sessionStorage.setItem('qe_staff_token', 'desktop-viewport-e2e-session');
  });

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path.endsWith('/auth/staff/me')
      ? {
          staffPublicId: 'DESKTOP-E2E-STAFF',
          fullName: 'Desktop Layout Test',
          dealershipPublicId: 'DESKTOP-E2E-DEALERSHIP',
          dealershipCode: 'LBA',
          roles: ['OWNER'],
          permissions: [],
        }
      : path.endsWith('/system/health')
        ? { status: 'UP', service: 'bajaj-api', version: 'e2e', timestamp: '2026-10-30T00:00:00Z' }
        : path.endsWith('/system/license/status')
          ? { state: 'ACTIVE', daysUntilExpiry: 30 }
          : {};

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('html').evaluate((element) => element.classList.add('tauri-desktop'));

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.app-shell')!;
      const sidebar = document.querySelector<HTMLElement>('.app-shell > .sidebar')!;
      const main = document.querySelector<HTMLElement>('.main-content')!;
      const topbar = document.querySelector<HTMLElement>('.main-content > .topbar')!;
      const workspace = document.querySelector<HTMLElement>('.main-content > .page-wrap')!;
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        shell: shell.getBoundingClientRect().toJSON(),
        sidebar: sidebar.getBoundingClientRect().toJSON(),
        main: main.getBoundingClientRect().toJSON(),
        topbar: topbar.getBoundingClientRect().toJSON(),
        workspace: workspace.getBoundingClientRect().toJSON(),
        documentOverflowX: getComputedStyle(document.documentElement).overflowX,
        documentOverflowY: getComputedStyle(document.documentElement).overflowY,
        workspaceOverflowX: getComputedStyle(workspace).overflowX,
      topbarTop: document.querySelector<HTMLElement>('.main-content > .topbar')!.getBoundingClientRect().top,
        workspaceOverflowY: getComputedStyle(workspace).overflowY,
      };
    });

    expect(geometry.shell.x).toBe(0);
    expect(geometry.shell.y).toBe(0);
    expect(geometry.shell.width).toBe(viewport.width);
    expect(geometry.shell.height).toBe(viewport.height);
    expect(geometry.sidebar.height).toBe(viewport.height);
    expect(geometry.main.height).toBe(viewport.height);
    expect(geometry.topbar.y).toBe(0);
    expect(geometry.workspace.y).toBe(geometry.topbar.y + geometry.topbar.height);
    expect(geometry.main.x).toBe(geometry.sidebar.x + geometry.sidebar.width);
    expect(geometry.main.x + geometry.main.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(geometry.workspaceOverflowX).toBe('hidden');
    expect(geometry.workspaceOverflowY).toBe('auto');
    expect(geometry.documentOverflowX).toBe('hidden');
    expect(geometry.documentOverflowY).toBe('hidden');
  }

  const scrollState = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('.app-shell > .sidebar')!;
    const workspace = document.querySelector<HTMLElement>('.main-content > .page-wrap')!;

    const sidebarSpacer = document.createElement('div');
    sidebarSpacer.style.cssText = 'height: 1600px; flex: 0 0 1600px; width: 100%;';
    sidebar.append(sidebarSpacer);

    const workspaceSpacer = document.createElement('div');
    workspaceSpacer.style.cssText = 'height: 1800px; width: 1800px; flex: 0 0 auto;';
    workspace.append(workspaceSpacer);

    sidebar.scrollTop = 210;
    workspace.scrollTop = 310;
    window.scrollTo(500, 500);

    return {
      sidebarTop: sidebar.scrollTop,
      workspaceTop: workspace.scrollTop,
      windowX: window.scrollX,
      windowY: window.scrollY,
      sidebarCanScroll: sidebar.scrollHeight > sidebar.clientHeight,
      workspaceCanScroll: workspace.scrollHeight > workspace.clientHeight,
      workspaceOverflowX: getComputedStyle(workspace).overflowX,
      topbarTop: document.querySelector<HTMLElement>('.main-content > .topbar')!.getBoundingClientRect().top,
    };
  });

  expect(scrollState.sidebarCanScroll).toBe(true);
  expect(scrollState.workspaceCanScroll).toBe(true);
  expect(scrollState.sidebarTop).toBe(210);
  expect(scrollState.workspaceTop).toBe(310);
  expect(scrollState.windowX).toBe(0);
  expect(scrollState.windowY).toBe(0);
  expect(scrollState.workspaceOverflowX).toBe('hidden');
  expect(scrollState.topbarTop).toBe(0);
});
