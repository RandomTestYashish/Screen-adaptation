import styles from './Workspace.module.css';

export type RenderStage = 'analysing' | 'adapting' | 'rendering' | 'validating';

const STAGES: { key: RenderStage; label: string; detail: string }[] = [
  { key: 'analysing', label: 'Analysing design', detail: 'Reading the source and its design system' },
  { key: 'adapting', label: 'Adapting', detail: 'Fitting the structure to this viewport' },
  { key: 'rendering', label: 'Rendering', detail: 'Drawing the device and its chrome' },
  { key: 'validating', label: 'Validating', detail: 'Two passes over the result' },
];

/**
 * Staged progress instead of a blank "Rendering…" (spec section 29).
 *
 * The stages are the real pipeline stages, so what it shows is what is
 * happening. No countdown is displayed, because nothing here can honestly
 * predict how long the remaining work takes.
 */
export function RenderProgress({ label, stage }: { label: string; stage: RenderStage }) {
  const currentIndex = STAGES.findIndex((entry) => entry.key === stage);

  return (
    <div className={styles.progressPane} aria-busy="true" aria-live="polite">
      <span className={styles.progressBadge}>{label}</span>
      <ol className={styles.progressList}>
        {STAGES.map((entry, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
          return (
            <li key={entry.key} className={styles.progressStep} data-state={state}>
              <span className={styles.progressMark} aria-hidden>
                {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
              </span>
              <span className={styles.progressText}>
                <span className={styles.progressLabel}>{entry.label}</span>
                <span className={styles.progressDetail}>{entry.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
