import type { ValidationFinding } from '@dae/shared';
import { finding, irNode, measurement, type ValidationContext } from '../context.js';
import type { CheckOutput } from './geometry.js';

export interface AssetResolver {
  /** Returns true when the asset exists in the store and is readable. */
  has(assetId: string): boolean;
}

export function checkMissingAssets(ctx: ValidationContext, resolver?: AssetResolver): CheckOutput {
  const findings: ValidationFinding[] = [];
  if (!resolver) {
    return {
      findings,
      skippedReason: 'No asset store was supplied to the validation run, so asset existence could not be verified.',
      confidence: 0,
    };
  }

  const referenced = new Set(ctx.design.assetsUsed);
  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node) continue;
    if (node.type === 'image') referenced.add(node.assetId);
    for (const fill of node.fills) if (fill.type === 'image') referenced.add(fill.assetId);
  }

  for (const assetId of referenced) {
    if (!resolver.has(assetId)) {
      findings.push(
        finding({
          check: 'missing-assets',
          severity: 'critical',
          title: `Asset ${assetId} is missing`,
          detail: 'The design references an asset that is not present in the asset store, so it cannot render. The source design is unchanged; the asset needs to be re-imported.',
          confidence: 1,
          measurements: [measurement('asset-id', assetId, 'detected')],
        }),
      );
    }
  }

  return { findings, confidence: 1 };
}

/**
 * Fonts bundled with each platform. Anything outside this list is either a
 * webfont the preview must load, or a substitution risk.
 */
const IOS_SYSTEM_FONTS = new Set(
  ['SF Pro', 'SF Pro Text', 'SF Pro Display', 'SF Compact', 'SF Mono', 'New York', 'Helvetica Neue', 'Helvetica', 'Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Menlo', 'Verdana'].map((f) => f.toLowerCase()),
);
const ANDROID_SYSTEM_FONTS = new Set(
  ['Roboto', 'Roboto Condensed', 'Roboto Mono', 'Noto Sans', 'Noto Serif', 'Droid Sans', 'Droid Serif', 'Arial', 'Times New Roman', 'Courier New'].map((f) => f.toLowerCase()),
);

export function checkFontAvailability(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const fonts = ctx.design.fontsUsed;
  if (fonts.length === 0) {
    return {
      findings,
      skippedReason:
        ctx.design.sourceKind === 'raster'
          ? 'The source is a bitmap: type is baked into the artwork, so no font substitution can occur.'
          : 'The design declares no fonts.',
      confidence: ctx.design.sourceKind === 'raster' ? 1 : 0,
    };
  }

  const clientReported = ctx.evidence?.availableFonts
    ? new Set(ctx.evidence.availableFonts.map((f) => f.toLowerCase()))
    : undefined;
  const systemFonts = ctx.device.platform === 'ios' ? IOS_SYSTEM_FONTS : ANDROID_SYSTEM_FONTS;

  for (const font of fonts) {
    const key = font.family.toLowerCase();
    const availableInPreview = clientReported?.has(key);
    const onDevice = systemFonts.has(key);

    if (clientReported && !availableInPreview) {
      findings.push(
        finding({
          check: 'font-availability',
          severity: 'critical',
          title: `"${font.family}" is not available in the preview`,
          detail: `The rendering browser reported that it cannot resolve "${font.family}", so the preview substitutes a fallback. Metrics, and therefore wrapping, will differ from the source. This is a preview limitation, not a change to your design.`,
          confidence: 1,
          measurements: [
            measurement('font-family', font.family, 'detected'),
            measurement('weights', font.weights.join(', '), 'detected'),
            measurement('source', 'client-report', 'detected'),
          ],
        }),
      );
      continue;
    }

    if (!onDevice) {
      findings.push(
        finding({
          check: 'font-availability',
          severity: 'info',
          title: `"${font.family}" is not a ${ctx.device.platform === 'ios' ? 'iOS' : 'Android'} system font`,
          detail: `The design uses "${font.family}", which ${ctx.device.marketingName} does not ship. A real build must bundle or download it; otherwise the platform substitutes ${ctx.device.conventions.systemFont} and text metrics change.`,
          confidence: 0.9,
          measurements: [
            measurement('font-family', font.family, 'detected'),
            measurement('platform-default', ctx.device.conventions.systemFont, 'detected'),
            measurement('source', 'system-font-list', 'inferred'),
          ],
        }),
      );
    }
  }

  return { findings, confidence: clientReported ? 1 : 0.7 };
}
