import { useCallback, useMemo, useState } from 'react';
import { primaryScreen } from '@dae/shared';
import { useWorkspace } from '../../state/workspace.js';
import { DeviceExplorer } from '../device-explorer/DeviceExplorer.js';
import { PreviewControls } from './PreviewControls.js';
import { PreviewPaneView } from './PreviewPaneView.js';
import { Inspector } from '../dev-mode/Inspector.js';
import { ReconstructionPanel } from '../ai-mode/ReconstructionPanel.js';
import { ValidationPanel } from '../validation-panel/ValidationPanel.js';
import { SourceSummary } from './SourceSummary.js';
import { SourceSidebar } from './SourceSidebar.js';
import { ExportPreview } from './ExportPreview.js';
import { api, assetUrl, STANDALONE } from '../../lib/api.js';
import { captureViewport } from '../../lib/capture.js';
import styles from './Workspace.module.css';

type MeasuredMap = Record<string, Record<string, { x: number; y: number; width: number; height: number }>>;

/**
 * The desktop workspace (spec section 1): previews in the centre, the device
 * explorer on the right, and a compact validation summary along the bottom.
 */
export function Workspace() {
  const design = useWorkspace((s) => s.design);
  const source = useWorkspace((s) => s.source);
  const panes = useWorkspace((s) => s.panes);
  const activePaneId = useWorkspace((s) => s.activePaneId);
  const devMode = useWorkspace((s) => s.devMode);
  const setDevMode = useWorkspace((s) => s.setDevMode);
  const syncScroll = useWorkspace((s) => s.syncScroll);
  const setSyncScroll = useWorkspace((s) => s.setSyncScroll);
  const zoom = useWorkspace((s) => s.zoom);
  const setZoom = useWorkspace((s) => s.setZoom);
  const setPickingFor = useWorkspace((s) => s.setPickingFor);
  const clearActivePane = useWorkspace((s) => s.clearActivePane);
  const aiMode = useWorkspace((s) => s.aiMode);
  const setAiMode = useWorkspace((s) => s.setAiMode);
  const overlayMode = useWorkspace((s) => s.overlayMode);
  const setOverlayMode = useWorkspace((s) => s.setOverlayMode);
  const presentMode = useWorkspace((s) => s.presentMode);
  const setPresentMode = useWorkspace((s) => s.setPresentMode);
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const setSidebarOpen = useWorkspace((s) => s.setSidebarOpen);
  const pickingForPaneId = useWorkspace((s) => s.pickingForPaneId);
  const addPane = useWorkspace((s) => s.addPane);
  const inspectorOpen = useWorkspace((s) => s.inspectorOpen);
  const dna = useWorkspace((s) => s.dna);

  const [measuredByPane, setMeasuredByPane] = useState<MeasuredMap>({});
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string>();
  const [exportPreview, setExportPreview] = useState<{ kind: string; url: string; size: string }>();

  const activePane = panes.find((p) => p.id === activePaneId) ?? panes[0];
  const screen = useMemo(() => (design ? primaryScreen(design) : undefined), [design]);

  const onMeasuredNodes = useCallback((paneId: string, measured: MeasuredMap[string]) => {
    setMeasuredByPane((previous) => ({ ...previous, [paneId]: measured }));
  }, []);

  const handleAddDevice = useCallback(() => {
    // Open the explorer in "picking" mode; the pane is created once a device is
    // chosen, so a new preview never appears with an arbitrary default.
    const template = activePane?.deviceId;
    if (!template) return;
    const id = addPane(template);
    setPickingFor(id);
  }, [activePane?.deviceId, addPane, setPickingFor]);

  const handleExport = useCallback(
    async (kind: 'validation-report' | 'device-metadata' | 'viewport-image' | 'full-length-image') => {
      const plan = activePane?.render?.adaptation.plan;
      if (!plan) return;
      setExporting(true);
      setExportMessage(undefined);
      try {
        let imageDataUrl: string | undefined;
        if (kind === 'viewport-image' || kind === 'full-length-image') {
          imageDataUrl = await captureViewport(activePane!.id, kind === 'full-length-image');
          if (!imageDataUrl) {
            setExportMessage(
              'The preview could not be captured in this browser. The JSON exports are unaffected.',
            );
            return;
          }
        }
        const result = await api.export({
          adaptationPlanId: plan.id,
          kind,
          format: kind.endsWith('image') ? 'png' : 'json',
          ...(imageDataUrl ? { imageDataUrl } : {}),
        });
        const size = `${Math.round(result.byteSize / 1024)} KB`;

        if (STANDALONE) {
          // The embedded preview's sandbox blocks downloads, so show the
          // artefact instead of pretending to save it.
          setExportPreview({ kind: result.kind, url: assetUrl(result.url), size });
          setExportMessage(undefined);
          return;
        }
        window.open(assetUrl(result.url), '_blank', 'noopener');
        setExportMessage(`Exported ${result.kind} (${size}) with full provenance.`);
      } catch (cause) {
        setExportMessage((cause as Error).message);
      } finally {
        setExporting(false);
      }
    },
    [activePane],
  );

  if (!design || !source || !screen) return null;

  return (
    <div className={styles.workspace}>
      <header className={styles.topBar}>
        <SourceSummary source={source} design={design} />

        <div className={styles.topControls}>
          <div className={styles.zoomControl}>
            <button
              type="button"
              className={styles.stepButton}
              onClick={() => setZoom(zoom - 0.1)}
              aria-label="Zoom out"
            >
              −
            </button>
            <input
              type="range"
              min={0.3}
              max={1.5}
              step={0.1}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              aria-label="Preview zoom"
            />
            <button
              type="button"
              className={styles.stepButton}
              onClick={() => setZoom(zoom + 0.1)}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className={styles.zoomValue}
              onClick={() => setZoom(1)}
              title="Reset to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
          </div>

          {panes.length > 1 && (
            <label className={styles.checkboxControl}>
              <input
                type="checkbox"
                checked={syncScroll}
                onChange={(event) => setSyncScroll(event.target.checked)}
              />
              <span>Link scroll</span>
            </label>
          )}

          <div className={styles.modeGroup} role="group" aria-label="Modes">
            <ModeToggle label="Overlay" checked={overlayMode} onChange={setOverlayMode} />
            {/* Dev Mode measures; AI Mode explains. Kept distinct so the two
                never overlap into one confusing surface (spec section 18). */}
            <ModeToggle label="Dev" checked={devMode} onChange={setDevMode} />
            <ModeToggle label="AI" checked={aiMode} onChange={setAiMode} />
            <ModeToggle label="Present" checked={presentMode} onChange={setPresentMode} />
          </div>
        </div>
      </header>

      <div className={styles.body}>
        {sidebarOpen ? (
          <SourceSidebar onClose={() => setSidebarOpen(false)} />
        ) : (
          <button
            type="button"
            className={styles.sidebarReveal}
            onClick={() => setSidebarOpen(true)}
            aria-label="Show source panel"
            title="Show source panel"
          >
            ›
          </button>
        )}

        <main
          className={styles.stage}
          onMouseDown={() => clearActivePane()}
          role="presentation"
        >
          <div className={styles.previewRow}>
            {panes.map((pane, index) => (
              <PreviewPaneView
                key={pane.id}
                pane={pane}
                label={String.fromCharCode(65 + index)}
                onMeasuredNodes={onMeasuredNodes}
              />
            ))}

            <button
              type="button"
              className={styles.addPane}
              onClick={handleAddDevice}
              aria-label="Add another device preview"
            >
              <span className={styles.addPaneIcon} aria-hidden>+</span>
              <span>Add device</span>
            </button>
          </div>

          {panes.length > 1 && (
            <p className={styles.compareNote}>
              Comparing {panes.length} devices from the same source. Switching a device re-renders the same
              adaptation; the source design is never modified.
            </p>
          )}
        </main>

        {!presentMode && (
        <div className={styles.rightRail}>
          {aiMode && activePane?.render ? (
            <div className={styles.inspectorRail}>
              <ReconstructionPanel
                screen={screen}
                adaptation={activePane.render.adaptation}
                design={design}
                dna={dna}
              />
            </div>
          ) : devMode && inspectorOpen && activePane?.render ? (
            <div className={styles.inspectorRail}>
              <Inspector
                screen={screen}
                adaptation={activePane.render.adaptation}
                device={activePane.render.device}
                measured={measuredByPane[activePane.id]}
              />
            </div>
          ) : (
            <DeviceExplorer />
          )}

          {activePane && !pickingForPaneId && (
            <PreviewControls pane={activePane} device={activePane.render?.device} />
          )}
        </div>
        )}
      </div>

      {!presentMode && (
      <ValidationPanel
        report={activePane?.validation}
        adaptation={activePane?.render?.adaptation}
        device={activePane?.render?.device}
        busy={exporting || activePane?.status === 'loading'}
        onExport={(kind) => void handleExport(kind)}
      />
      )}

      {exportMessage && (
        <p className={styles.exportMessage} role="status">
          {exportMessage}
        </p>
      )}

      <ExportPreview preview={exportPreview} onClose={() => setExportPreview(undefined)} />
    </div>
  );
}

/** A quiet, uniform switch for the workspace modes. */
function ModeToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className={checked ? styles.modeToggleActive : styles.modeToggle}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
