import { safeAreaFor, viewportFor, type AdaptationResult, type DeviceProfile, type Orientation } from '@dae/shared';
import type { OverlayToggles } from '../../state/workspace.js';
import styles from './DeviceOverlay.module.css';

interface Props {
  device: DeviceProfile;
  orientation: Orientation;
  adaptation: AdaptationResult;
  overlay: OverlayToggles;
}

/**
 * A transparent measurement overlay, in the spirit of a design grid
 * (spec section 14).
 *
 * It sits above the design and below the platform chrome, and is aligned to the
 * real rendered viewport rather than being drawn to a nominal size - so the
 * numbers it shows are the numbers the design is actually laid out against.
 * Off by default.
 */
export function DeviceOverlay({ device, orientation, adaptation, overlay }: Props) {
  const viewport = viewportFor(device, orientation);
  const safeArea = safeAreaFor(device, orientation);
  const { plan } = adaptation;
  const margin = plan.contentBounds.x;

  return (
    <div
      className={styles.layer}
      style={{ opacity: overlay.opacity }}
      data-testid="device-overlay"
      aria-hidden="true"
    >
      {overlay.bounds && (
        <>
          <div className={styles.viewportBounds} />
          <div
            className={styles.contentBounds}
            style={{
              left: plan.contentBounds.x,
              width: plan.contentBounds.width,
              top: 0,
              bottom: 0,
            }}
          />
        </>
      )}

      {overlay.safeArea && (
        <>
          {safeArea.top > 0 && (
            <div className={styles.insetBand} style={{ top: 0, height: safeArea.top }}>
              <span className={styles.insetLabel}>safe-area-top {safeArea.top}</span>
            </div>
          )}
          {safeArea.bottom > 0 && (
            <div className={styles.insetBand} style={{ bottom: 0, height: safeArea.bottom }}>
              <span className={styles.insetLabel}>safe-area-bottom {safeArea.bottom}</span>
            </div>
          )}
          <div
            className={styles.safeRect}
            style={{ top: safeArea.top, bottom: safeArea.bottom, left: safeArea.left, right: safeArea.right }}
          />
        </>
      )}

      {overlay.rulers && margin > 0 && (
        <>
          <div className={styles.marginGuide} style={{ left: 0, width: margin }}>
            <span className={styles.marginLabel}>{Math.round(margin)}</span>
          </div>
          <div
            className={styles.marginGuide}
            style={{ right: 0, width: viewport.width - (plan.contentBounds.x + plan.contentBounds.width) }}
          >
            <span className={styles.marginLabel}>
              {Math.round(viewport.width - (plan.contentBounds.x + plan.contentBounds.width))}
            </span>
          </div>
        </>
      )}

      {overlay.geometry && (
        <div className={styles.readout}>
          <span>
            {viewport.width} x {viewport.height}
          </span>
          <span>DPR {device.devicePixelRatio}</span>
          <span>{device.aspectRatio.toFixed(2)}:1</span>
          <span>scroll {Math.round(plan.targetScrollHeight)}</span>
        </div>
      )}
    </div>
  );
}
