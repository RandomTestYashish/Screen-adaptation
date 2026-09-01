import type { Constraints, Rect } from '@dae/shared';

export interface ResolveInput {
  /** Child frame in the *original* parent's coordinate space. */
  child: Rect;
  originalParent: { width: number; height: number };
  adaptedParent: { width: number; height: number };
}

export type HorizontalBehaviour = 'pinned-left' | 'pinned-right' | 'stretched' | 'centered' | 'scaled';

export interface ResolvedAxis {
  offset: number;
  size: number;
  behaviour: HorizontalBehaviour;
}

/**
 * Constraint solving, matching the documented Figma constraint semantics so a
 * structured import reflows exactly as it would in the design tool.
 *
 * Preservation-first: `left` (the Figma default) keeps both position and size
 * untouched, so an element only moves when its constraint says it should.
 */
export function resolveHorizontal(input: ResolveInput, constraints: Constraints): ResolvedAxis {
  const { child, originalParent, adaptedParent } = input;
  const delta = adaptedParent.width - originalParent.width;
  const rightGap = originalParent.width - (child.x + child.width);

  switch (constraints.horizontal) {
    case 'left':
      return { offset: child.x, size: child.width, behaviour: 'pinned-left' };
    case 'right':
      return { offset: adaptedParent.width - rightGap - child.width, size: child.width, behaviour: 'pinned-right' };
    case 'left-right':
      return { offset: child.x, size: Math.max(0, child.width + delta), behaviour: 'stretched' };
    case 'center': {
      const centerOffset = child.x + child.width / 2 - originalParent.width / 2;
      return { offset: adaptedParent.width / 2 + centerOffset - child.width / 2, size: child.width, behaviour: 'centered' };
    }
    case 'scale': {
      const ratio = originalParent.width === 0 ? 1 : adaptedParent.width / originalParent.width;
      return { offset: child.x * ratio, size: child.width * ratio, behaviour: 'scaled' };
    }
  }
}

export function resolveVertical(input: ResolveInput, constraints: Constraints): ResolvedAxis {
  const { child, originalParent, adaptedParent } = input;
  const delta = adaptedParent.height - originalParent.height;
  const bottomGap = originalParent.height - (child.y + child.height);

  switch (constraints.vertical) {
    case 'top':
      return { offset: child.y, size: child.height, behaviour: 'pinned-left' };
    case 'bottom':
      return { offset: adaptedParent.height - bottomGap - child.height, size: child.height, behaviour: 'pinned-right' };
    case 'top-bottom':
      return { offset: child.y, size: Math.max(0, child.height + delta), behaviour: 'stretched' };
    case 'center': {
      const centerOffset = child.y + child.height / 2 - originalParent.height / 2;
      return { offset: adaptedParent.height / 2 + centerOffset - child.height / 2, size: child.height, behaviour: 'centered' };
    }
    case 'scale': {
      const ratio = originalParent.height === 0 ? 1 : adaptedParent.height / originalParent.height;
      return { offset: child.y * ratio, size: child.height * ratio, behaviour: 'scaled' };
    }
  }
}

/**
 * Classify how an element relates to the artboard edges. Used to pick the
 * least invasive transform when the source has no explicit constraint, e.g. a
 * bitmap export or a flat Figma group.
 */
export function classifyWidthBehaviour(child: Rect, parentWidth: number, tolerance = 2) {
  const leftGap = child.x;
  const rightGap = parentWidth - (child.x + child.width);
  const isFullWidth = leftGap <= tolerance && rightGap <= tolerance;
  const isEdgePadded = Math.abs(leftGap - rightGap) <= tolerance && leftGap > tolerance;
  const isCentered = Math.abs(leftGap - rightGap) <= tolerance;
  return { leftGap, rightGap, isFullWidth, isEdgePadded, isCentered };
}
