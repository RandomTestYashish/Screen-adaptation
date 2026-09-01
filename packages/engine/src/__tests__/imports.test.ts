import { describe, expect, it } from 'vitest';
import { flatten, primaryScreen } from '@dae/shared';
import { buildRasterDesign, inferViewportHeight } from '../imports/raster.js';
import { buildFigmaDesign, type FigmaNode } from '../imports/figma.js';
import { detectAnchors } from '../imports/anchors.js';
import { fixtureSource, structuredScreen } from './fixtures.js';

describe('raster import', () => {
  const source = fixtureSource('raster', 375, 2400);

  it('renders exactly one image node covering the document', () => {
    const design = buildRasterDesign({ source });
    const screen = primaryScreen(design);
    const nodes = flatten(screen.root);
    const images = nodes.filter((n) => n.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0]!.frame).toEqual({ x: 0, y: 0, width: 375, height: 2400 });
    expect(design.assetsUsed).toEqual([source.assetId]);
  });

  it('keeps the full bitmap height as the scroll height', () => {
    const screen = primaryScreen(buildRasterDesign({ source }));
    expect(screen.scrollHeight).toBe(2400);
    expect(screen.scrollHeightProvenance.quality).toBe('detected');
  });

  it('infers a viewport height and labels it as inferred', () => {
    expect(inferViewportHeight(375, 2400)).toBe(813);
    // A short export cannot be taller than itself.
    expect(inferViewportHeight(375, 500)).toBe(500);
  });

  it('stores analysis as a separate overlay and never in the rendered tree', () => {
    const design = buildRasterDesign({
      source,
      analysis: {
        provider: 'openai',
        model: 'test-model',
        regions: [
          { x: 16, y: 40, width: 200, height: 28, kind: 'text', text: 'Good morning', confidence: 0.8 },
        ],
      },
    });
    const screen = primaryScreen(design);
    expect(flatten(screen.root).filter((n) => n.type === 'text')).toHaveLength(0);
    expect(screen.analysisOverlay).toBeDefined();
    expect(screen.analysisOverlay!.visible).toBe(false);
    const analysed = flatten(screen.analysisOverlay!).filter((n) => n.type === 'text');
    expect(analysed).toHaveLength(1);
    expect(analysed[0]!.provenance.origin).toBe('raster-analysis');
    expect(analysed[0]!.provenance.quality).toBe('inferred');
    expect(design.notes.join(' ')).toContain('non-rendering analysis overlay');
  });
});

describe('figma import', () => {
  const node: FigmaNode = {
    id: '1:1',
    name: 'Home',
    type: 'FRAME',
    absoluteBoundingBox: { x: 100, y: 200, width: 375, height: 812 },
    clipsContent: true,
    children: [
      {
        id: '1:2',
        name: 'Header',
        type: 'FRAME',
        absoluteBoundingBox: { x: 100, y: 200, width: 375, height: 88 },
        constraints: { horizontal: 'LEFT_RIGHT', vertical: 'TOP' },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
        cornerRadius: 0,
        children: [
          {
            id: '1:3',
            name: 'Title',
            type: 'TEXT',
            characters: 'Good morning',
            absoluteBoundingBox: { x: 116, y: 252, width: 200, height: 28 },
            constraints: { horizontal: 'LEFT', vertical: 'TOP' },
            fills: [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }],
            style: {
              fontFamily: 'Inter',
              fontSize: 22,
              fontWeight: 700,
              lineHeightPx: 28,
              letterSpacing: 0,
              textAlignHorizontal: 'LEFT',
            },
          },
        ],
      },
      {
        id: '1:4',
        name: 'Bottom tab bar',
        type: 'FRAME',
        absoluteBoundingBox: { x: 100, y: 200 + 812 - 56, width: 375, height: 56 },
        constraints: { horizontal: 'LEFT_RIGHT', vertical: 'BOTTOM' },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
      },
    ],
  };

  const design = buildFigmaDesign({ source: fixtureSource('figma'), node });
  const screen = primaryScreen(design);

  it('rebases canvas coordinates into document space', () => {
    const header = flatten(screen.root).find((n) => n.name === 'Header')!;
    expect(header.frame).toEqual({ x: 0, y: 0, width: 375, height: 88 });
  });

  it('preserves node ids, hierarchy and constraints', () => {
    const title = flatten(screen.root).find((n) => n.name === 'Title')!;
    expect(title.provenance.sourceNodeId).toBe('1:3');
    expect(title.provenance.quality).toBe('detected');
    const header = flatten(screen.root).find((n) => n.name === 'Header')!;
    expect(header.constraints).toEqual({ horizontal: 'left-right', vertical: 'top' });
  });

  it('preserves typography exactly and records the fonts used', () => {
    const title = flatten(screen.root).find((n) => n.name === 'Title');
    if (title?.type !== 'text') throw new Error('expected a text node named Title');
    expect(title.typography.fontFamily).toBe('Inter');
    expect(title.typography.fontSize).toBe(22);
    expect(title.typography.fontWeight).toBe(700);
    expect(title.typography.lineHeight).toBe(28);
    expect(title.typography.lineHeightSource).toBe('explicit');
    expect(design.fontsUsed).toEqual([{ family: 'Inter', weights: [700] }]);
  });

  it('marks a derived line height as inferred rather than detected', () => {
    const withoutLineHeight = structuredClone(node);
    delete withoutLineHeight.children![0]!.children![0]!.style!.lineHeightPx;
    const derived = buildFigmaDesign({ source: fixtureSource('figma'), node: withoutLineHeight });
    const title = flatten(primaryScreen(derived).root).find((n) => n.name === 'Title')!;
    expect(title.fieldQuality['typography.lineHeight']!.quality).toBe('inferred');
  });

  it('converts colours from Figma 0-1 floats to 0-255', () => {
    const header = flatten(screen.root).find((n) => n.name === 'Header')!;
    expect(header.fills[0]).toMatchObject({ type: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } });
  });
});

describe('anchor detection', () => {
  it('recognises a named header and tab bar, with a confidence', () => {
    const screen = structuredScreen();
    // Start from an unannotated import.
    const root = screen.root as { children: { id: string; safeAreaAnchor: string; position: string }[] };
    for (const child of root.children) {
      child.safeAreaAnchor = 'none';
      child.position = 'flow';
    }

    const { annotations } = detectAnchors(screen);
    const header = annotations.find((a) => a.nodeId === 'header')!;
    const tabBar = annotations.find((a) => a.nodeId === 'tab-bar')!;

    expect(header.anchor).toBe('top-inset');
    expect(header.position).toBe('sticky');
    expect(header.confidence).toBeGreaterThanOrEqual(0.9);

    expect(tabBar.anchor).toBe('bottom-inset');
    expect(tabBar.position).toBe('fixed');
    expect(tabBar.reason).toContain('tab-bar');
  });

  it('does not pin an inset card that merely sits near an edge', () => {
    const screen = structuredScreen();
    const { annotations } = detectAnchors(screen);
    expect(annotations.some((a) => a.nodeId.startsWith('card-'))).toBe(false);
  });
});
