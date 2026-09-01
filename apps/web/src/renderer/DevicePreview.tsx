import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  primaryScreen,
  safeAreaFor,
  viewportFor,
  type AdaptationResult,
  type DesignDocument,
  type DeviceProfile,
  type Orientation,
  type ValidationReport,
} from '@dae/shared';
import type { ChromeToggles, OverlayToggles } from '../state/workspace.js';
import { DeviceShell } from './device-shell/DeviceShell.js';
import { PlatformChrome } from './platform-chrome/PlatformChrome.js';
import { SafeAreaOverlay } from './overlays/SafeAreaOverlay.js';
import { DeviceOverlay } from './overlays/DeviceOverlay.js';
import { InspectionOverlay } from './overlays/InspectionOverlay.js';
import { DesignRenderer, FixedLayer } from './design-renderer/DesignRenderer.js';
import { assetUrl as absoluteAssetUrl } from '../lib/api.js';
import styles from './DevicePreview.module.css';

export interface MeasuredEvidence {
  measuredScrollHeight: number;
  measuredNodes: Record<string, { x: number; y: number; width: number; height: number }>;
  availableFonts: string[];
}

interface Props {
  device: DeviceProfile;
  design: DesignDocument;
  adaptation: AdaptationResult;
  /** Signed URL per asset id, supplied by the render response. */
  assetUrls: Record<string, string>;
  orientation: Orientation;
  chrome: ChromeToggles;
  zoom: number;
  devMode: boolean;
  selectedNodeId?: string;
  measureFromNodeId?: string;
  validation?: ValidationReport;
  scrollTop: number;
  /** Transparent measurement overlay; undefined when it is off. */
  overlay?: OverlayToggles;
  onScroll(scrollTop: number, scrollProgress: number): void;
  onSelect(nodeId: string): void;
  /** Fires once the DOM has settled, with real measurements from the preview. */
  onMeasured(evidence: MeasuredEvidence): void;
}

/** Extra content rendered above and below the window, in adapted logical px. */
const VIRTUALISATION_MARGIN = 1200;

/**
 * Composes the five independent rendering layers (spec section 9):
 *
 *   A  device shell          - cosmetic, data-driven from the profile
 *   B  platform chrome       - status bar, cutout, home indicator, nav, keyboard
 *   C  safe-area overlay     - inset visualisation
 *   D  the user's design     - the only layer carrying the designer's pixels
 *   E  inspection overlays   - Dev Mode boxes, padding, distances, findings
 *
 * The design scrolls inside a real scroll container, so a long page behaves
 * exactly as it would on the device rather than being cropped to the frame.
 */
