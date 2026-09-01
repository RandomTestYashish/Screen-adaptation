import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { runValidation } from '@dae/engine';
import type { AdaptationResult, RenderEvidence, ValidationReport } from '@dae/shared';
import { REPOSITORY, type Repository } from '../storage/repository.js';
import { type DevicesService } from '../devices/devices.service.js';
import { type AdaptationService } from '../adaptations/adaptation.service.js';
import { type LocalAssetStore } from '../assets/asset-store.js';
import { type PixelComparator } from './pixel-comparator.js';
import { type StructuredLogger } from '../common/logger.js';

@Injectable()
export class ValidationService {
  constructor(
    @Inject(REPOSITORY) private readonly repository: Repository,
    private readonly devices: DevicesService,
    private readonly adaptations: AdaptationService,
    private readonly assets: LocalAssetStore,
    private readonly comparator: PixelComparator,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Validation is mandatory after every adaptation, and always runs its second
   * pass over the corrected result (spec section 15).
   */
  async run(input: {
    adaptationPlanId: string;
    evidence?: RenderEvidence;
  }): Promise<{ report: ValidationReport; adaptation: AdaptationResult }> {
    const started = performance.now();
    const adaptation = await this.adaptations.get(input.adaptationPlanId);
    const { design, screen } = await this.adaptations.resolveScreen(
      adaptation.plan.designDocumentId,
      adaptation.plan.screenId,
    );
    const source = await this.repository.getSource(design.sourceId);
    if (!source) throw new NotFoundException(`Source "${design.sourceId}" is missing`);

    const outcome = await runValidation({
      design,
      screen,
      device: this.devices.get(adaptation.plan.deviceId),
      catalog: this.devices.getCatalog(),
      source,
      adaptation,
      projectId: adaptation.plan.projectId,
      ...(input.evidence ? { evidence: input.evidence } : {}),
      assetResolver: { has: (assetId: string) => this.assets.has(assetId) },
      visualComparator: this.comparator,
    });

    // The correction pass may have rewritten the plan; persist the version the
    // report actually describes so the two can never disagree.
    if (outcome.adaptation.plan.revision !== adaptation.plan.revision) {
      await this.repository.putAdaptation(outcome.adaptation);
    }
    await this.repository.putValidation(outcome.report);

    this.logger.operation('validation.run', performance.now() - started, {
      planId: adaptation.plan.id,
      deviceId: adaptation.plan.deviceId,
      status: outcome.report.status,
      critical: outcome.report.criticalCount,
      warnings: outcome.report.warningCount,
      passes: outcome.report.passes.length,
    });

    return outcome;
  }

  async get(id: string): Promise<ValidationReport> {
    const report = await this.repository.getValidation(id);
    if (!report) throw new NotFoundException(`Unknown validation report "${id}"`);
    return report;
  }
}
