import { z } from 'zod';
import {
  ColorSchema,
  CornerRadiusSchema,
  EdgeInsetsSchema,
  FillSchema,
  LogicalPx,
  RectSchema,
  ShadowSchema,
  StrokeSchema,
  TypographySchema,
} from './primitives.js';
import { ProvenanceSchema } from './provenance.js';

/**
 * Constraint model, deliberately mirroring Figma's constraint vocabulary so a
 * structured import is loss-free, while still being expressible for raster
 * sources (which default to `scale`).
 */
export const HorizontalConstraintSchema = z.enum(['left', 'right', 'left-right', 'center', 'scale']);
export const VerticalConstraintSchema = z.enum(['top', 'bottom', 'top-bottom', 'center', 'scale']);

export const ConstraintsSchema = z.object({
  horizontal: HorizontalConstraintSchema,
  vertical: VerticalConstraintSchema,
});
export type Constraints = z.infer<typeof ConstraintsSchema>;

export const AutoLayoutSchema = z.object({
  direction: z.enum(['horizontal', 'vertical', 'wrap']),
  gap: LogicalPx.nonnegative(),
  padding: EdgeInsetsSchema,
  primaryAxisSizing: z.enum(['fixed', 'hug']),
  counterAxisSizing: z.enum(['fixed', 'hug']),
  primaryAxisAlign: z.enum(['start', 'center', 'end', 'space-between']),
  counterAxisAlign: z.enum(['start', 'center', 'end', 'baseline', 'stretch']),
});
export type AutoLayout = z.infer<typeof AutoLayoutSchema>;

/**
 * How a node relates to the device safe area. Populated by the importer when a
 * source declares it, otherwise inferred by the adaptation engine's anchor
 * detection. `none` means the node is ordinary in-flow content.
 */
export const SafeAreaAnchorSchema = z.enum([
  'none',
  'top-inset', // must sit below the status bar / cutout
  'bottom-inset', // must sit above the home indicator / nav bar
  'left-inset',
  'right-inset',
  'full-bleed', // deliberately extends under the chrome (e.g. hero image)
]);
export type SafeAreaAnchor = z.infer<typeof SafeAreaAnchorSchema>;

export const PositionModeSchema = z.enum(['flow', 'absolute', 'sticky', 'fixed']);
export type PositionMode = z.infer<typeof PositionModeSchema>;

