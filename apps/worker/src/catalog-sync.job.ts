import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildCatalog, catalogFingerprint, catalogPath, changedDevices, defaultProviders } from '@dae/device-catalog';
import type { DeviceCatalog } from '@dae/shared';

export interface SyncOutcome {
  catalogVersion: string;
  deviceCount: number;
  added: string[];
  updated: string[];
  rejected: { id: string; reason: string }[];
  warnings: string[];
  changed: boolean;
  wrote: boolean;
}

function nextVersion(previous: string | undefined): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  if (!previous?.startsWith(stamp)) return `${stamp}.1`;
  return `${stamp}.${Number(previous.split('.').pop() ?? '0') + 1}`;
}

/**
 * The scheduled ingestion mechanism (spec section 6).
 *
 * Rebuilds the normalized catalog from every registered provider and writes it
 * only when the device data actually changed, so an unchanged run does not
 * churn the catalog version that adaptation cache keys depend on.
 *
 * A previous catalog is kept alongside the new one, because plans and reports
 * reference the version that produced them.
 */
export async function runCatalogSync(options: { dryRun?: boolean } = {}): Promise<SyncOutcome> {
  let target: string;
  let previous: DeviceCatalog | undefined;
  try {
    target = catalogPath();
    previous = JSON.parse(readFileSync(target, 'utf8')) as DeviceCatalog;
  } catch {
    // First run: write next to the package's data directory.
    target = resolve(process.cwd(), 'packages/device-catalog/data/catalog.json');
  }

  const version = nextVersion(previous?.catalogVersion);
  const { catalog, issues, rejected } = await buildCatalog(defaultProviders, { catalogVersion: version });

  const { added, updated } = previous
    ? changedDevices(previous, catalog)
    : { added: catalog.devices.map((d) => d.id), updated: [] };

  const changed = !previous || catalogFingerprint(previous) !== catalogFingerprint(catalog);
  let wrote = false;

  if (changed && !options.dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    if (previous && existsSync(target)) {
      // Retain the superseded version: existing plans reference it.
      copyFileSync(target, resolve(dirname(target), `catalog-${previous.catalogVersion}.json`));
    }
    writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    wrote = true;
  }

  return {
    catalogVersion: catalog.catalogVersion,
    deviceCount: catalog.devices.length,
    added,
    updated,
    rejected,
    warnings: issues.map((i) => `${i.deviceId} ${i.field}: ${i.message}`),
    changed,
    wrote,
  };
}
