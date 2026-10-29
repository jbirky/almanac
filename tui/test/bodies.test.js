import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BODY_FIELD, addDays, journalId } from '@almanac/shared';
import { logText } from '../src/commands.js';
import { caretFromRel, caretToRel } from '../src/journal/caret.js';
import { newParagraph } from '../src/journal/doc.js';
import * as edits from '../src/journal/edit.js';
import { openReplica } from '../src/replica.js';
import { fetchFrom, makeDevice, makeServer, tempPaths, writeDay } from './helpers.js';

const cleanups = [];
afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length) cleanups.pop()();
});
function copy(options = {}) {
  const paths = tempPaths();
  cleanups.push(paths.done);
  const replica = openReplica({ paths, server: null, ...options });
  cleanups.push(() => replica.close());
  return { paths, replica };
}

const DAY = '2026-10-28';
const ID = journalId(DAY);
const xml = (state) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.getXmlFragment(BODY_FIELD).toString();
};
const stored = (replica) => (replica.queries.body(ID) ? xml(replica.queries.body(ID)) : null);
const words = (replica) => replica.queries.heatmap(DAY, addDays(DAY, 1), DAY)[DAY]?.words ?? 0;

// The day's session, as the TUI opens it, and what its edits need from outside the document.
const openDay = (replica) => replica.bodies.open(ID, () => replica.act('ensureJournal', DAY));
function ctx(replica, session) {
  let n = 0;
  return {
    newId: () => `id-${++n}`,
    resolveLabel: (name) => replica.act('createLabel', { name }),
    createTask: (id, title, label) => {
      session.ensure();
      replica.act('createTaskInNote', ID, title, id, {}, label);
    },
  };
}

