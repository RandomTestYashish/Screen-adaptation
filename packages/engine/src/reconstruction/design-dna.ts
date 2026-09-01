import { perceptualDistance, toHex, type Box, type Rgb } from './pixels.js';
import type { TextBlock } from './text-detection.js';

/**
 * The Design DNA: the design system the source is actually built from.
 *
 * Everything here is *measured from the source*, never assumed. The
 * reconstruction is then constrained to these tokens, which is what stops the
 * pipeline quietly substituting a default font, a rounder radius or an 8px
 * grid the design never used (spec sections 5, 6 and 34).
 */

export type MeasurementType = 'DETECTED' | 'INFERRED' | 'DEVICE_DATABASE' | 'USER_DEFINED' | 'UNKNOWN';

export interface Measured<T> {
  value: T;
  measurementType: MeasurementType;
  confidence: number;
  source: string;
}

export interface ColorToken {
  hex: string;
  rgb: Rgb;
  /** Share of analysed area this colour covers. */
  coverage: number;
  role: 'background' | 'surface' | 'text-primary' | 'text-secondary' | 'accent' | 'border' | 'other';
  confidence: number;
}

export interface TypographyToken {
  name: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  color: string;
  /** How many blocks in the source use this token. */
  usage: number;
  confidence: number;
}

export interface SpacingToken {
  value: number;
  usage: number;
}

export interface DesignDna {
  version: string;
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: Measured<SpacingToken[]>;
  grid: Measured<number | null>;
  radii: Measured<number[]>;
  /**
   * Type is baked into a bitmap, so the family can never be *measured* from
   * one. It is left null rather than guessed (spec section 53).
   */
  fontFamily: Measured<string | null>;
  edgeMargin: Measured<number | null>;
  locked: boolean;
}

export const DESIGN_DNA_VERSION = '1.0.0';

/**
 * Build the colour palette by merging near-identical colours perceptually,
 * then assign each a role from how it is used.
 */
export function buildPalette(
  samples: { color: Rgb; weight: number; kind: 'background' | 'surface' | 'text' | 'accent' | 'border' }[],
): ColorToken[] {
  const clusters: { color: Rgb; weight: number; kinds: Map<string, number> }[] = [];

  for (const sample of samples) {
    const existing = clusters.find((cluster) => perceptualDistance(cluster.color, sample.color) < 0.035);
    if (existing) {
      // Weighted mean keeps the dominant contributor's exact value dominant.
      const total = existing.weight + sample.weight;
      existing.color = {
        r: (existing.color.r * existing.weight + sample.color.r * sample.weight) / total,
        g: (existing.color.g * existing.weight + sample.color.g * sample.weight) / total,
        b: (existing.color.b * existing.weight + sample.color.b * sample.weight) / total,
      };
      existing.weight = total;
      existing.kinds.set(sample.kind, (existing.kinds.get(sample.kind) ?? 0) + sample.weight);
    } else {
      clusters.push({
        color: sample.color,
        weight: sample.weight,
        kinds: new Map([[sample.kind, sample.weight]]),
      });
    }
  }

  const totalWeight = clusters.reduce((sum, cluster) => sum + cluster.weight, 0) || 1;
  const sorted = clusters.sort((a, b) => b.weight - a.weight);

  const seenTextRoles = { primary: false };
  return sorted.map((cluster) => {
    let dominantKind = 'other';
    let best = 0;
    for (const [kind, weight] of cluster.kinds) {
      if (weight > best) {
        best = weight;
        dominantKind = kind;
      }
    }

    let role: ColorToken['role'] = 'other';
    if (dominantKind === 'background') role = 'background';
    else if (dominantKind === 'surface') role = 'surface';
    else if (dominantKind === 'border') role = 'border';
    else if (dominantKind === 'accent') role = 'accent';
    else if (dominantKind === 'text') {
      role = seenTextRoles.primary ? 'text-secondary' : 'text-primary';
      seenTextRoles.primary = true;
    }

    return {
      hex: toHex(cluster.color),
      rgb: cluster.color,
      coverage: cluster.weight / totalWeight,
      role,
      confidence: Math.min(0.95, 0.5 + cluster.weight / totalWeight),
    };
  });
}

