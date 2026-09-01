import {
  DESIGN_IR_VERSION,
  PARSER_VERSION,
  newId,
  measured,
  inferred,
  type DesignDocument,
  type DesignNode,
  type Screen,
  type SourceDocument,
} from '@dae/shared';

export interface RasterAnalysisRegion {
  /** Region in *source logical px*. */
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'text' | 'image' | 'button' | 'container' | 'icon' | 'divider';
  text?: string;
  confidence: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  lineHeight?: number;
  color?: { r: number; g: number; b: number; a: number };
}

export interface RasterImportInput {
  source: SourceDocument;
  /** Optional CV/OCR output. Purely additive - never replaces the artwork. */
  analysis?: { regions: RasterAnalysisRegion[]; provider: string; model: string };
}

const FULL_SCALE_CONSTRAINTS = { horizontal: 'scale', vertical: 'scale' } as const;

/**
 * Build a Design IR for an uploaded bitmap.
 *
 * Spec section 2: "If the source is an image, treat it as immutable visual
 * content. Do not hallucinate editable structure and then substitute it for the
 * original image."
 *
 * The rendered tree therefore contains exactly one image node covering the
 * whole document. Any analysis lives in `screen.analysisOverlay`, which the
 * renderer never draws.
 */
export function buildRasterDesign(input: RasterImportInput): DesignDocument {
  const { source } = input;
  const width = source.width;
  const height = source.height;

  const image: DesignNode = {
    id: newId('node'),
    name: source.name,
    type: 'image',
    assetId: source.assetId,
    naturalWidth: source.pixelWidth ?? width,
    naturalHeight: source.pixelHeight ?? height,
    // `stretch` keeps the exact source aspect: the node box always matches the
    // image aspect, so this never crops or letterboxes.
    scaleMode: 'stretch',
    frame: { x: 0, y: 0, width, height },
    opacity: 1,
    rotation: 0,
    visible: true,
    clipsContent: false,
    zIndex: 0,
    position: 'flow',
    safeAreaAnchor: 'none',
    constraints: FULL_SCALE_CONSTRAINTS,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    fills: [],
    strokes: [],
    shadows: [],
    provenance: measured('raster-pixels', 1),
    fieldQuality: {
      'frame.width': measured('raster-pixels', 1),
      'frame.height': measured('raster-pixels', 1),
    },
  };

  const root: DesignNode = {
    id: newId('node'),
    name: 'Document',
    type: 'scroll-container',
    scroll: { axis: 'vertical', contentWidth: width, contentHeight: height },
    children: [image],
    frame: { x: 0, y: 0, width, height },
    opacity: 1,
    rotation: 0,
    visible: true,
    clipsContent: true,
    zIndex: 0,
    position: 'flow',
    safeAreaAnchor: 'none',
    constraints: FULL_SCALE_CONSTRAINTS,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    fills: [],
    strokes: [],
    shadows: [],
    provenance: measured('raster-pixels', 1),
    fieldQuality: {},
  };

  const screen: Screen = {
    id: newId('screen'),
    name: source.name,
    // A bitmap export declares no separate "viewport": the authored width is
    // the frame width and the full bitmap height is the scroll height.
    frame: { width, height: Math.min(height, inferViewportHeight(width, height)) },
    scrollHeight: height,
    scrollHeightProvenance: measured('raster-pixels', 1),
    root,
  };

  if (input.analysis && input.analysis.regions.length > 0) {
    screen.analysisOverlay = buildAnalysisOverlay(input.analysis, width, height);
  }

  const doc: DesignDocument = {
    id: newId('design'),
    sourceId: source.id,
    sourceHash: source.hash,
    sourceKind: 'raster',
    // No reconstruction ran, so there is nothing to reflow.
    structure: 'flat',
    irVersion: DESIGN_IR_VERSION,
    parserVersion: PARSER_VERSION,
    createdAt: new Date().toISOString(),
    screens: [screen],
    fontsUsed: collectAnalysisFonts(input.analysis?.regions ?? []),
    assetsUsed: [source.assetId],
    notes: [
      'Raster source: the uploaded bitmap is the authoritative visual output and is never regenerated.',
      ...(input.analysis
        ? [
            `Structure detected by ${input.analysis.provider}/${input.analysis.model} is stored as a non-rendering analysis overlay used only for inspection and validation.`,
          ]
        : []),
    ],
  };
  return doc;
}

