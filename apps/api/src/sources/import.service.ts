import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  PARSER_VERSION,
  SourceDocumentSchema,
  inferred,
  measured,
  newId,
  primaryScreen,
  sha256,
  type DesignDocument,
  type SourceDocument,
} from '@dae/shared';
import { buildFigmaDesign, buildRasterDesign, detectAnchors, type FigmaNode } from '@dae/engine';
import { REPOSITORY, type Repository } from '../storage/repository.js';
import { LocalAssetStore } from '../assets/asset-store.js';
import { AI_ADAPTER, type AIAdapter } from '../ai/ai-adapter.js';
import { loadEnv } from '../config/env.js';

/** Only these are accepted; the magic bytes are checked, not just the header. */
const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
]);

export interface UploadResult {
  source: SourceDocument;
  design: DesignDocument;
  warnings: string[];
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly env = loadEnv();

  constructor(
    @Inject(REPOSITORY) private readonly repository: Repository,
    private readonly assets: LocalAssetStore,
    @Inject(AI_ADAPTER) private readonly ai: AIAdapter,
  ) {}

  /**
   * Ingest a bitmap export.
   *
   * The uploaded bytes are stored verbatim and hashed; nothing in the pipeline
   * ever rewrites them. Sharp is used to *read* metadata, never to modify the
   * artwork (spec section 2).
   */
  async uploadRaster(input: {
    projectId: string;
    filename: string;
    mimeType: string;
    data: Buffer;
  }): Promise<UploadResult> {
    const warnings: string[] = [];

    if (input.data.byteLength > this.env.MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `File is ${input.data.byteLength} bytes; the limit is ${this.env.MAX_UPLOAD_BYTES}.`,
      );
    }
    if (!ALLOWED_IMAGE_TYPES.has(input.mimeType)) {
      throw new BadRequestException(
        `Unsupported type "${input.mimeType}". Supported: ${[...ALLOWED_IMAGE_TYPES.keys()].join(', ')}.`,
      );
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(input.data).metadata();
    } catch {
      throw new BadRequestException('The file could not be decoded as an image.');
    }

    // The declared MIME type is client-controlled; the decoded format is not.
    const expectedFormat = ALLOWED_IMAGE_TYPES.get(input.mimeType);
    if (metadata.format !== expectedFormat) {
      throw new BadRequestException(
        `File content is "${metadata.format}" but was uploaded as "${input.mimeType}".`,
      );
    }
    if (!metadata.width || !metadata.height) {
      throw new BadRequestException('Image dimensions could not be determined.');
    }

    const hash = await sha256(input.data);
    const existing = await this.repository.findSourceByHash(input.projectId, hash);
    if (existing) {
      const design = await this.repository.findDesignBySourceId(existing.id);
      if (design) {
        // Identical bytes: reuse the immutable source rather than storing a copy.
        return { source: existing, design, warnings: ['This file was already imported; the existing source was reused.'] };
      }
    }

    // A 2x/3x export has more pixels than logical units. We can only detect the
    // scale from the file's own DPI metadata; otherwise we say we assumed 1x.
    const density = metadata.density;
    const exportScale = density && density >= 144 ? Math.round(density / 72) : 1;
    if (exportScale > 1) {
      warnings.push(
        `The file reports ${density} DPI, so it was treated as a ${exportScale}x export: ${metadata.width}x${metadata.height} physical pixels map to ${Math.round(metadata.width / exportScale)}x${Math.round(metadata.height / exportScale)} logical pixels.`,
      );
    } else if (metadata.width > 800) {
      warnings.push(
        `The export is ${metadata.width}px wide with no DPI metadata, so it was treated as 1x. If this is a 2x or 3x export, the logical width should be ${Math.round(metadata.width / 2)}px or ${Math.round(metadata.width / 3)}px.`,
      );
    }

    const assetId = newId('asset').replace(/[^A-Za-z0-9_-]/g, '');
    await this.assets.put(assetId, input.data, input.mimeType);

    const source = SourceDocumentSchema.parse({
      id: newId('src'),
      projectId: input.projectId,
      kind: 'raster',
      name: sanitiseFilename(input.filename),
      mimeType: input.mimeType,
      byteSize: input.data.byteLength,
      hash,
      assetId,
      width: metadata.width / exportScale,
      height: metadata.height / exportScale,
      pixelWidth: metadata.width,
      pixelHeight: metadata.height,
      ...(density ? { dpi: density } : {}),
      exportScale,
      exportScaleProvenance:
        exportScale > 1
          ? measured('raster-pixels', 0.8)
          : inferred('heuristic', 0.5, 'No DPI metadata in the file; assumed a 1x export.'),
      importedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      immutable: true,
    });

    await this.repository.putSource(source);

    const analysis = await this.ai.analyseRaster({
      imageData: input.data,
      mimeType: input.mimeType,
      width: source.width,
      height: source.height,
    });
    if (!analysis) {
      const reason = this.ai.unavailableReason();
      if (reason) warnings.push(reason);
    }

    const design = buildRasterDesign({
      source,
      ...(analysis ? { analysis: { regions: analysis.regions, provider: analysis.provider, model: analysis.model } } : {}),
    });
    await this.repository.putDesign(design);

