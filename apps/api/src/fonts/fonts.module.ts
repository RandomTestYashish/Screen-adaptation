import { Module } from '@nestjs/common';
import { FontsController } from './fonts.controller.js';

@Module({ controllers: [FontsController] })
export class FontsModule {}
