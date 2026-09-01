import { Injectable, Logger } from '@nestjs/common';
import type { RasterAnalysisRegion } from '@dae/engine';
import { loadEnv } from '../config/env.js';

export interface AnalysisRequest {
  imageData: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface AnalysisResult {
  regions: RasterAnalysisRegion[];
  provider: string;
  model: string;
  /** Recorded on every analysis for provenance (spec section 27). */
  requestedAt: string;
}

export const AI_ADAPTER = 'AI_ADAPTER';

/**
 * Internal boundary for AI, so the provider can be swapped without touching
 * the pipeline (spec section 16). AI is only ever additive: it produces an
 * analysis overlay, never a replacement for the designer's artwork.
 */
export interface AIAdapter {
  readonly id: string;
  readonly available: boolean;
  /** Returns undefined when analysis is unavailable or not permitted. */
  analyseRaster(request: AnalysisRequest): Promise<AnalysisResult | undefined>;
  /** Why analysis is unavailable, surfaced to the designer rather than hidden. */
  unavailableReason(): string | undefined;
}

/**
 * Default adapter: no AI at all.
 *
 * Deterministic code covers the whole pipeline; AI is only needed to add
 * optional structure to bitmaps. With no provider configured the product works
 * fully - it simply reports that raster structure is unavailable instead of
 * inventing it.
 */
@Injectable()
export class NullAIAdapter implements AIAdapter {
  readonly id = 'none';
  readonly available = false;

  async analyseRaster(): Promise<undefined> {
    return undefined;
  }

  unavailableReason(): string {
    return 'No AI provider is configured (AI_PROVIDER=none), so the bitmap was imported as immutable artwork with no structural analysis. Geometry, safe-area, scroll and device checks still run in full.';
  }
}

/**
 * OpenAI-backed analysis. Model calls are isolated in this backend service and
 * the API key never leaves the server (spec section 16).
 *
 * User artwork is only transmitted when AI_ALLOW_SOURCE_UPLOAD is explicitly
 * true, so the default configuration cannot send a designer's file to a third
 * party (spec section 27).
 */
@Injectable()
export class OpenAIAdapter implements AIAdapter {
  private readonly logger = new Logger(OpenAIAdapter.name);
  private readonly env = loadEnv();
  readonly id = 'openai';

  get available(): boolean {
    return this.env.AI_PROVIDER === 'openai' && Boolean(this.env.OPENAI_API_KEY) && this.env.AI_ALLOW_SOURCE_UPLOAD;
  }

  unavailableReason(): string | undefined {
    if (this.env.AI_PROVIDER !== 'openai') return 'AI_PROVIDER is not set to openai.';
    if (!this.env.OPENAI_API_KEY) return 'OPENAI_API_KEY is not set.';
    if (!this.env.AI_ALLOW_SOURCE_UPLOAD) {
      return 'AI_ALLOW_SOURCE_UPLOAD is false, so the uploaded design was not sent to an external provider. Set it to true only if sending user artwork off-box is acceptable for your deployment.';
    }
    return undefined;
  }

  async analyseRaster(request: AnalysisRequest): Promise<AnalysisResult | undefined> {
    if (!this.available) return undefined;

    const prompt = [
      'You are analysing a mobile UI screenshot to produce an inspection overlay.',
      'Return ONLY JSON: {"regions":[{"x":number,"y":number,"width":number,"height":number,',
      '"kind":"text"|"image"|"button"|"container"|"icon"|"divider","text":string?,"confidence":number,',
      '"fontSize":number?,"fontWeight":number?,"color":{"r":number,"g":number,"b":number,"a":number}?}]}',
      `Coordinates are in pixels within a ${request.width}x${request.height} image, origin top-left.`,
      'Do not redesign, restyle or describe improvements. Report only what is visibly present.',
    ].join(' ');

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: this.env.OPENAI_MODEL,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:${request.mimeType};base64,${request.imageData.toString('base64')}` },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`AI analysis failed with HTTP ${response.status}; continuing without structural analysis.`);
        return undefined;
      }

      const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) return undefined;

      const parsed = JSON.parse(content) as { regions?: unknown };
      const regions = Array.isArray(parsed.regions) ? (parsed.regions as RasterAnalysisRegion[]) : [];
      // Clamp everything into the image: a hallucinated region must never
      // produce geometry outside the artwork.
      const clamped = regions
        .filter((r) => typeof r.x === 'number' && typeof r.y === 'number' && r.width > 0 && r.height > 0)
        .map((r) => ({
          ...r,
          x: Math.max(0, Math.min(r.x, request.width)),
          y: Math.max(0, Math.min(r.y, request.height)),
          width: Math.min(r.width, request.width),
          height: Math.min(r.height, request.height),
          confidence: Math.max(0, Math.min(r.confidence ?? 0.5, 1)),
        }));

      return {
        regions: clamped,
        provider: 'openai',
        model: this.env.OPENAI_MODEL,
        requestedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(`AI analysis errored: ${(error as Error).message}. Continuing without structural analysis.`);
      return undefined;
    }
  }
}
