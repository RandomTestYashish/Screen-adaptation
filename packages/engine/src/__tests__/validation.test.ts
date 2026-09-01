import { describe, expect, it } from 'vitest';
import { loadCatalog } from '@dae/device-catalog';
import { planAdaptation } from '../adaptation/planner.js';
import { runValidation } from '../validation/runner.js';
import { buildRasterDesign } from '../imports/raster.js';
import { fixtureSource, structuredDesign, structuredScreen } from './fixtures.js';

const catalog = loadCatalog();
const device = (id: string) => {
  const found = catalog.devices.find((d) => d.id === id);
  if (!found) throw new Error(`Missing test device ${id}`);
  return found;
};

async function validate(deviceId: string, options?: { unanchored?: boolean }) {
  const screen = structuredScreen();
  if (options?.unanchored) {
    // Simulate an import where the bottom bar was not recognised as pinned,
    // which is exactly what the correction pass exists to catch.
    const root = screen.root as { children: { id: string; safeAreaAnchor: string; position: string }[] };
    const bar = root.children.find((c) => c.id === 'tab-bar')!;
    bar.safeAreaAnchor = 'none';
    bar.position = 'fixed';
  }
  const design = structuredDesign(screen);
  const source = fixtureSource('figma');
  const dev = device(deviceId);
  const adaptation = planAdaptation({ design, screen, device: dev, catalog, projectId: 'p1' });
  const outcome = await runValidation({
    design,
    screen,
    device: dev,
    catalog,
    source,
    adaptation: { plan: adaptation.plan, nodes: adaptation.nodes },
    projectId: 'p1',
    assetResolver: { has: () => true },
  });
  return outcome;
}

