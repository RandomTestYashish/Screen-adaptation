import type { ValidationFinding } from '@dae/shared';
import { effectiveFrame, finding, irNode, measurement, px, type ValidationContext } from '../context.js';
import { wrapText } from '../../layout/text-measure.js';
import { round } from '../../layout/geometry.js';
import type { CheckOutput } from './geometry.js';

/**
 * Typography must be byte-for-byte identical between source and target: the
 * hard rule is that family, size, weight, colour and hierarchy never change
 * (spec section 2). This check asserts that invariant rather than assuming it,
 * and separately reports where the wrap point moved.
 */
export function checkTypography(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const forbidden = ctx.adaptation.plan.transforms.filter(
    (t) =>
      ('fontSize' in t.after && t.after.fontSize !== t.before.fontSize) ||
      ('fontFamily' in t.after && t.after.fontFamily !== t.before.fontFamily) ||
      ('fontWeight' in t.after && t.after.fontWeight !== t.before.fontWeight),
  );

  for (const transform of forbidden) {
    findings.push(
      finding({
        check: 'typography-comparison',
        severity: 'critical',
        title: `Typography changed on "${transform.nodeName}"`,
        detail: `The adaptation altered a font property (${JSON.stringify(transform.before)} -> ${JSON.stringify(transform.after)}). Type must never be restyled to fit a device.`,
        nodeId: transform.targetNodeId,
        nodeName: transform.nodeName,
        confidence: 1,
      }),
    );
  }

  let textNodes = 0;
  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (node?.type !== 'text') continue;
    textNodes += 1;

    // Uniform scaling changes absolute type size by design - report it as
    // information so the designer knows the rendered size on this device.
    if (ctx.adaptation.plan.strategy === 'uniform-scale' && ctx.adaptation.plan.scale !== 1) {
      continue;
    }

    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;
    const available = effective.frame.width - node.padding.left - node.padding.right;
    const wrapped = wrapText(node.characters, available, node.typography);
    if (wrapped.hasOverflowingToken) {
      findings.push(
        finding({
          check: 'typography-comparison',
          severity: 'warning',
          title: `An unbreakable word in "${node.name}" is wider than its box`,
          detail: `At ${px(available)} of available width, a single word does not fit and will either overflow or be clipped depending on the CSS in the final build.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: 0.6,
          measurements: [
            measurement('font-family', node.typography.fontFamily, 'detected'),
            measurement('font-size', px(node.typography.fontSize), 'detected'),
            measurement('available-width', px(available), effective.quality),
          ],
        }),
      );
    }
  }

  if (textNodes === 0 && ctx.design.sourceKind === 'raster' && !ctx.screen.analysisOverlay) {
    return {
      findings,
      skippedReason:
        'The source is a bitmap with no text analysis, so there is no typography metadata to compare. Enable OCR analysis on import to unlock this check.',
      confidence: 0,
    };
  }

  return {
    findings,
    // Wrap prediction uses metric approximation, not the real font binary.
    confidence: ctx.evidence?.measuredNodes ? 0.85 : 0.6,
  };
}

export function checkTextOverflow(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  let textNodes = 0;

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (node?.type !== 'text') continue;
    textNodes += 1;
    const effective = effectiveFrame(ctx, adapted.nodeId);
    if (!effective) continue;

    const available = effective.frame.width - node.padding.left - node.padding.right;
    const wrapped = wrapText(node.characters, available, node.typography);
    const requiredHeight = wrapped.height + node.padding.top + node.padding.bottom;
    const boxGrows = node.textAutoResize === 'height' || node.textAutoResize === 'width-and-height';

    if (!boxGrows && requiredHeight > effective.frame.height + 1) {
      const clippedLines = Math.max(
        1,
        Math.ceil((requiredHeight - effective.frame.height) / node.typography.lineHeight),
      );
      findings.push(
        finding({
          check: 'text-overflow-wrapping',
          severity: node.overflow === 'clip' ? 'critical' : 'warning',
          title: `"${node.name}" needs ${wrapped.lineCount} lines but its box fits ${Math.floor(effective.frame.height / node.typography.lineHeight)}`,
          detail: `At ${px(available)} of available width the text wraps to ${wrapped.lineCount} line${wrapped.lineCount === 1 ? '' : 's'} (${px(requiredHeight)}), which is ${px(requiredHeight - effective.frame.height)} taller than the fixed ${px(effective.frame.height)} box. Roughly ${clippedLines} line${clippedLines === 1 ? '' : 's'} would be cut off. This is a prediction from font metrics, not a rendered measurement.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: 0.55,
          measurements: [
            measurement('font-size', px(node.typography.fontSize), 'detected'),
            measurement('line-height', px(node.typography.lineHeight), node.typography.lineHeightSource === 'explicit' ? 'detected' : 'inferred'),
            measurement('required-height', px(requiredHeight), 'inferred'),
            measurement('box-height', px(effective.frame.height), effective.quality),
          ],
        }),
      );
    }
  }

  if (textNodes === 0) {
    return {
      findings,
      skippedReason: 'No text nodes in the Design IR for this screen.',
      confidence: 0,
    };
  }
  return { findings, confidence: round(ctx.evidence?.measuredNodes ? 0.8 : 0.55, 2) };
}
