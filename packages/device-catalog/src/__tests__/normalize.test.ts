import { describe, expect, it } from 'vitest';
import { buildCatalog, mergeSupplement } from '../normalizer/build.js';
import { normalizeDevice } from '../normalizer/normalize.js';
import { appleProvider, androidProvider, browserEmulationProvider } from '../providers/index.js';
import { loadCatalog } from '../load.js';
import { era, pickDefaultDevice, queryDevices, sizeCategory } from '../query.js';
import type { RawDeviceRecord } from '../schema/raw.js';

const OPTIONS = { catalogVersion: 'test.1', generatedAt: '2026-01-01T00:00:00.000Z' };

function rawFixture(overrides: Partial<RawDeviceRecord> = {}): RawDeviceRecord {
  return {
    id: 'test-device',
    manufacturer: 'Test',
    family: 'Test',
    model: 'Test 1',
    marketingName: 'Test 1',
    platform: 'ios',
    osName: 'iOS',
    osMin: '17.0',
    releaseYear: 2024,
    generation: '1',
    logicalWidth: 390,
    logicalHeight: 844,
    physicalWidth: 1170,
    physicalHeight: 2532,
    devicePixelRatio: 3,
    safeTop: 47,
    safeBottom: 34,
    statusBarHeight: 47,
    cutoutKind: 'notch',
    cutoutWidth: 209,
    cutoutHeight: 30,
    cutoutTop: 0,
    navMode: 'ios-home-indicator',
    navHeight: 34,
    indicatorWidth: 139,
    screenCornerRadius: 47,
    keyboardHeight: 291,
    minTouchTarget: 44,
    defaultScreenMargin: 16,
    bottomTabBarHeight: 49,
    systemFont: 'SF Pro Text',
    sources: {
      identity: 'apple-tech-specs',
      viewport: 'apple-tech-specs',
      physical: 'apple-tech-specs',
      safeArea: 'apple-hig',
      cutout: 'apple-hig',
      navigation: 'apple-hig',
      cornerRadius: 'community-dataset',
      keyboard: 'apple-hig',
      conventions: 'apple-hig',
    },
    ...overrides,
  };
}

describe('device normalization', () => {
  it('produces a schema-valid profile with per-field attribution', () => {
    const { profile, issues } = normalizeDevice(rawFixture(), OPTIONS);
    expect(issues).toHaveLength(0);
    expect(profile).toBeDefined();
    expect(profile!.attribution['viewport.portrait.width']!.source).toBe('apple-tech-specs');
    expect(profile!.attribution['screenCornerRadius']!.source).toBe('community-dataset');
    expect(profile!.catalogVersion).toBe('test.1');
  });

  it('reports a logical x DPR mismatch against the physical resolution', () => {
    const { issues } = normalizeDevice(rawFixture({ physicalWidth: 1080 }), OPTIONS);
    expect(issues.some((i) => i.field === 'physicalResolution.width')).toBe(true);
  });

  it('tolerates the rounding the OS applies to the logical viewport', () => {
    // 393 x 2.75 = 1080.75, which the panel reports as 1080.
    const { issues } = normalizeDevice(
      rawFixture({ logicalWidth: 393, logicalHeight: 851, physicalWidth: 1080, physicalHeight: 2340, devicePixelRatio: 2.75 }),
      OPTIONS,
    );
    expect(issues.filter((i) => i.field.startsWith('physicalResolution'))).toHaveLength(0);
  });

  it('raises the top inset to clear a cutout that extends below the status bar', () => {
    const { profile } = normalizeDevice(
      rawFixture({ platform: 'android', safeTop: 24, statusBarHeight: 24, cutoutKind: 'punch-hole-center', cutoutWidth: 26, cutoutHeight: 26, cutoutTop: 10 }),
      OPTIONS,
    );
    expect(profile!.safeArea.portrait.top).toBe(36);
    expect(profile!.statusBar.height).toBe(36);
    expect(profile!.attribution['safeArea.portrait.top']!.source).toBe('derived');
    expect(profile!.caveats.some((c) => c.includes('raised from 24px to 36px'))).toBe(true);
  });

  it('carries the worst geometry-critical confidence as the headline confidence', () => {
    const { profile } = normalizeDevice(rawFixture({ confidence: { safeArea: 'low' } }), OPTIONS);
    expect(profile!.overallConfidence).toBe('low');
  });

  it('rejects a device whose safe area consumes the viewport', () => {
    const { issues } = normalizeDevice(rawFixture({ safeTop: 500, safeBottom: 400 }), OPTIONS);
    expect(issues.some((i) => i.field === 'safeArea')).toBe(true);
  });
});

describe('supplemental data merging', () => {
  it('accepts a supplement that agrees with the authoritative source', () => {
    const merged = mergeSupplement(rawFixture(), {
      id: 'test-device',
      logicalWidth: 390,
      devicePixelRatio: 3,
      caveats: ['cross-checked'],
    });
    expect(merged.logicalWidth).toBe(390);
    expect(merged.caveats).toContain('cross-checked');
  });

  it('never lets a disagreeing supplement overwrite authoritative geometry', () => {
    const merged = mergeSupplement(rawFixture(), { id: 'test-device', logicalWidth: 414, devicePixelRatio: 2 });
    expect(merged.logicalWidth).toBe(390);
    expect(merged.devicePixelRatio).toBe(3);
    expect(merged.caveats!.join(' ')).toContain('was rejected');
  });
});

