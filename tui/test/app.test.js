import fs from 'node:fs';
import { createElement as h } from 'react';
import { render } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, journalId, localDate, shortDay } from '@almanac/shared';
import { ReplicaContext } from '../src/hooks.js';
import { openReplica } from '../src/replica.js';
import { width } from '../src/text.js';
import { makeTheme } from '../src/theme.js';
import { App } from '../src/views/App.js';
import { FakeStdin, FakeStdout, KEYS, tempPaths, writeDay } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '');

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

// A copy with a day like the design's example: tasks due, overdue and in categories, and a
// journal with a notes box holding a task.
function seededCopy() {
  const paths = tempPaths();
  cleanups.push(paths.done);
  const replica = openReplica({ paths, server: null });
  cleanups.push(() => replica.close());
  const act = (...args) => replica.act(...args);
  const today = localDate();
  const ids = {
    slides: act('captureTask', { title: 'Send slides to the group', due: today }),
    observatory: act('captureTask', { title: 'call the observatory', due: today, category: 'observing' }),
    referee: act('captureTask', { title: 'referee report', due: addDays(today, -2), category: 'paper' }),
    abstract: act('captureTask', { title: 'submit abstract', category: 'paper' }),
    priors: act('captureTask', { title: 'Email the priors', category: 'meeting' }),
  };
  const meeting = act('createLabel', { name: 'meeting', color: 'orange' });
  writeDay(act, today, (body, b) => {
    b.para(body, 'Discussed ', { text: 'priors', marks: { italic: {} } }, ' for the fits.');
    b.box(body, 'box-meeting', meeting, (box) => {
      b.para(box, 'Group meeting with the TESS team');
      b.task(box, ids.priors);
    });
  });
  // The links the web editor keeps from a day to the tasks and labels written in it.
  act('syncBodyLinks', journalId(today), 'embed', [ids.priors]);
  act('syncBodyLinks', journalId(today), 'label', [meeting]);
  return { paths, replica, ids, today };
}

