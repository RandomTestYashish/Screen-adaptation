import type { DeviceDataProvider, RawDeviceRecord } from '../schema/raw.js';

/**
 * Supplemental viewport/DPR metadata of the kind browser devtools expose for
 * device emulation.
 *
 * Spec section 6: this "may supplement viewport and DPR information, but it
 * must not be presented as a guarantee of physical-device rendering". It
 * therefore has the lowest precedence, contributes only viewport/DPR fields,
 * and stamps every device it touches with an explicit caveat.
 */

interface EmulationEntry {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
}

const ENTRIES: EmulationEntry[] = [
  { id: 'apple-iphone-14-pro', label: 'iPhone 14 Pro', width: 393, height: 852, dpr: 3 },
  { id: 'apple-iphone-se-3', label: 'iPhone SE', width: 375, height: 667, dpr: 2 },
  { id: 'samsung-galaxy-s24', label: 'Galaxy S24', width: 360, height: 772, dpr: 3 },
  { id: 'google-pixel-7', label: 'Pixel 7', width: 412, height: 915, dpr: 2.625 },
];

export const BROWSER_EMULATION_CAVEAT =
  'Viewport and DPR were cross-checked against browser device-emulation metadata. Browser emulation reproduces layout viewport and pixel ratio only - it is not a guarantee of physical-device rendering.';

/**
 * Partial records: the merger only takes the fields this provider is allowed to
 * contribute. Everything else is left for the authoritative providers.
 */
export type PartialRawRecord = Pick<RawDeviceRecord, 'id'> & Partial<RawDeviceRecord>;

export const browserEmulationProvider: DeviceDataProvider & { fetchPartial(): PartialRawRecord[] } = {
  id: 'browser-emulation',
  name: 'Browser device-emulation metadata',
  license: 'Metadata only.',
  precedence: 10,
  fetch: () => [],
  fetchPartial: () =>
    ENTRIES.map((entry) => ({
      id: entry.id,
      logicalWidth: entry.width,
      logicalHeight: entry.height,
      devicePixelRatio: entry.dpr,
      caveats: [BROWSER_EMULATION_CAVEAT],
      sources: {
        identity: 'browser-emulation',
        viewport: 'browser-emulation',
        physical: 'browser-emulation',
        safeArea: 'browser-emulation',
        cutout: 'browser-emulation',
        navigation: 'browser-emulation',
        cornerRadius: 'browser-emulation',
        keyboard: 'browser-emulation',
        conventions: 'browser-emulation',
      },
    })),
};
