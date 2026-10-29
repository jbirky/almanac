import * as Y from 'yjs';
import { BODY_FIELD, linksInDoc } from '@almanac/shared';
import { keepShape } from './doc.js';

// Edits made here, as Yjs sees them: the undo history keeps these and no others.
export const LOCAL = 'local';
const REMOTE = 'remote';
const FLUSH_MS = 1000;

// The note bodies open for editing, each a live Yjs document, as the web's useBodyDoc keeps them:
// edits here are saved a second after the first one as one change, along with the links the body
// implies, and changes from other devices are pulled in as they arrive. Open sessions are shared,
// so `almanac log` sent to a running TUI writes into the same document the screen shows.
export function createBodies(replica) {
  const open = new Map();

  function makeSession(noteId, ensure) {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(BODY_FIELD);
    const state = replica.queries.body(noteId);
    if (state) Y.applyUpdate(doc, state, REMOTE);
    const listeners = new Set();
    let buffer = [];
    let timer = null;
    let links = linksInDoc(doc);
    let ensured = false;
    let version = 0;
    let users = 0;
    // What each undoable change took away, to bring back with it (a task deleted with its block).
    const undo = new Y.UndoManager(fragment, { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });
    undo.on('stack-item-popped', ({ stackItem, type }) => {
      const ids = stackItem.meta.get('tasks');
      if (!ids) return;
      if (type === 'undo') replica.act('restoreItems', ids);
      else replica.act('deleteTask', ids[0]);
      const other = type === 'undo' ? undo.redoStack.at(-1) : undo.undoStack.at(-1);
      other?.meta.set('tasks', ids);
    });

    const flush = () => {
      clearTimeout(timer);
      timer = null;
      if (!buffer.length) return;
      const update = Y.mergeUpdates(buffer);
      buffer = [];
      if (!ensured) {
        ensured = true;
        ensure?.();
      }
      replica.act('applyBodyUpdate', noteId, update);
      const now = linksInDoc(doc);
      for (const kind of ['embed', 'label']) {
        if (JSON.stringify(now[kind]) !== JSON.stringify(links[kind])) replica.act('syncBodyLinks', noteId, kind, now[kind]);
      }
      links = now;
    };

    doc.on('update', (update, origin) => {
      version++;
      if (origin !== REMOTE) {
        buffer.push(update);
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
      }
      for (const listener of listeners) listener();
    });

    // What's in the copy that this document is missing, pulled in. Not in the middle of an edit
    // here (one that creates a task, say), which would make it part of the edit.
    let editing = false;
    let missed = false;
    const pull = () => {
      if (editing) return void (missed = true);
      const diff = replica.queries.bodyDiff(noteId, Y.encodeStateVector(doc));
      if (diff) Y.applyUpdate(doc, diff, REMOTE);
    };
    // A read-only copy hears of the other terminal's writes without knowing which rows.
    const off = replica.subscribe((change) => {
      if (change.tables.includes('bodies') && (!change.rows.length || change.rows.includes(noteId))) pull();
    });

    const session = {
      noteId,
      doc,
      fragment,
      get version() {
        return version;
      },
      // Runs `fn` as one edit, keeping the document in a shape the browser leaves as it is.
      transact(fn) {
        let result;
        editing = true;
        try {
          doc.transact(() => {
            result = fn();
            keepShape(fragment);
          }, LOCAL);
        } finally {
          editing = false;
        }
        if (missed) {
          missed = false;
          pull();
        }
        return result;
      },
      // Creates the note's item, if it's new, before something is written that refers to it.
      ensure() {
        if (ensured) return;
        ensured = true;
        ensure?.();
      },
      flush,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      undo: () => undo.undo() !== null,
      redo: () => undo.redo() !== null,
      // Starts a new step in the undo history, so the next edit is undone on its own.
      stopCapturing: () => undo.stopCapturing(),
      // Runs `fn` as an edit of its own in the undo history. With `tasks`, the ids deleteTask
      // returned for the task whose block it takes out: undoing it brings them back too.
      transactAlone(fn, tasks) {
        undo.stopCapturing();
        const result = session.transact(fn);
        if (tasks) undo.undoStack.at(-1)?.meta.set('tasks', tasks);
        undo.stopCapturing();
        return result;
      },
      retain() {
        users++;
        return session;
      },
      release() {
        if (--users > 0) return;
        flush();
        off();
        undo.destroy();
        doc.destroy();
        open.delete(noteId);
      },
    };
    return session;
  }

  return {
    // The session for a note body, shared while it's open; `release` it when done. `ensure` runs
    // before the first save (a journal day's item is created only once it's written in).
    open(noteId, ensure) {
      if (!open.has(noteId)) open.set(noteId, makeSession(noteId, ensure));
      return open.get(noteId).retain();
    },
    // Runs `fn(session)` as one edit of a note body and saves it at once.
    edit(noteId, ensure, fn) {
      const session = this.open(noteId, ensure);
      try {
        const result = session.transact(() => fn(session));
        session.flush();
        return result;
      } finally {
        session.release();
      }
    },
    flushAll() {
      for (const session of open.values()) session.flush();
    },
  };
}
