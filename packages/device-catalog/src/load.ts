import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeviceCatalogSchema, type DeviceCatalog } from '@dae/shared';

/**
 * Loads the generated, versioned catalog. The UI and services read *this*
 * normalized file - never the provider modules directly (spec section 6).
 */
let cached: DeviceCatalog | undefined;

export function catalogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Works from both `src/` (tsx/vitest) and `dist/`.
  for (const candidate of [
    resolve(here, '../data/catalog.json'),
    resolve(here, '../../data/catalog.json'),
    resolve(here, 'data/catalog.json'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Device catalog not found. Run `pnpm catalog:sync` to generate packages/device-catalog/data/catalog.json.',
  );
}

export function loadCatalog(options: { force?: boolean } = {}): DeviceCatalog {
  if (cached && !options.force) return cached;
  const raw = JSON.parse(readFileSync(catalogPath(), 'utf8')) as unknown;
  cached = DeviceCatalogSchema.parse(raw);
  return cached;
}

export function setCatalog(catalog: DeviceCatalog): void {
  cached = DeviceCatalogSchema.parse(catalog);
}
