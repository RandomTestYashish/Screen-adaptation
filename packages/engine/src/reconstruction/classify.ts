import { rgbContrastRatio, perceptualDistance, type Box, type Rgb } from './pixels.js';
import type { Segment } from './segmentation.js';
import type { TextBlock } from './text-detection.js';

/**
 * Semantic classification of detected regions.
 *
 * The classification is *metadata*: it names what something is so it can be
 * inspected and reflowed. It never authorises changing how the thing looks
 * (spec section 4, stage 4).
 */

export type ComponentType =
  | 'HEADER'
  | 'NAVIGATION'
  | 'CARD'
  | 'BANNER'
  | 'CTA'
  | 'BUTTON'
  | 'LIST_ITEM'
  | 'HEADING'
  | 'BODY'
  | 'CAPTION'
  | 'IMAGE'
  | 'ILLUSTRATION'
  | 'ICON'
  | 'AVATAR'
  | 'DIVIDER'
  | 'BADGE'
  | 'INPUT'
  | 'BACKGROUND'
  | 'CUSTOM_COMPONENT';

/**
 * How a region should be rendered (spec section 8).
 *
 * `PRESERVE_RASTER` is the honest default: when the analysis cannot confidently
 * describe something, the original pixels are shown instead of an invention.
 */
export type RenderStrategy = 'RECONSTRUCT' | 'PRESERVE_RASTER' | 'HYBRID';

export interface Classification {
  componentType: ComponentType;
  semanticRole: string;
  renderStrategy: RenderStrategy;
  confidence: number;
  reasons: string[];
}

/** Above this, a reconstruction is trusted; below it the pixels are kept. */
export const RECONSTRUCT_THRESHOLD = 0.7;
export const HYBRID_THRESHOLD = 0.45;

export interface RegionFacts {
  box: Box;
  frameWidth: number;
  /** Position within the whole document, 0 at the top. */
  documentY: number;
  documentHeight: number;
  fill: Rgb;
  background: Rgb;
  /** 0..1 flatness of the region's interior. */
  uniformity: number;
  /** Vertical-edge density; high means detail, low means flat. */
  edgeDensity: number;
  cornerRadius: number;
  textBlocks: TextBlock[];
  /** How many sibling regions share this one's size and left edge. */
  repetitionCount: number;
  hasGradient: boolean;
}

/**
 * Classify one region.
 *
 * Each rule contributes a reason, so the AI panel can show *why* something was
 * called a CTA rather than asserting it.
 */
