import {
  DESIGN_IR_VERSION,
  PARSER_VERSION,
  inferred,
  measured,
  newId,
  type Color,
  type DesignDocument,
  type DesignNode,
  type Screen,
  type SourceDocument,
} from '@dae/shared';
import {
  detectGradient,
  detectBackground,
  detectHorizontalBands,
  detectSegments,
  dropContained,
  edgeDensity,
  estimateCornerRadius,
  mergeNearby,
  type Segment,
} from './segmentation.js';
import { detectTextLines, groupTextLines, type TextBlock } from './text-detection.js';
import { boxArea, uniformity, type Box, type PixelData, type Rgb } from './pixels.js';
import {
  DESIGN_DNA_VERSION,
  buildPalette,
  buildTypeScale,
  detectEdgeMargin,
  detectGrid,
  type DesignDna,
} from './design-dna.js';
import { classifyRegion, countRepetitions, type Classification } from './classify.js';

export interface ReconstructionInput {
  source: SourceDocument;
  image: PixelData;
  /** Logical px per image px, when the export is 2x/3x. */
  scale?: number;
}

export interface ReconstructedRegion {
  nodeId: string;
  classification: Classification;
  box: Box;
  confidence: number;
}

export interface ReconstructionResult {
  design: DesignDocument;
  dna: DesignDna;
  regions: ReconstructedRegion[];
  /** Share of the document area covered by confidently reconstructed regions. */
  structuralCoverage: number;
  warnings: string[];
  timings: { totalMs: number; stages: Record<string, number> };
}

function toIrColor(color: Rgb, alpha = 1): Color {
  return { r: Math.round(color.r), g: Math.round(color.g), b: Math.round(color.b), a: alpha };
}

/**
 * Turn an uploaded bitmap into a semantic, reflowable Design IR.
 *
 * The output is *hybrid* by design (spec sections 8 and 37): regions the
 * analysis understands become real nodes with measured colour, type and
 * spacing, and everything else becomes an image node cropped from the original
 * bitmap. That is what makes the result both faithful and adaptable - the
 * layout can reflow to a new viewport while unreconstructable artwork is still
 * the designer's own pixels, never an invention.
 *
 * The uploaded file itself is untouched; this builds a parallel representation
 * that references it (spec section 3).
 */
