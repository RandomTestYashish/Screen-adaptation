import {
  VALIDATION_ENGINE_VERSION,
  childrenOf,
  newId,
  type AdaptationResult,
  type CheckResult,
  type DesignDocument,
  type DesignNode,
  type DeviceCatalog,
  type DeviceProfile,
  type MetadataRow,
  type RenderEvidence,
  type Screen,
  type SourceDocument,
  type ValidationCheckId,
  type ValidationFinding,
  type ValidationPass,
  type ValidationReport,
} from '@dae/shared';
import { planAdaptation } from '../adaptation/planner.js';
import { buildContext, type ValidationContext } from './context.js';
import { checkGeometry, type CheckOutput } from './checks/geometry.js';
import { checkBottomNavigationCollision, checkCutoutCollision, checkSafeAreaCollision } from './checks/safe-area.js';
import { checkTextOverflow, checkTypography } from './checks/typography.js';
import { checkImageCropScale, checkOverflowClipping, checkScrollCompleteness } from './checks/overflow.js';
import { checkFontAvailability, checkMissingAssets, type AssetResolver } from './checks/assets.js';
import { checkContrast } from './checks/accessibility.js';
import { checkDeviceProfileIntegrity } from './checks/device-profile.js';
import { checkVisualComparison, type VisualComparator } from './checks/visual.js';
import { round } from '../layout/geometry.js';
import { buildMetadataRows } from './metadata.js';

export interface ValidationInput {
  design: DesignDocument;
  screen: Screen;
  device: DeviceProfile;
  catalog: DeviceCatalog;
  source: SourceDocument;
  adaptation: AdaptationResult;
  projectId: string;
  evidence?: RenderEvidence;
  assetResolver?: AssetResolver;
  visualComparator?: VisualComparator;
}

export interface ValidationOutcome {
  report: ValidationReport;
  /** The plan after correction; identical to the input plan when nothing changed. */
  adaptation: AdaptationResult;
}

const CHECK_ORDER: ValidationCheckId[] = [
  'visual-comparison',
  'geometry-comparison',
  'typography-comparison',
  'overflow-clipping',
  'safe-area-collision',
  'cutout-collision',
  'bottom-navigation-collision',
  'scroll-completeness',
  'text-overflow-wrapping',
  'image-crop-scale',
  'missing-assets',
  'font-availability',
  'contrast-accessibility',
  'device-profile-integrity',
];

async function runAllChecks(ctx: ValidationContext, input: ValidationInput): Promise<CheckResult[]> {
  const runners: Record<ValidationCheckId, () => CheckOutput | Promise<CheckOutput>> = {
    'visual-comparison': () => checkVisualComparison(ctx, input.visualComparator),
    'geometry-comparison': () => checkGeometry(ctx),
    'typography-comparison': () => checkTypography(ctx),
    'overflow-clipping': () => checkOverflowClipping(ctx),
    'safe-area-collision': () => checkSafeAreaCollision(ctx),
    'cutout-collision': () => checkCutoutCollision(ctx),
    'bottom-navigation-collision': () => checkBottomNavigationCollision(ctx),
    'scroll-completeness': () => checkScrollCompleteness(ctx),
    'text-overflow-wrapping': () => checkTextOverflow(ctx),
    'image-crop-scale': () => checkImageCropScale(ctx),
    'missing-assets': () => checkMissingAssets(ctx, input.assetResolver),
    'font-availability': () => checkFontAvailability(ctx),
    'contrast-accessibility': () => checkContrast(ctx),
    'device-profile-integrity': () => checkDeviceProfileIntegrity(ctx),
  };

  const results: CheckResult[] = [];
  for (const check of CHECK_ORDER) {
    const started = performance.now();
    const output = await runners[check]();
    const durationMs = round(performance.now() - started, 3);
    const hasCritical = output.findings.some((f) => f.severity === 'critical');
    const hasWarning = output.findings.some((f) => f.severity === 'warning');
    results.push({
      check,
      status: output.skippedReason ? 'skipped' : hasCritical ? 'fail' : hasWarning ? 'warn' : 'pass',
      ...(output.skippedReason ? { skippedReason: output.skippedReason } : {}),
      durationMs,
      findings: output.findings,
      confidence: output.confidence,
    });
  }
  return results;
}

/**
 * Corrections the engine is allowed to make on its own.
 *
 * These are *technical adaptation errors only* - an element colliding with
 * system UI, or a scroll extent that would hide content. The engine never
 * changes colour, type, hierarchy or content to satisfy a check
 * (spec section 15: "correct only technical adaptation errors").
 */
export interface Correction {
  findingId: string;
  nodeId?: string;
  kind: 'anchor-top-inset' | 'anchor-bottom-inset' | 'extend-scroll-height';
  description: string;
}

