import { z } from 'zod';

/**
 * Spec section 6: device data must carry "source attribution and confidence per
 * field", and the UI must read a *normalized* schema rather than raw vendor or
 * community data.
 */
export const DeviceDataSourceSchema = z.enum([
  'apple-tech-specs', // support.apple.com / apple.com technical specifications
  'apple-hig', // Human Interface Guidelines (layout & platform behaviour)
  'android-docs', // developer.android.com (insets, cutouts, density buckets)
  'oem-spec', // manufacturer product page / press material
  'community-dataset', // supplemental, normalised, never blindly trusted
  'browser-emulation', // devtools emulation metadata - viewport/DPR only
  'derived', // computed from other fields by the normalizer
]);
export type DeviceDataSource = z.infer<typeof DeviceDataSourceSchema>;

/** How much the catalog trusts a field. Surfaced verbatim in the validation panel. */
export const ConfidenceSchema = z.enum(['high', 'medium', 'low', 'unknown']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  high: 1,
  medium: 0.75,
  low: 0.45,
  unknown: 0.1,
};

export const FieldAttributionSchema = z.object({
  source: DeviceDataSourceSchema,
  confidence: ConfidenceSchema,
  /** Human-readable pointer to where the value came from. */
  reference: z.string().optional(),
  note: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type FieldAttribution = z.infer<typeof FieldAttributionSchema>;

/**
 * Attribution map keyed by dotted field path of DeviceProfile,
 * e.g. "viewport.portrait.width" or "safeArea.portrait.top".
 */
export const AttributionMapSchema = z.record(z.string(), FieldAttributionSchema);
export type AttributionMap = z.infer<typeof AttributionMapSchema>;

/** Lowest confidence present among the given field paths, for honest reporting. */
export function aggregateConfidence(map: AttributionMap, paths: string[]): Confidence {
  const order: Confidence[] = ['high', 'medium', 'low', 'unknown'];
  let worstIndex = 0;
  for (const path of paths) {
    const entry = map[path];
    const index = entry ? order.indexOf(entry.confidence) : order.length - 1;
    if (index > worstIndex) worstIndex = index;
  }
  return order[worstIndex] ?? 'unknown';
}