export function reconstructRaster(input: ReconstructionInput): ReconstructionResult {
  const started = now();
  const stages: Record<string, number> = {};
  const warnings: string[] = [];
  const { image, source } = input;
  // Logical px per image px: a 2x export is analysed at image resolution but
  // described in logical units.
  const scale = input.scale ?? source.width / image.width;
  const toLogical = (value: number) => value * scale;

  // --- Background ---------------------------------------------------------
  let mark = now();
  const background = detectBackground(image);
  stages['background'] = now() - mark;

  // --- Bands and segments --------------------------------------------------
  mark = now();
  const bands = detectHorizontalBands(image, background.color, { minGap: Math.max(4, Math.round(6 / scale)) });
  const rawSegments: Segment[] = [];
  for (const band of bands) {
    const region: Box = { x: 0, y: band.y, width: image.width, height: band.height };
    const found = detectSegments(image, background.color, region, {
      grid: image.width > 900 ? 3 : 2,
      minArea: 40,
    });
    // Glyphs and icon parts arrive separately; merge what a designer would
    // select as one element before classifying.
    rawSegments.push(...mergeNearby(found, Math.round(10 / scale), Math.round(6 / scale)));
  }
  const segments = dropContained(rawSegments);
  stages['segmentation'] = now() - mark;

  if (segments.length === 0) {
    warnings.push(
      'No structure could be separated from the background, so the bitmap is kept whole and adapts by proportional scaling.',
    );
  }

  // --- Text ----------------------------------------------------------------
  mark = now();
  const textBySegment = new Map<Segment, TextBlock[]>();
  const allTextBlocks: TextBlock[] = [];
  for (const segment of segments) {
    const localBackground = segment.uniformity > 0.35 ? segment.color : background.color;
    const lines = detectTextLines(image, segment.box, localBackground);
    const blocks = groupTextLines(lines);
    if (blocks.length > 0) {
      textBySegment.set(segment, blocks);
      allTextBlocks.push(...blocks);
    }
  }
  stages['text'] = now() - mark;

  // --- Classification -------------------------------------------------------
  mark = now();
  const classified = segments.map((segment) => {
    const blocks = textBySegment.get(segment) ?? [];
    const radius = estimateCornerRadius(image, segment.box, segment.color);
    const density = edgeDensity(image, segment.box);
    const flatness = uniformity(image, segment.box, 2);
    const gradient = detectGradient(image, segment.box);

    const classification = classifyRegion({
      box: segment.box,
      frameWidth: image.width,
      documentY: segment.box.y,
      documentHeight: image.height,
      fill: segment.color,
      background: background.color,
      uniformity: flatness,
      edgeDensity: density,
      cornerRadius: radius,
      textBlocks: blocks,
      repetitionCount: countRepetitions(segment, segments),
      hasGradient: Boolean(gradient),
    });

    return { segment, classification, blocks, radius, gradient, flatness };
  });
  stages['classification'] = now() - mark;

  // --- Design DNA ------------------------------------------------------------
  mark = now();
  const palette = buildPalette([
    { color: background.color, weight: 6, kind: 'background' },
    ...classified
      .filter((entry) => entry.flatness > 0.5)
      .map((entry) => ({
        color: entry.segment.color,
        weight: boxArea(entry.segment.box) / boxArea({ x: 0, y: 0, width: image.width, height: image.height }),
        kind:
          entry.classification.componentType === 'CTA' || entry.classification.componentType === 'BUTTON'
            ? ('accent' as const)
            : ('surface' as const),
      })),
    ...allTextBlocks.map((block) => ({ color: block.color, weight: 0.02, kind: 'text' as const })),
  ]);

  const verticalGaps: number[] = [];
  const sortedByY = [...classified].sort((a, b) => a.segment.box.y - b.segment.box.y);
  for (let i = 1; i < sortedByY.length; i += 1) {
    const previous = sortedByY[i - 1]!.segment.box;
    const current = sortedByY[i]!.segment.box;
    const gap = current.y - (previous.y + previous.height);
    if (gap > 0) verticalGaps.push(toLogical(gap));
  }

  const grid = detectGrid(verticalGaps);
  const edgeMargin = detectEdgeMargin(
    classified.map((entry) => ({
      x: toLogical(entry.segment.box.x),
      y: toLogical(entry.segment.box.y),
      width: toLogical(entry.segment.box.width),
      height: toLogical(entry.segment.box.height),
    })),
    source.width,
  );

  const radii = [...new Set(classified.map((entry) => Math.round(toLogical(entry.radius))).filter((r) => r > 0))].sort(
    (a, b) => a - b,
  );

  const dna: DesignDna = {
    version: DESIGN_DNA_VERSION,
    colors: palette,
    typography: buildTypeScale(
      allTextBlocks.map((block) => ({
        ...block,
        fontSize: Math.round(toLogical(block.fontSize)),
        lineHeight: Math.round(toLogical(block.lineHeight)),
      })),
    ),
    spacing: {
      value: grid.spacing,
      measurementType: 'DETECTED',
      confidence: Math.min(0.9, verticalGaps.length / 12),
      source: 'Gaps measured between detected regions.',
    },
    grid: {
      value: grid.base,
      measurementType: grid.base === null ? 'UNKNOWN' : 'INFERRED',
      confidence: grid.confidence,
      source:
        grid.base === null
          ? 'No consistent spacing rhythm; the source is reproduced as measured rather than snapped to a grid.'
          : `${Math.round(grid.confidence * 100)}% of measured gaps are multiples of ${grid.base}px.`,
    },
    radii: {
      value: radii,
      measurementType: 'DETECTED',
      confidence: radii.length > 0 ? 0.7 : 0.3,
      source: 'Corner radii measured by walking in from each region corner.',
    },
    // Type is rasterised into the bitmap. The family is genuinely unknowable
    // from pixels, so it is reported as unknown rather than guessed
    // (spec section 53).
    fontFamily: {
      value: null,
      measurementType: 'UNKNOWN',
      confidence: 0,
      source:
        'Font family cannot be measured from a bitmap. Text regions keep the original pixels wherever the family would affect fidelity.',
    },
    edgeMargin: {
      value: edgeMargin.value,
      measurementType: edgeMargin.value === null ? 'UNKNOWN' : 'DETECTED',
      confidence: edgeMargin.confidence,
      source: 'Most common left edge among non-full-width regions.',
    },
    locked: true,
  };
  stages['design-dna'] = now() - mark;

  // --- Build the IR ---------------------------------------------------------
  mark = now();
  const regions: ReconstructedRegion[] = [];
  const children: DesignNode[] = [];
  let reconstructedArea = 0;
  const documentArea = image.width * image.height;

  for (const entry of sortedByY) {
    const { segment, classification, blocks, radius, gradient } = entry;
    const logicalBox: Box = {
      x: Math.round(toLogical(segment.box.x)),
      y: Math.round(toLogical(segment.box.y)),
      width: Math.round(toLogical(segment.box.width)),
      height: Math.round(toLogical(segment.box.height)),
    };
    const nodeId = newId('node');
    regions.push({ nodeId, classification, box: logicalBox, confidence: classification.confidence });

    if (classification.renderStrategy === 'RECONSTRUCT') reconstructedArea += boxArea(segment.box);

    children.push(
      buildNode({
        nodeId,
        source,
        image,
        segment,
        classification,
        blocks,
        radius: toLogical(radius),
        gradient,
        logicalBox,
        frameWidth: source.width,
        scale,
        edgeMargin: dna.edgeMargin.value,
      }),
    );
  }
  stages['ir'] = now() - mark;

  const structuralCoverage = documentArea === 0 ? 0 : reconstructedArea / documentArea;

  const root: DesignNode = {
    id: newId('node'),
    name: source.name,
    type: 'scroll-container',
    scroll: { axis: 'vertical', contentWidth: source.width, contentHeight: source.height },
    children,
    frame: { x: 0, y: 0, width: source.width, height: source.height },
    opacity: 1,
    rotation: 0,
    visible: true,
    clipsContent: true,
    zIndex: 0,
    position: 'flow',
    safeAreaAnchor: 'none',
    constraints: { horizontal: 'left-right', vertical: 'top' },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    fills: [{ type: 'solid', color: toIrColor(background.color), opacity: 1 }],
    strokes: [],
    shadows: [],
    provenance: measured('raster-pixels', background.confidence),
    fieldQuality: {},
  };

  const screen: Screen = {
    id: newId('screen'),
    name: source.name,
    // The authored frame is the bitmap's own width; its height is the full
    // document, not a viewport. How much of it is visible is the device's
    // business, not the design's (spec section 9).
    frame: { width: source.width, height: source.height },
    scrollHeight: source.height,
    scrollHeightProvenance: measured('raster-pixels', 1),
    background: toIrColor(background.color),
    root,
  };

  if (structuralCoverage < 0.25) {
    warnings.push(
      `Only ${Math.round(structuralCoverage * 100)}% of the document could be confidently reconstructed; the rest is preserved as original artwork and will not reflow.`,
    );
  }
  if (dna.typography.length === 0) {
    warnings.push('No text was detected, so no type scale could be extracted.');
  }

  const design: DesignDocument = {
    id: newId('design'),
    sourceId: source.id,
    sourceHash: source.hash,
    sourceKind: 'raster',
    structure: 'reconstructed',
    irVersion: DESIGN_IR_VERSION,
    parserVersion: PARSER_VERSION,
    createdAt: new Date().toISOString(),
    screens: [screen],
    fontsUsed: [],
    assetsUsed: [source.assetId],
    notes: [
      'Reconstructed from a bitmap: the uploaded file is unchanged and remains the visual reference.',
      `${regions.filter((r) => r.classification.renderStrategy === 'RECONSTRUCT').length} of ${regions.length} regions were reconstructed as components; the rest keep the original pixels.`,
    ],
  };

  return {
    design,
    dna,
    regions,
    structuralCoverage,
    warnings,
    timings: { totalMs: now() - started, stages },
  };
}

