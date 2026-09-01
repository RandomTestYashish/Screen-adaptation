/**
 * Capture a rendered preview to a PNG data URL.
 *
 * This walks the rendered DOM and redraws it on a canvas rather than scraping a
 * single image element. A reconstructed design is a tree - containers with
 * fills and radii, crops of the original bitmap, text - so drawing only the
 * first `<img>` would have exported one region and called it the screen.
 *
 * Everything drawn comes from the live computed style, so the export is what is
 * actually on screen and not a second interpretation of the plan. Where a
 * feature cannot be reproduced faithfully (an unparsed background image, a
 * tainted cross-origin bitmap) the capture reports it instead of quietly
 * dropping it, and the caller surfaces that to the user.
 */

export interface CaptureResult {
  dataUrl: string;
  /** Things the canvas could not reproduce exactly. Never silently dropped. */
  warnings: string[];
}

export async function captureViewport(
  paneId: string,
  fullLength: boolean,
): Promise<CaptureResult | undefined> {
  const pane = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
  if (!pane) return undefined;
  const viewport = pane.querySelector<HTMLElement>('[data-testid="design-viewport"]');
  const documentEl = pane.querySelector<HTMLElement>('[data-testid="design-document"]');
  if (!viewport || !documentEl) return undefined;

  const width = documentEl.offsetWidth;
  const height = fullLength ? documentEl.offsetHeight : viewport.clientHeight;
  const scrollTop = fullLength ? 0 : viewport.scrollTop;
  if (width === 0 || height === 0) return undefined;

  const { canvas, context, ratio } = makeCanvas(width, height);
  if (!context) return undefined;

  const warnings: string[] = [];
  const origin = documentEl.getBoundingClientRect();
  // Scrolling moves the document under the viewport; shifting the origin by the
  // scroll offset exports the region the designer is looking at.
  context.translate(0, -scrollTop);
  drawElement(context, documentEl, origin, warnings, ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  // Fixed elements live outside the scroller, pinned to the viewport, so they
  // are drawn last and without the scroll offset - exactly as the browser
  // composites them.
  if (!fullLength) {
    const fixed = pane.querySelector<HTMLElement>('[data-testid="fixed-layer"]');
    if (fixed) drawElement(context, fixed, origin, warnings, ratio);
  }

  return finish(canvas, warnings);
}

/**
 * Capture two or more previews into one image (spec section 41).
 *
 * The comparison itself is the deliverable, so the export has to be the
 * comparison and not two files a reader has to align by hand. Each pane is
 * drawn at its own viewport size with its device name beneath it, because the
 * difference in viewport size *is* the finding.
 */
export async function captureCompare(
  panes: { id: string; label: string; deviceName: string }[],
): Promise<CaptureResult | undefined> {
  const GAP = 32;
  const CAPTION = 34;
  const PADDING = 24;

  const shots: { image: HTMLCanvasElement; label: string; deviceName: string }[] = [];
  const warnings: string[] = [];

  for (const pane of panes) {
    const shot = await captureViewport(pane.id, false);
    if (!shot) continue;
    const image = await loadCanvas(shot.dataUrl);
    if (!image) continue;
    warnings.push(...shot.warnings);
    shots.push({ image, label: pane.label, deviceName: pane.deviceName });
  }
  if (shots.length === 0) return undefined;

  const scale = window.devicePixelRatio || 1;
  const widths = shots.map((s) => s.image.width / scale);
  const heights = shots.map((s) => s.image.height / scale);
  const width = PADDING * 2 + widths.reduce((a, b) => a + b, 0) + GAP * (shots.length - 1);
  const height = PADDING * 2 + Math.max(...heights) + CAPTION;

  const { canvas, context, ratio } = makeCanvas(width, height);
  if (!context) return undefined;
  context.fillStyle = '#f4f4f6';
  context.fillRect(0, 0, width, height);

  let x = PADDING;
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i]!;
    const w = widths[i]!;
    const h = heights[i]!;
    context.drawImage(shot.image, x, PADDING, w, h);
    context.strokeStyle = '#d0d0d6';
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, PADDING + 0.5, w - 1, h - 1);

    context.fillStyle = '#1c1c20';
    context.font = '600 13px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(`${shot.label} · ${shot.deviceName}`, x + w / 2, PADDING + h + 20);
    context.fillStyle = '#5c5c66';
    context.font = '11px system-ui, sans-serif';
    context.fillText(`${Math.round(w)} x ${Math.round(h)} px viewport`, x + w / 2, PADDING + h + 33);
    x += w + GAP;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  return finish(canvas, warnings);
}

