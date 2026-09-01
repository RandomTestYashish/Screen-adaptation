import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const FIXTURE = resolve(__dirname, 'fixtures/design-375.png');

/**
 * Automated accessibility checks against the live UI (spec sections 17 and 26).
 *
 * The rendered *design* is excluded from the scan: it is the user's artwork,
 * and its contrast and structure are the designer's decisions. The validation
 * engine reports on those separately; flagging them here would confuse a
 * finding about the product with a finding about the design.
 */
async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="design-document"]')
    .exclude('[data-testid="fixed-layer"]')
    .analyze();
}

test.describe('accessibility', () => {
  test('the upload screen has no violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Upload a design export' })).toBeVisible();
    const results = await scan(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('the workspace has no violations', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 30_000 });
    const results = await scan(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('the expanded validation panel has no violations', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    const panel = page.getByRole('region', { name: 'Validation summary' });
    await expect(panel.getByText(/Passed|Failed/)).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: /iPhone|Pixel/ }).click();
    await expect(panel.getByRole('tab', { name: /Render metadata/ })).toBeVisible();
    const results = await scan(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('Dev Mode is fully usable from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 30_000 });

    // Spec section 26: "Make Dev Mode usable without a mouse."
    await page.getByLabel('Dev Mode').focus();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Dev Mode')).toBeChecked();

    const node = page.locator('[data-testid="design-document"] [data-node-id]').first();
    await node.focus();
    await expect(node).toBeFocused();
    await page.keyboard.press('Enter');

    // Selecting via the keyboard opens the same inspector a click would.
    await expect(page.getByRole('button', { name: /^Box/ })).toBeVisible();
    const results = await scan(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });
});

function formatViolations(violations: { id: string; help: string; nodes: { target: unknown[] }[] }[]): string {
  if (violations.length === 0) return 'no violations';
  return violations
    .map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => JSON.stringify(n.target)).join('\n  ')}`)
    .join('\n\n');
}
