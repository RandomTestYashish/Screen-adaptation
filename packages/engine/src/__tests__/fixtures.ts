import {
  DESIGN_IR_VERSION,
  PARSER_VERSION,
  measured,
  type DesignDocument,
  type DesignNode,
  type Screen,
  type SourceDocument,
} from '@dae/shared';

const NOW = '2026-01-01T00:00:00.000Z';

function base(id: string, name: string, frame: { x: number; y: number; width: number; height: number }) {
  return {
    id,
    name,
    frame,
    opacity: 1,
    rotation: 0,
    visible: true,
    clipsContent: false,
    zIndex: 0,
    position: 'flow' as const,
    safeAreaAnchor: 'none' as const,
    constraints: { horizontal: 'left' as const, vertical: 'top' as const },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    fills: [],
    strokes: [],
    shadows: [],
    provenance: measured('figma-node', 1, `figma:${id}`),
    fieldQuality: {},
  };
}

/**
 * A 375x812 structured design with a sticky header, a long scrolling body and
 * a fixed bottom tab bar - the shape the acceptance scenario describes.
 */
export function structuredScreen(scrollHeight = 2400): Screen {
  const header: DesignNode = {
    ...base('header', 'Header / Nav bar', { x: 0, y: 0, width: 375, height: 88 }),
    type: 'container',
    position: 'sticky',
    safeAreaAnchor: 'top-inset',
    constraints: { horizontal: 'left-right', vertical: 'top' },
    fills: [{ type: 'solid', color: { r: 255, g: 255, b: 255, a: 1 }, opacity: 1 }],
    children: [
      {
        ...base('title', 'Title', { x: 16, y: 52, width: 200, height: 28 }),
        type: 'text',
        characters: 'Good morning',
        typography: {
          fontFamily: 'Inter',
          fontSize: 22,
          fontWeight: 700,
          fontStyle: 'normal',
          lineHeight: 28,
          lineHeightSource: 'explicit',
          letterSpacing: 0,
          textAlign: 'left',
          verticalAlign: 'top',
          textTransform: 'none',
          textDecoration: 'none',
          color: { r: 17, g: 17, b: 17, a: 1 },
        },
        lines: [],
        textAutoResize: 'none',
        overflow: 'visible',
      },
    ],
  };

  const cards: DesignNode[] = Array.from({ length: 8 }, (_, index) => ({
    ...base(`card-${index}`, `Card ${index + 1}`, { x: 16, y: 108 + index * 260, width: 343, height: 240 }),
    type: 'container' as const,
    constraints: { horizontal: 'left-right' as const, vertical: 'top' as const },
    cornerRadius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
    fills: [{ type: 'solid' as const, color: { r: 245, g: 245, b: 247, a: 1 }, opacity: 1 }],
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
    children: [
      {
        ...base(`card-${index}-body`, `Card ${index + 1} body`, {
          x: 32,
          y: 124 + index * 260,
          width: 311,
          height: 60,
        }),
        type: 'text' as const,
        characters:
          'A longer paragraph of supporting copy that will wrap differently once the available width changes on a wider device.',
        typography: {
          fontFamily: 'Inter',
          fontSize: 14,
          fontWeight: 400,
          fontStyle: 'normal' as const,
          lineHeight: 20,
          lineHeightSource: 'explicit' as const,
          letterSpacing: 0,
          textAlign: 'left' as const,
          verticalAlign: 'top' as const,
          textTransform: 'none' as const,
          textDecoration: 'none' as const,
          color: { r: 90, g: 90, b: 96, a: 1 },
        },
        lines: [],
        textAutoResize: 'height' as const,
        overflow: 'visible' as const,
        constraints: { horizontal: 'left-right' as const, vertical: 'top' as const },
      },
    ],
  }));

  const tabBar: DesignNode = {
    ...base('tab-bar', 'Bottom tab bar', { x: 0, y: 812 - 56, width: 375, height: 56 }),
    type: 'container',
    position: 'fixed',
    safeAreaAnchor: 'bottom-inset',
    constraints: { horizontal: 'left-right', vertical: 'bottom' },
    fills: [{ type: 'solid', color: { r: 255, g: 255, b: 255, a: 1 }, opacity: 1 }],
    children: [],
  };

  const root: DesignNode = {
    ...base('root', 'Home', { x: 0, y: 0, width: 375, height: 812 }),
    type: 'scroll-container',
    clipsContent: true,
    constraints: { horizontal: 'left-right', vertical: 'top' },
    scroll: { axis: 'vertical', contentWidth: 375, contentHeight: scrollHeight },
    children: [header, ...cards, tabBar],
  };

  return {
    id: 'screen-1',
    name: 'Home',
    frame: { width: 375, height: 812 },
    scrollHeight,
    scrollHeightProvenance: measured('figma-node', 1),
    background: { r: 255, g: 255, b: 255, a: 1 },
    root,
  };
}

export function structuredDesign(screen = structuredScreen()): DesignDocument {
  return {
    id: 'design-1',
    sourceId: 'source-1',
    sourceHash: 'a'.repeat(64),
    sourceKind: 'figma',
    structure: 'figma',
    irVersion: DESIGN_IR_VERSION,
    parserVersion: PARSER_VERSION,
    createdAt: NOW,
    screens: [screen],
    fontsUsed: [{ family: 'Inter', weights: [400, 700] }],
    assetsUsed: [],
    notes: [],
  };
}

export function fixtureSource(kind: 'figma' | 'raster' = 'figma', width = 375, height = 2400): SourceDocument {
  return {
    id: 'source-1',
    projectId: 'project-1',
    kind,
    name: kind === 'raster' ? 'home.png' : 'Home',
    mimeType: kind === 'raster' ? 'image/png' : 'application/vnd.figma.node',
    byteSize: 1024,
    hash: 'a'.repeat(64),
    assetId: 'asset-1',
    width,
    height,
    exportScale: 1,
    exportScaleProvenance: measured('raster-pixels', 1),
    importedAt: NOW,
    parserVersion: PARSER_VERSION,
    immutable: true,
  };
}
