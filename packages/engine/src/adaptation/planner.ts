import {
  ADAPTATION_ENGINE_VERSION,
  AdaptationOptionsSchema,
  type adaptationCacheKey,
  childrenOf,
  newId,
  safeAreaFor,
  viewportFor,
  type AdaptationOptions,
  type AdaptationPlan,
  type AdaptationResult,
  type AdaptationStrategy,
  type AdaptedNode,
  type DesignDocument,
  type DesignNode,
  type DeviceCatalog,
  type DeviceProfile,
  type EdgeInsets,
  type PreservationScore,
  type Rect,
  type Screen,
  type TransformImpact,
  type TransformRecord,
  type TransformType,
} from '@dae/shared';
import { approxEqual, round } from '../layout/geometry.js';
import { wrapText } from '../layout/text-measure.js';
import { inferSourceSafeArea, type SourceSafeAreaInference } from './rules/source-safe-area.js';
import { classifyWidthBehaviour, resolveHorizontal, resolveVertical } from './rules/constraints.js';

export interface PlanInput {
  design: DesignDocument;
  screen: Screen;
  device: DeviceProfile;
  catalog: DeviceCatalog;
  projectId: string;
  options?: Partial<AdaptationOptions>;
}

interface Ctx {
  transforms: TransformRecord[];
  nodes: AdaptedNode[];
  device: DeviceProfile;
  safeArea: EdgeInsets;
  sourceSafeArea: SourceSafeAreaInference;
  topDelta: number;
  bottomDelta: number;
  options: AdaptationOptions;
  revision: number;
  /** Target viewport, needed to re-pin viewport-anchored (fixed) elements. */
  viewportHeight: number;
  usableHeight: number;
  sourceFrameHeight: number;
}

function record(
  ctx: Ctx,
  type: TransformType,
  node: DesignNode,
  before: TransformRecord['before'],
  after: TransformRecord['after'],
  reason: string,
  confidence: number,
  impact: TransformImpact,
): void {
  ctx.transforms.push({
    id: newId('tx'),
    type,
    sourceNodeId: node.provenance.sourceNodeId ?? node.id,
    targetNodeId: node.id,
    nodeName: node.name,
    before,
    after,
    reason,
    confidence,
    impact,
    fromCorrectionPass: ctx.revision > 0,
  });
}

/**
 * Decide the least invasive strategy that can make the source render correctly
 * on the target (spec section 7: "Default behavior is preservation-first").
 */
export function chooseStrategy(
  design: DesignDocument,
  screen: Screen,
  targetWidth: number,
  options: AdaptationOptions,
): { strategy: AdaptationStrategy; reason: string } {
  if (approxEqual(screen.frame.width, targetWidth, 0.5)) {
    return {
      strategy: 'identity',
      reason: `Target viewport is ${targetWidth}px wide, identical to the source frame. No scaling or reflow is required; only device chrome is layered on top.`,
    };
  }

  /*
   * The decision is about *structure*, not source format.
   *
   * A reconstructed bitmap reflows exactly like a Figma import: type keeps its
   * measured size, spacing keeps its measured value, and the width difference
   * is absorbed by each element's own constraint. Scaling it instead would
   * shrink the whole design to fit, which is the behaviour this engine exists
   * to avoid (spec sections 1, 10 and 11).
   */
  const hasStructure = design.structure === 'figma' || design.structure === 'reconstructed';

  if (!hasStructure) {
    return {
      strategy: 'uniform-scale',
      reason: `The source is a bitmap with no reconstructed structure, so there is nothing to reflow. The whole document is scaled proportionally by ${round(targetWidth / screen.frame.width, 4)} to fit ${targetWidth}px. Every proportion is preserved and nothing is cropped, but the design's absolute type size changes with it.`,
    };
  }

  if (!options.allowStructuralReflow) {
    return {
      strategy: 'uniform-scale',
      reason: 'Structural reflow is disabled for this adaptation, so the design is scaled proportionally instead.',
    };
  }

  const widthDelta = round(targetWidth - screen.frame.width, 1);
  return {
    strategy: 'structural-reflow',
    reason:
      design.structure === 'reconstructed'
        ? `The bitmap was reconstructed into components, so the design keeps its measured type sizes and spacing and the ${widthDelta}px width difference is absorbed by each element's own constraint. The document keeps its full height; how much of it is visible is decided by the device's viewport, not by scaling the design down to fit.`
        : `The source carries real structure (constraints and Auto Layout), so the design keeps its original type sizes and spacing and the ${widthDelta}px width difference is absorbed by the source's own layout rules.`,
  };
}

