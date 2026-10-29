import * as Y from 'yjs';
import { graphemes } from '../text.js';
import {
  boxFrom,
  deleteText,
  element,
  firstTextblock,
  formatText,
  hasMark,
  indexIn,
  insertText,
  isBox,
  isElement,
  isTextblock,
  joinText,
  lastTextblock,
  liftFromQuote,
  liftItem,
  LISTS,
  marksAt,
  movable,
  moveNode,
  newParagraph,
  plainText,
  removeNode,
  replaceBlock,
  replaceWithInline,
  retype,
  splitText,
  textBefore,
  textLength,
  wrapInList,
  wrapInQuote,
} from './doc.js';

// What keys do to a day's document while writing. Each function takes the cursor, a place in a
// textblock ({ el, offset, marks }: `marks` is the formatting the next character typed gets, when
// it isn't the one before's), changes the document, and says where writing goes on:
//   { caret }               the cursor's new place
//   { task, at }            in a task block's title, at its 'start' or 'end'
//   { block }               stop writing, with the cursor on this block (an image, an equation)
// or null when the key does nothing there. They run inside the session's transaction.
//
// `ctx` gives what a few of them need from outside the document: newId(), resolveLabel(name) for
// "#label ", and createTask(id, title, labelId) for "[] ". With `boxOnly`, writing is in a box
// shown away from its day (pinned, or by label), and stays in it, as in the web's box editor.

const caretAt = (el, offset, marks) => ({ caret: { el, offset, ...(marks ? { marks } : {}) } });
const isTop = (el) => !(el.parent instanceof Y.XmlElement);

// Where a textblock is: at the top of the journal, in a notes box, in a quote, as a list item's
// first block, or further inside one.
function placeOf(el) {
  const parent = el.parent;
  if (isTop(el)) return 'top';
  if (isBox(parent)) return 'box';
  if (isElement(parent, 'blockquote')) return 'quote';
  if (isElement(parent, 'listItem')) return indexIn(el) === 0 ? 'itemStart' : 'item';
  return 'other';
}

// The label of the notes box a block is in, or null.
export function boxLabelOf(node) {
  for (let at = node; at; at = at.parent) if (isBox(at)) return at.getAttribute('label') ?? null;
  return null;
}

// The places a cursor can be in a textblock, in order: either side of each character (graphemes,
// so an accented letter or an emoji is one) and of each inline element, each { from, to, text }
// (an element's text is U+FFFC).
export function unitsOf(el) {
  const out = [];
  let at = 0;
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta()) {
        if (typeof op.insert !== 'string') continue;
        for (const g of graphemes(op.insert)) {
          out.push({ from: at, to: at + g.length, text: g });
          at += g.length;
        }
      }
    } else {
      out.push({ from: at, to: at + 1, text: '￼', node: child });
      at += 1;
    }
  }
  return out;
}

export const stepBack = (el, offset) => unitsOf(el).findLast((u) => u.to <= offset)?.from ?? 0;
export function stepAhead(el, offset) {
  const unit = unitsOf(el).find((u) => u.from >= offset);
  return unit ? unit.to : textLength(el);
}

const isWordChar = (c) => /[\p{L}\p{N}_]/u.test(c);

// A word back or ahead, as readline's Alt+B and Alt+F go.
export function wordBack(el, offset) {
  const units = unitsOf(el).filter((u) => u.to <= offset);
  let i = units.length;
  while (i > 0 && !isWordChar(units[i - 1].text)) i--;
  while (i > 0 && isWordChar(units[i - 1].text)) i--;
  return units[i]?.from ?? offset;
}

export function wordAhead(el, offset) {
  const units = unitsOf(el).filter((u) => u.from >= offset);
  let i = 0;
  while (i < units.length && !isWordChar(units[i].text)) i++;
  while (i < units.length && isWordChar(units[i].text)) i++;
  return i === 0 ? offset : units[i - 1].to;
}

// TipTap's markInputRule: "**bold**" and the like. The delimiters go, the text between them gets
// the mark, and what's typed next doesn't.
function markRule(find, mark) {
  return {
    find,
    apply(ctx, { el, offset, match, from }) {
      const capture = match[match.length - 1];
      const full = match[0];
      if (!capture) return null;
      const to = offset;
      const startSpaces = full.search(/\S/);
      const textStart = from + full.indexOf(capture);
      const textEnd = textStart + capture.length;
      // Code excludes every other mark.
      if (mark !== 'code' && hasMark(el, textStart, to, 'code')) return null;
      if (textEnd < to) deleteText(el, textEnd, to);
      if (textStart > from) deleteText(el, from + startSpaces, textStart);
      const markEnd = from + startSpaces + capture.length;
      formatText(el, from + startSpaces, markEnd, { [mark]: {} });
      const { [mark]: _, ...rest } = marksAt(el, markEnd);
      return caretAt(el, markEnd, rest);
    },
  };
}

