import {
  ADAPTATION_ENGINE_VERSION,
  AdaptationOptionsSchema,
  DESIGN_IR_VERSION,
  PARSER_VERSION,
  SourceDocumentSchema,
  VALIDATION_ENGINE_VERSION,
  adaptationCacheKey,
  inferred,
  measured,
  newId,
  primaryScreen,
  sha256,
  type AdaptationOptions,
  type AdaptationResult,
  type DesignDocument,
  type DeviceCatalog,
  type DeviceListResponseT,
  type DeviceProfile,
  type DeviceQueryT,
  type ExportResponseT,
  type Project,
  type RenderEvidence,
  type RenderResponseT,
  type SourceDocument,
  type UploadSourceResponseT,
  type ValidationRunResponseT,
} from '@dae/shared';
import { buildRasterDesign, planAdaptation, reconstructRaster, runValidation, type DesignDna, type PixelData } from '@dae/engine';
import { buildResponse, pickDefaultDevice } from '@dae/device-catalog/query';
import catalogData from '@dae/device-catalog/catalog.json';
import type { HealthStatus } from './api.js';

/**
 * The whole pipeline, running in the browser.
 *
 * Nothing here is a mock: it is the same `@dae/engine` and the same normalized
 * device catalog the server uses, driven against in-memory storage. That is
 * possible because the engine is deliberately free of Node built-ins — see
 * docs/ARCHITECTURE.md — and it is what lets the standalone preview behave
 * exactly like the real product.
 *
 * Two capabilities genuinely need the server and are reported as unavailable
 * rather than faked:
 *   - Figma import, which needs a server-held access token
 *   - the pixel-level visual comparison, which runs in the API worker
 */

const catalog = catalogData as DeviceCatalog;

interface StoredAsset {
  url: string;
  bytes: number;
}

const projects = new Map<string, Project>();
const sources = new Map<string, SourceDocument>();
const designs = new Map<string, DesignDocument>();
const adaptations = new Map<string, AdaptationResult>();
const byCacheKey = new Map<string, string>();
const assets = new Map<string, StoredAsset>();
const dnaBySource = new Map<string, DesignDna>();

export class LocalBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalBackendError';
  }
}

/** Decode intrinsic dimensions without a server-side image library. */
async function readImageSize(url: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new LocalBackendError('The file could not be decoded as an image.'));
    image.src = url;
  });
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/** Analysis cost is quadratic in pixels, and a 3x export adds no structure. */
const MAX_ANALYSIS_WIDTH = 800;

/**
 * Decode to raw RGBA through a canvas.
 *
 * The engine's analysis takes a plain pixel buffer, so the browser can run the
 * exact same reconstruction the server does - no service, no upload.
 */
