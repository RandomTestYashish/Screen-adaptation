import { luma, modalColor, pixelAt, perceptualDistance, type Box, type PixelData, type Rgb } from './pixels.js';

/**
 * Text-line detection and font-metric estimation.
 *
 * Text is not read here - no OCR runs, and none is needed. What adaptation
 * requires is the *geometry* of type: where the lines are, how tall the glyphs
 * are, what colour they are and how they are aligned. Those are measurable
 * directly, and unlike recognised characters they cannot be hallucinated.
 */

export interface TextLine {
  box: Box;
  /** Distance between the tops of consecutive lines in the same block. */
  lineHeight: number;
  /** Height of the tallest glyph, i.e. cap height plus any ascender. */
  glyphHeight: number;
  /** Estimated CSS font-size. */
  fontSize: number;
  /** Ink colour. */
  color: Rgb;
  /** Colour behind the glyphs. */
  background: Rgb;
  /** Stroke thickness relative to glyph height, the basis for weight. */
  strokeRatio: number;
  fontWeight: number;
  align: 'left' | 'center' | 'right';
  confidence: number;
}

export interface TextBlock {
  box: Box;
  lines: TextLine[];
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  color: Rgb;
  align: 'left' | 'center' | 'right';
  confidence: number;
}

/**
 * Ascender-to-baseline is about 0.75 em in the faces UI is set in (SF, Roboto,
 * Inter all sit within a few percent), so font-size is that height divided by
 * the ratio.
 *
 * Measuring to the *baseline* rather than to the bottom of the ink matters: a
 * line containing a descender - the "g" in "Good morning" - has ink extending
 * well below the baseline, and dividing that full extent by a cap-height ratio
 * over-estimates the size by around a third. Every value derived from this is
 * reported as `inferred`, never `detected`.
 */
const ASCENDER_RATIO = 0.75;

/**
 * Find lines of text inside a region.
 *
 * The signal is a row-wise ink profile: text produces short, dense, regularly
 * spaced runs of ink separated by clean gaps, which is what distinguishes it
 * from an icon (one tall run) or a photograph (ink everywhere).
 */
