import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const FIXTURE = resolve(__dirname, 'fixtures/design-375.png');

/**
 * The critical acceptance test from enhancement spec section 55, walked end to
 * end in a real browser against the real API.
 *
 * The enhancement is explicitly not complete until this passes, so it is
 * written as one continuous scenario in the order the spec states it rather
 * than as isolated unit-style cases: several steps only mean anything relative
 * to the state the previous step left behind.
 */
test.describe('critical acceptance test (V2)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a screenshot adapts by viewport, not by scaling', async ({ page, context }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    // 1. Upload a PNG screenshot.
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 60_000 });

    // 2. The source is untouched and stays the reference.
    await expect(page.getByText('375x2400 logical')).toBeVisible();
    await expect(page.getByText(/immutable|preserved/i).first()).toBeVisible();

    // 3. Design DNA is extracted from the pixels and shown as measured tokens.
    const sidebar = page.getByRole('complementary', { name: 'Source' });
    await expect(sidebar.getByRole('button', { name: /Design system/ })).toBeVisible();
    await expect(sidebar.getByText('Colours')).toBeVisible();
    await expect(sidebar.getByText('Type scale')).toBeVisible();
    // Nothing is fabricated: a bitmap cannot name its own font.
    await expect(sidebar.getByText('unknowable from a bitmap')).toBeVisible();

    // 4-5. Components are identified, and what could not be reconstructed is
    // preserved as original pixels rather than invented.
    await page.getByLabel('AI', { exact: true }).check();
    const ai = page.getByTestId('reconstruction-panel');
    await expect(ai).toBeVisible();
    // Both strategies are in play: this is the hybrid result section 8 asks
    // for, not an all-or-nothing choice.
    await expect(ai.locator('[data-strategy="PRESERVE_RASTER"]')).toBeVisible();
    await expect(ai.locator('[data-strategy="RECONSTRUCT"]')).toBeVisible();
    await expect(ai.getByText(/could not describe confidently keeps/)).toBeVisible();
    await page.getByLabel('AI', { exact: true }).uncheck();

    // 6-7. Reconstructed regions are inspectable: typography and spacing are
    // reported as measurements, not as guesses.
    await page.getByLabel('Dev', { exact: true }).check();
    const firstPane = page.locator('[data-pane-id]').first();
    await firstPane.getByTestId('design-document').locator('[data-node-id]').first().click();
    await expect(page.getByRole('button', { name: /^Box/ })).toBeVisible();
    await expect(page.getByText('width', { exact: true })).toBeVisible();
    await page.getByLabel('Dev', { exact: true }).uncheck();

    // 8. The reconstruction is a parallel representation; the original bitmap
    // is still what the renderer draws for unreconstructable regions.
    const crops = await firstPane.getByTestId('design-document').locator('img').count();
    expect(crops).toBeGreaterThan(0);

    // --- The heart of the test: viewport, not scale -------------------------

    // 9-10. A larger iPhone shows MORE of the page; a smaller one shows LESS.
    await selectDevice(page, 'iPhone 16 Pro Max');
    const large = await paneFacts(firstPane);

    await selectDevice(page, 'iPhone SE');
    const small = await paneFacts(firstPane);

    expect(large.viewportHeight).toBeGreaterThan(small.viewportHeight);
    expect(large.visibleFraction).toBeGreaterThan(small.visibleFraction);

    // 11. The font does NOT shrink. This is the failure the enhancement exists
    // to remove. The document fills each viewport at its own width - it is not
    // a 375px artboard scaled to fit - and every element keeps its height.
    expect(small.documentWidth).toBe(small.viewportWidth);
    expect(large.documentWidth).toBe(large.viewportWidth);
    expect(large.documentWidth).toBeGreaterThan(small.documentWidth);
    expect(small.scale).toBe(1);
    expect(large.scale).toBe(1);
    // Compare element for element on the nodes both devices have rendered. The
    // taller viewport renders *more* of them - that is the point of the test -
    // so the sets differ in size while every shared element keeps its height.
    const shared = sharedHeights(small.textHeights, large.textHeights);
    expect(shared.count).toBeGreaterThan(0);
    expect(shared.small).toEqual(shared.large);

    // 12. The page stays scrollable to its full length on both, and its length
    // does not track the viewport width. A design scaled to fit a 440px device
    // would be ~17% taller than on a 375px one; the difference here is only the
    // extra safe-area clearance the taller device needs.
    expect(small.scrollHeight).toBeGreaterThan(small.viewportHeight);
    expect(large.scrollHeight).toBeGreaterThan(large.viewportHeight);
    expect(large.scrollHeight).toBeLessThan(small.scrollHeight * 1.05);
    expect(Math.abs(large.scrollHeight - small.scrollHeight)).toBeLessThan(120);

    // 13. Device chrome changes with the device, and is a separate layer.
    await selectDevice(page, 'iPhone 16 Pro Max');
    await expect(firstPane.getByTestId('cutout')).toHaveAttribute('data-cutout', 'dynamic-island');
    await expect(firstPane.getByTestId('home-indicator')).toBeVisible();

    // 14. A Pixel brings its own viewport, safe area and platform chrome.
    await selectDevice(page, 'Google Pixel 8');
    await expect(firstPane.getByTestId('android-navigation')).toBeVisible();
    const pixel = await paneFacts(firstPane);
    expect(pixel.scale).toBe(1);
    expect(pixel.documentWidth).toBe(pixel.viewportWidth);

    // --- Comparison ---------------------------------------------------------

    // 15. Add a second device.
    await page.getByRole('button', { name: 'Add another device preview' }).click();
    await selectDevice(page, 'iPhone 16 Pro Max');
    const panes = page.locator('[data-pane-id]');
    await expect(panes).toHaveCount(2);

    // 16. Both are neutral: adding B does not select it.
    await expect(page.locator('[data-pane-id][data-active="true"]')).toHaveCount(0);

    // 17. Selecting A highlights only A.
    await panes.first().click();
    await expect(page.locator('[data-pane-id][data-active="true"]')).toHaveCount(1);
    await expect(panes.first()).toHaveAttribute('data-active', 'true');

    // 18. Tapping blank canvas returns both to neutral.
    await page.getByRole('main').click({ position: { x: 8, y: 8 } });
    await expect(page.locator('[data-pane-id][data-active="true"]')).toHaveCount(0);

    // 19-20. Linked scroll moves both by normalized progress, not raw pixels.
    await page.getByLabel('Link scroll').check();
    const viewports = page.getByTestId('design-viewport');
    await viewports.first().evaluate((element) => {
      element.scrollTop = element.scrollHeight * 0.4;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await expect
      .poll(async () => {
        const progress = await viewports.evaluateAll((elements) =>
          elements.map((element) => {
            const extent = element.scrollHeight - element.clientHeight;
            return extent > 0 ? element.scrollTop / extent : 0;
          }),
        );
        // Same point in the page on both, even though the documents differ in
        // height and the viewports differ in height.
        return Math.abs((progress[0] ?? 0) - (progress[1] ?? 0));
      }, { timeout: 15_000 })
      .toBeLessThan(0.05);

    const rawScrollTops = await viewports.evaluateAll((elements) => elements.map((e) => e.scrollTop));
    expect(rawScrollTops[0]).not.toBe(0);
    // Proof it is progress and not a copied offset: the taller viewport has a
    // shorter scroll extent, so the same progress is a different scrollTop.
    expect(rawScrollTops[0]).not.toBe(rawScrollTops[1]);

    // --- Inspection ---------------------------------------------------------

    // 21-22. Dev Mode reveals measurements on tap.
    await page.getByLabel('Dev', { exact: true }).check();
    await panes.first().getByTestId('design-document').locator('[data-node-id]').first().click();
    await expect(page.getByRole('button', { name: /^Box/ })).toBeVisible();
    await expect(page.getByText('height', { exact: true })).toBeVisible();

    // 23. The device overlay draws rulers, bounds and safe-area bands.
    await page.getByLabel('Overlay', { exact: true }).check();
    await expect(page.getByTestId('device-overlay').first()).toBeVisible();
    await expect(page.getByText(/safe-area-top \d+/).first()).toBeVisible();

    // Inspection never alters the design.
    const afterInspect = await paneFacts(panes.first());
    expect(afterInspect.documentWidth).toBe(afterInspect.viewportWidth);
    expect(afterInspect.scale).toBe(1);
    await page.getByLabel('Overlay', { exact: true }).uncheck();
    await page.getByLabel('Dev', { exact: true }).uncheck();

    // --- Validation and export ---------------------------------------------

    const panel = page.getByRole('region', { name: 'Validation summary' });
    await expect(panel.getByText(/Passed|Failed/)).toBeVisible({ timeout: 60_000 });

    // The two fidelity questions are reported separately, never merged.
    await expect(panel.getByText('source fidelity')).toBeVisible();
    await expect(panel.getByText('adaptation fidelity')).toBeVisible();

    // 24. The comparison itself exports as one image.
    await panel.getByRole('button', { name: /iPhone|Pixel/ }).click();
    const popupPromise = context.waitForEvent('page');
    await panel.getByRole('button', { name: 'Export comparison' }).click();
    const popup = await popupPromise;
    expect(popup.url()).toMatch(/\/assets\/[A-Za-z0-9_-]+\?expires=\d+&signature=[a-f0-9]+$/);
    await popup.close();
    await expect(page.locator('p[role="status"]').last()).toContainText('Exported compare-image', {
      timeout: 30_000,
    });
  });

  test('the device explorer does not lead with its advanced filters', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 60_000 });

    const explorer = page.getByRole('complementary', { name: 'Device explorer' });
    await expect(explorer.getByLabel('Search devices')).toBeVisible();
    // Search and platform are enough to find a device; everything else starts
    // folded (spec sections 19 and 20).
    await expect(explorer.getByLabel('Minimum logical width')).toHaveCount(0);
    await explorer.getByRole('button', { name: /More filters/ }).click();
    await expect(explorer.getByLabel('Minimum logical width')).toBeVisible();
  });

  test('the source panel hides, and its toggle stays reachable', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Hide source panel' }).click();
    await expect(page.getByRole('complementary', { name: 'Source' })).toHaveCount(0);
    // The toggle must not disappear with the panel it toggles (spec section 21).
    const reveal = page.getByRole('button', { name: 'Show source panel' });
    await expect(reveal).toBeVisible();
    await reveal.click();
    await expect(page.getByRole('complementary', { name: 'Source' })).toBeVisible();
  });

  test('zoom snaps to 10% steps', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByText('Source preserved')).toBeVisible({ timeout: 60_000 });

    // Drive the slider to an off-step value the way a drag would, bypassing
    // the input's own step so the snapping under test is the app's, not the
    // browser's.
    const zoom = page.getByLabel('Preview zoom');
    await zoom.evaluate((element: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, '0.83');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // 83% and 84% are not comparable; snapping keeps a scale you can return to.
    await expect(page.getByText('80%')).toBeVisible();
  });
});