/** Usable viewport after optional keyboard and browser chrome. */
export function usableViewport(device: DeviceProfile, options: AdaptationOptions) {
  const viewport = viewportFor(device, options.orientation);
  let height = viewport.height;
  const notes: string[] = [];
  if (options.simulateBrowserChrome) {
    height -= device.browser.defaultBrowserChromeTop + device.browser.defaultBrowserChromeBottom;
    notes.push('mobile browser chrome');
  }
  if (options.keyboardVisible && device.keyboard.supported) {
    height -= device.keyboard.height + device.keyboard.accessoryHeight;
    notes.push('software keyboard');
  }
  return { width: viewport.width, height: Math.max(1, round(height, 2)), notes };
}

export function planAdaptation(input: PlanInput): AdaptationResult & { cacheKeyInput: Parameters<typeof adaptationCacheKey>[0] } {
  const options = AdaptationOptionsSchema.parse({ ...(input.options ?? {}) });
  const { design, screen, device, catalog } = input;

  const viewport = viewportFor(device, options.orientation);
  const usable = usableViewport(device, options);
  const safeArea = safeAreaFor(device, options.orientation);
  const sourceSafeArea = inferSourceSafeArea(catalog, screen.frame);

  const { strategy, reason: strategyReason } = chooseStrategy(design, screen, viewport.width, options);
  const scale = strategy === 'uniform-scale' ? viewport.width / screen.frame.width : 1;

  const topDelta = options.applySafeArea ? Math.max(0, safeArea.top - sourceSafeArea.insets.top) : 0;
  const bottomDelta = options.applySafeArea ? Math.max(0, safeArea.bottom - sourceSafeArea.insets.bottom) : 0;

  const ctx: Ctx = {
    transforms: [],
    nodes: [],
    device,
    safeArea,
    sourceSafeArea,
    topDelta,
    bottomDelta,
    options,
    revision: 0,
    viewportHeight: viewport.height,
    usableHeight: usable.height,
    sourceFrameHeight: screen.frame.height,
  };

  // The chrome layer is always recorded, so the audit trail shows that the
  // status bar / cutout / home indicator were drawn *over* the design rather
  // than composited into it (spec section 2).
  ctx.transforms.push({
    id: newId('tx'),
    type: 'chrome-overlay',
    sourceNodeId: screen.root.id,
    targetNodeId: screen.root.id,
    nodeName: 'Device chrome',
    before: { statusBar: null, cutout: null, homeIndicator: null },
    after: {
      statusBarHeight: device.statusBar.height,
      cutout: device.cutout.kind,
      navigationMode: device.navigation.mode,
    },
    reason:
      'Status bar, cutout and navigation indicator are rendered in a separate layer above the design. The design pixels are untouched by this.',
    confidence: 1,
    impact: 'chrome-only',
    fromCorrectionPass: false,
  });

  const adaptedRoot =
    strategy === 'uniform-scale'
      ? adaptByScale(screen.root, scale, ctx, screen)
      : adaptByStructure(screen.root, ctx, screen, viewport.width);

  applySafeAreaAnchors(screen.root, ctx);

  const contentBounds = boundsOf(ctx.nodes);
  const rawScrollHeight =
    strategy === 'uniform-scale' ? screen.scrollHeight * scale : Math.max(screen.scrollHeight, contentBounds.y + contentBounds.height);

  // Content that would otherwise sit under the home indicator needs the page to
  // be scrollable a little further, or the last row is permanently obscured.
  const needsBottomClearance =
    options.applySafeArea &&
    safeArea.bottom > 0 &&
    !hasFixedBottomBar(screen.root) &&
    rawScrollHeight > usable.height - safeArea.bottom;
  const targetScrollHeight = round(rawScrollHeight + (needsBottomClearance ? safeArea.bottom : 0), 2);

  if (needsBottomClearance) {
    ctx.transforms.push({
      id: newId('tx'),
      type: 'scroll-extent-adjust',
      sourceNodeId: screen.root.id,
      targetNodeId: screen.root.id,
      nodeName: screen.root.name,
      before: { scrollHeight: round(rawScrollHeight, 2) },
      after: { scrollHeight: targetScrollHeight },
      reason: `Extended the scrollable extent by the ${safeArea.bottom}px bottom inset so the final row of content can scroll clear of the ${device.navigation.mode === 'ios-home-indicator' ? 'home indicator' : 'navigation bar'}. No design pixels moved.`,
      confidence: 0.95,
      impact: 'layout',
      fromCorrectionPass: ctx.revision > 0,
    });
  } else if (!approxEqual(rawScrollHeight, screen.scrollHeight, 0.5)) {
    ctx.transforms.push({
      id: newId('tx'),
      type: 'scroll-extent-adjust',
      sourceNodeId: screen.root.id,
      targetNodeId: screen.root.id,
      nodeName: screen.root.name,
      before: { scrollHeight: screen.scrollHeight },
      after: { scrollHeight: targetScrollHeight },
      reason: `Scrollable extent follows the ${strategy === 'uniform-scale' ? `${round(scale, 4)}x uniform scale` : 'reflowed content height'}. The full document remains scrollable; nothing is cropped.`,
      confidence: 1,
      impact: 'layout',
      fromCorrectionPass: ctx.revision > 0,
    });
  }

  const preservation = scorePreservation(ctx, strategy, device);

  const cacheKeyInput = {
    sourceHash: design.sourceHash,
    deviceId: device.id,
    deviceCatalogVersion: device.catalogVersion,
    engineVersion: ADAPTATION_ENGINE_VERSION,
    options,
  };

  const plan: AdaptationPlan = {
    id: newId('plan'),
    cacheKey: '',
    projectId: input.projectId,
    sourceId: design.sourceId,
    sourceHash: design.sourceHash,
    designDocumentId: design.id,
    screenId: screen.id,
    deviceId: device.id,
    deviceCatalogVersion: device.catalogVersion,
    engineVersion: ADAPTATION_ENGINE_VERSION,
    options,
    strategy,
    strategyReason: `${strategyReason} ${sourceSafeArea.explanation}`,
    sourceFrame: { width: screen.frame.width, height: screen.frame.height, scrollHeight: screen.scrollHeight },
    targetViewport: { width: viewport.width, height: viewport.height },
    usableViewport: { width: usable.width, height: usable.height },
    safeArea,
    assumedSourceSafeArea: sourceSafeArea.insets,
    sourceSafeAreaBasis: sourceSafeArea.basis,
    sourceSafeAreaConfidence: sourceSafeArea.confidence,
    scale: round(scale, 6),
    contentBounds,
    targetScrollHeight,
    transforms: ctx.transforms,
    preservation,
    createdAt: new Date().toISOString(),
    revision: 0,
  };

  void adaptedRoot;
  return { plan, nodes: ctx.nodes, cacheKeyInput };
}

