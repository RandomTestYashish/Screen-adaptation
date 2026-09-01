import { z } from 'zod';
import { DesignNodeSchema, type DesignNode } from './nodes.js';
import { ColorSchema, LogicalPx, SizeSchema } from './primitives.js';
import { ProvenanceSchema } from './provenance.js';
import { FidelityScoreSchema } from '../validation/fidelity.js';

export const SourceKindSchema = z.enum(['raster', 'figma']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * The immutable record of what the designer uploaded (spec section 2:
 * "Keep source assets immutable ... Never overwrite the source").
 *
 * Nothing in the pipeline may mutate a SourceDocument after creation. Adapted
 * output is always a *separate* artefact that references `id` + `hash`.
 */
export const SourceDocumentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: SourceKindSchema,
  /** Original filename or Figma node name, sanitised. */
  name: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  /** SHA-256 of the original bytes - the immutability proof and cache key input. */
  hash: z.string(),
  /** Opaque handle into the asset store; never a raw filesystem path. */
  assetId: z.string(),
  width: LogicalPx.positive(),
  height: LogicalPx.positive(),
  /** Physical pixel dimensions of a raster source, when they differ from logical. */
  pixelWidth: z.number().int().positive().optional(),
  pixelHeight: z.number().int().positive().optional(),
  /** DPI recorded in the file metadata, when present. Never guessed. */
  dpi: z.number().positive().optional(),
  /** Assumed scale factor (physical px per logical px) of the export. */
  exportScale: z.number().positive().default(1),
  exportScaleProvenance: ProvenanceSchema,
  figma: z
    .object({ fileKey: z.string(), nodeId: z.string(), version: z.string().optional() })
    .optional(),
  importedAt: z.string().datetime(),
  parserVersion: z.string(),
  /** Set once and never cleared. Any write attempt must be rejected. */
  immutable: z.literal(true).default(true),
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const ScreenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Viewport the design was authored against (normally 375 x 812). */
  frame: SizeSchema,
  /** Total document height including everything below the fold (spec section 8). */
  scrollHeight: LogicalPx.nonnegative(),
  scrollHeightProvenance: ProvenanceSchema,
  background: ColorSchema.optional(),
  root: DesignNodeSchema,
  /**
   * Non-authoritative structure derived from a raster source by CV/OCR.
   *
   * The renderer never draws this: it draws `root` only. The overlay exists so
   * Dev Mode can report measurements and validation can reason about text and
   * regions, without the analysis ever replacing the original artwork
   * (spec section 16).
   */
  analysisOverlay: DesignNodeSchema.optional(),
});
export type Screen = Omit<z.infer<typeof ScreenSchema>, 'root' | 'analysisOverlay'> & {
  root: DesignNode;
  analysisOverlay?: DesignNode;
};

/**
 * The normalized Design IR - the canonical model used by adaptation,
 * rendering, inspection and validation (spec section 4).
 */
export const DesignDocumentSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceHash: z.string(),
  sourceKind: SourceKindSchema,
  /**
   * Whether the document carries layout structure the adaptation engine can
   * reflow.
   *
   * This, not `sourceKind`, decides how a design adapts. A bitmap that has been
   * reconstructed into components reflows exactly like a Figma import; a bitmap
   * that has not can only be scaled. Keying the decision on the source *format*
   * was the reason an uploaded screenshot used to shrink to fit instead of
   * revealing more or less content per viewport (spec sections 1 and 9).
   */
  structure: z.enum(['figma', 'reconstructed', 'flat']).default('flat'),
  /**
   * How faithfully this representation matches the upload it was built from.
   *
   * Recorded here because it is a property of the *document*, fixed at import
   * time and identical on every device. The adaptation half of the pair is
   * computed per device and lives on the validation report.
   */
  sourceFidelity: FidelityScoreSchema.optional(),
  irVersion: z.string(),
  parserVersion: z.string(),
  createdAt: z.string().datetime(),
  screens: z.array(ScreenSchema).min(1),
  /** Fonts referenced anywhere in the document, for availability checking. */
  fontsUsed: z.array(z.object({ family: z.string(), weights: z.array(z.number().int()) })).default([]),
  /** Asset ids referenced by image nodes and image fills. */
  assetsUsed: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type DesignDocument = Omit<z.infer<typeof DesignDocumentSchema>, 'screens'> & { screens: Screen[] };

export function primaryScreen(doc: DesignDocument): Screen {
  const screen = doc.screens[0];
  if (!screen) throw new Error(`Design document ${doc.id} has no screens`);
  return screen;
}
