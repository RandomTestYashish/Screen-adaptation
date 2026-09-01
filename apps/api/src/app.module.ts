import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from './config/env.js';
import { LoggingModule } from './common/logging.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { AiModule } from './ai/ai.module.js';
import { QueueModule } from './queue/queue.module.js';
import { SourcesModule } from './sources/sources.module.js';
import { AdaptationsModule } from './adaptations/adaptations.module.js';
import { ValidationsModule } from './validations/validations.module.js';
import { ExportsModule } from './exports/exports.module.js';
import { FontsModule } from './fonts/fonts.module.js';
import { HealthModule } from './health/health.module.js';

const env = loadEnv();

@Module({
  imports: [
    // Two budgets: a generous default, and a tighter one applied per-route to
    // the expensive analyse/render/validate/export endpoints (spec section 27).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_LIMIT },
      { name: 'expensive', ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_EXPENSIVE_LIMIT },
    ]),
    LoggingModule,
    StorageModule,
    AssetsModule,
    DevicesModule,
    AiModule,
    QueueModule,
    SourcesModule,
    AdaptationsModule,
    ValidationsModule,
    ExportsModule,
    FontsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
