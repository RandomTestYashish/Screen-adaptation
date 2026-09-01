import { Module } from '@nestjs/common';
import { AdaptationsModule } from '../adaptations/adaptations.module.js';
import { ExportsController } from './exports.controller.js';

@Module({ imports: [AdaptationsModule], controllers: [ExportsController] })
export class ExportsModule {}
