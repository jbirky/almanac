import { graphemes, piece, width } from './text.js';

// A line being typed: its characters (graphemes, so an accented letter or an emoji is one) and
// the cursor's place among them.
export const lineInput = (text = '') => {
  const chars = graphemes(text);
  return { chars, pos: chars.length };
};

export const inputText = (line) => line.chars.join('');

export function insertText(line, text) {
  const added = graphemes(text.replace(/\r?\n/g, ' '));
  return { chars: [...line.chars.slice(0, line.pos), ...added, ...line.chars.slice(line.pos)], pos: line.pos + added.length };
}

const isWordChar = (c) => /[\p{L}\p{N}_]/u.test(c);

function wordBack(chars, pos) {
  let p = pos;
  while (p > 0 && !isWordChar(chars[p - 1])) p--;
  while (p > 0 && isWordChar(chars[p - 1])) p--;
  return p;
}

function wordAhead(chars, pos) {
  let p = pos;
  while (p < chars.length && !isWordChar(chars[p])) p++;
  while (p < chars.length && isWordChar(chars[p])) p++;
  return p;
}

// The line after a key, with readline's keys: ← →, Home and End or Ctrl+A and Ctrl+E, Alt+B and
// Alt+F (or Alt+← and Alt+→) for a word back or ahead, Backspace and Delete, Ctrl+W (or
// Alt+Backspace) to delete a word back, Ctrl+U to delete back to the start. Null for a key that
// isn't typing, such as Enter or Esc.
export function editLine(line, input, key) {
  const { chars, pos } = line;
  const to = (next) => ({ chars, pos: Math.max(0, Math.min(chars.length, next)) });
  const cut = (from, until) => ({ chars: [...chars.slice(0, from), ...chars.slice(until)], pos: from });
  if ((key.meta && key.leftArrow) || (key.meta && input === 'b')) return to(wordBack(chars, pos));
  if ((key.meta && key.rightArrow) || (key.meta && input === 'f')) return to(wordAhead(chars, pos));
  if (key.leftArrow) return to(pos - 1);
  if (key.rightArrow) return to(pos + 1);
  if (key.home || (key.ctrl && input === 'a')) return to(0);
  if (key.end || (key.ctrl && input === 'e')) return to(chars.length);
  if ((key.meta && key.backspace) || (key.ctrl && input === 'w')) return cut(wordBack(chars, pos), pos);
  if (key.backspace) return pos > 0 ? cut(pos - 1, pos) : line;
  if (key.delete || (key.ctrl && input === 'd')) return pos < chars.length ? cut(pos, pos + 1) : line;
  if (key.ctrl && input === 'u') return cut(0, pos);
  if (key.ctrl || key.meta || key.return || key.escape || key.tab || key.upArrow || key.downArrow) return null;
  // eslint-disable-next-line no-control-regex
  if (!input || /[\x00-\x1f\x7f]/.test(input)) return null;
  return insertText(line, input);
}

// The line as pieces at most `w` columns wide, with the cursor as an inverted character,
// scrolled sideways to keep the cursor in view. `placeholder` shows while it's empty.
export function inputPieces(line, w, { fg, placeholder = '', faint } = {}) {
  if (!line.chars.length) {
    const [first = ' ', ...rest] = graphemes(placeholder);
    return [piece(first, { fg: placeholder ? faint : fg, inverse: true }), piece(rest.join(''), { fg: faint })].filter((p) => p.text);
  }
  const chars = [...line.chars, ' '];
  // The first character shown: as far left as keeps the cursor on screen.
  let start = 0;
  let used = chars.slice(0, line.pos + 1).reduce((n, c) => n + width(c), 0);
  while (used > w && start < line.pos) used -= width(chars[start++]);
  const out = [];
  let col = 0;
  for (let i = start; i < chars.length; i++) {
    const cw = width(chars[i]);
    if (col + cw > w) break;
    out.push(piece(chars[i], i === line.pos ? { fg, inverse: true } : { fg }));
    col += cw;
  }
  return out;
}
