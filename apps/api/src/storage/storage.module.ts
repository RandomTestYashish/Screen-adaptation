import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { REPOSITORY, type Repository } from './repository.js';
import { FilesystemRepository } from './filesystem.repository.js';

/**
 * Selects the persistence driver from STORAGE_DRIVER. Prisma is imported
 * lazily so the default filesystem setup does not require a generated client.
 */
async function createRepository(): Promise<{ repository: Repository; dispose?: () => Promise<void> }> {
  const env = loadEnv();
  if (env.STORAGE_DRIVER === 'filesystem') {
    return { repository: new FilesystemRepository(env.DATA_DIR) };
  }
  const [{ PrismaClient }, { PrismaRepository }] = await Promise.all([
    import('@prisma/client'),
    import('./prisma.repository.js'),
  ]);
  const client = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL! } } });
  await client.$connect();
  return { repository: new PrismaRepository(client), dispose: () => client.$disconnect() };
}

let disposer: (() => Promise<void>) | undefined;

@Global()
@Module({
  providers: [
    {
      provide: REPOSITORY,
      useFactory: async () => {
        const { repository, dispose } = await createRepository();
        disposer = dispose;
        return repository;
      },
    },
  ],
  exports: [REPOSITORY],
})
export class StorageModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await disposer?.();
  }
}
