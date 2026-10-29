import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import { Document } from '@tiptap/extension-document';
import { Placeholder } from '@tiptap/extensions';
import { BODY_FIELD, NOTE_BOX, linksInDoc } from '@almanac/shared';
import { action, onChange, query } from '../../lib/db.js';
import { useQuery } from '../../lib/hooks.js';
import { LegacyItemRef } from './LegacyItemRef.js';
import { ImageBlock } from './Image.jsx';
import { BlockEquation, InlineEquation } from './Math.jsx';
import { NoteBox, addNoteBox, resolveLabel } from './NoteBox.jsx';
import { TaskBlock } from './TaskBlock.jsx';

const REMOTE = 'remote';
const FLUSH_MS = 1000;

// Notes boxes go only at the top level of a journal, never inside each other.
const JournalDocument = Document.extend({ content: `(block | ${NOTE_BOX})+` });

// A note body as a live Yjs document, or null while it loads. Local edits are batched for a
// second and saved as one change, along with the links the body implies; changes from other
// devices are pulled in as they arrive. `ensure` runs before the first save (journal days
// create their item only once written in). Several editors can share the document.
export function useBodyDoc(noteId, ensure) {
  const [doc, setDoc] = useState(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    let alive = true;
    let buffer = [];
    let timer = null;
    let links = null;
    let ensured = !ensure;

    const flush = () => {
      clearTimeout(timer);
      timer = null;
      if (!buffer.length) return;
      if (!ensured) {
        ensured = true;
        ensure();
      }
      const update = Y.mergeUpdates(buffer);
      buffer = [];
      action.applyBodyUpdate(noteId, update);
      const now = linksInDoc(ydoc);
      for (const kind of ['embed', 'label']) {
        if (JSON.stringify(now[kind]) !== JSON.stringify(links[kind])) action.syncBodyLinks(noteId, kind, now[kind]);
      }
      links = now;
    };
    const onUpdate = (update, origin) => {
      if (origin === REMOTE) return;
      buffer.push(update);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };
    const pull = () =>
      query.bodyDiff(noteId, Y.encodeStateVector(ydoc)).then((diff) => {
        if (alive && diff) Y.applyUpdate(ydoc, diff, REMOTE);
      });

    query.body(noteId).then((state) => {
      if (!alive) return;
      if (state) Y.applyUpdate(ydoc, state, REMOTE);
      links = linksInDoc(ydoc);
      ydoc.on('update', onUpdate);
      setDoc(ydoc);
    });
    const off = onChange((change) => {
      if (change.tables.includes('bodies') && change.rows.includes(noteId)) pull();
    });
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);

    return () => {
      alive = false;
      off();
      document.removeEventListener('visibilitychange', onHide);
      flush();
      ydoc.off('update', onUpdate);
      setDoc(null);
      // Editors bound to this doc unmount after this cleanup; destroy the doc once they have.
      setTimeout(() => ydoc.destroy(), 0);
    };
    // `ensure` is read once per note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  return doc;
}

// Edits a whole note body, such as a day's journal. Task blocks typed here start with no due
// date; `day` is the date the note is about.
export function NoteEditor({ noteId, ensure, placeholder, day }) {
  const doc = useBodyDoc(noteId, ensure);
  if (!doc) return <div className="note-editor" aria-busy="true" />;
  return <Editor key={doc.guid} doc={doc} noteId={noteId} ensure={ensure} placeholder={placeholder} day={day} />;
}

// The journal editor's extensions, editing Yjs document `doc`: its schema is what a body may
// hold. The terminal's schema tests load what it writes through these. `resolveLabel` turns a
// typed label name into a label id, and `onCreate(id, title, label)` makes a task typed here.
export function journalExtensions({ doc, placeholder, day, resolveLabel: labelFor, onCreate }) {
  return [
    StarterKit.configure({ undoRedo: false, document: false }), // Collaboration brings its own undo
    JournalDocument,
    Collaboration.configure({ document: doc, field: BODY_FIELD }),
    // Marks every empty line, so CSS can also say "Notes" in an empty box.
    Placeholder.configure({ placeholder, includeChildren: true, showOnlyCurrent: false }),
    NoteBox.configure({ resolveLabel: labelFor, day }),
    TaskBlock.configure({ day, onCreate }),
    LegacyItemRef,
    InlineEquation,
    BlockEquation,
    ImageBlock,
  ];
}

function Editor({ doc, noteId, ensure, placeholder, day }) {
  // Read when "#label " is typed, so it sees labels made after the editor was.
  const labels = useRef(undefined);
  labels.current = useQuery('labels');
  const editor = useEditor(
    {
      extensions: journalExtensions({
        doc,
        placeholder,
        day,
        resolveLabel: (name) => resolveLabel(name, labels.current),
        onCreate: (id, title, label) => {
          ensure?.();
          action.createTaskInNote(noteId, title, id, {}, label);
        },
      }),
      editorProps: { attributes: { class: 'prose', 'aria-label': 'Journal' } },
    },
    [doc, noteId],
  );
  if (!editor) return null;
  return (
    <div className="journal">
      <EditorContent editor={editor} className="note-editor" />
      <button className="add-note-box" onClick={() => addNoteBox(editor)}>
        + Notes box
      </button>
      {/* The space below the journal still puts the cursor in it, at the end. */}
      <div className="journal-rest" aria-hidden="true" onClick={() => editor.commands.focus('end')} />
    </div>
  );
}