// --- drawing -----------------------------------------------------------------

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context?.scale(ratio, ratio);
  return { canvas, context, ratio };
}

function finish(canvas: HTMLCanvasElement, warnings: string[]): CaptureResult | undefined {
  try {
    return { dataUrl: canvas.toDataURL('image/png'), warnings: [...new Set(warnings)] };
  } catch {
    // A cross-origin bitmap tainted the canvas. Report failure rather than
    // returning a blank export.
    return undefined;
  }
}

function loadCanvas(dataUrl: string): Promise<HTMLCanvasElement | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

function drawElement(
  context: CanvasRenderingContext2D,
  element: HTMLElement,
  origin: DOMRect,
  warnings: string[],
  ratio: number,
): void {
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return;
  const opacity = Number(style.opacity || '1');
  if (opacity === 0) return;

  const rect = element.getBoundingClientRect();
  const x = rect.left - origin.left;
  const y = rect.top - origin.top;
  const w = rect.width;
  const h = rect.height;
  if (w === 0 || h === 0) return;

  context.save();
  context.globalAlpha *= opacity;

  const path = roundedRect(x, y, w, h, radii(style, w, h));

  const background = style.backgroundColor;
  if (background && background !== 'transparent' && !background.startsWith('rgba(0, 0, 0, 0)')) {
    context.fillStyle = background;
    context.fill(path);
  }

  const backgroundImage = style.backgroundImage;
  if (backgroundImage && backgroundImage !== 'none') {
    const gradient = linearGradient(context, backgroundImage, x, y, w, h);
    if (gradient) {
      context.fillStyle = gradient;
      context.fill(path);
    } else {
      warnings.push('A background image or gradient could not be reproduced in the export and is missing from it.');
    }
  }

  if (element instanceof HTMLImageElement) {
    if (element.complete && element.naturalWidth > 0) {
      context.save();
      context.clip(path);
      context.drawImage(element, x, y, w, h);
      context.restore();
    } else {
      warnings.push('An image had not finished loading and is missing from the export.');
    }
  }

  const border = borderStroke(style);
  if (border) {
    context.strokeStyle = border.color;
    context.lineWidth = border.width;
    context.stroke(path);
  }

  if (isTextLeaf(element)) drawText(context, element, style, x, y, w, h);

  // Clip children the way the browser does, so a cropped bitmap stays inside
  // its frame instead of painting over its neighbours.
  if (style.overflow !== 'visible') context.clip(path);
  for (const child of Array.from(element.children)) {
    if (child instanceof HTMLElement) drawElement(context, child, origin, warnings, ratio);
    else if (child instanceof SVGElement) warnings.push('A vector element could not be reproduced in the export.');
  }

  context.restore();
}

function isTextLeaf(element: HTMLElement): boolean {
  if (element.childElementCount > 0) return false;
  return (element.textContent ?? '').trim().length > 0;
}

