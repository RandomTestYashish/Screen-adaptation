import {
  DEVICE_CATALOG_SCHEMA_VERSION,
  DeviceProfileSchema,
  aggregateConfidence,
  type AttributionMap,
  type Confidence,
  type DeviceProfile,
  type FieldAttribution,
} from '@dae/shared';
import type { RawDeviceRecord } from '../schema/raw.js';

export interface NormalizeOptions {
  catalogVersion: string;
  generatedAt: string;
}

export interface NormalizeIssue {
  deviceId: string;
  field: string;
  message: string;
}

export interface NormalizeOutcome {
  profile?: DeviceProfile;
  issues: NormalizeIssue[];
}

/** Fields whose confidence drives the profile's headline `overallConfidence`. */
const GEOMETRY_CRITICAL_PATHS = [
  'viewport.portrait.width',
  'viewport.portrait.height',
  'devicePixelRatio',
  'safeArea.portrait.top',
  'safeArea.portrait.bottom',
  'cutout',
  'navigation.height',
];

function attribution(
  source: RawDeviceRecord['sources'][keyof RawDeviceRecord['sources']],
  confidence: Confidence,
  reference: string | undefined,
  updatedAt: string,
): FieldAttribution {
  return { source, confidence, ...(reference ? { reference } : {}), updatedAt };
}

/**
 * Convert one raw provider record into the versioned `DeviceProfile` the rest
 * of the system reads. Never trusts the input: geometry is cross-checked and
 * inconsistencies are reported rather than silently corrected.
 */