// --- Strategy: uniform scale -----------------------------------------------

/**
 * Scale every node by the same factor. This is the only correct adaptation for
 * an immutable bitmap: proportions, type sizes and spacing all stay in the same
 * relationship, and nothing is cropped (spec section 7).
 */
function adaptByScale(node: DesignNode, scale: number, ctx: Ctx, screen: Screen, parentScaled = true): Rect {
  const frame: Rect = {
    x: round(node.frame.x * scale, 3),
    y: round(node.frame.y * scale, 3),
    width: round(node.frame.width * scale, 3),
    height: round(node.frame.height * scale, 3),
  };

  ctx.nodes.push({
    nodeId: node.id,
    sourceNodeId: node.provenance.sourceNodeId ?? node.id,
    frame,
    scale,
    clipped: false,
    position: node.position,
  });

  if (parentScaled && node.id === screen.root.id) {
    if (approxEqual(scale, 1, 1e-6)) {
      record(ctx, 'preserved', node, { width: node.frame.width }, { width: frame.width }, 'Source width already matches the target viewport; the document was not scaled.', 1, 'none');
    } else {
      record(
        ctx,
        'uniform-scale',
        node,
        { width: node.frame.width, height: node.frame.height, scrollHeight: screen.scrollHeight },
        { width: frame.width, height: frame.height, scrollHeight: round(screen.scrollHeight * scale, 2), scale: round(scale, 4) },
        `Whole document scaled by ${round(scale, 4)} (${screen.frame.width}px source -> ${round(frame.width, 1)}px target). Every proportion, type size and spacing keeps its original relationship; nothing is cropped or redrawn.`,
        1,
        scale === 1 ? 'none' : 'pixels',
      );
    }
  }

  for (const child of childrenOf(node)) adaptByScale(child, scale, ctx, screen, false);
  return frame;
}

