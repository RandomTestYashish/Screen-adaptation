import { Body, Controller, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { PlanRequest, PlanResponse, RenderListResponse, RenderRequest, RenderResponse } from '@dae/shared';
import { parseOrThrow } from '../common/errors.js';
import { AdaptationService } from './adaptation.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { REPOSITORY, type Repository } from '../storage/repository.js';
import { LocalAssetStore } from '../assets/asset-store.js';

@Controller()
export class AdaptationsController {
  constructor(
    private readonly adaptations: AdaptationService,
    private readonly devices: DevicesService,
    private readonly assets: LocalAssetStore,
    @Inject(REPOSITORY) private readonly repository: Repository,
  ) {}

  @Post('adaptations/plan')
  async plan(@Body() body: unknown) {
    const parsed = parseOrThrow(PlanRequest, body, 'adaptation plan request');
    const result = await this.adaptations.plan(parsed);
    return PlanResponse.parse(result);
  }

  /**
   * Returns everything the client renderer needs. The design is never
   * rasterised server-side for the preview: the browser renders the Design IR
   * or the original bitmap directly, so a structured source is never flattened
   * into an image (spec section 32).
   */
  @Post('adaptations/render')
  async render(@Body() body: unknown) {
    const parsed = parseOrThrow(RenderRequest, body, 'render request');
    const adaptation = await this.adaptations.plan(parsed);
    const { design } = await this.adaptations.resolveScreen(parsed.designDocumentId, parsed.screenId);
    const source = await this.repository.getSource(design.sourceId);
    if (!source) throw new NotFoundException(`Source "${design.sourceId}" is missing`);

    return RenderResponse.parse({
      adaptation,
      device: this.devices.get(parsed.deviceId),
      ...(parsed.includeDesign ? { design } : {}),
      source,
      sourceAssetUrl: this.assets.signedUrl(source.assetId),
      assetUrls: Object.fromEntries(
        [...new Set([source.assetId, ...design.assetsUsed])].map((assetId) => [
          assetId,
          this.assets.signedUrl(assetId),
        ]),
      ),
    });
  }

  @Get('projects/:id/renders')
  async listRenders(@Param('id') projectId: string) {
    const adaptations = await this.repository.listAdaptationsForProject(projectId);
    const renders = await Promise.all(
      adaptations.map(async (adaptation) => {
        const validation = await this.repository.findValidationByPlan(adaptation.plan.id);
        return {
          adaptationPlanId: adaptation.plan.id,
          deviceId: adaptation.plan.deviceId,
          deviceName: this.devices.get(adaptation.plan.deviceId).marketingName,
          createdAt: adaptation.plan.createdAt,
          adaptationFidelity: adaptation.plan.preservation.score,
          validationStatus: validation?.status ?? ('not-run' as const),
        };
      }),
    );
    return RenderListResponse.parse({ renders });
  }
}
