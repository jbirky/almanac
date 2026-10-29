import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import { Document } from '@tiptap/extension-document';
import { Placeholder } from '@tiptap/extensions';
import { BODY_FIELD, NOTE_BOX, newId } from '@almanac/shared';
import { action } from '../../lib/db.js';
import { LegacyItemRef } from './LegacyItemRef.js';
import { ImageBlock } from './Image.jsx';
import { BlockEquation, InlineEquation } from './Math.jsx';
import { TaskBlock } from './TaskBlock.jsx';

// Boxes added in this tab whose editor takes focus as soon as it shows.
const focusOnShow = new Set();

// The editor's whole document is one box: it has the box's name and attributes, so the Yjs
// binding can edit the box's element in the day's document directly and leaves its id and
// label as they are.
const BoxDocument = Document.extend({
  name: NOTE_BOX,
  content: 'block+',
  addAttributes() {
    return { id: { default: null }, label: { default: null } };
  },
});

// Backspace in an empty box takes the box out of its day, as it does in the day's journal.
const RemoveWhenEmpty = Extension.create({
  name: 'removeWhenEmpty',
  // Runs before the editor's own Backspace.
  priority: 200,
  addOptions() {
    return { onRemove: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { doc, selection } = editor.state;
        const only = doc.childCount === 1 ? doc.firstChild : null;
        if (!selection.empty || only?.type.name !== 'paragraph' || only.content.size) return false;
        this.options.onRemove();
        return true;
      },
    };
  },
});

const isBox = (node, labelId) =>
  node instanceof Y.XmlElement && node.nodeName === NOTE_BOX && node.getAttribute('label') === labelId;

const isEmptyParagraph = (node) =>
  node instanceof Y.XmlElement && node.nodeName === 'paragraph' && node.toArray().every((t) => t instanceof Y.XmlText && !t.length);

// The elements of a journal's notes boxes that `match`, in order, kept up to date. `key` stands
// for what `match` depends on.
function useMatchingBoxes(doc, match, key) {
  const [boxes, setBoxes] = useState([]);
  useEffect(() => {
    if (!doc) return;
    const fragment = doc.getXmlFragment(BODY_FIELD);
    const read = () => {
      const next = fragment.toArray().filter(match);
      setBoxes((prev) => (prev.length === next.length && prev.every((b, i) => b === next[i]) ? prev : next));
    };
    read();
    doc.on('update', read);
    return () => doc.off('update', read);
    // `key` covers `match`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, key]);
  return boxes;
}

// A journal's notes boxes under a label.
export function useBoxes(doc, labelId) {
  return useMatchingBoxes(doc, (node) => isBox(node, labelId), labelId);
}

// A journal's notes boxes with the given ids, such as the ones it pins to later days.
export function useBoxesById(doc, ids) {
  return useMatchingBoxes(
    doc,
    (node) => node instanceof Y.XmlElement && node.nodeName === NOTE_BOX && ids.includes(node.getAttribute('id')),
    ids.join(' '),
  );
}

// Adds an empty box under a label at the end of a journal, in place of an empty last line,
// and focuses it once it shows.
export function addBox(doc, labelId) {
  const fragment = doc.getXmlFragment(BODY_FIELD);
  const box = new Y.XmlElement(NOTE_BOX);
  box.setAttribute('id', newId());
  box.setAttribute('label', labelId);
  box.insert(0, [new Y.XmlElement('paragraph')]);
  focusOnShow.add(box);
  const at = isEmptyParagraph(fragment.toArray().at(-1)) ? fragment.length - 1 : fragment.length;
  fragment.insert(at, [box]);
}

// Takes a box out of its journal, notes and all.
export function removeBox(doc, box) {
  const fragment = doc.getXmlFragment(BODY_FIELD);
  const index = fragment.toArray().indexOf(box);
  if (index >= 0) fragment.delete(index, 1);
}

// Edits one notes box on its own, outside its day's journal. Task blocks typed here belong to
// the day's note and start with no due date.
export function BoxEditor({ box, noteId, ensure, day, label, onRemove }) {
  const editor = useEditor(
    {
      extensions: [
        // Collaboration brings its own undo. A box's last block can be a task, as in the journal.
        StarterKit.configure({ undoRedo: false, document: false, trailingNode: false }),
        BoxDocument,
        Collaboration.configure({ fragment: box }),
        Placeholder.configure({ placeholder: 'Notes' }),
        TaskBlock.configure({
          day,
          onCreate: (id, title, label) => {
            ensure?.();
            action.createTaskInNote(noteId, title, id, {}, label);
          },
        }),
        LegacyItemRef,
        InlineEquation,
        BlockEquation,
        ImageBlock,
        RemoveWhenEmpty.configure({ onRemove }),
      ],
      // The binding fills in the blocks; the attributes have to match the box's from the start.
      content: { type: NOTE_BOX, attrs: box.getAttributes(), content: [{ type: 'paragraph' }] },
      editorProps: { attributes: { class: 'prose', 'aria-label': label } },
    },
    [box],
  );

  useEffect(() => {
    if (editor && focusOnShow.delete(box)) editor.commands.focus('end');
  }, [editor, box]);

  return <EditorContent editor={editor} className="box-editor" />;
}