/** Heights of the elements both devices rendered, in the same order. */
function sharedHeights(a: string[], b: string[]) {
  const ids = (list: string[]) => new Map(list.map((entry) => entry.split(':') as [string, string]));
  const left = ids(a);
  const right = ids(b);
  const common = [...left.keys()].filter((id) => right.has(id)).sort();
  return {
    count: common.length,
    small: common.map((id) => `${id}:${left.get(id)}`),
    large: common.map((id) => `${id}:${right.get(id)}`),
  };
}

/** Facts read from the live DOM, so they describe what is actually rendered. */
async function paneFacts(pane: Locator) {
  const viewport = pane.getByTestId('design-viewport');
  const document = pane.getByTestId('design-document');
  await expect(document).toBeVisible();

  // Layout measurements, not painted ones: the workspace applies a display
  // zoom to the whole canvas, and that is a property of the workspace, not of
  // the adaptation. Reading offset/client sizes measures the design as laid
  // out, which is what "the font must not shrink" is actually about.
  const measurements = await viewport.evaluate((element) => {
    const doc = element.querySelector('[data-testid="design-document"]') as HTMLElement | null;
    const nodes = Array.from(element.querySelectorAll('[data-node-id]')) as HTMLElement[];
    return {
      viewportWidth: element.clientWidth,
      viewportHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      documentWidth: doc ? doc.offsetWidth : 0,
      documentHeight: doc ? doc.offsetHeight : 0,
      transform: doc ? getComputedStyle(doc).transform : 'none',
      // Type geometry per node, keyed by node id so the two devices are
      // compared element for element rather than by position.
      textHeights: nodes
        .filter((node) => node.dataset['nodeType'] !== 'container')
        .map((node) => `${node.dataset['nodeId']}:${node.offsetHeight}`)
        .sort(),
    };
  });

  // The document is drawn at its authored width with no transform; anything
  // else would be the image-scaling behaviour the enhancement removes.
  const scale = measurements.transform === 'none' ? 1 : parseFloat(measurements.transform.split('(')[1] ?? '1');

  return {
    ...measurements,
    scale,
    visibleFraction: measurements.scrollHeight === 0 ? 0 : measurements.viewportHeight / measurements.scrollHeight,
  };
}

async function selectDevice(page: Page, name: string): Promise<void> {
  const explorer = page.getByRole('complementary', { name: 'Device explorer' });
  await explorer.getByLabel('Search devices').fill(name);
  await explorer.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await explorer.getByLabel('Search devices').fill('');
}
