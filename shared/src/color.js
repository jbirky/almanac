// Colors picked by hand for labels. A label's color is also its text color, on a chip tinted
// with it, so a picked color has to be shown in a shade that reads at 4.5:1 on whatever surface
// the chip sits on: the color itself when it already does, else the nearest darker or lighter
// shade of the same hue. The web app's surface is its panel color; the terminal's is its own
// background.

const MIN_CONTRAST = 4.5;

export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbToHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const toLinear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => 255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

export const luminance = (rgb) => {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const readsOn = (rgb, surface, tint) => contrast(rgb, rgb.map((c, i) => tint * c + (1 - tint) * surface[i])) >= MIN_CONTRAST;

// OKLab, so changing lightness keeps the hue and looks even.
function toOklab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear);
}

// The shade of `hex` closest to it that reads on a chip of it tinted `tint` over `surface` (an
// [r, g, b]), moving lightness toward `target` (0 to darken, 1 to lighten).
export function readableOn(hex, surface, target, tint = 0.18) {
  const rgb = hexToRgb(hex);
  if (readsOn(rgb, surface, tint)) return hex;
  const [L0, a, b] = toOklab(rgb);
  // Checked as the hex it will be, since rounding can tip it under. Black and white read.
  const at = (L) => rgbToHex(fromOklab([L, a, b]));
  let near = L0;
  let far = target;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (readsOn(hexToRgb(at(mid)), surface, tint)) far = mid;
    else near = mid;
  }
  return at(far);
}
