import * as Switch from '@radix-ui/react-switch';
import type { DeviceProfile } from '@dae/shared';
import { useWorkspace, type ChromeToggles, type PreviewPane } from '../../state/workspace.js';
import styles from './PreviewControls.module.css';

interface Props {
  pane: PreviewPane;
  device?: DeviceProfile;
}

interface ToggleSpec {
  key: keyof ChromeToggles;
  label: string;
  hint: string;
  available(device?: DeviceProfile): boolean;
}

/**
 * Per-preview layer controls (spec section 12). Each switch toggles one
 * rendering layer; none of them modifies the design.
 */
const TOGGLES: ToggleSpec[] = [
  { key: 'deviceShell', label: 'Device shell', hint: 'Cosmetic bezel drawn from the profile geometry.', available: () => true },
  { key: 'statusBar', label: 'Status bar', hint: 'Platform status bar drawn above the design.', available: () => true },
  {
    key: 'cutout',
    label: 'Notch / cutout',
    hint: 'Notch, Dynamic Island or punch-hole, positioned from catalog geometry.',
    available: (device) => device?.cutout.kind !== 'none',
  },
  {
    key: 'homeIndicator',
    label: 'Home indicator',
    hint: 'iOS home indicator pill.',
    available: (device) => device?.navigation.mode === 'ios-home-indicator',
  },
  {
    key: 'androidNavigation',
    label: 'Android navigation',
    hint: 'Gesture pill or three-button navigation bar.',
    available: (device) => Boolean(device?.navigation.mode.startsWith('android')),
  },
  { key: 'safeAreaOverlay', label: 'Safe-area overlay', hint: 'Shows what the source reserved versus what this device adds.', available: () => true },
  {
    key: 'keyboard',
    label: 'Keyboard',
    hint: 'Reduces the usable viewport by the keyboard height and re-runs adaptation.',
    available: (device) => Boolean(device?.keyboard.supported),
  },
  { key: 'darkChrome', label: 'Dark chrome', hint: 'Light-on-dark system UI. Affects the chrome layer only.', available: () => true },
  { key: 'inspectionOverlays', label: 'Finding overlays', hint: 'Highlights regions the validation run flagged.', available: () => true },
];

export function PreviewControls({ pane, device }: Props) {
  const setChrome = useWorkspace((s) => s.setChrome);
  const updatePane = useWorkspace((s) => s.updatePane);
  const removePane = useWorkspace((s) => s.removePane);
  const setPickingFor = useWorkspace((s) => s.setPickingFor);
  const paneCount = useWorkspace((s) => s.panes.length);

  const supportsLandscape = device?.orientations.includes('landscape') ?? false;

  return (
    <section className={styles.panel} aria-label={`Controls for ${device?.marketingName ?? 'preview'}`}>
      <header className={styles.header}>
        <h3 className={styles.title}>{device?.marketingName ?? 'Preview'}</h3>
        <div className={styles.headerActions}>
          <button type="button" className={styles.link} onClick={() => setPickingFor(pane.id)}>
            Change device
          </button>
          {paneCount > 1 && (
            <button type="button" className={styles.link} onClick={() => removePane(pane.id)}>
              Remove
            </button>
          )}
        </div>
      </header>

      {supportsLandscape && (
        <div className={styles.segmented} role="group" aria-label="Orientation">
          {(['portrait', 'landscape'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={pane.orientation === value ? styles.segmentActive : styles.segment}
              aria-pressed={pane.orientation === value}
              onClick={() => updatePane(pane.id, { orientation: value })}
            >
              {value}
            </button>
          ))}
        </div>
      )}

      <ul className={styles.toggles}>
        {TOGGLES.filter((toggle) => toggle.available(device)).map((toggle) => (
          <li key={toggle.key} className={styles.toggleRow}>
            <div className={styles.toggleText}>
              <label htmlFor={`${pane.id}-${toggle.key}`} className={styles.toggleLabel}>
                {toggle.label}
              </label>
              <p className={styles.toggleHint}>{toggle.hint}</p>
            </div>
            <Switch.Root
              id={`${pane.id}-${toggle.key}`}
              className={styles.switch}
              checked={pane.chrome[toggle.key]}
              onCheckedChange={(checked) => setChrome(pane.id, { [toggle.key]: checked })}
            >
              <Switch.Thumb className={styles.switchThumb} />
            </Switch.Root>
          </li>
        ))}
      </ul>
    </section>
  );
}
