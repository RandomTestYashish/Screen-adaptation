import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdaptationOptionsSchema,
  adaptationCacheKey,
  primaryScreen,
  type AdaptationOptions,
  type AdaptationResult,
  type DesignDocument,
  type Screen,
} from '@dae/shared';
import { planAdaptation } from '@dae/engine';
import { REPOSITORY, type Repository } from '../storage/repository.js';
import { DevicesService } from '../devices/devices.service.js';
import { StructuredLogger } from '../common/logger.js';

@Injectable()
export class AdaptationService {
  constructor(
    @Inject(REPOSITORY) private readonly repository: Repository,
    private readonly devices: DevicesService,
    private readonly logger: StructuredLogger,
  ) {}

  async resolveScreen(designDocumentId: string, screenId?: string): Promise<{ design: DesignDocument; screen: Screen }> {
    const design = await this.repository.getDesign(designDocumentId);
    if (!design) throw new NotFoundException(`Unknown design document "${designDocumentId}"`);
    const screen = screenId ? design.screens.find((s) => s.id === screenId) : primaryScreen(design);
    if (!screen) throw new BadRequestException(`Unknown screen "${screenId}" in design "${designDocumentId}"`);
    return { design, screen };
  }

  /**
   * Produce (or reuse) an adaptation.
   *
   * Toggling a device must never re-run the whole pipeline, so plans are cached
   * by source hash + device + catalog version + engine version + options
   * (spec section 24). Any change to those inputs produces a different key.
   */
  async plan(input: {
    designDocumentId: string;
    screenId?: string;
    deviceId: string;
    options?: Partial<AdaptationOptions>;
  }): Promise<AdaptationResult> {
    const started = performance.now();
    const { design, screen } = await this.resolveScreen(input.designDocumentId, input.screenId);
    const device = this.devices.get(input.deviceId);
    const options = AdaptationOptionsSchema.parse(input.options ?? {});

    const cacheKey = await adaptationCacheKey({
      sourceHash: design.sourceHash,
      deviceId: device.id,
      deviceCatalogVersion: device.catalogVersion,
      engineVersion: (await import('@dae/shared')).ADAPTATION_ENGINE_VERSION,
      options: { ...options, screenId: screen.id },
    });

    const cached = await this.repository.findAdaptationByCacheKey(cacheKey);
    if (cached) {
      this.logger.operation('adaptation.cache-hit', performance.now() - started, {
        deviceId: device.id,
        planId: cached.plan.id,
      });
      return cached;
    }

    const planned = planAdaptation({
      design,
      screen,
      device,
      catalog: this.devices.getCatalog(),
      projectId: await this.projectIdFor(design),
    });

    const result: AdaptationResult = {
      plan: { ...planned.plan, cacheKey },
      nodes: planned.nodes,
    };
    await this.repository.putAdaptation(result);

    this.logger.operation('adaptation.plan', performance.now() - started, {
      deviceId: device.id,
      strategy: result.plan.strategy,
      transforms: result.plan.transforms.length,
      preservation: result.plan.preservation.score,
    });
    return result;
  }

  async get(planId: string): Promise<AdaptationResult> {
    const result = await this.repository.getAdaptation(planId);
    if (!result) throw new NotFoundException(`Unknown adaptation plan "${planId}"`);
    return result;
  }

  private async projectIdFor(design: DesignDocument): Promise<string> {
    const source = await this.repository.getSource(design.sourceId);
    if (!source) throw new NotFoundException(`Source "${design.sourceId}" is missing`);
    return source.projectId;
  }
}
