import * as Y from 'yjs';
import { BODY_FIELD, NOTE_BOX } from '@almanac/shared';

// A day's journal, read from the same Yjs document TipTap edits in the browser, as the blocks
// the terminal draws, in order. Each is one of:
//   { kind: 'text', style: 'paragraph' | 'heading' | 'code', level, inline, marker, indent, quote }
//   { kind: 'task', id }
//   { kind: 'image', file, alt, width, height }
//   { kind: 'math', latex }
//   { kind: 'rule' }
//   { kind: 'box', id, label, blocks }: a notes box, holding blocks of its own
// `inline` is a list of { text, marks } and { math } (a formula in the line); `marker` is a
// list item's "•" or "3.", `indent` how far its list is nested, and `quote` how many quotes it's in.
// A block of a kind this version doesn't know shows as its text.
export function readJournal(doc) {
  return readBlocks(doc.getXmlFragment(BODY_FIELD).toArray(), {});
}

// Marks TipTap's StarterKit stores as formatting attributes on the text.
const MARKS = ['bold', 'italic', 'strike', 'underline', 'code', 'link'];

function inlineOf(element) {
  const out = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta()) {
        if (typeof op.insert !== 'string') continue;
        const marks = {};
        for (const mark of MARKS) if (op.attributes?.[mark] !== undefined) marks[mark] = op.attributes[mark] ?? true;
        out.push({ text: op.insert, marks });
      }
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === 'inlineMath') out.push({ math: child.getAttribute('latex') ?? '' });
      else if (child.nodeName === 'hardBreak') out.push({ text: '\n', marks: {} });
      // An old [[link]] to a page shows its title.
      else if (child.nodeName === 'itemRef') out.push({ text: child.getAttribute('label') || 'Untitled', marks: {} });
      else out.push({ text: plainText(child), marks: {} });
    }
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
    const text = (style, extra = {}) => ({
      kind: 'text',
      style,
      inline: inlineOf(node),
      marker: at.marker,
      indent: at.indent ?? 0,
      quote: at.quote ?? 0,
      ...extra,
    });
    if (name === 'paragraph') blocks.push(text('paragraph'));
    else if (name === 'heading') blocks.push(text('heading', { level: Number(node.getAttribute('level')) || 1 }));
    else if (name === 'codeBlock') blocks.push(text('code', { inline: [{ text: plainText(node), marks: {} }] }));
    else if (name === 'taskRef') blocks.push({ kind: 'task', id: node.getAttribute('id') ?? null });
    else if (name === 'blockMath') blocks.push({ kind: 'math', latex: node.getAttribute('latex') ?? '' });
    else if (name === 'horizontalRule') blocks.push({ kind: 'rule' });
    else if (name === 'image') {
      blocks.push({
        kind: 'image',
        file: node.getAttribute('file') ?? null,
        alt: node.getAttribute('alt') ?? '',
        width: node.getAttribute('width') ?? null,
        height: node.getAttribute('height') ?? null,
      });
    } else if (name === NOTE_BOX) {
      blocks.push({ kind: 'box', id: node.getAttribute('id') ?? null, label: node.getAttribute('label') ?? null, blocks: readBlocks(node.toArray(), {}) });
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
      blocks.push(text('paragraph', { inline: [{ text: plainText(node), marks: {} }] }));
    }
  }
  return blocks;
}

// A journal day's document, from the copy's stored state; null if nothing's written there.
export function journalDoc(state) {
  if (!state) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}
