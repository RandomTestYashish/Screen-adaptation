import {
  boxArea,
  colorsMatch,
  containsBox,
  luma,
  modalColor,
  perceptualDistance,
  pixelAt,
  unionBox,
  type Box,
  type PixelData,
  type Rgb,
} from './pixels.js';

/**
 * Structural segmentation of a UI screenshot.
 *
 * UI screenshots are not photographs: they are axis-aligned, flat-shaded and
 * high-contrast. That makes classical segmentation - projection profiles and
 * connected components over a background-difference mask - both accurate and
 * cheap, with no model to download and no network call. Every result carries a
 * confidence so the caller can fall back to preserving the original pixels.
 */

export interface HorizontalBand {
  /** Top edge in source pixels. */
  y: number;
  height: number;
  /** Fraction of rows in this band that differ from the page background. */
  density: number;
}

export interface Segment {
  box: Box;
  /** Dominant colour of the segment. */
  color: Rgb;
  /** Colour immediately surrounding it. */
  surroundingColor: Rgb;
  /** 0..1, how flat the segment's interior is. */
  uniformity: number;
  /** Pixels in the mask relative to the box area. */
  fill: number;
}

/**
 * The page background.
 *
 * Sampled from the outer margin rather than the whole image, because the
 * middle of a screen is mostly content and would bias the estimate.
 */
export function detectBackground(image: PixelData): { color: Rgb; confidence: number } {
  const margin = Math.max(3, Math.round(image.width * 0.02));

  /*
   * Only the left and right edges are sampled.
   *
   * On a mobile screen the top and bottom are usually full-bleed chrome - a
   * dark header, a tab bar - and including them elects that chrome as the page
   * background, which then makes the entire screen read as one giant "content"
   * region. The vertical edges are the part of the canvas the background
   * actually reaches.
   */
  const strips: Box[] = [
    { x: 0, y: 0, width: margin, height: image.height },
    { x: image.width - margin, y: 0, width: margin, height: image.height },
  ];

  const votes = new Map<string, { color: Rgb; weight: number }>();
  for (const strip of strips) {
    const { color, share } = modalColor(image, strip, 2);
    const key = `${Math.round(color.r / 8)}:${Math.round(color.g / 8)}:${Math.round(color.b / 8)}`;
    const vote = votes.get(key) ?? { color, weight: 0 };
    vote.weight += share;
    votes.set(key, vote);
  }

  let best = { color: { r: 255, g: 255, b: 255 }, weight: 0 };
  let totalWeight = 0;
  for (const vote of votes.values()) {
    totalWeight += vote.weight;
    if (vote.weight > best.weight) best = vote;
  }

  return {
    color: best.color,
    // Both edges agreeing is the strong case; disagreement means the design is
    // split or full-bleed, and downstream confidence should reflect that.
    confidence: totalWeight === 0 ? 0 : Math.min(1, best.weight / totalWeight),
  };
}

/**
 * Rows that differ from the background, grouped into bands.
 *
 * This is what separates a header from the content beneath it, and one card
 * from the next, without knowing anything about either.
 */
