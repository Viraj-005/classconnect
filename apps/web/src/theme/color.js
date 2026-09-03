/*
  Colour maths for tenant theming.

  A Growth or Pro tenant gives us one accent hex. From that we build a
  full 50 to 900 ramp that still has enough contrast at every step,
  otherwise a tenant picking a pale yellow produces white text on a near
  white button. Generating the ramp rather than storing ten hexes is
  also what keeps brandingConfig small.
*/

export function hexToRgb(hex) {
  const clean = String(hex).replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const to = (v) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

function channelLuminance(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb) {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/*
  Pick the foreground that actually passes against a given background.
  A tenant can choose any accent, so button label colour is decided at
  runtime rather than assumed to be white. This single function is what
  stops a light brand colour from erasing every button label.
*/
export function readableOn(background) {
  const onWhite = contrastRatio(background, "#ffffff");
  const onInk = contrastRatio(background, "#17131c");
  return onWhite >= onInk ? "#ffffff" : "#17131c";
}

/* Lightness targets per ramp stop, tuned against the default plum ramp. */
const STOPS = [
  ["50", 0.965],
  ["100", 0.925],
  ["200", 0.845],
  ["300", 0.73],
  ["400", 0.59],
  ["500", 0.45],
  ["600", 0.35],
  ["700", 0.28],
  ["800", 0.22],
  ["900", 0.155],
];

/*
  Saturation is pulled down at the light end and held near the source in
  the middle. Holding saturation flat across the ramp makes the 50 and
  100 stops look dirty, which is what gives cheap generated palettes away.
*/
function saturationFor(base, lightness) {
  if (lightness > 0.9) return Math.min(base * 0.42, 0.34);
  if (lightness > 0.8) return Math.min(base * 0.6, 0.45);
  if (lightness > 0.62) return Math.min(base * 0.8, 0.6);
  if (lightness < 0.25) return Math.min(base * 1.02, 0.9);
  return Math.min(base, 0.86);
}

export function buildRamp(baseHex) {
  const hsl = rgbToHsl(hexToRgb(baseHex));
  /*
    A fully desaturated input would generate a grey ramp that reads as
    broken rather than intentional, so floor the saturation.
  */
  const s = Math.max(hsl.s, 0.16);
  const ramp = {};
  for (const [stop, l] of STOPS) {
    ramp[stop] = rgbToHex(hslToRgb({ h: hsl.h, s: saturationFor(s, l), l }));
  }
  /*
    Anchor the stop the tenant actually picked, so their brand colour
    appears exactly as given rather than as our approximation of it.
  */
  ramp["600"] = String(baseHex).startsWith("#") ? baseHex : `#${baseHex}`;
  return ramp;
}

export function gradientFrom(ramp) {
  return `linear-gradient(135deg, ${ramp["600"]} 0%, ${ramp["500"]} 100%)`;
}

/*
  Rotate a hex around the colour wheel, keeping saturation and
  lightness. Used to derive each portal's identity hue from the tenant's
  own brand colour rather than from a fixed LoopLab palette.
*/
export function rotateHue(hex, degrees) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, h: hsl.h + degrees }));
}

/* Same hue, forced to a target lightness. Used for rail backgrounds. */
export function atLightness(hex, lightness, maxSaturation = 0.5) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(
    hslToRgb({ h: hsl.h, s: Math.min(Math.max(hsl.s, 0.16), maxSaturation), l: lightness }),
  );
}

/* rgba() string from a hex, for halo and ring tokens. */
export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/* Valid six or three digit hex, used to validate the branding input. */
export function isValidHex(value) {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value).trim());
}
