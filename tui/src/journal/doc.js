import * as Y from 'yjs';
import { NOTE_BOX } from '@almanac/shared';

// Changes to a day's Yjs document in the shapes TipTap's schema allows, so the browser loads what
// the terminal writes as it is (see the schema tests). A body is y-prosemirror's mapping of a
// ProseMirror document: each node an XmlElement named for its type with its attributes (null ones
// left out), each run of text an XmlText whose formatting attributes are its marks ({ bold: {} }).
//
// Places in a textblock (a paragraph, heading or code block) are counted as ProseMirror counts
// them: a character of text is one, and so is an inline element such as a formula.

export const TEXTBLOCKS = ['paragraph', 'heading', 'codeBlock'];
export const LISTS = ['bulletList', 'orderedList'];

export const isElement = (node, ...names) => node instanceof Y.XmlElement && (!names.length || names.includes(node.nodeName));
export const isTextblock = (node) => isElement(node, ...TEXTBLOCKS);
export const isBox = (node) => isElement(node, NOTE_BOX);
const isEmptyParagraph = (node) => isElement(node, 'paragraph') && textLength(node) === 0;

const units = (child) => (child instanceof Y.XmlText ? child.length : 1);
export const textLength = (el) => el.toArray().reduce((n, child) => n + units(child), 0);
export const indexIn = (node) => node.parent.toArray().indexOf(node);

// A new element, its attributes set; null ones are left out, as y-prosemirror leaves them.
export function element(name, attrs = {}) {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) el.setAttribute(key, value);
  return el;
}

// Puts `nodes` into `parent` at `index` and returns them, now part of the document to be filled in.
function insertAt(parent, index, ...nodes) {
  parent.insert(index, nodes);
  return nodes;
}

// The text of a textblock up to `offset`, an inline element standing as U+FFFC, as TipTap's input
// rules read it.
export function textBefore(el, offset) {
  let out = '';
  let at = 0;
  for (const child of el.toArray()) {
    if (at >= offset) break;
    out += child instanceof Y.XmlText ? deltaText(child).slice(0, offset - at) : '￼';
    at += units(child);
  }
  return out;
}

const deltaText = (text) =>
  text
    .toDelta()
    .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
    .join('');

// A textblock's plain text, without its inline elements.
export const plainText = (el) => el.toArray().map((child) => (child instanceof Y.XmlText ? deltaText(child) : '')).join('');

// The formatting at `offset`: the character before it's, or at a block's start the one after it's.
export function marksAt(el, offset) {
  let at = 0;
  let after = null;
  for (const child of el.toArray()) {
    const len = units(child);
    if (child instanceof Y.XmlText) {
      let pos = at;
      for (const op of child.toDelta()) {
        if (typeof op.insert !== 'string') continue;
        if (offset > pos && offset <= pos + op.insert.length) return op.attributes ?? {};
        if (offset === pos && after === null) after = op.attributes ?? {};
        pos += op.insert.length;
      }
    } else if (offset === at + 1) {
      return {};
    }
    at += len;
  }
  return offset === 0 && after ? after : {};
}

function sliceDelta(delta, from, to) {
  const out = [];
  let pos = 0;
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + op.insert.length);
    if (b > a) out.push({ insert: op.insert.slice(a - pos, b - pos), attributes: op.attributes });
    pos += op.insert.length;
  }
  return out;
}

// Adds text to the end of run `text`, keeping each piece's formatting as it is.
function appendDelta(text, delta) {
  for (const op of delta) text.insert(text.length, op.insert, op.attributes ?? {});
}

// Adds text to the end of element `target`, in its last run of text or a new one.
function appendText(target, delta) {
  if (!delta.length) return;
  let last = target.toArray().at(-1);
  if (!(last instanceof Y.XmlText)) [last] = insertAt(target, target.length, new Y.XmlText());
  appendDelta(last, delta);
}

// Copies what's between `from` and `to` in textblock `source` to the end of `target`.
function copyInline(source, from, to, target) {
  let at = 0;
  for (const child of source.toArray()) {
    const len = units(child);
    const a = Math.max(from, at);
    const b = Math.min(to, at + len);
    if (b > a) {
      if (child instanceof Y.XmlText) appendText(target, sliceDelta(child.toDelta(), a - at, b - at));
      else target.insert(target.length, [child.clone()]);
    }
    at += len;
  }
}