function renderApp(replica, paths, { columns = 120, rows = 36 } = {}) {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const ink = render(h(ReplicaContext.Provider, { value: replica }, h(App, { theme: makeTheme(), paths })), {
    stdout,
    stdin,
    stderr: new FakeStdout(),
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  cleanups.push(() => ink.unmount());
  const frame = () => plain(stdout.lastFrame());
  const lines = () => frame().split('\n');
  // Each key gets a moment for the screen to catch up, as a person's would.
  const press = async (...keys) => {
    for (const key of keys) {
      stdin.write(key);
      await sleep(30);
    }
  };
  const see = (text) => vi.waitFor(() => expect(frame()).toContain(text), { timeout: 2000 });
  // The rows the cursor is on: the task list's, or the journal's.
  const cursorLine = (pane) => lines().find((l) => (pane === 'tasks' ? l.startsWith('▌') : l.includes('│▌'))) ?? '';
  const cursorTo = async (pane, text) => {
    for (let i = 0; i < 40 && !cursorLine(pane).includes(text); i++) await press('j');
    expect(cursorLine(pane)).toContain(text);
  };
  return { frame, lines, press, see, cursorLine, cursorTo };
}

describe('the full-screen app', () => {
  it('draws the day: its Due panel, its journal with the notes box, the task list and the status bar', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    const frame = app.frame();
    for (const text of ['TODAY', 'Send slides to the group', 'Overdue', 'referee report', 'Discussed priors for the fits.', '● meeting', 'Group meeting with the TESS team', 'Email the priors', 'observing', 'paper', 'No category', 'JOURNAL']) {
      expect(frame).toContain(text);
    }
    expect(app.lines()).toHaveLength(36);
    for (const line of app.lines()) expect(width(line)).toBeLessThanOrEqual(120);
  });

  it('adds a task from the task box, showing how it reads first', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press('a');
    await app.see('ADD TASK');
    await app.press('water the plants tomorrow #home');
    await app.see('Tomorrow');
    expect(app.frame()).toMatch(/water the plants\s+Tomorrow\s+home\s+new/);
    await app.press(KEYS.enter);
    await app.see('Added water the plants');
    const added = replica.queries.openTasks().find((t) => t.title === 'water the plants');
    expect(added).toMatchObject({ category: 'home', due: addDays(today, 1) });
    await app.press(KEYS.escape);
    await app.see('TASKS');
  });

  it('checks off, deletes and brings back a task in the list', async () => {
    const { replica, paths, ids } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(KEYS.shiftTab);
    await app.see('TASKS');
    await app.cursorTo('tasks', 'call the observatory');
    await app.press('x');
    await vi.waitFor(() => expect(replica.queries.task(ids.observatory).status).toBe('done'));

    await app.cursorTo('tasks', 'referee report');
    await app.press('D');
    await app.see('Deleted “referee report”. u brings it back.');
    expect(replica.queries.openTasks().map((t) => t.id)).not.toContain(ids.referee);
    await app.press('u');
    await app.see('Brought back “referee report”.');
    expect(replica.queries.openTasks().map((t) => t.id)).toContain(ids.referee);
  });

  it('picks a category and a due date at the task, and adds subtasks under it', async () => {
    const { replica, paths, ids, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(KEYS.shiftTab);
    await app.cursorTo('tasks', 'submit abstract');

    await app.press('c');
    await app.see('Enter picks');
    await app.press('errands');
    await app.see('new category “errands”');
    await app.press(KEYS.enter);
    await vi.waitFor(() => expect(replica.queries.task(ids.abstract).category).toBe('errands'));

    await app.cursorTo('tasks', 'submit abstract');
    await app.press('d');
    await app.see('Enter sets');
    await app.press('tomorrow');
    await app.see('→ ');
    await app.press(KEYS.enter);
    await vi.waitFor(() => expect(replica.queries.task(ids.abstract).due).toBe(addDays(today, 1)));

    await app.press('A');
    await app.see('SUBTASK');
    await app.press('pick the nights', KEYS.enter);
    await vi.waitFor(() => expect(replica.queries.subtasks(ids.abstract).map((s) => s.title)).toEqual(['pick the nights']));
    await app.see('0/1');
    // Which tasks show their subtasks is kept on this machine.
    expect(JSON.parse(fs.readFileSync(paths.state, 'utf8')).openSubtasks).toEqual([ids.abstract]);
  });

  it('moves a category with Alt+↓ on its name, and Home and End go to either end of the list', async () => {
    const { replica, paths, ids } = seededCopy();
    // Short enough that a half page is a row or two, so End can't get there by paging.
    const app = renderApp(replica, paths, { rows: 18 });
    await app.see('JOURNAL');
    await app.press(KEYS.shiftTab, KEYS.end);
    await vi.waitFor(() => expect(app.cursorLine('tasks')).toContain('Send slides to the group'));
    await app.press('x');
    await vi.waitFor(() => expect(replica.queries.task(ids.slides).status).toBe('done'));

    await app.press(KEYS.home);
    await vi.waitFor(() => expect(app.cursorLine('tasks')).toContain('meeting'));
    await app.press(KEYS.altDown);
    await vi.waitFor(() => expect(replica.queries.categoryOrder()).toEqual(['observing', 'meeting', 'paper']));
  });

  it('opens a task’s day from the list with the cursor on the task where it’s written', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(KEYS.shiftTab);
    await app.cursorTo('tasks', 'Email the priors');
    await app.press(KEYS.enter);
    await app.see('JOURNAL');
    await vi.waitFor(() => expect(app.cursorLine('journal')).toContain('Email the priors'));
  });

  it('pins a box to the days after its own, where it shows as the box itself', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.cursorTo('journal', '● meeting');
    await app.press('p');
    await app.see('Pinned.');
    expect(replica.queries.pinnedBoxes(addDays(today, 1))).toHaveLength(1);
    await app.press(']');
    await app.see('TOMORROW');
    expect(app.frame()).toContain('pinned from');
    expect(app.frame()).toContain('Group meeting with the TESS team');
  });

  it('searches the journals and tasks, and opens a matching day', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press('[');
    await app.see('YESTERDAY');
    await app.press('/');
    await app.see('SEARCH');
    await app.press('TESS');
    await app.see('see the days');
    await app.press(KEYS.enter);
    await app.see('Esc clears');
    await vi.waitFor(() => expect(app.cursorLine('tasks')).toContain(shortDay(today, today)));
    await app.press(KEYS.enter);
    await app.see('TODAY');
  });

  it('opens read-only while another terminal has the copy, says why, and can write once it’s gone', async () => {
    const { replica: other, paths } = seededCopy();
    const replica = openReplica({ paths, server: null });
    cleanups.push(() => replica.close());
    replica.start();
    const app = renderApp(replica, paths);
    await app.see('◇ read-only');
    await app.see('Almanac is open in another terminal, so this one can only read.');
    await app.press('a');
    expect(app.frame()).not.toContain('ADD TASK');

    other.close();
    await vi.waitFor(() => expect(app.frame()).toContain('The other terminal closed, so this one can write now.'), { timeout: 4000 });
    expect(app.frame()).not.toContain('read-only');
    await app.press('a');
    await app.see('ADD TASK');
  });

  it('asks for a bigger terminal when it’s too small to draw', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths, { columns: 60, rows: 15 });
    await app.see('Make the terminal at least 72 × 18');
  });
});
