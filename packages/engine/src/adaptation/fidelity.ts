import type { AdaptationPlan, DeviceProfile, FidelityScore } from '@dae/shared';

/**
 * How faithfully the device render preserves the design we hold.
 *
 * This is the preservation score expressed as one half of the fidelity pair
 * (spec section 31). It answers only what the *adaptation* did; it says nothing
 * about whether our representation of the upload was right in the first place.
 * That is the source fidelity's job, and merging the two would let a good
 * adaptation of a bad reconstruction report as a good result.
 */
export function adaptationFidelity(plan: AdaptationPlan, device: DeviceProfile): FidelityScore {
  const limitations: string[] = [];

  // Confidence here is confidence in the *claim*, and it is bounded by the
  // quality of the numbers the adaptation was computed against. A device whose
  // safe area is inferred rather than published cannot support a precise claim
  // about clearing that safe area, however clean the transform list looks.
  let confidence = 0.95;
  if (device.overallConfidence === 'medium') confidence = 0.8;
  if (device.overallConfidence === 'low') confidence = 0.6;
  if (device.overallConfidence !== 'high') {
    limitations.push(
      `${device.marketingName}'s geometry is carried at ${device.overallConfidence} confidence, so this score cannot be verified more precisely.`,
    );
  }

  if (plan.sourceSafeAreaBasis === 'assumed-zero') {
    confidence = Math.min(confidence, 0.7);
    limitations.push(
      'The source artboard could not be matched to a known device, so it is assumed to reserve no safe area. If it already reserved one, this score understates how much moved.',
    );
  } else if (plan.sourceSafeAreaBasis === 'width-match') {
    confidence = Math.min(confidence, 0.85);
    limitations.push(
      'The source artboard was matched to a device by width alone, so the safe area it already reserved is inferred rather than known.',
    );
  }

  limitations.push(
    'This score is computed from the transform record, not from a pixel comparison of the two renders. Visual checks that need a rendered bitmap are reported separately.',
  );

  return {
    kind: 'adaptation',
    score: plan.preservation.score,
    question: 'Does the device render preserve the design we hold?',
    confidence: Math.round(confidence * 100) / 100,
    measurementType: 'INFERRED',
    reasons: plan.preservation.reasons,
    limitations,
  };
}
