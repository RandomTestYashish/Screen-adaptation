import { inferred, isParent, type DesignNode, type Screen } from '@dae/shared';
import { approxEqual } from '../layout/geometry.js';

/**
 * Detect fixed / sticky elements and their safe-area relationship.
 *
 * Neither Figma nor a bitmap states "this bar is pinned to the bottom", but
 * getting it wrong is what makes a design collide with the home indicator. The
 * detection is therefore explicit, conservative and always recorded as
 * `inferred` with a confidence, so the validation panel can surface the
 * assumption rather than hiding it (spec section 32).
 */

const TOP_NAME_HINT = /status|header|nav\s*bar|appbar|app\s*bar|toolbar|title\s*bar|top\s*bar/i;
const BOTTOM_NAME_HINT = /tab\s*bar|bottom\s*(nav|bar|sheet)|footer|home\s*indicator|cta|toolbar/i;
const FULL_BLEED_HINT = /hero|cover|banner|background|splash/i;

/** Max height for a bar to be treated as chrome rather than page content. */
const MAX_TOP_BAR_HEIGHT = 160;
const MAX_BOTTOM_BAR_HEIGHT = 140;
const EDGE_TOLERANCE = 2;

export interface AnchorDetectionResult {
  screen: Screen;
  annotations: { nodeId: string; nodeName: string; anchor: string; position: string; confidence: number; reason: string }[];
}

export function detectAnchors(screen: Screen): AnchorDetectionResult {
  const annotations: AnchorDetectionResult['annotations'] = [];
  const { width, height } = screen.frame;
  const root = screen.root;
  const children = isParent(root) ? root.children : [];

  for (const child of children) {
    const isFullWidth =
      approxEqual(child.frame.x, 0, EDGE_TOLERANCE) && approxEqual(child.frame.width, width, EDGE_TOLERANCE);
    if (!isFullWidth) continue;

    const top = child.frame.y;
    const bottom = child.frame.y + child.frame.height;
    const nameHintsTop = TOP_NAME_HINT.test(child.name);
    const nameHintsBottom = BOTTOM_NAME_HINT.test(child.name);
    const nameHintsFullBleed = FULL_BLEED_HINT.test(child.name);

    if (approxEqual(top, 0, EDGE_TOLERANCE) && child.frame.height <= MAX_TOP_BAR_HEIGHT) {
      if (nameHintsFullBleed) {
        annotate(child, 'full-bleed', 'flow', 0.6, 'Full-width element at the top of the page named like a hero/banner: kept edge-to-edge under the status bar.');
      } else {
        const confidence = nameHintsTop ? 0.9 : 0.6;
        annotate(
          child,
          'top-inset',
          nameHintsTop ? 'sticky' : 'flow',
          confidence,
          nameHintsTop
            ? 'Full-width bar at the top of the page with a header/navigation name: treated as a sticky top bar that must clear the status bar and cutout.'
            : 'Full-width element at the top of the page: kept clear of the status bar, but not pinned because nothing indicates it is sticky.',
        );
      }
      continue;
    }

    if (
      approxEqual(bottom, height, EDGE_TOLERANCE * 2) &&
      child.frame.height <= MAX_BOTTOM_BAR_HEIGHT &&
      screen.scrollHeight > height - EDGE_TOLERANCE
    ) {
      const confidence = nameHintsBottom ? 0.9 : 0.55;
      annotate(
        child,
        'bottom-inset',
        nameHintsBottom ? 'fixed' : 'flow',
        confidence,
        nameHintsBottom
          ? 'Full-width bar at the bottom of the viewport with a tab-bar/footer name: treated as fixed and lifted above the home indicator or navigation bar.'
          : 'Full-width element sitting on the bottom edge of the viewport: kept clear of the navigation area, but not pinned.',
      );
    }
  }

  return { screen, annotations };

  function annotate(
    node: DesignNode,
    anchor: 'top-inset' | 'bottom-inset' | 'full-bleed',
    position: 'sticky' | 'fixed' | 'flow',
    confidence: number,
    reason: string,
  ) {
    node.safeAreaAnchor = anchor;
    node.position = position;
    node.fieldQuality = {
      ...node.fieldQuality,
      safeAreaAnchor: inferred('heuristic', confidence, reason),
      position: inferred('heuristic', confidence, reason),
    };
    annotations.push({ nodeId: node.id, nodeName: node.name, anchor, position, confidence, reason });
  }
}
