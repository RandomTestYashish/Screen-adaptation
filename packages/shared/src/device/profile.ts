import { z } from 'zod';
import { EdgeInsetsSchema, LogicalPx } from '../design-ir/primitives.js';
import { AttributionMapSchema, ConfidenceSchema } from './attribution.js';

export const PlatformSchema = z.enum(['ios', 'android']);
export type Platform = z.infer<typeof PlatformSchema>;

export const OrientationSchema = z.enum(['portrait', 'landscape']);
export type Orientation = z.infer<typeof OrientationSchema>;

/** Shape of the front-camera intrusion in the display area. */
export const CutoutKindSchema = z.enum([
  'none',
  'notch', // iPhone X..14 style wide notch
  'dynamic-island', // iPhone 14 Pro and later pill
  'punch-hole-center',
  'punch-hole-left',
  'pill-center',
  'teardrop',
]);
export type CutoutKind = z.infer<typeof CutoutKindSchema>;

export const CutoutSchema = z.object({
  kind: CutoutKindSchema,
  /** Bounds in logical px relative to the top-left of the *logical viewport*. */
  width: LogicalPx.nonnegative(),
  height: LogicalPx.nonnegative(),
  /** Distance from the top of the viewport to the top of the cutout. */
  top: LogicalPx.nonnegative(),
  /** Corner radius of the cutout shape itself. */
  cornerRadius: LogicalPx.nonnegative().default(0),
});
export type Cutout = z.infer<typeof CutoutSchema>;

export const ViewportSchema = z.object({
  width: LogicalPx.positive(),
  height: LogicalPx.positive(),
});

export const NavigationModeSchema = z.enum([
  'ios-home-indicator',
  'ios-home-button',
  'android-gesture',
  'android-three-button',
  'android-two-button',
]);
export type NavigationMode = z.infer<typeof NavigationModeSchema>;

export const StatusBarSchema = z.object({
  /** Logical height of the status bar in portrait. */
  height: LogicalPx.nonnegative(),
  /** Whether the design area extends beneath it (true on all modern phones). */
  overlaysContent: z.boolean().default(true),
  style: z.enum(['light-content', 'dark-content', 'adaptive']).default('adaptive'),
});

export const KeyboardSchema = z.object({
  supported: z.boolean(),
  /** Default keyboard height in logical px, excluding any accessory bar. */
  height: LogicalPx.nonnegative(),
  /** Height of the iOS predictive/accessory bar or Android suggestion strip. */
  accessoryHeight: LogicalPx.nonnegative().default(0),
});

export const BrowserBehaviourSchema = z.object({
  /** Height of the browser chrome subtracted from the app viewport, when known. */
  defaultBrowserChromeTop: LogicalPx.nonnegative().default(0),
  defaultBrowserChromeBottom: LogicalPx.nonnegative().default(0),
  /** Whether the OS shrinks the visual viewport when the keyboard opens. */
  resizesViewportOnKeyboard: z.boolean().default(true),
  /** `window.devicePixelRatio` as reported by the mobile browser. */
  reportedDevicePixelRatio: z.number().positive(),
});

/**
 * A fully normalized device description. Every consumer (UI, adaptation,
 * validation, renderer) reads this schema and never raw vendor data
 * (spec section 6).
 *
 * Units: `viewport`, `safeArea`, `cutout`, `statusBar`, `navigation` and
 * `cornerRadius` are all **logical (CSS) pixels**. `physicalResolution` and
 * `ppi` are the only physical-pixel fields. `devicePixelRatio` is the
 * documented conversion factor between the two:
 *     physicalPx = logicalPx * devicePixelRatio
 */