// Types `text` at `offset`. With `attributes`, the text has exactly that formatting; without, it
// takes the formatting of the character before it, as typing does in the browser.
export function insertText(el, offset, text, attributes) {
  let at = 0;
  const children = el.toArray();
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child instanceof Y.XmlText && offset <= at + child.length) {
      if (attributes) child.insert(offset - at, text, attributes);
      else child.insert(offset - at, text);
      return;
    }
    if (!(child instanceof Y.XmlText) && offset <= at) {
      const [made] = insertAt(el, i, new Y.XmlText());
      made.insert(0, text, attributes ?? {});
      return;
    }
    at += units(child);
  }
  const [made] = insertAt(el, children.length, new Y.XmlText());
  made.insert(0, text, attributes ?? {});
}

// Takes out what's between `from` and `to` in a textblock: text, and inline elements whole.
export function deleteText(el, from, to) {
  if (to <= from) return;
  let at = 0;
  const gone = [];
  el.toArray().forEach((child, i) => {
    const len = units(child);
    const a = Math.max(from, at);
    const b = Math.min(to, at + len);
    if (b > a) {
      if (child instanceof Y.XmlText) child.delete(a - at, b - a);
      else gone.push(i);
    }
    at += len;
  });
  for (const i of gone.reverse()) el.delete(i, 1);
  joinTexts(el);
}

// Runs of text with nothing left between them are one run again, as y-prosemirror keeps them.
function joinTexts(el) {
  const children = el.toArray();
  for (let i = children.length - 1; i > 0; i--) {
    if (children[i - 1] instanceof Y.XmlText && children[i] instanceof Y.XmlText) {
      appendDelta(children[i - 1], children[i].toDelta());
      el.delete(i, 1);
    }
  }
}

// Gives the text between `from` and `to` the formatting in `attributes` (null removes a mark).
export function formatText(el, from, to, attributes) {
  let at = 0;
  for (const child of el.toArray()) {
    const len = units(child);
    const a = Math.max(from, at);
    const b = Math.min(to, at + len);
    if (b > a && child instanceof Y.XmlText) child.format(a - at, b - a, attributes);
    at += len;
  }
}

// Whether any text between `from` and `to` has the mark `name`.
export function hasMark(el, from, to, name) {
  let at = 0;
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      let pos = at;
      for (const op of child.toDelta()) {
        if (typeof op.insert !== 'string') continue;
        if (pos < to && pos + op.insert.length > from && op.attributes?.[name] !== undefined) return true;
        pos += op.insert.length;
      }
    }
    at += units(child);
  }
  return false;
}

// Puts an inline element, such as a formula, in place of what's between `from` and `to`.
export function replaceWithInline(el, from, to, inline) {
  deleteText(el, from, to);
  let at = 0;
  const children = el.toArray();
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (at === from) return void el.insert(i, [inline]);
    if (child instanceof Y.XmlText && from < at + child.length) {
      // Split the run of text around it.
      const tail = sliceDelta(child.toDelta(), from - at, child.length);
      child.delete(from - at, child.length - (from - at));
      const [, rest] = insertAt(el, i + 1, inline, new Y.XmlText());
      appendDelta(rest, tail);
      return;
    }
    at += units(child);
  }
  el.insert(children.length, [inline]);
}

// A textblock of another type with the same contents, in its place. Returns it.
export function retype(el, name, attrs = {}) {
  const parent = el.parent;
  const i = indexIn(el);
  const [next] = insertAt(parent, i, element(name, attrs));
  next.insert(0, el.toArray().map((child) => child.clone()));
  parent.delete(i + 1, 1);
  return next;
}

// Splits a textblock at `offset`: what follows goes into a new block after it, of type `name`.
// Returns the new block.
export function splitText(el, offset, name = 'paragraph', attrs = {}) {
  const [next] = insertAt(el.parent, indexIn(el) + 1, element(name, attrs));
  copyInline(el, offset, Infinity, next);
  deleteText(el, offset, textLength(el));
  return next;
}

// Adds textblock `el`'s contents to the end of textblock `into` and takes `el` out. Returns where
// they meet in `into`.
export function joinText(into, el) {
  const at = textLength(into);
  copyInline(el, 0, Infinity, into);
  el.parent.delete(indexIn(el), 1);
  joinTexts(into);
  return at;
}

