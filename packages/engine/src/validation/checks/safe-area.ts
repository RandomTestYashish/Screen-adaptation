import type { Rect, ValidationFinding } from '@dae/shared';
import { effectiveFrame, finding, irNode, measurement, px, type ValidationContext } from '../context.js';
import { intersection, round } from '../../layout/geometry.js';
import type { CheckOutput } from './geometry.js';

/** Nodes that are allowed to sit under the system UI by design. */
function isFullBleed(anchor: string): boolean {
  return anchor === 'full-bleed';
}

/**
 * Which nodes are worth reporting a collision for.
 *
 * The scroll root legitimately spans the whole screen, and a bare layout group
 * would just duplicate findings from its children. But a bar - a container with
 * its own background, or one that is pinned - is exactly the thing that
 * collides with system UI, so those are included.
 */
function isInspectableContent(ctx: ValidationContext, nodeId: string): boolean {
  const node = irNode(ctx, nodeId);
  if (!node || !node.visible) return false;
  if (node.type === 'scroll-container') return false;
  if (nodeId === ctx.screen.root.id) return false;
  if (node.type === 'container') return node.fills.length > 0 || node.position !== 'flow';
  return true;
}

export function checkSafeAreaCollision(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const { safeArea, assumedSourceSafeArea, targetViewport } = ctx.adaptation.plan;

  // Only the inset the *target* adds beyond what the source already reserves is
  // a new problem. The rest was already the designer's decision and reads the
  // same on the source device.
  const newInset = Math.max(0, safeArea.top - assumedSourceSafeArea.top);
  if (safeArea.top <= 0) return { findings, confidence: 1 };

  const inheritedBand: Rect = { x: 0, y: 0, width: targetViewport.width, height: safeArea.top };
  const newBand: Rect = { x: 0, y: 0, width: targetViewport.width, height: newInset };

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node || !isInspectableContent(ctx, adapted.nodeId)) continue;
    if (isFullBleed(node.safeAreaAnchor)) continue;

    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;
    const overlap = intersection(effective.frame, inheritedBand);
    if (!overlap) continue;

    const clearance = appliedClearance(ctx, node.id, 'safe-area-inset');
    const newOverlap = intersection(effective.frame, newBand);
    const residual = Math.max(0, (newOverlap?.height ?? 0) - clearance);
    const isRasterArtwork = ctx.design.sourceKind === 'raster' && node.type === 'image';

    if (residual <= 0.5) {
      // Nothing new: either the target inset is no larger than the source's, or
      // the plan already added the difference.
      if (isRasterArtwork) {
        findings.push(
          finding({
            check: 'safe-area-collision',
            severity: 'info',
            title: `Artwork runs under the ${px(safeArea.top)} top safe area`,
            detail: `The uploaded bitmap is full-bleed, so its top ${px(overlap.height)} sits beneath the status bar${ctx.device.cutout.kind === 'none' ? '' : ` and ${ctx.device.cutout.kind.replace('-', ' ')}`} — the same as on the source artboard, which already reserves ${px(assumedSourceSafeArea.top)}. Check that no text or control lives in that band. The artwork itself was not modified.`,
            nodeId: node.id,
            nodeName: node.name,
            region: overlap,
            confidence: 0.7,
            measurements: [
              measurement('safe-area-top', px(safeArea.top), 'detected'),
              measurement('source-reserved-top', px(assumedSourceSafeArea.top), 'inferred'),
              measurement('overlap', px(overlap.height), effective.quality),
            ],
          }),
        );
      }
      continue;
    }

    findings.push(
      finding({
        check: 'safe-area-collision',
        severity: isRasterArtwork ? 'warning' : 'warning',
        title: `"${node.name}" loses ${px(residual)} to this device's larger top inset`,
        detail: `${ctx.device.marketingName} reserves ${px(safeArea.top)} at the top, but the source design only accounts for ${px(assumedSourceSafeArea.top)}. That leaves ${px(residual)} of this element newly covered by the status bar${ctx.device.cutout.kind === 'none' ? '' : ` and ${ctx.device.cutout.kind.replace('-', ' ')}`}.${isRasterArtwork ? ' The bitmap cannot be reflowed, so this is reported rather than corrected: the artwork stays exactly as uploaded.' : ''}`,
        nodeId: node.id,
        nodeName: node.name,
        region: newOverlap ?? overlap,
        confidence: effective.quality === 'detected' ? 0.9 : 0.7,
        autoCorrectable: !isRasterArtwork && node.frame.y < 1,
        correctionHint: 'anchor-top-inset',
        measurements: [
          measurement('safe-area-top', px(safeArea.top), 'detected'),
          measurement('source-reserved-top', px(assumedSourceSafeArea.top), 'inferred'),
          measurement('clearance-applied', px(clearance), 'detected'),
          measurement('residual-overlap', px(residual), effective.quality),
        ],
      }),
    );
  }

  return { findings, confidence: ctx.evidence?.measuredNodes ? 0.95 : 0.8 };
}

