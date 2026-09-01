import { BadRequestException, Body, Controller, Inject, NotFoundException, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import sharp from 'sharp';
import { ExportRequest, ExportResponse, newId } from '@dae/shared';
import { parseOrThrow } from '../common/errors.js';
import { AdaptationService } from '../adaptations/adaptation.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { LocalAssetStore } from '../assets/asset-store.js';
import { REPOSITORY, type Repository } from '../storage/repository.js';
import { loadEnv } from '../config/env.js';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  json: 'application/json',
};

@Controller('exports')
export class ExportsController {
  private readonly env = loadEnv();

  constructor(
    private readonly adaptations: AdaptationService,
    private readonly devices: DevicesService,
    private readonly assets: LocalAssetStore,
    @Inject(REPOSITORY) private readonly repository: Repository,
  ) {}

  /**
   * Every export carries source-to-target provenance (spec section 25), so a
   * downloaded PNG can always be traced back to the exact source bytes,
   * device profile and engine version that produced it.
   */
  @Post()
  @Throttle({ expensive: { limit: loadEnv().RATE_LIMIT_EXPENSIVE_LIMIT, ttl: loadEnv().RATE_LIMIT_TTL_SECONDS * 1000 } })
  async create(@Body() body: unknown) {
    const parsed = parseOrThrow(ExportRequest, body, 'export request');
    const adaptation = await this.adaptations.get(parsed.adaptationPlanId);
    const device = this.devices.get(adaptation.plan.deviceId);
    const { design } = await this.adaptations.resolveScreen(
      adaptation.plan.designDocumentId,
      adaptation.plan.screenId,
    );
    const source = await this.repository.getSource(design.sourceId);
    if (!source) throw new NotFoundException(`Source "${design.sourceId}" is missing`);

    const provenance = {
      sourceId: source.id,
      sourceHash: source.hash,
      adaptationPlanId: adaptation.plan.id,
      deviceId: device.id,
      engineVersion: adaptation.plan.engineVersion,
      deviceCatalogVersion: adaptation.plan.deviceCatalogVersion,
      exportedAt: new Date().toISOString(),
    };

    let data: Buffer;
    let format = parsed.format;

    if (parsed.kind === 'validation-report') {
      const report = await this.repository.findValidationByPlan(adaptation.plan.id);
      if (!report) throw new BadRequestException('No validation report exists for this adaptation yet. Run validation first.');
      format = 'json';
      data = Buffer.from(JSON.stringify({ report, provenance }, null, 2), 'utf8');
    } else if (parsed.kind === 'device-metadata') {
      format = 'json';
      data = Buffer.from(JSON.stringify({ device, adaptation: adaptation.plan, provenance }, null, 2), 'utf8');
    } else {
      if (!parsed.imageDataUrl) {
        throw new BadRequestException(
          'Image exports require imageDataUrl: the client captures the live preview so the exported pixels are exactly what the designer saw.',
        );
      }
      const decoded = decodeDataUrl(parsed.imageDataUrl, this.env.MAX_UPLOAD_BYTES);
      // Re-encode through Sharp so the stored bytes are a known-good image and
      // any metadata the browser attached is dropped.
      const pipeline = sharp(decoded);
      data =
        format === 'jpeg'
          ? await pipeline.jpeg({ quality: parsed.quality }).toBuffer()
          : format === 'webp'
            ? await pipeline.webp({ quality: parsed.quality }).toBuffer()
            : await pipeline.png().toBuffer();
    }

    const assetId = newId('asset').replace(/[^A-Za-z0-9_-]/g, '');
    await this.assets.put(assetId, data, MIME[format] ?? 'application/octet-stream');

    const record = await this.repository.putExport({
      id: newId('exp'),
      projectId: adaptation.plan.projectId,
      adaptationPlanId: adaptation.plan.id,
      kind: parsed.kind,
      format,
      assetId,
      byteSize: data.byteLength,
      createdAt: provenance.exportedAt,
      provenance,
    });

    return ExportResponse.parse({
      id: record.id,
      kind: record.kind,
      format: record.format,
      url: this.assets.signedUrl(assetId),
      byteSize: record.byteSize,
      provenance,
    });
  }
}

/** Strictly parse a data URL, rejecting anything oversized or malformed. */
export function decodeDataUrl(dataUrl: string, maxBytes: number): Buffer {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new BadRequestException('imageDataUrl must be a base64 PNG, JPEG or WebP data URL.');
  const buffer = Buffer.from(match[2]!, 'base64');
  if (buffer.byteLength > maxBytes) {
    throw new BadRequestException(`Captured image is ${buffer.byteLength} bytes; the limit is ${maxBytes}.`);
  }
  return buffer;
}