export function detectTextLines(image: PixelData, region: Box, background: Rgb): TextLine[] {
  const x1 = Math.max(0, Math.floor(region.x));
  const y1 = Math.max(0, Math.floor(region.y));
  const x2 = Math.min(image.width, Math.ceil(region.x + region.width));
  const y2 = Math.min(image.height, Math.ceil(region.y + region.height));
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < 4 || height < 4) return [];

  const backgroundLuma = luma(background);
  const inkPerRow = new Uint16Array(height);
  const firstInkPerRow = new Int32Array(height).fill(-1);
  const lastInkPerRow = new Int32Array(height).fill(-1);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const pixel = pixelAt(image, x1 + col, y1 + row);
      if (Math.abs(luma(pixel) - backgroundLuma) > 40) {
        inkPerRow[row] = (inkPerRow[row] ?? 0) + 1;
        if (firstInkPerRow[row] === -1) firstInkPerRow[row] = col;
        lastInkPerRow[row] = col;
      }
    }
  }

  // Group consecutive inked rows into candidate lines.
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let row = 0; row < height; row += 1) {
    const inked = (inkPerRow[row] ?? 0) > 0;
    if (inked && start < 0) start = row;
    else if (!inked && start >= 0) {
      runs.push({ start, end: row - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: height - 1 });

  const lines: TextLine[] = [];
  for (const run of runs) {
    const glyphHeight = run.end - run.start + 1;
    // Below ~6px nothing is legible type; above ~64px it is a graphic, not a
    // line of UI text.
    if (glyphHeight < 6 || glyphHeight > 64) continue;

    let minCol = width;
    let maxCol = -1;
    let inkTotal = 0;
    for (let row = run.start; row <= run.end; row += 1) {
      const first = firstInkPerRow[row] ?? -1;
      const last = lastInkPerRow[row] ?? -1;
      if (first >= 0 && first < minCol) minCol = first;
      if (last > maxCol) maxCol = last;
      inkTotal += inkPerRow[row] ?? 0;
    }
    if (maxCol < 0) continue;

    const lineWidth = maxCol - minCol + 1;
    const coverage = inkTotal / Math.max(1, lineWidth * glyphHeight);

    // Type covers roughly 12-55% of its bounding box. Denser is a filled shape;
    // sparser is a rule or a stray mark.
    if (coverage < 0.1 || coverage > 0.62) continue;
    // A single glyph is as tall as it is wide; a line of text is much wider.
    if (lineWidth < glyphHeight * 1.2) continue;

    const box: Box = { x: x1 + minCol, y: y1 + run.start, width: lineWidth, height: glyphHeight };
    const ink = inkColor(image, box, background);
    const strokeRatio = estimateStrokeRatio(image, box, background);
    const baseline = findBaseline(inkPerRow, run.start, run.end);
    const ascenderHeight = baseline - run.start + 1;

    lines.push({
      box,
      lineHeight: glyphHeight,
      glyphHeight,
      fontSize: Math.max(6, Math.round(ascenderHeight / ASCENDER_RATIO)),
      color: ink,
      background,
      strokeRatio,
      fontWeight: weightFromStroke(strokeRatio),
      align: alignmentOf(box, region),
      // Coverage in the middle of the plausible band is the strongest signal.
      confidence: Math.max(0.35, Math.min(0.9, 1 - Math.abs(coverage - 0.3) * 2)),
    });
  }

  return assignLineHeights(lines);
}

/**
 * The baseline of a line of text.
 *
 * Most glyphs stop at the baseline, so the ink count falls sharply there. Only
 * descenders continue below, and they are a minority of characters - which is
 * exactly what makes the drop detectable. Searching the lower part of the run
 * avoids mistaking the x-height shoulder for the baseline.
 */
function findBaseline(inkPerRow: Uint16Array, start: number, end: number): number {
  const height = end - start + 1;
  if (height < 4) return end;

  let peak = 0;
  for (let row = start; row <= end; row += 1) peak = Math.max(peak, inkPerRow[row] ?? 0);
  if (peak === 0) return end;

  // Scan the bottom 55% of the run for the largest fall in ink between
  // consecutive rows.
  const from = start + Math.floor(height * 0.45);
  let bestRow = end;
  let bestDrop = 0;
  for (let row = from; row < end; row += 1) {
    const drop = (inkPerRow[row] ?? 0) - (inkPerRow[row + 1] ?? 0);
    if (drop > bestDrop) {
      bestDrop = drop;
      bestRow = row;
    }
  }

  // A convincing baseline loses most of its ink in one row. Without that, the
  // line is probably all-caps or has no descenders, and the ink bottom is the
  // baseline.
  return bestDrop >= peak * 0.35 ? bestRow : end;
}

/** Mean colour of the inked pixels only, so the background does not dilute it. */
function inkColor(image: PixelData, box: Box, background: Rgb): Rgb {
  const backgroundLuma = luma(background);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  let darkest = { color: background, delta: 0 };

  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const pixel = pixelAt(image, x, y);
      const delta = Math.abs(luma(pixel) - backgroundLuma);
      // Only fully-inked pixels: antialiased edges sit between ink and paper
      // and would wash the colour out toward the background.
      if (delta > 90) {
        r += pixel.r;
        g += pixel.g;
        b += pixel.b;
        count += 1;
      }
      if (delta > darkest.delta) darkest = { color: pixel, delta };
    }
  }

  if (count === 0) return darkest.color;
  return { r: r / count, g: g / count, b: b / count };
}

/**
 * Mean horizontal run length of ink, normalised by glyph height.
 *
 * This tracks stem thickness, which is what actually separates Regular from
 * Bold at the same size.
 */
function estimateStrokeRatio(image: PixelData, box: Box, background: Rgb): number {
  const backgroundLuma = luma(background);
  const runs: number[] = [];

  for (let y = box.y; y < box.y + box.height; y += 1) {
    let run = 0;
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const inked = Math.abs(luma(pixelAt(image, x, y)) - backgroundLuma) > 90;
      if (inked) run += 1;
      else if (run > 0) {
        // Ignore very long runs: those are underlines or filled bars, not stems.
        if (run <= box.height) runs.push(run);
        run = 0;
      }
    }
    if (run > 0 && run <= box.height) runs.push(run);
  }

  if (runs.length === 0) return 0.1;
  runs.sort((a, b) => a - b);
  // The 25th percentile, not the median: stems are the *thinnest* recurring
  // feature, while bowls and horizontal bars produce much longer runs that
  // would inflate a median and make every face look bold.
  const stem = runs[Math.floor(runs.length * 0.25)] ?? 1;
  return stem / Math.max(1, box.height);
}

