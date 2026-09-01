/**
 * Scheduled ingestion entry point (spec section 6).
 *
 * Regenerates the normalized catalog from every registered provider and writes
 * data/catalog.json only when the device data actually changed. Adding a new
 * device or a new data source never requires an application-code change - only
 * a provider record and a re-run of this script.
 *
 *   pnpm catalog:sync            # write the catalog if it changed
 *   pnpm catalog:sync -- --dry   # report what would change
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceCatalog } from '@dae/shared';
import { buildCatalog } from '../src/normalizer/build.js';
import { catalogFingerprint, changedDevices, defaultProviders } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../data/catalog.json');
const dryRun = process.argv.includes('--dry');

const previous: DeviceCatalog | undefined = existsSync(outPath)
  ? (JSON.parse(readFileSync(outPath, 'utf8')) as DeviceCatalog)
  : undefined;

function nextCatalogVersion(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const prev = previous?.catalogVersion ?? '';
  if (!prev.startsWith(stamp)) return `${stamp}.1`;
  return `${stamp}.${Number(prev.split('.').pop() ?? '0') + 1}`;
}

const catalogVersion = nextCatalogVersion();
const { catalog, issues, rejected } = await buildCatalog(defaultProviders, { catalogVersion });

// Only a real data change should bump the version: it participates in every
// adaptation cache key, so churning it would invalidate cached plans for
// nothing (spec section 24).
const changed = !previous || catalogFingerprint(previous) !== catalogFingerprint(catalog);
const { added, updated } = previous
  ? changedDevices(previous, catalog)
  : { added: catalog.devices.map((d) => d.id), updated: [] };

console.log(`Device catalog ${changed ? catalogVersion : previous!.catalogVersion} (schema ${catalog.schemaVersion})`);
console.log(`  devices:  ${catalog.devices.length}`);
console.log(`  added:    ${added.length}${added.length ? ` (${added.join(', ')})` : ''}`);
console.log(`  updated:  ${updated.length}${updated.length ? ` (${updated.join(', ')})` : ''}`);
console.log(`  rejected: ${rejected.length}`);
for (const r of rejected) console.log(`    - ${r.id}: ${r.reason}`);
if (issues.length > 0) {
  console.log(`  normalization warnings: ${issues.length}`);
  for (const issue of issues) console.log(`    - ${issue.deviceId} ${issue.field}: ${issue.message}`);
}

if (!changed) {
  console.log(`\nNo device data changed; kept version ${previous!.catalogVersion}.`);
} else if (dryRun) {
  console.log('\nDry run - nothing written.');
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${outPath}`);
}

// Normalization warnings are informational; a device that fails schema
// validation is a hard failure because the UI would have no data to read.
if (rejected.some((r) => r.reason.includes('schema'))) process.exit(1);
