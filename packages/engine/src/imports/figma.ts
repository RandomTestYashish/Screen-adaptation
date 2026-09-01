import {
  DESIGN_IR_VERSION,
  PARSER_VERSION,
  newId,
  measured,
  inferred,
  type Color,
  type Constraints,
  type DesignDocument,
  type DesignNode,
  type EdgeInsets,
  type Fill,
  type Screen,
  type Shadow,
  type SourceDocument,
  type Stroke,
  type Typography,
} from '@dae/shared';
import { derivedLineHeight } from '../layout/text-measure.js';

/**
 * Minimal structural typing of the Figma REST `GET /v1/files/:key/nodes`
 * response. We deliberately type only the fields we consume so an upstream
 * addition never breaks the import.
 *
 * Spec section 16: "For Figma input, prefer deterministic Figma node metadata
 * over AI guesses." No inference happens here beyond documented fallbacks,
 * each of which is recorded as `inferred` in the node's provenance.
 */
export interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
  gradientStops?: { position: number; color: { r: number; g: number; b: number; a?: number } }[];
  gradientHandlePositions?: { x: number; y: number }[];
  imageRef?: string;
  scaleMode?: string;
}

export interface FigmaEffect {
  type: string;
  visible?: boolean;
  radius?: number;
  spread?: number;
  color?: { r: number; g: number; b: number; a?: number };
  offset?: { x: number; y: number };
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  absoluteRenderBounds?: { x: number; y: number; width: number; height: number } | null;
  clipsContent?: boolean;
  children?: FigmaNode[];
  constraints?: { vertical?: string; horizontal?: string };
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  effects?: FigmaEffect[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  characters?: string;
  style?: {
    fontFamily?: string;
    fontPostScriptName?: string | null;
    fontWeight?: number;
    fontSize?: number;
    lineHeightPx?: number;
    lineHeightUnit?: string;
    letterSpacing?: number;
    textAlignHorizontal?: string;
    textAlignVertical?: string;
    textCase?: string;
    textDecoration?: string;
    textAutoResize?: string;
  };
  strokeDashes?: number[];
  fillGeometry?: { path: string; windingRule?: string }[];
  overflowDirection?: string;
}

export interface FigmaImportInput {
  source: SourceDocument;
  node: FigmaNode;
  /** Map of Figma `imageRef` -> asset id in our own store. */
  imageAssets?: Record<string, string>;
}

function toColor(input: { r: number; g: number; b: number; a?: number } | undefined, opacity = 1): Color {
  if (!input) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round(input.r * 255),
    g: Math.round(input.g * 255),
    b: Math.round(input.b * 255),
    a: Number(((input.a ?? 1) * opacity).toFixed(4)),
  };
}

function mapConstraints(node: FigmaNode): Constraints {
  const h = node.constraints?.horizontal ?? 'LEFT';
  const v = node.constraints?.vertical ?? 'TOP';
  const hMap: Record<string, Constraints['horizontal']> = {
    LEFT: 'left',
    RIGHT: 'right',
    LEFT_RIGHT: 'left-right',
    CENTER: 'center',
    SCALE: 'scale',
  };
  const vMap: Record<string, Constraints['vertical']> = {
    TOP: 'top',
    BOTTOM: 'bottom',
    TOP_BOTTOM: 'top-bottom',
    CENTER: 'center',
    SCALE: 'scale',
  };
  return { horizontal: hMap[h] ?? 'left', vertical: vMap[v] ?? 'top' };
}

function mapFills(paints: FigmaPaint[] | undefined, imageAssets: Record<string, string>): Fill[] {
  if (!paints) return [];
  const fills: Fill[] = [];
  for (const paint of paints) {
    if (paint.visible === false) continue;
    const opacity = paint.opacity ?? 1;
    if (paint.type === 'SOLID') {
      fills.push({ type: 'solid', color: toColor(paint.color), opacity });
    } else if (paint.type.startsWith('GRADIENT')) {
      const kind = paint.type.replace('GRADIENT_', '').toLowerCase();
      const gradientType =
        kind === 'linear' ? 'linear' : kind === 'radial' ? 'radial' : kind === 'angular' ? 'angular' : 'diamond';
      fills.push({
        type: 'gradient',
        gradientType,
        angle: gradientAngle(paint),
        stops: (paint.gradientStops ?? []).map((stop) => ({
          position: stop.position,
          color: toColor(stop.color),
        })),
        opacity,
      });
    } else if (paint.type === 'IMAGE' && paint.imageRef) {
      const assetId = imageAssets[paint.imageRef];
      if (assetId) {
        fills.push({
          type: 'image',
          assetId,
          scaleMode: (paint.scaleMode ?? 'FILL').toLowerCase() as 'fill' | 'fit' | 'stretch' | 'tile',
          opacity,
        });
      }
    }
  }
  return fills;
}

