import { memo, useMemo, type CSSProperties } from 'react';
import { childrenOf, type AdaptationResult, type AdaptedNode, type DesignNode, type Screen } from '@dae/shared';
import { nodeStyle, rgba } from './nodeStyle.js';
import styles from './DesignRenderer.module.css';

interface Props {
  screen: Screen;
  adaptation: AdaptationResult;
  /** Resolves an asset id to a signed URL. */
  assetUrl: (assetId: string) => string | undefined;
  devMode: boolean;
  selectedNodeId?: string;
  onSelect(nodeId: string): void;
  /** Virtualisation window in adapted logical px; undefined renders everything. */
  visibleRange?: { top: number; bottom: number };
}

/**
 * Layer D - the user's design.
 *
 * This is the only layer that draws the designer's content, and nothing else
 * in the renderer writes into it. It consumes the immutable Design IR plus the
 * adaptation plan's geometry; it never restyles, recolours or re-authors.
 */
export const DesignRenderer = memo(function DesignRenderer({
  screen,
  adaptation,
  assetUrl,
  devMode,
  selectedNodeId,
  onSelect,
  visibleRange,
}: Props) {
  const byId = useMemo(
    () => new Map(adaptation.nodes.map((node) => [node.nodeId, node])),
    [adaptation.nodes],
  );

  const background: CSSProperties = screen.background
    ? { background: rgba(screen.background) }
    : { background: '#ffffff' };

  return (
    <div
      className={styles.document}
      style={{ ...background, height: adaptation.plan.targetScrollHeight, width: adaptation.plan.targetViewport.width }}
      data-testid="design-document"
    >
      {childrenOf(screen.root).map((child) => (
        <NodeView
          key={child.id}
          node={child}
          byId={byId}
          assetUrl={assetUrl}
          devMode={devMode}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
          visibleRange={visibleRange}
          skipFixed
        />
      ))}
    </div>
  );
});

interface NodeProps {
  node: DesignNode;
  byId: Map<string, AdaptedNode>;
  assetUrl: (assetId: string) => string | undefined;
  devMode: boolean;
  selectedNodeId?: string;
  onSelect(nodeId: string): void;
  visibleRange?: { top: number; bottom: number };
  /** Fixed elements are rendered by the viewport, not inside the scroller. */
  skipFixed?: boolean;
}

function NodeView({ node, byId, assetUrl, devMode, selectedNodeId, onSelect, visibleRange, skipFixed }: NodeProps) {
  const adapted = byId.get(node.id);
  if (!adapted || !node.visible) return null;
  if (skipFixed && node.position === 'fixed') return null;

  // Virtualisation: skip subtrees entirely outside the window. Scroll geometry
  // is unaffected because the document keeps its full height either way
  // (spec section 24).
  if (visibleRange) {
    const top = adapted.frame.y;
    const bottom = top + adapted.frame.height;
    if (bottom < visibleRange.top || top > visibleRange.bottom) {
      return <div style={{ position: 'absolute', left: 0, top, width: 1, height: adapted.frame.height }} aria-hidden />;
    }
  }

  const style = nodeStyle(node, adapted, assetUrl);
  const selected = devMode && selectedNodeId === node.id;

  const common = {
    'data-node-id': node.id,
    'data-node-name': node.name,
    'data-node-type': node.type,
    className: [styles.node, devMode ? styles.selectable : '', selected ? styles.selected : ''].filter(Boolean).join(' '),
    style,
    ...(devMode
      ? {
          onClick: (event: React.MouseEvent) => {
            event.stopPropagation();
            onSelect(node.id);
          },
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': `${node.type} ${node.name}`,
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onSelect(node.id);
            }
          },
        }
      : {}),
  };

  if (node.type === 'text') {
    return <div {...common}>{node.characters}</div>;
  }

  if (node.type === 'image') {
    const url = assetUrl(node.assetId);
    return (
      <div {...common}>
        {url && (
          <img
            src={url}
            alt={node.altText ?? node.name}
            className={styles.image}
            style={{
              objectFit: node.scaleMode === 'fit' ? 'contain' : node.scaleMode === 'stretch' ? 'fill' : 'cover',
            }}
            draggable={false}
          />
        )}
      </div>
    );
  }

  if (node.type === 'vector') {
    return (
      <div {...common}>
        <svg
          className={styles.vector}
          viewBox={`0 0 ${node.viewBox?.width ?? adapted.frame.width} ${node.viewBox?.height ?? adapted.frame.height}`}
          preserveAspectRatio="none"
        >
          {node.paths.map((path, index) => (
            <path key={index} d={path.d} fillRule={path.fillRule} fill={fillColour(node)} />
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div {...common}>
      {childrenOf(node).map((child) => (
        <NodeView
          key={child.id}
          node={child}
          byId={byId}
          assetUrl={assetUrl}
          devMode={devMode}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
          visibleRange={visibleRange}
        />
      ))}
    </div>
  );
}

function fillColour(node: DesignNode): string {
  const solid = node.fills.find((f) => f.type === 'solid');
  return solid && solid.type === 'solid' ? rgba(solid.color) : 'currentColor';
}

/**
 * Fixed elements live outside the scroller so they stay pinned to the device
 * viewport while the page scrolls beneath them.
 */
export function FixedLayer({
  screen,
  adaptation,
  assetUrl,
  devMode,
  selectedNodeId,
  onSelect,
}: Omit<Props, 'visibleRange'>) {
  const byId = useMemo(() => new Map(adaptation.nodes.map((n) => [n.nodeId, n])), [adaptation.nodes]);
  const fixed = childrenOf(screen.root).filter((child) => child.position === 'fixed');
  if (fixed.length === 0) return null;

  return (
    <div className={styles.fixedLayer} data-testid="fixed-layer">
      {fixed.map((node) => (
        <NodeView
          key={node.id}
          node={node}
          byId={byId}
          assetUrl={assetUrl}
          devMode={devMode}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
