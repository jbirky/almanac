import { newId } from './util.js';

// Colors a notes-box label can have, in the order new labels take them. The client maps
// each name to a shade for light and dark mode.
export const LABEL_COLORS = ['blue', 'orange', 'green', 'purple', 'red', 'teal', 'yellow', 'pink'];

// A label's color: one of LABEL_COLORS, or any color picked by hand as "#rrggbb".
export function isLabelColor(color) {
  return LABEL_COLORS.includes(color) || (typeof color === 'string' && /^#[0-9a-f]{6}$/.test(color));
}

// What makes two label names the same label: case, spaces and punctuation don't count, so
// "Paper notes", "paper-notes" and "#papernotes" are one label.
export function labelKey(name) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 64);
}

// A new label's id comes from its name, so two devices that create the same label offline
// end up with one label instead of two.
export function labelId(name) {
  const key = labelKey(name);
  return key ? `label-${key}` : newId();
}
