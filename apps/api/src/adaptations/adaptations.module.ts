import { Module } from '@nestjs/common';
import { AdaptationService } from './adaptation.service.js';
import { AdaptationsController } from './adaptations.controller.js';

@Module({
  controllers: [AdaptationsController],
  providers: [AdaptationService],
  exports: [AdaptationService],
})
export class AdaptationsModule {}
