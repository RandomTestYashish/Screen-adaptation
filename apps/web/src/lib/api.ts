import {
  CreateProjectResponse,
  DeviceListResponse,
  DeviceProfileSchema,
  ExportResponse,
  FigmaImportResponse,
  RenderResponse,
  UploadSourceResponse,
  ValidationRunResponse,
  type AdaptationOptions,
  type DeviceListResponseT,
  type DeviceProfile,
  type DeviceQueryT,
  type ExportResponseT,
  type Project,
  type RenderEvidence,
  type RenderResponseT,
  type UploadSourceResponseT,
  type ValidationRunResponseT,
} from '@dae/shared';
import type { ZodTypeAny, z } from 'zod';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Every response is parsed with the same Zod schema the server used to build
 * it, so a contract change surfaces here rather than as a runtime crash deep in
 * the renderer (spec section 21).
 */
async function request<S extends ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const error = payload as { message?: string; details?: unknown } | undefined;
    throw new ApiRequestError(error?.message ?? `Request failed (HTTP ${response.status})`, response.status, error?.details);
  }
  return schema.parse(payload);
}

export function assetUrl(signedPath: string): string {
  // The standalone backend hands back blob: and data: URLs, which are already
  // absolute; only a server-relative signed path needs the API origin.
  return /^[a-z]+:/i.test(signedPath) ? signedPath : `${BASE}${signedPath}`;
}

export interface HealthStatus {
  status: string;
  versions: Record<string, string>;
  deviceCatalog: { version: string; schemaVersion: string; deviceCount: number; generatedAt: string };
  drivers: Record<string, string>;
  capabilities: { figmaImport: boolean; rasterAnalysis: boolean; rasterAnalysisUnavailableReason: string | null };
}

export const remoteApi = {
  async health(): Promise<HealthStatus> {
    const response = await fetch(`${BASE}/health`);
    if (!response.ok) throw new ApiRequestError('The API is not reachable', response.status);
    return (await response.json()) as HealthStatus;
  },

  createProject(name: string): Promise<Project> {
    return request('/projects', CreateProjectResponse, { method: 'POST', body: JSON.stringify({ name }) });
  },

  uploadSource(projectId: string, file: File): Promise<UploadSourceResponseT> {
    const form = new FormData();
    form.append('projectId', projectId);
    form.append('file', file);
    return request('/sources/upload', UploadSourceResponse, { method: 'POST', body: form });
  },

  /**
   * Import one of the designs bundled with the app, so there is always
   * something to try without hunting for a mobile export.
   */
  async uploadSample(projectId: string, source: string, name: string): Promise<UploadSourceResponseT> {
    const blob = await (await fetch(source)).blob();
    return remoteApi.uploadSource(projectId, new File([blob], name, { type: blob.type || 'image/png' }));
  },

  importFigma(input: { projectId: string; fileKey: string; nodeId: string; accessToken?: string }) {
    return request('/sources/figma/import', FigmaImportResponse, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listDevices(query: Partial<DeviceQueryT> = {}): Promise<DeviceListResponseT> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString();
    return request(`/devices${suffix ? `?${suffix}` : ''}`, DeviceListResponse);
  },

  getDevice(id: string): Promise<DeviceProfile> {
    return request(`/devices/${encodeURIComponent(id)}`, DeviceProfileSchema);
  },

  render(input: {
    designDocumentId: string;
    screenId?: string;
    deviceId: string;
    options?: Partial<AdaptationOptions>;
  }): Promise<RenderResponseT> {
    return request('/adaptations/render', RenderResponse, {
      method: 'POST',
      body: JSON.stringify({ ...input, includeDesign: true }),
    });
  },

  validate(adaptationPlanId: string, evidence?: RenderEvidence): Promise<ValidationRunResponseT> {
    return request('/validations/run', ValidationRunResponse, {
      method: 'POST',
      body: JSON.stringify({ adaptationPlanId, ...(evidence ? { evidence } : {}) }),
    });
  },

  export(input: {
    adaptationPlanId: string;
    kind: 'viewport-image' | 'full-length-image' | 'validation-report' | 'device-metadata';
    format?: 'png' | 'jpeg' | 'webp' | 'json';
    imageDataUrl?: string;
  }): Promise<ExportResponseT> {
    return request('/exports', ExportResponse, { method: 'POST', body: JSON.stringify(input) });
  },
};

/**
 * Build-time backend selection.
 *
 * `VITE_STANDALONE=true` produces a single self-contained page that runs the
 * real engine and the real device catalog in the browser, with no server. It is
 * the same code path otherwise: the standalone backend implements this exact
 * surface, so no component knows which one it is talking to.
 */
export const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';

type Backend = Pick<
  typeof remoteApi,
  | 'health'
  | 'createProject'
  | 'uploadSource'
  | 'uploadSample'
  | 'importFigma'
  | 'listDevices'
  | 'getDevice'
  | 'render'
  | 'validate'
  | 'export'
>;

let selected: Backend = remoteApi;

if (STANDALONE) {
  // `STANDALONE` collapses to a literal at build time, so the whole branch -
  // and with it the standalone backend, the engine and the inlined catalog -
  // is eliminated from the client-server build rather than shipped as an
  // unused chunk.
  const { localBackend } = await import('./local-backend.js');
  selected = localBackend as unknown as Backend;
}

export const api = selected;
