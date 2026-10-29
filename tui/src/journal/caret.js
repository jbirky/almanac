import * as Y from 'yjs';
import { isTextblock, textLength } from './doc.js';

// The cursor while writing is kept as a Yjs relative position: it names the character beside
// it rather than a count of characters, so it stays where it was as edits from other devices
// arrive around it.

const units = (child) => (child instanceof Y.XmlText ? child.length : 1);

// A relative position for place `offset` in textblock `el`. It sticks to the character before
// it, so text another device adds right at the cursor goes after it.
export function caretToRel({ el, offset }) {
  let at = 0;
  const children = el.toArray();
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child instanceof Y.XmlText && offset <= at + child.length) {
      const index = offset - at;
      return Y.createRelativePositionFromTypeIndex(child, index, index === 0 ? 0 : -1);
    }
    if (offset <= at) return Y.createRelativePositionFromTypeIndex(el, i, 0);
    at += units(child);
  }
  return Y.createRelativePositionFromTypeIndex(el, children.length, -1);
}

const gone = (type) => {
  for (let t = type; t?._item; t = t.parent) if (t._item.deleted) return true;
  return false;
};

// The place a relative position stands for now, as { el, offset }, or null if what it was in
// has been taken out.
export function caretFromRel(doc, rel) {
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
  if (!abs || gone(abs.type)) return null;
  const { type, index } = abs;
  let el;
  let offset;
  if (type instanceof Y.XmlText) {
    el = type.parent;
    if (!isTextblock(el)) return null;
    const children = el.toArray();
    const i = children.indexOf(type);
    if (i < 0) return null;
    offset = children.slice(0, i).reduce((n, c) => n + units(c), 0) + index;
  } else if (isTextblock(type)) {
    el = type;
    offset = el
      .toArray()
      .slice(0, index)
      .reduce((n, c) => n + units(c), 0);
  } else {
    return null;
  }
  return { el, offset: Math.min(offset, textLength(el)) };
}
