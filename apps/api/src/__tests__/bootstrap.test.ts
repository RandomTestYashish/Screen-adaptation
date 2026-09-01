import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * Boots the real application graph and exercises the pipeline through it.
 *
 * This runs against the **compiled output**, not the TypeScript sources, and
 * that is deliberate. NestJS resolves constructor dependencies from the runtime
 * metadata `emitDecoratorMetadata` produces, and Vitest's esbuild transform
 * does not emit it - so a source-level boot test would construct every service
 * with no dependencies at all and pass while the shipped app was broken.
 *
 * It exists because exactly that happened: a lint autofix rewrote every
 * injected class to `import type`, erasing the bindings Nest needs. Everything
 * compiled, every other test passed, and only starting the built app revealed
 * it. `pnpm test` builds the API first so this always has something real to
 * check.
 */
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');

describe('application bootstrap', () => {
  let app: INestApplicationContext;
  let dataDir: string;
  let assetDir: string;

  beforeAll(async () => {
    if (!existsSync(join(DIST, 'app.module.js'))) {
      throw new Error(
        `No compiled API at ${DIST}. Run \`pnpm --filter @dae/api build\` first; \`pnpm test\` does this automatically.`,
      );
    }

    dataDir = mkdtempSync(join(tmpdir(), 'dae-boot-data-'));
    assetDir = mkdtempSync(join(tmpdir(), 'dae-boot-assets-'));
    process.env['DATA_DIR'] = dataDir;
    process.env['ASSET_DIR'] = assetDir;
    process.env['ASSET_URL_SECRET'] = 'test-secret-value-1234567890';

    await import('reflect-metadata');
    const [{ NestFactory }, { AppModule }] = await Promise.all([
      import('@nestjs/core'),
      import(/* @vite-ignore */ `${DIST}/app.module.js`),
    ]);
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(assetDir, { recursive: true, force: true });
  });

  type Ctor = new (...args: never[]) => unknown;

  /** Load a class from the compiled output to use as a DI token. */
  async function token(path: string, name: string): Promise<Ctor> {
    const module = (await import(/* @vite-ignore */ `${DIST}/${path}`)) as Record<string, Ctor | undefined>;
    const ctor = module[name];
    if (!ctor) throw new Error(`${name} is not exported from dist/${path}`);
    return ctor;
  }

  it('injects every constructor dependency', async () => {
    const services = [
      await token('sources/import.service.js', 'ImportService'),
      await token('adaptations/adaptation.service.js', 'AdaptationService'),
      await token('validations/validation.service.js', 'ValidationService'),
      await token('devices/devices.service.js', 'DevicesService'),
      await token('assets/asset-store.js', 'LocalAssetStore'),
      await token('validations/pixel-comparator.js', 'PixelComparator'),
    ];

    for (const service of services) {
      const instance = app.get(service, { strict: false }) as Record<string, unknown>;
      expect(instance, `${service.name} did not resolve`).toBeDefined();

      // A class whose import lost its runtime binding still constructs - Nest
      // just passes nothing - so check the fields are actually populated.
      for (const [field, value] of Object.entries(instance)) {
        expect(value, `${service.name}.${field} was not injected`).toBeDefined();
      }
    }
  });

  it('loads the device catalog through the running graph', async () => {
    const devices = app.get(await token('devices/devices.service.js', 'DevicesService'), {
      strict: false,
    }) as { getCatalog(): { devices: unknown[] }; get(id: string): { viewport: { portrait: { width: number } } } };
    expect(devices.getCatalog().devices.length).toBeGreaterThan(25);
    expect(devices.get('apple-iphone-16-pro').viewport.portrait.width).toBe(402);
  });

  it('runs a source through adaptation and validation end to end', async () => {
    const { buildRasterDesign } = await import('@dae/engine');
    const { SourceDocumentSchema, newId, PARSER_VERSION, measured } = await import('@dae/shared');
    const { REPOSITORY } = (await import(/* @vite-ignore */ `${DIST}/storage/repository.js`)) as {
      REPOSITORY: string;
    };

    const repository = app.get(REPOSITORY, { strict: false }) as {
      createProject(p: unknown): Promise<{ id: string }>;
      putSource(s: unknown): Promise<unknown>;
      putDesign(d: unknown): Promise<unknown>;
    };

    const now = new Date().toISOString();
    const project = await repository.createProject({ id: newId('proj'), name: 'bootstrap', createdAt: now, updatedAt: now });

    const source = SourceDocumentSchema.parse({
      id: newId('src'),
      projectId: project.id,
      kind: 'raster',
      name: 'boot.png',
      mimeType: 'image/png',
      byteSize: 1024,
      hash: 'b'.repeat(64),
      assetId: 'asset_boot',
      width: 375,
      height: 2400,
      exportScale: 1,
      exportScaleProvenance: measured('raster-pixels', 1),
      importedAt: now,
      parserVersion: PARSER_VERSION,
      immutable: true,
    });
    await repository.putSource(source);
    const design = buildRasterDesign({ source });
    await repository.putDesign(design);

    const adaptations = app.get(await token('adaptations/adaptation.service.js', 'AdaptationService'), {
      strict: false,
    }) as { plan(input: unknown): Promise<{ plan: { id: string; strategy: string } }> };

    const adaptation = await adaptations.plan({ designDocumentId: design.id, deviceId: 'apple-iphone-16-pro' });
    expect(adaptation.plan.strategy).toBe('uniform-scale');

    // The same request must come back from cache rather than being recomputed.
    const again = await adaptations.plan({ designDocumentId: design.id, deviceId: 'apple-iphone-16-pro' });
    expect(again.plan.id).toBe(adaptation.plan.id);

    const validations = app.get(await token('validations/validation.service.js', 'ValidationService'), {
      strict: false,
    }) as { run(input: unknown): Promise<{ report: { passes: unknown[]; limitations: string[] } }> };

    const { report } = await validations.run({ adaptationPlanId: adaptation.plan.id });
    expect(report.passes).toHaveLength(2);
    expect(report.limitations.some((l) => l.includes('not a physical device'))).toBe(true);
  }, 30_000);
});
