import * as Y from 'yjs';
import { BODY_FIELD, NOTE_BOX } from '@almanac/shared';
import { graphemes, piece, width } from '../text.js';

// A day's journal, read from the same Yjs document TipTap edits in the browser, as the blocks
// the terminal draws, in order. Each is one of:
//   { kind: 'text', style: 'paragraph' | 'heading' | 'code', level, inline, marker, indent, quote, editable }
//   { kind: 'task', id }
//   { kind: 'image', file, alt, width, height }
//   { kind: 'math', latex }
//   { kind: 'rule' }
//   { kind: 'box', id, label, blocks }: a notes box, holding blocks of its own
// and has `el`, its element, and `key`, which stays the same while the element does. `inline` is
// a list of { text, marks, from } and { math, from } (a formula in the line), `from` being where
// it starts in the block; `marker` is a list item's "•" or "3.", `indent` how far its list is
// nested, and `quote` how many quotes it's in. A block of a kind this version doesn't know shows
// as its text, and can't be written in.
export function readJournal(doc) {
  return readBlocks(doc.getXmlFragment(BODY_FIELD).toArray(), {});
}

// A key for an element that stays the same as the document changes around it: its Yjs id.
export const keyOf = (el) => (el._item ? `${el._item.id.client}.${el._item.id.clock}` : 'new');

// Marks TipTap's StarterKit stores as formatting attributes on the text.
const MARKS = ['bold', 'italic', 'strike', 'underline', 'code', 'link'];

function inlineOf(element) {
  const out = [];
  let at = 0;
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta()) {
        if (typeof op.insert !== 'string') continue;
        const marks = {};
        for (const mark of MARKS) if (op.attributes?.[mark] !== undefined) marks[mark] = op.attributes[mark] ?? true;
        out.push({ text: op.insert, marks, from: at });
        at += op.insert.length;
      }
      continue;
    }
    if (child instanceof Y.XmlElement) {
      if (child.nodeName === 'inlineMath') out.push({ math: child.getAttribute('latex') ?? '', from: at });
      else if (child.nodeName === 'hardBreak') out.push({ text: '\n', marks: {}, from: at, atom: true });
      // An old [[link]] to a page shows its title.
      else if (child.nodeName === 'itemRef') out.push({ text: child.getAttribute('label') || 'Untitled', marks: {}, from: at, atom: true });
      else out.push({ text: plainText(child), marks: {}, from: at, atom: true });
    }
    at += 1;
  }
  return out;
}

function plainText(node) {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]*>/g, '');
  if (node instanceof Y.XmlElement && (node.nodeName === 'inlineMath' || node.nodeName === 'blockMath')) return node.getAttribute('latex') ?? '';
  return node.toArray().map(plainText).join('');
}

function readBlocks(nodes, at) {
  const blocks = [];
  for (const node of nodes) {
    if (!(node instanceof Y.XmlElement)) continue;
    const name = node.nodeName;
    const own = { el: node, key: keyOf(node) };
    const text = (style, extra = {}) => ({
      kind: 'text',
      style,
      inline: inlineOf(node),
      marker: at.marker,
      indent: at.indent ?? 0,
      quote: at.quote ?? 0,
      editable: true,
      ...own,
      ...extra,
    });
    if (name === 'paragraph') blocks.push(text('paragraph'));
    else if (name === 'heading') blocks.push(text('heading', { level: Number(node.getAttribute('level')) || 1 }));
    else if (name === 'codeBlock') blocks.push(text('code'));
    else if (name === 'taskRef') blocks.push({ kind: 'task', id: node.getAttribute('id') ?? null, ...own });
    else if (name === 'blockMath') blocks.push({ kind: 'math', latex: node.getAttribute('latex') ?? '', ...own });
    else if (name === 'horizontalRule') blocks.push({ kind: 'rule', ...own });
    else if (name === 'image') {
      blocks.push({
        kind: 'image',
        file: node.getAttribute('file') ?? null,
        alt: node.getAttribute('alt') ?? '',
        width: node.getAttribute('width') ?? null,
        height: node.getAttribute('height') ?? null,
        ...own,
      });
    } else if (name === NOTE_BOX) {
      blocks.push({ kind: 'box', id: node.getAttribute('id') ?? null, label: node.getAttribute('label') ?? null, blocks: readBlocks(node.toArray(), {}), ...own });
    } else if (name === 'blockquote') {
      blocks.push(...readBlocks(node.toArray(), { ...at, quote: (at.quote ?? 0) + 1 }));
    } else if (name === 'bulletList' || name === 'orderedList') {
      const start = Number(node.getAttribute('start')) || 1;
      node.toArray().forEach((item, i) => {
        if (!(item instanceof Y.XmlElement)) return;
        const marker = name === 'bulletList' ? '•' : `${start + i}.`;
        // The item's first block carries the marker, the rest line up under its text, and a
        // list inside it is nested one step further.
        let first = true;
        for (const child of item.toArray()) {
          if (child instanceof Y.XmlElement && /^(bullet|ordered)List$/.test(child.nodeName)) {
            blocks.push(...readBlocks([child], { ...at, marker: undefined, indent: (at.indent ?? 0) + 1 }));
          } else {
            blocks.push(...readBlocks([child], { ...at, marker: first ? marker : ' '.repeat(marker.length) }));
            first = false;
          }
        }
      });
    } else {
      blocks.push(text('paragraph', { inline: [{ text: plainText(node), marks: {}, from: 0, atom: true }], editable: false }));
    }
  }
  return blocks;
}