/** How much clearance the plan already added to this node, in logical px. */
function appliedClearance(ctx: ValidationContext, nodeId: string, type: string): number {
  const transform = ctx.adaptation.plan.transforms.find((t) => t.type === type && t.targetNodeId === nodeId);
  if (!transform) return 0;
  const added = transform.after['addedPaddingBottom'];
  if (typeof added === 'number') return added;
  const before = transform.before['height'];
  const after = transform.after['height'];
  if (typeof before === 'number' && typeof after === 'number') return Math.max(0, after - before);
  return 0;
}

export function checkCutoutCollision(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const { cutout } = ctx.device;
  if (cutout.kind === 'none' || cutout.width === 0) {
    return { findings, confidence: 1 };
  }

  const { targetViewport } = ctx.adaptation.plan;
  const cutoutRect: Rect = {
    x: cutout.kind === 'punch-hole-left' ? 16 : (targetViewport.width - cutout.width) / 2,
    y: cutout.top,
    width: cutout.width,
    height: cutout.height,
  };

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node || !isInspectableContent(ctx, adapted.nodeId)) continue;
    if (isFullBleed(node.safeAreaAnchor)) continue;
    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;
    const overlap = intersection(effective.frame, cutoutRect);
    if (!overlap) continue;

    const carriesContent = node.type === 'text' || node.type === 'vector' || node.interaction?.role !== undefined;
    findings.push(
      finding({
        check: 'cutout-collision',
        severity: carriesContent ? 'critical' : 'warning',
        title: `"${node.name}" sits under the ${cutout.kind.replace('-', ' ')}`,
        detail: `${round((overlap.width * overlap.height) / (effective.frame.width * effective.frame.height || 1) * 100, 1)}% of this element falls inside the ${cutout.width}x${cutout.height}px ${cutout.kind.replace('-', ' ')} at the top of the screen. ${carriesContent ? 'It carries content, so part of it would be permanently hidden.' : 'It is decorative, so this may be acceptable.'}`,
        nodeId: node.id,
        nodeName: node.name,
        region: overlap,
        confidence: effective.quality === 'detected' ? 0.9 : 0.7,
        autoCorrectable: carriesContent && node.frame.y < ctx.device.safeArea.portrait.top,
        correctionHint: 'anchor-top-inset',
        measurements: [
          measurement('cutout', `${cutout.kind} ${cutout.width}x${cutout.height}px`, 'detected'),
          measurement('cutout-top', px(cutout.top), 'detected'),
          measurement('element-bounds', `${px(effective.frame.x)} ${px(effective.frame.y)} ${px(effective.frame.width)} ${px(effective.frame.height)}`, effective.quality),
        ],
      }),
    );
  }

  return { findings, confidence: 0.85 };
}

export function checkBottomNavigationCollision(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const { safeArea, assumedSourceSafeArea, targetViewport, usableViewport } = ctx.adaptation.plan;
  if (safeArea.bottom <= 0) return { findings, confidence: 1 };

  const newInset = Math.max(0, safeArea.bottom - assumedSourceSafeArea.bottom);
  const viewportBottom = Math.min(targetViewport.height, usableViewport.height);
  const band: Rect = {
    x: 0,
    y: viewportBottom - safeArea.bottom,
    width: targetViewport.width,
    height: safeArea.bottom,
  };
  const navLabel = ctx.device.navigation.mode === 'ios-home-indicator' ? 'home indicator' : 'navigation bar';

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node || !isInspectableContent(ctx, adapted.nodeId)) continue;
    if (isFullBleed(node.safeAreaAnchor)) continue;
    // Only pinned elements permanently occupy the bottom band; scrolling
    // content passes through it, which is expected behaviour.
    if (node.position !== 'fixed' && node.position !== 'sticky') continue;

    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;
    const overlap = intersection(effective.frame, band);
    if (!overlap) continue;

    const clearance = appliedClearance(ctx, node.id, 'home-indicator-clearance');
    const residual = Math.max(0, Math.min(newInset, overlap.height) - clearance);
    if (residual <= 0.5) continue;

    findings.push(
      finding({
        check: 'bottom-navigation-collision',
        severity: 'critical',
        title: `Pinned element "${node.name}" loses ${px(residual)} to the ${navLabel}`,
        detail: `${ctx.device.marketingName} reserves ${px(safeArea.bottom)} at the bottom for the ${navLabel}, but the source design only accounts for ${px(assumedSourceSafeArea.bottom)}. This element is pinned to the bottom of the viewport, so ${px(residual)} of it would sit under the ${navLabel} where it is hard or impossible to tap.`,
        nodeId: node.id,
        nodeName: node.name,
        region: overlap,
        confidence: effective.quality === 'detected' ? 0.95 : 0.8,
        autoCorrectable: true,
        correctionHint: 'anchor-bottom-inset',
        measurements: [
          measurement('safe-area-bottom', px(safeArea.bottom), 'detected'),
          measurement('source-reserved-bottom', px(assumedSourceSafeArea.bottom), 'inferred'),
          measurement('navigation-mode', ctx.device.navigation.mode, 'detected'),
          measurement('clearance-applied', px(clearance), 'detected'),
          measurement('residual-overlap', px(residual), effective.quality),
        ],
      }),
    );
  }

  return { findings, confidence: 0.85 };
}