export const DeviceProfileSchema = z.object({
  id: z.string(),
  manufacturer: z.string(),
  family: z.string(),
  model: z.string(),
  marketingName: z.string(),
  platform: PlatformSchema,
  osName: z.string(),
  osVersionRange: z.object({ min: z.string(), max: z.string().optional() }),
  releaseYear: z.number().int(),
  generation: z.string(),
  screenSizeInches: z.number().positive().optional(),

  viewport: z.object({ portrait: ViewportSchema, landscape: ViewportSchema.optional() }),
  physicalResolution: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  devicePixelRatio: z.number().positive(),
  /** Android density bucket (mdpi/hdpi/...) or `null` for iOS. */
  densityBucket: z.string().nullable().default(null),
  ppi: z.number().positive().optional(),
  aspectRatio: z.number().positive(),

  safeArea: z.object({ portrait: EdgeInsetsSchema, landscape: EdgeInsetsSchema.optional() }),
  statusBar: StatusBarSchema,
  cutout: CutoutSchema,
  navigation: z.object({
    mode: NavigationModeSchema,
    /** Height of the gesture bar / nav bar area in logical px. */
    height: LogicalPx.nonnegative(),
    /** Width of the iOS home indicator pill or Android gesture pill. */
    indicatorWidth: LogicalPx.nonnegative().default(0),
  }),
  /** Physical rounding of the display glass, logical px. */
  screenCornerRadius: LogicalPx.nonnegative(),
  /** Bezel thickness used purely by the cosmetic device shell layer. */
  shellBezel: EdgeInsetsSchema,
  shellCornerRadius: LogicalPx.nonnegative(),

  orientations: z.array(OrientationSchema).min(1),
  keyboard: KeyboardSchema,
  browser: BrowserBehaviourSchema,

  /** Platform UI conventions the adaptation engine consults. */
  conventions: z.object({
    /** Recommended minimum touch target, logical px (44pt iOS / 48dp Android). */
    minTouchTarget: LogicalPx.positive(),
    /** Conventional horizontal screen margin. Informational only - never applied silently. */
    defaultScreenMargin: LogicalPx.nonnegative(),
    /** Typical height of the platform's bottom tab bar, excluding the inset. */
    bottomTabBarHeight: LogicalPx.nonnegative(),
    systemFont: z.string(),
  }),

  attribution: AttributionMapSchema,
  /** Worst-case confidence across geometry-critical fields, precomputed by the normalizer. */
  overallConfidence: ConfidenceSchema,
  catalogVersion: z.string(),
  lastUpdated: z.string().datetime(),
  /** Free-form caveats shown in the device drawer and validation panel. */
  caveats: z.array(z.string()).default([]),
});
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

export const DeviceCatalogSchema = z.object({
  schemaVersion: z.string(),
  catalogVersion: z.string(),
  generatedAt: z.string().datetime(),
  sources: z.array(z.object({ id: z.string(), name: z.string(), url: z.string().optional(), license: z.string().optional() })),
  devices: z.array(DeviceProfileSchema),
});
export type DeviceCatalog = z.infer<typeof DeviceCatalogSchema>;

/** Logical -> physical pixel conversion. The only sanctioned conversion path. */
export function logicalToPhysical(logicalPx: number, profile: DeviceProfile): number {
  return logicalPx * profile.devicePixelRatio;
}

export function physicalToLogical(physicalPx: number, profile: DeviceProfile): number {
  return physicalPx / profile.devicePixelRatio;
}

export function viewportFor(profile: DeviceProfile, orientation: Orientation) {
  if (orientation === 'landscape') {
    return (
      profile.viewport.landscape ?? {
        width: profile.viewport.portrait.height,
        height: profile.viewport.portrait.width,
      }
    );
  }
  return profile.viewport.portrait;
}

export function safeAreaFor(profile: DeviceProfile, orientation: Orientation) {
  if (orientation === 'landscape') {
    return (
      profile.safeArea.landscape ?? {
        top: 0,
        bottom: profile.navigation.mode === 'ios-home-indicator' ? 21 : profile.safeArea.portrait.bottom,
        left: profile.safeArea.portrait.top,
        right: profile.safeArea.portrait.top,
      }
    );
  }
  return profile.safeArea.portrait;
}
