import type { CSSProperties, ReactNode } from 'react';
import type { DeviceProfile } from '@dae/shared';
import styles from './DeviceShell.module.css';

interface Props {
  device: DeviceProfile;
  /** Logical size of the screen area, before zoom. */
  screen: { width: number; height: number };
  showShell: boolean;
  children: ReactNode;
}

/**
 * Layer A - the physical device shell.
 *
 * Every dimension comes from the DeviceProfile (bezel, screen corner radius,
 * shell corner radius), so a new phone renders correctly from catalog data
 * alone. There is no per-model hand-drawn mockup anywhere in this codebase
 * (spec section 9).
 */
export function DeviceShell({ device, screen, showShell, children }: Props) {
  const bezel = device.shellBezel;
  const style: CSSProperties = showShell
    ? {
        padding: `${bezel.top}px ${bezel.right}px ${bezel.bottom}px ${bezel.left}px`,
        borderRadius: `${device.shellCornerRadius}px`,
      }
    : { padding: 0, borderRadius: `${device.screenCornerRadius}px` };

  return (
    <div className={showShell ? styles.shell : styles.bare} style={style} data-device={device.id}>
      <div
        className={styles.screen}
        style={{
          width: screen.width,
          height: screen.height,
          borderRadius: `${device.screenCornerRadius}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