describe('validation engine', () => {
  it('always runs exactly two passes', async () => {
    const { report } = await validate('apple-iphone-16-pro');
    expect(report.passes).toHaveLength(2);
    expect(report.passes[0]!.pass).toBe(1);
    expect(report.passes[1]!.pass).toBe(2);
  });

  it('runs all fourteen mandatory checks in each pass', async () => {
    const { report } = await validate('apple-iphone-16-pro');
    for (const pass of report.passes) {
      expect(pass.results).toHaveLength(14);
      expect(new Set(pass.results.map((r) => r.check)).size).toBe(14);
    }
  });

  it('ignores a bottom inset the source design already reserves', async () => {
    // 375x812 matches iPhone 13 mini, which reserves the same 34px bottom inset
    // as iPhone 16 Pro. Nothing new is covered, so nothing should be reported.
    const { report } = await validate('apple-iphone-16-pro', { unanchored: true });
    const collision = report.passes[0]!.results.find((r) => r.check === 'bottom-navigation-collision')!;
    expect(collision.status).toBe('pass');
  });

  it('detects a pinned bar colliding with a larger bottom inset and corrects it', async () => {
    // Pixel 6 with three-button navigation reserves 48px, 14px more than the
    // 34px the 375x812 source design accounts for.
    const { report, adaptation } = await validate('google-pixel-6-3button', { unanchored: true });

    const firstPass = report.passes[0]!;
    const collision = firstPass.results.find((r) => r.check === 'bottom-navigation-collision')!;
    expect(collision.status).toBe('fail');
    expect(firstPass.correctionsApplied.length).toBeGreaterThan(0);

    // Second pass must confirm the fix on the re-rendered result.
    const secondPass = report.passes[1]!;
    const recheck = secondPass.results.find((r) => r.check === 'bottom-navigation-collision')!;
    expect(recheck.status).toBe('pass');
    expect(adaptation.plan.revision).toBe(1);
    const clearance = adaptation.plan.transforms.find((t) => t.type === 'home-indicator-clearance')!;
    expect(clearance.after.addedPaddingBottom).toBe(48 - 34);
    expect(clearance.impact).toBe('layout');
  });

  it('reports the visual comparison as skipped rather than claiming a match', async () => {
    const { report } = await validate('apple-iphone-16-pro');
    const visual = report.passes[1]!.results.find((r) => r.check === 'visual-comparison')!;
    expect(visual.status).toBe('skipped');
    expect(visual.skippedReason).toBeTruthy();
    expect(report.limitations.some((l) => l.startsWith('visual-comparison'))).toBe(true);
  });

  it('never claims physical-device fidelity', async () => {
    const { report } = await validate('apple-iphone-16-pro');
    expect(report.limitations.some((l) => l.includes('not a physical device'))).toBe(true);
  });

  it('surfaces reduced device-data confidence as an explicit limitation', async () => {
    const { report } = await validate('apple-iphone-17-pro');
    expect(report.limitations.some((l) => l.includes('medium confidence'))).toBe(true);
    expect(
      report.passes[1]!.results
        .find((r) => r.check === 'device-profile-integrity')!
        .findings.some((f) => f.title.includes('medium-confidence')),
    ).toBe(true);
  });

  it('emits code-like measurement rows with honesty labels', async () => {
    const { report } = await validate('apple-iphone-16-pro');
    const byKey = new Map(report.metadata.map((row) => [row.key, row]));
    expect(byKey.get('viewport-width')!.value).toBe('402px');
    expect(byKey.get('device-pixel-ratio')!.value).toBe('3');
    expect(byKey.get('safe-area-top')!.value).toBe('62px');
    expect(byKey.get('measured-scroll-height')!.quality).toBe('unavailable');
    expect(byKey.get('source-immutable')!.value).toBe('true');
  });

  it('prefers client DOM measurements over predictions when supplied', async () => {
    const screen = structuredScreen();
    const design = structuredDesign(screen);
    const dev = device('apple-iphone-16-pro');
    const adaptation = planAdaptation({ design, screen, device: dev, catalog, projectId: 'p1' });
    const { report } = await runValidation({
      design,
      screen,
      device: dev,
      catalog,
      source: fixtureSource('figma'),
      adaptation: { plan: adaptation.plan, nodes: adaptation.nodes },
      projectId: 'p1',
      assetResolver: { has: () => true },
      evidence: { measuredScrollHeight: adaptation.plan.targetScrollHeight, availableFonts: ['Inter'] },
    });
    const scrollRow = report.metadata.find((r) => r.key === 'measured-scroll-height')!;
    expect(scrollRow.quality).toBe('detected');
    const fonts = report.passes[1]!.results.find((r) => r.check === 'font-availability')!;
    expect(fonts.confidence).toBe(1);
  });

  it('skips font checks for a bitmap because type is baked into the artwork', async () => {
    const source = fixtureSource('raster', 375, 2400);
    const design = buildRasterDesign({ source });
    const screen = design.screens[0]!;
    const dev = device('google-pixel-8');
    const adaptation = planAdaptation({ design, screen, device: dev, catalog, projectId: 'p1' });
    const { report } = await runValidation({
      design,
      screen,
      device: dev,
      catalog,
      source,
      adaptation: { plan: adaptation.plan, nodes: adaptation.nodes },
      projectId: 'p1',
      assetResolver: { has: () => true },
    });
    const fonts = report.passes[1]!.results.find((r) => r.check === 'font-availability')!;
    expect(fonts.status).toBe('skipped');
    expect(fonts.skippedReason).toContain('baked into the artwork');
  });

  it('flags a missing asset as critical', async () => {
    const source = fixtureSource('raster', 375, 2400);
    const design = buildRasterDesign({ source });
    const screen = design.screens[0]!;
    const dev = device('google-pixel-8');
    const adaptation = planAdaptation({ design, screen, device: dev, catalog, projectId: 'p1' });
    const { report } = await runValidation({
      design,
      screen,
      device: dev,
      catalog,
      source,
      adaptation: { plan: adaptation.plan, nodes: adaptation.nodes },
      projectId: 'p1',
      assetResolver: { has: () => false },
    });
    expect(report.status).toBe('fail');
    expect(report.criticalCount).toBeGreaterThan(0);
  });
});
