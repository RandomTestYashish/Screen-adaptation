import type { ValidationFinding } from '@dae/shared';
import { effectiveFrame, finding, irNode, measurement, px, type ValidationContext } from '../context.js';
import { round } from '../../layout/geometry.js';
import type { CheckOutput } from './geometry.js';

/** Horizontal overflow past the viewport, and clipping by a parent that clips. */
export function checkOverflowClipping(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const viewportWidth = ctx.adaptation.plan.targetViewport.width;

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node || !node.visible) continue;
    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;

    const overshootRight = effective.frame.x + effective.frame.width - viewportWidth;
    const overshootLeft = -effective.frame.x;

    if (overshootRight > 1 || overshootLeft > 1) {
      const amount = Math.max(overshootRight, overshootLeft);
      const side = overshootRight > overshootLeft ? 'right' : 'left';
      findings.push(
        finding({
          check: 'overflow-clipping',
          severity: node.type === 'text' || node.interaction ? 'critical' : 'warning',
          title: `"${node.name}" extends ${px(amount)} past the ${side} edge`,
          detail: `On a ${viewportWidth}px viewport this element spans ${px(effective.frame.x)} to ${px(effective.frame.x + effective.frame.width)}. Content outside the viewport is unreachable because a phone page does not scroll horizontally.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: effective.quality === 'detected' ? 0.95 : 0.75,
          autoCorrectable: false,
          measurements: [
            measurement('viewport-width', px(viewportWidth), 'detected'),
            measurement('element-left', px(effective.frame.x), effective.quality),
            measurement('element-right', px(effective.frame.x + effective.frame.width), effective.quality),
          ],
        }),
      );
    }
  }

  // Clipping by an explicitly clipping ancestor.
  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node) continue;
    if (node.type !== 'container' || !node.clipsContent) continue;
    const parentFrame = effectiveFrame(ctx, node.id);
    if (!parentFrame) continue;

    for (const child of node.children) {
      const childFrame = effectiveFrame(ctx, child.id);
      if (!childFrame) continue;
      const bottomOvershoot = childFrame.frame.y + childFrame.frame.height - (parentFrame.frame.y + parentFrame.frame.height);
      const rightOvershoot = childFrame.frame.x + childFrame.frame.width - (parentFrame.frame.x + parentFrame.frame.width);
      if (bottomOvershoot > 1 || rightOvershoot > 1) {
        findings.push(
          finding({
            check: 'overflow-clipping',
            severity: 'warning',
            title: `"${child.name}" is clipped by "${node.name}"`,
            detail: `The parent clips its content, and the child now extends ${px(Math.max(bottomOvershoot, rightOvershoot))} beyond it after adaptation. That part will not be drawn.`,
            nodeId: child.id,
            nodeName: child.name,
            confidence: 0.7,
            measurements: [
              measurement('parent-bounds', `${px(parentFrame.frame.width)}x${px(parentFrame.frame.height)}`, parentFrame.quality),
              measurement('child-overflow', px(Math.max(bottomOvershoot, rightOvershoot)), childFrame.quality),
            ],
          }),
        );
      }
    }
  }

  return { findings, confidence: ctx.evidence?.measuredNodes ? 0.9 : 0.75 };
}

/**
 * Spec section 8: "During validation, inspect the complete scrollable document,
 * not only the initial viewport." A design must never be silently truncated to
 * fit a device frame.
 */
export function checkScrollCompleteness(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const plan = ctx.adaptation.plan;
  const contentBottom = plan.contentBounds.y + plan.contentBounds.height;
  const measured = ctx.evidence?.measuredScrollHeight;

  if (contentBottom > plan.targetScrollHeight + 1) {
    findings.push(
      finding({
        check: 'scroll-completeness',
        severity: 'critical',
        title: 'Content extends past the scrollable extent',
        detail: `Adapted content reaches ${px(contentBottom)} but the scrollable document is only ${px(plan.targetScrollHeight)} tall. The last ${px(contentBottom - plan.targetScrollHeight)} would be unreachable.`,
        confidence: 0.9,
        autoCorrectable: true,
        correctionHint: 'extend-scroll-height',
        measurements: [
          measurement('content-bottom', px(contentBottom), 'inferred'),
          measurement('scroll-height', px(plan.targetScrollHeight), 'inferred'),
        ],
      }),
    );
  }

  const expectedRatio = plan.targetScrollHeight / (plan.sourceFrame.scrollHeight || 1);
  const scaleRatio = plan.strategy === 'uniform-scale' ? plan.scale : 1;
  if (plan.sourceFrame.scrollHeight > 0 && expectedRatio < scaleRatio - 0.02) {
    findings.push(
      finding({
        check: 'scroll-completeness',
        severity: 'critical',
        title: 'The adapted document is shorter than the source',
        detail: `The source scrolls ${px(plan.sourceFrame.scrollHeight)}; after a ${round(scaleRatio, 4)}x adaptation it should scroll at least ${px(plan.sourceFrame.scrollHeight * scaleRatio)}, but the plan produced ${px(plan.targetScrollHeight)}. A long page must never be cropped to fit the device frame.`,
        confidence: 0.95,
        autoCorrectable: true,
        correctionHint: 'extend-scroll-height',
      }),
    );
  }

  if (measured !== undefined) {
    const delta = Math.abs(measured - plan.targetScrollHeight);
    if (delta > Math.max(4, plan.targetScrollHeight * 0.02)) {
      findings.push(
        finding({
          check: 'scroll-completeness',
          severity: 'warning',
          title: 'Rendered scroll height differs from the plan',
          detail: `The live preview measured ${px(measured)} of scrollable content, but the plan predicted ${px(plan.targetScrollHeight)} (${px(delta)} apart). The rendered value is authoritative; the difference usually comes from predicted text wrapping.`,
          confidence: 1,
          measurements: [
            measurement('measured-scroll-height', px(measured), 'detected'),
            measurement('planned-scroll-height', px(plan.targetScrollHeight), 'inferred'),
          ],
        }),
      );
    }
  }

  return {
    findings,
    confidence: measured !== undefined ? 1 : 0.75,
  };
}

export function checkImageCropScale(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  let images = 0;

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (node?.type !== 'image') continue;
    images += 1;
    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;

    const naturalAspect = node.naturalHeight / node.naturalWidth;
    const boxAspect = effective.frame.height / (effective.frame.width || 1);
    const drift = Math.abs(naturalAspect - boxAspect) / (naturalAspect || 1);

    if (node.scaleMode === 'stretch' && drift > 0.01) {
      findings.push(
        finding({
          check: 'image-crop-scale',
          severity: 'critical',
          title: `"${node.name}" would be distorted`,
          detail: `The image's natural aspect ratio is ${round(naturalAspect, 3)} but its box is ${round(boxAspect, 3)}, and its scale mode is "stretch". The artwork would be squashed by ${round(drift * 100, 1)}%.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: 0.9,
          measurements: [
            measurement('natural-size', `${node.naturalWidth}x${node.naturalHeight}`, 'detected'),
            measurement('box-size', `${px(effective.frame.width)}x${px(effective.frame.height)}`, effective.quality),
          ],
        }),
      );
    } else if (node.scaleMode === 'fill' && drift > 0.02) {
      const cropPercent = round(drift * 100, 1);
      findings.push(
        finding({
          check: 'image-crop-scale',
          severity: cropPercent > 15 ? 'warning' : 'info',
          title: `"${node.name}" crops by about ${cropPercent}%`,
          detail: `With scale mode "fill" the artwork keeps its aspect ratio and the box crops the overflow. About ${cropPercent}% of one dimension is cropped compared with the source framing.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: 0.8,
          measurements: [
            measurement('scale-mode', node.scaleMode, 'detected'),
            measurement('crop', `${cropPercent}%`, 'inferred'),
          ],
        }),
      );
    }

    // Under-resolution: a raster upscaled past its physical pixels looks soft.
    const requiredPhysical = effective.frame.width * ctx.device.devicePixelRatio;
    if (node.naturalWidth > 0 && requiredPhysical > node.naturalWidth * 1.15) {
      findings.push(
        finding({
          check: 'image-crop-scale',
          severity: 'warning',
          title: `"${node.name}" is below this device's pixel density`,
          detail: `The box needs ${Math.round(requiredPhysical)} physical pixels of width at DPR ${ctx.device.devicePixelRatio}, but the asset only has ${node.naturalWidth}. It will be upscaled by ${round(requiredPhysical / node.naturalWidth, 2)}x and look soft. Export the asset at a higher scale; the design itself is unchanged.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: 0.9,
          measurements: [
            measurement('device-pixel-ratio', String(ctx.device.devicePixelRatio), 'detected'),
            measurement('required-physical-width', `${Math.round(requiredPhysical)}px`, 'inferred'),
            measurement('asset-width', `${node.naturalWidth}px`, 'detected'),
          ],
        }),
      );
    }
  }

  if (images === 0) {
    return { findings, skippedReason: 'No image nodes in this screen.', confidence: 0 };
  }
  return { findings, confidence: 0.85 };
}
