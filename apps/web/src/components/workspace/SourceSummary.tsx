import type { DesignDocument, SourceDocument } from '@dae/shared';
import { primaryScreen } from '@dae/shared';
import { useWorkspace } from '../../state/workspace.js';
import styles from './Workspace.module.css';

/**
 * Immediate feedback on what was imported (spec section 22), including the
 * "source preserved" status that makes the immutability guarantee visible.
 */
export function SourceSummary({ source, design }: { source: SourceDocument; design: DesignDocument }) {
  const reset = useWorkspace((s) => s.reset);
  const screen = primaryScreen(design);

  return (
    <div className={styles.sourceSummary}>
      <div>
        <h1 className={styles.sourceName}>{source.name}</h1>
        <p className={styles.sourceMeta}>
          <span className={styles.preserved} title={`SHA-256 ${source.hash}`}>
            Source preserved
          </span>
          <span>
            {source.kind === 'raster' ? 'Bitmap' : 'Figma frame'} · {screen.frame.width}x{screen.frame.height} logical
            {source.pixelWidth ? ` · ${source.pixelWidth}x${source.pixelHeight} physical` : ''}
            {source.exportScale !== 1 ? ` · ${source.exportScale}x export` : ''}
          </span>
          <span>
            scroll height {screen.scrollHeight}px
            {screen.scrollHeightProvenance.quality !== 'detected' && (
              <span className={styles.qualityTag}>{screen.scrollHeightProvenance.quality}</span>
            )}
          </span>
        </p>
      </div>
      <button type="button" className={styles.link} onClick={reset}>
        Import a different design
      </button>
    </div>
  );
}
