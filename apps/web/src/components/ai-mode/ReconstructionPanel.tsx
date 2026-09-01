import { useMemo } from 'react';
import { flatten, type AdaptationResult, type DesignDocument, type DesignNode, type Screen } from '@dae/shared';
import { useWorkspace } from '../../state/workspace.js';
import styles from './ReconstructionPanel.module.css';

interface Props {
  screen: Screen;
  adaptation: AdaptationResult;
  design: DesignDocument;
  dna?: unknown;
}

/**
 * AI Mode: what the analysis concluded, and how sure it is.
 *
 * Deliberately separate from Dev Mode. Dev Mode answers "what are this
 * element's measurements"; AI Mode answers "why does the system think this is a
 * card, and what did it decline to reconstruct" (spec section 18).
 */
export function ReconstructionPanel({ screen, adaptation, design, dna }: Props) {
  const selectedNodeId = useWorkspace((s) => s.selectedNodeId);
  const selectNode = useWorkspace((s) => s.selectNode);

  const nodes = useMemo(() => flatten(screen.root).filter((node) => node.analysis), [screen.root]);
  const selected = nodes.find((node) => node.id === selectedNodeId);

  const summary = useMemo(() => {
    const byStrategy = new Map<string, number>();
    const byType = new Map<string, number>();
    let confidenceSum = 0;
    for (const node of nodes) {
      const analysis = node.analysis!;
      byStrategy.set(analysis.renderStrategy, (byStrategy.get(analysis.renderStrategy) ?? 0) + 1);
      byType.set(analysis.componentType, (byType.get(analysis.componentType) ?? 0) + 1);
      confidenceSum += analysis.confidence;
    }
    return {
      byStrategy: [...byStrategy.entries()].sort((a, b) => b[1] - a[1]),
      byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
      meanConfidence: nodes.length === 0 ? 0 : confidenceSum / nodes.length,
    };
  }, [nodes]);

  if (design.structure !== 'reconstructed') {
    return (
      <div className={styles.empty}>
        <p>
          {design.structure === 'figma'
            ? 'This source came from Figma, so its structure is read directly from the file rather than inferred. There is nothing to explain here.'
            : 'This bitmap was not reconstructed, so it adapts by proportional scaling. Nothing was inferred about its structure.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>Reconstruction</h3>
        <p className={styles.subtitle}>
          {nodes.length} regions · mean confidence {Math.round(summary.meanConfidence * 100)}%
        </p>
      </header>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>How each region is rendered</h4>
        <ul className={styles.tally}>
          {summary.byStrategy.map(([strategy, count]) => (
            <li key={strategy}>
              <span className={styles.tallyLabel} data-strategy={strategy}>
                {strategy === 'RECONSTRUCT'
                  ? 'Reconstructed'
                  : strategy === 'HYBRID'
                    ? 'Hybrid'
                    : 'Original pixels'}
              </span>
              <span className={styles.tallyCount}>{count}</span>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          Anything the analysis could not describe confidently keeps the designer&apos;s own pixels rather than being
          invented.
        </p>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Detected components</h4>
        <ul className={styles.tally}>
          {summary.byType.map(([type, count]) => (
            <li key={type}>
              <span className={styles.tallyLabel}>{type.replace(/_/g, ' ').toLowerCase()}</span>
              <span className={styles.tallyCount}>{count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Lowest confidence</h4>
        <ul className={styles.regionList}>
          {[...nodes]
            .sort((a, b) => a.analysis!.confidence - b.analysis!.confidence)
            .slice(0, 6)
            .map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className={node.id === selectedNodeId ? styles.regionActive : styles.region}
                  onClick={() => selectNode(node.id)}
                >
                  <span className={styles.regionType}>{node.analysis!.componentType}</span>
                  <span className={styles.regionConfidence} data-low={node.analysis!.confidence < 0.6}>
                    {Math.round(node.analysis!.confidence * 100)}%
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </section>

      {selected?.analysis && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Why this was classified as {selected.analysis.componentType}</h4>
          <ul className={styles.reasons}>
            {selected.analysis.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
          {selected.analysis.typography && (
            <p className={styles.note}>
              Type measured at {selected.analysis.typography.fontSize}px / {selected.analysis.typography.fontWeight}{' '}
              over {selected.analysis.typography.lineCount} line
              {selected.analysis.typography.lineCount === 1 ? '' : 's'}. Weight is the least reliable of these:
              stem thickness at UI sizes is close to the limit of what a screenshot can show.
            </p>
          )}
        </section>
      )}

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>How this adapts</h4>
        <p className={styles.reasonText}>{adaptation.plan.strategyReason}</p>
        {Boolean(dna) && <DnaCaveats dna={dna} />}
      </section>
    </div>
  );
}

function DnaCaveats({ dna }: { dna: unknown }) {
  const shape = dna as { grid?: { value: number | null; source: string }; fontFamily?: { source: string } };
  return (
    <ul className={styles.reasons}>
      {shape.grid && <li>{shape.grid.source}</li>}
      {shape.fontFamily && <li>{shape.fontFamily.source}</li>}
    </ul>
  );
}

export type { DesignNode };