// The web editor's input rules, in the order it tries them: its own (notes boxes, task blocks and
// equations, in client/src/components/editor) and StarterKit's. Each applies when what's before
// the cursor, with the character just typed, matches `find`; `from` is where the match starts.
const RULES = [
  {
    // "#meeting " at the start of a top-level paragraph: a notes box labeled meeting, holding the
    // rest of the line.
    find: /^#(\p{L}[\p{L}\p{N}_-]*)\s$/u,
    apply(ctx, { el, offset, match, from }) {
      if (from !== 0 || !isElement(el, 'paragraph') || !isTop(el)) return null;
      const label = ctx.resolveLabel(match[1].replace(/[-_]+/g, ' '));
      return caretAt(boxFrom(el, offset, { id: ctx.newId(), label }), 0);
    },
  },
  {
    // "[] " at the start of a top-level paragraph or one in a box: a task, titled with the rest of
    // the line, filed under the box's label.
    find: /^\s*\[\s?\]\s$/,
    apply(ctx, { el, offset, from }) {
      const place = placeOf(el);
      if (from !== 0 || !isElement(el, 'paragraph') || (place !== 'top' && place !== 'box')) return null;
      const title = plainText(el).slice(offset).trim();
      const id = ctx.newId();
      ctx.createTask(id, title, boxLabelOf(el));
      const [task] = replaceBlock(el, element('taskRef', { id }));
      return { task, at: 'end' };
    },
  },
  {
    // "# " to "###### ": a heading.
    find: /^(#{1,6})\s$/,
    apply(ctx, { el, offset, match, from }) {
      if (from !== 0 || !isElement(el, 'paragraph', 'heading') || placeOf(el) === 'itemStart') return null;
      deleteText(el, 0, offset);
      return caretAt(retype(el, 'heading', { level: match[1].length }), 0);
    },
  },
  {
    find: /^\s*>\s$/,
    apply(ctx, { el, offset, from }) {
      if (from !== 0 || placeOf(el) === 'itemStart' || placeOf(el) === 'item') return null;
      deleteText(el, 0, offset);
      return caretAt(wrapInQuote(el), 0);
    },
  },
  {
    find: /^\s*([-+*])\s$/,
    apply(ctx, { el, offset, from }) {
      if (from !== 0 || !isElement(el, 'paragraph') || placeOf(el) === 'itemStart' || placeOf(el) === 'item') return null;
      deleteText(el, 0, offset);
      return caretAt(wrapInList(el, 'bulletList', {}), 0);
    },
  },
  {
    find: /^(\d+)\.\s$/,
    apply(ctx, { el, offset, match, from }) {
      if (from !== 0 || !isElement(el, 'paragraph') || placeOf(el) === 'itemStart' || placeOf(el) === 'item') return null;
      const start = Number(match[1]);
      deleteText(el, 0, offset);
      // A number that carries on the list just before joins it.
      const carriesOn = (list) => list.length + (Number(list.getAttribute('start')) || 1) === start;
      return caretAt(wrapInList(el, 'orderedList', { start }, carriesOn), 0);
    },
  },
  {
    // A line that is nothing but $$...$$: an equation on its own line, with a new line after it.
    find: /^\$\$([^$]+)\$\$$/,
    apply(ctx, { el, offset, match, from }) {
      if (from !== 0 || offset !== textLength(el) || placeOf(el) === 'itemStart') return null;
      const [, p] = replaceBlock(el, element('blockMath', { latex: match[1].trim() }), { paragraph: true });
      return caretAt(p, 0);
    },
  },
  {
    // A closing $ after "$...": a formula in the line. Not after "$$" or "\$", and nothing that
    // starts or ends with a space, so prices such as "$5 and $10" stay text.
    find: /(?<![\\$])\$([^\s$](?:[^$]*[^\s$\\])?)\$$/,
    apply(ctx, { el, offset, match, from }) {
      if (match[1].includes('￼')) return null;
      replaceWithInline(el, from, offset, element('inlineMath', { latex: match[1] }));
      return caretAt(el, from + 1);
    },
  },
  markRule(/(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/, 'bold'),
  markRule(/(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/, 'bold'),
  markRule(/(^|[^`])`([^`]+)`(?!`)$/, 'code'),
  markRule(/(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/, 'italic'),
  markRule(/(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/, 'italic'),
  markRule(/(?:^|\s)(~~(?!\s+~~)((?:[^~]+))~~(?!\s+~~))$/, 'strike'),
];

// One character typed, running the input rules, which don't apply in code.
export function typeChar(ctx, caret, ch) {
  const { el, offset } = caret;
  const inCode = el.nodeName === 'codeBlock' || marksAt(el, offset).code !== undefined;
  if (!inCode) {
    const before = textBefore(el, offset).slice(-500) + ch;
    for (const rule of RULES) {
      const match = rule.find.exec(before);
      if (!match) continue;
      const done = rule.apply(ctx, { el, offset, match, from: offset - (match[0].length - ch.length) });
      if (done) return done;
    }
  }
  insertText(el, offset, ch, caret.marks);
  return caretAt(el, offset + ch.length);
}

// Typed text, a character at a time. When a rule takes writing elsewhere (into a task's title),
// `rest` is what's left to type there.
export function type(ctx, caret, text) {
  const chars = graphemes(text);
  let result = { caret };
  for (let i = 0; i < chars.length; i++) {
    result = typeChar(ctx, result.caret, chars[i]);
    if (!result.caret) return { ...result, rest: chars.slice(i + 1).join('') };
  }
  return result;
}

// Pasted text: as it is, without input rules, each line after the first a block of its own (a
// line in a code block).
export function paste(ctx, caret, text) {
  let { el, offset } = caret;
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      if (i > 0) {
        if (el.nodeName === 'codeBlock') {
          insertText(el, offset, '\n');
          offset += 1;
        } else {
          el = placeOf(el) === 'itemStart' ? splitListItem(el, offset) : splitText(el, offset, 'paragraph');
          offset = 0;
        }
      }
      if (line) {
        insertText(el, offset, line.replace(/\t/g, '  '), i === 0 ? caret.marks : undefined);
        offset += line.length;
      }
    });
  return caretAt(el, offset);
}

// A list item split at `offset` in its first block: what follows goes into a new item after it.
function splitListItem(el, offset) {
  const item = el.parent;
  const next = element('listItem');
  item.parent.insert(indexIn(item) + 1, [next]);
  const p = newParagraph(next, 0);
  // splitText puts the tail in a new block after `el` in the item; move it to the new item.
  const tail = splitText(el, offset, 'paragraph');
  p.insert(0, tail.toArray().map((child) => child.clone()));
  item.delete(indexIn(tail), 1);
  return p;
}

const isEmpty = (el) => textLength(el) === 0;
const isLastIn = (el) => indexIn(el) === el.parent.length - 1;

// Enter: a new paragraph (or list item) from the cursor on. On an empty line it leaves what it's
// in: a box's last line, a list item, a quote's last line. In a code block it's a new line, and a
// third at the end leaves the block.
export function enter(ctx, caret) {
  const { el, offset } = caret;
  const len = textLength(el);
  const place = placeOf(el);
  if (el.nodeName === 'codeBlock') {
    if (offset === len && plainText(el).endsWith('\n\n')) {
      deleteText(el, len - 2, len);
      return caretAt(newParagraph(el.parent, indexIn(el) + 1), 0);
    }
    insertText(el, offset, '\n');
    return caretAt(el, offset + 1);
  }
  if (len === 0) {
    if (place === 'box' && el.parent.length > 1 && isLastIn(el) && !ctx.boxOnly) return caretAt(leaveBox(el), 0);
    if (place === 'itemStart') return caretAt(firstTextblock(liftItem(el.parent)), 0);
    if (place === 'quote' && el.parent.length > 1 && isLastIn(el)) return caretAt(liftFromQuote(el), 0);
  }
  if (place === 'itemStart') return caretAt(splitListItem(el, offset), 0);
  // At the end of a heading, a paragraph follows; anywhere else, a block of the same kind.
  const name = el.nodeName === 'heading' && offset === len ? 'paragraph' : el.nodeName;
  return caretAt(splitText(el, offset, name, name === el.nodeName ? el.getAttributes() : {}), 0);
}

// Out of a box from its empty last line, onto an empty line after the box.
function leaveBox(el) {
  const box = el.parent;
  box.delete(indexIn(el), 1);
  const outer = box.parent;
  const at = indexIn(box) + 1;
  const next = outer.toArray()[at];
  return isElement(next, 'paragraph') && isEmpty(next) ? next : newParagraph(outer, at);
}

// Whether a paragraph can go without breaking the rule that the journal ends with one.
const canDrop = (el) => !(isTop(el) && isLastIn(el));

// Backspace: the character or formula before the cursor. A formula turns back into the text it
// was typed as, less its closing $, to be edited. At a block's start: a heading becomes a
// paragraph, a list item or a quote's first line leaves its list or quote, an empty box goes,
// and anything else joins the block before it.
export function backspace(ctx, caret) {
  const { el, offset } = caret;
  if (offset > 0) {
    const unit = unitsOf(el).findLast((u) => u.to <= offset);
    if (isElement(unit.node, 'inlineMath')) {
      const source = `$${unit.node.getAttribute('latex') ?? ''}`;
      deleteText(el, unit.from, unit.to);
      insertText(el, unit.from, source, {});
      return caretAt(el, unit.from + source.length);
    }
    deleteText(el, unit.from, unit.to);
    return caretAt(el, unit.from);
  }
  const place = placeOf(el);
  if (el.nodeName === 'heading' || el.nodeName === 'codeBlock') return caretAt(retype(el, 'paragraph'), 0);
  if (place === 'itemStart') return caretAt(firstTextblock(liftItem(el.parent)), 0);
  if (place === 'quote' && indexIn(el) === 0) return caretAt(liftFromQuote(el), 0);
  const prev = el.parent.toArray()[indexIn(el) - 1];
  if (!prev) {
    const box = el.parent;
    if (place !== 'box' || box.length > 1 || !isEmpty(el)) return null;
    // An empty box goes, leaving an empty line, unless one follows it.
    const next = box.parent.toArray()[indexIn(box) + 1];
    if (isElement(next, 'paragraph') && isEmpty(next)) {
      box.parent.delete(indexIn(box), 1);
      return caretAt(next, 0);
    }
    const [p] = replaceBlock(box, element('paragraph'));
    return caretAt(p, 0);
  }
  if (isTextblock(prev) || isElement(prev, 'blockquote', ...LISTS)) {
    const into = lastTextblock(prev);
    if (into) return caretAt(into, joinText(into, el));
  }
  // Into the box before, to the end of its last line; an empty line goes on the way.
  if (isBox(prev)) {
    const into = lastTextblock(prev);
    if (isEmpty(el) && canDrop(el)) removeNode(el);
    return into ? caretAt(into, textLength(into)) : null;
  }
  if (isEmpty(el) && canDrop(el)) removeNode(el);
  if (isElement(prev, 'taskRef')) return { task: prev, at: 'end' };
  return { block: prev };
}

// Delete: the character or formula after the cursor; at a block's end, the next textblock joins it.
export function deleteAhead(ctx, caret) {
  const { el, offset } = caret;
  const len = textLength(el);
  if (offset < len) {
    deleteText(el, offset, stepAhead(el, offset));
    return caretAt(el, offset);
  }
  const next = el.parent.toArray()[indexIn(el) + 1];
  if (!isTextblock(next)) return null;
  joinText(el, next);
  return caretAt(el, offset);
}

// Ctrl+W, Alt+Backspace: the word before the cursor. Ctrl+U: everything before it in the block.
export function deleteBack(ctx, caret, to) {
  const { el, offset } = caret;
  if (to >= offset) return null;
  deleteText(el, to, offset);
  return caretAt(el, to);
}

// Where moving a block takes the block the cursor was on: the same node, or its copy in the place
// moved to. See moveNode. With `boxOnly`, a block in a box stops at the box's ends.
export function moveBlock(el, dir, { boxOnly = false } = {}) {
  const unit = movable(el);
  if (boxOnly && isBox(unit.parent) && indexIn(unit) === (dir < 0 ? 0 : unit.parent.length - 1)) return null;
  const path = [];
  for (let at = el; at !== unit; at = at.parent) path.unshift(indexIn(at));
  const copy = moveNode(unit, dir);
  if (!copy) return null;
  return path.reduce((node, i) => node.toArray()[i], copy);
}

// A new task block after task block `after`, in the same box and under its label.
export function taskAfter(ctx, after) {
  const id = ctx.newId();
  ctx.createTask(id, '', boxLabelOf(after));
  const task = element('taskRef', { id });
  after.parent.insert(indexIn(after) + 1, [task]);
  return task;
}

// An empty paragraph in place of a block, such as a task whose title was cleared with Enter.
export const paragraphFor = (node) => replaceBlock(node, element('paragraph'))[0];

// A new paragraph next to a block, below it (o) or above it (O); a box's label line counts as its
// first line, so above it is above the box.
export function lineBeside(node, below) {
  if (isBox(node) && below) return newParagraph(node, 0);
  const unit = isElement(node.parent, 'listItem') ? node.parent : node;
  if (isElement(unit, 'listItem')) {
    const item = element('listItem');
    unit.parent.insert(indexIn(unit) + (below ? 1 : 0), [item]);
    return newParagraph(item, 0);
  }
  return newParagraph(unit.parent, indexIn(unit) + (below ? 1 : 0));
}

// Deletes a block, as D does: a list item, a quote's line, a box with its notes.
export const removeBlock = removeNode;
