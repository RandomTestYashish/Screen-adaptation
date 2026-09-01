import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useWorkspace } from '../state/workspace.js';
import { UploadPanel } from '../components/upload/UploadPanel.js';
import { Workspace } from '../components/workspace/Workspace.js';
import styles from './App.module.css';

export function App() {
  const design = useWorkspace((s) => s.design);
  const { data: health, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    retry: 1,
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className={styles.offline} role="alert">
        <h1>The API is not reachable</h1>
        <p>
          Start it with <code>pnpm dev:api</code>, or set <code>VITE_API_BASE_URL</code> if it runs elsewhere.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <aside className="narrow-notice">
        <strong>This is a desktop workspace.</strong>
        <span>
          It puts phone previews at 1:1 next to a device explorer and a measurement panel, which needs roughly a
          laptop&apos;s width. On a narrow screen you can still look around, but the previews will be cramped.
        </span>
      </aside>

      {design ? <Workspace /> : <UploadPanel figmaAvailable={health?.capabilities.figmaImport ?? false} />}

      {health && (
        <footer className={styles.statusStrip}>
          <span>
            device catalog {health.deviceCatalog.version} · {health.deviceCatalog.deviceCount} devices
          </span>
          <span>
            engine {health.versions['adaptationEngine']} · validation {health.versions['validationEngine']}
          </span>
          <span>
            storage {health.drivers['storage']} · queue {health.drivers['queue']} · ai {health.drivers['ai']}
          </span>
          {/* Assumptions and limitations belong in the product, not in a
              README nobody opens (spec section 31). */}
          {!health.capabilities.rasterAnalysis && health.capabilities.rasterAnalysisUnavailableReason && (
            <span className={styles.statusNote} title={health.capabilities.rasterAnalysisUnavailableReason}>
              bitmap structure analysis off
            </span>
          )}
        </footer>
      )}
    </div>
  );
}
