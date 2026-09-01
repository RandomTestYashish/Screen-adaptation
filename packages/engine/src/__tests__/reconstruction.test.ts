import { describe, expect, it } from 'vitest';
import { flatten, measured, PARSER_VERSION, primaryScreen, type SourceDocument } from '@dae/shared';
import { loadCatalog } from '@dae/device-catalog';
import { reconstructRaster } from '../reconstruction/reconstruct.js';
import { detectGrid } from '../reconstruction/design-dna.js';
import { perceptualDistance, rgbContrastRatio, toHex, type PixelData } from '../reconstruction/pixels.js';
import { detectBackground } from '../reconstruction/segmentation.js';
import { planAdaptation } from '../adaptation/planner.js';
import { adaptationFidelity } from '../adaptation/fidelity.js';
import { flatSourceFidelity, sourceFidelityOf } from '../reconstruction/fidelity.js';

const catalog = loadCatalog();
const device = (id: string) => {
  const found = catalog.devices.find((d) => d.id === id);
  if (!found) throw new Error(`Missing test device ${id}`);
  return found;
};

/** Paint a synthetic screenshot: dark header, list of cards, dark bottom bar. */
function syntheticScreen(width = 375, height = 1400): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  const rect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) put(xx, yy, r, g, b);
  };

  rect(0, 0, width, height, 255, 255, 255); // page background
  rect(0, 0, width, 88, 17, 17, 20); // header

  /** A word of pseudo-text: stems plus a joining bar, at real ink coverage. */
  const word = (x: number, y: number, glyphs: number, size: number, r: number, g: number, b: number) => {
    const stem = Math.max(1, Math.round(size * 0.12));
    for (let i = 0; i < glyphs; i += 1) {
      const gx = x + i * Math.round(size * 0.62);
      rect(gx, y, stem, size, r, g, b);
      rect(gx + Math.round(size * 0.4), y, stem, size, r, g, b);
      rect(gx, y + Math.round(size * 0.45), Math.round(size * 0.4), stem, r, g, b);
    }
  };

  word(16, 52, 7, 22, 245, 245, 245); // header title

  // Five cards, 16px margins, 24px gaps - an 8px rhythm.
  for (let i = 0; i < 5; i += 1) {
    const y = 112 + i * 224;
    rect(16, y, width - 32, 200, 242, 242, 245);
    word(32, y + 24, 6, 16, 40, 40, 45); // card title
    word(32, y + 56, 9, 13, 110, 110, 118); // supporting copy
  }

  rect(0, height - 64, width, 64, 17, 17, 20); // bottom bar
  return { data, width, height };
}

function fixtureSource(width: number, height: number): SourceDocument {
  return {
    id: 'src_recon',
    projectId: 'p1',
    kind: 'raster',
    name: 'screen.png',
    mimeType: 'image/png',
    byteSize: 1024,
    hash: 'c'.repeat(64),
    assetId: 'asset_recon',
    width,
    height,
    pixelWidth: width,
    pixelHeight: height,
    exportScale: 1,
    exportScaleProvenance: measured('raster-pixels', 1),
    importedAt: '2026-01-01T00:00:00.000Z',
    parserVersion: PARSER_VERSION,
    immutable: true,
  };
}

const image = syntheticScreen();
const source = fixtureSource(image.width, image.height);
const result = reconstructRaster({ source, image });
const screen = primaryScreen(result.design);

