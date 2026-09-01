import { useMemo } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import {
  findNode,
  findParent,
  safeAreaFor,
  type AdaptationResult,
  type DesignNode,
  type DeviceProfile,
  type Screen,
} from '@dae/shared';
import { useWorkspace } from '../../state/workspace.js';
import styles from './Inspector.module.css';

interface Props {
  screen: Screen;
  adaptation: AdaptationResult;
  device: DeviceProfile;
  /** Real DOM boxes measured in the preview, when available. */
  measured?: Record<string, { x: number; y: number; width: number; height: number }>;
}

type Quality = 'detected' | 'inferred' | 'unavailable';
interface Row {
  key: string;
  value: string;
  quality: Quality;
}

/**
 * The Dev Mode inspector (spec section 13).
 *
 * Reads like a developer measurement panel, not a redesign assistant: it
 * reports values and where they came from, and offers no action that would
 * change the design.
 */
export function Inspector({ screen, adaptation, device, measured }: Props) {
  const selectedNodeId = useWorkspace((s) => s.selectedNodeId);
  const measureFromNodeId = useWorkspace((s) => s.measureFromNodeId);
  const setMeasureFrom = useWorkspace((s) => s.setMeasureFrom);
  const selectNode = useWorkspace((s) => s.selectNode);

  const node = useMemo(
    () => (selectedNodeId ? findNode(screen.root, selectedNodeId) : undefined),
    [screen.root, selectedNodeId],
  );
  const parent = useMemo(
    () => (selectedNodeId ? findParent(screen.root, selectedNodeId) : undefined),
    [screen.root, selectedNodeId],
  );
  const adapted = useMemo(
    () => adaptation.nodes.find((n) => n.nodeId === selectedNodeId),
    [adaptation.nodes, selectedNodeId],
  );

  if (!node || !adapted) {
    return (
      <div className={styles.empty}>
        <p>Dev Mode is on. Tap any element in a preview to inspect its measurements.</p>
        <p className={styles.emptyHint}>
          Inspecting never changes the design. Values measured from the live preview are marked{' '}
          <span className={styles.detected}>detected</span>; values predicted by the engine are marked{' '}
          <span className={styles.inferred}>inferred</span>.
        </p>
      </div>
    );
  }

  const box = measured?.[node.id];
  const frame = box ?? adapted.frame;
  const frameQuality: Quality = box ? 'detected' : 'inferred';
  const safeArea = safeAreaFor(device, adaptation.plan.options.orientation);

  const typography: Row[] =
    node.type === 'text'
      ? [
          { key: 'font-family', value: node.typography.fontFamily, quality: 'detected' },
          { key: 'font-size', value: px(node.typography.fontSize), quality: 'detected' },
          { key: 'font-weight', value: String(node.typography.fontWeight), quality: 'detected' },
          {
            key: 'line-height',
            value: px(node.typography.lineHeight),
            quality: node.typography.lineHeightSource === 'explicit' ? 'detected' : 'inferred',
          },
          { key: 'letter-spacing', value: px(node.typography.letterSpacing), quality: 'detected' },
          { key: 'text-align', value: node.typography.textAlign, quality: 'detected' },
          { key: 'text-transform', value: node.typography.textTransform, quality: 'detected' },
          { key: 'color', value: hex(node.typography.color), quality: 'detected' },
          ...(adapted.lineCount !== undefined
            ? [{ key: 'rendered-lines', value: String(adapted.lineCount), quality: 'inferred' as Quality }]
            : []),
        ]
      : [{ key: 'font-size', value: 'not a text element', quality: 'unavailable' }];

  const boxRows: Row[] = [
    { key: 'width', value: px(frame.width), quality: frameQuality },
    { key: 'height', value: px(frame.height), quality: frameQuality },
    { key: 'border-radius', value: `${node.cornerRadius.topLeft} ${node.cornerRadius.topRight} ${node.cornerRadius.bottomRight} ${node.cornerRadius.bottomLeft}`, quality: 'detected' },
    { key: 'opacity', value: String(node.opacity), quality: 'detected' },
    {
      key: 'box-shadow',
      value: node.shadows.length > 0 ? `${node.shadows.length} shadow${node.shadows.length === 1 ? '' : 's'}` : 'none',
      quality: 'detected',
    },
    {
      key: 'border',
      value: node.strokes[0] ? `${node.strokes[0].weight}px ${node.strokes[0].style} ${hex(node.strokes[0].color)}` : 'none',
      quality: 'detected',
    },
  ];

  const spacingRows: Row[] = [
    { key: 'padding-top', value: px(node.padding.top), quality: 'detected' },
    { key: 'padding-right', value: px(node.padding.right), quality: 'detected' },
    { key: 'padding-bottom', value: px(node.padding.bottom), quality: 'detected' },
    { key: 'padding-left', value: px(node.padding.left), quality: 'detected' },
    ...(node.autoLayout
      ? [{ key: 'gap', value: px(node.autoLayout.gap), quality: 'detected' as Quality }]
      : [{ key: 'gap', value: 'no auto layout on this element', quality: 'unavailable' as Quality }]),
    ...(parent ? gapToSiblings(parent, node, adaptation) : []),
  ];

  const layoutRows: Row[] = [
    {
      key: 'layout-direction',
      value: node.autoLayout?.direction ?? 'absolute',
      quality: node.autoLayout ? 'detected' : 'inferred',
    },
    ...(node.autoLayout
      ? [
          { key: 'primary-align', value: node.autoLayout.primaryAxisAlign, quality: 'detected' as Quality },
          { key: 'counter-align', value: node.autoLayout.counterAxisAlign, quality: 'detected' as Quality },
          { key: 'primary-sizing', value: node.autoLayout.primaryAxisSizing, quality: 'detected' as Quality },
        ]
      : []),
    { key: 'constraint-horizontal', value: node.constraints.horizontal, quality: 'detected' },
    { key: 'constraint-vertical', value: node.constraints.vertical, quality: 'detected' },
    { key: 'z-index', value: String(node.zIndex), quality: 'detected' },
  ];

  const positionRows: Row[] = [
    { key: 'x', value: px(frame.x), quality: frameQuality },
    { key: 'y', value: px(frame.y), quality: frameQuality },
    { key: 'right', value: px(adaptation.plan.targetViewport.width - (frame.x + frame.width)), quality: frameQuality },
    { key: 'position', value: node.position, quality: node.fieldQuality['position']?.quality ?? 'detected' },
    { key: 'parent', value: parent?.name ?? 'document root', quality: 'detected' },
  ];

  const distanceToSafeTop = frame.y - safeArea.top;
  const distanceToSafeBottom =
    adaptation.plan.usableViewport.height - safeArea.bottom - (frame.y + frame.height);

  const deviceRows: Row[] = [
    { key: 'safe-area-anchor', value: node.safeAreaAnchor, quality: node.fieldQuality['safeAreaAnchor']?.quality ?? 'detected' },
    { key: 'distance-to-safe-top', value: px(distanceToSafeTop), quality: frameQuality },
    { key: 'distance-to-safe-bottom', value: px(distanceToSafeBottom), quality: frameQuality },
    { key: 'viewport', value: `${adaptation.plan.targetViewport.width} x ${adaptation.plan.targetViewport.height}`, quality: 'detected' },
    { key: 'device-pixel-ratio', value: String(device.devicePixelRatio), quality: 'detected' },
    {
      key: 'physical-size',
      value: `${Math.round(frame.width * device.devicePixelRatio)} x ${Math.round(frame.height * device.devicePixelRatio)} px`,
      quality: 'inferred',
    },
  ];

  const sourceRows: Row[] = [
    { key: 'node-name', value: node.name, quality: 'detected' },
    { key: 'node-type', value: node.type, quality: 'detected' },
    {
      key: 'source-node-id',
      value: node.provenance.sourceNodeId ?? 'not available for this source type',
      quality: node.provenance.sourceNodeId ? 'detected' : 'unavailable',
    },
    { key: 'provenance', value: `${node.provenance.origin} (${Math.round(node.provenance.confidence * 100)}%)`, quality: node.provenance.quality },
    ...(node.provenance.note ? [{ key: 'note', value: node.provenance.note, quality: node.provenance.quality }] : []),
  ];

  const transforms = adaptation.plan.transforms.filter((t) => t.targetNodeId === node.id);

  return (
    <div className={styles.inspector}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.nodeName}>{node.name}</h3>
          <p className={styles.nodeType}>
            {node.type}
            {node.safeAreaAnchor !== 'none' && ` · ${node.safeAreaAnchor}`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={measureFromNodeId === node.id ? styles.actionActive : styles.action}
            onClick={() => setMeasureFrom(measureFromNodeId === node.id ? undefined : node.id)}
          >
            {measureFromNodeId === node.id ? 'Measuring from this' : 'Measure from this'}
          </button>
          <button type="button" className={styles.action} onClick={() => selectNode(undefined)}>
            Deselect
          </button>
        </div>
      </header>

      {measureFromNodeId && measureFromNodeId !== node.id && (
        <p className={styles.measureHint}>
          Showing the distance from the anchored element to this one in the preview overlay.
        </p>
      )}

      <Accordion.Root type="multiple" defaultValue={['position', 'box', 'typography']} className={styles.accordion}>
        <Section value="typography" title="Typography" rows={typography} />
        <Section value="box" title="Box" rows={boxRows} />
        <Section value="spacing" title="Spacing" rows={spacingRows} />
        <Section value="layout" title="Layout" rows={layoutRows} />
        <Section value="position" title="Position" rows={positionRows} />
        <Section value="device" title="Device / safe area" rows={deviceRows} />
        <Section value="source" title="Source" rows={sourceRows} />

        {transforms.length > 0 && (
          <Accordion.Item value="transforms" className={styles.item}>
            <Accordion.Header>
              <Accordion.Trigger className={styles.trigger}>
                Adaptation <span className={styles.chevron} aria-hidden>▾</span>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className={styles.content}>
              <ul className={styles.transformList}>
                {transforms.map((transform) => (
                  <li key={transform.id}>
                    <span className={styles.transformType}>{transform.type}</span>
                    <span className={styles.transformImpact}>{transform.impact}</span>
                    <p className={styles.transformReason}>{transform.reason}</p>
                  </li>
                ))}
              </ul>
            </Accordion.Content>
          </Accordion.Item>
        )}
      </Accordion.Root>
    </div>
  );
}

