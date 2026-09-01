import { useCallback, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { api, ApiRequestError } from '../../lib/api.js';
import { useWorkspace } from '../../state/workspace.js';
import styles from './UploadPanel.module.css';

const ACCEPTED = 'image/png,image/jpeg,image/webp';

/**
 * The entry point (spec section 22): a large primary drop area, immediate
 * feedback on the detected source dimensions, and no device configuration
 * required before uploading.
 */
export function UploadPanel({ figmaAvailable }: { figmaAvailable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setSource = useWorkspace((s) => s.setSource);
  const setProject = useWorkspace((s) => s.setProject);
  const addPane = useWorkspace((s) => s.addPane);
  const project = useWorkspace((s) => s.project);

  const ingest = useCallback(
    async (run: (projectId: string) => Promise<Awaited<ReturnType<typeof api.uploadSource>>>) => {
      setBusy(true);
      setError(undefined);
      try {
        const active = project ?? (await api.createProject('Untitled project'));
        if (!project) setProject(active);
        const result = await run(active.id);
        setSource({ source: result.source, design: result.design });
        // Open the first preview immediately with a sensible default profile,
        // so the designer never has to configure a device to see their work.
        addPane(result.defaultDeviceId);
      } catch (cause) {
        setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [project, setProject, setSource, addPane],
  );

  const handleFile = useCallback(
    (file: File) => {
      void ingest((projectId) => api.uploadSource(projectId, file));
    },
    [ingest],
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Device Adaptation Engine</h1>
        <p className={styles.subtitle}>
          Upload one mobile design. It is rendered across real device profiles, validated against each one, and
          never redesigned.
        </p>
      </div>

      <Tabs.Root defaultValue="image" className={styles.tabs}>
        <Tabs.List className={styles.tabList} aria-label="Source type">
          <Tabs.Trigger value="image" className={styles.tab}>
            Image export
          </Tabs.Trigger>
          <Tabs.Trigger value="figma" className={styles.tab}>
            Figma frame
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="image" className={styles.tabContent}>
          <div
            className={[styles.dropzone, dragging ? styles.dropzoneActive : ''].filter(Boolean).join(' ')}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Upload a design export"
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              className={styles.fileInput}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <p className={styles.dropTitle}>{busy ? 'Importing…' : 'Drop a PNG, JPEG or WebP export'}</p>
            <p className={styles.dropHint}>
              Normally a 375px-wide mobile artboard. Long, scrollable pages are expected — the full height is
              preserved.
            </p>
          </div>
        </Tabs.Content>

        <Tabs.Content value="figma" className={styles.tabContent}>
          <FigmaForm
            available={figmaAvailable}
            busy={busy}
            onSubmit={(values) => void ingest((projectId) => api.importFigma({ projectId, ...values }))}
          />
        </Tabs.Content>
      </Tabs.Root>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.guarantees}>
        <li>Your file is stored unchanged and hashed. Nothing overwrites it.</li>
        <li>Device parameters come from the catalog — you never type a safe area or notch size.</li>
        <li>Every adaptation is validated twice and reports what it could not verify.</li>
      </ul>
    </div>
  );
}

function FigmaForm({
  available,
  busy,
  onSubmit,
}: {
  available: boolean;
  busy: boolean;
  onSubmit(values: { fileKey: string; nodeId: string; accessToken?: string }): void;
}) {
  const [fileKey, setFileKey] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [token, setToken] = useState('');

  return (
    <form
      className={styles.figmaForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ fileKey: fileKey.trim(), nodeId: nodeId.trim(), ...(token ? { accessToken: token } : {}) });
      }}
    >
      <label className={styles.field}>
        <span>File key</span>
        <input value={fileKey} onChange={(e) => setFileKey(e.target.value)} placeholder="abc123XYZ" required />
      </label>
      <label className={styles.field}>
        <span>Node id</span>
        <input value={nodeId} onChange={(e) => setNodeId(e.target.value)} placeholder="12:345" required />
      </label>
      {!available && (
        <label className={styles.field}>
          <span>Access token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="figd_…"
            autoComplete="off"
          />
          <small>
            No server-side token is configured. A token entered here is used for this request only and is never
            stored.
          </small>
        </label>
      )}
      <button type="submit" className={styles.primaryButton} disabled={busy}>
        {busy ? 'Importing…' : 'Import frame'}
      </button>
      <p className={styles.figmaNote}>
        The Figma file is read only. Node ids, hierarchy, Auto Layout and type metadata are preserved, and nothing
        is ever written back.
      </p>
    </form>
  );
}
