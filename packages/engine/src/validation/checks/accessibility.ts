import type { Color, DesignNode, ValidationFinding } from '@dae/shared';
import { finding, irNode, measurement, px, type ValidationContext } from '../context.js';
import { round } from '../../layout/geometry.js';
import type { CheckOutput } from './geometry.js';

/** Relative luminance per WCAG 2.1. */
function luminance(color: Color): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(foreground: Color, background: Color): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** Alpha-composite `over` onto `under`. */
function composite(over: Color, under: Color): Color {
  const alpha = over.a;
  return {
    r: over.r * alpha + under.r * (1 - alpha),
    g: over.g * alpha + under.g * (1 - alpha),
    b: over.b * alpha + under.b * (1 - alpha),
    a: 1,
  };
}

/**
 * Resolve the effective background behind a node by compositing the solid
 * fills of its ancestors. Returns undefined when the background is a gradient
 * or image, because a single contrast number would then be misleading.
 */
function resolveBackground(ctx: ValidationContext, node: DesignNode): { color: Color; certain: boolean } | undefined {
  const chain: DesignNode[] = [];
  const findChain = (current: DesignNode, target: string, stack: DesignNode[]): boolean => {
    stack.push(current);
    if (current.id === target) return true;
    if (current.type === 'container' || current.type === 'scroll-container') {
      for (const child of current.children) if (findChain(child, target, stack)) return true;
    }
    stack.pop();
    return false;
  };
  findChain(ctx.screen.root, node.id, chain);

  let background: Color = ctx.screen.background ?? { r: 255, g: 255, b: 255, a: 1 };
  let certain = ctx.screen.background !== undefined;

  for (const ancestor of chain) {
    if (ancestor.id === node.id) break;
    for (const fill of ancestor.fills) {
      if (fill.type === 'solid') {
        background = composite({ ...fill.color, a: fill.color.a * fill.opacity }, background);
        certain = true;
      } else if (fill.type === 'gradient' || fill.type === 'image') {
        return undefined;
      }
    }
  }
  return { color: background, certain };
}

/**
 * Contrast diagnostics "where measurable" (spec section 15). Text over a
 * gradient or photograph is reported as unmeasurable rather than guessed.
 */
export function checkContrast(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  let evaluated = 0;
  let unmeasurable = 0;

  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (node?.type !== 'text' || node.characters.trim() === '') continue;
    const background = resolveBackground(ctx, node);
    if (!background) {
      unmeasurable += 1;
      continue;
    }
    evaluated += 1;

    const foreground = composite(node.typography.color, background.color);
    const ratio = contrastRatio(foreground, background.color);
    // WCAG large text: >= 18.66px at 700 weight, or >= 24px.
    const isLarge =
      node.typography.fontSize >= 24 || (node.typography.fontSize >= 18.66 && node.typography.fontWeight >= 700);
    const threshold = isLarge ? 3 : 4.5;

    if (ratio < threshold) {
      findings.push(
        finding({
          check: 'contrast-accessibility',
          severity: ratio < threshold - 1.5 ? 'warning' : 'info',
          title: `"${node.name}" has ${round(ratio, 2)}:1 contrast`,
          detail: `WCAG AA requires ${threshold}:1 for ${isLarge ? 'large' : 'normal'} text at ${px(node.typography.fontSize)}/${node.typography.fontWeight}. This is a property of the source design, not of the adaptation - it reads the same on every device.`,
          nodeId: node.id,
          nodeName: node.name,
          confidence: background.certain ? 0.9 : 0.6,
          measurements: [
            measurement('contrast-ratio', `${round(ratio, 2)}:1`, background.certain ? 'detected' : 'inferred'),
            measurement('required-ratio', `${threshold}:1`, 'detected'),
            measurement('foreground', rgb(node.typography.color), 'detected'),
            measurement('background', rgb(background.color), background.certain ? 'detected' : 'inferred'),
          ],
        }),
      );
    }
  }

  if (evaluated === 0) {
    return {
      findings,
      skippedReason:
        unmeasurable > 0
          ? `${unmeasurable} text element${unmeasurable === 1 ? ' sits' : 's sit'} on a gradient or image background, where a single contrast ratio would be misleading.`
          : 'No text elements with resolvable colours in this screen.',
      confidence: 0,
    };
  }

  return { findings, confidence: 0.85 };
}

function rgb(color: Color): string {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  return color.a >= 1 ? `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : `rgba(${r}, ${g}, ${b}, ${round(color.a, 2)})`;
}