describe('catalog build', () => {
  it('builds every provider device without rejections', async () => {
    const { catalog, rejected } = await buildCatalog([appleProvider, androidProvider], { catalogVersion: 'test.1' });
    expect(rejected).toHaveLength(0);
    expect(catalog.devices.length).toBeGreaterThan(25);
    expect(catalog.sources.map((s) => s.id)).toContain('browser-emulation');
  });

  it('normalizes cleanly: the committed catalog has no outstanding warnings', async () => {
    const { issues } = await buildCatalog([appleProvider, androidProvider], { catalogVersion: 'test.1' });
    expect(issues).toEqual([]);
  });

  it('stamps devices confirmed by emulation metadata with an honest caveat', async () => {
    const { catalog } = await buildCatalog([appleProvider, androidProvider], { catalogVersion: 'test.1' });
    const confirmed = catalog.devices.find((d) => d.id === 'apple-iphone-14-pro')!;
    expect(confirmed.caveats.some((c) => c.includes('not a guarantee of physical-device rendering'))).toBe(true);
  });

  it('keeps the higher-precedence record when providers overlap', async () => {
    const shadow = {
      ...androidProvider,
      id: 'shadow',
      precedence: 1,
      fetch: () => [rawFixture({ id: 'apple-iphone-14-pro', logicalWidth: 1 })],
    };
    const { catalog, rejected } = await buildCatalog([appleProvider, shadow], { catalogVersion: 'test.1' });
    expect(catalog.devices.find((d) => d.id === 'apple-iphone-14-pro')!.viewport.portrait.width).toBe(393);
    expect(rejected.some((r) => r.reason.includes('lower-precedence'))).toBe(true);
  });
});

describe('committed catalog', () => {
  const catalog = loadCatalog();

  it('covers the logical widths the spec requires testing', () => {
    const widths = new Set(catalog.devices.map((d) => d.viewport.portrait.width));
    for (const width of [360, 375, 390, 393, 402, 412, 430]) {
      expect(widths.has(width), `no device with a ${width}px logical viewport`).toBe(true);
    }
  });

  it('includes both platforms and both Android navigation modes', () => {
    expect(catalog.devices.some((d) => d.platform === 'ios')).toBe(true);
    expect(catalog.devices.some((d) => d.navigation.mode === 'android-gesture')).toBe(true);
    expect(catalog.devices.some((d) => d.navigation.mode === 'android-three-button')).toBe(true);
  });

  it('never presents unpublished values as high confidence', () => {
    for (const device of catalog.devices) {
      const radius = device.attribution['screenCornerRadius'];
      expect(radius!.confidence).not.toBe('high');
    }
  });
});

describe('catalog queries', () => {
  const catalog = loadCatalog();

  it('filters by platform, width and DPR', () => {
    const results = queryDevices(catalog, { platform: 'android', minWidth: 400, maxDpr: 3 });
    expect(results.length).toBeGreaterThan(0);
    for (const device of results) {
      expect(device.platform).toBe('android');
      expect(device.viewport.portrait.width).toBeGreaterThanOrEqual(400);
      expect(device.devicePixelRatio).toBeLessThanOrEqual(3);
    }
  });

  it('searches across name, manufacturer and model', () => {
    expect(queryDevices(catalog, { search: 'pixel 8 pro' }).map((d) => d.id)).toContain('google-pixel-8-pro');
    expect(queryDevices(catalog, { search: 'samsung ultra' }).map((d) => d.id)).toContain('samsung-galaxy-s24-ultra');
  });

  it('buckets devices by size class and era', () => {
    expect(sizeCategory(catalog.devices.find((d) => d.id === 'apple-iphone-se-3')!)).toBe('compact');
    expect(sizeCategory(catalog.devices.find((d) => d.id === 'apple-iphone-16-pro-max')!)).toBe('large');
    expect(era(catalog.devices.find((d) => d.id === 'apple-iphone-16-pro')!)).toBe('2024+');
  });

  it('defaults to the narrowest device that does not force scaling down', () => {
    // A 375-wide source should open on a 375-wide device, not a 430-wide one.
    expect(pickDefaultDevice(catalog, 375).viewport.portrait.width).toBe(375);
    expect(pickDefaultDevice(catalog, 400).viewport.portrait.width).toBeGreaterThanOrEqual(400);
  });
});

describe('browser emulation provider', () => {
  it('contributes no devices of its own', async () => {
    expect(await browserEmulationProvider.fetch()).toEqual([]);
  });

  it('only supplies viewport and DPR fields', () => {
    for (const entry of browserEmulationProvider.fetchPartial()) {
      expect(Object.keys(entry).sort()).toEqual(
        ['caveats', 'devicePixelRatio', 'id', 'logicalHeight', 'logicalWidth', 'sources'].sort(),
      );
    }
  });
});
