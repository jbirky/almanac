import Database from 'better-sqlite3';
import * as Y from 'yjs';
import { BODY_FIELD, NOTE_BOX, adaptBetterSqlite, createActions, createCore, createQueries, createSyncer, ydocText } from '@almanac/shared';
import { createSyncStore } from '../src/store.js';

export function makeServer(raw = new Database(':memory:')) {
  return createSyncStore(adaptBetterSqlite(raw));
}

// A device with its own in-memory database and an adjustable wall clock.
export function makeDevice(server, startMillis = Date.now(), raw = new Database(':memory:')) {
  let wall = startMillis;
  const db = adaptBetterSqlite(raw);
  const core = createCore(db, { now: () => wall });
  const actions = createActions(core, { now: () => new Date(wall).toISOString() });
  const queries = createQueries(db);
  // Round-trip through JSON, as the HTTP endpoint does.
  const syncer = createSyncer(core, async (payload) => server.sync(JSON.parse(JSON.stringify(payload))));
  return {
    db,
    core,
    actions,
    queries,
    sync: () => syncer.sync(),
    tick: (ms) => (wall += ms),
  };
}

export function editBody(device, noteId, edit) {
  const doc = new Y.Doc();
  const state = device.queries.body(noteId);
  if (state) Y.applyUpdate(doc, state);
  const before = Y.encodeStateVector(doc);
  edit(doc.getXmlFragment(BODY_FIELD));
  device.actions.applyBodyUpdate(noteId, Y.encodeStateAsUpdate(doc, before));
  doc.destroy();
}

export function appendParagraph(fragment, text) {
  const p = new Y.XmlElement('paragraph');
  fragment.push([p]);
  p.insert(0, [new Y.XmlText(text)]);
}

// A notes box, as the editor stores it: an element holding paragraphs, with its label's id.
export function appendNoteBox(fragment, label, ...lines) {
  const box = new Y.XmlElement(NOTE_BOX);
  if (label) box.setAttribute('label', label);
  fragment.push([box]);
  for (const line of lines) appendParagraph(box, line);
}

// Equations as the editor stores them: one inside a line of text, and one on its own.
export function appendEquations(fragment, before, inline, after, block) {
  const p = new Y.XmlElement('paragraph');
  fragment.push([p]);
  const formula = new Y.XmlElement('inlineMath');
  formula.setAttribute('latex', inline);
  p.insert(0, [new Y.XmlText(before), formula, new Y.XmlText(after)]);
  const equation = new Y.XmlElement('blockMath');
  equation.setAttribute('latex', block);
  fragment.push([equation]);
}

export function bodyText(device, noteId) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, device.queries.body(noteId));
  const text = ydocText(doc);
  doc.destroy();
  return text;
}