export function normalizeDevice(raw: RawDeviceRecord, options: NormalizeOptions): NormalizeOutcome {
  const issues: NormalizeIssue[] = [];
  const { catalogVersion, generatedAt } = options;
  const conf = raw.confidence ?? {};
  const refs = raw.references ?? {};
  const caveats = [...(raw.caveats ?? [])];

  const group = (key: keyof RawDeviceRecord['sources']) =>
    attribution(raw.sources[key], conf[key] ?? 'high', refs[key], generatedAt);

  // --- Cross-check the logical/physical relationship -----------------------
  // physicalPx = logicalPx * devicePixelRatio is the only sanctioned model
  // (spec section 5). A mismatch means one of the sources is wrong, so we
  // report it instead of quietly rescaling.
  const expectedPhysicalWidth = raw.logicalWidth * raw.devicePixelRatio;
  const expectedPhysicalHeight = raw.logicalHeight * raw.devicePixelRatio;
  const widthDelta = Math.abs(expectedPhysicalWidth - raw.physicalWidth);
  const heightDelta = Math.abs(expectedPhysicalHeight - raw.physicalHeight);
  // Allow rounding slack: the OS rounds the logical viewport to whole pixels.
  const tolerance = Math.max(2, raw.devicePixelRatio);
  if (widthDelta > tolerance) {
    issues.push({
      deviceId: raw.id,
      field: 'physicalResolution.width',
      message: `logicalWidth ${raw.logicalWidth} x DPR ${raw.devicePixelRatio} = ${expectedPhysicalWidth.toFixed(1)}, but physicalWidth is ${raw.physicalWidth} (delta ${widthDelta.toFixed(1)}px)`,
    });
  }
  if (heightDelta > tolerance * 2) {
    issues.push({
      deviceId: raw.id,
      field: 'physicalResolution.height',
      message: `logicalHeight ${raw.logicalHeight} x DPR ${raw.devicePixelRatio} = ${expectedPhysicalHeight.toFixed(1)}, but physicalHeight is ${raw.physicalHeight} (delta ${heightDelta.toFixed(1)}px)`,
    });
  }

  if (raw.safeTop + raw.safeBottom >= raw.logicalHeight) {
    issues.push({
      deviceId: raw.id,
      field: 'safeArea',
      message: 'Safe-area insets consume the entire viewport height',
    });
  }

  // --- Derive a cutout-aware top inset ------------------------------------
  // A display cutout that extends below the reported status bar would still
  // occlude content placed at the top of the "safe" area. Android reports this
  // as `DisplayCutout.safeInsetTop`; vendor status-bar figures often predate
  // the cutout. The normalizer reconciles the two and records that it did so,
  // rather than shipping a value the renderer would contradict.
  const cutoutBottom = raw.cutoutKind === 'none' ? 0 : raw.cutoutTop + raw.cutoutHeight;
  const safeTop = Math.max(raw.safeTop, cutoutBottom);
  const statusBarHeight = Math.max(raw.statusBarHeight, cutoutBottom);
  const safeTopDerived = safeTop !== raw.safeTop || statusBarHeight !== raw.statusBarHeight;
  if (safeTopDerived) {
    caveats.push(
      `Top safe-area inset raised from ${raw.safeTop}px to ${safeTop}px so it clears the ${raw.cutoutKind} cutout (bottom edge at ${cutoutBottom}px).`,
    );
  }

  const attributions: AttributionMap = {
    'manufacturer': group('identity'),
    'model': group('identity'),
    'osVersionRange': group('identity'),
    'viewport.portrait.width': group('viewport'),
    'viewport.portrait.height': group('viewport'),
    'viewport.landscape': group('viewport'),
    'physicalResolution': group('physical'),
    'devicePixelRatio': group('physical'),
    'ppi': group('physical'),
    'densityBucket': group('physical'),
    'safeArea.portrait.top': safeTopDerived
      ? {
          source: 'derived',
          confidence: 'medium',
          note: `Derived as max(reported status bar ${raw.statusBarHeight}px, cutout bottom edge ${cutoutBottom}px).`,
          updatedAt: generatedAt,
        }
      : group('safeArea'),
    'safeArea.portrait.bottom': group('safeArea'),
    'safeArea.landscape': group('safeArea'),
    'statusBar': group('safeArea'),
    'cutout': group('cutout'),
    'navigation.mode': group('navigation'),
    'navigation.height': group('navigation'),
    'screenCornerRadius': group('cornerRadius'),
    'shellBezel': { ...group('cornerRadius'), note: 'Cosmetic device shell only; not used by adaptation geometry.' },
    'keyboard': group('keyboard'),
    'conventions': group('conventions'),
    'browser': { ...group('viewport'), note: 'devicePixelRatio mirrored from the physical specification.' },
  };

  const aspectRatio = raw.logicalHeight / raw.logicalWidth;

  // The cosmetic shell bezel scales with the device: a fixed value looks wrong
  // on both a 4.7" SE and a 6.9" Pro Max.
  const bezel = Math.max(8, Math.round(raw.logicalWidth * 0.028));

  const candidate = {
    id: raw.id,
    manufacturer: raw.manufacturer,
    family: raw.family,
    model: raw.model,
    marketingName: raw.marketingName,
    platform: raw.platform,
    osName: raw.osName,
    osVersionRange: { min: raw.osMin, ...(raw.osMax ? { max: raw.osMax } : {}) },
    releaseYear: raw.releaseYear,
    generation: raw.generation,
    ...(raw.screenSizeInches ? { screenSizeInches: raw.screenSizeInches } : {}),

    viewport: {
      portrait: { width: raw.logicalWidth, height: raw.logicalHeight },
      ...(raw.landscape ? { landscape: { width: raw.landscape.width, height: raw.landscape.height } } : {}),
    },
    physicalResolution: { width: raw.physicalWidth, height: raw.physicalHeight },
    devicePixelRatio: raw.devicePixelRatio,
    densityBucket: raw.densityBucket ?? null,
    ...(raw.ppi ? { ppi: raw.ppi } : {}),
    aspectRatio: Number(aspectRatio.toFixed(4)),

    safeArea: {
      portrait: {
        top: safeTop,
        right: raw.safeRight ?? 0,
        bottom: raw.safeBottom,
        left: raw.safeLeft ?? 0,
      },
      ...(raw.landscape
        ? {
            landscape: {
              top: raw.landscape.safeTop,
              right: raw.landscape.safeRight,
              bottom: raw.landscape.safeBottom,
              left: raw.landscape.safeLeft,
            },
          }
        : {}),
    },
    statusBar: {
      height: statusBarHeight,
      overlaysContent: raw.statusBarOverlaysContent ?? true,
      style: 'adaptive' as const,
    },
    cutout: {
      kind: raw.cutoutKind,
      width: raw.cutoutWidth,
      height: raw.cutoutHeight,
      top: raw.cutoutTop,
      cornerRadius: raw.cutoutRadius ?? 0,
    },
    navigation: { mode: raw.navMode, height: raw.navHeight, indicatorWidth: raw.indicatorWidth },
    screenCornerRadius: raw.screenCornerRadius,
    shellBezel: { top: bezel, right: bezel, bottom: bezel, left: bezel },
    shellCornerRadius: raw.screenCornerRadius + bezel,

    orientations: raw.landscape ? (['portrait', 'landscape'] as const) : (['portrait'] as const),
    keyboard: {
      supported: raw.keyboardSupported ?? true,
      height: raw.keyboardHeight,
      accessoryHeight: raw.keyboardAccessoryHeight ?? 0,
    },
    browser: {
      // Mobile browser chrome is highly variable; we model the common
      // "collapsed toolbar" case and say so rather than pretending precision.
      defaultBrowserChromeTop: raw.platform === 'ios' ? 0 : 0,
      defaultBrowserChromeBottom: raw.platform === 'ios' ? 49 : 0,
      resizesViewportOnKeyboard: raw.platform === 'android',
      reportedDevicePixelRatio: raw.devicePixelRatio,
    },
    conventions: {
      minTouchTarget: raw.minTouchTarget,
      defaultScreenMargin: raw.defaultScreenMargin,
      bottomTabBarHeight: raw.bottomTabBarHeight,
      systemFont: raw.systemFont,
    },

    attribution: attributions,
    overallConfidence: aggregateConfidence(attributions, GEOMETRY_CRITICAL_PATHS),
    catalogVersion,
    lastUpdated: generatedAt,
    caveats,
  };

  const parsed = DeviceProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ deviceId: raw.id, field: issue.path.join('.'), message: issue.message });
    }
    return { issues };
  }
  return { profile: parsed.data, issues };
}

export const SCHEMA_VERSION = DEVICE_CATALOG_SCHEMA_VERSION;