describe('a journal open for editing', () => {
  it('saves a second after the first edit, as one change, with the links its body implies', () => {
    vi.useFakeTimers();
    const { replica } = copy();
    const session = openDay(replica);
    const c = ctx(replica, session);
    const start = session.transact(() => ({ el: newParagraph(session.fragment, 0), offset: 0 }));
    const { caret } = session.transact(() => edits.type(c, start, 'Discussed priors.'));
    session.transact(() => edits.enter(c, caret));
    expect(stored(replica)).toBeNull();
    vi.advanceTimersByTime(999);
    expect(stored(replica)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(stored(replica)).toBe('<paragraph>Discussed priors.</paragraph><paragraph></paragraph>');
    // The day's item was made with it, so the calendar counts its words.
    expect(words(replica)).toBe(2);

    // A task typed with "[] " in a box is made at once, filed under the box's label; the blocks,
    // and the links from the day to the task and the label, are saved with the next save.
    const p = session.fragment.toArray()[1];
    const inBox = session.transact(() => edits.type(c, { el: p, offset: 0 }, '#meeting notes'));
    const { task } = session.transact(() => edits.type(c, edits.enter(c, inBox.caret).caret, '[] '));
    const id = task.getAttribute('id');
    expect(replica.queries.task(id)).toMatchObject({ status: 'open', category: 'meeting' });
    session.flush();
    expect(stored(replica)).toBe(`<paragraph>Discussed priors.</paragraph><notebox id="id-1" label="label-meeting"><paragraph>notes</paragraph><taskref id="${id}"></taskref></notebox><paragraph></paragraph>`);
    expect(replica.queries.taskDay(id)).toBe(DAY);
    expect(replica.queries.labels().find((l) => l.id === 'label-meeting')).toMatchObject({ days: 1, last: DAY });
    session.release();
  });

  it('pulls in what other devices write, while the cursor stays where it was', async () => {
    const server = makeServer();
    const { replica } = copy({ server: 'http://almanac.test', fetch: fetchFrom(server) });
    const browser = makeDevice(server);
    writeDay((name, ...args) => browser.actions[name](...args), DAY, (body, b) => b.para(body, 'Done.'));
    await browser.sync();
    await replica.sync();

    const session = openDay(replica);
    const c = ctx(replica, session);
    const typed = session.transact(() => edits.type(c, { el: session.fragment.toArray()[0], offset: 5 }, ' Mine'));
    const rel = caretToRel(typed.caret);
    session.flush();

    // The browser, meanwhile, writes at the start of the same line.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, browser.queries.body(ID));
    const before = Y.encodeStateVector(doc);
    doc.getXmlFragment(BODY_FIELD).toArray()[0].toArray()[0].insert(0, 'Theirs. ');
    browser.actions.applyBodyUpdate(ID, Y.encodeStateAsUpdate(doc, before));
    await browser.sync();
    await replica.sync();

    expect(session.fragment.toString()).toBe('<paragraph>Theirs. Done. Mine</paragraph>');
    const at = caretFromRel(session.doc, rel);
    expect(at.offset).toBe('Theirs. Done. Mine'.length);
    session.transact(() => edits.type(c, at, '!'));
    session.flush();
    await replica.sync();
    await browser.sync();
    expect(xml(browser.queries.body(ID))).toBe('<paragraph>Theirs. Done. Mine!</paragraph>');
    session.release();
  });

  it('undoes its own edits, bringing back a task deleted with its block, and redoes them', () => {
    const { replica } = copy();
    writeDay((...args) => replica.act(...args), DAY, (body, b) => b.para(body, 'Before.'));
    const session = openDay(replica);
    const c = ctx(replica, session);
    const { task } = session.transact(() => edits.type(c, { el: session.fragment.toArray()[0], offset: 0 }, '[] '));
    const id = task.getAttribute('id');
    replica.act('updateItem', id, { title: 'call the observatory' });
    replica.act('addSubtask', id, 'pick the nights');

    const ids = replica.act('deleteTask', id);
    session.transactAlone(() => edits.removeBlock(task), ids);
    expect(replica.queries.task(id)).toMatchObject({ deleted: 1 });
    expect(session.fragment.toString()).not.toContain('taskref');

    expect(session.undo()).toBe(true);
    expect(session.fragment.toString()).toContain(`<taskref id="${id}">`);
    expect(replica.queries.task(id)).toMatchObject({ title: 'call the observatory', deleted: 0, subtasks: 1 });
    expect(session.redo()).toBe(true);
    expect(replica.queries.task(id)).toMatchObject({ deleted: 1 });
    expect(session.undo()).toBe(true);
    expect(replica.queries.task(id)).toMatchObject({ title: 'call the observatory', deleted: 0 });
    // Further back: the "[] " that made the task.
    expect(session.undo()).toBe(true);
    expect(session.fragment.toString()).toBe('<paragraph>Before.</paragraph>');
    expect(session.undo()).toBe(false);
    session.release();
  });

  it('writes `almanac log` into the day the TUI shows, or the stored one, and saves it at once', () => {
    const { replica } = copy();
    expect(logText(replica, 'First.\n\nSecond.\n', DAY)).toBe(DAY);
    expect(stored(replica)).toBe('<paragraph>First.</paragraph><paragraph></paragraph><paragraph>Second.</paragraph>');
    expect(words(replica)).toBe(2);

    const session = openDay(replica);
    const seen = vi.fn();
    session.subscribe(seen);
    logText(replica, 'Third.', DAY);
    expect(seen).toHaveBeenCalled();
    expect(session.fragment.toArray().at(-1).toString()).toBe('<paragraph>Third.</paragraph>');
    expect(stored(replica)).toBe(session.fragment.toString());
    expect(() => logText(replica, '  \n ', DAY)).toThrow('Nothing to add');
    session.release();
  });

  it('saves what’s waiting when the copy closes', () => {
    const paths = tempPaths();
    cleanups.push(paths.done);
    const replica = openReplica({ paths, server: null });
    const session = openDay(replica);
    session.transact(() => edits.type(ctx(replica, session), { el: newParagraph(session.fragment, 0), offset: 0 }, 'Late words.'));
    replica.close();
    const again = openReplica({ paths, server: null });
    cleanups.push(() => again.close());
    expect(stored(again)).toBe('<paragraph>Late words.</paragraph>');
  });

  it('shows a read-only copy what the terminal with the lock writes', async () => {
    const { paths, replica: writer } = copy();
    writer.act('ensureJournal', DAY);
    const reader = openReplica({ paths, server: null });
    cleanups.push(() => reader.close());
    reader.start();
    const session = openDay(reader);
    logText(writer, 'From the other terminal.', DAY);
    await vi.waitFor(() => expect(session.fragment.toString()).toContain('From the other terminal.'), { timeout: 3000 });
    session.release();
  });
});
