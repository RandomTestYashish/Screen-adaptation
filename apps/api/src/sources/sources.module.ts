import { Module } from '@nestjs/common';
import { ImportService } from './import.service.js';
import { SourcesController } from './sources.controller.js';

@Module({
  controllers: [SourcesController],
  providers: [ImportService],
  exports: [ImportService],
})
export class SourcesModule {}
