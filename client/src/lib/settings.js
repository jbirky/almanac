import { useSyncExternalStore } from 'react';

// Appearance settings: this browser's own, kept in its storage and not synced, so a phone can
// stay dark while a laptop is light. index.html applies them before the page first draws; the
// values become data attributes on <html> that styles.css reads.
const KEY = 'almanac.settings';

export const MODES = [
  { id: 'system', name: 'Match system' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
];

export const THEMES = [
  { id: 'paper', name: 'Paper' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'rose', name: 'Rose' },
  { id: 'plum', name: 'Plum' },
  { id: 'sand', name: 'Sand' },
  { id: 'graphite', name: 'Graphite' },
];

// Grouped by kind in Settings. An id is lowercase letters only, as index.html checks.
export const FONT_KINDS = ['Sans-serif', 'Serif', 'Monospaced'];
export const FONTS = [
  { id: 'system', kind: 'Sans-serif', name: 'System', note: "Your device's own" },
  { id: 'inter', kind: 'Sans-serif', name: 'Inter', note: 'Clean and neutral' },
  { id: 'plex', kind: 'Sans-serif', name: 'IBM Plex Sans', note: 'Crisp and technical' },
  { id: 'nunito', kind: 'Sans-serif', name: 'Nunito', note: 'Rounded and friendly' },
  { id: 'atkinson', kind: 'Sans-serif', name: 'Atkinson Hyperlegible', note: 'Made to tell letters apart' },
  { id: 'shantell', kind: 'Sans-serif', name: 'Shantell Sans', note: 'Handwritten, still easy to read' },
  { id: 'literata', kind: 'Serif', name: 'Literata', note: 'Made for long reading' },
  { id: 'sourceserif', kind: 'Serif', name: 'Source Serif', note: 'Sturdy and plain' },
  { id: 'newsreader', kind: 'Serif', name: 'Newsreader', note: 'Like a newspaper' },
  { id: 'merriweather', kind: 'Serif', name: 'Merriweather', note: 'Wide and solid, for screens' },
  { id: 'garamond', kind: 'Serif', name: 'EB Garamond', note: 'A classic book face' },
  { id: 'mono', kind: 'Monospaced', name: 'JetBrains Mono', note: 'Made for code' },
  { id: 'courier', kind: 'Monospaced', name: 'Courier Prime', note: 'Like a typewriter' },
];

const DEFAULTS = { mode: 'system', theme: 'paper', font: 'system' };
const CHOICES = { mode: MODES, theme: THEMES, font: FONTS };
const listeners = new Set();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const settings = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (CHOICES[key].some((c) => c.id === saved[key])) settings[key] = saved[key];
    }
    return settings;
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();

// The same as index.html does at load: the defaults leave the attribute off.
function apply() {
  const root = document.documentElement;
  for (const key of Object.keys(DEFAULTS)) {
    if (settings[key] === DEFAULTS[key]) delete root.dataset[key];
    else root.dataset[key] = settings[key];
  }
}

export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
  apply();
  for (const listener of listeners) listener();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useSettings() {
  return useSyncExternalStore(subscribe, () => settings);
}

// Whether the page is showing its dark colors.
export function isDark() {
  const { mode } = document.documentElement.dataset;
  return mode ? mode === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
