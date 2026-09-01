import type { FidelityScore } from '@dae/shared';
import type { Box } from './pixels.js';
import type { Classification } from './classify.js';
import type { DesignDna } from './design-dna.js';

export interface FidelityRegion {
  box: Box;
  classification: Classification;
  confidence: number;
}

export interface SourceFidelityInput {
  /** Analysed image dimensions, in analysis pixels. */
  documentArea: number;
  regions: FidelityRegion[];
  background: { confidence: number };
  dna: DesignDna;
  /**
   * Ratio of analysis pixels to source pixels. Below 1 the analysis ran on a
   * downscaled copy, so small features could have been missed entirely.
   */
  analysisScale: number;
  warnings: string[];
}

/**
 * How faithfully our representation of the upload matches the upload.
 *
 * This is *not* a statement about any device. It answers one question: if the
 * source preview were laid over the original PNG at the authored size, how much
 * of it would be the designer's own pixels or a measured reproduction of them?
 *
 * The arithmetic is deliberately area-weighted rather than region-counted. A
 * misread 8px divider and a misread full-bleed hero are not the same mistake,
 * and counting regions would score them identically.
 */
export function scoreSourceFidelity(input: SourceFidelityInput): FidelityScore {
  const { documentArea, regions, background, dna, analysisScale, warnings } = input;
  const reasons: string[] = [];
  const limitations: string[] = [];

  let claimedArea = 0;
  let weighted = 0;
  let rasterArea = 0;
  let reconstructedArea = 0;

  for (const region of regions) {
    const area = Math.max(0, region.box.width * region.box.height);
    claimedArea += area;
    switch (region.classification.renderStrategy) {
      case 'PRESERVE_RASTER':
        // The original pixels, cropped and placed. Nothing was reinterpreted,
        // so this area is exact whatever the classifier thought it was.
        rasterArea += area;
        weighted += area;
        break;
      case 'HYBRID':
        // Original pixels inside a measured frame: exact in appearance, and
        // only the frame around them can be wrong.
        rasterArea += area;
        weighted += area * (0.9 + 0.1 * region.confidence);
        break;
      case 'RECONSTRUCT':
        // Redrawn from measured fill, radius and type geometry. Text inside is
        // still the original pixels, so the exposure is the container: a fill
        // read from a gradient, or a radius read from an anti-aliased corner.
        reconstructedArea += area;
        weighted += area * (0.75 + 0.25 * region.confidence);
        break;
    }
  }

  // Whatever no region claimed is drawn as the detected page background.
  const unclaimedArea = Math.max(0, documentArea - claimedArea);
  weighted += unclaimedArea * background.confidence;

  const score = documentArea > 0 ? (weighted / documentArea) * 100 : 0;

  const rasterShare = documentArea > 0 ? rasterArea / documentArea : 0;
  const reconstructedShare = documentArea > 0 ? reconstructedArea / documentArea : 0;
  reasons.push(
    `${pct(rasterShare)} of the document is the uploaded bitmap itself, cropped and placed rather than redrawn.`,
  );
  reasons.push(
    `${pct(reconstructedShare)} was rebuilt as components from measured fills, radii and type geometry.`,
  );
  if (unclaimedArea > 0) {
    reasons.push(
      `${pct(unclaimedArea / documentArea)} is page background, painted with the colour measured from the source.`,
    );
  }

  // Confidence in the score, which is a different thing from the score. It is
  // limited by how well the analysis could see, not by what it found.
  let confidence = 0.9;
  if (analysisScale < 1) {
    confidence -= 0.1;
    limitations.push(
      `Analysis ran on a ${Math.round(analysisScale * 100)}% copy of the upload, so features smaller than ${Math.ceil(1 / analysisScale)}px may not have been detected.`,
    );
  }
  if (dna.fontFamily.value === null) {
    // Not a fidelity loss - the text is drawn as original pixels - but the
    // reader should know the family is unknown rather than assumed.
    limitations.push(
      'The font family cannot be recovered from a bitmap. Text is preserved as original pixels rather than re-set, so it looks correct but is not editable.',
    );
  }
  if (dna.grid.value === null) {
    limitations.push('No consistent spacing grid was found, so spacing is reported per element rather than as a rhythm.');
  }
  if (regions.length === 0) {
    confidence = 0.4;
    reasons.push('No regions could be separated from the background; the whole document is preserved as artwork.');
  }
  for (const warning of warnings) limitations.push(warning);

  return {
    kind: 'source',
    score: clamp(round(score, 1)),
    question: 'Does our representation of the upload match the upload?',
    confidence: Math.max(0, Math.min(1, round(confidence, 2))),
    measurementType: 'DETECTED',
    reasons,
    limitations,
  };
}

/**
 * A Figma import needs no reconstruction: the document *is* the source, so the
 * only honest source-fidelity score is 100.
 */
export function structuredSourceFidelity(kind: 'figma'): FidelityScore {
  return {
    kind: 'source',
    score: 100,
    question: 'Does our representation of the upload match the upload?',
    confidence: 1,
    measurementType: 'DETECTED',
    reasons: [
      `The ${kind} document was imported directly. Geometry, type and colour are read values, not measurements taken from pixels.`,
    ],
    limitations: [],
  };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * A flat raster document is drawn as the uploaded bitmap itself, so nothing
 * about it was reinterpreted. That is perfect source fidelity and no structure
 * at all - two facts a single number would confuse, which is why the second one
 * is a stated limitation rather than a deduction from the score.
 */
export function flatSourceFidelity(): FidelityScore {
  return {
    kind: 'source',
    score: 100,
    question: 'Does our representation of the upload match the upload?',
    confidence: 1,
    measurementType: 'DETECTED',
    reasons: ['The document is the uploaded bitmap, drawn verbatim. No pixel was reinterpreted.'],
    limitations: [
      'No structure was recovered, so the design can only be scaled, never reflowed. Nothing inside it can be inspected or measured.',
    ],
  };
}

/**
 * The source fidelity to report for a document, whatever it was built from.
 * Reconstruction stores its own measured score; the other two paths are exact
 * by construction.
 */
export function sourceFidelityOf(design: {
  structure: 'figma' | 'reconstructed' | 'flat';
  sourceFidelity?: FidelityScore;
}): FidelityScore {
  if (design.sourceFidelity) return design.sourceFidelity;
  if (design.structure === 'figma') return structuredSourceFidelity('figma');
  return flatSourceFidelity();
}
