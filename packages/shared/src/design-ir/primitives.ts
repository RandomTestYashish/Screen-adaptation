import { z } from 'zod';

/**
 * Every numeric length in the Design IR is expressed in **logical (CSS) pixels
 * of the source design's coordinate space**. Physical pixels and DPI never
 * appear in the IR; the conversion model lives in the device package
 * (spec section 5: "Do NOT confuse CSS/logical pixels with physical pixels").
 */
export const LogicalPx = z.number().finite();

export const RectSchema = z.object({
  x: LogicalPx,
  y: LogicalPx,
  width: LogicalPx.nonnegative(),
  height: LogicalPx.nonnegative(),
});
export type Rect = z.infer<typeof RectSchema>;

export const SizeSchema = z.object({ width: LogicalPx.nonnegative(), height: LogicalPx.nonnegative() });
export type Size = z.infer<typeof SizeSchema>;

export const EdgeInsetsSchema = z.object({
  top: LogicalPx,
  right: LogicalPx,
  bottom: LogicalPx,
  left: LogicalPx,
});
export type EdgeInsets = z.infer<typeof EdgeInsetsSchema>;

export const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const CornerRadiusSchema = z.object({
  topLeft: LogicalPx.nonnegative(),
  topRight: LogicalPx.nonnegative(),
  bottomRight: LogicalPx.nonnegative(),
  bottomLeft: LogicalPx.nonnegative(),
});
export type CornerRadius = z.infer<typeof CornerRadiusSchema>;

/** sRGB color with straight (non-premultiplied) alpha. */
export const ColorSchema = z.object({
  r: z.number().min(0).max(255),
  g: z.number().min(0).max(255),
  b: z.number().min(0).max(255),
  a: z.number().min(0).max(1).default(1),
});
export type Color = z.infer<typeof ColorSchema>;

export const GradientStopSchema = z.object({ position: z.number().min(0).max(1), color: ColorSchema });

export const FillSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: ColorSchema, opacity: z.number().min(0).max(1).default(1) }),
  z.object({
    type: z.literal('gradient'),
    gradientType: z.enum(['linear', 'radial', 'angular', 'diamond']),
    angle: z.number().default(0),
    stops: z.array(GradientStopSchema),
    opacity: z.number().min(0).max(1).default(1),
  }),
  z.object({
    type: z.literal('image'),
    assetId: z.string(),
    scaleMode: z.enum(['fill', 'fit', 'stretch', 'tile']).default('fill'),
    opacity: z.number().min(0).max(1).default(1),
  }),
]);
export type Fill = z.infer<typeof FillSchema>;

export const StrokeSchema = z.object({
  color: ColorSchema,
  weight: LogicalPx.nonnegative(),
  align: z.enum(['inside', 'outside', 'center']).default('inside'),
  style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
});
export type Stroke = z.infer<typeof StrokeSchema>;

export const ShadowSchema = z.object({
  type: z.enum(['drop', 'inner']).default('drop'),
  offsetX: LogicalPx,
  offsetY: LogicalPx,
  blur: LogicalPx.nonnegative(),
  spread: LogicalPx.default(0),
  color: ColorSchema,
});
export type Shadow = z.infer<typeof ShadowSchema>;

export const TypographySchema = z.object({
  fontFamily: z.string(),
  fontPostScriptName: z.string().optional(),
  fontSize: LogicalPx.positive(),
  fontWeight: z.number().int().min(1).max(1000),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  lineHeight: LogicalPx.positive(),
  /** Explicitly records whether line-height came from the source or was derived. */
  lineHeightSource: z.enum(['explicit', 'derived-from-font-size']).default('explicit'),
  letterSpacing: z.number().default(0),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).default('none'),
  textDecoration: z.enum(['none', 'underline', 'line-through']).default('none'),
  color: ColorSchema,
});
export type Typography = z.infer<typeof TypographySchema>;
