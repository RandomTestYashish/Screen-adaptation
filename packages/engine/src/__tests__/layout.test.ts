import { describe, expect, it } from 'vitest';
import { derivedLineHeight, measureTextWidth, wrapText } from '../layout/text-measure.js';
import { edgeDistances, insetRect, intersection, union } from '../layout/geometry.js';
import type { Typography } from '@dae/shared';

const BODY: Typography = {
  fontFamily: 'Inter',
  fontSize: 14,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 20,
  lineHeightSource: 'explicit',
  letterSpacing: 0,
  textAlign: 'left',
  verticalAlign: 'top',
  textTransform: 'none',
  textDecoration: 'none',
  color: { r: 0, g: 0, b: 0, a: 1 },
};

describe('text measurement', () => {
  it('scales linearly with font size', () => {
    const small = measureTextWidth('Hello world', BODY);
    const large = measureTextWidth('Hello world', { ...BODY, fontSize: 28 });
    expect(large / small).toBeCloseTo(2, 5);
  });

  it('makes bold text wider than regular', () => {
    expect(measureTextWidth('Hello', { ...BODY, fontWeight: 700 })).toBeGreaterThan(measureTextWidth('Hello', BODY));
  });

  it('accounts for letter spacing across the gaps between glyphs', () => {
    const tracked = measureTextWidth('abcde', { ...BODY, letterSpacing: 2 });
    expect(tracked - measureTextWidth('abcde', BODY)).toBeCloseTo(8, 5);
  });

  it('treats full-width characters as one em', () => {
    expect(measureTextWidth('日本語', BODY)).toBeCloseTo(3 * 14, 1);
  });
});

describe('line wrapping', () => {
  const text = 'A longer paragraph of supporting copy that wraps differently at a different width.';

  it('needs fewer lines as the available width grows', () => {
    const narrow = wrapText(text, 200, BODY).lineCount;
    const wide = wrapText(text, 340, BODY).lineCount;
    expect(narrow).toBeGreaterThan(wide);
  });

  it('never produces a line wider than the available width', () => {
    const result = wrapText(text, 220, BODY);
    for (const line of result.lines) {
      expect(measureTextWidth(line.trimEnd(), BODY)).toBeLessThanOrEqual(220 + 0.001);
    }
  });

  it('reports the height as lines x line-height', () => {
    const result = wrapText(text, 220, BODY);
    expect(result.height).toBe(result.lineCount * BODY.lineHeight);
  });

  it('preserves explicit newlines as separate lines', () => {
    expect(wrapText('one\ntwo\nthree', 500, BODY).lineCount).toBe(3);
  });

  it('flags a single word that cannot fit', () => {
    expect(wrapText('Supercalifragilisticexpialidocious', 40, BODY).hasOverflowingToken).toBe(true);
    expect(wrapText('short words here', 200, BODY).hasOverflowingToken).toBe(false);
  });

  it('derives a CSS-normal line height when the source declares none', () => {
    expect(derivedLineHeight(16)).toBe(19.2);
  });
});

describe('geometry helpers', () => {
  it('intersects and unions rectangles', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 100, height: 100 };
    expect(intersection(a, b)).toEqual({ x: 50, y: 50, width: 50, height: 50 });
    expect(union(a, b)).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    expect(intersection(a, { x: 200, y: 200, width: 10, height: 10 })).toBeNull();
  });

  it('insets a rectangle and clamps at zero', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(insetRect(rect, { top: 10, right: 10, bottom: 10, left: 10 })).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    expect(insetRect(rect, { top: 0, right: 80, bottom: 0, left: 80 }).width).toBe(0);
  });

  it('measures the gap between two rectangles', () => {
    const above = { x: 0, y: 0, width: 100, height: 40 };
    const below = { x: 0, y: 60, width: 100, height: 40 };
    expect(edgeDistances(above, below).top).toBe(20);
  });
});
