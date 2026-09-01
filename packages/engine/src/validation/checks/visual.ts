import type { ValidationFinding } from '@dae/shared';
import { finding, measurement, type ValidationContext } from '../context.js';
import { round } from '../../layout/geometry.js';
import type { CheckOutput } from './geometry.js';

export interface VisualComparison {
  /** Fraction of pixels that differ, 0..1. */
  mismatchRatio: number;
  /** Bounding box of the largest differing region, in target logical px. */
  largestDiffRegion?: { x: number; y: number; width: number; height: number };
  comparedWidth: number;
  comparedHeight: number;
  /** Implementation used, recorded for provenance. */
  comparator: string;
}

export interface VisualComparator {
  /**
   * Compare the source artwork against a rendered capture of the target.
   * Returns undefined when either image is unavailable.
   */
  compare(ctx: ValidationContext): Promise<VisualComparison | undefined>;
}

/**
 * Source-vs-target visual comparison.
 *
 * This is the one check that genuinely needs pixels. Rather than claiming a
 * result it cannot support, it reports `skipped` with the exact reason when no
 * rendered capture was supplied - which is the honest state for a live preview
 * that has not been captured yet (spec section 15: never claim "pixel perfect"
 * unless the measurement supports it).
 */
export async function checkVisualComparison(
  ctx: ValidationContext,
  comparator?: VisualComparator,
): Promise<CheckOutput> {
  const findings: ValidationFinding[] = [];

  if (!comparator) {
    return {
      findings,
      skippedReason:
        'No image comparator is configured for this deployment, so a pixel-level source-vs-target comparison could not run. Geometry, typography and layout were compared structurally instead.',
      confidence: 0,
    };
  }

  const result = await comparator.compare(ctx);
  if (!result) {
    return {
      findings,
      skippedReason:
        'No rendered capture of the target was supplied with this validation run, so there was nothing to compare the source against. Capture the preview (Export > viewport render) to enable this check.',
      confidence: 0,
    };
  }

  const percent = round(result.mismatchRatio * 100, 2);
  // A uniform scale legitimately changes every pixel, so the threshold depends
  // on the strategy rather than being a single fixed number.
  const threshold = ctx.adaptation.plan.strategy === 'identity' ? 0.5 : 6;

  if (percent > threshold) {
    findings.push(
      finding({
        check: 'visual-comparison',
        severity: percent > threshold * 3 ? 'critical' : 'warning',
        title: `${percent}% of pixels differ from the source`,
        detail: `Comparing the ${result.comparedWidth}x${result.comparedHeight} rendered target against the source (normalised to the same size) shows ${percent}% differing pixels, above the ${threshold}% expected for a "${ctx.adaptation.plan.strategy}" adaptation. Inspect the highlighted region for unintended change.`,
        region: result.largestDiffRegion,
        confidence: 0.9,
        measurements: [
          measurement('mismatch', `${percent}%`, 'detected'),
          measurement('threshold', `${threshold}%`, 'detected'),
          measurement('comparator', result.comparator, 'detected'),
        ],
      }),
    );
  } else {
    findings.push(
      finding({
        check: 'visual-comparison',
        severity: 'pass',
        title: `Rendered target matches the source within ${percent}% of pixels`,
        detail: `Measured with ${result.comparator} at ${result.comparedWidth}x${result.comparedHeight}. This is a measured comparison, not an estimate.`,
        confidence: 0.95,
        measurements: [measurement('mismatch', `${percent}%`, 'detected')],
      }),
    );
  }

  return { findings, confidence: 0.95 };
}
