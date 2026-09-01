import { logicalToPhysical, type MetadataRow } from '@dae/shared';
import { effectiveFrame, irNode, px, type ValidationContext } from './context.js';
import { round } from '../layout/geometry.js';

function row(
  group: MetadataRow['group'],
  key: string,
  value: string,
  quality: MetadataRow['quality'] = 'detected',
): MetadataRow {
  return { group, key, value, quality };
}

/**
 * The code-like measurement rows for the expanded validation panel
 * (spec section 14). Every row carries a quality label so nothing here can be
 * read as a measurement the system did not actually make.
 */
export function buildMetadataRows(ctx: ValidationContext): MetadataRow[] {
  const { plan } = ctx.adaptation;
  const device = ctx.device;
  const rows: MetadataRow[] = [];

  rows.push(
    row('viewport', 'viewport-width', px(plan.targetViewport.width)),
    row('viewport', 'viewport-height', px(plan.targetViewport.height)),
    row('viewport', 'usable-height', px(plan.usableViewport.height), plan.options.keyboardVisible || plan.options.simulateBrowserChrome ? 'inferred' : 'detected'),
    row('viewport', 'orientation', plan.options.orientation),
  );

  rows.push(
    row('device', 'device', device.marketingName),
    row('device', 'platform', `${device.osName} ${device.osVersionRange.min}+`),
    row('device', 'device-pixel-ratio', String(device.devicePixelRatio)),
    row('device', 'physical-resolution', `${device.physicalResolution.width}x${device.physicalResolution.height}px`),
    row('device', 'density-bucket', device.densityBucket ?? 'n/a', device.densityBucket ? 'detected' : 'unavailable'),
    row('device', 'ppi', device.ppi ? String(device.ppi) : 'unavailable', device.ppi ? 'detected' : 'unavailable'),
    row('device', 'aspect-ratio', String(device.aspectRatio)),
    row('device', 'catalog-version', device.catalogVersion),
    row('device', 'data-confidence', device.overallConfidence),
  );

  rows.push(
    row('safe-area', 'safe-area-top', px(plan.safeArea.top), attributionQuality(ctx, 'safeArea.portrait.top')),
    row('safe-area', 'safe-area-right', px(plan.safeArea.right)),
    row('safe-area', 'safe-area-bottom', px(plan.safeArea.bottom), attributionQuality(ctx, 'safeArea.portrait.bottom')),
    row('safe-area', 'safe-area-left', px(plan.safeArea.left)),
    row('safe-area', 'status-bar-height', px(device.statusBar.height)),
    row('safe-area', 'cutout', device.cutout.kind === 'none' ? 'none' : `${device.cutout.kind} ${device.cutout.width}x${device.cutout.height}px`),
    row('safe-area', 'navigation-mode', device.navigation.mode),
    row('safe-area', 'navigation-height', px(device.navigation.height)),
    row('safe-area', 'screen-corner-radius', px(device.screenCornerRadius), attributionQuality(ctx, 'screenCornerRadius')),
  );

  rows.push(
    row('content', 'source-width', px(plan.sourceFrame.width)),
    row('content', 'source-height', px(plan.sourceFrame.height)),
    row('content', 'content-width', px(plan.contentBounds.width), 'inferred'),
    row('content', 'adaptation-strategy', plan.strategy),
    row('content', 'scale', String(plan.scale)),
    row('content', 'preservation-score', `${plan.preservation.score}/100`, 'inferred'),
    row(
      'content',
      'render-physical-width',
      `${round(logicalToPhysical(plan.targetViewport.width, device), 0)}px`,
      'inferred',
    ),
  );

  rows.push(
    row('scroll', 'source-scroll-height', px(plan.sourceFrame.scrollHeight), ctx.screen.scrollHeightProvenance.quality),
    row('scroll', 'target-scroll-height', px(plan.targetScrollHeight), ctx.evidence?.measuredScrollHeight ? 'detected' : 'inferred'),
    row(
      'scroll',
      'measured-scroll-height',
      ctx.evidence?.measuredScrollHeight !== undefined ? px(ctx.evidence.measuredScrollHeight) : 'unavailable',
      ctx.evidence?.measuredScrollHeight !== undefined ? 'detected' : 'unavailable',
    ),
    row('scroll', 'viewports', String(round(plan.targetScrollHeight / plan.usableViewport.height, 2)), 'inferred'),
  );

  // Typography and spacing summaries, drawn from the IR rather than guessed.
  const fontSizes = new Map<string, number>();
  const paddings = new Map<number, number>();
  const gaps = new Map<number, number>();
  for (const adapted of ctx.adaptation.nodes) {
    const node = irNode(ctx, adapted.nodeId);
    if (!node) continue;
    if (node.type === 'text') {
      const key = `${round(node.typography.fontSize, 2)}/${node.typography.fontWeight}`;
      fontSizes.set(key, (fontSizes.get(key) ?? 0) + 1);
    }
    for (const value of [node.padding.left, node.padding.right]) {
      if (value > 0) paddings.set(value, (paddings.get(value) ?? 0) + 1);
    }
    if (node.autoLayout && node.autoLayout.gap > 0) {
      gaps.set(node.autoLayout.gap, (gaps.get(node.autoLayout.gap) ?? 0) + 1);
    }
  }

  const topFonts = [...fontSizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [key, count] of topFonts) {
    const [size, weight] = key.split('/');
    rows.push(row('typography', `font-size`, `${size}px / ${weight} (${count} element${count === 1 ? '' : 's'})`));
  }
  if (topFonts.length === 0) {
    rows.push(
      row(
        'typography',
        'font-size',
        ctx.design.sourceKind === 'raster' ? 'unavailable (type is baked into the bitmap)' : 'unavailable',
        'unavailable',
      ),
    );
  }

  for (const [value, count] of [...paddings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    rows.push(row('spacing', 'padding-inline', `${value}px (${count} element${count === 1 ? '' : 's'})`));
  }
  for (const [value, count] of [...gaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    rows.push(row('spacing', 'gap', `${value}px (${count} container${count === 1 ? '' : 's'})`));
  }
  if (paddings.size === 0 && gaps.size === 0) {
    rows.push(row('spacing', 'padding', 'unavailable', 'unavailable'));
  }

  rows.push(
    row('source', 'source-id', ctx.source.id),
    row('source', 'source-kind', ctx.source.kind),
    row('source', 'source-hash', `${ctx.source.hash.slice(0, 16)}…`),
    row('source', 'source-immutable', String(ctx.source.immutable)),
    row('source', 'parser-version', ctx.design.parserVersion),
    row('source', 'engine-version', plan.engineVersion),
    row('source', 'plan-revision', String(plan.revision)),
  );

  return rows;
}

function attributionQuality(ctx: ValidationContext, path: string): MetadataRow['quality'] {
  const entry = ctx.device.attribution[path];
  if (!entry) return 'inferred';
  if (entry.source === 'derived') return 'inferred';
  return entry.confidence === 'high' ? 'detected' : 'inferred';
}

/** Convenience for the Dev Mode inspector: per-node measurement rows. */
export function buildNodeInspection(ctx: ValidationContext, nodeId: string): MetadataRow[] {
  const node = irNode(ctx, nodeId);
  const effective = effectiveFrame(ctx, nodeId);
  if (!node || !effective) return [];
  const quality = effective.quality;
  const rows: MetadataRow[] = [
    row('content', 'x', px(effective.frame.x), quality),
    row('content', 'y', px(effective.frame.y), quality),
    row('content', 'width', px(effective.frame.width), quality),
    row('content', 'height', px(effective.frame.height), quality),
    row('spacing', 'padding-top', px(node.padding.top)),
    row('spacing', 'padding-right', px(node.padding.right)),
    row('spacing', 'padding-bottom', px(node.padding.bottom)),
    row('spacing', 'padding-left', px(node.padding.left)),
  ];
  if (node.autoLayout) {
    rows.push(
      row('spacing', 'gap', px(node.autoLayout.gap)),
      row('content', 'layout-direction', node.autoLayout.direction),
      row('content', 'primary-align', node.autoLayout.primaryAxisAlign),
    );
  }
  if (node.type === 'text') {
    rows.push(
      row('typography', 'font-family', node.typography.fontFamily),
      row('typography', 'font-size', px(node.typography.fontSize)),
      row('typography', 'font-weight', String(node.typography.fontWeight)),
      row(
        'typography',
        'line-height',
        px(node.typography.lineHeight),
        node.typography.lineHeightSource === 'explicit' ? 'detected' : 'inferred',
      ),
      row('typography', 'letter-spacing', px(node.typography.letterSpacing)),
      row('typography', 'text-align', node.typography.textAlign),
    );
  }
  rows.push(
    row('source', 'source-node-id', node.provenance.sourceNodeId ?? 'n/a', node.provenance.sourceNodeId ? 'detected' : 'unavailable'),
    row('source', 'provenance', `${node.provenance.origin} (${node.provenance.quality}, ${round(node.provenance.confidence * 100, 0)}%)`),
    row('safe-area', 'safe-area-anchor', node.safeAreaAnchor, node.fieldQuality['safeAreaAnchor']?.quality ?? 'detected'),
    row('content', 'position', node.position, node.fieldQuality['position']?.quality ?? 'detected'),
  );
  return rows;
}
