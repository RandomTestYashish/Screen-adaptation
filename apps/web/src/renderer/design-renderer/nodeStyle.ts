import type { CSSProperties } from 'react';
import type { AdaptedNode, Color, DesignNode, Fill, Shadow, Stroke } from '@dae/shared';

export function rgba(color: Color): string {
  const { r, g, b, a } = color;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function backgroundFrom(fills: Fill[], assetUrl: (assetId: string) => string | undefined): CSSProperties {
  const style: CSSProperties = {};
  const layers: string[] = [];
  let solid: string | undefined;

  // Figma paints fills bottom-first; CSS stacks background layers top-first.
  for (const fill of [...fills].reverse()) {
    if (fill.type === 'solid') {
      solid = rgba({ ...fill.color, a: fill.color.a * fill.opacity });
    } else if (fill.type === 'gradient') {
      const stops = fill.stops.map((s) => `${rgba(s.color)} ${Math.round(s.position * 100)}%`).join(', ');
      layers.push(
        fill.gradientType === 'radial'
          ? `radial-gradient(circle, ${stops})`
          : fill.gradientType === 'angular'
            ? `conic-gradient(from ${fill.angle}deg, ${stops})`
            : `linear-gradient(${fill.angle + 90}deg, ${stops})`,
      );
    } else if (fill.type === 'image') {
      const url = assetUrl(fill.assetId);
      if (url) {
        layers.push(`url("${url}")`);
        style.backgroundSize = fill.scaleMode === 'fit' ? 'contain' : fill.scaleMode === 'tile' ? 'auto' : 'cover';
        style.backgroundRepeat = fill.scaleMode === 'tile' ? 'repeat' : 'no-repeat';
        style.backgroundPosition = 'center';
      }
    }
  }

  if (layers.length > 0) style.backgroundImage = layers.join(', ');
  if (solid) style.backgroundColor = solid;
  return style;
}

function shadowCss(shadows: Shadow[]): string | undefined {
  if (shadows.length === 0) return undefined;
  return shadows
    .map((s) => `${s.type === 'inner' ? 'inset ' : ''}${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${rgba(s.color)}`)
    .join(', ');
}

function strokeCss(strokes: Stroke[]): CSSProperties {
  const stroke = strokes[0];
  if (!stroke) return {};
  // `inside` alignment matches CSS box-shadow inset better than `border`,
  // which would change the element's box and therefore its layout.
  if (stroke.align === 'inside') {
    return { boxShadow: `inset 0 0 0 ${stroke.weight}px ${rgba(stroke.color)}` };
  }
  return {
    outline: `${stroke.weight}px ${stroke.style} ${rgba(stroke.color)}`,
    outlineOffset: stroke.align === 'outside' ? 0 : -stroke.weight / 2,
  };
}

/**
 * Translate an IR node plus its adapted geometry into CSS.
 *
 * Everything visual comes straight from the source: this function never
 * substitutes a colour, a font or a radius. The only values that differ from
 * the source are the geometry the adaptation plan produced.
 */
export function nodeStyle(
  node: DesignNode,
  adapted: AdaptedNode,
  assetUrl: (assetId: string) => string | undefined,
  /**
   * Origin of the adapted parent.
   *
   * The IR stores every frame in document coordinates, because adaptation and
   * validation both reason about absolute geometry. CSS absolute positioning is
   * relative to the nearest positioned ancestor, so a nested node must have its
   * parent's origin subtracted - otherwise a card's title is placed at its
   * document offset *inside* the card and lands far below it.
   */
  parentOrigin: { x: number; y: number } = { x: 0, y: 0 },
): CSSProperties {
  const background = backgroundFrom(node.fills, assetUrl);
  const stroke = strokeCss(node.strokes);
  const shadow = shadowCss(node.shadows);

  const style: CSSProperties = {
    position: 'absolute',
    left: adapted.frame.x - parentOrigin.x,
    top: adapted.frame.y - parentOrigin.y,
    width: adapted.frame.width,
    height: adapted.frame.height,
    opacity: node.opacity,
    zIndex: node.zIndex,
    borderRadius: `${node.cornerRadius.topLeft}px ${node.cornerRadius.topRight}px ${node.cornerRadius.bottomRight}px ${node.cornerRadius.bottomLeft}px`,
    overflow: node.clipsContent ? 'hidden' : 'visible',
    boxSizing: 'border-box',
    ...background,
    ...stroke,
  };

  if (node.rotation) style.transform = `rotate(${node.rotation}deg)`;
  if (shadow) style.boxShadow = [stroke.boxShadow, shadow].filter(Boolean).join(', ');

  if (node.type === 'text') {
    const t = node.typography;
    style.fontFamily = `"${t.fontFamily}", var(--font-fallback)`;
    style.fontSize = t.fontSize;
    style.fontWeight = t.fontWeight;
    style.fontStyle = t.fontStyle;
    style.lineHeight = `${t.lineHeight}px`;
    style.letterSpacing = `${t.letterSpacing}px`;
    style.textAlign = t.textAlign;
    style.textTransform = t.textTransform;
    style.textDecoration = t.textDecoration;
    style.color = rgba(t.color);
    style.paddingTop = node.padding.top;
    style.paddingRight = node.padding.right;
    style.paddingBottom = node.padding.bottom;
    style.paddingLeft = node.padding.left;
    style.display = 'flex';
    style.flexDirection = 'column';
    style.justifyContent = t.verticalAlign === 'middle' ? 'center' : t.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
    style.whiteSpace = 'pre-wrap';
    style.wordBreak = 'normal';
    if (node.overflow === 'clip') style.overflow = 'hidden';
    if (node.maxLines) {
      style.display = '-webkit-box';
      style.WebkitLineClamp = node.maxLines;
      style.WebkitBoxOrient = 'vertical';
      style.overflow = 'hidden';
    }
  }

  return style;
}
