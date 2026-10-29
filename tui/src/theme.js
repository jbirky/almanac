import { hexToRgb, luminance, readableOn, rgbToHex } from '@almanac/shared';

// The web app's colors, for a terminal's dark or light background. The terminal keeps its own
// background and font; panels and notes boxes are tinted from its background.
const BASE = {
  dark: { bg: '#171614', text: '#ebe7e0', muted: '#9b958b', late: '#e8836c', match: '#e0b04a', math: '#86ade8' },
  light: { bg: '#fbfaf8', text: '#1f1d1a', muted: '#68635b', late: '#b4442f', match: '#d39b2a', math: '#2a5c9b' },
};

// Each color scheme's accent in light and dark, as in the web app's Settings.
export const SCHEMES = {
  paper: ['#2b685b', '#6cbfa9'],
  ocean: ['#245f96', '#7cb2e6'],
  rose: ['#9e3a59', '#eb94b0'],
  plum: ['#6a479f', '#bba1ef'],
  sand: ['#875611', '#e2b25f'],
  graphite: ['#3f4652', '#b9c1cd'],
};

// The label palette, as in styles.css.
const LABELS = {
  blue: ['#2a5c9b', '#86ade8'],
  orange: ['#964713', '#e99a62'],
  green: ['#2f6a2e', '#8cc283'],
  purple: ['#7343a6', '#b896e8'],
  red: ['#a3323f', '#ec8790'],
  teal: ['#1a6570', '#6cc6cf'],
  yellow: ['#735806', '#d9b955'],
  pink: ['#973470', '#e690c4'],
};

const mix = (a, b, t) => {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(x.map((c, i) => c + (y[i] - c) * t));
};

// `background` is the terminal's, as [r, g, b], if it said; `mode` is "light" or "dark" from the
// settings, which wins; `level` is the terminal's color depth (chalk's: 1 for 16 colors, 2 for
// 256, 3 for millions). Tints need 256 colors or more; with fewer, nothing gets a background.
export function makeTheme({ background = null, mode = null, scheme = 'paper', level = 3 } = {}) {
  const dark = mode ? mode === 'dark' : background ? luminance(background) < 0.25 : true;
  const base = BASE[dark ? 'dark' : 'light'];
  const bg = background ? rgbToHex(background) : base.bg;
  const accent = (SCHEMES[scheme] ?? SCHEMES.paper)[dark ? 1 : 0];
  const tints = level >= 2;
  const tint = (color, t) => (tints ? mix(bg, color, t) : undefined);
  const cell = mix(bg, base.text, dark ? 0.075 : 0.085);
  const labels = new Map();
  return {
    dark,
    tints,
    // The terminal's background and color depth, which images are drawn for.
    bg,
    level,
    text: base.text,
    muted: base.muted,
    faint: mix(bg, base.muted, 0.6),
    late: base.late,
    match: base.match,
    math: base.math,
    accent,
    cell,
    line: mix(bg, base.text, 0.16),
    // The Due panel and the task box.
    panel: tint(base.text, 0.037),
    // The status bar and pickers.
    pop: tint(base.text, 0.075),
    accentSoft: tint(accent, dark ? 0.17 : 0.12),
    chip: tint(base.text, dark ? 0.09 : 0.06),
    // Tasks finished in a day, in four steps from the empty cell to the accent.
    levels: [0.35, 0.55, 0.78, 1].map((t) => mix(cell, accent, t)),
    // A label's color: its text, the tint of its boxes and of its chip. A color picked by hand
    // gets the shade of it that reads on this background.
    label(color) {
      if (!labels.has(color)) {
        const text = LABELS[color]?.[dark ? 1 : 0] ?? (/^#[0-9a-f]{6}$/.test(color ?? '') ? readableOn(color, hexToRgb(bg), dark ? 1 : 0) : base.muted);
        labels.set(color, { text, box: tint(text, dark ? 0.075 : 0.055), chip: tint(text, dark ? 0.18 : 0.12) });
      }
      return labels.get(color);
    },
  };
}