export function classifyRegion(facts: RegionFacts): Classification {
  const reasons: string[] = [];
  const isFullWidth = facts.box.width >= facts.frameWidth - 4;
  const aspect = facts.box.width / Math.max(1, facts.box.height);
  const nearTop = facts.documentY < facts.frameWidth * 0.35;
  const nearBottom = facts.documentY + facts.box.height > facts.documentHeight - facts.frameWidth * 0.35;
  const textCount = facts.textBlocks.length;

  // --- Structural chrome -------------------------------------------------
  if (isFullWidth && nearTop && facts.box.height <= 140) {
    reasons.push(`Full-width band ${Math.round(facts.box.height)}px tall at the top of the document.`);
    return finish('HEADER', 'page-header', 0.82, reasons, facts);
  }
  if (isFullWidth && nearBottom && facts.box.height <= 120) {
    reasons.push(`Full-width band ${Math.round(facts.box.height)}px tall at the bottom of the document.`);
    return finish('NAVIGATION', 'bottom-navigation', 0.8, reasons, facts);
  }

  // --- Rules and dividers -------------------------------------------------
  if (facts.box.height <= 3 && aspect > 12) {
    reasons.push('A one-to-three pixel band much wider than it is tall.');
    return finish('DIVIDER', 'separator', 0.88, reasons, facts);
  }

  // --- Buttons ------------------------------------------------------------
  // A filled, rounded, flat box with a single centred line of text on it, and
  // enough contrast against its own fill to be a label rather than a caption.
  if (
    textCount === 1 &&
    facts.cornerRadius >= 4 &&
    facts.uniformity > 0.55 &&
    facts.box.height >= 32 &&
    facts.box.height <= 72 &&
    aspect > 1.6
  ) {
    const label = facts.textBlocks[0]!;
    const contrast = rgbContrastRatio(label.color, facts.fill);
    if (contrast > 2.5) {
      reasons.push(
        `Rounded ${Math.round(facts.cornerRadius)}px filled box, ${Math.round(facts.box.height)}px tall, with one centred label at ${Math.round(contrast * 10) / 10}:1 contrast.`,
      );
      const emphatic = isFullWidth || facts.box.width > facts.frameWidth * 0.6;
      return finish(emphatic ? 'CTA' : 'BUTTON', emphatic ? 'primary-action' : 'action', 0.84, reasons, facts);
    }
  }

  // --- Repeated rows ------------------------------------------------------
  if (facts.repetitionCount >= 2) {
    reasons.push(`${facts.repetitionCount + 1} sibling regions share this width, height and left edge.`);
    return finish('LIST_ITEM', 'repeated-row', 0.8, reasons, facts);
  }

  // --- Cards and surfaces --------------------------------------------------
  if (facts.cornerRadius >= 6 && facts.uniformity > 0.4 && facts.box.height > 60) {
    reasons.push(
      `Rounded ${Math.round(facts.cornerRadius)}px surface distinct from the page background, containing ${textCount} text block${textCount === 1 ? '' : 's'}.`,
    );
    return finish('CARD', 'content-card', 0.78, reasons, facts);
  }

  // --- Imagery -------------------------------------------------------------
  // Detailed and non-uniform: a photograph or a complex illustration. These are
  // never reconstructed - the original pixels are the only faithful rendering.
  if (facts.edgeDensity > 0.16 && facts.uniformity < 0.45 && facts.box.height > 40) {
    const banner = isFullWidth || facts.box.width > facts.frameWidth * 0.7;
    reasons.push(
      `High edge detail (${Math.round(facts.edgeDensity * 100)}%) with low colour uniformity: photographic or illustrative content.`,
    );
    return finish(banner ? 'BANNER' : 'IMAGE', banner ? 'marketing-banner' : 'image', 0.72, reasons, facts, 'PRESERVE_RASTER');
  }
  if (facts.hasGradient && facts.box.height > 40) {
    reasons.push('A monotonic colour ramp across the region.');
    return finish('BANNER', 'gradient-banner', 0.7, reasons, facts, 'HYBRID');
  }

  // --- Small graphics ------------------------------------------------------
  if (facts.box.width <= 56 && facts.box.height <= 56 && textCount === 0) {
    const circular = facts.cornerRadius >= Math.min(facts.box.width, facts.box.height) * 0.4;
    reasons.push(`Small ${Math.round(facts.box.width)}x${Math.round(facts.box.height)}px graphic with no text.`);
    return finish(
      circular ? 'AVATAR' : 'ICON',
      circular ? 'avatar' : 'icon',
      0.66,
      reasons,
      facts,
      'PRESERVE_RASTER',
    );
  }

  // --- Text ----------------------------------------------------------------
  if (textCount > 0 && facts.uniformity > 0.6) {
    const block = facts.textBlocks[0]!;
    if (block.fontSize >= 20 || block.fontWeight >= 600) {
      reasons.push(`Text at ${block.fontSize}px / ${block.fontWeight} weight, above the body scale.`);
      return finish('HEADING', 'heading', block.confidence, reasons, facts);
    }
    if (block.fontSize <= 12) {
      reasons.push(`Text at ${block.fontSize}px, below the body scale.`);
      return finish('CAPTION', 'caption', block.confidence, reasons, facts);
    }
    reasons.push(`Text at ${block.fontSize}px / ${block.fontWeight} weight.`);
    return finish('BODY', 'body-text', block.confidence, reasons, facts);
  }

  // --- Give up honestly ----------------------------------------------------
  reasons.push(
    'No rule matched with enough confidence; the original pixels are preserved rather than guessing a component.',
  );
  return finish('CUSTOM_COMPONENT', 'unclassified', 0.4, reasons, facts, 'PRESERVE_RASTER');
}

function finish(
  componentType: ComponentType,
  semanticRole: string,
  confidence: number,
  reasons: string[],
  facts: RegionFacts,
  forced?: RenderStrategy,
): Classification {
  let renderStrategy: RenderStrategy = forced ?? 'RECONSTRUCT';

  if (!forced) {
    if (confidence < HYBRID_THRESHOLD) renderStrategy = 'PRESERVE_RASTER';
    else if (confidence < RECONSTRUCT_THRESHOLD) renderStrategy = 'HYBRID';
    // Anything visually busy keeps its pixels regardless of how confidently it
    // was named: the name is metadata, the pixels are the design.
    else if (facts.edgeDensity > 0.22 && facts.textBlocks.length === 0) renderStrategy = 'PRESERVE_RASTER';
  }

  return { componentType, semanticRole, renderStrategy, confidence, reasons };
}

/** Regions sharing width, height and left edge - a repeated list. */
export function countRepetitions(segment: Segment, siblings: Segment[]): number {
  return siblings.filter(
    (other) =>
      other !== segment &&
      Math.abs(other.box.width - segment.box.width) <= 3 &&
      Math.abs(other.box.height - segment.box.height) <= 4 &&
      Math.abs(other.box.x - segment.box.x) <= 3 &&
      perceptualDistance(other.color, segment.color) < 0.08,
  ).length;
}
