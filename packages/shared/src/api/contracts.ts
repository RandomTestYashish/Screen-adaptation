import { z } from 'zod';
import { DesignDocumentSchema, SourceDocumentSchema } from '../design-ir/document.js';
import { DeviceProfileSchema } from '../device/profile.js';
import { AdaptationOptionsSchema, AdaptationResultSchema } from '../adaptation/model.js';
import { RenderEvidenceSchema, ValidationReportSchema } from '../validation/model.js';

/**
 * Spec section 21: "Use shared Zod schemas between client and server so
 * request/response models cannot drift." Both @dae/api and @dae/web import
 * these; neither declares its own copy.
 */

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectRequest = z.object({ name: z.string().min(1).max(120).default('Untitled project') });
export const CreateProjectResponse = ProjectSchema;

/** POST /sources/upload - multipart; this describes the JSON half of the response. */
export const UploadSourceResponse = z.object({
  source: SourceDocumentSchema,
  design: DesignDocumentSchema,
  /** Device chosen automatically so the designer sees a preview immediately. */
  defaultDeviceId: z.string(),
  warnings: z.array(z.string()).default([]),
});
export type UploadSourceResponseT = z.infer<typeof UploadSourceResponse>;

export const FigmaImportRequest = z.object({
  projectId: z.string(),
  fileKey: z.string().min(1),
  nodeId: z.string().min(1),
  /** Optional per-request token; otherwise the server-side token is used. */
  accessToken: z.string().optional(),
});
export const FigmaImportResponse = UploadSourceResponse;

export const DeviceQuery = z.object({
  search: z.string().optional(),
  platform: z.enum(['ios', 'android']).optional(),
  manufacturer: z.string().optional(),
  osName: z.string().optional(),
  minWidth: z.coerce.number().optional(),
  maxWidth: z.coerce.number().optional(),
  minHeight: z.coerce.number().optional(),
  maxHeight: z.coerce.number().optional(),
  minAspectRatio: z.coerce.number().optional(),
  maxAspectRatio: z.coerce.number().optional(),
  minDpr: z.coerce.number().optional(),
  maxDpr: z.coerce.number().optional(),
  era: z.string().optional(),
  sizeCategory: z.enum(['compact', 'regular', 'large']).optional(),
  ids: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type DeviceQueryT = z.infer<typeof DeviceQuery>;

export const DeviceListResponse = z.object({
  catalogVersion: z.string(),
  schemaVersion: z.string(),
  total: z.number().int(),
  devices: z.array(DeviceProfileSchema),
  facets: z.object({
    manufacturers: z.array(z.object({ value: z.string(), count: z.number().int() })),
    platforms: z.array(z.object({ value: z.string(), count: z.number().int() })),
    osNames: z.array(z.object({ value: z.string(), count: z.number().int() })),
    eras: z.array(z.object({ value: z.string(), count: z.number().int() })),
    widthRange: z.object({ min: z.number(), max: z.number() }),
    dprRange: z.object({ min: z.number(), max: z.number() }),
  }),
});
export type DeviceListResponseT = z.infer<typeof DeviceListResponse>;

export const PlanRequest = z.object({
  designDocumentId: z.string(),
  screenId: z.string().optional(),
  deviceId: z.string(),
  options: AdaptationOptionsSchema.partial().optional(),
});
export const PlanResponse = AdaptationResultSchema;

/**
 * POST /adaptations/render returns the same adaptation result plus everything
 * the client renderer needs. The design itself is *never* rasterised on the
 * server for the preview path - the client renders the IR / original bitmap
 * directly, so the source is never flattened (spec section 32).
 */
export const RenderRequest = PlanRequest.extend({ includeDesign: z.boolean().default(true) });
export const RenderResponse = z.object({
  adaptation: AdaptationResultSchema,
  device: DeviceProfileSchema,
  design: DesignDocumentSchema.optional(),
  source: SourceDocumentSchema,
  /** Signed, time-limited URL for the immutable source asset. */
  sourceAssetUrl: z.string(),
});
export type RenderResponseT = z.infer<typeof RenderResponse>;

export const ValidationRunRequest = z.object({
  adaptationPlanId: z.string(),
  evidence: RenderEvidenceSchema.optional(),
});
export const ValidationRunResponse = z.object({
  report: ValidationReportSchema,
  /** The plan after any correction pass - may differ from the requested one. */
  adaptation: AdaptationResultSchema,
});
export type ValidationRunResponseT = z.infer<typeof ValidationRunResponse>;

export const FontAvailabilityRequest = z.object({ families: z.array(z.string()).max(200) });
export const FontAvailabilityResponse = z.object({
  results: z.array(
    z.object({
      family: z.string(),
      status: z.enum(['available', 'substituted', 'missing', 'unknown']),
      substituteWith: z.string().optional(),
      source: z.enum(['system-font-list', 'google-fonts', 'client-report', 'unknown']),
    }),
  ),
});

export const ExportRequest = z.object({
  adaptationPlanId: z.string(),
  kind: z.enum(['viewport-image', 'full-length-image', 'validation-report', 'device-metadata']),
  format: z.enum(['png', 'jpeg', 'webp', 'json']).default('png'),
  /** Client-captured render, required for the image export kinds. */
  imageDataUrl: z.string().optional(),
  quality: z.number().min(1).max(100).default(92),
});
export const ExportResponse = z.object({
  id: z.string(),
  kind: z.string(),
  format: z.string(),
  url: z.string(),
  byteSize: z.number().int(),
  /** Provenance travels with every export (spec section 25). */
  provenance: z.object({
    sourceId: z.string(),
    sourceHash: z.string(),
    adaptationPlanId: z.string(),
    deviceId: z.string(),
    engineVersion: z.string(),
    deviceCatalogVersion: z.string(),
    exportedAt: z.string().datetime(),
  }),
});
export type ExportResponseT = z.infer<typeof ExportResponse>;

export const RenderListResponse = z.object({
  renders: z.array(
    z.object({
      adaptationPlanId: z.string(),
      deviceId: z.string(),
      deviceName: z.string(),
      createdAt: z.string().datetime(),
      preservationScore: z.number(),
      validationStatus: z.enum(['pass', 'pass-with-warnings', 'fail', 'not-run']),
    }),
  ),
});

export const CatalogSyncRequest = z.object({
  providers: z.array(z.string()).optional(),
  dryRun: z.boolean().default(false),
});
export const CatalogSyncResponse = z.object({
  catalogVersion: z.string(),
  added: z.array(z.string()),
  updated: z.array(z.string()),
  unchanged: z.number().int(),
  rejected: z.array(z.object({ id: z.string(), reason: z.string() })),
  dryRun: z.boolean(),
});

export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
