import { Global, Module } from '@nestjs/common';
import { StructuredLogger } from './logger.js';

@Global()
@Module({ providers: [StructuredLogger], exports: [StructuredLogger] })
export class LoggingModule {}
