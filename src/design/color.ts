/**
 * OKLCH color utilities for theme generation.
 * Ported from OpenCode's color system for perceptually uniform color scales.
 */

import type { HexColor } from './tokens';

/**
 * OKLCH color representation
 */
export type OklchColor = {
  l: number; // Lightness 0-1
  c: number; // Chroma 0-0.4+
  h: number; // Hue 0-360
};

/**
 * Convert hex color to RGB (0-1 range)
 */
export function hexToRgb(hex: HexColor): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;

  const num = parseInt(full, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

/**
 * Convert RGB (0-1 range) to hex color
 */
export function rgbToHex(r: number, g: number, b: number): HexColor {
  const toHex = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    const int = Math.round(clamped * 255);
    return int.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * c ** (1 / 2.4) - 0.055;
}

function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Convert RGB to OKLCH color space
 */
export function rgbToOklch(r: number, g: number, b: number): OklchColor {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bOk = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.sqrt(a * a + bOk * bOk);
  let H = Math.atan2(bOk, a) * (180 / Math.PI);
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

/**
 * Convert OKLCH to RGB color space
 */
export function oklchToRgb(oklch: OklchColor): {
  r: number;
  g: number;
  b: number;
} {
  const { l: L, c: C, h: H } = oklch;

  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);

  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;

  const lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  };
}

/**
 * Convert hex to OKLCH
 */
export function hexToOklch(hex: HexColor): OklchColor {
  const { r, g, b } = hexToRgb(hex);
  return rgbToOklch(r, g, b);
}

/**
 * Convert OKLCH to hex
 */
export function oklchToHex(oklch: OklchColor): HexColor {
  const { r, g, b } = oklchToRgb(oklch);
  return rgbToHex(r, g, b);
}

/**
 * Generate a 12-step color scale from a seed color.
 * Used for chromatic colors (primary, success, warning, etc.)
 */
export function generateScale(seed: HexColor, isDark: boolean): HexColor[] {
  const base = hexToOklch(seed);
  const scale: HexColor[] = [];

  const lightSteps = isDark
    ? [
        0.15,
        0.18,
        0.22,
        0.26,
        0.32,
        0.38,
        0.46,
        0.56,
        base.l,
        base.l - 0.05,
        0.75,
        0.93,
      ]
    : [
        0.99,
        0.97,
        0.94,
        0.9,
        0.85,
        0.79,
        0.72,
        0.64,
        base.l,
        base.l + 0.05,
        0.45,
        0.25,
      ];

  const chromaMultipliers = isDark
    ? [0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1, 1, 0.9, 0.6]
    : [0.1, 0.15, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1, 1, 0.95, 0.85];

  for (let i = 0; i < 12; i++) {
    scale.push(
      oklchToHex({
        l: lightSteps[i] ?? 0.5,
        c: base.c * (chromaMultipliers[i] ?? 0.5),
        h: base.h,
      }),
    );
  }

  return scale;
}

/**
 * Generate a 12-step neutral color scale.
 * Neutrals have very low chroma for gray tones.
 */
export function generateNeutralScale(
  seed: HexColor,
  isDark: boolean,
): HexColor[] {
  const base = hexToOklch(seed);
  const scale: HexColor[] = [];
  const neutralChroma = Math.min(base.c, 0.02);

  const lightSteps = isDark
    ? [0.13, 0.16, 0.2, 0.24, 0.28, 0.33, 0.4, 0.52, 0.58, 0.66, 0.82, 0.96]
    : [0.995, 0.98, 0.96, 0.94, 0.91, 0.88, 0.84, 0.78, 0.62, 0.56, 0.46, 0.2];

  for (let i = 0; i < 12; i++) {
    scale.push(
      oklchToHex({
        l: lightSteps[i] ?? 0.5,
        c: neutralChroma,
        h: base.h,
      }),
    );
  }

  return scale;
}

/**
 * Mix two colors together
 */
export function mixColors(
  color1: HexColor,
  color2: HexColor,
  amount: number,
): HexColor {
  const c1 = hexToOklch(color1);
  const c2 = hexToOklch(color2);

  return oklchToHex({
    l: c1.l + (c2.l - c1.l) * amount,
    c: c1.c + (c2.c - c1.c) * amount,
    h: c1.h + (c2.h - c1.h) * amount,
  });
}

/**
 * Lighten a color
 */
export function lighten(color: HexColor, amount: number): HexColor {
  const oklch = hexToOklch(color);
  return oklchToHex({
    ...oklch,
    l: Math.min(1, oklch.l + amount),
  });
}

/**
 * Darken a color
 */
export function darken(color: HexColor, amount: number): HexColor {
  const oklch = hexToOklch(color);
  return oklchToHex({
    ...oklch,
    l: Math.max(0, oklch.l - amount),
  });
}

/**
 * Create an RGBA string with alpha
 */
export function withAlpha(color: HexColor, alpha: number): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

/**
 * Adjust chroma (saturation) of a color
 */
export function adjustChroma(color: HexColor, multiplier: number): HexColor {
  const oklch = hexToOklch(color);
  return oklchToHex({
    ...oklch,
    c: oklch.c * multiplier,
  });
}