export function collectCorrections(results: CheckResult[]): Correction[] {
  const corrections: Correction[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    for (const found of result.findings) {
      if (!found.autoCorrectable || !found.correctionHint) continue;
      const key = `${found.correctionHint}:${found.nodeId ?? 'document'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      corrections.push({
        findingId: found.id,
        ...(found.nodeId ? { nodeId: found.nodeId } : {}),
        kind: found.correctionHint as Correction['kind'],
        description: describeCorrection(found),
      });
    }
  }
  return corrections;
}

function describeCorrection(found: ValidationFinding): string {
  switch (found.correctionHint) {
    case 'anchor-top-inset':
      return `Anchored "${found.nodeName ?? 'element'}" to the top safe area so it clears the status bar and cutout.`;
    case 'anchor-bottom-inset':
      return `Anchored "${found.nodeName ?? 'element'}" to the bottom safe area so it clears the home indicator or navigation bar.`;
    case 'extend-scroll-height':
      return 'Extended the scrollable extent so no content is unreachable.';
    default:
      return 'Applied a technical adaptation correction.';
  }
}

/**
 * Apply corrections by annotating the Design IR's safe-area relationships and
 * re-planning. The IR's *visual* properties are never touched: only the
 * anchoring metadata that tells the planner how an element relates to the
 * device's system UI.
 */
function applyCorrections(screen: Screen, corrections: Correction[]): boolean {
  let changed = false;
  const byId = new Map<string, DesignNode>();
  const index = (node: DesignNode) => {
    byId.set(node.id, node);
    for (const child of childrenOf(node)) index(child);
  };
  index(screen.root);

  for (const correction of corrections) {
    if (correction.kind === 'extend-scroll-height') continue; // handled by the planner
    const node = correction.nodeId ? byId.get(correction.nodeId) : undefined;
    if (!node) continue;
    const anchor = correction.kind === 'anchor-top-inset' ? 'top-inset' : 'bottom-inset';
    if (node.safeAreaAnchor !== anchor) {
      node.safeAreaAnchor = anchor;
      if (anchor === 'bottom-inset' && node.position === 'flow') node.position = 'fixed';
      changed = true;
    }
  }
  return changed;
}

/**
 * Run validation, apply technical corrections, re-render, and validate again.
 *
 * The second pass is mandatory (spec section 15). When nothing was correctable
 * the second pass still runs against the final artefact, so the report always
 * documents a verified end state rather than an assumed one.
 */
export async function runValidation(input: ValidationInput): Promise<ValidationOutcome> {
  const passes: ValidationPass[] = [];
  let adaptation = input.adaptation;
  let screen = input.screen;

  // --- Pass 1 -------------------------------------------------------------
  const firstStart = performance.now();
  const firstCtx = buildContext({
    design: input.design,
    screen,
    device: input.device,
    adaptation,
    source: input.source,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  });
  const firstResults = await runAllChecks(firstCtx, input);
  const corrections = collectCorrections(firstResults);

  passes.push({
    pass: 1,
    planRevision: adaptation.plan.revision,
    startedAt: new Date().toISOString(),
    durationMs: round(performance.now() - firstStart, 3),
    results: firstResults,
    correctionsApplied: corrections.map((c) => c.description),
  });

  // --- Correction + re-render --------------------------------------------
  if (corrections.length > 0) {
    const correctedScreen: Screen = structuredClone(screen);
    const anchorChanged = applyCorrections(correctedScreen, corrections);
    const needsExtend = corrections.some((c) => c.kind === 'extend-scroll-height');

    if (anchorChanged || needsExtend) {
      screen = correctedScreen;
      const replanned = planAdaptation({
        design: input.design,
        screen,
        device: input.device,
        catalog: input.catalog,
        projectId: input.projectId,
        options: adaptation.plan.options,
      });
      adaptation = {
        plan: {
          ...replanned.plan,
          id: adaptation.plan.id,
          cacheKey: adaptation.plan.cacheKey,
          revision: adaptation.plan.revision + 1,
          transforms: replanned.plan.transforms.map((t) => ({ ...t, fromCorrectionPass: true })),
        },
        nodes: replanned.nodes,
      };
    }
  }

  // --- Pass 2 (mandatory) -------------------------------------------------
  const secondStart = performance.now();
  const secondCtx = buildContext({
    design: input.design,
    screen,
    device: input.device,
    adaptation,
    source: input.source,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  });
  const secondResults = await runAllChecks(secondCtx, input);
  passes.push({
    pass: 2,
    planRevision: adaptation.plan.revision,
    startedAt: new Date().toISOString(),
    durationMs: round(performance.now() - secondStart, 3),
    results: secondResults,
    correctionsApplied: [],
  });

  const finalFindings = secondResults.flatMap((r) => r.findings);
  const criticalCount = finalFindings.filter((f) => f.severity === 'critical').length;
  const warningCount = finalFindings.filter((f) => f.severity === 'warning').length;

  const skipped = secondResults.filter((r) => r.status === 'skipped');
  const limitations = skipped.map((r) => `${r.check}: ${r.skippedReason}`);
  if (input.device.overallConfidence !== 'high') {
    limitations.push(
      `Device geometry for ${input.device.marketingName} is carried at ${input.device.overallConfidence} confidence, so results are directionally correct rather than exact.`,
    );
  }
  limitations.push(
    'This is a device-aware browser preview built from documented device parameters. It is not a physical device and does not reproduce OEM font rendering, GPU compositing or browser-specific layout quirks.',
  );

  const ranCount = secondResults.length - skipped.length;
  const confidence =
    ranCount === 0
      ? 0
      : round(
          secondResults.filter((r) => r.status !== 'skipped').reduce((sum, r) => sum + r.confidence, 0) /
            secondResults.length,
          3,
        );

  const report: ValidationReport = {
    id: newId('validation'),
    projectId: input.projectId,
    adaptationPlanId: adaptation.plan.id,
    sourceId: input.design.sourceId,
    sourceHash: input.design.sourceHash,
    deviceId: input.device.id,
    engineVersion: VALIDATION_ENGINE_VERSION,
    deviceCatalogVersion: input.device.catalogVersion,
    createdAt: new Date().toISOString(),
    passes,
    status: criticalCount > 0 ? 'fail' : warningCount > 0 ? 'pass-with-warnings' : 'pass',
    criticalCount,
    warningCount,
    preservationScore: adaptation.plan.preservation.score,
    confidence,
    metadata: buildMetadataRows(secondCtx),
    limitations,
  };

  return { report, adaptation };
}

export type { MetadataRow };
