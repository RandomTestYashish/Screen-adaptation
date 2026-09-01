import { useCallback } from 'react';
import { DevicePreview, type MeasuredEvidence } from '../../renderer/DevicePreview.js';
import { usePaneRender } from '../../hooks/usePaneRender.js';
import { useWorkspace, type PreviewPane } from '../../state/workspace.js';
import { RenderProgress } from './RenderProgress.js';
import styles from './Workspace.module.css';

interface Props {
  pane: PreviewPane;
  /** A, B, C… - a quiet identity, not a ranking. */
  label: string;
  onMeasuredNodes(paneId: string, measured: Record<string, { x: number; y: number; width: number; height: number }>): void;
}

export function PreviewPaneView({ pane, label, onMeasuredNodes }: Props) {
  const design = useWorkspace((s) => s.design);
  const zoom = useWorkspace((s) => s.zoom);
  const devMode = useWorkspace((s) => s.devMode);
  const selectedNodeId = useWorkspace((s) => s.selectedNodeId);
  const measureFromNodeId = useWorkspace((s) => s.measureFromNodeId);
  const activePaneId = useWorkspace((s) => s.activePaneId);
  const setActivePane = useWorkspace((s) => s.setActivePane);
  const setScroll = useWorkspace((s) => s.setScroll);
  const selectNode = useWorkspace((s) => s.selectNode);

  const overlayMode = useWorkspace((s) => s.overlayMode);
  const overlay = useWorkspace((s) => s.overlay);

  const { onMeasured } = usePaneRender(pane);

  // Must be stable: an inline callback here would re-run the preview's
  // measurement effect on every render, producing a new evidence object each
  // time and churning the validation that depends on it.
  const handleMeasured = useCallback(
    (evidence: MeasuredEvidence) => {
      onMeasured(evidence);
      onMeasuredNodes(pane.id, evidence.measuredNodes);
    },
    [onMeasured, onMeasuredNodes, pane.id],
  );

  if (pane.status === 'error') {
    return (
      <div className={styles.paneError} role="alert">
        <p>Could not render on this device.</p>
        <p className={styles.paneErrorDetail}>{pane.error}</p>
      </div>
    );
  }

  if (!design || !pane.render) {
    return <RenderProgress label={label} stage={pane.stage ?? 'analysing'} />;
  }

  const active = activePaneId === pane.id;

  return (
    <div
      className={active ? styles.paneActive : styles.pane}
      data-pane-id={pane.id}
      // Neutral is the default and must be observable: no pane carries this
      // attribute until someone picks one (spec sections 24 and 47).
      {...(active ? { 'data-active': 'true' } : {})}
      onFocusCapture={() => setActivePane(pane.id)}
      onMouseDown={(event) => {
        // Selecting a pane is explicit. The canvas clears it again, so two
        // devices can be compared with neither one privileged.
        event.stopPropagation();
        setActivePane(pane.id);
      }}
    >
      <header className={styles.paneHeader}>
        <span className={active ? styles.paneBadgeActive : styles.paneBadge}>{label}</span>
        <span className={styles.paneDevice}>{pane.render.device.marketingName}</span>
      </header>

      <DevicePreview
        device={pane.render.device}
        design={design}
        adaptation={pane.render.adaptation}
        assetUrls={pane.render.assetUrls}
        orientation={pane.orientation}
        chrome={pane.chrome}
        zoom={zoom}
        devMode={devMode}
        selectedNodeId={selectedNodeId}
        measureFromNodeId={measureFromNodeId}
        validation={pane.validation}
        scrollTop={pane.scrollTop}
        {...(overlayMode ? { overlay } : {})}
        onScroll={(scrollTop, progress) => setScroll(pane.id, scrollTop, progress)}
        onSelect={selectNode}
        onMeasured={handleMeasured}
      />
    </div>
  );
}
