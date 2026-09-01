import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { buildCatalog, buildResponse, defaultProviders, loadCatalog, pickDefaultDevice, setCatalog } from '@dae/device-catalog';
import type { DeviceCatalog, DeviceListResponseT, DeviceProfile, DeviceQueryT } from '@dae/shared';

/**
 * Serves the normalized catalog. Devices are data, not code: a new phone
 * arrives through a provider record plus `pnpm catalog:sync`, or through
 * POST /device-catalog/sync at runtime (spec section 32).
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);
  private catalog: DeviceCatalog = loadCatalog();

  getCatalog(): DeviceCatalog {
    return this.catalog;
  }

  query(query: Partial<DeviceQueryT>): DeviceListResponseT {
    return buildResponse(this.catalog, query);
  }

  get(id: string): DeviceProfile {
    const device = this.catalog.devices.find((d) => d.id === id);
    if (!device) throw new NotFoundException(`Unknown device "${id}"`);
    return device;
  }

  /** Default target chosen automatically after upload, so no configuration is needed. */
  defaultFor(sourceWidth: number): DeviceProfile {
    return pickDefaultDevice(this.catalog, sourceWidth);
  }

  async sync(options: { dryRun: boolean }) {
    const previous = new Set(this.catalog.devices.map((d) => d.id));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const revision = this.catalog.catalogVersion.startsWith(stamp)
      ? Number(this.catalog.catalogVersion.split('.').pop() ?? '0') + 1
      : 1;

    const { catalog, rejected } = await buildCatalog(defaultProviders, {
      catalogVersion: `${stamp}.${revision}`,
    });

    const added = catalog.devices.map((d) => d.id).filter((id) => !previous.has(id));
    const updated = catalog.devices
      .filter((d) => previous.has(d.id))
      .filter((d) => {
        const before = this.catalog.devices.find((p) => p.id === d.id);
        return before && JSON.stringify({ ...before, catalogVersion: '', lastUpdated: '' }) !== JSON.stringify({ ...d, catalogVersion: '', lastUpdated: '' });
      })
      .map((d) => d.id);

    if (!options.dryRun) {
      this.catalog = catalog;
      setCatalog(catalog);
      this.logger.log(`Device catalog synced to ${catalog.catalogVersion} (${catalog.devices.length} devices)`);
    }

    return {
      catalogVersion: catalog.catalogVersion,
      added,
      updated,
      unchanged: catalog.devices.length - added.length - updated.length,
      rejected,
      dryRun: options.dryRun,
    };
  }
}