/**
 * Map stroke ratio to a CSS weight.
 *
 * Deliberately coarse - only regular / medium / semibold / bold are
 * distinguishable from a rasterised screenshot at UI sizes, so claiming finer
 * granularity would be false precision.
 */
function weightFromStroke(ratio: number): number {
  // Calibrated against rendered specimens at UI sizes. Deliberately biased
  // toward 400: claiming a weight the pixels do not clearly support would be
  // exactly the false precision this system is meant to avoid, and an
  // over-reported weight would propagate into the extracted type scale.
  if (ratio >= 0.135) return 700;
  if (ratio >= 0.105) return 600;
  return 400;
}

function alignmentOf(box: Box, region: Box): 'left' | 'center' | 'right' {
  const leftGap = box.x - region.x;
  const rightGap = region.x + region.width - (box.x + box.width);
  const tolerance = Math.max(4, region.width * 0.04);
  if (Math.abs(leftGap - rightGap) <= tolerance) return 'center';
  return rightGap < leftGap - tolerance ? 'right' : 'left';
}

/** Line-height is the baseline-to-baseline distance, not the glyph height. */
function assignLineHeights(lines: TextLine[]): TextLine[] {
  if (lines.length < 2) {
    return lines.map((line) => ({ ...line, lineHeight: Math.round(line.fontSize * 1.4) }));
  }
  return lines.map((line, index) => {
    const next = lines[index + 1];
    const previous = lines[index - 1];
    const gap = next ? next.box.y - line.box.y : previous ? line.box.y - previous.box.y : 0;
    // A gap far larger than the type is a paragraph break, not a line advance.
    const plausible = gap > 0 && gap < line.fontSize * 2.6;
    return { ...line, lineHeight: plausible ? gap : Math.round(line.fontSize * 1.4) };
  });
}

/**
 * Group lines that share size, weight, colour and alignment and sit directly
 * beneath one another - the paragraph a designer would select as one text
 * element.
 */
export function groupTextLines(lines: TextLine[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: TextLine[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const box = current.reduce(
      (acc, line) => ({
        x: Math.min(acc.x, line.box.x),
        y: Math.min(acc.y, line.box.y),
        width: Math.max(acc.x + acc.width, line.box.x + line.box.width) - Math.min(acc.x, line.box.x),
        height: Math.max(acc.y + acc.height, line.box.y + line.box.height) - Math.min(acc.y, line.box.y),
      }),
      current[0]!.box,
    );
    const first = current[0]!;
    blocks.push({
      box,
      lines: current,
      fontSize: median(current.map((l) => l.fontSize)),
      lineHeight: median(current.map((l) => l.lineHeight)),
      fontWeight: median(current.map((l) => l.fontWeight)),
      color: first.color,
      align: first.align,
      confidence: current.reduce((sum, l) => sum + l.confidence, 0) / current.length,
    });
    current = [];
  };

  for (const line of lines) {
    const previous = current[current.length - 1];
    if (!previous) {
      current.push(line);
      continue;
    }
    const sameStyle =
      Math.abs(previous.fontSize - line.fontSize) <= Math.max(1, previous.fontSize * 0.12) &&
      previous.fontWeight === line.fontWeight &&
      previous.align === line.align &&
      perceptualDistance(previous.color, line.color) < 0.06;
    const gap = line.box.y - (previous.box.y + previous.box.height);
    const consecutive = gap >= -2 && gap <= previous.fontSize * 1.2;

    if (sameStyle && consecutive) current.push(line);
    else {
      flush();
      current.push(line);
    }
  }
  flush();

  return blocks;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Background immediately behind a text block, for contrast and surfaces. */
export function backgroundBehind(image: PixelData, box: Box, pageBackground: Rgb): Rgb {
  const pad = 3;
  const strip: Box = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: Math.min(pad, box.y),
  };
  if (strip.height < 1) return pageBackground;
  return modalColor(image, strip, 1).color;
}