interface BuildNodeInput {
  nodeId: string;
  source: SourceDocument;
  image: PixelData;
  segment: Segment;
  classification: Classification;
  blocks: TextBlock[];
  radius: number;
  gradient: ReturnType<typeof detectGradient>;
  logicalBox: Box;
  frameWidth: number;
  scale: number;
  edgeMargin: number | null;
}

/** Normalised crop rect of a source-pixel box, for an image node. */
function cropOf(box: Box, image: PixelData) {
  return {
    x: box.x / image.width,
    y: box.y / image.height,
    width: box.width / image.width,
    height: box.height / image.height,
  };
}

/**
 * A region of the original bitmap, placed where it was found.
 *
 * This is the workhorse of the hybrid strategy: the pixels are the designer's
 * own, so fidelity is exact, while the node around them carries real geometry
 * and can therefore reflow.
 */
function rasterNode(
  input: BuildNodeInput,
  args: {
    nodeId: string;
    name: string;
    sourceBox: Box;
    logicalBox: Box;
    constraints: { horizontal: 'left' | 'left-right' | 'right' | 'center'; vertical: 'top' };
    analysis: DesignNode['analysis'];
    confidence: number;
    note: string;
  },
): DesignNode {
  return {
    id: args.nodeId,
    name: args.name,
    type: 'image',
    assetId: input.source.assetId,
    naturalWidth: Math.max(1, args.sourceBox.width),
    naturalHeight: Math.max(1, args.sourceBox.height),
    scaleMode: 'stretch',
    crop: cropOf(args.sourceBox, input.image),
    altText: args.name,
    frame: args.logicalBox,
    opacity: 1,
    rotation: 0,
    visible: true,
    clipsContent: false,
    zIndex: 0,
    position: 'flow',
    safeAreaAnchor: 'none',
    constraints: args.constraints,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    fills: [],
    strokes: [],
    shadows: [],
    analysis: args.analysis,
    provenance: inferred('raster-analysis', args.confidence, args.note),
    fieldQuality: { crop: measured('raster-pixels', 1) },
  };
}

