import { Module } from '@nestjs/common';
import { AdaptationsModule } from '../adaptations/adaptations.module.js';
import { PixelComparator } from './pixel-comparator.js';
import { ValidationService } from './validation.service.js';
import { ValidationsController } from './validations.controller.js';

@Module({
  imports: [AdaptationsModule],
  controllers: [ValidationsController],
  providers: [ValidationService, PixelComparator],
  exports: [ValidationService],
})
export class ValidationsModule {}
