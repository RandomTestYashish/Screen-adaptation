/**
 * Catalog queries. Deliberately free of Node built-ins so this module can also
 * run in the browser: the standalone preview build of the web app runs the
 * whole pipeline client-side against an inlined catalog.
 */
import type { DeviceCatalog, DeviceProfile, DeviceQueryT, DeviceListResponseT } from '@dae/shared';

export type SizeCategory = 'compact' | 'regular' | 'large';

/** Screen-size category derived from logical width, used by the explorer filter. */
export function sizeCategory(device: DeviceProfile): SizeCategory {
  const w = device.viewport.portrait.width;
  if (w <= 375) return 'compact';
  if (w <= 412) return 'regular';
  return 'large';
}

/** Device generation / era bucket, used by the explorer filter. */
export function era(device: DeviceProfile): string {
  const y = device.releaseYear;
  if (y >= 2024) return '2024+';
  if (y >= 2022) return '2022-2023';
  if (y >= 2020) return '2020-2021';
  return 'pre-2020';
}

function matchesSearch(device: DeviceProfile, needle: string): boolean {
  const hay = [
    device.marketingName,
    device.model,
    device.manufacturer,
    device.family,
    device.osName,
    device.generation,
    device.id,
  ]
    .join(' ')
    .toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

export function queryDevices(catalog: DeviceCatalog, query: Partial<DeviceQueryT>): DeviceProfile[] {
  const ids = query.ids ? new Set(query.ids.split(',').map((s) => s.trim()).filter(Boolean)) : undefined;

  return catalog.devices.filter((device) => {
    if (ids && !ids.has(device.id)) return false;
    if (query.search && !matchesSearch(device, query.search)) return false;
    if (query.platform && device.platform !== query.platform) return false;
    if (query.manufacturer && device.manufacturer !== query.manufacturer) return false;
    if (query.osName && device.osName !== query.osName) return false;

    const { width, height } = device.viewport.portrait;
    if (query.minWidth !== undefined && width < query.minWidth) return false;
    if (query.maxWidth !== undefined && width > query.maxWidth) return false;
    if (query.minHeight !== undefined && height < query.minHeight) return false;
    if (query.maxHeight !== undefined && height > query.maxHeight) return false;

    if (query.minAspectRatio !== undefined && device.aspectRatio < query.minAspectRatio) return false;
    if (query.maxAspectRatio !== undefined && device.aspectRatio > query.maxAspectRatio) return false;
    if (query.minDpr !== undefined && device.devicePixelRatio < query.minDpr) return false;
    if (query.maxDpr !== undefined && device.devicePixelRatio > query.maxDpr) return false;

    if (query.era && era(device) !== query.era) return false;
    if (query.sizeCategory && sizeCategory(device) !== query.sizeCategory) return false;
    return true;
  });
}

function countBy<T>(items: T[], pick: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = pick(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Facets are computed over the *whole* catalog so filters never dead-end. */
export function buildResponse(catalog: DeviceCatalog, query: Partial<DeviceQueryT>): DeviceListResponseT {
  const matched = queryDevices(catalog, query);
  const limited = matched.slice(0, query.limit ?? 200);
  const widths = catalog.devices.map((d) => d.viewport.portrait.width);
  const dprs = catalog.devices.map((d) => d.devicePixelRatio);

  return {
    catalogVersion: catalog.catalogVersion,
    schemaVersion: catalog.schemaVersion,
    total: matched.length,
    devices: limited,
    facets: {
      manufacturers: countBy(catalog.devices, (d) => d.manufacturer),
      platforms: countBy(catalog.devices, (d) => d.platform),
      osNames: countBy(catalog.devices, (d) => d.osName),
      eras: countBy(catalog.devices, era),
      widthRange: { min: Math.min(...widths), max: Math.max(...widths) },
      dprRange: { min: Math.min(...dprs), max: Math.max(...dprs) },
    },
  };
}

/**
 * Pick a sensible default target so the designer sees a preview immediately
 * after upload (spec section 22) without configuring anything.
 *
 * Preference order: the narrowest device that is at least as wide as the
 * source, so nothing has to be scaled down; otherwise the widest available.
 */
export function pickDefaultDevice(catalog: DeviceCatalog, sourceWidth: number): DeviceProfile {
  const candidates = catalog.devices.filter((d) => d.platform === 'ios' && d.overallConfidence === 'high');
  const pool = candidates.length > 0 ? candidates : catalog.devices;
  const atLeast = pool
    .filter((d) => d.viewport.portrait.width >= sourceWidth)
    .sort((a, b) => a.viewport.portrait.width - b.viewport.portrait.width);
  const chosen = atLeast[0] ?? [...pool].sort((a, b) => b.viewport.portrait.width - a.viewport.portrait.width)[0];
  if (!chosen) throw new Error('Device catalog is empty');
  return chosen;
}
