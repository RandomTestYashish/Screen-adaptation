import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CreateProjectRequest, CreateProjectResponse, FigmaImportRequest, FigmaImportResponse, UploadSourceResponse, newId, primaryScreen } from '@dae/shared';
import { parseOrThrow } from '../common/errors.js';
import { REPOSITORY, type Repository } from '../storage/repository.js';
import { DevicesService } from '../devices/devices.service.js';
import { ImportService } from './import.service.js';
import { loadEnv } from '../config/env.js';

@Controller()
export class SourcesController {
  constructor(
    @Inject(REPOSITORY) private readonly repository: Repository,
    private readonly imports: ImportService,
    private readonly devices: DevicesService,
  ) {}

  @Post('projects')
  async createProject(@Body() body: unknown) {
    const parsed = parseOrThrow(CreateProjectRequest, body ?? {}, 'project');
    const now = new Date().toISOString();
    const project = await this.repository.createProject({
      id: newId('proj'),
      name: parsed.name,
      createdAt: now,
      updatedAt: now,
    });
    return CreateProjectResponse.parse(project);
  }

  @Post('sources/upload')
  @Throttle({ expensive: { limit: loadEnv().RATE_LIMIT_EXPENSIVE_LIMIT, ttl: loadEnv().RATE_LIMIT_TTL_SECONDS * 1000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: loadEnv().MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('projectId') projectId: string) {
    if (!file) throw new BadRequestException('No file was uploaded under the field name "file".');
    if (!projectId) throw new BadRequestException('projectId is required.');
    const project = await this.repository.getProject(projectId);
    if (!project) throw new BadRequestException(`Unknown project "${projectId}".`);

    const { source, design, warnings } = await this.imports.uploadRaster({
      projectId,
      filename: file.originalname,
      mimeType: file.mimetype,
      data: file.buffer,
    });

    const screen = primaryScreen(design);
    return UploadSourceResponse.parse({
      source,
      design,
      defaultDeviceId: this.devices.defaultFor(screen.frame.width).id,
      warnings,
    });
  }

  @Post('sources/figma/import')
  @Throttle({ expensive: { limit: loadEnv().RATE_LIMIT_EXPENSIVE_LIMIT, ttl: loadEnv().RATE_LIMIT_TTL_SECONDS * 1000 } })
  async importFigma(@Body() body: unknown) {
    const parsed = parseOrThrow(FigmaImportRequest, body, 'Figma import request');
    const project = await this.repository.getProject(parsed.projectId);
    if (!project) throw new BadRequestException(`Unknown project "${parsed.projectId}".`);

    const { source, design, warnings } = await this.imports.importFigma(parsed);
    const screen = primaryScreen(design);
    return FigmaImportResponse.parse({
      source,
      design,
      defaultDeviceId: this.devices.defaultFor(screen.frame.width).id,
      warnings,
    });
  }
}
