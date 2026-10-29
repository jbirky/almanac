import stringWidth from 'string-width';

// Lines of styled text, measured in terminal columns. A line is a list of pieces, each one style:
// { text, fg, bg, bold, italic, underline, strike, inverse }.

const segmenter = new Intl.Segmenter();
export const graphemes = (text) => Array.from(segmenter.segment(text), (s) => s.segment);
export const width = (text) => stringWidth(text);
export const lineWidth = (line) => line.reduce((n, piece) => n + width(piece.text), 0);
export const piece = (text, style = {}) => ({ text, ...style });

const sameStyle = (a, b) =>
  a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.inverse === b.inverse;

// Neighbouring pieces in one style as one piece.
function merge(line) {
  const out = [];
  for (const p of line) {
    if (!p.text) continue;
    const last = out.at(-1);
    if (last && sameStyle(last, p)) out[out.length - 1] = { ...last, text: last.text + p.text };
    else out.push(p);
  }
  return out;
}

// The first `max` columns of a line, with … in place of what's cut.
export function truncate(line, max, ellipsis = '…') {
  if (lineWidth(line) <= max) return line;
  const room = max - width(ellipsis);
  const out = [];
  let used = 0;
  for (const p of line) {
    let text = '';
    for (const g of graphemes(p.text)) {
      if (used + width(g) > room) break;
      text += g;
      used += width(g);
    }
    if (text) out.push({ ...p, text });
    if (text.length < p.text.length) {
      out.push({ ...p, text: ellipsis.padEnd(max - used) });
      return out;
    }
  }
  return out;
}

// A line exactly `w` columns wide: cut, or filled out with spaces. With `bg`, it's the
// background of every piece that has none of its own.
export function fit(line, w, bg) {
  const cut = truncate(line, w);
  const out = bg ? cut.map((p) => (p.bg ? p : { ...p, bg })) : [...cut];
  const pad = w - lineWidth(cut);
  if (pad > 0) out.push({ text: ' '.repeat(pad), bg });
  return merge(out);
}

// `left`, then `right` flush against column `w`, with `left` cut to leave at least `gap`
// columns between them.
export function spread(left, right, w, gap = 2) {
  const rw = lineWidth(right);
  const l = truncate(left, Math.max(0, w - rw - gap));
  return [...l, piece(' '.repeat(Math.max(0, w - lineWidth(l) - rw))), ...right];
}

// Wraps a line to `w` columns, breaking between words, and inside a word too long for a line.
// A "\n" in the text breaks the line there.
export function wrap(line, w) {
  const lines = [[]];
  let used = 0;
  const newLine = () => {
    lines.push([]);
    used = 0;
  };
  for (const p of line) {
    for (const token of p.text.split(/(\n|\s+)/)) {
      if (!token) continue;
      if (token === '\n') {
        newLine();
        continue;
      }
      const tw = width(token);
      if (/^\s+$/.test(token)) {
        // Spaces where a line breaks are dropped.
        if (used > 0 && used + tw <= w) {
          lines.at(-1).push({ ...p, text: token });
          used += tw;
        } else if (used > 0) {
          newLine();
        }
        continue;
      }
      if (used + tw > w && used > 0) newLine();
      if (tw <= w) {
        lines.at(-1).push({ ...p, text: token });
        used += tw;
        continue;
      }
      for (const g of graphemes(token)) {
        if (used + width(g) > w) newLine();
        lines.at(-1).push({ ...p, text: g });
        used += width(g);
      }
    }
  }
  return lines.map((l) => {
    // Spaces left at the end of a line.
    const merged = merge(l);
    const last = merged.at(-1);
    if (last && /\s$/.test(last.text)) merged[merged.length - 1] = { ...last, text: last.text.trimEnd() };
    return merged;
  });
}
