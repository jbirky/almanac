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

// Whether two names are the same label (see labelKey). Names with nothing labelKey keeps, such
// as "!!!", compare as typed, ignoring case.
export function sameLabel(a, b) {
  const key = labelKey(a);
  return key ? key === labelKey(b) : a.trim().toLowerCase() === b.trim().toLowerCase();
}

// The label a typed name refers to: an existing one whatever its case or spacing, else a new
// one, made with `create({ id, name })`. Blank means none.
export function resolveLabel(text, labels, create) {
  const name = text.trim();
  if (!name) return null;
  const existing = labels.find((l) => sameLabel(l.name, name));
  if (existing) return existing.id;
  // A label renamed since it was made still holds the id its old name gave it.
  const id = labels.some((l) => l.id === labelId(name)) ? newId() : labelId(name);
  create({ id, name });
  return id;
}