function buildNode(input: BuildNodeInput): DesignNode {
  const { nodeId, segment, classification, blocks, radius, logicalBox, frameWidth, scale } = input;
  const toLogical = (value: number) => value * scale;

  const isFullWidth = logicalBox.width >= frameWidth - 4;
  const leftGap = logicalBox.x;
  const rightGap = frameWidth - (logicalBox.x + logicalBox.width);
  // Equal margins on both sides mean the element was authored to span the
  // content width, so it should follow the viewport. One pinned to a single
  // edge keeps its size.
  const spansContentWidth = Math.abs(leftGap - rightGap) <= 2 && leftGap > 0;
  const horizontal: 'left' | 'left-right' = isFullWidth || spansContentWidth ? 'left-right' : 'left';

  const primary = blocks[0];
  const analysis: DesignNode['analysis'] = {
    componentType: classification.componentType,
    semanticRole: classification.semanticRole,
    renderStrategy: classification.renderStrategy,
    confidence: classification.confidence,
    reasons: classification.reasons,
    ...(primary
      ? {
          typography: {
            fontSize: Math.max(1, Math.round(toLogical(primary.fontSize))),
            fontWeight: primary.fontWeight,
            lineHeight: Math.max(1, Math.round(toLogical(primary.lineHeight))),
            color: toIrColor(primary.color),
            align: primary.align,
            lineCount: primary.lines.length,
          },
        }
      : {}),
  };

  const name = `${classification.componentType} ${Math.round(logicalBox.y)}`;

  // --- Preserved artwork, and text ------------------------------------------
  // Text is preserved rather than re-set: the font family is genuinely
  // unknowable from a bitmap, so re-typing it in a substitute face would change
  // the design. The measured metrics travel alongside as metadata, which is
  // what Dev Mode reports (spec sections 6 and 8).
  const preserveWhole =
    classification.renderStrategy !== 'RECONSTRUCT' ||
    classification.componentType === 'HEADING' ||
    classification.componentType === 'BODY' ||
    classification.componentType === 'CAPTION';

  if (preserveWhole) {
    return rasterNode(input, {
      nodeId,
      name,
      sourceBox: segment.box,
      logicalBox,
      constraints: { horizontal, vertical: 'top' },
      analysis,
      confidence: classification.confidence,
      note: `${classification.componentType}: ${classification.reasons.join(' ')}`,
    });
  }

  // --- Reconstructed surface, with its contents nested ----------------------
  const gradientFill = input.gradient
    ? ({
        type: 'gradient' as const,
        gradientType: 'linear' as const,
        angle: input.gradient.direction === 'vertical' ? 90 : 0,
        stops: [
          { position: 0, color: toIrColor(input.gradient.from) },
          { position: 1, color: toIrColor(input.gradient.to) },
        ],
        opacity: 1,
      })
    : undefined;

  // Each text block inside the surface becomes its own inspectable child,
  // carrying its own crop of the original glyphs.
  const children: DesignNode[] = blocks.map((block, index) => {
    const childLogical: Box = {
      x: Math.round(toLogical(block.box.x)),
      y: Math.round(toLogical(block.box.y)),
      width: Math.round(toLogical(block.box.width)),
      height: Math.round(toLogical(block.box.height)),
    };
    const childLeft = childLogical.x - logicalBox.x;
    const childRight = logicalBox.x + logicalBox.width - (childLogical.x + childLogical.width);
    return rasterNode(input, {
      nodeId: newId('node'),
      name: `Text ${index + 1}`,
      sourceBox: block.box,
      logicalBox: childLogical,
      constraints: {
        // Text that sits with equal margins inside its container was laid out
        // to the container's width and should follow it.
        horizontal: Math.abs(childLeft - childRight) <= 2 ? 'left-right' : 'left',
        vertical: 'top',
      },
      analysis: {
        componentType: 'BODY',
        semanticRole: 'text',
        renderStrategy: 'PRESERVE_RASTER',
        confidence: block.confidence,
        reasons: [
          `Text measured at ${Math.round(toLogical(block.fontSize))}px over ${block.lines.length} line${block.lines.length === 1 ? '' : 's'}.`,
        ],
        typography: {
          fontSize: Math.max(1, Math.round(toLogical(block.fontSize))),
          fontWeight: block.fontWeight,
          lineHeight: Math.max(1, Math.round(toLogical(block.lineHeight))),
          color: toIrColor(block.color),
          align: block.align,
          lineCount: block.lines.length,
        },
      },
      confidence: block.confidence,
      note: 'Original glyph pixels preserved; the metrics beside them are measured, not re-set.',
    });
  });

  return {
    id: nodeId,
    name,
    type: 'container',
    children,
    frame: logicalBox,
    opacity: 1,
    rotation: 0,
    visible: true,
    clipsContent: false,
    zIndex: 0,
    position: 'flow',
    safeAreaAnchor: 'none',
    constraints: { horizontal, vertical: 'top' },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius },
    fills: [gradientFill ?? { type: 'solid', color: toIrColor(segment.color), opacity: 1 }],
    strokes: [],
    shadows: [],
    ...(classification.componentType === 'CTA' || classification.componentType === 'BUTTON'
      ? { interaction: { role: 'button' as const } }
      : {}),
    analysis,
    provenance: inferred(
      'raster-analysis',
      classification.confidence,
      `${classification.componentType}: ${classification.reasons.join(' ')}`,
    ),
    fieldQuality: {
      'fills.0': inferred('raster-analysis', segment.uniformity, 'Modal colour of the region.'),
      cornerRadius: inferred('raster-analysis', radius > 0 ? 0.7 : 0.4, 'Measured along the corner diagonal.'),
    },
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
