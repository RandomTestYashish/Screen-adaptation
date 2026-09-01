import { Injectable, Logger } from '@nestjs/common';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import type { VisualComparator, VisualComparison, ValidationContext } from '@dae/engine';
import { LocalAssetStore } from '../assets/asset-store.js';

/**
 * Source-vs-target pixel comparison, built on pixelmatch.
 *
 * Only runs for raster sources with a captured render: comparing a structured
 * Figma design against a screenshot would measure the renderer, not the
 * adaptation. When it cannot run it returns undefined so the check reports
 * `skipped` with a reason rather than a fabricated result.
 */
@Injectable()
export class PixelComparator implements VisualComparator {
  private readonly logger = new Logger(PixelComparator.name);
  constructor(private readonly assets: LocalAssetStore) {}

  async compare(ctx: ValidationContext): Promise<VisualComparison | undefined> {
    const renderedAssetId = ctx.evidence?.renderedAssetId;
    if (!renderedAssetId) return undefined;
    if (ctx.design.sourceKind !== 'raster') return undefined;

    const [sourceBytes, renderedBytes] = await Promise.all([
      this.assets.get(ctx.source.assetId),
      this.assets.get(renderedAssetId),
    ]);
    if (!sourceBytes || !renderedBytes) return undefined;

    try {
      // Normalise both to the rendered viewport size. The source is resized
      // with the same proportional transform the adaptation applied, so a
      // faithful uniform scale produces a near-zero mismatch.
      const target = await sharp(renderedBytes).metadata();
      const width = target.width;
      const height = target.height;
      if (!width || !height) return undefined;

      const [a, b] = await Promise.all([
        sharp(sourceBytes)
          .resize(width, height, { fit: 'cover', position: 'top' })
          .removeAlpha()
          .ensureAlpha()
          .png()
          .toBuffer(),
        sharp(renderedBytes).resize(width, height, { fit: 'cover', position: 'top' }).removeAlpha().ensureAlpha().png().toBuffer(),
      ]);

      const pngA = PNG.sync.read(a);
      const pngB = PNG.sync.read(b);
      const diff = new PNG({ width, height });
      const differing = pixelmatch(pngA.data, pngB.data, diff.data, width, height, {
        threshold: 0.12,
        includeAA: false,
      });

      return {
        mismatchRatio: differing / (width * height),
        largestDiffRegion: boundsOfDifferences(diff, width, height),
        comparedWidth: width,
        comparedHeight: height,
        comparator: 'pixelmatch@6',
      };
    } catch (error) {
      this.logger.warn(`Pixel comparison failed: ${(error as Error).message}`);
      return undefined;
    }
  }
}

/** Bounding box of the differing pixels pixelmatch marked, for the overlay. */
function boundsOfDifferences(diff: PNG, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      // pixelmatch paints differences in red.
      if (diff.data[index] === 255 && diff.data[index + 1]! < 100) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return undefined;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