// A new empty paragraph in `parent` at `index`.
export const newParagraph = (parent, index) => insertAt(parent, index, element('paragraph'))[0];

// Blocks at the end of a journal, such as images, in place of an empty last line.
export function appendBlocks(fragment, nodes) {
  const last = fragment.toArray().at(-1);
  if (isEmptyParagraph(last)) fragment.delete(fragment.length - 1, 1);
  fragment.insert(fragment.length, nodes);
}

// Lines of plain text at the end of a journal, a paragraph each, the first in place of an empty
// last line.
export function appendLines(fragment, lines) {
  const last = fragment.toArray().at(-1);
  lines.forEach((line, i) => {
    const p = i === 0 && isEmptyParagraph(last) ? last : newParagraph(fragment, fragment.length);
    if (line) insertText(p, 0, line, {});
  });
}

// The last textblock inside `node` (itself if it's one), or null.
export function lastTextblock(node) {
  if (isTextblock(node)) return node;
  if (!(node instanceof Y.XmlElement)) return null;
  const children = node.toArray();
  for (let i = children.length - 1; i >= 0; i--) {
    const found = lastTextblock(children[i]);
    if (found) return found;
  }
  return null;
}

// The first textblock inside `node` (itself if it's one), or null.
export function firstTextblock(node) {
  if (isTextblock(node)) return node;
  if (!(node instanceof Y.XmlElement)) return null;
  for (const child of node.toArray()) {
    const found = firstTextblock(child);
    if (found) return found;
  }
  return null;
}

// A day's document ends with a paragraph, as TipTap's trailing node keeps it, and is never empty.
// The browser adds one on opening a day that doesn't, which would be a change of its own.
export function keepShape(fragment) {
  const last = fragment.toArray().at(-1);
  if (!isElement(last, 'paragraph')) newParagraph(fragment, fragment.length);
}

// A notes box can't be empty: one left so gets an empty line.
function fillBox(box) {
  if (isBox(box) && box.length === 0) newParagraph(box, 0);
}

// Takes a block out of its place, along with the containers it leaves empty: a list item's list,
// a quote. A box it was the only thing in keeps an empty line.
export function removeNode(node) {
  let target = node;
  // A textblock that starts a list item stands for the item.
  if (isElement(target.parent, 'listItem') && indexIn(target) === 0) target = target.parent;
  for (;;) {
    const parent = target.parent;
    parent.delete(indexIn(target), 1);
    if (parent.length > 0 || !isElement(parent, 'listItem', 'blockquote', ...LISTS)) {
      fillBox(parent);
      return;
    }
    target = parent;
  }
}

// What Alt+↑ and Alt+↓ move for a block: a list item, within its list; anything in a quote, the
// quote; else the block itself.
export function movable(node) {
  if (isElement(node.parent, 'listItem')) return node.parent;
  let unit = node;
  while (isElement(unit.parent, 'blockquote', ...LISTS, 'listItem')) unit = unit.parent;
  return unit;
}

// Moves a block one step up (-1) or down (1): past the block next to it, into a notes box next to
// it (at its near end), or out of the box it's in at either end. A box moves past its neighbors,
// never into another. Yjs can't move a node, so it's a copy in the new place and the old one goes;
// returns the copy, or null when it can't go further.
export function moveNode(node, dir) {
  const parent = node.parent;
  const i = indexIn(node);
  const neighbor = parent.toArray()[i + dir];
  const copy = node.clone();
  if (isElement(node, 'listItem')) {
    if (!neighbor) return null;
    parent.delete(i, 1);
    parent.insert(i + dir, [copy]);
    return copy;
  }
  if (neighbor && isBox(neighbor) && !isBox(node)) {
    parent.delete(i, 1);
    neighbor.insert(dir < 0 ? neighbor.length : 0, [copy]);
    return copy;
  }
  if (neighbor) {
    parent.delete(i, 1);
    parent.insert(i + dir, [copy]);
    return copy;
  }
  if (!isBox(parent)) return null;
  const outer = parent.parent;
  const at = indexIn(parent);
  parent.delete(i, 1);
  fillBox(parent);
  outer.insert(dir < 0 ? at : at + 1, [copy]);
  return copy;
}

