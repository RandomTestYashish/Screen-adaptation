import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { ApiExceptionFilter } from './common/errors.js';
import { StructuredLogger } from './common/logger.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(StructuredLogger));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use(
    helmet({
      // Assets are served to an <img> in the web app on a different origin
      // during development; the resource policy stays same-site in production.
      crossOriginResourcePolicy: { policy: env.NODE_ENV === 'production' ? 'same-site' : 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  const logger = app.get(StructuredLogger);
  logger.log(`API listening on http://localhost:${env.PORT} (storage=${env.STORAGE_DRIVER}, queue=${env.QUEUE_DRIVER}, ai=${env.AI_PROVIDER})`, 'bootstrap');
}

void bootstrap();
