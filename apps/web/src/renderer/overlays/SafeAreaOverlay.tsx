import { safeAreaFor, viewportFor, type DeviceProfile, type Orientation } from '@dae/shared';
import styles from './Overlays.module.css';

interface Props {
  device: DeviceProfile;
  orientation: Orientation;
  /** Safe area the source design is judged to already reserve. */
  assumedSourceSafeArea: { top: number; bottom: number };
}

/**
 * Layer C - safe-area visualisation.
 *
 * Distinguishes the inset the source already accounts for from the extra inset
 * this device adds, because that difference is what actually changes on a new
 * device.
 */
export function SafeAreaOverlay({ device, orientation, assumedSourceSafeArea }: Props) {
  const safeArea = safeAreaFor(device, orientation);
  const viewport = viewportFor(device, orientation);
  const inheritedTop = Math.min(assumedSourceSafeArea.top, safeArea.top);
  const newTop = Math.max(0, safeArea.top - assumedSourceSafeArea.top);
  const inheritedBottom = Math.min(assumedSourceSafeArea.bottom, safeArea.bottom);
  const newBottom = Math.max(0, safeArea.bottom - assumedSourceSafeArea.bottom);

  return (
    <div className={styles.safeAreaLayer} aria-hidden="true">
      {inheritedTop > 0 && (
        <div className={styles.inheritedBand} style={{ top: 0, height: inheritedTop }}>
          <span className={styles.bandLabel}>source reserves {inheritedTop}px</span>
        </div>
      )}
      {newTop > 0 && (
        <div className={styles.newBand} style={{ top: inheritedTop, height: newTop }}>
          <span className={styles.bandLabel}>+{newTop}px on this device</span>
        </div>
      )}

      {inheritedBottom > 0 && (
        <div className={styles.inheritedBand} style={{ bottom: 0, height: inheritedBottom }}>
          <span className={styles.bandLabel}>source reserves {inheritedBottom}px</span>
        </div>
      )}
      {newBottom > 0 && (
        <div className={styles.newBand} style={{ bottom: inheritedBottom, height: newBottom }}>
          <span className={styles.bandLabel}>+{newBottom}px on this device</span>
        </div>
      )}

      <div
        className={styles.safeRect}
        style={{
          top: safeArea.top,
          bottom: safeArea.bottom,
          left: safeArea.left,
          right: safeArea.right,
        }}
      >
        <span className={styles.safeRectLabel}>
          safe area {viewport.width - safeArea.left - safeArea.right} x{' '}
          {viewport.height - safeArea.top - safeArea.bottom}
        </span>
      </div>
    </div>
  );
}