/** Collapse text blocks into a type scale, named by size rank. */
export function buildTypeScale(blocks: TextBlock[]): TypographyToken[] {
  const groups = new Map<string, { blocks: TextBlock[]; size: number; weight: number }>();

  for (const block of blocks) {
    // Bucket to the nearest pixel: measurement noise should not split a token.
    const key = `${Math.round(block.fontSize)}:${block.fontWeight}`;
    const group = groups.get(key) ?? { blocks: [], size: Math.round(block.fontSize), weight: block.fontWeight };
    group.blocks.push(block);
    groups.set(key, group);
  }

  const ordered = [...groups.values()].sort((a, b) => b.size - a.size || b.weight - a.weight);

  return ordered.map((group, index) => ({
    name: nameForRank(index, ordered.length, group.size),
    fontSize: group.size,
    fontWeight: group.weight,
    lineHeight: Math.round(median(group.blocks.map((b) => b.lineHeight))),
    color: toHex(group.blocks[0]!.color),
    usage: group.blocks.length,
    confidence: group.blocks.reduce((sum, b) => sum + b.confidence, 0) / group.blocks.length,
  }));
}

function nameForRank(index: number, total: number, size: number): string {
  if (size >= 28) return index === 0 ? 'Display' : 'Heading Large';
  if (size >= 20) return 'Heading';
  if (size >= 17) return 'Subheading';
  if (size <= 12) return 'Caption';
  return total > 4 && index >= total - 2 ? 'Body Small' : 'Body';
}

/**
 * Detect the spacing rhythm.
 *
 * Scores each candidate base by how many observed gaps are near-multiples of
 * it. Deliberately conservative: an unconvincing winner returns null, because
 * forcing an 8px grid onto a design that does not use one would be exactly the
 * silent redesign this system exists to prevent.
 */
export function detectGrid(gaps: number[]): { base: number | null; confidence: number; spacing: SpacingToken[] } {
  const usable = gaps.filter((gap) => gap >= 2 && gap <= 120).map((gap) => Math.round(gap));
  const counts = new Map<number, number>();
  for (const gap of usable) counts.set(gap, (counts.get(gap) ?? 0) + 1);

  const spacing = [...counts.entries()]
    .map(([value, usage]) => ({ value, usage }))
    .sort((a, b) => b.usage - a.usage || a.value - b.value)
    .slice(0, 12);

  if (usable.length < 4) return { base: null, confidence: 0, spacing };

  /*
   * Candidates are tried largest first.
   *
   * Every multiple of 8 is also a multiple of 4, so a smaller base always
   * scores at least as well - scanning upward would report "4px" for a design
   * built on an 8px rhythm. The largest base that still explains the spacing is
   * the truthful description of it.
   */
  const candidates = [12, 10, 8, 6, 4];
  let best: { base: number; score: number } | undefined;

  for (const base of candidates) {
    // Rounding slack scales with the base. A fixed ±1 on a 4px base accepts
    // three of its four remainders, which makes any set of numbers look like a
    // 4px grid.
    const slack = Math.floor(base / 8);
    let hits = 0;
    for (const gap of usable) {
      const remainder = Math.min(gap % base, base - (gap % base));
      if (remainder <= slack) hits += 1;
    }
    const score = hits / usable.length;

    // Reject a base that does no better than chance would: with this slack a
    // random number lands inside the window (2 * slack + 1) / base of the time.
    const chance = (2 * slack + 1) / base;
    if (score < Math.max(0.72, chance * 1.8)) continue;

    if (!best || score > best.score + 0.05) best = { base, score };
  }

  if (!best) {
    // Report the best evidence found so the panel can say how close it came.
    const fallback = Math.max(
      ...candidates.map((base) => {
        const slack = Math.floor(base / 8);
        return usable.filter((gap) => Math.min(gap % base, base - (gap % base)) <= slack).length / usable.length;
      }),
    );
    return { base: null, confidence: fallback, spacing };
  }
  return { base: best.base, confidence: best.score, spacing };
}

/** The horizontal margin most content shares with the screen edge. */
export function detectEdgeMargin(boxes: Box[], frameWidth: number): { value: number | null; confidence: number } {
  const lefts = new Map<number, number>();
  for (const box of boxes) {
    // Ignore full-bleed elements: they define no margin.
    if (box.width >= frameWidth - 2) continue;
    const left = Math.round(box.x);
    if (left <= 0 || left > frameWidth / 3) continue;
    lefts.set(left, (lefts.get(left) ?? 0) + 1);
  }
  if (lefts.size === 0) return { value: null, confidence: 0 };

  const total = [...lefts.values()].reduce((sum, count) => sum + count, 0);
  const [value, count] = [...lefts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return { value, confidence: count / total };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
