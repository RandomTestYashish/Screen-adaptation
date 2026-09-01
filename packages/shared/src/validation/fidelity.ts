import { z } from 'zod';

/**
 * How a number came to exist (spec section 53).
 *
 * Every reported value carries one of these so a reader can tell a measurement
 * from an assumption. `UNKNOWN` is a legitimate answer and is preferred over a
 * plausible-looking guess.
 */
export const MeasurementTypeSchema = z.enum([
  'DETECTED', // measured from the source pixels or the Figma document
  'INFERRED', // derived from detected values by a stated rule
  'DEVICE_DATABASE', // carried from the device catalog, not from the design
  'USER_DEFINED', // supplied by the user
  'UNKNOWN', // cannot be established; deliberately not guessed
]);
export type MeasurementType = z.infer<typeof MeasurementTypeSchema>;

/**
 * Fidelity is two independent questions, and the product must never merge them
 * into one number (spec sections 31 and 52).
 *
 * - `source`: does our representation of the upload match the upload?
 *   A perfect answer is possible for a Figma import and only approachable for a
 *   screenshot, where structure has to be recovered from pixels.
 *
 * - `adaptation`: does the device render preserve the design we hold?
 *   A perfect answer is possible on any device, because preservation is a
 *   choice the engine makes rather than something it has to discover.
 *
 * Merging them hides both failure modes: a bad reconstruction disappears behind
 * a faithful adaptation, and an aggressive adaptation is excused by a good
 * reconstruction. They are also fixed in different places - one by improving
 * analysis, the other by relaxing a layout rule - so a single score cannot tell
 * anyone what to do next.
 */
export const FidelityKindSchema = z.enum(['source', 'adaptation']);
export type FidelityKind = z.infer<typeof FidelityKindSchema>;

export const FidelityScoreSchema = z.object({
  kind: FidelityKindSchema,
  /** 0..100. */
  score: z.number().min(0).max(100),
  /** The question this number answers, shown verbatim beside it in the UI. */
  question: z.string(),
  /**
   * How much to trust the score itself. A high score at low confidence is a
   * weaker claim than the same score at high confidence, and the UI must show
   * both rather than collapsing them.
   */
  confidence: z.number().min(0).max(1),
  measurementType: MeasurementTypeSchema,
  /** Human-readable justification lines. Never empty. */
  reasons: z.array(z.string()),
  /** What this score explicitly does not cover (spec section 52). */
  limitations: z.array(z.string()).default([]),
});
export type FidelityScore = z.infer<typeof FidelityScoreSchema>;

/**
 * The pair, always transported together so a consumer cannot accidentally
 * report one as "the" fidelity.
 */
export const FidelityReportSchema = z.object({
  source: FidelityScoreSchema,
  adaptation: FidelityScoreSchema,
});
export type FidelityReport = z.infer<typeof FidelityReportSchema>;
