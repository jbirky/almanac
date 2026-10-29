import * as Y from 'yjs';

// The XML fragment TipTap's Collaboration extension edits.
export const BODY_FIELD = 'default';

// The editor's name for a notes box: a block of the journal with a label on it.
export const NOTE_BOX = 'noteBox';

// Equations keep their LaTeX in an attribute; their text is that source.
const MATH = { inlineMath: '', blockMath: '\n' };

// Plain text of a note body, for full-text search.
export function ydocText(doc) {
  const out = [];
  walk(doc.getXmlFragment(BODY_FIELD), out);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// The notes boxes in a body, in order: each one's label id (or null) and plain text.
export function noteBoxes(doc) {
  return doc
    .getXmlFragment(BODY_FIELD)
    .toArray()
    .filter((node) => node instanceof Y.XmlElement && node.nodeName === NOTE_BOX)
    .map((box) => {
      const out = [];
      walk(box, out);
      return { label: box.getAttribute('label') ?? null, text: out.join('').trim() };
    });
}

// What a body links to, each list sorted: its task blocks ('embed') and the labels on its
// notes boxes ('label'). Both editors keep a note's links to match (syncBodyLinks).
export function linksInDoc(doc) {
  const labels = new Set(noteBoxes(doc).map((box) => box.label).filter(Boolean));
  return { embed: taskIdsInDoc(doc), label: [...labels].sort() };
}

// Ids of the task blocks in a body, sorted.
export function taskIdsInDoc(doc) {
  const ids = new Set();
  const walkIds = (parent) => {
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      const id = child.getAttribute('id');
      if (child.nodeName === 'taskRef' && id) ids.add(id);
      else walkIds(child);
    }
  };
  walkIds(doc.getXmlFragment(BODY_FIELD));
  return [...ids].sort();
}

function walk(node, out) {
  if (node instanceof Y.XmlText) {
    for (const op of node.toDelta()) if (typeof op.insert === 'string') out.push(op.insert);
    return;
  }
  if (node instanceof Y.XmlElement && Object.hasOwn(MATH, node.nodeName)) {
    out.push(node.getAttribute('latex') ?? '', MATH[node.nodeName]);
    return;
  }
  for (const child of node.toArray()) walk(child, out);
  if (node instanceof Y.XmlElement) out.push('\n');
}
