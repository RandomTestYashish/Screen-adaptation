import { DEVICE_CATALOG_SCHEMA_VERSION, DeviceCatalogSchema, type DeviceCatalog } from '@dae/shared';
import type { DeviceDataProvider, RawDeviceRecord } from '../schema/raw.js';
import { normalizeDevice, type NormalizeIssue } from './normalize.js';
import { browserEmulationProvider, type PartialRawRecord } from '../providers/browser-emulation.js';

export interface BuildResult {
  catalog: DeviceCatalog;
  issues: NormalizeIssue[];
  rejected: { id: string; reason: string }[];
}

/**
 * Merge a supplemental partial record into an authoritative one.
 *
 * The supplement can only *confirm or annotate* fields it is allowed to touch.
 * If it disagrees with the authoritative source, the authoritative value wins
 * and the disagreement is recorded as a caveat - never silently applied
 * (spec section 6: "never blindly trust it; normalize and validate fields").
 */
export function mergeSupplement(base: RawDeviceRecord, supplement: PartialRawRecord): RawDeviceRecord {
  const merged: RawDeviceRecord = { ...base, caveats: [...(base.caveats ?? [])] };
  const disagreements: string[] = [];

  const compare = (field: 'logicalWidth' | 'logicalHeight' | 'devicePixelRatio') => {
    const value = supplement[field];
    if (typeof value !== 'number') return;
    if (Math.abs(value - base[field]) > 0.001) {
      disagreements.push(`${field}: authoritative ${base[field]} vs supplemental ${value}`);
    }
  };
  compare('logicalWidth');
  compare('logicalHeight');
  compare('devicePixelRatio');

  if (disagreements.length > 0) {
    merged.caveats!.push(
      `Supplemental device-emulation data disagreed with the authoritative specification and was rejected (${disagreements.join('; ')}).`,
    );
  } else if (supplement.caveats) {
    merged.caveats!.push(...supplement.caveats);
  }
  return merged;
}

/**
 * Run every provider, merge by precedence, normalize, and emit a versioned
 * catalog. Adding devices is a data operation - no application code changes
 * (spec section 32).
 */
export async function buildCatalog(
  providers: DeviceDataProvider[],
  options: { catalogVersion: string; generatedAt?: string } ,
): Promise<BuildResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const ordered = [...providers].sort((a, b) => b.precedence - a.precedence);

  const byId = new Map<string, RawDeviceRecord>();
  const rejected: { id: string; reason: string }[] = [];

  for (const provider of ordered) {
    const records = await provider.fetch();
    for (const record of records) {
      const existing = byId.get(record.id);
      if (!existing) {
        byId.set(record.id, record);
      } else {
        rejected.push({
          id: record.id,
          reason: `Duplicate device from lower-precedence provider "${provider.id}"; kept the higher-precedence record.`,
        });
      }
    }
  }

  // Supplemental pass: viewport/DPR confirmation only.
  for (const supplement of browserEmulationProvider.fetchPartial()) {
    const base = byId.get(supplement.id);
    if (base) byId.set(supplement.id, mergeSupplement(base, supplement));
  }

  const issues: NormalizeIssue[] = [];
  const devices = [];
  for (const raw of byId.values()) {
    const outcome = normalizeDevice(raw, { catalogVersion: options.catalogVersion, generatedAt });
    issues.push(...outcome.issues);
    if (outcome.profile) devices.push(outcome.profile);
    else rejected.push({ id: raw.id, reason: 'Failed normalized-schema validation' });
  }

  devices.sort((a, b) => (a.platform === b.platform ? a.marketingName.localeCompare(b.marketingName) : a.platform.localeCompare(b.platform)));

  const catalog = DeviceCatalogSchema.parse({
    schemaVersion: DEVICE_CATALOG_SCHEMA_VERSION,
    catalogVersion: options.catalogVersion,
    generatedAt,
    sources: [...ordered, browserEmulationProvider].map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.url ? { url: p.url } : {}),
      ...(p.license ? { license: p.license } : {}),
    })),
    devices,
  });

  return { catalog, issues, rejected };
}