async function decodeForAnalysis(url: string): Promise<{ image: PixelData; analysisScale: number }> {
  const source = new Image();
  await new Promise<void>((resolve, reject) => {
    source.onload = () => resolve();
    source.onerror = () => reject(new LocalBackendError('The file could not be decoded as an image.'));
    source.src = url;
  });

  const width = Math.min(MAX_ANALYSIS_WIDTH, source.naturalWidth);
  const height = Math.round((source.naturalHeight / source.naturalWidth) * width);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new LocalBackendError('This browser could not provide a 2D canvas for analysis.');
  context.drawImage(source, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  return { image: { data, width, height }, analysisScale: source.naturalWidth / width };
}

/**
 * Assets are held as data: URLs rather than blob: URLs.
 *
 * A published page runs under a content-security policy that need not allow
 * blob: sources, and a data: URL is also same-origin for canvas purposes, which
 * keeps image export working.
 */
function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new LocalBackendError('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 25 * 1024 * 1024;

async function ingest(projectId: string, file: File | Blob, filename: string): Promise<UploadSourceResponseT> {
  const mimeType = file.type || 'image/png';
  if (!ALLOWED.has(mimeType)) {
    throw new LocalBackendError(`Unsupported type "${mimeType}". Supported: PNG, JPEG, WebP.`);
  }
  if (file.size > MAX_BYTES) {
    throw new LocalBackendError(`File is ${file.size} bytes; the limit is ${MAX_BYTES}.`);
  }

  const bytes = await file.arrayBuffer();
  const hash = await sha256(bytes);

  // Identical bytes reuse the existing immutable source, exactly as the server
  // does, rather than storing a second copy.
  for (const existing of sources.values()) {
    if (existing.projectId === projectId && existing.hash === hash) {
      const design = [...designs.values()].find((d) => d.sourceId === existing.id);
      if (design) {
        const storedDna = dnaBySource.get(existing.id);
        return {
          source: existing,
          design,
          defaultDeviceId: pickDefaultDevice(catalog, primaryScreen(design).frame.width).id,
          warnings: ['This file was already imported; the existing source was reused.'],
          ...(storedDna ? { dna: storedDna } : {}),
        };
      }
    }
  }

  const dataUrl = await toDataUrl(file);
  const { width, height } = await readImageSize(dataUrl);
  const assetId = newId('asset').replace(/[^A-Za-z0-9_-]/g, '');
  assets.set(assetId, { url: dataUrl, bytes: file.size });

  const source = SourceDocumentSchema.parse({
    id: newId('src'),
    projectId,
    kind: 'raster',
    name: sanitise(filename),
    mimeType,
    byteSize: file.size,
    hash,
    assetId,
    width,
    height,
    pixelWidth: width,
    pixelHeight: height,
    exportScale: 1,
    // The browser exposes no DPI metadata, so the export scale is an
    // assumption and is labelled as one.
    exportScaleProvenance: inferred(
      'heuristic',
      0.5,
      'The browser does not expose DPI metadata, so a 1x export was assumed.',
    ),
    importedAt: new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    immutable: true,
  });
  sources.set(source.id, source);

  const warnings = ['Running fully in the browser: no design leaves this page.'];

  let design: DesignDocument;
  let dna: DesignDna | undefined;
  try {
    const { image, analysisScale } = await decodeForAnalysis(dataUrl);
    const reconstruction = reconstructRaster({ source, image, scale: analysisScale });
    design = reconstruction.design;
    dna = reconstruction.dna;
    warnings.push(...reconstruction.warnings);
  } catch (error) {
    // Reconstruction is an enhancement, not a gate.
    warnings.push(
      `The design could not be reconstructed into components (${(error as Error).message}), so it adapts by proportional scaling rather than reflowing.`,
    );
    design = buildRasterDesign({ source });
  }
  designs.set(design.id, design);
  if (dna) dnaBySource.set(source.id, dna);
  if (width > 800) {
    warnings.push(
      `The export is ${width}px wide and the browser reports no DPI, so it was treated as 1x. If this is a 2x or 3x export, the logical width would be ${Math.round(width / 2)}px or ${Math.round(width / 3)}px.`,
    );
  }

  return {
    source,
    design,
    defaultDeviceId: pickDefaultDevice(catalog, primaryScreen(design).frame.width).id,
    warnings,
    ...(dna ? { dna } : {}),
  };
}

function sanitise(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'source';
  return base.replace(/[^\w.\- ]/g, '').slice(0, 120) || 'source';
}

function device(id: string): DeviceProfile {
  const found = catalog.devices.find((d) => d.id === id);
  if (!found) throw new LocalBackendError(`Unknown device "${id}"`);
  return found;
}

function assetUrls(design: DesignDocument, source: SourceDocument): Record<string, string> {
  const ids = new Set([source.assetId, ...design.assetsUsed]);
  return Object.fromEntries([...ids].map((id) => [id, assets.get(id)?.url ?? '']));
}

async function plan(input: {
  designDocumentId: string;
  screenId?: string;
  deviceId: string;
  options?: Partial<AdaptationOptions>;
}): Promise<AdaptationResult> {
  const design = designs.get(input.designDocumentId);
  if (!design) throw new LocalBackendError(`Unknown design document "${input.designDocumentId}"`);
  const screen = input.screenId ? design.screens.find((s) => s.id === input.screenId) : primaryScreen(design);
  if (!screen) throw new LocalBackendError(`Unknown screen "${input.screenId}"`);
  const target = device(input.deviceId);
  const options = AdaptationOptionsSchema.parse(input.options ?? {});

  // Same cache key as the server: source hash + device + catalog version +
  // engine version + options. Switching devices is a lookup, not a re-run.
  const cacheKey = await adaptationCacheKey({
    sourceHash: design.sourceHash,
    deviceId: target.id,
    deviceCatalogVersion: target.catalogVersion,
    engineVersion: ADAPTATION_ENGINE_VERSION,
    options: { ...options, screenId: screen.id },
  });
  const cachedId = byCacheKey.get(cacheKey);
  if (cachedId) {
    const cached = adaptations.get(cachedId);
    if (cached) return cached;
  }

  const source = sources.get(design.sourceId);
  if (!source) throw new LocalBackendError(`Source "${design.sourceId}" is missing`);

  const planned = planAdaptation({
    design,
    screen,
    device: target,
    catalog,
    projectId: source.projectId,
  });
  const result: AdaptationResult = { plan: { ...planned.plan, cacheKey }, nodes: planned.nodes };
  adaptations.set(result.plan.id, result);
  byCacheKey.set(cacheKey, result.plan.id);
  return result;
}

export const localBackend = {
  async health(): Promise<HealthStatus> {
    return {
      status: 'ok',
      versions: {
        parser: PARSER_VERSION,
        designIr: DESIGN_IR_VERSION,
        adaptationEngine: ADAPTATION_ENGINE_VERSION,
        validationEngine: VALIDATION_ENGINE_VERSION,
      },
      deviceCatalog: {
        version: catalog.catalogVersion,
        schemaVersion: catalog.schemaVersion,
        deviceCount: catalog.devices.length,
        generatedAt: catalog.generatedAt,
      },
      drivers: { storage: 'in-browser', assets: 'in-browser', queue: 'inline', ai: 'none' },
      capabilities: {
        figmaImport: false,
        rasterAnalysis: false,
        rasterAnalysisUnavailableReason:
          'This is the standalone browser preview. Nothing is uploaded anywhere, so no AI analysis runs; the bitmap is treated as immutable artwork. Every geometry, safe-area, scroll and device check still runs in full.',
      },
    };
  },

  async createProject(name: string): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = { id: newId('proj'), name, createdAt: now, updatedAt: now };
    projects.set(project.id, project);
    return project;
  },

  uploadSource(projectId: string, file: File): Promise<UploadSourceResponseT> {
    return ingest(projectId, file, file.name);
  },

  /** Load one of the designs bundled with the preview. */
  async uploadSample(projectId: string, dataUrl: string, name: string): Promise<UploadSourceResponseT> {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return ingest(projectId, blob, name);
  },

  async importFigma(): Promise<never> {
    throw new LocalBackendError(
      'Figma import needs a server-held access token, so it is unavailable in the browser preview. Run the app locally to import a frame.',
    );
  },

  async listDevices(query: Partial<DeviceQueryT> = {}): Promise<DeviceListResponseT> {
    return buildResponse(catalog, query);
  },

  async getDevice(id: string): Promise<DeviceProfile> {
    return device(id);
  },

  async render(input: {
    designDocumentId: string;
    screenId?: string;
    deviceId: string;
    options?: Partial<AdaptationOptions>;
  }): Promise<RenderResponseT> {
    const adaptation = await plan(input);
    const design = designs.get(input.designDocumentId)!;
    const source = sources.get(design.sourceId)!;
    return {
      adaptation,
      device: device(input.deviceId),
      design,
      source,
      sourceAssetUrl: assets.get(source.assetId)?.url ?? '',
      assetUrls: assetUrls(design, source),
    };
  },

  async validate(adaptationPlanId: string, evidence?: RenderEvidence): Promise<ValidationRunResponseT> {
    const adaptation = adaptations.get(adaptationPlanId);
    if (!adaptation) throw new LocalBackendError(`Unknown adaptation plan "${adaptationPlanId}"`);
    const design = designs.get(adaptation.plan.designDocumentId)!;
    const screen = design.screens.find((s) => s.id === adaptation.plan.screenId) ?? primaryScreen(design);
    const source = sources.get(design.sourceId)!;

    const outcome = await runValidation({
      design,
      screen,
      device: device(adaptation.plan.deviceId),
      catalog,
      source,
      adaptation,
      projectId: adaptation.plan.projectId,
      ...(evidence ? { evidence } : {}),
      assetResolver: { has: (assetId: string) => assets.has(assetId) },
      // No pixel comparator in the browser: the check reports skipped with that
      // reason rather than claiming a result it cannot measure.
    });

    if (outcome.adaptation.plan.revision !== adaptation.plan.revision) {
      adaptations.set(outcome.adaptation.plan.id, outcome.adaptation);
    }
    return outcome;
  },

  async export(input: {
    adaptationPlanId: string;
    kind: 'viewport-image' | 'full-length-image' | 'compare-image' | 'validation-report' | 'device-metadata';
    format?: 'png' | 'jpeg' | 'webp' | 'json';
    imageDataUrl?: string;
    comparedPlanIds?: string[];
  }): Promise<ExportResponseT> {
    const adaptation = adaptations.get(input.adaptationPlanId);
    if (!adaptation) throw new LocalBackendError(`Unknown adaptation plan "${input.adaptationPlanId}"`);
    const design = designs.get(adaptation.plan.designDocumentId)!;
    const source = sources.get(design.sourceId)!;
    const target = device(adaptation.plan.deviceId);

    // A compare export contains several devices; naming only one would
    // misdescribe the image.
    const comparedDeviceIds = (input.comparedPlanIds ?? [])
      .map((id) => adaptations.get(id)?.plan.deviceId)
      .filter((id): id is string => Boolean(id));

    const provenance = {
      sourceId: source.id,
      sourceHash: source.hash,
      adaptationPlanId: adaptation.plan.id,
      deviceId: target.id,
      ...(comparedDeviceIds.length > 0 ? { deviceIds: comparedDeviceIds } : {}),
      engineVersion: adaptation.plan.engineVersion,
      deviceCatalogVersion: adaptation.plan.deviceCatalogVersion,
      exportedAt: new Date().toISOString(),
    };

    let payload: string;
    let format = input.format ?? 'png';

    if (input.kind === 'validation-report' || input.kind === 'device-metadata') {
      format = 'json';
      payload = JSON.stringify(
        input.kind === 'device-metadata'
          ? { device: target, adaptation: adaptation.plan, provenance }
          : { adaptation: adaptation.plan, provenance },
        null,
        2,
      );
    } else {
      if (!input.imageDataUrl) {
        throw new LocalBackendError(
          'The preview could not be captured, so there is nothing to export.',
        );
      }
      payload = input.imageDataUrl;
    }

    const byteSize = input.kind.endsWith('image')
      ? Math.round((payload.length - payload.indexOf(',') - 1) * 0.75)
      : new TextEncoder().encode(payload).length;

    return {
      id: newId('exp'),
      kind: input.kind,
      format,
      // A data: URL, so the caller can display it inline without a network
      // fetch. The embedded preview cannot start a download; the local app
      // writes a real file.
      url: input.kind.endsWith('image')
        ? payload
        : `data:application/json;base64,${bytesToBase64(new TextEncoder().encode(payload))}`,
      byteSize,
      provenance,
    };
  },
};

/** btoa() only accepts latin-1, so encode the UTF-8 bytes explicitly. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const isStandalone = true;
export { measured };
