/**
 * Pixel access and colour science for source analysis.
 *
 * Deliberately runtime-agnostic: it operates on a plain RGBA buffer, so the
 * same analysis runs in the API (pixels from Sharp) and in the browser
 * (pixels from a canvas). Nothing here imports a platform module.
 */

export interface PixelData {
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export function pixelAt(image: PixelData, x: number, y: number): Rgb {
  const cx = Math.min(image.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(image.height - 1, Math.max(0, Math.round(y)));
  const i = (cy * image.width + cx) * 4;
  return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
}

/** Rec. 709 luma, the standard perceptual weighting for greyscale conversion. */
export function luma(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB to OKLab.
 *
 * OKLab is used rather than raw RGB distance because UI palettes are full of
 * near-neighbour tints, and Euclidean RGB distance ranks those wrongly - it
 * would merge a surface and its hover state while splitting two shades of the
 * same brand colour (spec section 32).
 */
export function rgbToOklab(color: Rgb): Lab {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Perceptual distance in OKLab. Roughly 0.02 is "just noticeable". */
export function perceptualDistance(a: Rgb, b: Rgb): number {
  const la = rgbToOklab(a);
  const lb = rgbToOklab(b);
  return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b);
}

/** Two colours a designer would call "the same". */
export function colorsMatch(a: Rgb, b: Rgb, tolerance = 0.02): boolean {
  return perceptualDistance(a, b) <= tolerance;
}

export function toHex(color: Rgb): string {
  const channel = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

export function fromHex(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** WCAG relative luminance, for the contrast checks the validator already runs. */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * srgbToLinear(color.r) + 0.7152 * srgbToLinear(color.g) + 0.0722 * srgbToLinear(color.b);
}

export function rgbContrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The most common colour in a region.
 *
 * Colours are bucketed in OKLab so near-identical tints (antialiasing, subtle
 * gradients) collapse into one bucket instead of splitting the vote.
 */
export function modalColor(image: PixelData, box: Box, step = 2): { color: Rgb; share: number } {
  const buckets = new Map<string, { sum: Rgb; count: number }>();
  let total = 0;

  const x1 = Math.max(0, Math.floor(box.x));
  const y1 = Math.max(0, Math.floor(box.y));
  const x2 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y2 = Math.min(image.height, Math.ceil(box.y + box.height));

  for (let y = y1; y < y2; y += step) {
    for (let x = x1; x < x2; x += step) {
      const color = pixelAt(image, x, y);
      const lab = rgbToOklab(color);
      // ~0.03 OKLab per bucket: finer than "just noticeable", coarse enough to
      // absorb antialiasing.
      const key = `${Math.round(lab.L * 32)}:${Math.round(lab.a * 32)}:${Math.round(lab.b * 32)}`;
      const bucket = buckets.get(key) ?? { sum: { r: 0, g: 0, b: 0 }, count: 0 };
      bucket.sum.r += color.r;
      bucket.sum.g += color.g;
      bucket.sum.b += color.b;
      bucket.count += 1;
      buckets.set(key, bucket);
      total += 1;
    }
  }

  if (total === 0) return { color: { r: 255, g: 255, b: 255 }, share: 0 };

  let best = { sum: { r: 0, g: 0, b: 0 }, count: 0 };
  for (const bucket of buckets.values()) if (bucket.count > best.count) best = bucket;

  return {
    color: {
      r: best.sum.r / best.count,
      g: best.sum.g / best.count,
      b: best.sum.b / best.count,
    },
    share: best.count / total,
  };
}

/** Fraction of sampled pixels within `tolerance` of the region's modal colour. */
export function uniformity(image: PixelData, box: Box, step = 2): number {
  const { color } = modalColor(image, box, step);
  let matching = 0;
  let total = 0;

  const x1 = Math.max(0, Math.floor(box.x));
  const y1 = Math.max(0, Math.floor(box.y));
  const x2 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y2 = Math.min(image.height, Math.ceil(box.y + box.height));

  for (let y = y1; y < y2; y += step) {
    for (let x = x1; x < x2; x += step) {
      if (colorsMatch(pixelAt(image, x, y), color, 0.04)) matching += 1;
      total += 1;
    }
  }
  return total === 0 ? 0 : matching / total;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function containsBox(outer: Box, inner: Box, slack = 1): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function boxArea(box: Box): number {
  return box.width * box.height;
}
