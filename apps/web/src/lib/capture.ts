/**
 * Capture a rendered preview to a PNG data URL.
 *
 * The browser cannot rasterise arbitrary DOM without a third-party library, so
 * this handles the case it *can* do faithfully: a raster source, where the
 * design layer is a single image element. When the design is structured, it
 * returns undefined and the caller says so plainly rather than exporting a
 * blank or partial image.
 */
export async function captureViewport(paneId: string, fullLength: boolean): Promise<string | undefined> {
  const pane = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`) ?? document.body;
  const viewport = pane.querySelector<HTMLElement>('[data-testid="design-viewport"]');
  const documentEl = pane.querySelector<HTMLElement>('[data-testid="design-document"]');
  if (!viewport || !documentEl) return undefined;

  const image = documentEl.querySelector('img');
  if (!image || !(image instanceof HTMLImageElement) || !image.complete) return undefined;

  const width = documentEl.offsetWidth;
  const height = fullLength ? documentEl.offsetHeight : viewport.clientHeight;
  const scrollTop = fullLength ? 0 : viewport.scrollTop;
  if (width === 0 || height === 0) return undefined;

  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.scale(ratio, ratio);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  try {
    // Draw the artwork at its adapted size, offset by the current scroll, so
    // the export is exactly what the designer is looking at.
    context.drawImage(image, 0, -scrollTop, documentEl.offsetWidth, documentEl.offsetHeight);
    return canvas.toDataURL('image/png');
  } catch {
    // A cross-origin image taints the canvas; report failure honestly rather
    // than returning a blank export.
    return undefined;
  }
}