/**
 * A tall export gives no direct evidence of the authored viewport height. We
 * infer a plausible one from the width using the common 19.5:9 phone aspect,
 * and mark it inferred so the UI never presents it as measured.
 */
export function inferViewportHeight(width: number, documentHeight: number): number {
  const assumed = Math.round(width * (19.5 / 9));
  return Math.min(assumed, documentHeight);
}

function buildAnalysisOverlay(
  analysis: NonNullable<RasterImportInput['analysis']>,
  width: number,
  height: number,
): DesignNode {
  const children: DesignNode[] = analysis.regions.map((region, index) => {
    const base = {
      id: newId('analysis'),
      name: region.text ? truncate(region.text, 40) : `${region.kind} ${index + 1}`,
      frame: { x: region.x, y: region.y, width: region.width, height: region.height },
      opacity: 1,
      rotation: 0,
      visible: true,
      clipsContent: false,
      zIndex: index,
      position: 'flow' as const,
      safeAreaAnchor: 'none' as const,
      constraints: FULL_SCALE_CONSTRAINTS,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      fills: [],
      strokes: [],
      shadows: [],
      provenance: inferred('raster-analysis', region.confidence, `${analysis.provider}/${analysis.model}`),
      fieldQuality: {},
    };

    if (region.kind === 'text' && region.text) {
      const fontSize = region.fontSize ?? Math.max(8, Math.round(region.height * 0.72));
      return {
        ...base,
        type: 'text' as const,
        characters: region.text,
        typography: {
          fontFamily: region.fontFamily ?? 'Unknown',
          fontSize,
          fontWeight: region.fontWeight ?? 400,
          fontStyle: 'normal' as const,
          lineHeight: region.lineHeight ?? Math.round(fontSize * 1.4),
          lineHeightSource: region.lineHeight ? ('explicit' as const) : ('derived-from-font-size' as const),
          letterSpacing: 0,
          textAlign: 'left' as const,
          verticalAlign: 'top' as const,
          textTransform: 'none' as const,
          textDecoration: 'none' as const,
          color: region.color ?? { r: 0, g: 0, b: 0, a: 1 },
        },
        lines: [],
        textAutoResize: 'none' as const,
        overflow: 'visible' as const,
      };
    }
    return { ...base, type: 'shape' as const, shape: 'rectangle' as const };
  });

  return {
    id: newId('analysis-root'),
    name: 'Analysis overlay (not rendered)',
    type: 'container',
    children,
    frame: { x: 0, y: 0, width, height },
    opacity: 1,
    rotation: 0,
    visible: false,
    clipsContent: false,
    zIndex: 0,
    position: 'flow',
    safeAreaAnchor: 'none',
    constraints: FULL_SCALE_CONSTRAINTS,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    fills: [],
    strokes: [],
    shadows: [],
    provenance: inferred('raster-analysis', 0.5, 'Non-rendering overlay'),
    fieldQuality: {},
  };
}

function collectAnalysisFonts(regions: RasterAnalysisRegion[]) {
  const byFamily = new Map<string, Set<number>>();
  for (const region of regions) {
    if (region.kind !== 'text' || !region.fontFamily) continue;
    const set = byFamily.get(region.fontFamily) ?? new Set<number>();
    set.add(region.fontWeight ?? 400);
    byFamily.set(region.fontFamily, set);
  }
  return [...byFamily.entries()].map(([family, weights]) => ({ family, weights: [...weights] }));
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
