import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const FIXTURE = resolve(__dirname, 'fixtures/design-375.png');

/**
 * The mandatory acceptance scenario from spec section 29, walked end to end in
 * a real browser against the real API.
 */
test.describe('acceptance scenario', () => {
  test('upload → render → compare → inspect → validate → export', async ({ page }) => {
    await page.goto('/');

    // 1. Designer uploads a 375px-wide mobile design with a long vertical page.
    await page.setInputFiles('input[type="file"]', FIXTURE);

    // 2-3. The source is preserved and its real dimensions are reported.
    const summary = page.getByText('Source preserved');
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('375x813 logical')).toBeVisible();
    await expect(page.getByText('scroll height 2400px')).toBeVisible();

    // 4-6. A default device profile opens immediately and the design renders
    // inside its viewport without being redesigned.
    const firstPreview = page.getByTestId('design-viewport').first();
    await expect(firstPreview).toBeVisible();
    await expect(page.getByTestId('status-bar').first()).toBeVisible();

    // 4. Select an iPhone 17-class target.
    await selectDevice(page, 'iPhone 17 Pro');
    await expect(page.getByText('iPhone 17 Pro').first()).toBeVisible();

    // 5. Phone chrome is rendered from device data.
    await expect(page.getByTestId('cutout').first()).toHaveAttribute('data-cutout', 'dynamic-island');
    await expect(page.getByTestId('home-indicator').first()).toBeVisible();

    // 7-8. Add a Google Pixel target; two phones appear side by side.
    await page.getByRole('button', { name: 'Add another device preview' }).click();
    await selectDevice(page, 'Google Pixel 8');
    await expect(page.getByTestId('design-viewport')).toHaveCount(2);
    await expect(page.getByText(/Comparing 2 devices/)).toBeVisible();

    // Each phone uses its own profile and platform chrome.
    await expect(page.getByTestId('android-navigation')).toBeVisible();

    // 10. Scrolling works, and the full document is reachable - not cropped.
    const viewports = page.getByTestId('design-viewport');
    await viewports.first().evaluate((element) => {
      element.scrollTop = 900;
    });
    await expect
      .poll(async () => viewports.first().evaluate((element) => element.scrollTop))
      .toBeGreaterThan(500);
    const scrollHeight = await viewports.first().evaluate((element) => element.scrollHeight);
    expect(scrollHeight).toBeGreaterThan(2400);

    // 14-15. Validation runs automatically and explains its findings.
    const panel = page.getByRole('region', { name: 'Validation summary' });
    await expect(panel.getByText(/Passed|Failed/)).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: /iPhone|Pixel/ }).click();

    // 16. Both passes are recorded, the second over the final result.
    await panel.getByRole('tab', { name: /Passes/ }).click();
    await expect(panel.getByText(/^Pass 1/)).toBeVisible();
    await expect(panel.getByText(/^Pass 2/)).toBeVisible();

    // Limitations are stated rather than hidden.
    await panel.getByRole('tab', { name: /Limitations/ }).click();
    await expect(panel.getByText(/not a physical device/)).toBeVisible();
  });

  test('Dev Mode inspects measurements without altering the design', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 30_000 });

    const design = page.getByTestId('design-document').first();
    const before = await design.evaluate((element) => element.getBoundingClientRect().width);

    // 11. Dev Mode is off by default and opt-in.
    const devToggle = page.getByLabel('Dev Mode');
    await expect(devToggle).not.toBeChecked();
    await devToggle.check();

    // 12. Tapping an element shows its measurements.
    await design.locator('[data-node-id]').first().click();
    const inspector = page.getByRole('button', { name: /^Box/ });
    await expect(inspector).toBeVisible();
    await expect(page.getByText('width', { exact: true })).toBeVisible();
    await expect(page.getByText('height', { exact: true })).toBeVisible();

    // 13. Sections expand and collapse like a code/measurement panel.
    await page.getByRole('button', { name: /^Source/ }).click();
    await expect(page.getByText('source-node-id', { exact: true })).toBeVisible();
    await expect(page.getByText('provenance', { exact: true })).toBeVisible();

    // Inspecting must not change the design.
    const after = await design.evaluate((element) => element.getBoundingClientRect().width);
    expect(after).toBe(before);
  });

  test('chrome layers toggle without touching the design layer', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 30_000 });

    const design = page.getByTestId('design-document').first();
    const geometryBefore = await design.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });

    // 13 (spec section 12). Every chrome control is an independent layer.
    await expect(page.getByTestId('status-bar').first()).toBeVisible();
    await page.getByLabel('Status bar').uncheck();
    await expect(page.getByTestId('status-bar')).toHaveCount(0);

    await page.getByLabel('Safe-area overlay').check();
    await expect(page.getByText(/source reserves/).first()).toBeVisible();

    const geometryAfter = await design.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    expect(geometryAfter).toEqual(geometryBefore);
  });
});

async function selectDevice(page: Page, name: string): Promise<void> {
  const explorer = page.getByRole('complementary', { name: 'Device explorer' });
  await explorer.getByLabel('Search devices').fill(name);
  await explorer.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await explorer.getByLabel('Search devices').fill('');
}