export function detectHorizontalBands(
  image: PixelData,
  background: Rgb,
  options: { minGap?: number; step?: number } = {},
): HorizontalBand[] {
  const step = options.step ?? 2;
  const minGap = options.minGap ?? 4;

  const rowDensity = new Float32Array(image.height);
  for (let y = 0; y < image.height; y += 1) {
    let differing = 0;
    let sampled = 0;
    for (let x = 0; x < image.width; x += step) {
      if (!colorsMatch(pixelAt(image, x, y), background, 0.03)) differing += 1;
      sampled += 1;
    }
    rowDensity[y] = sampled === 0 ? 0 : differing / sampled;
  }

  // A row counts as content if even a small fraction differs: a thin divider or
  // a line of small text occupies very few pixels.
  const CONTENT_THRESHOLD = 0.01;
  const bands: HorizontalBand[] = [];
  let start = -1;
  let gap = 0;

  for (let y = 0; y < image.height; y += 1) {
    const isContent = (rowDensity[y] ?? 0) > CONTENT_THRESHOLD;
    if (isContent) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      // Only close the band once the empty run is long enough to be real
      // spacing rather than the gap between two lines of text.
      if (gap >= minGap) {
        const end = y - gap;
        pushBand(bands, rowDensity, start, end);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) pushBand(bands, rowDensity, start, image.height - 1);

  return bands;
}

function pushBand(bands: HorizontalBand[], rowDensity: Float32Array, start: number, end: number): void {
  const height = end - start + 1;
  if (height <= 0) return;
  let sum = 0;
  for (let y = start; y <= end; y += 1) sum += rowDensity[y] ?? 0;
  bands.push({ y: start, height, density: sum / height });
}

/**
 * Connected components of "not the background", within a band.
 *
 * Iterative flood fill on a coarse grid: a per-pixel scan of a 375x2400 image
 * is wasteful when the smallest thing worth finding is a few pixels across,
 * and recursion would overflow the stack on large flat regions.
 */
export function detectSegments(
  image: PixelData,
  background: Rgb,
  region: Box,
  options: { grid?: number; minArea?: number } = {},
): Segment[] {
  const grid = options.grid ?? 2;
  const minArea = options.minArea ?? 16;

  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(image.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(image.height, Math.ceil(region.y + region.height));

  const cols = Math.ceil((x1 - x0) / grid);
  const rows = Math.ceil((y1 - y0) / grid);
  if (cols <= 0 || rows <= 0) return [];

  const mask = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const color = pixelAt(image, x0 + col * grid, y0 + row * grid);
      mask[row * cols + col] = colorsMatch(color, background, 0.03) ? 0 : 1;
    }
  }

  const visited = new Uint8Array(cols * rows);
  const segments: Segment[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || visited[start] === 1) continue;

    stack.length = 0;
    stack.push(start);
    visited[start] = 1;

    let minCol = cols;
    let maxCol = -1;
    let minRow = rows;
    let maxRow = -1;
    let filled = 0;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const col = index % cols;
      const row = (index - col) / cols;

      filled += 1;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;

      // 8-connectivity, so a 1px diagonal antialiased edge does not split a
      // component in two.
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const neighbour = nr * cols + nc;
          if (visited[neighbour] === 1 || mask[neighbour] !== 1) continue;
          visited[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }

    const box: Box = {
      x: x0 + minCol * grid,
      y: y0 + minRow * grid,
      width: (maxCol - minCol + 1) * grid,
      height: (maxRow - minRow + 1) * grid,
    };
    if (boxArea(box) < minArea) continue;

    const inner = modalColor(image, box, Math.max(1, Math.floor(grid / 2)));
    segments.push({
      box,
      color: inner.color,
      surroundingColor: background,
      uniformity: inner.share,
      fill: filled / Math.max(1, (maxCol - minCol + 1) * (maxRow - minRow + 1)),
    });
  }

  return segments.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

/**
 * Merge segments that clearly belong to one element.
 *
 * A rounded card with a border can arrive as several fragments, and the glyphs
 * of a word are always separate components. Merging by proximity recovers the
 * element a designer would name.
 */
export function mergeNearby(segments: Segment[], gapX: number, gapY: number): Segment[] {
  const merged: Segment[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < segments.length; i += 1) {
    if (consumed.has(i)) continue;
    let current = segments[i]!;
    let changed = true;

    while (changed) {
      changed = false;
      for (let j = i + 1; j < segments.length; j += 1) {
        if (consumed.has(j)) continue;
        const other = segments[j]!;
        if (!withinGap(current.box, other.box, gapX, gapY)) continue;
        current = {
          ...current,
          box: unionBox(current.box, other.box),
          uniformity: Math.min(current.uniformity, other.uniformity),
        };
        consumed.add(j);
        changed = true;
      }
    }
    merged.push(current);
  }

  return merged.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

function withinGap(a: Box, b: Box, gapX: number, gapY: number): boolean {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return dx <= gapX && dy <= gapY;
}

/** Drop segments fully inside a larger one, keeping the container. */
export function dropContained(segments: Segment[]): Segment[] {
  return segments.filter(
    (segment, index) =>
      !segments.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          boxArea(other.box) > boxArea(segment.box) &&
          containsBox(other.box, segment.box, 2),
      ),
  );
}

