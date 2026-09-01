import { describe, expect, it } from 'vitest';
import { loadCatalog } from '@dae/device-catalog';
import { planAdaptation } from '../adaptation/planner.js';
import { inferSourceSafeArea } from '../adaptation/rules/source-safe-area.js';
import { buildRasterDesign } from '../imports/raster.js';
import { fixtureSource, structuredDesign, structuredScreen } from './fixtures.js';

const catalog = loadCatalog();
const device = (id: string) => {
  const found = catalog.devices.find((d) => d.id === id);
  if (!found) throw new Error(`Missing test device ${id}`);
  return found;
};

describe('source safe-area inference', () => {
  it('recognises a 375x812 artboard as already reserving an iPhone 13 mini safe area', () => {
    const result = inferSourceSafeArea(catalog, { width: 375, height: 812 });
    expect(result.basis).toBe('exact-device-match');
    expect(result.insets.top).toBe(50);
    expect(result.insets.bottom).toBe(34);
  });

  it('falls back to the most conservative width match', () => {
    const result = inferSourceSafeArea(catalog, { width: 375, height: 900 });
    expect(result.basis).toBe('width-match');
    // iPhone SE (375x667) has the smallest top inset of the 375-wide devices.
    expect(result.insets.top).toBe(20);
  });

  it('assumes zero and says so when nothing matches', () => {
    const result = inferSourceSafeArea(catalog, { width: 1024, height: 768 });
    expect(result.basis).toBe('assumed-zero');
    expect(result.explanation).toContain('matches no catalogued device');
  });
});

describe('structural reflow', () => {
  const design = structuredDesign();
  const screen = design.screens[0]!;

  it('keeps a 375 design at 1:1 on a 375-wide device', () => {
    const { plan } = planAdaptation({
      design,
      screen,
      device: device('apple-iphone-13-mini'),
      catalog,
      projectId: 'p1',
    });
    expect(plan.strategy).toBe('identity');
    expect(plan.scale).toBe(1);
    expect(plan.preservation.score).toBe(100);
    expect(plan.preservation.pixelsChanged).toBe(false);
  });

  it('reflows to 402px without scaling type', () => {
    const { plan, nodes } = planAdaptation({
      design,
      screen,
      device: device('apple-iphone-16-pro'),
      catalog,
      projectId: 'p1',
    });
    expect(plan.strategy).toBe('structural-reflow');
    expect(plan.scale).toBe(1);

    // A left-right constrained card must follow the width and keep its margins.
    const card = nodes.find((n) => n.nodeId === 'card-0')!;
    expect(card.frame.width).toBe(402 - 32);
    expect(card.frame.x).toBe(16);

    // Type is never rescaled.
    const typographyTransforms = plan.transforms.filter((t) => 'fontSize' in t.after);
    expect(typographyTransforms).toHaveLength(0);
  });

  it('narrows to 360px without clipping', () => {
    const { plan, nodes } = planAdaptation({
      design,
      screen,
      device: device('samsung-galaxy-s24'),
      catalog,
      projectId: 'p1',
    });
    const card = nodes.find((n) => n.nodeId === 'card-0')!;
    expect(card.frame.width).toBe(360 - 32);
    expect(card.frame.x + card.frame.width).toBeLessThanOrEqual(plan.targetViewport.width);
  });

  it('applies only the delta between source and target top insets', () => {
    // Source assumes 50px (375x812 = iPhone 13 mini); iPhone 16 Pro has 62px.
    const { plan } = planAdaptation({
      design,
      screen,
      device: device('apple-iphone-16-pro'),
      catalog,
      projectId: 'p1',
    });
    const inset = plan.transforms.find((t) => t.type === 'safe-area-inset');
    expect(inset).toBeDefined();
    expect(inset!.after.height).toBe(88 + (62 - 50));
    expect(inset!.reason).toContain('62px top inset');
  });

  it('does not shift anything when the target inset is smaller than the source', () => {
    // iPhone SE has a 20px top inset, below the source's assumed 50px.
    const { plan } = planAdaptation({
      design,
      screen,
      device: device('apple-iphone-se-3'),
      catalog,
      projectId: 'p1',
    });
    expect(plan.transforms.find((t) => t.type === 'safe-area-inset')).toBeUndefined();
  });

  it('records device chrome as a separate, non-destructive layer', () => {
    const { plan } = planAdaptation({
      design,
      screen,
      device: device('apple-iphone-16-pro'),
      catalog,
      projectId: 'p1',
    });
    const chrome = plan.transforms.find((t) => t.type === 'chrome-overlay')!;
    expect(chrome.impact).toBe('chrome-only');
    expect(plan.preservation.reasons.join(' ')).not.toContain('chrome');
  });
});

describe('long scrollable pages', () => {
  it('never crops the document to the device frame', () => {
    const screen = structuredScreen(4800);
    const design = structuredDesign(screen);
    for (const id of ['apple-iphone-se-3', 'apple-iphone-16-pro-max', 'samsung-galaxy-s24', 'google-pixel-8-pro']) {
      const { plan } = planAdaptation({ design, screen, device: device(id), catalog, projectId: 'p1' });
      expect(plan.targetScrollHeight).toBeGreaterThanOrEqual(4800 * plan.scale);
      expect(plan.targetScrollHeight).toBeGreaterThan(plan.targetViewport.height);
    }
  });
});

describe('raster adaptation', () => {
  const source = fixtureSource('raster', 375, 2400);
  const design = buildRasterDesign({ source });
  const screen = design.screens[0]!;

  it('scales the bitmap proportionally and never crops it', () => {
    const { plan } = planAdaptation({ design, screen, device: device('apple-iphone-16-pro'), catalog, projectId: 'p1' });
    expect(plan.strategy).toBe('uniform-scale');
    expect(plan.scale).toBeCloseTo(402 / 375, 6);
    // The scaled document, plus the bottom inset so the last row can scroll
    // clear of the home indicator.
    expect(plan.targetScrollHeight).toBeCloseTo(2400 * (402 / 375) + plan.safeArea.bottom, 1);
    expect(plan.transforms.some((t) => t.type === 'scroll-extent-adjust')).toBe(true);
  });

  it('scales down for a narrower device without clipping', () => {
    const { plan, nodes } = planAdaptation({ design, screen, device: device('samsung-galaxy-s24'), catalog, projectId: 'p1' });
    expect(plan.scale).toBeCloseTo(360 / 375, 6);
    const image = nodes.find((n) => n.frame.width > 0 && n.frame.height > 1000)!;
    expect(image.frame.width).toBeCloseTo(360, 1);
    expect(image.frame.x).toBe(0);
  });

  it('keeps a perfect preservation score when no scaling is needed', () => {
    const { plan } = planAdaptation({ design, screen, device: device('apple-iphone-13-mini'), catalog, projectId: 'p1' });
    expect(plan.strategy).toBe('identity');
    expect(plan.preservation.score).toBe(100);
  });
});
