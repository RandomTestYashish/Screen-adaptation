import type { Confidence, DeviceDataSource, NavigationMode, CutoutKind, Platform } from '@dae/shared';

/**
 * The shape every DeviceDataProvider emits. This is *raw* vendor/community
 * data: it is never read by the UI. The normalizer converts it into the
 * versioned `DeviceProfile` schema, attaching per-field source + confidence
 * (spec section 6).
 */
export interface RawDeviceRecord {
  id: string;
  manufacturer: string;
  family: string;
  model: string;
  marketingName: string;
  platform: Platform;
  osName: string;
  osMin: string;
  osMax?: string;
  releaseYear: number;
  generation: string;
  screenSizeInches?: number;

  /** Logical (CSS) px, portrait. */
  logicalWidth: number;
  logicalHeight: number;
  /** Physical pixels of the panel. */
  physicalWidth: number;
  physicalHeight: number;
  devicePixelRatio: number;
  ppi?: number;
  densityBucket?: string;

  /** Logical px. */
  safeTop: number;
  safeBottom: number;
  safeLeft?: number;
  safeRight?: number;
  statusBarHeight: number;
  statusBarOverlaysContent?: boolean;

  cutoutKind: CutoutKind;
  cutoutWidth: number;
  cutoutHeight: number;
  cutoutTop: number;
  cutoutRadius?: number;

  navMode: NavigationMode;
  navHeight: number;
  indicatorWidth: number;

  screenCornerRadius: number;

  keyboardSupported?: boolean;
  keyboardHeight: number;
  keyboardAccessoryHeight?: number;

  landscape?: {
    width: number;
    height: number;
    safeTop: number;
    safeBottom: number;
    safeLeft: number;
    safeRight: number;
  };

  minTouchTarget: number;
  defaultScreenMargin: number;
  bottomTabBarHeight: number;
  systemFont: string;

  /** Source attribution per logical field group. */
  sources: {
    identity: DeviceDataSource;
    viewport: DeviceDataSource;
    physical: DeviceDataSource;
    safeArea: DeviceDataSource;
    cutout: DeviceDataSource;
    navigation: DeviceDataSource;
    cornerRadius: DeviceDataSource;
    keyboard: DeviceDataSource;
    conventions: DeviceDataSource;
  };
  /** Confidence per logical field group. Missing entries default to `high`. */
  confidence?: Partial<Record<keyof RawDeviceRecord['sources'], Confidence>>;
  references?: Partial<Record<keyof RawDeviceRecord['sources'], string>>;
  caveats?: string[];
}

export interface DeviceDataProvider {
  readonly id: string;
  readonly name: string;
  readonly url?: string;
  readonly license?: string;
  /**
   * Higher precedence wins when two providers describe the same field of the
   * same device. Authoritative vendor documentation outranks community data.
   */
  readonly precedence: number;
  fetch(): Promise<RawDeviceRecord[]> | RawDeviceRecord[];
}
