import type { CSSProperties } from 'react';
import { safeAreaFor, viewportFor, type DeviceProfile, type Orientation } from '@dae/shared';
import type { ChromeToggles } from '../../state/workspace.js';
import styles from './PlatformChrome.module.css';

interface Props {
  device: DeviceProfile;
  orientation: Orientation;
  chrome: ChromeToggles;
  /** Rendered clock, kept stable so screenshots are reproducible. */
  time?: string;
}

/**
 * Layer B - platform chrome.
 *
 * Drawn entirely above the design layer and never composited into it, so
 * toggling any part of it cannot change a single pixel of the user's artwork
 * (spec section 2).
 */
export function PlatformChrome({ device, orientation, chrome, time = '9:41' }: Props) {
  const viewport = viewportFor(device, orientation);
  const safeArea = safeAreaFor(device, orientation);
  const dark = chrome.darkChrome;
  const tint = dark ? '#ffffff' : '#000000';

  return (
    <div className={styles.layer} aria-hidden="true">
      {chrome.statusBar && (
        <div
          className={styles.statusBar}
          style={{ height: device.statusBar.height, color: tint }}
          data-testid="status-bar"
        >
          {device.platform === 'ios' ? (
            <IosStatusBar time={time} cutout={device.cutout.kind} width={viewport.width} tint={tint} />
          ) : (
            <AndroidStatusBar time={time} tint={tint} />
          )}
        </div>
      )}

      {chrome.cutout && device.cutout.kind !== 'none' && (
        <Cutout device={device} viewportWidth={viewport.width} />
      )}

      {chrome.homeIndicator && device.navigation.mode === 'ios-home-indicator' && (
        <div className={styles.homeIndicatorArea} style={{ height: safeArea.bottom }}>
          <div
            className={styles.homeIndicator}
            style={{ width: device.navigation.indicatorWidth, background: dark ? '#ffffff' : '#000000' }}
            data-testid="home-indicator"
          />
        </div>
      )}

      {chrome.androidNavigation && device.navigation.mode.startsWith('android') && (
        <AndroidNavigation device={device} tint={tint} dark={dark} />
      )}

      {chrome.keyboard && device.keyboard.supported && (
        <div
          className={styles.keyboard}
          style={{ height: device.keyboard.height + device.keyboard.accessoryHeight }}
          data-testid="keyboard"
        >
          <span className={styles.keyboardLabel}>
            Software keyboard · {device.keyboard.height}px
            {device.keyboard.accessoryHeight > 0 ? ` + ${device.keyboard.accessoryHeight}px accessory bar` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function IosStatusBar({ time, cutout, width, tint }: { time: string; cutout: string; width: number; tint: string }) {
  // Split around the cutout on notched and Dynamic Island devices, exactly as
  // iOS lays the status bar out.
  const split = cutout !== 'none';
  return (
    <div className={styles.iosStatus} style={{ width }}>
      <span className={styles.iosTime} style={{ color: tint }}>{time}</span>
      {split && <span className={styles.spacer} />}
      <span className={styles.iosIcons} style={{ color: tint }}>
        <SignalIcon />
        <WifiIcon />
        <BatteryIcon />
      </span>
    </div>
  );
}

function AndroidStatusBar({ time, tint }: { time: string; tint: string }) {
  return (
    <div className={styles.androidStatus}>
      <span style={{ color: tint }}>{time}</span>
      <span className={styles.iosIcons} style={{ color: tint }}>
        <SignalIcon />
        <WifiIcon />
        <BatteryIcon />
      </span>
    </div>
  );
}

/** Geometry is data-driven from the profile, not hard-coded per model. */
function Cutout({ device, viewportWidth }: { device: DeviceProfile; viewportWidth: number }) {
  const { cutout } = device;
  const left =
    cutout.kind === 'punch-hole-left' ? 16 : cutout.kind === 'punch-hole-center' || cutout.kind === 'pill-center' || cutout.kind === 'teardrop' || cutout.kind === 'dynamic-island' || cutout.kind === 'notch' ? (viewportWidth - cutout.width) / 2 : 0;

  const style: CSSProperties = {
    left,
    top: cutout.top,
    width: cutout.width,
    height: cutout.height,
    borderRadius:
      cutout.kind === 'notch'
        ? `0 0 ${cutout.cornerRadius}px ${cutout.cornerRadius}px`
        : `${cutout.cornerRadius}px`,
  };
  return <div className={styles.cutout} style={style} data-testid="cutout" data-cutout={cutout.kind} />;
}

function AndroidNavigation({ device, tint, dark }: { device: DeviceProfile; tint: string; dark: boolean }) {
  const gesture = device.navigation.mode === 'android-gesture';
  return (
    <div className={styles.androidNav} style={{ height: device.navigation.height }} data-testid="android-navigation">
      {gesture ? (
        <div
          className={styles.gesturePill}
          style={{ width: device.navigation.indicatorWidth, background: dark ? '#ffffff' : '#000000' }}
        />
      ) : (
        <div className={styles.threeButton} style={{ color: tint }}>
          <span aria-hidden>◀</span>
          <span aria-hidden>●</span>
          <span aria-hidden>■</span>
        </div>
      )}
    </div>
  );
}

function SignalIcon() {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
      <rect x="0" y="7.5" width="3" height="3.5" rx="1" />
      <rect x="4.5" y="5" width="3" height="6" rx="1" />
      <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
      <rect x="13.5" y="0" width="3" height="11" rx="1" />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
      <path d="M8 11 5.6 8.3a3.7 3.7 0 0 1 4.8 0L8 11Z" />
      <path d="M8 5.6c1.5 0 2.9.5 4 1.5l1.5-1.7A8.4 8.4 0 0 0 8 3.2a8.4 8.4 0 0 0-5.5 2.2L4 7.1a6 6 0 0 1 4-1.5Z" opacity="0.9" />
      <path d="M8 0C5.2 0 2.6 1 .6 2.7l1.5 1.7A9.4 9.4 0 0 1 8 2.2c2.3 0 4.4.8 5.9 2.2l1.5-1.7A11.6 11.6 0 0 0 8 0Z" opacity="0.75" />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
      <rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="18" height="8" rx="1.8" fill="currentColor" />
      <path d="M23 4v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" opacity="0.5" />
    </svg>
  );
}
