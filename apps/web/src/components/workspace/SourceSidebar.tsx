import { useState } from 'react';
import { primaryScreen } from '@dae/shared';
import { useWorkspace } from '../../state/workspace.js';
import styles from './SourceSidebar.module.css';

interface DnaShape {
  colors?: { hex: string; role: string; coverage: number }[];
  typography?: { name: string; fontSize: number; fontWeight: number; lineHeight: number }[];
  grid?: { value: number | null; confidence: number };
  edgeMargin?: { value: number | null };
  radii?: { value: number[] };
  fontFamily?: { value: string | null };
}

/**
 * Minimal source and design-system context (spec section 21).
 *
 * Hideable, and its toggle stays on screen when it is closed so the control is
 * never lost.
 */
export function SourceSidebar({ onClose }: { onClose(): void }) {
  const source = useWorkspace((s) => s.source);
  const design = useWorkspace((s) => s.design);
  const dna = useWorkspace((s) => s.dna) as DnaShape | undefined;
  const reset = useWorkspace((s) => s.reset);
  const [dnaOpen, setDnaOpen] = useState(true);

  if (!source || !design) return null;
  const screen = primaryScreen(design);

  return (
    <aside className={styles.sidebar} aria-label="Source">
      <header className={styles.header}>
        <h2 className={styles.heading}>Source</h2>
        <button type="button" className={styles.collapse} onClick={onClose} aria-label="Hide source panel">
          ‹
        </button>
      </header>

      <section className={styles.section}>
        <p className={styles.name} title={source.name}>
          {source.name}
        </p>
        <dl className={styles.rows}>
          <Row label="kind" value={source.kind === 'raster' ? 'Bitmap' : 'Figma frame'} />
          <Row label="frame" value={`${screen.frame.width} x ${screen.frame.height}`} />
          <Row label="scroll" value={`${screen.scrollHeight}px`} />
          <Row label="structure" value={design.structure} />
          <Row label="preserved" value="unchanged" tone="good" />
        </dl>
      </section>

      {dna && (
        <section className={styles.section}>
          <button
            type="button"
            className={styles.sectionToggle}
            onClick={() => setDnaOpen(!dnaOpen)}
            aria-expanded={dnaOpen}
          >
            Design system <span aria-hidden>{dnaOpen ? '▾' : '▸'}</span>
          </button>

          {dnaOpen && (
            <div className={styles.dna}>
              {dna.colors && dna.colors.length > 0 && (
                <>
                  <h3 className={styles.dnaHeading}>Colours</h3>
                  <ul className={styles.swatches}>
                    {dna.colors.slice(0, 8).map((color) => (
                      <li key={color.hex} className={styles.swatch} title={`${color.hex} · ${color.role}`}>
                        <span className={styles.chip} style={{ background: color.hex }} />
                        <span className={styles.swatchMeta}>
                          <code>{color.hex}</code>
                          <span>{color.role}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {dna.typography && dna.typography.length > 0 && (
                <>
                  <h3 className={styles.dnaHeading}>Type scale</h3>
                  <dl className={styles.rows}>
                    {dna.typography.map((token) => (
                      <Row
                        key={`${token.name}-${token.fontSize}-${token.fontWeight}`}
                        label={token.name}
                        value={`${token.fontSize}/${token.fontWeight} · ${token.lineHeight}`}
                      />
                    ))}
                  </dl>
                </>
              )}

              <h3 className={styles.dnaHeading}>Rhythm</h3>
              <dl className={styles.rows}>
                <Row
                  label="grid"
                  value={dna.grid?.value ? `${dna.grid.value}px` : 'none detected'}
                  tone={dna.grid?.value ? undefined : 'muted'}
                />
                <Row label="edge margin" value={dna.edgeMargin?.value ? `${dna.edgeMargin.value}px` : 'unknown'} />
                <Row label="radii" value={dna.radii?.value?.length ? dna.radii.value.join(', ') : 'none'} />
                <Row
                  label="font family"
                  value={dna.fontFamily?.value ?? 'unknowable from a bitmap'}
                  tone="muted"
                />
              </dl>
            </div>
          )}
        </section>
      )}

      <div className={styles.footer}>
        <button type="button" className={styles.link} onClick={reset}>
          Import a different design
        </button>
      </div>
    </aside>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'muted' }) {
  return (
    <div className={styles.row} data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