// --- Strategy: structural reflow --------------------------------------------

function adaptByStructure(root: DesignNode, ctx: Ctx, screen: Screen, targetWidth: number): Rect {
  const rootFrame: Rect = { x: 0, y: 0, width: targetWidth, height: screen.frame.height };
  ctx.nodes.push({
    nodeId: root.id,
    sourceNodeId: root.provenance.sourceNodeId ?? root.id,
    frame: rootFrame,
    scale: 1,
    clipped: false,
    position: root.position,
  });

  if (!approxEqual(targetWidth, screen.frame.width, 0.5)) {
    record(
      ctx,
      'preserved',
      root,
      { width: screen.frame.width },
      { width: targetWidth },
      `Document width follows the target viewport. Type sizes, weights, colours and spacing are unchanged: only the available width differs, and each element reflows using the constraint it was authored with.`,
      1,
      'layout',
    );
  }

  reflowChildren(root, rootFrame, { width: screen.frame.width, height: screen.frame.height }, ctx);
  return rootFrame;
}

function reflowChildren(
  parent: DesignNode,
  adaptedParentFrame: Rect,
  originalParentSize: { width: number; height: number },
  ctx: Ctx,
): void {
  const children = childrenOf(parent);
  if (children.length === 0) return;

  if (parent.autoLayout && parent.autoLayout.direction !== 'wrap') {
    reflowAutoLayout(parent, adaptedParentFrame, originalParentSize, ctx);
    return;
  }

  for (const child of children) {
    const relative: Rect = {
      x: child.frame.x - parent.frame.x,
      y: child.frame.y - parent.frame.y,
      width: child.frame.width,
      height: child.frame.height,
    };
    // A viewport-anchored element is positioned against the *device viewport*,
    // not the document: a bottom bar pinned to a 812px artboard must re-pin to
    // the bottom of an 874px screen, not stay 812px down the page.
    const viewportAnchored = child.position === 'fixed';
    const verticalParent = viewportAnchored
      ? { width: adaptedParentFrame.width, height: ctx.usableHeight }
      : adaptedParentFrame;
    const verticalOriginal = viewportAnchored
      ? { width: originalParentSize.width, height: ctx.sourceFrameHeight }
      : originalParentSize;

    const h = resolveHorizontal(
      { child: relative, originalParent: originalParentSize, adaptedParent: adaptedParentFrame },
      child.constraints,
    );
    const v = resolveVertical(
      { child: relative, originalParent: verticalOriginal, adaptedParent: verticalParent },
      child.constraints,
    );

    if (viewportAnchored && !approxEqual(v.offset, relative.y, 0.5)) {
      record(
        ctx,
        'fixed-width-reanchor',
        child,
        { y: round(relative.y, 2), viewportHeight: ctx.sourceFrameHeight },
        { y: round(v.offset, 2), viewportHeight: ctx.usableHeight },
        `Element is pinned to the viewport, so it re-anchors to the bottom of this device's ${round(ctx.usableHeight, 0)}px screen instead of staying ${round(relative.y, 0)}px down the page. Its size and styling are unchanged.`,
        0.9,
        'layout',
      );
    }

    const frame: Rect = {
      x: round(adaptedParentFrame.x + h.offset, 3),
      y: round(viewportAnchored ? v.offset : adaptedParentFrame.y + v.offset, 3),
      width: round(h.size, 3),
      height: round(v.size, 3),
    };

    describeHorizontal(child, relative, frame, adaptedParentFrame, originalParentSize, h.behaviour, ctx);
    const adapted = finishNode(child, frame, ctx);
    reflowChildren(child, adapted, { width: child.frame.width, height: child.frame.height }, ctx);
  }
}