// A notes box in place of top-level paragraph `el`, holding what follows `offset` in it. Returns
// the box's paragraph.
export function boxFrom(el, offset, { id, label }) {
  const parent = el.parent;
  const i = indexIn(el);
  const [box] = insertAt(parent, i, element(NOTE_BOX, { id, label }));
  const p = newParagraph(box, 0);
  copyInline(el, offset, Infinity, p);
  parent.delete(i + 1, 1);
  return p;
}

// A new box under `label` after `node` (at the journal's end with null), in place of an empty last
// line. Returns its paragraph.
export function insertBox(fragment, node, { id, label }) {
  let at = node ? indexIn(node) + 1 : fragment.length;
  const last = fragment.toArray().at(-1);
  if (!node && isEmptyParagraph(last)) {
    at = fragment.length - 1;
    fragment.delete(at, 1);
  }
  const [box] = insertAt(fragment, at, element(NOTE_BOX, { id, label }));
  return newParagraph(box, 0);
}

// Takes a box away and leaves its blocks where it was. Returns the first of them.
export function unwrapBox(box) {
  const parent = box.parent;
  const i = indexIn(box);
  const blocks = box.toArray().map((child) => child.clone());
  parent.insert(i, blocks);
  parent.delete(i + blocks.length, 1);
  return blocks[0] ?? null;
}

// Puts textblock `el` in a list (`name`, with `attrs`), or at the end of the same kind of list
// just before it when `join(list)` says so. Returns the paragraph, now in its list item.
export function wrapInList(el, name, attrs, join = () => true) {
  const parent = el.parent;
  const i = indexIn(el);
  const before = parent.toArray()[i - 1];
  const joining = isElement(before, name) && join(before);
  const list = joining ? before : insertAt(parent, i, element(name, attrs))[0];
  const [item] = insertAt(list, list.length, element('listItem'));
  const [p] = insertAt(item, 0, element('paragraph'));
  p.insert(0, el.toArray().map((child) => child.clone()));
  parent.delete(indexIn(el), 1);
  return p;
}

// Puts textblock `el` in a quote, or at the end of a quote just before it. Returns it there.
export function wrapInQuote(el) {
  const parent = el.parent;
  const i = indexIn(el);
  const before = parent.toArray()[i - 1];
  const quote = isElement(before, 'blockquote') ? before : insertAt(parent, i, element('blockquote'))[0];
  const [p] = insertAt(quote, quote.length, element(el.nodeName, el.getAttributes()));
  p.insert(0, el.toArray().map((child) => child.clone()));
  parent.delete(indexIn(el), 1);
  return p;
}

// Takes list item `item` out of its list: its blocks go after the list (the items after it into a
// list of their own after them), as Enter on an empty item or Backspace at its start do. Returns
// the first of its blocks there.
export function liftItem(item) {
  const list = item.parent;
  const outer = list.parent;
  const i = indexIn(item);
  const at = indexIn(list) + 1;
  const blocks = item.toArray().map((child) => child.clone());
  const rest = list.toArray().slice(i + 1);
  outer.insert(at, blocks);
  if (rest.length) {
    const attrs = list.getAttributes();
    if (list.nodeName === 'orderedList') attrs.start = (Number(attrs.start) || 1) + i + 1;
    const [tail] = insertAt(outer, at + blocks.length, element(list.nodeName, attrs));
    tail.insert(0, rest.map((r) => r.clone()));
  }
  list.delete(i, list.length - i);
  if (list.length === 0) outer.delete(indexIn(list), 1);
  return blocks[0] ?? null;
}

// Takes block `el` out of the quote it's first or last in, to just before or after the quote.
// Returns it there.
export function liftFromQuote(el) {
  const quote = el.parent;
  const outer = quote.parent;
  const first = indexIn(el) === 0;
  const copy = el.clone();
  outer.insert(first ? indexIn(quote) : indexIn(quote) + 1, [copy]);
  quote.delete(indexIn(el), 1);
  if (quote.length === 0) outer.delete(indexIn(quote), 1);
  return copy;
}

// Puts block `node` in place of textblock `el`, with an empty paragraph after it when `paragraph`.
// Returns [node, paragraph].
export function replaceBlock(el, node, { paragraph = false } = {}) {
  const parent = el.parent;
  const i = indexIn(el);
  const made = paragraph ? insertAt(parent, i, node, element('paragraph')) : insertAt(parent, i, node);
  parent.delete(i + made.length, 1);
  return made;
}
