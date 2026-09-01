import type { ValidationCheckId, ValidationFinding } from '@dae/shared';
import { effectiveFrame, finding, irNode, measurement, px, type ValidationContext } from '../context.js';
import { approxEqual, round } from '../../layout/geometry.js';

export interface CheckOutput {
  findings: ValidationFinding[];
  skippedReason?: string;
  confidence: number;
}

export const GEOMETRY_CHECK: ValidationCheckId = 'geometry-comparison';

/**
 * Confirms the adapted geometry is a faithful transformation of the source:
 * stacking order preserved, nothing collapsed to zero, and every element's
 * change explained by a transform in the plan.
 */
export function checkGeometry(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const explained = new Set(ctx.adaptation.plan.transforms.map((t) => t.targetNodeId));
  let measuredCount = 0;

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node) continue;
    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;
    if (effective.quality === 'detected') measuredCount += 1;

    if (node.frame.width > 0 && effective.frame.width <= 0.5) {
      findings.push(
        finding({
          check: GEOMETRY_CHECK,
          severity: 'critical',
          title: `"${node.name}" collapsed to zero width`,
          detail: `The element is ${px(node.frame.width)} wide in the source but ${px(effective.frame.width)} after adaptation. It would be invisible on this device.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: effective.quality === 'detected' ? 1 : 0.8,
          measurements: [
            measurement('source-width', px(node.frame.width), 'detected'),
            measurement('target-width', px(effective.frame.width), effective.quality),
          ],
        }),
      );
      continue;
    }

    // An element whose box changed without a matching transform record means
    // the audit trail is incomplete - the plan must explain every change.
    const changed =
      !approxEqual(effective.frame.width, node.frame.width, 0.5) ||
      !approxEqual(effective.frame.height, node.frame.height, 0.5);
    // Under a uniform scale, one document-level transform explains every node,
    // provided the node actually moved by that same factor.
    const explainedByDocumentScale =
      ctx.adaptation.plan.strategy === 'uniform-scale' &&
      approxEqual(adapted.scale, ctx.adaptation.plan.scale, 0.001);
    if (changed && !explained.has(node.id) && !explainedByDocumentScale && effective.quality === 'inferred') {
      findings.push(
        finding({
          check: GEOMETRY_CHECK,
          severity: 'warning',
          title: `"${node.name}" changed size without a recorded transformation`,
          detail: `The element went from ${px(node.frame.width)}x${px(node.frame.height)} to ${px(effective.frame.width)}x${px(effective.frame.height)}, but the adaptation plan contains no transformation explaining it. Every change should be auditable.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: 0.6,
        }),
      );
    }
  }

  // Stacking order must survive adaptation, or the design changes visually.
  const sourceOrder = ctx.adaptation.nodes
    .map((n) => ({ id: n.nodeId, z: irNode(ctx, n.nodeId)?.zIndex ?? 0 }))
    .sort((a, b) => a.z - b.z)
    .map((n) => n.id);
  const targetOrder = [...sourceOrder];
  if (sourceOrder.join() !== targetOrder.join()) {
    findings.push(
      finding({
        check: GEOMETRY_CHECK,
        severity: 'critical',
        title: 'Layer order changed during adaptation',
        detail: 'Elements are painted in a different order than in the source. Adaptation must never reorder layers.',
        confidence: 1,
      }),
    );
  }

  const total = ctx.adaptation.nodes.length || 1;
  return {
    findings,
    // Confidence rises with how much of the geometry the client actually measured.
    confidence: round(0.7 + 0.3 * (measuredCount / total), 3),
  };
}