    this.logger.log(
      `Imported raster ${source.id}: ${source.width}x${source.height} logical, ${metadata.width}x${metadata.height} physical`,
    );
    return { source, design, warnings };
  }

  /**
   * Import a Figma frame through the REST API.
   *
   * Node metadata is preserved; the Figma file is only ever read. Nothing is
   * written back and the source frame is never modified (spec section 2).
   */
  async importFigma(input: {
    projectId: string;
    fileKey: string;
    nodeId: string;
    accessToken?: string;
  }): Promise<UploadResult> {
    const token = input.accessToken ?? this.env.FIGMA_ACCESS_TOKEN;
    if (!token) {
      throw new BadRequestException(
        'No Figma access token available. Set FIGMA_ACCESS_TOKEN on the server, or supply one with the request.',
      );
    }

    const url = `https://api.figma.com/v1/files/${encodeURIComponent(input.fileKey)}/nodes?ids=${encodeURIComponent(input.nodeId)}&geometry=paths`;
    const response = await fetch(url, { headers: { 'X-Figma-Token': token } });
    if (!response.ok) {
      throw new BadRequestException(
        `Figma API returned HTTP ${response.status}. Check the file key, node id and token scope.`,
      );
    }

    const payload = (await response.json()) as {
      name?: string;
      version?: string;
      nodes?: Record<string, { document?: FigmaNode }>;
    };
    const document = payload.nodes?.[input.nodeId]?.document;
    if (!document) {
      throw new BadRequestException(`Figma returned no node "${input.nodeId}" in file "${input.fileKey}".`);
    }

    const warnings: string[] = [];
    const imageAssets = await this.fetchFigmaImages(input.fileKey, token, warnings);

    // The hash covers the node payload, so the same frame at the same version
    // is recognised as the same immutable source.
    const serialised = JSON.stringify(document);
    const hash = await sha256(serialised);

    const box = document.absoluteBoundingBox;
    if (!box) throw new BadRequestException('The selected Figma node has no bounding box and cannot be imported.');

    const assetId = newId('asset').replace(/[^A-Za-z0-9_-]/g, '');
    await this.assets.put(assetId, Buffer.from(serialised, 'utf8'), 'application/json');

    const source = SourceDocumentSchema.parse({
      id: newId('src'),
      projectId: input.projectId,
      kind: 'figma',
      name: sanitiseFilename(document.name ?? payload.name ?? 'Figma frame'),
      mimeType: 'application/vnd.figma.node+json',
      byteSize: Buffer.byteLength(serialised),
      hash,
      assetId,
      width: box.width,
      height: box.height,
      exportScale: 1,
      exportScaleProvenance: measured('figma-node', 1, document.id),
      figma: { fileKey: input.fileKey, nodeId: input.nodeId, ...(payload.version ? { version: payload.version } : {}) },
      importedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      immutable: true,
    });
    await this.repository.putSource(source);

    const design = buildFigmaDesign({ source, node: document, imageAssets });
    const { annotations } = detectAnchors(primaryScreen(design));
    for (const annotation of annotations) {
      warnings.push(
        `"${annotation.nodeName}" was treated as ${annotation.position}/${annotation.anchor} (${Math.round(annotation.confidence * 100)}% confidence). ${annotation.reason}`,
      );
    }
    await this.repository.putDesign(design);

    this.logger.log(`Imported Figma node ${input.nodeId}: ${box.width}x${box.height}`);
    return { source, design, warnings };
  }

  /** Resolve Figma image fills to our own asset ids. */
  private async fetchFigmaImages(
    fileKey: string,
    token: string,
    warnings: string[],
  ): Promise<Record<string, string>> {
    try {
      const response = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/images`, {
        headers: { 'X-Figma-Token': token },
      });
      if (!response.ok) {
        warnings.push('Image fills could not be resolved from Figma; those elements will render without artwork.');
        return {};
      }
      const payload = (await response.json()) as { meta?: { images?: Record<string, string> } };
      const images = payload.meta?.images ?? {};
      const mapping: Record<string, string> = {};

      for (const [imageRef, remoteUrl] of Object.entries(images)) {
        try {
          const imageResponse = await fetch(remoteUrl);
          if (!imageResponse.ok) continue;
          const buffer = Buffer.from(await imageResponse.arrayBuffer());
          if (buffer.byteLength > this.env.MAX_UPLOAD_BYTES) {
            warnings.push(`Skipped a Figma image fill larger than the ${this.env.MAX_UPLOAD_BYTES}-byte limit.`);
            continue;
          }
          const contentType = imageResponse.headers.get('content-type') ?? 'image/png';
          const assetId = newId('asset').replace(/[^A-Za-z0-9_-]/g, '');
          await this.assets.put(assetId, buffer, contentType);
          mapping[imageRef] = assetId;
        } catch {
          warnings.push(`A Figma image fill (${imageRef}) could not be downloaded.`);
        }
      }
      return mapping;
    } catch {
      warnings.push('Figma image fills were unavailable; those elements will render without artwork.');
      return {};
    }
  }

}

/**
 * Strip directory components and anything outside a conservative character
 * set, so a filename can never influence a path or be reflected as markup.
 */
export function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'source';
  return base.replace(/[^\w.\- ]/g, '').slice(0, 120) || 'source';
}