/**
 * Recompute an Auto Layout container: gaps and padding are preserved exactly,
 * children are re-stacked, and hug-sized containers grow to fit.
 */
function reflowAutoLayout(
  parent: DesignNode,
  adaptedParentFrame: Rect,
  originalParentSize: { width: number; height: number },
  ctx: Ctx,
): void {
  const layout = parent.autoLayout!;
  const children = childrenOf(parent);
  const horizontal = layout.direction === 'horizontal';
  const inner = {
    x: adaptedParentFrame.x + layout.padding.left,
    y: adaptedParentFrame.y + layout.padding.top,
    width: Math.max(0, adaptedParentFrame.width - layout.padding.left - layout.padding.right),
    height: Math.max(0, adaptedParentFrame.height - layout.padding.top - layout.padding.bottom),
  };

  let cursor = horizontal ? inner.x : inner.y;
  for (const child of children) {
    const stretchCounter = layout.counterAxisAlign === 'stretch' || child.constraints.horizontal === 'left-right';
    const width = horizontal
      ? child.frame.width
      : stretchCounter
        ? inner.width
        : child.frame.width;
    const height = horizontal && stretchCounter ? inner.height : child.frame.height;

    const frame: Rect = {
      x: round(horizontal ? cursor : alignCounter(inner.x, inner.width, width, layout.counterAxisAlign), 3),
      y: round(horizontal ? alignCounter(inner.y, inner.height, height, layout.counterAxisAlign) : cursor, 3),
      width: round(width, 3),
      height: round(height, 3),
    };

    if (!approxEqual(width, child.frame.width, 0.5)) {
      record(
        ctx,
        'autolayout-reflow',
        child,
        { width: child.frame.width, gap: layout.gap },
        { width: frame.width, gap: layout.gap },
        `Auto Layout child re-stacked in its ${layout.direction} container. The ${layout.gap}px gap and ${layout.padding.left}/${layout.padding.right}px padding are unchanged; only the available width differs.`,
        0.95,
        'layout',
      );
    }

    finishNode(child, frame, ctx);
    reflowChildren(child, frame, { width: child.frame.width, height: child.frame.height }, ctx);
    cursor += (horizontal ? frame.width : frame.height) + layout.gap;
  }
  void originalParentSize;
}

function alignCounter(start: number, available: number, size: number, align: string): number {
  if (align === 'center') return start + (available - size) / 2;
  if (align === 'end') return start + available - size;
  return start;
}

