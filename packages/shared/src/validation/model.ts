import { z } from 'zod';
import { RectSchema } from '../design-ir/primitives.js';
import { FidelityReportSchema } from './fidelity.js';

/** The 14 mandatory checks from spec section 15. */
export const ValidationCheckIdSchema = z.enum([
  'visual-comparison',
  'geometry-comparison',
  'typography-comparison',
  'overflow-clipping',
  'safe-area-collision',
  'cutout-collision',
  'bottom-navigation-collision',
  'scroll-completeness',
  'text-overflow-wrapping',
  'image-crop-scale',
  'missing-assets',
  'font-availability',
  'contrast-accessibility',
  'device-profile-integrity',
]);
export type ValidationCheckId = z.infer<typeof ValidationCheckIdSchema>;

export const SeveritySchema = z.enum(['critical', 'warning', 'info', 'pass']);
export type Severity = z.infer<typeof SeveritySchema>;

export const ValidationFindingSchema = z.object({
  id: z.string(),
  check: ValidationCheckIdSchema,
  severity: SeveritySchema,
  title: z.string(),
  /** Plain-language explanation, readable by a designer (spec section 26). */
  detail: z.string(),
  nodeId: z.string().optional(),
  nodeName: z.string().optional(),
  region: RectSchema.optional(),
  /** Code-like measurement rows shown in the bottom panel (spec section 14). */
  measurements: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        quality: z.enum(['detected', 'inferred', 'unavailable']),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
  /** Set when the engine can fix this itself during the correction pass. */
  autoCorrectable: z.boolean().default(false),
  correctionHint: z.string().optional(),
});
export type ValidationFinding = z.infer<typeof ValidationFindingSchema>;

export const CheckResultSchema = z.object({
  check: ValidationCheckIdSchema,
  status: z.enum(['pass', 'warn', 'fail', 'skipped']),
  /** Why a check was skipped - e.g. no rendered bitmap was supplied. */
  skippedReason: z.string().optional(),
  durationMs: z.number().nonnegative(),
  findings: z.array(ValidationFindingSchema),
  confidence: z.number().min(0).max(1),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

/** Code-like row for the expanded validation panel, e.g. `safe-area-top: 59px`. */
export const MetadataRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  quality: z.enum(['detected', 'inferred', 'unavailable']),
  group: z.enum(['viewport', 'device', 'safe-area', 'content', 'typography', 'spacing', 'scroll', 'source']),
});
export type MetadataRow = z.infer<typeof MetadataRowSchema>;

export const ValidationPassSchema = z.object({
  pass: z.union([z.literal(1), z.literal(2)]),
  planRevision: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  results: z.array(CheckResultSchema),
  /** Corrections the engine applied between this pass and the next. */
  correctionsApplied: z.array(z.string()).default([]),
});
export type ValidationPass = z.infer<typeof ValidationPassSchema>;

export const ValidationReportSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  adaptationPlanId: z.string(),
  sourceId: z.string(),
  sourceHash: z.string(),
  deviceId: z.string(),
  engineVersion: z.string(),
  deviceCatalogVersion: z.string(),
  createdAt: z.string().datetime(),

  /** Mandatory two passes (spec section 15). */
  passes: z.array(ValidationPassSchema).min(1).max(2),

  status: z.enum(['pass', 'pass-with-warnings', 'fail']),
  criticalCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  /**
   * The two fidelity questions, kept apart (spec section 31). There is
   * deliberately no combined number: the two are fixed in different places and
   * a single score cannot say which one is at fault.
   */
  fidelity: FidelityReportSchema,
  /** Overall confidence in the report itself, limited by skipped checks. */
  confidence: z.number().min(0).max(1),
  metadata: z.array(MetadataRowSchema),
  /** Explicit statement of what could not be verified. */
  limitations: z.array(z.string()).default([]),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

/** Optional evidence the client can supply to unlock pixel-level checks. */
export const RenderEvidenceSchema = z.object({
  /** Data URL or asset id of the rendered target viewport. */
  renderedAssetId: z.string().optional(),
  /** Fonts the *rendering* browser reported as available. */
  availableFonts: z.array(z.string()).optional(),
  /** Actual measured scroll height of the rendered preview. */
  measuredScrollHeight: z.number().optional(),
  /** Per-node measured boxes from the live DOM, keyed by node id. */
  measuredNodes: z.record(z.string(), RectSchema).optional(),
});
export type RenderEvidence = z.infer<typeof RenderEvidenceSchema>;