// A textblock's text wrapped to `w` columns, breaking between words (and inside a word too long
// for a line), with where each place in it is on screen. `parts` are its inline parts styled:
// { text, style, from, atom } (an atom is one place, however wide). Returns lines, each
// { pieces, from, to, cols }: `cols` holds [offset, column] for each place on the line from
// `from` to `to`. A place at the end of one line and the start of the next is the next's. With
// `caret`, the character there (or a space at a line's end) is drawn inverted.
export function layoutText(parts, w, caret = null) {
  const units = [];
  for (const part of parts) {
    if (part.atom) {
      units.push({ text: part.text, style: part.style, from: part.from, len: 1, kind: part.text === '\n' ? 'break' : 'word', atom: true });
      continue;
    }
    let at = part.from;
    for (const g of graphemes(part.text)) {
      units.push({ text: g, style: part.style, from: at, len: g.length, kind: g === '\n' ? 'break' : /^\s+$/.test(g) ? 'space' : 'word' });
      at += g.length;
    }
  }
  const end = units.length ? units.at(-1).from + units.at(-1).len : (parts[0]?.from ?? 0);

  // Words: runs of word units; an atom stands alone.
  const lines = [];
  let line = null;
  const newLine = (from) => {
    line = { units: [], from, used: 0 };
    lines.push(line);
  };
  newLine(units[0]?.from ?? end);
  for (let i = 0; i < units.length; ) {
    const u = units[i];
    if (u.kind === 'break') {
      line.units.push({ ...u, col: line.used, w: 0 });
      i++;
      newLine(u.from + u.len);
      continue;
    }
    if (u.kind === 'space') {
      line.units.push({ ...u, col: line.used, w: width(u.text) });
      line.used += width(u.text);
      i++;
      continue;
    }
    let j = i;
    let ww = 0;
    do {
      ww += width(units[j].text);
      j++;
    } while (j < units.length && units[j].kind === 'word' && !units[j].atom && !units[j - 1].atom);
    if (line.used > 0 && line.used + ww > w) newLine(u.from);
    for (let k = i; k < j; k++) {
      const cw = width(units[k].text);
      if (line.used > 0 && line.used + cw > w) newLine(units[k].from);
      line.units.push({ ...units[k], col: line.used, w: cw });
      line.used += cw;
    }
    i = j;
  }

  return lines.map((l, n) => {
    const to = lines[n + 1]?.from ?? end;
    const cols = l.units.map((u) => [u.from, u.col]);
    const last = l.units.at(-1);
    // The block's end is a place of its own, on its last line (which never ends with a break).
    if (n === lines.length - 1) cols.push([last ? last.from + last.len : l.from, last ? last.col + last.w : 0]);
    const here = caret !== null && caret >= l.from && (caret < to || n === lines.length - 1);
    const pieces = [];
    for (const u of l.units) {
      if (u.kind === 'break') {
        if (here && caret === u.from) pieces.push(piece(' ', { ...u.style, inverse: true }));
        continue;
      }
      pieces.push(piece(u.text, here && caret === u.from ? { ...u.style, inverse: true } : u.style));
    }
    if (here && caret === (last ? last.from + last.len : l.from) && last?.kind !== 'break') pieces.push(piece(' ', { inverse: true }));
    return { pieces, from: l.from, to, cols };
  });
}
