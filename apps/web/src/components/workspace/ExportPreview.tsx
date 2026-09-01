import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from './ExportPreview.module.css';

interface Props {
  preview?: { kind: string; url: string; size: string };
  onClose(): void;
}

/**
 * Shows an export inline.
 *
 * The embedded preview runs in a sandbox that blocks downloads, so rather than
 * offering a save that would silently do nothing, the artefact is displayed and
 * JSON can be copied. Running the app locally writes a real file.
 */
export function ExportPreview({ preview, onClose }: Props) {
  const [json, setJson] = useState<string>();
  const [copied, setCopied] = useState(false);
  const isImage = preview?.kind.endsWith('image') ?? false;

  const load = async (url: string) => {
    if (json !== undefined) return;
    try {
      // Decode a data: URL directly. Fetching it would be pointless here and
      // would need connect-src permission on a published page.
      if (url.startsWith('data:')) {
        const base64 = url.slice(url.indexOf(',') + 1);
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        setJson(new TextDecoder().decode(bytes));
        return;
      }
      setJson(await (await fetch(url)).text());
    } catch {
      setJson('The export could not be read back in this preview.');
    }
  };

  if (preview && !isImage) void load(preview.url);

  return (
    <Dialog.Root
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open) {
          setJson(undefined);
          setCopied(false);
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog}>
          {preview && (
            <>
              <Dialog.Title className={styles.title}>{preview.kind.replace(/-/g, ' ')}</Dialog.Title>
              <Dialog.Description className={styles.description}>
                {preview.size} · carries full source-to-target provenance. Downloads are blocked in this embedded
                preview; running the app locally writes a real file.
              </Dialog.Description>

              {isImage ? (
                <div className={styles.imageFrame}>
                  <img src={preview.url} alt={`${preview.kind} export`} className={styles.image} />
                </div>
              ) : (
                <>
                  <pre className={styles.json}>{json ?? 'Reading…'}</pre>
                  <button
                    type="button"
                    className={styles.copy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(json ?? '');
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? 'Copied' : 'Copy JSON'}
                  </button>
                </>
              )}

              <Dialog.Close className={styles.close}>Close</Dialog.Close>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
