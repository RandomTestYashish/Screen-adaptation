import { z } from 'zod';
import { EdgeInsetsSchema, LogicalPx, RectSchema } from '../design-ir/primitives.js';
import { OrientationSchema } from '../device/profile.js';

/**
 * What a single transformation did. Spec section 7 requires source node, target
 * node, type, before/after values, reason, confidence, and whether it changed
 * pixels/layout or only the device chrome layer.
 */
export const TransformTypeSchema = z.enum([
  'preserved', // explicit no-op record, so preservation is auditable
  'uniform-scale', // whole-document proportional scale (raster path)
  'full-width-stretch', // element authored edge-to-edge follows the new width
  'edge-padding-preserved', // element keeps its original distance to the edge
  'fixed-width-reanchor', // fixed-size element repositioned per its constraint
  'center-reanchor',
  'autolayout-reflow', // auto-layout container recomputed with identical gaps
  'text-rewrap', // same font metrics, different available width
  'image-refit', // aspect preserved, box changed
  'safe-area-inset', // element pushed clear of status bar / cutout
  'home-indicator-clearance', // element lifted above the home indicator / nav bar
  'scroll-extent-adjust', // document scroll height recomputed
  'chrome-overlay', // device chrome drawn above the design; design untouched
]);
export type TransformType = z.infer<typeof TransformTypeSchema>;

/**
 * Blast radius of a transformation. `chrome-only` transformations never touch
 * the designer's pixels and therefore do not reduce the preservation score.
 */
export const TransformImpactSchema = z.enum(['none', 'chrome-only', 'layout', 'pixels']);
export type TransformImpact = z.infer<typeof TransformImpactSchema>;

export const TransformRecordSchema = z.object({
  id: z.string(),
  type: TransformTypeSchema,
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  nodeName: z.string(),
  before: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  after: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  impact: TransformImpactSchema,
  /** True when the engine applied this during the second (correction) pass. */
  fromCorrectionPass: z.boolean().default(false),
});
export type TransformRecord = z.infer<typeof TransformRecordSchema>;

/**
 * How the engine decided to fit the source into the target viewport.
 * Preservation-first: `identity` is always preferred, `uniform-scale` is the
 * safe fallback for immutable raster input, `structural-reflow` is only used
 * when the source carries real structure.
 */
export const AdaptationStrategySchema = z.enum(['identity', 'uniform-scale', 'structural-reflow']);
export type AdaptationStrategy = z.infer<typeof AdaptationStrategySchema>;

export const AdaptationOptionsSchema = z.object({
  orientation: OrientationSchema.default('portrait'),
  /** Respect device safe areas when placing anchored elements. */
  applySafeArea: z.boolean().default(true),
  /** Allow structural reflow for structured sources. When false, always scale. */
  allowStructuralReflow: z.boolean().default(true),
  /** Simulate the software keyboard, reducing the usable viewport height. */
  keyboardVisible: z.boolean().default(false),
  /** Subtract mobile-browser chrome from the viewport height. */
  simulateBrowserChrome: z.boolean().default(false),
});
export type AdaptationOptions = z.infer<typeof AdaptationOptionsSchema>;

export const PreservationScoreSchema = z.object({
  /** 0..100. 100 means nothing but the chrome layer changed. */
  score: z.number().min(0).max(100),
  /** Human-readable justification lines shown in the validation panel. */
  reasons: z.array(z.string()),
  pixelsChanged: z.boolean(),
  layoutChanged: z.boolean(),
  /** Present when the score is limited by low-confidence device data. */
  limitedByDeviceConfidence: z.boolean().default(false),
});
export type PreservationScore = z.infer<typeof PreservationScoreSchema>;

/**
 * The complete, replayable description of how a source becomes a target render.
 * Contains no bitmaps: the renderer consumes this plus the immutable source.
 */
export const AdaptationPlanSchema = z.object({
  id: z.string(),
  cacheKey: z.string(),
  projectId: z.string(),
  sourceId: z.string(),
  /** Provenance link back to the untouched original (spec section 2). */
  sourceHash: z.string(),
  designDocumentId: z.string(),
  screenId: z.string(),
  deviceId: z.string(),
  deviceCatalogVersion: z.string(),
  engineVersion: z.string(),
  options: AdaptationOptionsSchema,
  strategy: AdaptationStrategySchema,
  strategyReason: z.string(),

  sourceFrame: z.object({ width: LogicalPx, height: LogicalPx, scrollHeight: LogicalPx }),
  targetViewport: z.object({ width: LogicalPx, height: LogicalPx }),
  /** Viewport height actually available to content after chrome/keyboard. */
  usableViewport: z.object({ width: LogicalPx, height: LogicalPx }),
  safeArea: EdgeInsetsSchema,
  /**
   * The safe area the *source* design is judged to already reserve, inferred by
   * matching the source frame against the device catalog. The engine applies
   * only the difference between this and `safeArea`, so a design authored on a
   * notched artboard is never pushed down twice.
   */
  assumedSourceSafeArea: EdgeInsetsSchema,
  sourceSafeAreaBasis: z.enum(['exact-device-match', 'width-match', 'assumed-zero']),
  sourceSafeAreaConfidence: z.number().min(0).max(1),
  /** Uniform scale applied to the design. 1 means untouched. */
  scale: z.number().positive(),
  /** Content bounds of the adapted document, in target logical px. */
  contentBounds: RectSchema,
  /** Full scrollable height of the adapted document (spec section 8). */
  targetScrollHeight: LogicalPx.nonnegative(),

  transforms: z.array(TransformRecordSchema),
  preservation: PreservationScoreSchema,
  createdAt: z.string().datetime(),
  /** Incremented when the correction pass rewrote the plan. */
  revision: z.number().int().nonnegative().default(0),
});
export type AdaptationPlan = z.infer<typeof AdaptationPlanSchema>;

/**
 * The adapted geometry the renderer draws, produced by applying an
 * AdaptationPlan to the Design IR. Kept separate from the plan so the plan
 * stays a compact audit record.
 */
export const AdaptedNodeSchema = z.object({
  nodeId: z.string(),
  sourceNodeId: z.string(),
  frame: RectSchema,
  /** Effective visual scale of this node relative to the source. */
  scale: z.number().positive(),
  clipped: z.boolean().default(false),
  position: z.enum(['flow', 'absolute', 'sticky', 'fixed']),
  /** Text nodes only: how many lines this node needs at the adapted width. */
  lineCount: z.number().int().nonnegative().optional(),
});
export type AdaptedNode = z.infer<typeof AdaptedNodeSchema>;

export const AdaptationResultSchema = z.object({
  plan: AdaptationPlanSchema,
  nodes: z.array(AdaptedNodeSchema),
});
export type AdaptationResult = z.infer<typeof AdaptationResultSchema>;