export function DevicePreview({
  device,
  design,
  adaptation,
  assetUrls,
  orientation,
  chrome,
  zoom,
  devMode,
  selectedNodeId,
  measureFromNodeId,
  validation,
  scrollTop,
  overlay,
  onScroll,
  onSelect,
  onMeasured,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [windowTop, setWindowTop] = useState(0);
  const screen = useMemo(() => primaryScreen(design), [design]);
  const viewport = viewportFor(device, orientation);
  const safeArea = safeAreaFor(device, orientation);
  const usableHeight = adaptation.plan.usableViewport.height;

  // Assets are addressed by opaque id and resolved through signed URLs the
  // server issued; the client never constructs an asset path itself.
  const resolveAsset = useCallback(
    (assetId: string): string | undefined => {
      const signed = assetUrls[assetId];
      return signed ? absoluteAssetUrl(signed) : undefined;
    },
    [assetUrls],
  );

  // Keep the DOM scroll position in step with the store, so synchronised
  // scrolling across panes works without the panes fighting each other.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (Math.abs(scroller.scrollTop - scrollTop) > 1) scroller.scrollTop = scrollTop;
  }, [scrollTop]);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setWindowTop(scroller.scrollTop);
    const extent = scroller.scrollHeight - scroller.clientHeight;
    // Progress, not pixels: linked panes have different document heights.
    onScroll(scroller.scrollTop, extent > 0 ? scroller.scrollTop / extent : 0);
  }, [onScroll]);

  // Report real measurements so validation can upgrade its predictions from
  // `inferred` to `detected` (spec section 14).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const handle = window.requestAnimationFrame(() => {
      const documentEl = scroller.querySelector<HTMLElement>('[data-testid="design-document"]');
      if (!documentEl) return;
      const origin = documentEl.getBoundingClientRect();
      const measuredNodes: MeasuredEvidence['measuredNodes'] = {};

      for (const element of scroller.querySelectorAll<HTMLElement>('[data-node-id]')) {
        const nodeId = element.dataset['nodeId'];
        if (!nodeId) continue;
        const box = element.getBoundingClientRect();
        // Undo the preview zoom so measurements are in device logical px.
        measuredNodes[nodeId] = {
          x: (box.left - origin.left) / zoom,
          y: (box.top - origin.top) / zoom,
          width: box.width / zoom,
          height: box.height / zoom,
        };
      }

      const availableFonts = design.fontsUsed
        .map((font) => font.family)
        .filter((family) => {
          try {
            return document.fonts.check(`16px "${family}"`);
          } catch {
            return false;
          }
        });

      onMeasured({
        measuredScrollHeight: documentEl.getBoundingClientRect().height / zoom,
        measuredNodes,
        availableFonts,
      });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [adaptation.plan.id, adaptation.plan.revision, zoom, design.fontsUsed, onMeasured]);

  const visibleRange = useMemo(
    () => ({ top: windowTop - VIRTUALISATION_MARGIN, bottom: windowTop + usableHeight + VIRTUALISATION_MARGIN }),
    [windowTop, usableHeight],
  );

  const keyboardInset =
    chrome.keyboard && device.keyboard.supported ? device.keyboard.height + device.keyboard.accessoryHeight : 0;

  return (
    <div className={styles.stage} style={{ width: previewWidth(device, viewport, chrome, zoom) }}>
      <div className={styles.zoom} style={{ transform: `scale(${zoom})` }}>
        <DeviceShell device={device} screen={{ width: viewport.width, height: viewport.height }} showShell={chrome.deviceShell}>
          {/* Layer D - the design, inside a real scrollable viewport. */}
          <div
            ref={scrollerRef}
            className={styles.designViewport}
            style={{ width: viewport.width, height: viewport.height - keyboardInset }}
            onScroll={handleScroll}
            data-testid="design-viewport"
            tabIndex={0}
            aria-label={`${device.marketingName} preview`}
          >
            <DesignRenderer
              screen={screen}
              adaptation={adaptation}
              assetUrl={resolveAsset}
              devMode={devMode}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              visibleRange={visibleRange}
            />
          </div>

          <FixedLayer
            screen={screen}
            adaptation={adaptation}
            assetUrl={resolveAsset}
            devMode={devMode}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
          />

          {/* Layer C */}
          {chrome.safeAreaOverlay && (
            <SafeAreaOverlay
              device={device}
              orientation={orientation}
              assumedSourceSafeArea={adaptation.plan.assumedSourceSafeArea}
            />
          )}

          {/* Layer E */}
          {devMode && (
            <InspectionOverlay
              screen={screen}
              adaptation={adaptation}
              selectedNodeId={selectedNodeId}
              measureFromNodeId={measureFromNodeId}
              validation={validation}
              showFindings={chrome.inspectionOverlays}
              scrollTop={windowTop}
            />
          )}

          {overlay && (
            <DeviceOverlay
              device={device}
              orientation={orientation}
              adaptation={adaptation}
              overlay={overlay}
            />
          )}

          {/* Layer B - always painted last so it is above everything. */}
          <PlatformChrome device={device} orientation={orientation} chrome={chrome} />
        </DeviceShell>
      </div>

      <p className={styles.caption}>
        <strong>{device.marketingName}</strong>
        <span className={styles.captionMeta}>
          {viewport.width}x{viewport.height} · DPR {device.devicePixelRatio}
          {device.densityBucket ? ` · ${device.densityBucket}` : ''} · {device.osName}
        </span>
        <span className={styles.captionMeta}>
          safe {safeArea.top}/{safeArea.bottom} · scroll {Math.round(adaptation.plan.targetScrollHeight)}px ·{' '}
          {adaptation.plan.strategy}
          {adaptation.plan.scale !== 1 ? ` ${adaptation.plan.scale.toFixed(3)}x` : ''}
        </span>
      </p>
    </div>
  );
}

function previewWidth(
  device: DeviceProfile,
  viewport: { width: number },
  chrome: ChromeToggles,
  zoom: number,
): number {
  const bezels = chrome.deviceShell ? device.shellBezel.left + device.shellBezel.right : 0;
  return Math.ceil((viewport.width + bezels) * zoom);
}
