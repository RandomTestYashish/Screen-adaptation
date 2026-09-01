import { Controller, Get, Inject } from '@nestjs/common';
import { DevicesService } from '../devices/devices.service.js';
import { loadEnv } from '../config/env.js';
import { JOB_QUEUE, type JobQueue } from '../queue/job-queue.js';
import { AI_ADAPTER, type AIAdapter } from '../ai/ai-adapter.js';
import {
  ADAPTATION_ENGINE_VERSION,
  DESIGN_IR_VERSION,
  PARSER_VERSION,
  VALIDATION_ENGINE_VERSION,
} from '@dae/shared';

/**
 * Exposes exactly which drivers and versions are live, so the operating mode
 * is never a guess - the UI shows this in the About panel.
 */
@Controller('health')
export class HealthController {
  private readonly env = loadEnv();

  constructor(
    private readonly devices: DevicesService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(AI_ADAPTER) private readonly ai: AIAdapter,
  ) {}

  @Get()
  status() {
    const catalog = this.devices.getCatalog();
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
      drivers: {
        storage: this.env.STORAGE_DRIVER,
        assets: this.env.ASSET_STORE,
        queue: this.queue.driver,
        ai: this.ai.id,
      },
      capabilities: {
        figmaImport: Boolean(this.env.FIGMA_ACCESS_TOKEN),
        rasterAnalysis: this.ai.available,
        rasterAnalysisUnavailableReason: this.ai.unavailableReason() ?? null,
      },
    };
  }
}
