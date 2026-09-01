import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  buildCatalog,
  buildResponse,
  catalogFingerprint,
  changedDevices,
  defaultProviders,
  loadCatalog,
  pickDefaultDevice,
  setCatalog,
} from '@dae/device-catalog';
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
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const revision = this.catalog.catalogVersion.startsWith(stamp)
      ? Number(this.catalog.catalogVersion.split('.').pop() ?? '0') + 1
      : 1;

    const { catalog, rejected } = await buildCatalog(defaultProviders, {
      catalogVersion: `${stamp}.${revision}`,
    });

    const { added, updated } = changedDevices(this.catalog, catalog);
    // Build stamps change on every run; only a real data change should bump the
    // catalog version, because that version is part of every adaptation cache
    // key (spec section 24).
    const changed = catalogFingerprint(this.catalog) !== catalogFingerprint(catalog);

    if (changed && !options.dryRun) {
      this.catalog = catalog;
      setCatalog(catalog);
      this.logger.log(`Device catalog synced to ${catalog.catalogVersion} (${catalog.devices.length} devices)`);
    } else if (!changed) {
      this.logger.log(`Device catalog unchanged; kept version ${this.catalog.catalogVersion}`);
    }

    return {
      catalogVersion: this.catalog.catalogVersion,
      added,
      updated,
      unchanged: catalog.devices.length - added.length - updated.length,
      rejected,
      dryRun: options.dryRun,
    };
  }
}
