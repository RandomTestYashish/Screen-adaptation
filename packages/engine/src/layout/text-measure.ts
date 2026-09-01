import type { Typography } from '@dae/shared';

/**
 * Deterministic, browser-free text measurement.
 *
 * Real glyph advances depend on the actual font binary, which the server does
 * not have. This module therefore produces an *approximation* built from
 * published Helvetica/Arial advance widths, adjusted for weight and tracking.
 *
 * Every value it returns is labelled `inferred` by callers, never `detected`.
 * When the client supplies real DOM measurements as RenderEvidence, the
 * validation engine prefers those and upgrades the quality label
 * (spec section 14: "Do not invent measurements").
 */

/** Advance widths in 1/1000 em, from the Helvetica AFM tables. */
const ADVANCE_1000: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

const DEFAULT_ADVANCE = 556;
/** CJK and other full-width ranges advance roughly one em. */
const FULL_WIDTH = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** Families whose glyphs are meaningfully wider or narrower than Helvetica. */
const FAMILY_FACTOR: { test: RegExp; factor: number }[] = [
  { test: /mono|consolas|courier|menlo|code/i, factor: 1.08 },
  { test: /georgia|times|serif|garamond|merriweather/i, factor: 0.98 },
  { test: /roboto|inter|sf pro|helvetica|arial|system/i, factor: 1.0 },
  { test: /condensed|narrow/i, factor: 0.88 },
];

export function familyFactor(fontFamily: string): number {
  for (const entry of FAMILY_FACTOR) if (entry.test.test(fontFamily)) return entry.factor;
  return 1.0;
}

/** Heavier weights advance wider. Linear approximation around regular (400). */
export function weightFactor(weight: number): number {
  return 1 + ((weight - 400) / 400) * 0.06;
}

export function measureTextWidth(text: string, typography: Typography): number {
  const scale = typography.fontSize / 1000;
  const family = familyFactor(typography.fontFamily);
  const weight = weightFactor(typography.fontWeight);
  let width = 0;
  for (const ch of text) {
    if (FULL_WIDTH.test(ch)) {
      width += 1000;
      continue;
    }
    width += ADVANCE_1000[ch] ?? DEFAULT_ADVANCE;
  }
  const base = width * scale * family * weight;
  const tracking = typography.letterSpacing * Math.max(0, [...text].length - 1);
  return base + tracking;
}

export interface WrapResult {
  lines: string[];
  lineCount: number;
  width: number;
  height: number;
  /** True when a single unbreakable token is wider than the available width. */
  hasOverflowingToken: boolean;
}

/**
 * Greedy line breaking on whitespace, matching how browsers break Latin text
 * with `overflow-wrap: normal`. CJK runs break between characters.
 */
export function wrapText(text: string, availableWidth: number, typography: Typography): WrapResult {
  if (availableWidth <= 0) {
    return { lines: [text], lineCount: 1, width: measureTextWidth(text, typography), height: typography.lineHeight, hasOverflowingToken: true };
  }

  const paragraphs = text.split('\n');
  const lines: string[] = [];
  let widest = 0;
  let hasOverflowingToken = false;

  for (const paragraph of paragraphs) {
    const tokens = tokenize(paragraph);
    let current = '';
    let currentWidth = 0;

    for (const token of tokens) {
      const tokenWidth = measureTextWidth(token, typography);
      if (tokenWidth > availableWidth && token.trim() !== '') hasOverflowingToken = true;

      if (current === '' && token.trim() === '') continue; // no leading space on a wrapped line
      const nextWidth = currentWidth + tokenWidth;
      if (current !== '' && nextWidth > availableWidth) {
        lines.push(current);
        widest = Math.max(widest, currentWidth);
        current = token.trim() === '' ? '' : token;
        currentWidth = current === '' ? 0 : tokenWidth;
      } else {
        current += token;
        currentWidth = nextWidth;
      }
    }
    lines.push(current);
    widest = Math.max(widest, currentWidth);
  }

  return {
    lines,
    lineCount: lines.length,
    width: widest,
    height: lines.length * typography.lineHeight,
    hasOverflowingToken,
  };
}

/** Splits into words plus their trailing whitespace, with CJK as single tokens. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let buffer = '';
  for (const ch of text) {
    if (FULL_WIDTH.test(ch)) {
      if (buffer) tokens.push(buffer);
      tokens.push(ch);
      buffer = '';
    } else if (/\s/.test(ch)) {
      buffer += ch;
      tokens.push(buffer);
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  if (buffer) tokens.push(buffer);
  return tokens;
}

/** Default line-height when the source does not declare one, per CSS `normal`. */
export function derivedLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.2 * 100) / 100;
}
