import { z } from 'zod';

/**
 * Spec section 14: "Do not invent measurements. Mark measurements as detected,
 * inferred or unavailable." Every value that a designer can read in the
 * inspector or validation panel carries one of these labels.
 */
export const MeasurementQualitySchema = z.enum(['detected', 'inferred', 'unavailable']);
export type MeasurementQuality = z.infer<typeof MeasurementQualitySchema>;

export const ProvenanceOriginSchema = z.enum([
  'figma-node', // deterministic Figma node metadata
  'raster-pixels', // measured from the uploaded bitmap
  'raster-analysis', // computer-vision / OCR analysis of the bitmap
  'heuristic', // deterministic rule applied by the importer
  'ai-inference', // produced by the AI adapter
  'user-provided',
  'engine-generated', // created by the adaptation engine, not present in the source
]);
export type ProvenanceOrigin = z.infer<typeof ProvenanceOriginSchema>;

export const ProvenanceSchema = z.object({
  origin: ProvenanceOriginSchema,
  quality: MeasurementQualitySchema,
  /** 0..1 - how much the pipeline trusts this value. */
  confidence: z.number().min(0).max(1),
  /** Original node id in the source document, when the source is structured. */
  sourceNodeId: z.string().optional(),
  /** Free-text note surfaced in the inspector, e.g. which model produced it. */
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const DETERMINISTIC: Provenance = { origin: 'figma-node', quality: 'detected', confidence: 1 };

export function measured(origin: ProvenanceOrigin, confidence = 1, sourceNodeId?: string): Provenance {
  return { origin, quality: 'detected', confidence, ...(sourceNodeId ? { sourceNodeId } : {}) };
}

export function inferred(origin: ProvenanceOrigin, confidence: number, note?: string): Provenance {
  return { origin, quality: 'inferred', confidence, ...(note ? { note } : {}) };
}

export function unavailable(note: string): Provenance {
  return { origin: 'heuristic', quality: 'unavailable', confidence: 0, note };
}