function gradientAngle(paint: FigmaPaint): number {
  const handles = paint.gradientHandlePositions;
  if (!handles || handles.length < 2) return 0;
  const [start, end] = handles;
  if (!start || !end) return 0;
  return Number(((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI).toFixed(2));
}

function mapStrokes(node: FigmaNode): Stroke[] {
  if (!node.strokes || node.strokes.length === 0 || !node.strokeWeight) return [];
  const align = (node.strokeAlign ?? 'INSIDE').toLowerCase() as Stroke['align'];
  return node.strokes
    .filter((s) => s.visible !== false && s.type === 'SOLID')
    .map((s) => ({
      color: toColor(s.color, s.opacity ?? 1),
      weight: node.strokeWeight ?? 1,
      align,
      style: node.strokeDashes && node.strokeDashes.length > 0 ? ('dashed' as const) : ('solid' as const),
    }));
}

function mapShadows(node: FigmaNode): Shadow[] {
  return (node.effects ?? [])
    .filter((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map((e) => ({
      type: e.type === 'INNER_SHADOW' ? ('inner' as const) : ('drop' as const),
      offsetX: e.offset?.x ?? 0,
      offsetY: e.offset?.y ?? 0,
      blur: e.radius ?? 0,
      spread: e.spread ?? 0,
      color: toColor(e.color),
    }));
}

function mapPadding(node: FigmaNode): EdgeInsets {
  return {
    top: node.paddingTop ?? 0,
    right: node.paddingRight ?? 0,
    bottom: node.paddingBottom ?? 0,
    left: node.paddingLeft ?? 0,
  };
}

function mapTypography(node: FigmaNode): { typography: Typography; lineHeightInferred: boolean } {
  const style = node.style ?? {};
  const fontSize = style.fontSize ?? 16;
  const explicit = typeof style.lineHeightPx === 'number' && style.lineHeightPx > 0;
  const alignMap: Record<string, Typography['textAlign']> = {
    LEFT: 'left',
    CENTER: 'center',
    RIGHT: 'right',
    JUSTIFIED: 'justify',
  };
  const vAlignMap: Record<string, Typography['verticalAlign']> = { TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' };
  const caseMap: Record<string, Typography['textTransform']> = {
    UPPER: 'uppercase',
    LOWER: 'lowercase',
    TITLE: 'capitalize',
    ORIGINAL: 'none',
  };
  const decorationMap: Record<string, Typography['textDecoration']> = {
    UNDERLINE: 'underline',
    STRIKETHROUGH: 'line-through',
    NONE: 'none',
  };
  const textFill = (node.fills ?? []).find((f) => f.type === 'SOLID' && f.visible !== false);

  return {
    lineHeightInferred: !explicit,
    typography: {
      fontFamily: style.fontFamily ?? 'Unknown',
      ...(style.fontPostScriptName ? { fontPostScriptName: style.fontPostScriptName } : {}),
      fontSize,
      fontWeight: style.fontWeight ?? 400,
      fontStyle: 'normal',
      lineHeight: explicit ? style.lineHeightPx! : derivedLineHeight(fontSize),
      lineHeightSource: explicit ? 'explicit' : 'derived-from-font-size',
      letterSpacing: style.letterSpacing ?? 0,
      textAlign: alignMap[style.textAlignHorizontal ?? 'LEFT'] ?? 'left',
      verticalAlign: vAlignMap[style.textAlignVertical ?? 'TOP'] ?? 'top',
      textTransform: caseMap[style.textCase ?? 'ORIGINAL'] ?? 'none',
      textDecoration: decorationMap[style.textDecoration ?? 'NONE'] ?? 'none',
      color: toColor(textFill?.color, textFill?.opacity ?? 1),
    },
  };
}

/** Frame-relative coordinates: the IR uses document space, Figma uses canvas space. */
interface ImportContext {
  originX: number;
  originY: number;
  imageAssets: Record<string, string>;
  fonts: Map<string, Set<number>>;
  assets: Set<string>;
  index: { value: number };
}

function convertNode(node: FigmaNode, ctx: ImportContext, depth: number): DesignNode | null {
  if (node.visible === false) return null;
  const box = node.absoluteBoundingBox;
  if (!box) return null;

  const frame = {
    x: box.x - ctx.originX,
    y: box.y - ctx.originY,
    width: box.width,
    height: box.height,
  };

  const radii = node.rectangleCornerRadii;
  const uniform = node.cornerRadius ?? 0;
  const cornerRadius = radii
    ? { topLeft: radii[0], topRight: radii[1], bottomRight: radii[2], bottomLeft: radii[3] }
    : { topLeft: uniform, topRight: uniform, bottomRight: uniform, bottomLeft: uniform };

  const base = {
    id: newId('node'),
    name: node.name,
    frame,
    opacity: node.opacity ?? 1,
    rotation: node.rotation ?? 0,
    visible: true,
    clipsContent: node.clipsContent ?? false,
    zIndex: ctx.index.value++,
    position: (node.layoutPositioning === 'ABSOLUTE' ? 'absolute' : 'flow') as 'absolute' | 'flow',
    safeAreaAnchor: 'none' as const,
    constraints: mapConstraints(node),
    padding: mapPadding(node),
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius,
    fills: mapFills(node.fills, ctx.imageAssets),
    strokes: mapStrokes(node),
    shadows: mapShadows(node),
    ...(node.layoutMode && node.layoutMode !== 'NONE'
      ? {
          autoLayout: {
            direction:
              node.layoutWrap === 'WRAP'
                ? ('wrap' as const)
                : node.layoutMode === 'HORIZONTAL'
                  ? ('horizontal' as const)
                  : ('vertical' as const),
            gap: node.itemSpacing ?? 0,
            padding: mapPadding(node),
            primaryAxisSizing: node.primaryAxisSizingMode === 'AUTO' ? ('hug' as const) : ('fixed' as const),
            counterAxisSizing: node.counterAxisSizingMode === 'AUTO' ? ('hug' as const) : ('fixed' as const),
            primaryAxisAlign: mapAlign(node.primaryAxisAlignItems),
            counterAxisAlign: mapCounterAlign(node.counterAxisAlignItems),
          },
        }
      : {}),
    provenance: measured('figma-node', 1, node.id),
    fieldQuality: {},
  };

  for (const fill of base.fills) if (fill.type === 'image') ctx.assets.add(fill.assetId);

  if (node.type === 'TEXT' && typeof node.characters === 'string') {
    const { typography, lineHeightInferred } = mapTypography(node);
    const weights = ctx.fonts.get(typography.fontFamily) ?? new Set<number>();
    weights.add(typography.fontWeight);
    ctx.fonts.set(typography.fontFamily, weights);
    return {
      ...base,
      type: 'text',
      characters: node.characters,
      typography,
      lines: [],
      textAutoResize: mapAutoResize(node.style?.textAutoResize),
      overflow: 'visible',
      fieldQuality: lineHeightInferred
        ? {
            'typography.lineHeight': inferred(
              'heuristic',
              0.8,
              'Figma reported no explicit line height; derived as 1.2 x font size, matching CSS `normal`.',
            ),
          }
        : {},
    };
  }

  const imageFill = (node.fills ?? []).find((f) => f.type === 'IMAGE' && f.imageRef && f.visible !== false);
  if (imageFill?.imageRef && ctx.imageAssets[imageFill.imageRef] && (node.children ?? []).length === 0) {
    const assetId = ctx.imageAssets[imageFill.imageRef]!;
    ctx.assets.add(assetId);
    return {
      ...base,
      type: 'image',
      assetId,
      naturalWidth: frame.width,
      naturalHeight: frame.height,
      scaleMode: (imageFill.scaleMode ?? 'FILL').toLowerCase() as 'fill' | 'fit' | 'stretch' | 'tile',
      fieldQuality: {
        naturalWidth: inferred('heuristic', 0.5, 'Figma does not expose intrinsic image size in node metadata.'),
        naturalHeight: inferred('heuristic', 0.5, 'Figma does not expose intrinsic image size in node metadata.'),
      },
    };
  }

  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'LINE') {
    return {
      ...base,
      type: 'vector',
      paths: (node.fillGeometry ?? []).map((g) => ({
        d: g.path,
        fillRule: (g.windingRule ?? 'NONZERO').toLowerCase() === 'evenodd' ? ('evenodd' as const) : ('nonzero' as const),
      })),
      viewBox: { x: 0, y: 0, width: frame.width, height: frame.height },
    };
  }

  const children = (node.children ?? [])
    .map((child) => convertNode(child, ctx, depth + 1))
    .filter((n): n is DesignNode => n !== null);

  if (children.length === 0 && (node.type === 'RECTANGLE' || node.type === 'ELLIPSE')) {
    return { ...base, type: 'shape', shape: node.type === 'ELLIPSE' ? 'ellipse' : 'rectangle' };
  }

  // A frame with `overflowDirection` set is an explicit scroll region in Figma
  // prototyping; treat it as a real scroll container (spec section 8).
  if (node.overflowDirection && node.overflowDirection !== 'NONE') {
    const contentHeight = children.reduce((max, c) => Math.max(max, c.frame.y + c.frame.height), frame.height) - frame.y;
    return {
      ...base,
      type: 'scroll-container',
      scroll: {
        axis: node.overflowDirection.includes('HORIZONTAL')
          ? node.overflowDirection.includes('VERTICAL')
            ? 'both'
            : 'horizontal'
          : 'vertical',
        contentWidth: frame.width,
        contentHeight: Math.max(frame.height, contentHeight),
      },
      children,
    };
  }

  return { ...base, type: 'container', children };
}

function mapAlign(value: string | undefined) {
  const map: Record<string, 'start' | 'center' | 'end' | 'space-between'> = {
    MIN: 'start',
    CENTER: 'center',
    MAX: 'end',
    SPACE_BETWEEN: 'space-between',
  };
  return map[value ?? 'MIN'] ?? 'start';
}

function mapCounterAlign(value: string | undefined) {
  const map: Record<string, 'start' | 'center' | 'end' | 'baseline' | 'stretch'> = {
    MIN: 'start',
    CENTER: 'center',
    MAX: 'end',
    BASELINE: 'baseline',
  };
  return map[value ?? 'MIN'] ?? 'start';
}

function mapAutoResize(value: string | undefined) {
  const map: Record<string, 'none' | 'width' | 'height' | 'width-and-height'> = {
    NONE: 'none',
    HEIGHT: 'height',
    WIDTH_AND_HEIGHT: 'width-and-height',
    TRUNCATE: 'none',
  };
  return map[value ?? 'NONE'] ?? 'none';
}

/**
 * Convert a Figma frame into the Design IR, preserving node ids, hierarchy,
 * text, fills, strokes, effects, constraints and Auto Layout metadata.
 *
 * The source file is never written to: this produces a separate representation
 * that links back via `sourceId` / `sourceHash` (spec section 2).
 */
export function buildFigmaDesign(input: FigmaImportInput): DesignDocument {
  const { source, node } = input;
  const box = node.absoluteBoundingBox;
  if (!box) throw new Error(`Figma node ${node.id} has no absoluteBoundingBox and cannot be imported`);

  const ctx: ImportContext = {
    originX: box.x,
    originY: box.y,
    imageAssets: input.imageAssets ?? {},
    fonts: new Map(),
    assets: new Set(),
    index: { value: 0 },
  };

  const children = (node.children ?? [])
    .map((child) => convertNode(child, ctx, 1))
    .filter((n): n is DesignNode => n !== null);

  const contentHeight = children.reduce((max, c) => Math.max(max, c.frame.y + c.frame.height), box.height);
  const contentWidth = children.reduce((max, c) => Math.max(max, c.frame.x + c.frame.width), box.width);

  const root: DesignNode = {
    id: newId('node'),
    name: node.name,
    type: 'scroll-container',
    scroll: { axis: 'vertical', contentWidth, contentHeight },
    children,
    frame: { x: 0, y: 0, width: box.width, height: box.height },
    opacity: node.opacity ?? 1,
    rotation: 0,
    visible: true,
    clipsContent: true,
    zIndex: 0,
    position: 'flow',
    safeAreaAnchor: 'none',
    constraints: { horizontal: 'left-right', vertical: 'top' },
    padding: mapPadding(node),
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    fills: mapFills(node.fills, ctx.imageAssets),
    strokes: [],
    shadows: [],
    ...(node.layoutMode && node.layoutMode !== 'NONE'
      ? {
          autoLayout: {
            direction: node.layoutMode === 'HORIZONTAL' ? ('horizontal' as const) : ('vertical' as const),
            gap: node.itemSpacing ?? 0,
            padding: mapPadding(node),
            primaryAxisSizing: node.primaryAxisSizingMode === 'AUTO' ? ('hug' as const) : ('fixed' as const),
            counterAxisSizing: node.counterAxisSizingMode === 'AUTO' ? ('hug' as const) : ('fixed' as const),
            primaryAxisAlign: mapAlign(node.primaryAxisAlignItems),
            counterAxisAlign: mapCounterAlign(node.counterAxisAlignItems),
          },
        }
      : {}),
    provenance: measured('figma-node', 1, node.id),
    fieldQuality: {},
  };

  const screen: Screen = {
    id: newId('screen'),
    name: node.name,
    frame: { width: box.width, height: box.height },
    scrollHeight: Math.max(box.height, contentHeight),
    scrollHeightProvenance:
      contentHeight > box.height
        ? inferred('heuristic', 0.9, 'Derived from the bottom-most child bounds, which extend past the frame.')
        : measured('figma-node', 1, node.id),
    root,
  };

  return {
    id: newId('design'),
    sourceId: source.id,
    sourceHash: source.hash,
    sourceKind: 'figma',
    structure: 'figma',
    irVersion: DESIGN_IR_VERSION,
    parserVersion: PARSER_VERSION,
    createdAt: new Date().toISOString(),
    screens: [screen],
    fontsUsed: [...ctx.fonts.entries()].map(([family, weights]) => ({ family, weights: [...weights] })),
    assetsUsed: [...ctx.assets],
    notes: ['Structured Figma source: node ids, hierarchy and Auto Layout metadata preserved.'],
  };
}
