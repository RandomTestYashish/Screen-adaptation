import type { DeviceCatalog, DeviceProfile } from '@dae/shared';

/**
 * A stable identity for a device's *data*, ignoring fields that change on every
 * build (catalog version and the generation timestamps stamped onto the profile
 * and onto every attribution entry).
 *
 * Without this, an ingestion run that changed nothing would still look like a
 * change and would bump the catalog version - invalidating every cached
 * adaptation plan for no reason (spec section 24).
 */
export function deviceFingerprint(device: DeviceProfile): string {
  const attribution = Object.fromEntries(
    Object.entries(device.attribution)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, entry]) => {
        const { updatedAt: _ignored, ...rest } = entry;
        return [path, rest];
      }),
  );
  const { catalogVersion: _v, lastUpdated: _u, ...rest } = device;
  return JSON.stringify({ ...rest, attribution });
}

export function catalogFingerprint(catalog: DeviceCatalog): string {
  return JSON.stringify([...catalog.devices].sort((a, b) => a.id.localeCompare(b.id)).map(deviceFingerprint));
}

/** Devices whose data differs between two catalogs, ignoring build stamps. */
export function changedDevices(previous: DeviceCatalog, next: DeviceCatalog): { added: string[]; updated: string[] } {
  const before = new Map(previous.devices.map((d) => [d.id, deviceFingerprint(d)]));
  const added: string[] = [];
  const updated: string[] = [];
  for (const device of next.devices) {
    const prior = before.get(device.id);
    if (prior === undefined) added.push(device.id);
    else if (prior !== deviceFingerprint(device)) updated.push(device.id);
  }
  return { added, updated };
}
