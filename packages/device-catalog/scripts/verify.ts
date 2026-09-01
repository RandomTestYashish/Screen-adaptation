/** Fails CI if the committed catalog is stale or invalid. */
import { loadCatalog } from '../src/load.js';
import { buildCatalog } from '../src/normalizer/build.js';
import { defaultProviders } from '../src/index.js';

const committed = loadCatalog();
const { catalog, issues } = await buildCatalog(defaultProviders, {
  catalogVersion: committed.catalogVersion,
  generatedAt: committed.generatedAt,
});

const a = JSON.stringify(catalog.devices);
const b = JSON.stringify(committed.devices);
if (a !== b) {
  console.error('Committed catalog differs from provider output. Run `pnpm catalog:sync`.');
  process.exit(1);
}
console.log(`Catalog ${committed.catalogVersion} verified: ${committed.devices.length} devices, ${issues.length} warnings.`);
