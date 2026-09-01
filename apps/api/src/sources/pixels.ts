import sharp from 'sharp';
import type { PixelData } from '@dae/engine';

/**
 * Decode an uploaded image to raw RGBA for analysis.
 *
 * Large exports are downscaled first: reconstruction cost is quadratic in
 * pixel count, and a 3x export carries no more *structure* than its 1x
 * equivalent. The caller converts measurements back to logical units with the
 * returned scale, so nothing about the result depends on this choice.
 */
export const MAX_ANALYSIS_WIDTH = 800;

export async function decodeForAnalysis(
  data: Buffer,
): Promise<{ image: PixelData; analysisScale: number }> {
  const metadata = await sharp(data).metadata();
  const width = metadata.width ?? 0;
  if (width === 0) throw new Error('Image dimensions could not be determined.');

  const pipeline = sharp(data).ensureAlpha();
  const resized = width > MAX_ANALYSIS_WIDTH ? pipeline.resize({ width: MAX_ANALYSIS_WIDTH }) : pipeline;
  const { data: raw, info } = await resized.raw().toBuffer({ resolveWithObject: true });

  return {
    image: { data: new Uint8ClampedArray(raw), width: info.width, height: info.height },
    analysisScale: width / info.width,
  };
}