function describeHorizontal(
  child: DesignNode,
  relative: Rect,
  frame: Rect,
  adaptedParentFrame: Rect,
  originalParentSize: { width: number; height: number },
  behaviour: string,
  ctx: Ctx,
): void {
  const widthChanged = !approxEqual(frame.width, child.frame.width, 0.5);
  const movedX = !approxEqual(frame.x - adaptedParentFrame.x, relative.x, 0.5);
  if (!widthChanged && !movedX) {
    record(ctx, 'preserved', child, { x: relative.x, width: child.frame.width }, { x: round(frame.x - adaptedParentFrame.x, 2), width: frame.width }, 'Element position and size are unchanged on this device.', 1, 'none');
    return;
  }

  const shape = classifyWidthBehaviour(relative, originalParentSize.width);

  if (behaviour === 'stretched' || (shape.isFullWidth && widthChanged)) {
    record(
      ctx,
      'full-width-stretch',
      child,
      { width: child.frame.width, leftGap: round(shape.leftGap, 2), rightGap: round(shape.rightGap, 2) },
      { width: frame.width, leftGap: round(shape.leftGap, 2), rightGap: round(shape.rightGap, 2) },
      `Element was authored edge-to-edge (${round(shape.leftGap, 1)}px / ${round(shape.rightGap, 1)}px margins), so it follows the new width and keeps exactly those margins.`,
      0.95,
      'layout',
    );
    return;
  }
  if (behaviour === 'pinned-right') {
    record(ctx, 'fixed-width-reanchor', child, { x: round(relative.x, 2) }, { x: round(frame.x - adaptedParentFrame.x, 2) }, `Element is pinned to the right edge, so it keeps its ${round(shape.rightGap, 1)}px right margin and its original ${child.frame.width}px width.`, 0.95, 'layout');
    return;
  }
  if (behaviour === 'centered') {
    record(ctx, 'center-reanchor', child, { x: round(relative.x, 2) }, { x: round(frame.x - adaptedParentFrame.x, 2) }, 'Element is centre-constrained, so it stays centred at its original width.', 0.95, 'layout');
    return;
  }
  if (behaviour === 'scaled') {
    record(ctx, 'uniform-scale', child, { x: round(relative.x, 2), width: child.frame.width }, { x: round(frame.x - adaptedParentFrame.x, 2), width: frame.width }, 'Element uses a scale constraint, so its position and width scale with the parent.', 0.9, 'pixels');
    return;
  }
  record(ctx, 'edge-padding-preserved', child, { x: round(relative.x, 2), width: child.frame.width }, { x: round(frame.x - adaptedParentFrame.x, 2), width: frame.width }, `Element keeps its ${round(shape.leftGap, 1)}px distance from the left edge and its original width.`, 0.95, 'layout');
}

/** Push an adapted node, handling text rewrap and image aspect. */
function finishNode(node: DesignNode, frame: Rect, ctx: Ctx): Rect {
  let finalFrame = frame;
  let lineCount: number | undefined;

  if (node.type === 'text') {
    const available = frame.width - node.padding.left - node.padding.right;
    const originalAvailable = node.frame.width - node.padding.left - node.padding.right;
    const before = wrapText(node.characters, originalAvailable, node.typography);
    const after = wrapText(node.characters, available, node.typography);
    lineCount = after.lineCount;

    if (after.lineCount !== before.lineCount) {
      const growsVertically = node.textAutoResize === 'height' || node.textAutoResize === 'width-and-height';
      const newHeight = growsVertically
        ? round(after.height + node.padding.top + node.padding.bottom, 2)
        : frame.height;
      finalFrame = { ...frame, height: newHeight };
      record(
        ctx,
        'text-rewrap',
        node,
        { availableWidth: round(originalAvailable, 1), lines: before.lineCount, height: node.frame.height },
        { availableWidth: round(available, 1), lines: after.lineCount, height: newHeight },
        `Text reflows from ${before.lineCount} to ${after.lineCount} line${after.lineCount === 1 ? '' : 's'} at the new width. Font family, size, weight, colour and line-height are unchanged — only the wrap point moved.${growsVertically ? ' The text box grows to fit, as its auto-resize setting specifies.' : ' The text box has a fixed height, so the extra line may be clipped — validation checks this.'}`,
        0.75,
        'layout',
      );
    }
  }

  if (node.type === 'image') {
    const originalAspect = node.frame.width === 0 ? 1 : node.frame.height / node.frame.width;
    const newAspect = frame.width === 0 ? 1 : frame.height / frame.width;
    if (!approxEqual(originalAspect, newAspect, 0.01) && node.scaleMode !== 'stretch') {
      record(
        ctx,
        'image-refit',
        node,
        { width: node.frame.width, height: node.frame.height, aspect: round(originalAspect, 4) },
        { width: frame.width, height: frame.height, aspect: round(newAspect, 4) },
        `Image box aspect changed from ${round(originalAspect, 3)} to ${round(newAspect, 3)}. With scale mode "${node.scaleMode}" the artwork keeps its own aspect ratio and the box crops instead of distorting it.`,
        0.85,
        'pixels',
      );
    }
  }

  ctx.nodes.push({
    nodeId: node.id,
    sourceNodeId: node.provenance.sourceNodeId ?? node.id,
    frame: finalFrame,
    scale: node.frame.width === 0 ? 1 : round(finalFrame.width / node.frame.width, 4),
    clipped: false,
    position: node.position,
    ...(lineCount !== undefined ? { lineCount } : {}),
  });
  return finalFrame;
}

