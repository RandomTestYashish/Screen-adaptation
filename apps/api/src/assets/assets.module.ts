import { Global, Module } from '@nestjs/common';
import { LocalAssetStore, ASSET_STORE } from './asset-store.js';
import { AssetsController } from './assets.controller.js';

/**
 * ASSET_STORE=s3 is intentionally not wired here: an S3 adapter belongs behind
 * the same `AssetStore` interface, and env validation rejects `s3` until one
 * exists rather than silently falling back to local disk.
 */
@Global()
@Module({
  controllers: [AssetsController],
  providers: [LocalAssetStore, { provide: ASSET_STORE, useExisting: LocalAssetStore }],
  exports: [LocalAssetStore, ASSET_STORE],
})
export class AssetsModule {}
