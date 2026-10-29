import { timeOfDay } from '@almanac/shared';
import { fit, piece } from '../text.js';

// How sync is going, as a glyph and a few words: a quiet dot while all is well. Why a copy is
// read-only is a notice of its own, when it opens (see App).
export function syncState(status, theme) {
  if (status.readOnly) return { glyph: '◇', fg: theme.muted, text: 'read-only' };
  if (status.error) return { glyph: '✕', fg: theme.late, text: `Sync error: ${status.error}` };
  if (!status.online) return { glyph: '○', fg: theme.late, text: status.pending ? `Offline · ${status.pending} waiting` : 'Offline' };
  if (status.syncing || status.pending) return { glyph: '◌', fg: theme.muted, text: 'syncing' };
  if (status.lastSync) return { glyph: '●', fg: theme.accent, text: `synced ${timeOfDay(status.lastSync)}` };
  return { glyph: '◌', fg: theme.muted, text: 'starting' };
}

// The bar along the bottom: sync, the pane with focus (or what's being typed), then the keys for
// what the cursor is on, or a notice in their place. `typing` is a line of its own, such as
// "Go to" and the date being typed, shown in place of the keys.
export function statusLine({ status, mode, typingMode = false, hints, notice, line = null, theme, w }) {
  const sync = syncState(status, theme);
  const chip = typingMode
    ? piece(` ${mode} `, { fg: theme.tints ? theme.panel : undefined, bg: theme.accent, bold: true, inverse: !theme.tints || undefined })
    : piece(` ${mode} `, { fg: theme.accent, bg: theme.accentSoft, bold: true });
  const out = [piece(' '), piece(sync.glyph, { fg: sync.fg }), piece(` ${sync.text}  `, { fg: theme.muted }), chip, piece('  ')];
  if (line) out.push(...line);
  else if (notice) out.push(piece(notice.text, { fg: notice.tone === 'warn' ? theme.late : theme.text }));
  else for (const [key, desc] of hints) out.push(piece(key, { fg: theme.text, bold: true }), piece(` ${desc}  `, { fg: theme.muted }));
  return fit(out, w, theme.panel);
}