// --- Safe-area anchoring -----------------------------------------------------

/**
 * Apply only the *delta* between the source's assumed safe area and the
 * target's real one, so a design that already reserves a status bar is not
 * pushed down twice.
 */
function applySafeAreaAnchors(root: DesignNode, ctx: Ctx): void {
  if (!ctx.options.applySafeArea) return;
  if (ctx.topDelta === 0 && ctx.bottomDelta === 0) return;

  const byId = new Map(ctx.nodes.map((n) => [n.nodeId, n]));

  const visit = (node: DesignNode) => {
    const adapted = byId.get(node.id);
    if (adapted) {
      if (node.safeAreaAnchor === 'top-inset' && ctx.topDelta > 0) {
        const before = { y: adapted.frame.y, height: adapted.frame.height };
        adapted.frame = { ...adapted.frame, height: round(adapted.frame.height + ctx.topDelta, 2) };
        shiftDescendants(node, byId, ctx.topDelta);
        record(
          ctx,
          'safe-area-inset',
          node,
          before,
          { y: adapted.frame.y, height: adapted.frame.height },
          `Top bar grew by ${round(ctx.topDelta, 1)}px — the difference between this device's ${ctx.safeArea.top}px top inset and the ${ctx.sourceSafeArea.insets.top}px the source design already reserves. Its contents moved down by the same amount so they clear the ${ctx.device.cutout.kind === 'dynamic-island' ? 'Dynamic Island' : ctx.device.cutout.kind === 'none' ? 'status bar' : 'cutout'}. Nothing was restyled.`,
          ctx.sourceSafeArea.confidence,
          'layout',
        );
      } else if (node.safeAreaAnchor === 'bottom-inset' && ctx.bottomDelta > 0) {
        const before = { height: adapted.frame.height };
        adapted.frame = { ...adapted.frame, height: round(adapted.frame.height + ctx.bottomDelta, 2) };
        record(
          ctx,
          'home-indicator-clearance',
          node,
          before,
          { height: adapted.frame.height, addedPaddingBottom: round(ctx.bottomDelta, 1) },
          `Bottom bar grew by ${round(ctx.bottomDelta, 1)}px of bottom padding — the difference between this device's ${ctx.safeArea.bottom}px bottom inset and the ${ctx.sourceSafeArea.insets.bottom}px the source reserves — so its controls sit above the ${ctx.device.navigation.mode === 'ios-home-indicator' ? 'home indicator' : 'navigation bar'}. The bar's own content is unchanged.`,
          ctx.sourceSafeArea.confidence,
          'layout',
        );
      }
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
}

function shiftDescendants(node: DesignNode, byId: Map<string, AdaptedNode>, dy: number): void {
  for (const child of childrenOf(node)) {
    const adapted = byId.get(child.id);
    if (adapted) adapted.frame = { ...adapted.frame, y: round(adapted.frame.y + dy, 2) };
    shiftDescendants(child, byId, dy);
  }
}

function hasFixedBottomBar(root: DesignNode): boolean {
  let found = false;
  const visit = (node: DesignNode) => {
    if (node.position === 'fixed' && node.safeAreaAnchor === 'bottom-inset') found = true;
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
  return found;
}

function boundsOf(nodes: AdaptedNode[]): Rect {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.frame.x);
    minY = Math.min(minY, node.frame.y);
    maxX = Math.max(maxX, node.frame.x + node.frame.width);
    maxY = Math.max(maxY, node.frame.y + node.frame.height);
  }
  return { x: round(minX, 2), y: round(minY, 2), width: round(maxX - minX, 2), height: round(maxY - minY, 2) };
}

// --- Preservation scoring ----------------------------------------------------

/**
 * Score how much of the original design survived. Chrome-only transformations
 * never cost anything, because they do not touch the designer's pixels.
 */
export function scorePreservation(ctx: Ctx, strategy: AdaptationStrategy, device: DeviceProfile): PreservationScore {
  const reasons: string[] = [];
  let score = 100;

  const pixelChanges = ctx.transforms.filter((t) => t.impact === 'pixels');
  const layoutChanges = ctx.transforms.filter((t) => t.impact === 'layout');
  const rewraps = ctx.transforms.filter((t) => t.type === 'text-rewrap');

  if (strategy === 'identity') {
    reasons.push('Target viewport matches the source frame exactly: the design is rendered 1:1.');
  }

  if (strategy === 'uniform-scale') {
    const scaleTx = ctx.transforms.find((t) => t.type === 'uniform-scale' && typeof t.after.scale === 'number');
    const factor = typeof scaleTx?.after.scale === 'number' ? scaleTx.after.scale : 1;
    if (!approxEqual(factor, 1, 1e-6)) {
      // Proportional scaling preserves the design completely in relative terms;
      // the only real loss is absolute type size, so the penalty tracks how far
      // the factor is from 1 rather than the number of nodes touched.
      const penalty = Math.min(18, Math.abs(1 - factor) * 100 * 1.6);
      score -= penalty;
      reasons.push(
        `Uniformly scaled by ${round(factor, 4)}. All proportions are preserved exactly; absolute type sizes change by ${round((factor - 1) * 100, 1)}%.`,
      );
    }
  }

  if (strategy === 'structural-reflow') {
    reasons.push('Reflowed using the source\'s own constraints and Auto Layout: type sizes, weights, colours and spacing are byte-for-byte unchanged.');
    if (rewraps.length > 0) {
      score -= Math.min(12, rewraps.length * 3);
      reasons.push(`${rewraps.length} text element${rewraps.length === 1 ? '' : 's'} wrap${rewraps.length === 1 ? 's' : ''} at a different point because the available width changed.`);
    }
    const stretched = ctx.transforms.filter((t) => t.type === 'full-width-stretch').length;
    if (stretched > 0) {
      reasons.push(`${stretched} full-width element${stretched === 1 ? '' : 's'} followed the new width while keeping the original edge margins.`);
    }
  }

  const safeAreaTx = ctx.transforms.filter(
    (t) => t.type === 'safe-area-inset' || t.type === 'home-indicator-clearance',
  );
  if (safeAreaTx.length > 0) {
    score -= Math.min(8, safeAreaTx.length * 2);
    reasons.push(
      `${safeAreaTx.length} element${safeAreaTx.length === 1 ? '' : 's'} adjusted for this device's safe area. This is the minimum change needed to keep content out from under the system UI.`,
    );
  }

  const nonScalePixelChanges = pixelChanges.filter((t) => t.type !== 'uniform-scale').length;
  if (nonScalePixelChanges > 0) score -= Math.min(10, nonScalePixelChanges * 2.5);

  let limitedByDeviceConfidence = false;
  if (device.overallConfidence !== 'high') {
    limitedByDeviceConfidence = true;
    const cap = device.overallConfidence === 'medium' ? 92 : 80;
    if (score > cap) {
      score = cap;
      reasons.push(
        `Score capped at ${cap}: this device's geometry is carried at ${device.overallConfidence} confidence, so the result cannot be verified more precisely than that.`,
      );
    }
  }

  if (ctx.sourceSafeArea.basis === 'assumed-zero') {
    reasons.push(ctx.sourceSafeArea.explanation);
  }

  return {
    score: Math.max(0, round(score, 1)),
    reasons,
    pixelsChanged: pixelChanges.length > 0,
    layoutChanged: layoutChanges.length > 0,
    limitedByDeviceConfidence,
  };
}