const BaseNodeFields = {
  id: z.string(),
  name: z.string(),
  /** Absolute frame in the *document* coordinate space (origin = top-left of page). */
  frame: RectSchema,
  opacity: z.number().min(0).max(1).default(1),
  rotation: z.number().default(0),
  visible: z.boolean().default(true),
  clipsContent: z.boolean().default(false),
  zIndex: z.number().int().default(0),
  position: PositionModeSchema.default('flow'),
  safeAreaAnchor: SafeAreaAnchorSchema.default('none'),
  constraints: ConstraintsSchema,
  padding: EdgeInsetsSchema.default({ top: 0, right: 0, bottom: 0, left: 0 }),
  margin: EdgeInsetsSchema.default({ top: 0, right: 0, bottom: 0, left: 0 }),
  cornerRadius: CornerRadiusSchema.default({ topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }),
  fills: z.array(FillSchema).default([]),
  strokes: z.array(StrokeSchema).default([]),
  shadows: z.array(ShadowSchema).default([]),
  autoLayout: AutoLayoutSchema.optional(),
  /** Interaction metadata preserved from the source where available. */
  interaction: z
    .object({
      role: z.enum(['button', 'link', 'input', 'tab', 'none']).default('none'),
      target: z.string().optional(),
      accessibilityLabel: z.string().optional(),
    })
    .optional(),
  provenance: ProvenanceSchema,
  /** Per-field measurement quality, keyed by IR field path (e.g. "padding.left"). */
  fieldQuality: z.record(z.string(), ProvenanceSchema).default({}),
  /**
   * Reconstruction metadata for nodes derived from a bitmap.
   *
   * Purely descriptive: the renderer ignores it entirely. It exists so Dev Mode
   * can report the measured typography of a text region whose *pixels* are
   * still the designer's own, and so AI Mode can explain why a region was
   * classified as it was (spec sections 15 and 18).
   */
  analysis: z
    .object({
      componentType: z.string(),
      semanticRole: z.string(),
      renderStrategy: z.enum(['RECONSTRUCT', 'PRESERVE_RASTER', 'HYBRID']),
      confidence: z.number().min(0).max(1),
      reasons: z.array(z.string()).default([]),
      /** Measured type metrics, when the region is text. */
      typography: z
        .object({
          fontSize: LogicalPx.positive(),
          fontWeight: z.number().int(),
          lineHeight: LogicalPx.positive(),
          color: ColorSchema,
          align: z.enum(['left', 'center', 'right']),
          lineCount: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional(),
};

export type DesignNode =
  | ContainerNode
  | TextNode
  | ImageNode
  | ShapeNode
  | VectorNode
  | ScrollContainerNode;

export interface ContainerNode extends z.infer<typeof ContainerNodeBase> {
  children: DesignNode[];
}
export interface ScrollContainerNode extends z.infer<typeof ScrollContainerNodeBase> {
  children: DesignNode[];
}
export type TextNode = z.infer<typeof TextNodeSchema>;
export type ImageNode = z.infer<typeof ImageNodeSchema>;
export type ShapeNode = z.infer<typeof ShapeNodeSchema>;
export type VectorNode = z.infer<typeof VectorNodeSchema>;

const ContainerNodeBase = z.object({ ...BaseNodeFields, type: z.literal('container') });

const ScrollContainerNodeBase = z.object({
  ...BaseNodeFields,
  type: z.literal('scroll-container'),
  scroll: z.object({
    axis: z.enum(['vertical', 'horizontal', 'both']),
    /** Full scrollable content size - may exceed the device viewport (spec section 8). */
    contentWidth: LogicalPx.nonnegative(),
    contentHeight: LogicalPx.nonnegative(),
  }),
});

export const TextNodeSchema = z.object({
  ...BaseNodeFields,
  type: z.literal('text'),
  characters: z.string(),
  typography: TypographySchema,
  /** Per-line boxes as measured in the source. Empty when not measurable. */
  lines: z
    .array(z.object({ text: z.string(), width: LogicalPx, height: LogicalPx, baseline: LogicalPx.optional() }))
    .default([]),
  textAutoResize: z.enum(['none', 'width', 'height', 'width-and-height']).default('none'),
  maxLines: z.number().int().positive().optional(),
  overflow: z.enum(['visible', 'clip', 'ellipsis']).default('visible'),
});

export const ImageNodeSchema = z.object({
  ...BaseNodeFields,
  type: z.literal('image'),
  assetId: z.string(),
  naturalWidth: LogicalPx.positive(),
  naturalHeight: LogicalPx.positive(),
  scaleMode: z.enum(['fill', 'fit', 'stretch', 'tile']).default('fill'),
  /** Normalised crop rect within the natural image, 0..1. */
  crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  altText: z.string().optional(),
});

export const ShapeNodeSchema = z.object({
  ...BaseNodeFields,
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'ellipse', 'line', 'polygon']),
});

export const VectorNodeSchema = z.object({
  ...BaseNodeFields,
  type: z.literal('vector'),
  /** SVG path data, preserved verbatim from the source. */
  paths: z.array(z.object({ d: z.string(), fillRule: z.enum(['nonzero', 'evenodd']).default('nonzero') })),
  viewBox: RectSchema.optional(),
});

export const DesignNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    ContainerNodeBase.extend({ children: z.array(DesignNodeSchema) }),
    ScrollContainerNodeBase.extend({ children: z.array(DesignNodeSchema) }),
    TextNodeSchema,
    ImageNodeSchema,
    ShapeNodeSchema,
    VectorNodeSchema,
  ]),
) as z.ZodType<DesignNode>;

export function isParent(node: DesignNode): node is ContainerNode | ScrollContainerNode {
  return node.type === 'container' || node.type === 'scroll-container';
}

export function childrenOf(node: DesignNode): DesignNode[] {
  return isParent(node) ? node.children : [];
}

/** Depth-first walk in paint order. */
export function walk(node: DesignNode, visit: (n: DesignNode, parent?: DesignNode) => void, parent?: DesignNode): void {
  visit(node, parent);
  for (const child of childrenOf(node)) walk(child, visit, node);
}

export function flatten(root: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  walk(root, (n) => out.push(n));
  return out;
}

export function findNode(root: DesignNode, id: string): DesignNode | undefined {
  let found: DesignNode | undefined;
  walk(root, (n) => {
    if (!found && n.id === id) found = n;
  });
  return found;
}

export function findParent(root: DesignNode, id: string): DesignNode | undefined {
  let found: DesignNode | undefined;
  walk(root, (n, parent) => {
    if (!found && n.id === id) found = parent;
  });
  return found;
}

export const COLOR_BLACK = ColorSchema.parse({ r: 0, g: 0, b: 0, a: 1 });