describe('colour intelligence', () => {
  it('ranks near-neighbour tints perceptually, not by raw RGB', () => {
    const white = { r: 255, g: 255, b: 255 };
    const nearWhite = { r: 242, g: 242, b: 245 };
    const midGrey = { r: 128, g: 128, b: 128 };
    expect(perceptualDistance(white, nearWhite)).toBeLessThan(perceptualDistance(white, midGrey));
    // Distinguishable, which is what lets a surface be told from the page.
    expect(perceptualDistance(white, nearWhite)).toBeGreaterThan(0.01);
  });

  it('computes WCAG contrast', () => {
    expect(rgbContrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
  });

  it('finds the page background rather than a full-bleed bar', () => {
    // The header and footer touch the top and bottom edges; the background is
    // what reaches the left and right ones.
    const background = detectBackground(image);
    expect(toHex(background.color)).toBe('#ffffff');
    expect(background.confidence).toBeGreaterThan(0.9);
  });
});

describe('design DNA', () => {
  it('detects the spacing rhythm the source actually uses', () => {
    expect(detectGrid([8, 16, 24, 32, 24, 16, 8]).base).toBe(8);
    expect(detectGrid([10, 20, 30, 20, 10, 40]).base).toBe(10);
  });

  it('reports no grid rather than forcing one onto an irregular design', () => {
    const irregular = detectGrid([7, 13, 19, 23, 31, 37, 41, 43]);
    expect(irregular.base).toBeNull();
    expect(irregular.confidence).toBeLessThan(0.72);
  });

  it('measures the edge margin from the source', () => {
    expect(result.dna.edgeMargin.value).toBe(16);
    expect(result.dna.edgeMargin.measurementType).toBe('DETECTED');
  });

  it('never guesses a font family from a bitmap', () => {
    expect(result.dna.fontFamily.value).toBeNull();
    expect(result.dna.fontFamily.measurementType).toBe('UNKNOWN');
    expect(result.dna.fontFamily.confidence).toBe(0);
  });

  it('extracts a palette including the page background and card surface', () => {
    const hexes = result.dna.colors.map((c) => c.hex);
    expect(hexes).toContain('#ffffff');
    expect(result.dna.colors.find((c) => c.hex === '#ffffff')?.role).toBe('background');
    expect(hexes.some((hex) => perceptualDistance({ r: 242, g: 242, b: 245 }, hexToRgb(hex)) < 0.05)).toBe(true);
  });
});

describe('reconstruction', () => {
  it('separates the screen into regions instead of one flat image', () => {
    expect(result.regions.length).toBeGreaterThanOrEqual(6);
    expect(result.design.structure).toBe('reconstructed');
  });

  it('finds the header, the repeated rows and the bottom bar', () => {
    const types = result.regions.map((r) => r.classification.componentType);
    expect(types).toContain('HEADER');
    expect(types).toContain('NAVIGATION');
    expect(types.filter((t) => t === 'LIST_ITEM' || t === 'CARD').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the document at its full height - the frame is not a viewport', () => {
    expect(screen.frame.height).toBe(image.height);
    expect(screen.scrollHeight).toBe(image.height);
  });

  it('leaves the uploaded source untouched', () => {
    expect(source.immutable).toBe(true);
    expect(result.design.sourceHash).toBe(source.hash);
    expect(result.design.assetsUsed).toEqual([source.assetId]);
  });

  it('renders unreconstructable regions as crops of the original bitmap', () => {
    const crops = flatten(screen.root).filter((node) => node.type === 'image' && node.crop);
    expect(crops.length).toBeGreaterThan(0);
    for (const node of crops) {
      if (node.type !== 'image' || !node.crop) throw new Error('expected a cropped image node');
      expect(node.assetId).toBe(source.assetId);
      // A crop is a window onto the source, so it must lie inside it.
      expect(node.crop.x).toBeGreaterThanOrEqual(0);
      expect(node.crop.y).toBeGreaterThanOrEqual(0);
      expect(node.crop.x + node.crop.width).toBeLessThanOrEqual(1.001);
      expect(node.crop.y + node.crop.height).toBeLessThanOrEqual(1.001);
    }
  });

  it('carries measured typography and a reason on every reconstructed node', () => {
    const withAnalysis = flatten(screen.root).filter((node) => node.analysis);
    expect(withAnalysis.length).toBeGreaterThan(0);
    for (const node of withAnalysis) {
      expect(node.analysis!.reasons.length).toBeGreaterThan(0);
      expect(node.analysis!.confidence).toBeGreaterThan(0);
    }
    const typed = withAnalysis.filter((node) => node.analysis?.typography);
    expect(typed.length).toBeGreaterThan(0);
    for (const node of typed) {
      expect(node.analysis!.typography!.fontSize).toBeGreaterThan(5);
      expect(node.analysis!.typography!.fontSize).toBeLessThan(80);
    }
  });

  it('marks full-width and content-width elements so they follow the viewport', () => {
    const stretching = flatten(screen.root).filter((node) => node.constraints.horizontal === 'left-right');
    expect(stretching.length).toBeGreaterThanOrEqual(5);
  });
});

describe('true viewport adaptation', () => {
  const plans = ['apple-iphone-se-3', 'apple-iphone-16-pro', 'apple-iphone-16-pro-max'].map((id) => {
    const target = device(id);
    return {
      device: target,
      ...planAdaptation({ design: result.design, screen, device: target, catalog, projectId: 'p1' }),
    };
  });

  it('never scales a reconstructed design to fit', () => {
    for (const entry of plans) {
      expect(entry.plan.scale, entry.device.marketingName).toBe(1);
      expect(['identity', 'structural-reflow']).toContain(entry.plan.strategy);
    }
  });

  it('keeps the document height independent of the device', () => {
    const heights = plans.map((entry) => entry.plan.targetScrollHeight);
    for (const height of heights) {
      // Only safe-area clearance may extend it; it must never scale with width.
      expect(height).toBeGreaterThanOrEqual(image.height);
      expect(height).toBeLessThan(image.height + 100);
    }
  });

  it('shows more rows on a taller viewport and fewer on a shorter one', () => {
    const rowIds = new Set(
      result.regions
        .filter((r) => r.classification.componentType === 'LIST_ITEM' || r.classification.componentType === 'CARD')
        .map((r) => r.nodeId),
    );
    const visibleOn = (entry: (typeof plans)[number]) =>
      entry.nodes.filter((node) => rowIds.has(node.nodeId) && node.frame.y + node.frame.height <= entry.plan.usableViewport.height)
        .length;

    const small = visibleOn(plans[0]!);
    const large = visibleOn(plans[2]!);
    expect(large).toBeGreaterThan(small);
  });

  it('widens content-width elements instead of scaling them', () => {
    const wide = plans[2]!;
    const rowId = result.regions.find((r) => r.classification.componentType === 'LIST_ITEM')?.nodeId;
    if (!rowId) throw new Error('no list row was reconstructed');
    const row = wide.nodes.find((node) => node.nodeId === rowId)!;
    // The margins are preserved and the element absorbs the extra width.
    // Segmentation works on a 2px grid, so allow that much slack.
    const rightMargin = wide.plan.targetViewport.width - (row.frame.x + row.frame.width);
    expect(row.frame.x).toBe(16);
    expect(Math.abs(rightMargin - 16)).toBeLessThanOrEqual(2);
    expect(row.frame.width).toBeGreaterThan(343);
  });

  it('records no transformation that alters type', () => {
    for (const entry of plans) {
      const typeChanges = entry.plan.transforms.filter(
        (t) => 'fontSize' in t.after || 'fontWeight' in t.after || 'fontFamily' in t.after,
      );
      expect(typeChanges, entry.device.marketingName).toHaveLength(0);
    }
  });

  it('explains the adaptation in terms of the viewport, not density', () => {
    const reason = plans[1]!.plan.strategyReason.toLowerCase();
    expect(reason).toContain('viewport');
    expect(reason).not.toContain('dpi');
  });
});

function hexToRgb(hex: string) {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

describe('source fidelity', () => {
  const fidelity = result.sourceFidelity;

  it('asks about the upload, not about any device', () => {
    expect(fidelity.kind).toBe('source');
    expect(fidelity.question).toMatch(/upload/i);
    // The score is a property of the document, so every device sees the same one.
    expect(result.design.sourceFidelity?.score).toBe(fidelity.score);
  });

  it('is high because most of the document is still the original pixels', () => {
    expect(fidelity.score).toBeGreaterThan(80);
    expect(fidelity.reasons.join(' ')).toMatch(/uploaded bitmap itself/);
  });

  it('states that the font family is unknown rather than scoring as if it were known', () => {
    expect(fidelity.limitations.join(' ')).toMatch(/font family cannot be recovered/i);
  });

  it('carries its own confidence, separate from the score', () => {
    expect(fidelity.confidence).toBeGreaterThan(0);
    expect(fidelity.confidence).toBeLessThanOrEqual(1);
    expect(fidelity.measurementType).toBe('DETECTED');
  });

  it('reports a flat raster document as exact but structureless', () => {
    const flat = flatSourceFidelity();
    expect(flat.score).toBe(100);
    expect(flat.limitations.join(' ')).toMatch(/never reflowed/);
  });
});

describe('the two fidelity scores stay separate', () => {
  const target = device('apple-iphone-16-pro-max');
  const { plan } = planAdaptation({ design: result.design, screen, device: target, catalog, projectId: 'p1' });
  const adapted = adaptationFidelity(plan, target);

  it('answers a different question from source fidelity', () => {
    expect(adapted.kind).toBe('adaptation');
    expect(adapted.question).not.toBe(result.sourceFidelity.question);
  });

  it('is derived from the transform record, and says so', () => {
    expect(adapted.measurementType).toBe('INFERRED');
    expect(adapted.limitations.join(' ')).toMatch(/not from a pixel comparison/);
  });

  it('does not inherit the source score, so a bad reconstruction cannot hide behind it', () => {
    const poor = { ...result.design, sourceFidelity: { ...result.sourceFidelity, score: 10 } };
    const after = adaptationFidelity(
      planAdaptation({ design: poor, screen, device: target, catalog, projectId: 'p1' }).plan,
      target,
    );
    expect(after.score).toBe(adapted.score);
    expect(sourceFidelityOf(poor).score).toBe(10);
  });
});
