import {
  findNode,
  type AdaptationResult,
  type AdaptedNode,
  type DesignDocument,
  type DesignNode,
  type DeviceProfile,
  type Rect,
  type RenderEvidence,
  type Screen,
  type SourceDocument,
  type ValidationFinding,
} from '@dae/shared';
import { newId } from '@dae/shared';

export interface ValidationContext {
  design: DesignDocument;
  screen: Screen;
  device: DeviceProfile;
  adaptation: AdaptationResult;
  source: SourceDocument;
  evidence?: RenderEvidence;
  /** Adapted nodes keyed by node id. */
  byId: Map<string, AdaptedNode>;
  /** IR nodes keyed by node id. */
  irById: Map<string, DesignNode>;
  /** The design's own coordinate viewport on the target, excluding chrome. */
  viewport: Rect;
}

export function buildContext(input: Omit<ValidationContext, 'byId' | 'irById' | 'viewport'>): ValidationContext {
  const byId = new Map(input.adaptation.nodes.map((n) => [n.nodeId, n]));
  const irById = new Map<string, DesignNode>();
  const visit = (node: DesignNode) => {
    irById.set(node.id, node);
    if (node.type === 'container' || node.type === 'scroll-container') node.children.forEach(visit);
  };
  visit(input.screen.root);
  if (input.screen.analysisOverlay) visit(input.screen.analysisOverlay);

  const { targetViewport } = input.adaptation.plan;
  return {
    ...input,
    byId,
    irById,
    viewport: { x: 0, y: 0, width: targetViewport.width, height: targetViewport.height },
  };
}

export function finding(
  init: Omit<ValidationFinding, 'id' | 'measurements' | 'autoCorrectable'> &
    Partial<Pick<ValidationFinding, 'measurements' | 'autoCorrectable' | 'correctionHint'>>,
): ValidationFinding {
  return {
    id: newId('finding'),
    measurements: [],
    autoCorrectable: false,
    ...init,
  };
}

/**
 * Measurement value plus its honesty label. Client-measured DOM boxes are
 * `detected`; anything the server predicts is `inferred`.
 */
export function measurement(label: string, value: string, quality: 'detected' | 'inferred' | 'unavailable') {
  return { label, value, quality };
}

export function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** Prefer a real DOM measurement over a predicted one when the client sent it. */
export function effectiveFrame(ctx: ValidationContext, nodeId: string): { frame: Rect; quality: 'detected' | 'inferred' } | undefined {
  const measured = ctx.evidence?.measuredNodes?.[nodeId];
  if (measured) return { frame: measured, quality: 'detected' };
  const adapted = ctx.byId.get(nodeId);
  return adapted ? { frame: adapted.frame, quality: 'inferred' } : undefined;
}

export function irNode(ctx: ValidationContext, nodeId: string): DesignNode | undefined {
  return ctx.irById.get(nodeId) ?? findNode(ctx.screen.root, nodeId);
}