/**
 * Corner radius, measured by walking the diagonal in from a box corner until
 * the fill colour appears. Returns 0 for a square corner.
 */
export function estimateCornerRadius(image: PixelData, box: Box, fill: Rgb): number {
  const limit = Math.min(40, Math.floor(Math.min(box.width, box.height) / 2));
  if (limit < 2) return 0;

  /*
   * A tight tolerance is essential here. A light grey surface on a white page
   * is only ~0.04 apart in OKLab, so the looser tolerance used elsewhere
   * reports a match at the very first pixel and every rounded card measures as
   * a square corner.
   */
  const TOLERANCE = 0.025;

  // A corner already showing the fill is square by definition.
  if (colorsMatch(pixelAt(image, box.x, box.y), fill, TOLERANCE)) return 0;

  for (let step = 1; step <= limit; step += 1) {
    if (colorsMatch(pixelAt(image, box.x + step, box.y + step), fill, TOLERANCE)) {
      // The diagonal of a circular corner of radius r first meets the fill at
      // r * (1 - 1/sqrt2) from the corner.
      return Math.round(step / (1 - Math.SQRT1_2));
    }
  }
  return 0;
}

/** Vertical edge strength, used to tell text from flat shapes. */
export function edgeDensity(image: PixelData, box: Box): number {
  let edges = 0;
  let samples = 0;
  const x1 = Math.max(1, Math.floor(box.x));
  const y1 = Math.max(0, Math.floor(box.y));
  const x2 = Math.min(image.width - 1, Math.ceil(box.x + box.width));
  const y2 = Math.min(image.height, Math.ceil(box.y + box.height));

  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const left = luma(pixelAt(image, x - 1, y));
      const here = luma(pixelAt(image, x, y));
      if (Math.abs(here - left) > 28) edges += 1;
      samples += 1;
    }
  }
  return samples === 0 ? 0 : edges / samples;
}

/** True when the region's colour changes steadily along one axis. */
export function detectGradient(
  image: PixelData,
  box: Box,
): { direction: 'vertical' | 'horizontal'; from: Rgb; to: Rgb; confidence: number } | undefined {
  const sample = (fx: number, fy: number) =>
    modalColor(
      image,
      {
        x: box.x + box.width * fx,
        y: box.y + box.height * fy,
        width: Math.max(2, box.width * 0.2),
        height: Math.max(2, box.height * 0.2),
      },
      1,
    ).color;

  const top = sample(0.4, 0.02);
  const middleV = sample(0.4, 0.4);
  const bottom = sample(0.4, 0.78);
  const left = sample(0.02, 0.4);
  const right = sample(0.78, 0.4);

  const verticalSpread = perceptualDistance(top, bottom);
  const horizontalSpread = perceptualDistance(left, right);
  const MIN_SPREAD = 0.06;

  // A gradient is a *monotonic* ramp: the midpoint must sit between the ends,
  // which is what distinguishes it from two stacked blocks of flat colour.
  if (verticalSpread > MIN_SPREAD && verticalSpread > horizontalSpread * 1.5) {
    const midpointError =
      Math.abs(perceptualDistance(top, middleV) + perceptualDistance(middleV, bottom) - verticalSpread) /
      verticalSpread;
    if (midpointError < 0.35) {
      return { direction: 'vertical', from: top, to: bottom, confidence: Math.min(1, 1 - midpointError) };
    }
  }
  if (horizontalSpread > MIN_SPREAD && horizontalSpread > verticalSpread * 1.5) {
    const middleH = sample(0.4, 0.4);
    const midpointError =
      Math.abs(perceptualDistance(left, middleH) + perceptualDistance(middleH, right) - horizontalSpread) /
      horizontalSpread;
    if (midpointError < 0.35) {
      return { direction: 'horizontal', from: left, to: right, confidence: Math.min(1, 1 - midpointError) };
    }
  }
  return undefined;
}
