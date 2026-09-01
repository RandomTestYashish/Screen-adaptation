import type { DeviceCatalog, EdgeInsets, Size } from '@dae/shared';
import { approxEqual } from '../../layout/geometry.js';

export interface SourceSafeAreaInference {
  insets: EdgeInsets;
  /** How the value was arrived at, surfaced verbatim in the validation panel. */
  basis: 'exact-device-match' | 'width-match' | 'assumed-zero';
  matchedDeviceId?: string;
  confidence: number;
  explanation: string;
}

/**
 * Work out which safe area the *source* design was authored against.
 *
 * This is the difference between a correct adaptation and a double-counted one.
 * A 375x812 artboard almost certainly already reserves ~44px for the status
 * bar. Blindly adding the target's 59px inset would push the design down twice.
 * The engine therefore applies only the *delta* between the source's assumed
 * inset and the target's real inset.
 *
 * The inference is data-driven: the source frame is matched against the device
 * catalog rather than hard-coded (spec section 32).
 */
export function inferSourceSafeArea(catalog: DeviceCatalog, frame: Size): SourceSafeAreaInference {
  const exact = catalog.devices.find(
    (d) =>
      approxEqual(d.viewport.portrait.width, frame.width, 1) &&
      approxEqual(d.viewport.portrait.height, frame.height, 1),
  );
  if (exact) {
    return {
      insets: exact.safeArea.portrait,
      basis: 'exact-device-match',
      matchedDeviceId: exact.id,
      confidence: 0.9,
      explanation: `Source frame ${frame.width}x${frame.height} matches ${exact.marketingName}, so the design is assumed to already reserve its ${exact.safeArea.portrait.top}px top and ${exact.safeArea.portrait.bottom}px bottom safe areas.`,
    };
  }

  const widthMatches = catalog.devices.filter((d) => approxEqual(d.viewport.portrait.width, frame.width, 1));
  if (widthMatches.length > 0) {
    // Prefer the most conservative (smallest) top inset among the matches so we
    // never over-subtract and clip the design.
    const chosen = widthMatches.reduce((min, d) =>
      d.safeArea.portrait.top < min.safeArea.portrait.top ? d : min,
    );
    return {
      insets: chosen.safeArea.portrait,
      basis: 'width-match',
      matchedDeviceId: chosen.id,
      confidence: 0.6,
      explanation: `No device in the catalog has a ${frame.width}x${frame.height} viewport. Matched on width only (${chosen.marketingName}); the assumed source safe area is the smallest among the ${widthMatches.length} devices of that width.`,
    };
  }

  return {
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    basis: 'assumed-zero',
    confidence: 0.3,
    explanation: `Source frame ${frame.width}x${frame.height} matches no catalogued device. Assuming the design reserves no safe area, so the full target inset is applied. Verify anchored elements in the preview.`,
  };
}