function drawText(
  context: CanvasRenderingContext2D,
  element: HTMLElement,
  style: CSSStyleDeclaration,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const text = (element.textContent ?? '').trim();
  if (!text) return;

  context.save();
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
  context.fillStyle = style.color;
  context.textBaseline = 'alphabetic';

  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  const available = Math.max(1, w - padLeft - padRight);
  const fontSize = parseFloat(style.fontSize) || 12;
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;

  const align = style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left';
  context.textAlign = align;
  const anchorX = align === 'center' ? x + w / 2 : align === 'right' ? x + w - padRight : x + padLeft;

  // Wrap at the same width the browser had, so an exported line breaks where
  // the rendered line broke.
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width > available && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const blockHeight = lines.length * lineHeight;
  const justify = style.justifyContent;
  const offsetY =
    justify === 'center' ? (h - blockHeight) / 2 : justify === 'flex-end' ? h - blockHeight - padTop : padTop;

  lines.forEach((line, index) => {
    // Baseline sits roughly 80% down the line box, matching normal metrics.
    context.fillText(line, anchorX, y + offsetY + index * lineHeight + lineHeight * 0.5 + fontSize * 0.35);
  });
  context.restore();
}

function radii(style: CSSStyleDeclaration, w: number, h: number): [number, number, number, number] {
  const parse = (value: string) => Math.min(Math.max(parseFloat(value) || 0, 0), Math.min(w, h) / 2);
  return [
    parse(style.borderTopLeftRadius),
    parse(style.borderTopRightRadius),
    parse(style.borderBottomRightRadius),
    parse(style.borderBottomLeftRadius),
  ];
}

function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number],
): Path2D {
  const path = new Path2D();
  path.moveTo(x + tl, y);
  path.lineTo(x + w - tr, y);
  path.arcTo(x + w, y, x + w, y + tr, tr);
  path.lineTo(x + w, y + h - br);
  path.arcTo(x + w, y + h, x + w - br, y + h, br);
  path.lineTo(x + bl, y + h);
  path.arcTo(x, y + h, x, y + h - bl, bl);
  path.lineTo(x, y + tl);
  path.arcTo(x, y, x + tl, y, tl);
  path.closePath();
  return path;
}

function borderStroke(style: CSSStyleDeclaration): { color: string; width: number } | undefined {
  const width = parseFloat(style.borderTopWidth) || 0;
  if (width === 0 || style.borderTopStyle === 'none') return undefined;
  const color = style.borderTopColor;
  if (!color || color.startsWith('rgba(0, 0, 0, 0)')) return undefined;
  return { color, width };
}

/**
 * Rebuild the linear gradients this app itself emits. Parsing arbitrary CSS
 * gradients is out of scope; anything else is reported as missing rather than
 * approximated with a colour that was never in the design.
 */
function linearGradient(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
): CanvasGradient | undefined {
  const match = /^linear-gradient\(([-\d.]+)deg,\s*(.+)\)$/.exec(value.trim());
  if (!match) return undefined;
  const degrees = parseFloat(match[1]!);
  const stops = splitStops(match[2]!);
  if (stops.length < 2) return undefined;

  // CSS 0deg points up and turns clockwise; canvas coordinates are y-down.
  const radians = ((degrees - 90) * Math.PI) / 180;
  const half = Math.abs(w * Math.cos(radians)) / 2 + Math.abs(h * Math.sin(radians)) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const gradient = context.createLinearGradient(
    cx - Math.cos(radians) * half,
    cy - Math.sin(radians) * half,
    cx + Math.cos(radians) * half,
    cy + Math.sin(radians) * half,
  );

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i]!;
    const percent = /(-?[\d.]+)%\s*$/.exec(stop);
    const offset = percent ? parseFloat(percent[1]!) / 100 : i / (stops.length - 1);
    const color = percent ? stop.slice(0, percent.index).trim() : stop.trim();
    gradient.addColorStop(Math.min(1, Math.max(0, offset)), color);
  }
  return gradient;
}

/** Split on commas that are not inside `rgb(...)` / `rgba(...)`. */
function splitStops(value: string): string[] {
  const stops: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      stops.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) stops.push(current.trim());
  return stops;
}
