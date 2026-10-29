import { readableOn } from '@almanac/shared';

// Each color picked by hand for a label gets a shade per mode that reads as chip text there
// (readableOn in shared/): the color itself when it already does, else the nearest darker
// (light mode) or lighter (dark mode) shade of the same hue.

// The surface label text sits on in each mode: the panel, the lower-contrast background in
// both (--panel in styles.css), tinted with the label as a chip on a box would be.
const SURFACE = { light: [0xf3, 0xf1, 0xed], dark: [0x1f, 0x1e, 0x1b] };

const shades = new Map();

// The shades a hand-picked "#rrggbb" color shows in light and dark mode.
export function readableShades(hex) {
  if (!shades.has(hex)) {
    shades.set(hex, { light: readableOn(hex, SURFACE.light, 0), dark: readableOn(hex, SURFACE.dark, 1) });
  }
  return shades.get(hex);
}

// The attributes that give an element a label's color, for CSS to read as --label: a palette
// name as data-color, or a picked color's two shades as custom properties.
export function colorProps(color) {
  if (!color) return {};
  if (!color.startsWith('#')) return { 'data-color': color };
  const { light, dark } = readableShades(color);
  return { 'data-color': 'custom', style: { '--custom-light': light, '--custom-dark': dark } };
}
