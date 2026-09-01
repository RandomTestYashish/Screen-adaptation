import { useMemo } from 'react';
import { findNode, type AdaptationResult, type Rect, type Screen, type ValidationReport } from '@dae/shared';
import styles from './Overlays.module.css';

interface Props {
  screen: Screen;
  adaptation: AdaptationResult;
  selectedNodeId?: string;
  measureFromNodeId?: string;
  validation?: ValidationReport;
  showFindings: boolean;
  /** Scroll offset of the design viewport, so overlays track the content. */
  scrollTop: number;
}

/**
 * Layer E - Dev Mode inspection overlays.
 *
 * Draws bounding boxes, padding bands and the distance between two selected
 * elements. Purely additive: it is a sibling of the design layer, never a
 * modification of it (spec section 13: "Do not alter the design when
 * inspecting it").
 */
export function InspectionOverlay({
  screen,
  adaptation,
  selectedNodeId,
  measureFromNodeId,
  validation,
  showFindings,
  scrollTop,
}: Props) {
  const byId = useMemo(() => new Map(adaptation.nodes.map((n) => [n.nodeId, n])), [adaptation.nodes]);
  const selected = selectedNodeId ? byId.get(selectedNodeId) : undefined;
  const measureFrom = measureFromNodeId ? byId.get(measureFromNodeId) : undefined;
  const selectedIr = selectedNodeId ? findNode(screen.root, selectedNodeId) : undefined;

  const findingRegions = useMemo(() => {
    if (!validation || !showFindings) return [];
    const finalPass = validation.passes[validation.passes.length - 1];
    return (finalPass?.results ?? [])
      .flatMap((result) => result.findings)
      .filter((f) => f.region && (f.severity === 'critical' || f.severity === 'warning'))
      .map((f) => ({ region: f.region!, severity: f.severity, title: f.title }));
  }, [validation, showFindings]);

  return (
    <div className={styles.inspectionLayer} style={{ transform: `translateY(${-scrollTop}px)` }} aria-hidden="true">
      {findingRegions.map((entry, index) => (
        <div
          key={index}
          className={entry.severity === 'critical' ? styles.criticalRegion : styles.warningRegion}
          style={boxStyle(entry.region)}
          title={entry.title}
        />
      ))}

      {selected && (
        <>
          <div className={styles.selectionBox} style={boxStyle(selected.frame)}>
            <span className={styles.selectionLabel}>
              {Math.round(selected.frame.width)} x {Math.round(selected.frame.height)}
            </span>
          </div>
          {selectedIr && hasPadding(selectedIr.padding) && (
            <div
              className={styles.paddingBand}
              style={boxStyle(insetBy(selected.frame, selectedIr.padding))}
            />
          )}
        </>
      )}

      {selected && measureFrom && measureFrom.nodeId !== selected.nodeId && (
        <DistanceGuides from={measureFrom.frame} to={selected.frame} />
      )}
    </div>
  );
}

function boxStyle(rect: Rect) {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

function insetBy(rect: Rect, padding: { top: number; right: number; bottom: number; left: number }): Rect {
  return {
    x: rect.x + padding.left,
    y: rect.y + padding.top,
    width: Math.max(0, rect.width - padding.left - padding.right),
    height: Math.max(0, rect.height - padding.top - padding.bottom),
  };
}

function hasPadding(padding: { top: number; right: number; bottom: number; left: number }): boolean {
  return padding.top > 0 || padding.right > 0 || padding.bottom > 0 || padding.left > 0;
}

/**
 * Numeric and visual distance between two elements, the measurement a designer
 * reaches for most often (spec section 13).
 */
function DistanceGuides({ from, to }: { from: Rect; to: Rect }) {
  const fromRight = from.x + from.width;
  const fromBottom = from.y + from.height;
  const toRight = to.x + to.width;
  const toBottom = to.y + to.height;

  const guides: { style: React.CSSProperties; label: string; horizontal: boolean }[] = [];

  // Vertical gap, measured between the facing edges.
  if (to.y >= fromBottom) {
    guides.push({
      style: { left: Math.max(from.x, to.x), top: fromBottom, width: 1, height: to.y - fromBottom },
      label: `${round(to.y - fromBottom)}px`,
      horizontal: false,
    });
  } else if (from.y >= toBottom) {
    guides.push({
      style: { left: Math.max(from.x, to.x), top: toBottom, width: 1, height: from.y - toBottom },
      label: `${round(from.y - toBottom)}px`,
      horizontal: false,
    });
  }

  // Horizontal gap.
  if (to.x >= fromRight) {
    guides.push({
      style: { left: fromRight, top: Math.max(from.y, to.y), width: to.x - fromRight, height: 1 },
      label: `${round(to.x - fromRight)}px`,
      horizontal: true,
    });
  } else if (from.x >= toRight) {
    guides.push({
      style: { left: toRight, top: Math.max(from.y, to.y), width: from.x - toRight, height: 1 },
      label: `${round(from.x - toRight)}px`,
      horizontal: true,
    });
  }

  return (
    <>
      <div className={styles.measureBox} style={boxStyle(from)} />
      {guides.map((guide, index) => (
        <div key={index} className={styles.guide} style={guide.style}>
          <span className={guide.horizontal ? styles.guideLabelH : styles.guideLabelV}>{guide.label}</span>
        </div>
      ))}
    </>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