function Section({ value, title, rows }: { value: string; title: string; rows: Row[] }) {
  return (
    <Accordion.Item value={value} className={styles.item}>
      <Accordion.Header>
        <Accordion.Trigger className={styles.trigger}>
          {title} <span className={styles.chevron} aria-hidden>▾</span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className={styles.content}>
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div key={row.key} className={styles.row} data-quality={row.quality}>
              <dt>{row.key}</dt>
              <dd>
                {row.value}
                {row.quality !== 'detected' && <span className={styles.qualityTag}>{row.quality}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Accordion.Content>
    </Accordion.Item>
  );
}

/** Distance to the nearest sibling above and below, the common design question. */
function gapToSiblings(parent: DesignNode, node: DesignNode, adaptation: AdaptationResult): Row[] {
  if (parent.type !== 'container' && parent.type !== 'scroll-container') return [];
  const byId = new Map(adaptation.nodes.map((n) => [n.nodeId, n]));
  const self = byId.get(node.id);
  if (!self) return [];

  let above: number | undefined;
  let below: number | undefined;
  for (const sibling of parent.children) {
    if (sibling.id === node.id) continue;
    const box = byId.get(sibling.id);
    if (!box) continue;
    const siblingBottom = box.frame.y + box.frame.height;
    if (siblingBottom <= self.frame.y) {
      const gap = self.frame.y - siblingBottom;
      above = above === undefined ? gap : Math.min(above, gap);
    }
    const selfBottom = self.frame.y + self.frame.height;
    if (box.frame.y >= selfBottom) {
      const gap = box.frame.y - selfBottom;
      below = below === undefined ? gap : Math.min(below, gap);
    }
  }

  const rows: Row[] = [];
  if (above !== undefined) rows.push({ key: 'gap-above', value: px(above), quality: 'inferred' });
  if (below !== undefined) rows.push({ key: 'gap-below', value: px(below), quality: 'inferred' });
  return rows;
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function hex(color: { r: number; g: number; b: number; a: number }): string {
  const to = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return color.a >= 1
    ? `#${to(color.r)}${to(color.g)}${to(color.b)}`
    : `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;
}
